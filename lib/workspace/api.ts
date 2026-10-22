import { execFile } from "node:child_process";
import type { Project, ProjectStore } from "../projects/store.ts";
import { WorkspaceError } from "./errors.ts";
import { folderNameFor, readMarker } from "./create.ts";
import {
  MAX_UPLOAD_FILES,
  MAX_UPLOAD_TOTAL_BYTES,
  countFiles,
  createFile,
  createFolder,
  emptyTrash,
  importFiles,
  listTrash,
  openWorkspace,
  renameEntry,
  restoreEntry,
  trashEntry,
} from "./files.ts";
import { buildSite, siteBuildState } from "./build.ts";
import { gitCreateGithubRepository, gitInit, gitPush, gitSetRemote, gitSnapshot, gitStatus } from "./git.ts";
import { jsonResponse, readJsonBody, workspaceErrorResponse } from "./http.ts";
import { siteRuntime, type SiteRuntime } from "./runtime.ts";
import { getTemplate } from "./templates.ts";
import { exportWorkspaceZip } from "./zip.ts";

export type Opener = (command: string, args: string[]) => Promise<void>;

const defaultOpener: Opener = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 5_000 }, (error) => (error ? reject(error) : resolve()));
  });

function failure(error: unknown): Response {
  const known = workspaceErrorResponse(error);
  if (known) return known;
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  if (code === "NOT_FOUND") return jsonResponse({ error: "Project not found." }, 404);
  console.error(`[workspace] request failed (${typeof code === "string" ? code : "unknown"})`);
  return jsonResponse({ error: "The workspace request could not be completed." }, 500);
}

/** Every workspace route first proves the project exists, is a workspace, and its folder is usable. */
async function workspaceOf(store: ProjectStore, id: string): Promise<Project> {
  if (!id) throw new WorkspaceError("NOT_FOUND", "A project id is required.");
  const project = await store.getProject(id);
  if (project.kind !== "managed" || !project.sourceFolder) {
    throw new WorkspaceError("NOT_A_WORKSPACE", "This project's files are not managed by VYXO.");
  }
  return project;
}

export async function workspaceInfoResponse(store: ProjectStore, id: string): Promise<Response> {
  try {
    const project = await workspaceOf(store, id);
    const root = await openWorkspace(project.sourceFolder);
    const marker = await readMarker(root);
    const template = getTemplate(project.template);
    return jsonResponse(
      {
        workspace: {
          projectId: project.id,
          name: project.name,
          folder: root,
          template: project.template,
          templateLabel: template?.label ?? null,
          previewable: template?.previewable ?? false,
          fileCount: await countFiles(root),
          trashCount: (await listTrash(root)).length,
          markerOk: marker?.projectId === project.id,
        },
      },
      200,
    );
  } catch (error) {
    return failure(error);
  }
}

const ACTIONS = new Set(["create-file", "create-folder", "rename", "trash", "restore", "empty-trash"]);

export async function workspaceFilesActionResponse(store: ProjectStore, id: string, request: Request): Promise<Response> {
  const parsed = await readJsonBody(request, 2 * 1024 * 1024);
  if (!parsed.ok) return parsed.response;
  const { action, path, from, to, content, trashId } = parsed.body;
  if (typeof action !== "string" || !ACTIONS.has(action)) {
    return jsonResponse({ error: "Unknown action." }, 400);
  }
  try {
    const project = await workspaceOf(store, id);
    const folder = project.sourceFolder as string;
    switch (action) {
      case "create-file": {
        if (content !== undefined && typeof content !== "string") return jsonResponse({ error: "`content` must be text." }, 400);
        return jsonResponse(await createFile(folder, path, content ?? ""), 201);
      }
      case "create-folder":
        return jsonResponse(await createFolder(folder, path), 201);
      case "rename":
        return jsonResponse(await renameEntry(folder, from, to), 200);
      case "trash":
        return jsonResponse({ trashed: await trashEntry(folder, path) }, 200);
      case "restore":
        return jsonResponse(await restoreEntry(folder, trashId), 200);
      default:
        return jsonResponse(await emptyTrash(folder), 200);
    }
  } catch (error) {
    return failure(error);
  }
}

export async function workspaceTrashResponse(store: ProjectStore, id: string): Promise<Response> {
  try {
    const project = await workspaceOf(store, id);
    return jsonResponse({ entries: await listTrash(project.sourceFolder as string) }, 200);
  } catch (error) {
    return failure(error);
  }
}

export async function workspaceUploadResponse(store: ProjectStore, id: string, request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return jsonResponse({ error: "Content-Type must be multipart/form-data." }, 415);
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_TOTAL_BYTES + 1024 * 1024) {
    return jsonResponse({ error: "Those files are too large to add together." }, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonResponse({ error: "The upload could not be read." }, 400);
  }
  const entries = form.getAll("files");
  if (entries.length > MAX_UPLOAD_FILES) {
    return jsonResponse({ error: `Add at most ${MAX_UPLOAD_FILES} files at a time.` }, 400);
  }
  const files: { name: string; data: Uint8Array }[] = [];
  for (const entry of entries) {
    if (typeof entry === "string") continue;
    files.push({ name: entry.name, data: new Uint8Array(await entry.arrayBuffer()) });
  }
  const destination = form.get("folder");

  try {
    const project = await workspaceOf(store, id);
    return jsonResponse(await importFiles(project.sourceFolder as string, typeof destination === "string" ? destination : "", files), 201);
  } catch (error) {
    return failure(error);
  }
}

export async function workspaceExportResponse(store: ProjectStore, id: string): Promise<Response> {
  try {
    const project = await workspaceOf(store, id);
    const { data } = await exportWorkspaceZip(project.sourceFolder as string);
    const filename = `${folderNameFor(project.name)}.zip`;
    const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Content-Length": String(data.length),
        "Cache-Control": "no-store, no-transform",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return failure(error);
  }
}

/** Show the project's folder in the computer's file browser. The folder path never comes from the request. */
export async function workspaceRevealResponse(
  store: ProjectStore,
  id: string,
  options: { platform?: NodeJS.Platform; opener?: Opener } = {},
): Promise<Response> {
  try {
    const project = await workspaceOf(store, id);
    const root = await openWorkspace(project.sourceFolder);
    const platform = options.platform ?? process.platform;
    const opener = options.opener ?? defaultOpener;
    const command = platform === "darwin" ? "open" : platform === "win32" ? "explorer" : "xdg-open";
    try {
      await opener(command, [root]);
      return jsonResponse({ opened: true, folder: root }, 200);
    } catch {
      // Some systems have no file browser available; the path is still shown to the user.
      return jsonResponse({ opened: false, folder: root }, 200);
    }
  } catch (error) {
    return failure(error);
  }
}


export interface WorkspaceBuildOptions {
  /** Injected in tests. Defaults to the Next.js tools that ship with the app. */
  runtime?: SiteRuntime | null;
}

/** GET: the state of the last build. POST: build the site now and wait for the result. */
export async function workspaceBuildResponse(
  store: ProjectStore,
  id: string,
  method: "GET" | "POST",
  options: WorkspaceBuildOptions = {},
): Promise<Response> {
  try {
    const project = await workspaceOf(store, id);
    if (method === "GET") {
      return jsonResponse({ build: siteBuildState(project.id), needsBuild: project.template === "website-nextjs" }, 200);
    }
    if (project.template !== "website-nextjs") {
      return jsonResponse({ error: "This project is plain files, so it does not need a build." }, 400);
    }
    const runtime = options.runtime === undefined ? siteRuntime() : options.runtime;
    if (!runtime) {
      return jsonResponse({ error: "The Next.js tools are not included in this build of VYXO." }, 500);
    }
    const build = await buildSite({ projectId: project.id, folder: project.sourceFolder as string, runtime });
    return jsonResponse({ build }, 200);
  } catch (error) {
    return failure(error);
  }
}

const GIT_ACTIONS = new Set(["init", "snapshot", "set-remote", "create-github", "push"]);

/** GET: the project's Git status. POST: one Git step (set up, save a snapshot, connect, create, push). */
export async function workspaceGitResponse(
  store: ProjectStore,
  id: string,
  request: Request | null,
): Promise<Response> {
  try {
    const project = await workspaceOf(store, id);
    const folder = project.sourceFolder as string;
    if (!request || request.method === "GET") {
      return jsonResponse({ git: await gitStatus(folder) }, 200);
    }
    const parsed = await readJsonBody(request, 16 * 1024);
    if (!parsed.ok) return parsed.response;
    const { action, message, url, name, identity } = parsed.body;
    if (typeof action !== "string" || !GIT_ACTIONS.has(action)) {
      return jsonResponse({ error: "Unknown Git action." }, 400);
    }
    const who =
      identity && typeof identity === "object"
        ? { name: String((identity as { name?: unknown }).name ?? ""), email: String((identity as { email?: unknown }).email ?? "") }
        : null;
    let status;
    switch (action) {
      case "init":
        status = await gitInit(folder, who);
        break;
      case "snapshot":
        status = await gitSnapshot(folder, typeof message === "string" ? message : "");
        break;
      case "set-remote":
        status = await gitSetRemote(folder, typeof url === "string" ? url : "");
        break;
      case "create-github":
        status = await gitCreateGithubRepository(folder, typeof name === "string" ? name : project.name);
        break;
      default:
        status = await gitPush(folder);
    }
    return jsonResponse({ git: status }, 200);
  } catch (error) {
    return failure(error);
  }
}
