import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Where the tools for building a Next.js website come from. Nothing is downloaded: the packages a
 * site needs ship with VYXO. In a packaged app they sit in the app's resources folder
 * (`VYXO_SITE_DEPS`, set by the desktop shell). In development they are this project's own
 * `node_modules`.
 */
export interface SiteRuntime {
  /** The binary that runs JavaScript. Packaged builds run the app's own runtime in Node mode. */
  nodeBinary: string;
  /** The folder that holds the site packages (`next`, `react`, `tailwindcss`, ...). */
  depsDir: string;
  /** The Next.js command-line entry point inside `depsDir`. */
  nextBin: string;
}

export function resolveSiteDepsDir(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string | null {
  const configured = env.VYXO_SITE_DEPS;
  const dir = configured && configured.length > 0 ? configured : join(cwd, "node_modules");
  return existsSync(join(dir, "next", "dist", "bin", "next")) ? dir : null;
}

export function siteRuntime(
  depsDir: string | null = resolveSiteDepsDir(),
  nodeBinary: string = process.execPath,
): SiteRuntime | null {
  if (!depsDir) return null;
  return { nodeBinary, depsDir, nextBin: join(depsDir, "next", "dist", "bin", "next") };
}
