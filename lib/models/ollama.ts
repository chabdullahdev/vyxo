import { OLLAMA_BASE_URL, REQUEST_TIMEOUT_MS } from "../config.ts";
import type {
  ModelInfo,
  ModelProvider,
  StreamChatOptions,
} from "./types.ts";

export class OllamaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OllamaError";
  }
}

interface OllamaStreamChunk {
  error?: string;
  done?: boolean;
  message?: { role?: string; content?: string };
}

class ThinkFilter {
  private buffer = "";
  private inThink = false;

  push(chunk: string): string {
    this.buffer += chunk;
    let out = "";

    for (;;) {
      if (this.inThink) {
        const match = this.buffer.match(/<\/think(?:ing)?>/i);
        if (!match || match.index === undefined) {
          if (this.buffer.length > 16) {
            this.buffer = this.buffer.slice(this.buffer.length - 16);
          }
          return out;
        }
        this.buffer = this.buffer.slice(match.index + match[0].length);
        this.inThink = false;
        continue;
      }

      const match = this.buffer.match(/<think(?:ing)?>/i);
      if (!match || match.index === undefined) {
        const safe = this.buffer.length - 12;
        if (safe > 0) {
          out += this.buffer.slice(0, safe);
          this.buffer = this.buffer.slice(safe);
        }
        return out;
      }

      out += this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      this.inThink = true;
    }
  }

  flush(): string {
    if (this.inThink) {
      this.buffer = "";
      return "";
    }
    const rest = this.buffer;
    this.buffer = "";
    return rest;
  }
}

export class OllamaProvider implements ModelProvider {
  readonly info: ModelInfo;

  constructor(info: ModelInfo) {
    this.info = info;
  }

  async *streamChat({
    messages,
    signal,
  }: StreamChatOptions): AsyncGenerator<string, void, unknown> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.info.id,
          messages,
          stream: true,
          think: false,
          options: { num_ctx: this.info.contextTokens },
        }),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (error) {
      clearTimeout(timeout);
      if (controller.signal.aborted) throw error;
      throw new OllamaError(
        "Couldn't reach the local model. Make sure Ollama is running.",
      );
    }

    if (!response.ok || !response.body) {
      clearTimeout(timeout);
      throw new OllamaError(
        `The local model rejected the request (status ${response.status}).`,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const filter = new ThinkFilter();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");

          if (!line) continue;

          let chunk: OllamaStreamChunk;
          try {
            chunk = JSON.parse(line) as OllamaStreamChunk;
          } catch {
            continue;
          }

          if (chunk.error) {
            throw new OllamaError(
              "The local model returned an error while generating.",
            );
          }

          const text = chunk.message?.content;
          if (text) {
            const visible = filter.push(text);
            if (visible) yield visible;
          }
        }
      }

      const tail = filter.flush();
      if (tail) yield tail;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      reader.cancel().catch(() => {});
    }
  }
}
