import { DEFAULT_MODEL, MODEL_CONTEXT_TOKENS } from "../config.ts";
import { OllamaProvider } from "./ollama.ts";
import type { ModelProvider } from "./types.ts";

const providers = new Map<string, ModelProvider>();

export function getProvider(modelId: string = DEFAULT_MODEL): ModelProvider {
  const cached = providers.get(modelId);
  if (cached) return cached;

  const provider = new OllamaProvider({
    id: modelId,
    label: modelId,
    contextTokens: MODEL_CONTEXT_TOKENS,
  });
  providers.set(modelId, provider);
  return provider;
}
