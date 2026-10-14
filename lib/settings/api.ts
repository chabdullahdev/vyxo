import {
  buildModelCatalog,
  discoverInstalledModels,
  isValidModelName,
  type ModelDiscovery,
} from "../models/catalog.ts";
import { DEFAULT_STORAGE_DIR } from "../memory/store.ts";
import type { SettingsStore } from "./store.ts";

const MAX_BODY_BYTES = 20_000;

const STORAGE_FILES = {
  memory: "memories.json",
  conversations: "conversations.json",
  projects: "projects.json",
  settings: "settings.json",
};

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

function settingsErrorResponse(error: unknown): Response {
  const code = errorCode(error);
  if (code === "INVALID_MODEL") {
    const message = error instanceof Error && error.message ? error.message : "The request is invalid.";
    return jsonResponse({ error: message }, 400);
  }
  console.error(`[settings] storage error (${code ?? "unknown"})`);
  return jsonResponse({ error: "The settings store is unavailable." }, 500);
}

async function readJsonObject(request: Request): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response }
> {
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

export async function getSettingsResponse(store: SettingsStore): Promise<Response> {
  try {
    const settings = await store.getSettings();
    return jsonResponse(
      {
        settings: { selectedModel: settings.selectedModel },
        storage: { directory: DEFAULT_STORAGE_DIR, files: STORAGE_FILES },
      },
      200,
    );
  } catch (error) {
    return settingsErrorResponse(error);
  }
}

export async function updateSettingsResponse(
  store: SettingsStore,
  request: Request,
  discover: () => Promise<ModelDiscovery> = discoverInstalledModels,
): Promise<Response> {
  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;

  const selectedModel = parsed.body.selectedModel;
  if (!isValidModelName(selectedModel)) {
    return jsonResponse({ error: "`selectedModel` must be a valid model name." }, 400);
  }

  const discovery = await discover();
  if (!discovery.ok) {
    return jsonResponse({ error: discovery.message }, 503);
  }
  if (!discovery.models.includes(selectedModel)) {
    return jsonResponse({ error: "That model is not installed in Ollama." }, 400);
  }

  try {
    const settings = await store.setSelectedModel(selectedModel);
    return jsonResponse(
      { settings: { selectedModel: settings.selectedModel }, catalog: buildModelCatalog(selectedModel, discovery) },
      200,
    );
  } catch (error) {
    return settingsErrorResponse(error);
  }
}
