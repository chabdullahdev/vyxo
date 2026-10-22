import { WorkspaceError, type WorkspaceErrorCode } from "./errors.ts";

export const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
};

export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const STATUS: Record<WorkspaceErrorCode, number> = {
  INVALID_TEMPLATE: 400,
  INVALID_PATH: 400,
  NOT_FOUND: 404,
  EXISTS: 409,
  NOT_A_WORKSPACE: 400,
  UNSAFE: 403,
  TOO_LARGE: 413,
  LIMIT_EXCEEDED: 400,
  UNSUPPORTED: 415,
  STORAGE_IO: 500,
};

/** Workspace errors carry messages written for the user; anything else is reported generically. */
export function workspaceErrorResponse(error: unknown): Response | null {
  if (error instanceof WorkspaceError) {
    return jsonResponse({ error: error.message, code: error.code }, STATUS[error.code] ?? 400);
  }
  return null;
}

export function methodNotAllowed(allowed: string[]): Response {
  return new Response(JSON.stringify({ error: "Method not allowed." }), {
    status: 405,
    headers: { ...JSON_HEADERS, Allow: allowed.join(", ") },
  });
}

export type JsonBody = { ok: true; body: Record<string, unknown> } | { ok: false; response: Response };

export async function readJsonBody(request: Request, maxBytes = 64_000): Promise<JsonBody> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return { ok: false, response: jsonResponse({ error: "Content-Type must be application/json." }, 415) };
  }
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, response: jsonResponse({ error: "Could not read the request body." }, 400) };
  }
  if (raw.length > maxBytes) {
    return { ok: false, response: jsonResponse({ error: "Request body is too large." }, 413) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, response: jsonResponse({ error: "Request body must be valid JSON." }, 400) };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, response: jsonResponse({ error: "Request body must be a JSON object." }, 400) };
  }
  return { ok: true, body: parsed as Record<string, unknown> };
}
