export const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";

export const DEFAULT_MODEL = process.env.DEFAULT_MODEL ?? "qwen3:8b";

export const MODEL_CONTEXT_TOKENS = 8192;

export const MAX_HISTORY_MESSAGES = 40;

export const MAX_MESSAGE_CHARS = 8000;

export const MAX_CHAT_REQUEST_BYTES = 2 * 1024 * 1024;

export const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

export const MEMORY_MAX_RESULTS = 5;

export const MEMORY_MAX_CONTEXT_CHARS = 2000;
