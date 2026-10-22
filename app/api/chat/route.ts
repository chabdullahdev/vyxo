import type { NextRequest } from "next/server";
import {
  MAX_HISTORY_MESSAGES,
  MAX_MESSAGE_CHARS,
  MAX_CHAT_REQUEST_BYTES,
  MEMORY_MAX_CONTEXT_CHARS,
  MEMORY_MAX_RESULTS,
} from "@/lib/config";
import {
  conversationStore,
  isValidConversationId,
  type Conversation,
} from "@/lib/conversations/store";
import { loadProjectContextMessage } from "@/lib/projects/context";
import { isolatesGlobalMemory } from "@/lib/projects/isolation";
import { projectStore } from "@/lib/projects/store";
import { gatherProjectFileEvidence } from "@/lib/files/retrieval";
import { projectFileService } from "@/lib/files/service";
import { loadMemoryContext } from "@/lib/memory/retrieval";
import { memoryStore } from "@/lib/memory/store";
import {
  isAuthorizedDesktopRequest,
  unauthorizedDesktopResponse,
} from "@/lib/desktop/api-auth";
import {
  discoverInstalledModels,
  isValidModelName,
  resolveRequestedModel,
} from "@/lib/models/catalog";
import { OllamaError } from "@/lib/models/ollama";
import { getProvider } from "@/lib/models/registry";
import { settingsStore } from "@/lib/settings/store";
import type { ChatMessage } from "@/lib/models/types";
import {
  buildProjectAwareConversation,
  validateAndBuildProjectContext,
} from "@/lib/project/policy";
import {
  buildSystemMessages,
  isCodeExplanationRequest,
  validateDebuggingMode,
} from "@/lib/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ROLES = new Set(["user", "assistant"]);

type ValidationResult =
  | {
      ok: true;
      messages: ChatMessage[];
      projectContext: string | null;
      debuggingMode: boolean;
      conversationId: string | null;
      userMessageId: string | null;
      model: string | null;
    }
  | { ok: false; error: string };

type JsonBodyResult =
  | { ok: true; body: unknown }
  | { ok: false; status: 400 | 413; error: string };

type OptionalIdResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

async function readJsonBody(request: NextRequest): Promise<JsonBodyResult> {
  const reader = request.body?.getReader();
  if (!reader) {
    return { ok: false, status: 400, error: "Request body must be valid JSON." };
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_CHAT_REQUEST_BYTES) {
        void reader.cancel().catch(() => {});
        return {
          ok: false,
          status: 413,
          error: "Request body is too large. Remove files or shorten the conversation.",
        };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, error: "Request body must be valid JSON." };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The request stream may already be cancelled.
    }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return {
      ok: true,
      body: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    };
  } catch {
    return { ok: false, status: 400, error: "Request body must be valid JSON." };
  }
}

function validateOptionalId(value: unknown, field: string): OptionalIdResult {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (!isValidConversationId(value)) {
    return { ok: false, error: `\`${field}\` must be a valid id.` };
  }
  return { ok: true, value };
}

function validate(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const { messages, projectFiles, debuggingMode, conversationId, userMessageId, model } =
    body as {
      messages?: unknown;
      projectFiles?: unknown;
      debuggingMode?: unknown;
      conversationId?: unknown;
      userMessageId?: unknown;
      model?: unknown;
    };

  if (model !== undefined && model !== null && !isValidModelName(model)) {
    return { ok: false, error: "`model` must be a valid model name." };
  }

  const parsedDebuggingMode = validateDebuggingMode(debuggingMode);
  if (!parsedDebuggingMode.ok) {
    return { ok: false, error: "`debuggingMode` must be a boolean." };
  }

  const parsedConversationId = validateOptionalId(conversationId, "conversationId");
  if (!parsedConversationId.ok) {
    return { ok: false, error: parsedConversationId.error };
  }

  const parsedUserMessageId = validateOptionalId(userMessageId, "userMessageId");
  if (!parsedUserMessageId.ok) {
    return { ok: false, error: parsedUserMessageId.error };
  }

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

  let projectContext: string | null = null;
  if (projectFiles !== undefined) {
    const projectResult = validateAndBuildProjectContext(projectFiles);
    if (!projectResult.ok) {
      return { ok: false, error: projectResult.error };
    }
    projectContext = projectResult.context;
  }

  return {
    ok: true,
    messages: cleaned,
    projectContext,
    debuggingMode: parsedDebuggingMode.enabled,
    conversationId: parsedConversationId.value,
    userMessageId: parsedUserMessageId.value,
    model: typeof model === "string" ? model : null,
  };
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

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedDesktopRequest(request)) {
    return unauthorizedDesktopResponse(request);
  }

  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) {
    return Response.json(
      { error: parsedBody.error },
      { status: parsedBody.status },
    );
  }

  const result = validate(parsedBody.body);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  let conversation: Conversation | null = null;
  if (result.conversationId) {
    try {
      conversation = await conversationStore.getConversation(result.conversationId);
    } catch (error) {
      if (errorCode(error) === "NOT_FOUND") {
        return Response.json({ error: "Conversation not found." }, { status: 404 });
      }
      console.error("[chat] conversation lookup failed:", errorCode(error) ?? "unknown");
      return Response.json(
        { error: "The conversation store is unavailable." },
        { status: 500 },
      );
    }
  }

  let storedModel: string;
  try {
    storedModel = (await settingsStore.getSettings()).selectedModel;
  } catch (error) {
    console.error("[chat] settings read failed:", errorCode(error) ?? "unknown");
    return Response.json(
      { error: "The app settings could not be read." },
      { status: 500 },
    );
  }

  const requestedModel = resolveRequestedModel(result.model, storedModel);
  if (!requestedModel.ok) {
    return Response.json({ error: requestedModel.error }, { status: 400 });
  }

  const discovery = await discoverInstalledModels();
  if (!discovery.ok) {
    return Response.json({ error: discovery.message }, { status: 503 });
  }
  if (!discovery.models.includes(requestedModel.model)) {
    return Response.json(
      { error: "The selected model is not installed in Ollama. Choose an installed model in Settings." },
      { status: 400 },
    );
  }

  const provider = getProvider(requestedModel.model);
  const encoder = new TextEncoder();
  const upstream = new AbortController();
  const lifecycle = { cancelled: false };
  const onClientAbort = () => {
    lifecycle.cancelled = true;
    upstream.abort();
  };
  request.signal.addEventListener("abort", onClientAbort, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        if (lifecycle.cancelled) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          lifecycle.cancelled = true;
        }
      };

      const lastUserMessage = result.messages[result.messages.length - 1];
      let assistantText = "";
      let assistantSettled = false;

      const settleAssistant = async (
        status: "complete" | "interrupted" | "failed",
        errorMessage?: string,
      ) => {
        if (assistantSettled) return;
        assistantSettled = true;
        if (!result.conversationId) return;
        if (status !== "failed" && assistantText.trim().length === 0) return;

        try {
          await conversationStore.appendAssistantMessage(result.conversationId, {
            content: assistantText,
            status,
            ...(errorMessage ? { error: errorMessage } : {}),
          });
          send({ type: "saved", status });
        } catch (error) {
          console.error("[chat] history save failed:", errorCode(error) ?? "unknown");
          send({ type: "notice", message: "The response could not be saved to conversation history." });
        }
      };

      try {
        if (result.conversationId) {
          try {
            const appended = await conversationStore.appendUserMessage(
              result.conversationId,
              {
                ...(result.userMessageId ? { id: result.userMessageId } : {}),
                content: lastUserMessage.content,
              },
            );
            send({
              type: "conversation",
              conversationId: appended.conversation.id,
              title: appended.conversation.title,
            });
          } catch (error) {
            console.error("[chat] history save failed:", errorCode(error) ?? "unknown");
            send({ type: "notice", message: "This message could not be saved to conversation history." });
          }
        }

        let projectKnowledge: string | null = null;
        if (conversation?.projectId) {
          try {
            const projectLoad = await loadProjectContextMessage(
              projectStore,
              conversation.projectId,
            );
            if (projectLoad.status === "loaded") {
              projectKnowledge = projectLoad.message;
            } else if (projectLoad.status === "missing") {
              send({
                type: "notice",
                message:
                  "This conversation's project is no longer available, so its project context was not used.",
              });
            }
          } catch (error) {
            console.error("[chat] project context unavailable:", errorCode(error) ?? "unknown");
          }
        }

        let fileEvidence: string | null = null;
        if (conversation?.projectId) {
          try {
            const evidence = await gatherProjectFileEvidence(
              projectFileService,
              projectStore,
              conversation.projectId,
              lastUserMessage.content,
            );
            if (evidence.status === "loaded") {
              fileEvidence = evidence.message;
            } else if (evidence.status === "unavailable") {
              send({ type: "notice", message: evidence.message });
            }
          } catch (error) {
            console.error("[chat] file evidence unavailable:", errorCode(error) ?? "unknown");
          }
        }

        // A workspace project is its own space: global memories are not offered inside it.
        const memoryIsolated = await isolatesGlobalMemory(projectStore, conversation?.projectId);
        const memoryContext = memoryIsolated
          ? null
          : await loadMemoryContext(memoryStore, lastUserMessage.content, {
              maxResults: MEMORY_MAX_RESULTS,
              maxContextChars: MEMORY_MAX_CONTEXT_CHARS,
            });
        const messages: ChatMessage[] = [
          ...buildSystemMessages(memoryContext, {
            codeExplanation:
              result.projectContext !== null ||
              isCodeExplanationRequest(lastUserMessage.content),
            debuggingMode: result.debuggingMode,
            projectContext: result.projectContext !== null,
            projectKnowledge,
            fileEvidence,
          }),
          ...buildProjectAwareConversation(
            result.messages,
            result.projectContext,
          ),
        ];

        for await (const text of provider.streamChat({
          messages,
          signal: upstream.signal,
        })) {
          if (lifecycle.cancelled) {
            upstream.abort();
            break;
          }
          assistantText += text;
          send({ type: "delta", text });
        }

        if (lifecycle.cancelled || upstream.signal.aborted) {
          await settleAssistant("interrupted");
          return;
        }

        await settleAssistant("complete");
        send({ type: "done" });
      } catch (error) {
        if (isAbort(error) || upstream.signal.aborted || lifecycle.cancelled) {
          await settleAssistant("interrupted");
          return;
        }
        console.error(
          "[chat] generation failed:",
          error instanceof Error ? error.name : "unknown",
        );
        const publicError = toPublicError(error);
        await settleAssistant("failed", publicError);
        send({ type: "error", message: publicError });
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
      lifecycle.cancelled = true;
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
