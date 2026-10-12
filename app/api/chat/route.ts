import type { NextRequest } from "next/server";
import {
  MAX_HISTORY_MESSAGES,
  MAX_MESSAGE_CHARS,
  MEMORY_MAX_CONTEXT_CHARS,
  MEMORY_MAX_RESULTS,
} from "@/lib/config";
import { loadMemoryContext } from "@/lib/memory/retrieval";
import { memoryStore } from "@/lib/memory/store";
import { OllamaError } from "@/lib/models/ollama";
import { getProvider } from "@/lib/models/registry";
import type { ChatMessage } from "@/lib/models/types";
import { buildSystemMessages } from "@/lib/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ROLES = new Set(["user", "assistant"]);

type ValidationResult =
  | { ok: true; messages: ChatMessage[] }
  | { ok: false; error: string };

function validate(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const { messages } = body as { messages?: unknown };

  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: "`messages` must be a non-empty array." };
  }

  if (messages.length > MAX_HISTORY_MESSAGES) {
    return {
      ok: false,
      error: `Too many messages (max ${MAX_HISTORY_MESSAGES}).`,
    };
  }

  const cleaned: ChatMessage[] = [];

  for (const entry of messages) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, error: "Each message must be an object." };
    }

    const { role, content } = entry as { role?: unknown; content?: unknown };

    if (typeof role !== "string" || !VALID_ROLES.has(role)) {
      return {
        ok: false,
        error: "Each message role must be `user` or `assistant`.",
      };
    }

    if (typeof content !== "string" || content.trim().length === 0) {
      return { ok: false, error: "Each message must have text content." };
    }

    if (content.length > MAX_MESSAGE_CHARS) {
      return {
        ok: false,
        error: `A message is too long (max ${MAX_MESSAGE_CHARS} characters).`,
      };
    }

    cleaned.push({ role: role as ChatMessage["role"], content });
  }

  if (cleaned[cleaned.length - 1].role !== "user") {
    return { ok: false, error: "The last message must be from the user." };
  }

  return { ok: true, messages: cleaned };
}

function isAbort(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (error instanceof Error && error.name === "AbortError");
}

function toPublicError(error: unknown): string {
  if (error instanceof OllamaError) return error.message;
  return "Something went wrong while generating a response.";
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const result = validate(body);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  const provider = getProvider();
  const encoder = new TextEncoder();
  const upstream = new AbortController();
  const onClientAbort = () => upstream.abort();
  request.signal.addEventListener("abort", onClientAbort, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        const lastUserMessage = result.messages[result.messages.length - 1];
        const memoryContext = await loadMemoryContext(
          memoryStore,
          lastUserMessage.content,
          {
            maxResults: MEMORY_MAX_RESULTS,
            maxContextChars: MEMORY_MAX_CONTEXT_CHARS,
          },
        );
        const messages: ChatMessage[] = [
          ...buildSystemMessages(memoryContext),
          ...result.messages,
        ];

        for await (const text of provider.streamChat({
          messages,
          signal: upstream.signal,
        })) {
          send({ type: "delta", text });
        }
        send({ type: "done" });
      } catch (error) {
        if (isAbort(error) || upstream.signal.aborted) {
          return;
        }
        console.error(
          "[chat] generation failed:",
          error instanceof Error ? error.name : "unknown",
        );
        send({ type: "error", message: toPublicError(error) });
      } finally {
        request.signal.removeEventListener("abort", onClientAbort);
        try {
          controller.close();
        } catch {
          // Stream already closed (e.g. client disconnected).
        }
      }
    },
    cancel() {
      upstream.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
    },
  });
}
