export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ModelInfo {
  id: string;
  label: string;
  contextTokens: number;
}

export interface StreamChatOptions {
  messages: ChatMessage[];
  signal?: AbortSignal;
}

export interface ModelProvider {
  readonly info: ModelInfo;
  streamChat(options: StreamChatOptions): AsyncGenerator<string, void, unknown>;
}
