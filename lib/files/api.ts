import type { ProjectStore } from "../projects/store.ts";
import type { ProjectFileService } from "./service.ts";

const MAX_BODY_BYTES = 8_192;

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

function toFilesErrorResponse(error: unknown): Response {
  const code = errorCode(error);
  const message = error instanceof Error && error.message ? error.message : "The request could not be completed.";

  switch (code) {
    case "NOT_FOUND":
      return jsonResponse({ error: "That path does not exist." }, 404);
    case "OUTSIDE_FOLDER":
    case "SENSITIVE":
      return jsonResponse({ error: message }, 403);
    case "TOO_LARGE":
      return jsonResponse({ error: message }, 413);
    case "NOT_A_FILE":
    case "NOT_A_DIRECTORY":
    case "UNSUPPORTED_TYPE":
    case "BINARY":
      return jsonResponse({ error: message }, 415);
    case "INVALID_FOLDER":
    case "INVALID_PATH":
    case "SYMLINK":
    case "LIMIT_EXCEEDED":
    case "UNREADABLE":
      return jsonResponse({ error: message }, 400);
    default:
      console.error(`[files] request failed (${code ?? "unknown"})`);
      return jsonResponse({ error: "The file request could not be completed." }, 500);
  }
}

function missingProject(): Response {
  return jsonResponse({ error: "Project not found." }, 404);
}

function noFolder(): Response {
  return jsonResponse({ error: "No source folder is connected to this project." }, 400);
}

interface FolderView {
  path: string;
  name: string;
  available: boolean;
}

async function describeFolder(
  fileService: ProjectFileService,
  sourceFolder: string,
): Promise<FolderView> {
  try {
    const folder = await fileService.inspectFolder(sourceFolder);
    return { path: sourceFolder, name: folder.name, available: true };
  } catch {
    return { path: sourceFolder, name: "", available: false };
  }
}

export async function folderStatusResponse(
  projectStore: ProjectStore,
  fileService: ProjectFileService,
  id: string,
): Promise<Response> {
  if (!id) return missingProject();
  try {
    const project = await projectStore.getProject(id);
    if (!project.sourceFolder) return jsonResponse({ folder: null }, 200);
    return jsonResponse({ folder: await describeFolder(fileService, project.sourceFolder) }, 200);
  } catch (error) {
    if (errorCode(error) === "NOT_FOUND") return missingProject();
    return toFilesErrorResponse(error);
  }
}

export async function connectFolderResponse(
  projectStore: ProjectStore,
  fileService: ProjectFileService,
  id: string,
  request: Request,
): Promise<Response> {
  if (!id) return missingProject();

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonResponse({ error: "Content-Type must be application/json." }, 415);
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return jsonResponse({ error: "Could not read the request body." }, 400);
  }
  if (raw.length > MAX_BODY_BYTES) {
    return jsonResponse({ error: "Request body is too large." }, 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON." }, 400);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return jsonResponse({ error: "Request body must be a JSON object." }, 400);
  }

  const path = (parsed as { path?: unknown }).path;
  if (typeof path !== "string" || path.trim().length === 0) {
    return jsonResponse({ error: "`path` must be a folder path string." }, 400);
  }

  try {
    await projectStore.getProject(id);
    const folder = await fileService.inspectFolder(path);
    const project = await projectStore.setProjectSourceFolder(id, folder.root);
    return jsonResponse(
      { folder: { path: project.sourceFolder, name: folder.name, available: true } },
      200,
    );
  } catch (error) {
    if (errorCode(error) === "NOT_FOUND") return missingProject();
    return toFilesErrorResponse(error);
  }
}

export async function disconnectFolderResponse(
  projectStore: ProjectStore,
  id: string,
): Promise<Response> {
  if (!id) return missingProject();
  try {
    await projectStore.setProjectSourceFolder(id, null);
    return jsonResponse({ folder: null }, 200);
  } catch (error) {
    if (errorCode(error) === "NOT_FOUND") return missingProject();
    return toFilesErrorResponse(error);
  }
}

async function projectFolder(
  projectStore: ProjectStore,
  id: string,
): Promise<{ ok: true; sourceFolder: string } | { ok: false; response: Response }> {
  if (!id) return { ok: false, response: missingProject() };
  try {
    const project = await projectStore.getProject(id);
    if (!project.sourceFolder) return { ok: false, response: noFolder() };
    return { ok: true, sourceFolder: project.sourceFolder };
  } catch (error) {
    if (errorCode(error) === "NOT_FOUND") return { ok: false, response: missingProject() };
    return { ok: false, response: toFilesErrorResponse(error) };
  }
}

export async function listFilesResponse(
  projectStore: ProjectStore,
  fileService: ProjectFileService,
  id: string,
  request: Request,
): Promise<Response> {
  const folder = await projectFolder(projectStore, id);
  if (!folder.ok) return folder.response;

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return jsonResponse({ error: "The request URL is invalid." }, 400);
  }
  const path = url.searchParams.get("path") ?? "";

  try {
    const listing = await fileService.listDirectory(folder.sourceFolder, path);
    return jsonResponse(listing, 200);
  } catch (error) {
    return toFilesErrorResponse(error);
  }
}

export async function readFileResponse(
  projectStore: ProjectStore,
  fileService: ProjectFileService,
  id: string,
  request: Request,
): Promise<Response> {
  const folder = await projectFolder(projectStore, id);
  if (!folder.ok) return folder.response;

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return jsonResponse({ error: "The request URL is invalid." }, 400);
  }
  const path = url.searchParams.get("path") ?? "";
  if (path.length === 0) {
    return jsonResponse({ error: "A `path` query parameter is required." }, 400);
  }

  try {
    const file = await fileService.readTextFile(folder.sourceFolder, path);
    return jsonResponse(file, 200);
  } catch (error) {
    return toFilesErrorResponse(error);
  }
}

export async function searchFilesResponse(
  projectStore: ProjectStore,
  fileService: ProjectFileService,
  id: string,
  request: Request,
): Promise<Response> {
  const folder = await projectFolder(projectStore, id);
  if (!folder.ok) return folder.response;

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return jsonResponse({ error: "The request URL is invalid." }, 400);
  }
  const query = url.searchParams.get("q") ?? "";

  try {
    const results = await fileService.search(folder.sourceFolder, query);
    return jsonResponse(results, 200);
  } catch (error) {
    return toFilesErrorResponse(error);
  }
}

export function folderMethodNotAllowed(allowed: string[]): Response {
  return new Response(JSON.stringify({ error: "Method not allowed." }), {
    status: 405,
    headers: { ...JSON_HEADERS, Allow: allowed.join(", ") },
  });
}
