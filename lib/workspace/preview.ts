import { stat } from "node:fs/promises";
import { extname, join } from "node:path";
import type { ProjectStore } from "../projects/store.ts";
import { WorkspaceError } from "./errors.ts";
import { SITE_OUTPUT_DIR } from "./build.ts";
import { cleanRelativePath, openWorkspace, readWorkspaceFile } from "./files.ts";

/**
 * Serves a workspace project's files so a website can be previewed inside VYXO.
 *
 * The page is written by a language model, so it is treated as untrusted code: it runs in a
 * sandboxed frame with an opaque origin, the response policy blocks every network request, and
 * only this project's own files (never VYXO's bookkeeping) can be read, and only certain types.
 */

export const MAX_PREVIEW_FILE_BYTES = 10 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

/**
 * Scripts and styles may be inline or from the project, but nothing may be fetched from anywhere
 * else, and the page cannot submit forms, open windows, or be shown inside any other site.
 * `sandbox` gives the page its own empty origin, so it cannot reach VYXO's pages, storage, or API.
 */
export const PREVIEW_CSP = [
  "sandbox allow-scripts",
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join("; ");

function previewHeaders(contentType: string, length: number): HeadersInit {
  return {
    "Content-Type": contentType,
    "Content-Length": String(length),
    "Content-Security-Policy": PREVIEW_CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store, no-transform",
  };
}

function plain(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

export async function previewResponse(
  store: ProjectStore,
  projectId: string,
  segments: string[] | undefined,
): Promise<Response> {
  let folder: string;
  // A Next.js site is shown from the pages it was built into; plain sites are shown from their own files.
  let siteFolder = "";
  try {
    const project = await store.getProject(projectId);
    if (project.kind !== "managed" || !project.sourceFolder) return plain(404, "No preview is available for this project.");
    folder = project.sourceFolder;
    if (project.template === "website-nextjs") siteFolder = SITE_OUTPUT_DIR;
  } catch {
    return plain(404, "No preview is available for this project.");
  }

  try {
    const root = await openWorkspace(folder);
    let relative = cleanRelativePath((segments ?? []).join("/"), { allowEmpty: true });
    if (relative === "") relative = "index.html";

    // A folder serves its index page. There is never a file listing.
    try {
      const probe = siteFolder ? join(root, siteFolder, relative) : join(root, relative);
      if ((await stat(probe)).isDirectory()) relative = `${relative}/index.html`;
    } catch {
      // Not found is reported below with the same message as any other missing file.
    }

    const type = CONTENT_TYPES[extname(relative).toLowerCase()];
    if (!type) return plain(415, "That kind of file cannot be previewed.");

    const target = siteFolder ? `${siteFolder}/${relative}` : relative;
    const data = await readWorkspaceFile(folder, target);
    if (data.length > MAX_PREVIEW_FILE_BYTES) return plain(413, "That file is too large to preview.");
    return new Response(new Uint8Array(data), { status: 200, headers: previewHeaders(type, data.length) });
  } catch (error) {
    if (error instanceof WorkspaceError) {
      if (error.code === "NOT_FOUND") {
        return plain(404, siteFolder ? "The site has not been built yet. Open the Preview tab to build it." : "Not found.");
      }
      if (error.code === "INVALID_PATH" || error.code === "UNSAFE") return plain(403, "That file cannot be previewed.");
    }
    return plain(500, "The preview could not be loaded.");
  }
}
