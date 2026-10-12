import type { MemoryStore } from "@/lib/memory/store";

export interface MemoryListResponse {
  memories: unknown[];
}

export interface MemoryResponse {
  memory: unknown;
}

export interface DeleteMemoryResponse {
  deleted: true;
}

export interface ApiErrorResponse {
  error: string;
}

const MAX_BODY_BYTES = 100_000;

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

function toErrorResponse(error: unknown): Response {
  const code = errorCode(error);

  if (code === "NOT_FOUND") {
    return jsonResponse({ error: "Memory not found." }, 404);
  }

  if (
    code === "INVALID_CONTENT" ||
    code === "INVALID_ARGUMENT" ||
    code === "DUPLICATE_ID"
  ) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "The request is invalid.";
    return jsonResponse({ error: message }, code === "DUPLICATE_ID" ? 409 : 400);
  }

  console.error(`[memories] storage error (${code ?? "unknown"})`);
  return jsonResponse({ error: "The memory store is unavailable." }, 500);
}

async function readContent(
  request: Request,
): Promise<{ ok: true; content: string } | { ok: false; response: Response }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return {
      ok: false,
      response: jsonResponse(
        { error: "Content-Type must be application/json." },
        415,
      ),
    };
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return {
      ok: false,
      response: jsonResponse({ error: "Could not read the request body." }, 400),
    };
  }

  if (raw.length > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: jsonResponse({ error: "Request body is too large." }, 413),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      response: jsonResponse({ error: "Request body must be valid JSON." }, 400),
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      response: jsonResponse(
        { error: "Request body must be a JSON object." },
        400,
      ),
    };
  }

  const { content } = parsed as { content?: unknown };
  if (typeof content !== "string") {
    return {
      ok: false,
      response: jsonResponse({ error: "`content` must be a string." }, 400),
    };
  }

  return { ok: true, content };
}

function missingId(): Response {
  return jsonResponse({ error: "A memory id is required." }, 400);
}

export async function listMemoriesResponse(store: MemoryStore): Promise<Response> {
  try {
    const memories = await store.listMemories();
    return jsonResponse({ memories }, 200);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function createMemoryResponse(
  store: MemoryStore,
  request: Request,
): Promise<Response> {
  const parsed = await readContent(request);
  if (!parsed.ok) return parsed.response;

  try {
    const memory = await store.createMemory(parsed.content);
    return jsonResponse({ memory }, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function getMemoryResponse(
  store: MemoryStore,
  id: string,
): Promise<Response> {
  if (!id) return missingId();

  try {
    const memory = await store.getMemory(id);
    return jsonResponse({ memory }, 200);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function updateMemoryResponse(
  store: MemoryStore,
  id: string,
  request: Request,
): Promise<Response> {
  if (!id) return missingId();

  const parsed = await readContent(request);
  if (!parsed.ok) return parsed.response;

  try {
    const memory = await store.updateMemory(id, parsed.content);
    return jsonResponse({ memory }, 200);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function deleteMemoryResponse(
  store: MemoryStore,
  id: string,
): Promise<Response> {
  if (!id) return missingId();

  try {
    const deleted = await store.deleteMemory(id);
    if (!deleted) {
      return jsonResponse({ error: "Memory not found." }, 404);
    }
    return jsonResponse({ deleted: true }, 200);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export function methodNotAllowedResponse(allowed: string[]): Response {
  return new Response(JSON.stringify({ error: "Method not allowed." }), {
    status: 405,
    headers: { ...JSON_HEADERS, Allow: allowed.join(", ") },
  });
}
