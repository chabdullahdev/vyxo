import { spawn } from "node:child_process";
import { access, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SiteRuntime } from "./runtime.ts";

/**
 * Builds a Next.js workspace project into static pages in its `out` folder, so the Preview tab can
 * show it. The build runs with the packages that ship with VYXO and never reaches the internet.
 * One build runs per project at a time; a second request waits for the first.
 */

export const BUILD_TIMEOUT_MS = 180_000;
export const SITE_OUTPUT_DIR = "out";
/**
 * Next.js puts the site's scripts and styles in `_next`. The development server refuses requests whose
 * path contains `/_next` from the preview frame, which has no normal origin, so the preview uses this name.
 */
export const SITE_ASSET_DIR = "vyxo-assets";
const TEXT_FILE = /\.(html|js|css|txt|json)$/i;
const OUTPUT_LIMIT = 60_000;
const PROBLEM_LINES = 14;
const ANSI = /\u001b\[[0-9;]*m/g;

export type SiteBuildStatus = "none" | "building" | "ready" | "failed";

export interface SiteBuildState {
  status: SiteBuildStatus;
  /** A short, readable reason when the last build failed. */
  message: string | null;
  finishedAt: string | null;
}

const states = new Map<string, SiteBuildState>();
const running = new Map<string, Promise<SiteBuildState>>();

export function previewBasePath(projectId: string): string {
  return `/api/preview/${encodeURIComponent(projectId)}`;
}

export function siteBuildState(projectId: string): SiteBuildState {
  return states.get(projectId) ?? { status: "none", message: null, finishedAt: null };
}

export interface BuildSiteInput {
  projectId: string;
  folder: string;
  runtime: SiteRuntime;
  timeoutMs?: number;
  now?: () => Date;
}

export function buildSite(input: BuildSiteInput): Promise<SiteBuildState> {
  const existing = running.get(input.projectId);
  if (existing) return existing;
  const job = runBuild(input).finally(() => running.delete(input.projectId));
  running.set(input.projectId, job);
  return job;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function runBuild(input: BuildSiteInput): Promise<SiteBuildState> {
  const { projectId, folder, runtime, timeoutMs = BUILD_TIMEOUT_MS, now = () => new Date() } = input;
  states.set(projectId, { status: "building", message: null, finishedAt: null });

  const finish = (status: "ready" | "failed", message: string | null): SiteBuildState => {
    const state = { status, message, finishedAt: now().toISOString() };
    states.set(projectId, state);
    return state;
  };

  try {
    if (!(await exists(join(folder, "node_modules", "next")))) {
      return finish("failed", "This project is missing the Next.js tools. Create a new Next.js website project.");
    }
    // Remove the last build so a stale page can never be shown as the new one.
    await rm(join(folder, SITE_OUTPUT_DIR), { recursive: true, force: true });

    const result = await runNext({ projectId, folder, runtime, timeoutMs });
    if (result.code === 0 && (await exists(join(folder, SITE_OUTPUT_DIR, "index.html")))) {
      await renameSiteAssets(join(folder, SITE_OUTPUT_DIR));
      return finish("ready", null);
    }
    return finish("failed", problemSummary(result.output, result.timedOut));
  } catch {
    return finish("failed", "The site could not be built. Try again, or ask for a fix in the Chat tab.");
  }
}

/** Move `_next` to SITE_ASSET_DIR and point every built file at the new name. */
export async function renameSiteAssets(outDir: string): Promise<void> {
  const from = join(outDir, "_next");
  if (!(await exists(from))) return;
  await rename(from, join(outDir, SITE_ASSET_DIR));
  const replacePath = /(^|[^A-Za-z0-9_])_next\//g;
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && TEXT_FILE.test(entry.name)) {
        const text = await readFile(path, "utf8");
        const updated = text.replace(replacePath, `$1${SITE_ASSET_DIR}/`);
        if (updated !== text) await writeFile(path, updated, "utf8");
      }
    }
  };
  await visit(outDir);
}

function runNext(input: {
  projectId: string;
  folder: string;
  runtime: SiteRuntime;
  timeoutMs: number;
}): Promise<{ code: number | null; output: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    const child = spawn(input.runtime.nodeBinary, [input.runtime.nextBin, "build", "--webpack"], {
      cwd: input.folder,
      env: {
        HOME: process.env.HOME ?? "",
        USERPROFILE: process.env.USERPROFILE ?? "",
        APPDATA: process.env.APPDATA ?? "",
        LOCALAPPDATA: process.env.LOCALAPPDATA ?? "",
        SYSTEMROOT: process.env.SYSTEMROOT ?? "",
        PATHEXT: process.env.PATHEXT ?? "",
        PATH: process.env.PATH ?? "",
        TMPDIR: process.env.TMPDIR ?? "",
        TEMP: process.env.TEMP ?? "",
        TMP: process.env.TMP ?? "",
        LANG: process.env.LANG ?? "en_US.UTF-8",
        // Run the app's own runtime as plain Node when packaged. Harmless when it is already Node.
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        // A site build never downloads anything. If Next.js ever tries to install a package, npm fails instead.
        npm_config_offline: "true",
        VYXO_PREVIEW_BASE: previewBasePath(input.projectId),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const collect = (chunk: Buffer) => {
      if (output.length < OUTPUT_LIMIT) output += chunk.toString("utf8");
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, input.timeoutMs);

    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: null, output, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output, timedOut });
    });
  });
}

/** The few lines that explain a failed build, without terminal colours. */
export function problemSummary(output: string, timedOut: boolean): string {
  if (timedOut) return "The build took too long and was stopped. Try again, or ask for a simpler page.";
  const lines = output
    .replace(ANSI, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  const problems = lines.filter((line) => /error|failed|cannot|not found|unexpected|unterminated/i.test(line));
  const chosen = (problems.length > 0 ? problems : lines).slice(-PROBLEM_LINES);
  return chosen.length > 0 ? chosen.join("\n") : "The build failed for an unknown reason.";
}
