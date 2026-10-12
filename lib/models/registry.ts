import { DEFAULT_MODEL, MODEL_CONTEXT_TOKENS } from "@/lib/config";
import { OllamaProvider } from "./ollama";
import type { ModelProvider } from "./types";

let provider: ModelProvider | null = null;

export function getProvider(): ModelProvider {
  if (!provider) {
    provider = new OllamaProvider({
      id: DEFAULT_MODEL,
      label: DEFAULT_MODEL,
      contextTokens: MODEL_CONTEXT_TOKENS,
    });
  }
  return provider;
}
