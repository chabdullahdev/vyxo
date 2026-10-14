import { OLLAMA_BASE_URL } from "../config.ts";

export const OLLAMA_TAGS_PATH = "/api/tags";

export const OLLAMA_DISCOVERY_TIMEOUT_MS = 4_000;

const MODEL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;

export function isValidModelName(value: unknown): value is string {
  return typeof value === "string" && MODEL_NAME_PATTERN.test(value);
}

function malformedModelListError(): Error {
  return new Error("Malformed Ollama model list.");
}

export function normalizeModelList(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw malformedModelListError();
  }

  const { models } = payload as { models?: unknown };
  if (!Array.isArray(models)) throw malformedModelListError();

  const names = new Set<string>();
  for (const entry of models) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const record = entry as { name?: unknown; model?: unknown };
    const candidate = typeof record.name === "string" ? record.name : record.model;
    if (typeof candidate === "string" && isValidModelName(candidate)) {
      names.add(candidate);
    }
  }

  if (models.length > 0 && names.size === 0) throw malformedModelListError();

  return [...names].sort((a, b) => a.localeCompare(b));
}

export type ModelDiscovery =
  | { ok: true; models: string[] }
  | { ok: false; message: string };

export interface DiscoverModelOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function discoverInstalledModels(
  options: DiscoverModelOptions = {},
): Promise<ModelDiscovery> {
  const baseUrl = options.baseUrl ?? OLLAMA_BASE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? OLLAMA_DISCOVERY_TIMEOUT_MS;

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}${OLLAMA_TAGS_PATH}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      message: "Ollama is not reachable on this Mac. Start Ollama, then check again.",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      message: `Ollama returned an unexpected response (status ${response.status}).`,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, message: "Ollama returned an unreadable response." };
  }

  try {
    return { ok: true, models: normalizeModelList(payload) };
  } catch {
    return { ok: false, message: "Ollama returned an unreadable model list." };
  }
}

export type ModelServiceStatus = "ok" | "empty" | "unavailable";

export interface ModelCatalog {
  status: ModelServiceStatus;
  models: string[];
  selectedModel: string;
  selectedInstalled: boolean;
  message: string | null;
}

export function buildModelCatalog(
  selectedModel: string,
  discovery: ModelDiscovery,
): ModelCatalog {
  if (!discovery.ok) {
    return {
      status: "unavailable",
      models: [],
      selectedModel,
      selectedInstalled: false,
      message: discovery.message,
    };
  }

  if (discovery.models.length === 0) {
    return {
      status: "empty",
      models: [],
      selectedModel,
      selectedInstalled: false,
      message: "No local models are installed. Pull one with Ollama, for example qwen3:8b.",
    };
  }

  return {
    status: "ok",
    models: discovery.models,
    selectedModel,
    selectedInstalled: discovery.models.includes(selectedModel),
    message: null,
  };
}

export type RequestedModelResult =
  | { ok: true; model: string }
  | { ok: false; error: string };

export function resolveRequestedModel(
  clientModel: unknown,
  storedModel: string,
): RequestedModelResult {
  if (clientModel === undefined || clientModel === null) {
    if (!isValidModelName(storedModel)) {
      return { ok: false, error: "The saved model name is invalid. Choose a model in Settings." };
    }
    return { ok: true, model: storedModel };
  }

  if (!isValidModelName(clientModel)) {
    return { ok: false, error: "`model` must be a valid model name." };
  }

  return { ok: true, model: clientModel };
}
