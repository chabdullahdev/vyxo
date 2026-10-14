"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ProjectExplorer } from "@/components/chat/ProjectExplorer";
import { splitFencedCode } from "@/lib/chat/content";
import { MAX_HISTORY_MESSAGES } from "@/lib/config";
import {
  readSelectedProjectFiles,
  type SelectedProjectFile,
} from "@/lib/project/browser";

export type ChatMessageStatus = "complete" | "interrupted" | "failed";

export interface ChatMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: ChatMessageStatus;
  error?: string;
}

interface StreamEvent {
  type: "delta" | "done" | "error" | "conversation" | "saved" | "notice";
  text?: string;
  message?: string;
  conversationId?: string;
  title?: string;
  status?: string;
}

interface ActiveProjectSelection {
  name: string;
  files: SelectedProjectFile[];
}

interface ChatViewProps {
  conversationId?: string | null;
  projectId?: string | null;
  initialMessages?: ChatMessageView[];
  onConversationChanged?: (conversationId: string) => void;
  onStreamSettled?: () => void;
}

let counter = 0;
const nextId = () => `${Date.now()}-${counter++}`;

const COMPOSER_MAX_PX = 200;

type CreateConversationResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

function createConversation(projectId: string | null): Promise<CreateConversationResult> {
  return fetch("/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(projectId ? { projectId } : {}),
  })
    .then(async (response) => {
      const data = (await response.json().catch(() => null)) as
        | { conversation?: { id?: unknown }; error?: string }
        | null;
      if (!response.ok) {
        return {
          ok: false as const,
          error: data?.error ?? "Could not start a saved conversation.",
        };
      }
      const id = data?.conversation?.id;
      if (typeof id !== "string" || id.length === 0) {
        return { ok: false as const, error: "The server did not return a conversation." };
      }
      return { ok: true as const, id };
    })
    .catch(() => ({
      ok: false as const,
      error: "Couldn't reach the server. Is the app still running?",
    }));
}

export function ChatView({
  conversationId = null,
  projectId = null,
  initialMessages = [],
  onConversationChanged,
  onStreamSettled,
}: ChatViewProps) {
  const [messages, setMessages] = useState<ChatMessageView[]>(() =>
    initialMessages.map((message) => ({ ...message })),
  );
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [debuggingMode, setDebuggingMode] = useState(false);
  const [projectSelection, setProjectSelection] =
    useState<ActiveProjectSelection | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const conversationIdRef = useRef<string | null>(conversationId);

  useEffect(() => {
    if (conversationId) conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, COMPOSER_MAX_PX)}px`;
    node.style.overflowY = node.scrollHeight > COMPOSER_MAX_PX ? "auto" : "hidden";
  }, [input]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const appendDelta = useCallback((text: string) => {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last && last.role === "assistant") {
        next[next.length - 1] = { ...last, content: last.content + text };
      }
      return next;
    });
  }, []);

  const settleAssistant = useCallback(
    (status: ChatMessageStatus, errorMessage?: string) => {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (!last || last.role !== "assistant") return next;
        if (last.content.trim().length === 0 && status !== "failed") {
          next.pop();
          return next;
        }
        next[next.length - 1] = {
          ...last,
          status,
          ...(errorMessage ? { error: errorMessage } : {}),
        };
        return next;
      });
    },
    [],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    settleAssistant("interrupted");
  }, [settleAssistant]);

  const handleProjectSelectionChange = useCallback(
    (projectName: string | null, files: SelectedProjectFile[]) => {
      setProjectSelection(
        projectName ? { name: projectName, files } : null,
      );
    },
    [],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setError(null);
    setNotice(null);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let activeConversationId = conversationIdRef.current;
      if (!activeConversationId) {
        const created = await createConversation(projectId);
        if (created.ok) {
          activeConversationId = created.id;
          conversationIdRef.current = created.id;
          onConversationChanged?.(created.id);
        } else if (projectId) {
          setError(created.error);
          return;
        } else {
          setNotice("History is unavailable, so this conversation will not be saved.");
        }
      }
      if (controller.signal.aborted) return;

      let projectFiles:
        | { path: string; content: string }[]
        | undefined;
      if (projectSelection && projectSelection.files.length > 0) {
        const readResult = await readSelectedProjectFiles(
          projectSelection.files,
        );
        if (!readResult.ok) throw new Error(readResult.error);
        projectFiles = readResult.files;
      }
      if (controller.signal.aborted) return;

      const userMessage: ChatMessageView = {
        id: nextId(),
        role: "user",
        content: text,
        status: "complete",
      };
      const history = [...messages, userMessage];
      setMessages([
        ...history,
        { id: nextId(), role: "assistant", content: "", status: "complete" },
      ]);
      setInput("");

      const outgoing = history.slice(-MAX_HISTORY_MESSAGES);

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: outgoing.map(({ role, content }) => ({ role, content })),
          debuggingMode,
          userMessageId: userMessage.id,
          ...(activeConversationId ? { conversationId: activeConversationId } : {}),
          ...(projectFiles ? { projectFiles } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(
          data?.error ?? `Request failed (status ${response.status}).`,
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");

        while (newline !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
          if (!line) continue;

          let event: StreamEvent;
          try {
            event = JSON.parse(line) as StreamEvent;
          } catch {
            continue;
          }

          if (event.type === "delta" && typeof event.text === "string") {
            appendDelta(event.text);
          } else if (event.type === "error") {
            setError(event.message ?? "Generation failed.");
            settleAssistant("failed", event.message);
          } else if (event.type === "done") {
            settleAssistant("complete");
          } else if (event.type === "conversation" && typeof event.conversationId === "string") {
            if (conversationIdRef.current !== event.conversationId) {
              conversationIdRef.current = event.conversationId;
              onConversationChanged?.(event.conversationId);
            }
          } else if (event.type === "notice" && typeof event.message === "string") {
            setNotice(event.message);
          }
        }
      }
    } catch (caught) {
      if (!controller.signal.aborted) {
        const message =
          caught instanceof Error
            ? caught.message
            : "Something went wrong. Please try again.";
        setError(message);
        settleAssistant("failed", message);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (!controller.signal.aborted) setIsStreaming(false);
      onStreamSettled?.();
    }
  }, [
    appendDelta,
    debuggingMode,
    input,
    isStreaming,
    messages,
    onConversationChanged,
    onStreamSettled,
    projectId,
    projectSelection,
    settleAssistant,
  ]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    void send();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] px-4 py-3">
        <div
          role="group"
          aria-label="Assistant mode"
          className="inline-flex rounded-lg border border-[var(--line)] p-1"
        >
          <button
            type="button"
            aria-pressed={!debuggingMode}
            disabled={isStreaming}
            onClick={() => setDebuggingMode(false)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
              debuggingMode
                ? "text-[var(--muted)] hover:text-[var(--foreground)]"
                : "bg-[var(--foreground)] text-[var(--background)]"
            }`}
          >
            Chat
          </button>
          <button
            type="button"
            aria-pressed={debuggingMode}
            disabled={isStreaming}
            onClick={() => setDebuggingMode(true)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
              debuggingMode
                ? "bg-[var(--foreground)] text-[var(--background)]"
                : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            Debug
          </button>
        </div>
        <p className="min-w-0 flex-1 text-xs text-[var(--muted)] sm:text-right">
          {debuggingMode
            ? "Read-only diagnosis and suggested fixes. Nothing is run or applied."
            : "Ordinary conversation with your local mentor."}
        </p>
      </div>

      <ProjectExplorer
        disabled={isStreaming}
        onSelectionChange={handleProjectSelectionChange}
      />

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-6 overflow-y-auto overflow-x-hidden p-6"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--foreground)]">
              Local chat is ready
            </p>
            <p className="mt-2 max-w-sm text-sm text-[var(--muted)]">
              This conversation is saved locally on this Mac. Nothing is sent
              to the cloud.
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={
                message.role === "user"
                  ? "ml-auto max-w-[85%] whitespace-pre-line [overflow-wrap:anywhere] rounded-2xl rounded-br-sm bg-[var(--foreground)] px-4 py-3 text-[var(--background)]"
                  : "mr-auto max-w-[85%] whitespace-pre-wrap [overflow-wrap:anywhere] rounded-2xl rounded-bl-sm border border-[var(--foreground)]/10 px-4 py-3 text-[var(--foreground)]"
              }
            >
              {message.role === "assistant" && message.status !== "complete" ? (
                <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">
                  {message.status === "interrupted"
                    ? "Interrupted · partial response"
                    : "Could not complete"}
                </p>
              ) : null}
              {message.content ? (
                message.role === "assistant" ? (
                  splitFencedCode(message.content).map((segment, index) =>
                    segment.type === "code" ? (
                      <pre
                        key={index}
                        className="my-2 max-w-full overflow-x-auto whitespace-pre rounded-lg border border-[var(--line)] bg-[var(--surface-deep)]/60 p-3 font-mono text-[12px] leading-5 text-[var(--foreground)] [overflow-wrap:normal]"
                      >
                        {segment.content}
                      </pre>
                    ) : (
                      <span key={index}>{segment.content}</span>
                    ),
                  )
                ) : (
                  message.content
                )
              ) : message.role === "assistant" && isStreaming ? (
                <span className="text-[var(--muted)]">Thinking…</span>
              ) : null}
            </div>
          ))
        )}
      </div>

      {notice ? (
        <div className="mx-6 mb-2 shrink-0 rounded-lg border border-[var(--line)] bg-[var(--surface-deep)]/60 px-4 py-3 text-sm text-[var(--muted)]">
          {notice}
        </div>
      ) : null}

      {error ? (
        <div className="mx-6 mb-2 shrink-0 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-4 py-3 text-sm text-[var(--accent)]">
          {error}
        </div>
      ) : null}

      <div className="shrink-0 border-t border-[var(--line)] bg-[var(--surface-deep)]/40 p-4">
        {isStreaming && projectSelection?.files.length ? (
          <p className="mb-2 text-xs text-[var(--muted)]">
            Reading {projectSelection.files.length} selected file
            {projectSelection.files.length === 1 ? "" : "s"} for this request…
          </p>
        ) : null}
        <div className="flex items-end gap-3">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={
              debuggingMode
                ? "Describe what should happen, what happens instead, or paste an error…"
                : "Type a message… (Enter to send, Shift+Enter for a new line)"
            }
            className="min-h-[2.75rem] max-h-[200px] flex-1 resize-none rounded-lg border border-[var(--foreground)]/15 bg-transparent px-4 py-3 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--foreground)]/40"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={stop}
              className="h-[2.75rem] rounded-lg border border-[var(--foreground)]/20 px-5 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--foreground)]/5"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send()}
              disabled={input.trim().length === 0}
              className="h-[2.75rem] rounded-lg bg-[var(--foreground)] px-5 text-sm font-medium text-[var(--background)] transition disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
