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

export interface FinishInfo {
  /** Why generation stopped: "stop" means the model finished; "length" means it ran out of room. */
  doneReason: string | null;
}

export interface StreamChatOptions {
  messages: ChatMessage[];
  signal?: AbortSignal;
  /** Overrides the context window for this request (building files needs more than chatting). */
  numCtx?: number;
  /** Overrides how many tokens the model may write. */
  maxTokens?: number;
  /** Called once when the model finishes on its own. Not called if the request is cancelled or fails. */
  onFinish?: (info: FinishInfo) => void;
}

export interface ModelProvider {
  readonly info: ModelInfo;
  streamChat(options: StreamChatOptions): AsyncGenerator<string, void, unknown>;
}
