import { isValidProjectId, type ProjectStore } from "../projects/store.ts";
import type { ConversationStore } from "./store.ts";

const MAX_BODY_BYTES = 20_000;
const MAX_SEARCH_LENGTH = 200;
const ARCHIVED_FILTERS = new Set(["active", "archived", "all"]);

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

function toErrorResponse(error: unknown): Response {
  const code = errorCode(error);

  if (code === "NOT_FOUND") {
    return jsonResponse({ error: "Conversation not found." }, 404);
  }

  if (code === "DUPLICATE_ID") {
    const message =
      error instanceof Error && error.message ? error.message : "The request is invalid.";
    return jsonResponse({ error: message }, 409);
  }

  if (
    code === "INVALID_TITLE" ||
    code === "INVALID_CONTENT" ||
    code === "INVALID_ARGUMENT" ||
    code === "INVALID_STATUS" ||
    code === "LIMIT_EXCEEDED"
  ) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "The request is invalid.";
    return jsonResponse({ error: message }, 400);
  }

  console.error(`[conversations] storage error (${code ?? "unknown"})`);
  return jsonResponse({ error: "The conversation store is unavailable." }, 500);
}

type BodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response };

async function readJsonObject(request: Request): Promise<BodyResult> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return {
      ok: false,
      response: jsonResponse({ error: "Content-Type must be application/json." }, 415),
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
      response: jsonResponse({ error: "Request body must be a JSON object." }, 400),
    };
  }

  return { ok: true, body: parsed as Record<string, unknown> };
}

function missingId(): Response {
  return jsonResponse({ error: "A conversation id is required." }, 400);
}

export async function listConversationsResponse(
  store: ConversationStore,
  request: Request,
): Promise<Response> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return jsonResponse({ error: "The request URL is invalid." }, 400);
  }

  const query = url.searchParams.get("q") ?? "";
  if (query.length > MAX_SEARCH_LENGTH) {
    return jsonResponse({ error: "Search text is too long." }, 400);
  }

  const archived = url.searchParams.get("archived") ?? "active";
  if (!ARCHIVED_FILTERS.has(archived)) {
    return jsonResponse({ error: "`archived` must be active, archived, or all." }, 400);
  }

  const projectId = url.searchParams.get("projectId");
  if (projectId !== null && !isValidProjectId(projectId)) {
    return jsonResponse({ error: "`projectId` is not a valid id." }, 400);
  }

  try {
    const conversations = await store.listConversations({
      query,
      archived: archived as "active" | "archived" | "all",
      ...(projectId !== null ? { projectId } : {}),
    });
    return jsonResponse({ conversations }, 200);
  } catch (error) {
    return toErrorResponse(error);
  }
}

async function projectExists(store: ProjectStore | undefined, projectId: string): Promise<boolean> {
  if (!store) return true;
  try {
    await store.getProject(projectId);
    return true;
  } catch {
    return false;
  }
}

export async function createConversationResponse(
  store: ConversationStore,
  request: Request,
  projectStore?: ProjectStore,
): Promise<Response> {
  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;

  const title = parsed.body.title;
  if (title !== undefined && typeof title !== "string") {
    return jsonResponse({ error: "`title` must be a string." }, 400);
  }

  const projectId = parsed.body.projectId;
  if (projectId !== undefined && projectId !== null && typeof projectId !== "string") {
    return jsonResponse({ error: "`projectId` must be a string or null." }, 400);
  }
  if (typeof projectId === "string" && !isValidProjectId(projectId)) {
    return jsonResponse({ error: "`projectId` is not a valid id." }, 400);
  }
  if (typeof projectId === "string" && !(await projectExists(projectStore, projectId))) {
    return jsonResponse({ error: "That project does not exist." }, 400);
  }

  try {
    const conversation = await store.createConversation(title, projectId ?? null);
    return jsonResponse({ conversation }, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function getConversationResponse(
  store: ConversationStore,
  id: string,
): Promise<Response> {
  if (!id) return missingId();

  try {
    const conversation = await store.getConversation(id);
    return jsonResponse({ conversation }, 200);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function updateConversationResponse(
  store: ConversationStore,
  id: string,
  request: Request,
  projectStore?: ProjectStore,
): Promise<Response> {
  if (!id) return missingId();

  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;

  const { title, archived, projectId } = parsed.body;
  if (title === undefined && archived === undefined && projectId === undefined) {
    return jsonResponse({ error: "Provide a `title`, `archived`, or `projectId` value." }, 400);
  }
  if (title !== undefined && typeof title !== "string") {
    return jsonResponse({ error: "`title` must be a string." }, 400);
  }
  if (archived !== undefined && typeof archived !== "boolean") {
    return jsonResponse({ error: "`archived` must be a boolean." }, 400);
  }
  if (projectId !== undefined && projectId !== null && typeof projectId !== "string") {
    return jsonResponse({ error: "`projectId` must be a string or null." }, 400);
  }
  if (typeof projectId === "string" && !isValidProjectId(projectId)) {
    return jsonResponse({ error: "`projectId` is not a valid id." }, 400);
  }
  if (typeof projectId === "string" && !(await projectExists(projectStore, projectId))) {
    return jsonResponse({ error: "That project does not exist." }, 400);
  }

  try {
    let conversation = await store.getConversation(id);
    if (title !== undefined) {
      conversation = await store.renameConversation(id, title);
    }
    if (archived !== undefined) {
      conversation = await store.setConversationArchived(id, archived);
    }
    if (projectId !== undefined) {
      conversation = await store.setConversationProject(id, projectId === null ? null : projectId);
    }
    return jsonResponse({ conversation }, 200);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function deleteConversationResponse(
  store: ConversationStore,
  id: string,
): Promise<Response> {
  if (!id) return missingId();

  try {
    const deleted = await store.deleteConversation(id);
    if (!deleted) {
      return jsonResponse({ error: "Conversation not found." }, 404);
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
