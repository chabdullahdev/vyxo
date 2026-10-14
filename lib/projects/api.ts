import type { ConversationStore } from "../conversations/store.ts";
import type { ProjectStore } from "./store.ts";

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
    return jsonResponse({ error: "Project not found." }, 404);
  }
  if (code === "DUPLICATE_ID") {
    const message = error instanceof Error && error.message ? error.message : "The request is invalid.";
    return jsonResponse({ error: message }, 409);
  }
  if (
    code === "INVALID_NAME" ||
    code === "INVALID_DESCRIPTION" ||
    code === "INVALID_CONTEXT" ||
    code === "INVALID_ARGUMENT" ||
    code === "LIMIT_EXCEEDED"
  ) {
    const message = error instanceof Error && error.message ? error.message : "The request is invalid.";
    return jsonResponse({ error: message }, 400);
  }

  console.error(`[projects] storage error (${code ?? "unknown"})`);
  return jsonResponse({ error: "The project store is unavailable." }, 500);
}

type BodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response };

async function readJsonObject(request: Request): Promise<BodyResult> {
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

  if (raw.length > MAX_BODY_BYTES) {
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

function missingId(): Response {
  return jsonResponse({ error: "A project id is required." }, 400);
}

export async function listProjectsResponse(
  store: ProjectStore,
  conversationStore: ConversationStore,
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

  try {
    const projects = await store.listProjects({
      query,
      archived: archived as "active" | "archived" | "all",
    });
    const conversations = await conversationStore.listConversations({ archived: "all" });
    const counts = new Map<string, number>();
    for (const conversation of conversations) {
      if (!conversation.projectId) continue;
      counts.set(conversation.projectId, (counts.get(conversation.projectId) ?? 0) + 1);
    }

    return jsonResponse(
      {
        projects: projects.map((project) => ({
          ...project,
          conversationCount: counts.get(project.id) ?? 0,
        })),
      },
      200,
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function createProjectResponse(
  store: ProjectStore,
  request: Request,
): Promise<Response> {
  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;

  const { name, description } = parsed.body;
  if (typeof name !== "string") {
    return jsonResponse({ error: "`name` must be a string." }, 400);
  }
  if (description !== undefined && typeof description !== "string") {
    return jsonResponse({ error: "`description` must be a string." }, 400);
  }

  try {
    const project = await store.createProject(name, description);
    return jsonResponse({ project }, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function getProjectResponse(store: ProjectStore, id: string): Promise<Response> {
  if (!id) return missingId();

  try {
    const project = await store.getProject(id);
    return jsonResponse({ project }, 200);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function updateProjectResponse(
  store: ProjectStore,
  id: string,
  request: Request,
): Promise<Response> {
  if (!id) return missingId();

  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;

  const { name, description, archived, context } = parsed.body;
  if (
    name === undefined &&
    description === undefined &&
    archived === undefined &&
    context === undefined
  ) {
    return jsonResponse(
      { error: "Provide a `name`, `description`, `context`, or `archived` value." },
      400,
    );
  }
  if (name !== undefined && typeof name !== "string") {
    return jsonResponse({ error: "`name` must be a string." }, 400);
  }
  if (description !== undefined && typeof description !== "string") {
    return jsonResponse({ error: "`description` must be a string." }, 400);
  }
  if (archived !== undefined && typeof archived !== "boolean") {
    return jsonResponse({ error: "`archived` must be a boolean." }, 400);
  }
  if (context !== undefined && (typeof context !== "object" || context === null || Array.isArray(context))) {
    return jsonResponse({ error: "`context` must be an object." }, 400);
  }

  try {
    let project = await store.getProject(id);
    if (name !== undefined || description !== undefined || context !== undefined) {
      project = await store.updateProject(id, {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(context !== undefined ? { context } : {}),
      });
    }
    if (archived !== undefined) {
      project = await store.setProjectArchived(id, archived);
    }
    return jsonResponse({ project }, 200);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function deleteProjectResponse(
  store: ProjectStore,
  conversationStore: ConversationStore,
  id: string,
): Promise<Response> {
  if (!id) return missingId();

  try {
    await store.getProject(id);
    await conversationStore.clearConversationsProject(id);
    const deleted = await store.deleteProject(id);
    if (!deleted) {
      return jsonResponse({ error: "Project not found." }, 404);
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
