"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface StreamEvent {
  type: "delta" | "done" | "error";
  text?: string;
  message?: string;
}

let counter = 0;
const nextId = () => `${Date.now()}-${counter++}`;

export function ChatView() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages]);

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

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setError(null);
    const userMessage: Message = { id: nextId(), role: "user", content: text };
    const history = [...messages, userMessage];

    setMessages([
      ...history,
      { id: nextId(), role: "assistant", content: "" },
    ]);
    setInput("");
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
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
          }
        }
      }
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Something went wrong. Please try again.",
        );
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (!controller.signal.aborted) setIsStreaming(false);
    }
  }, [appendDelta, input, isStreaming, messages]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col rounded-xl border border-[var(--foreground)]/10 bg-[var(--background)]">
      <div ref={scrollRef} className="flex-1 space-y-6 overflow-y-auto p-6">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--foreground)]">
              Local chat is ready
            </p>
            <p className="mt-2 max-w-sm text-sm text-[var(--muted)]">
              Messages stay in this browser tab only and are sent to your local
              model. Nothing is saved or sent to the cloud.
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={
                message.role === "user"
                  ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--foreground)] px-4 py-3 text-[var(--background)]"
                  : "mr-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-[var(--foreground)]/10 px-4 py-3 text-[var(--foreground)]"
              }
            >
              {message.content ||
                (message.role === "assistant" && isStreaming ? (
                  <span className="text-[var(--muted)]">Thinking…</span>
                ) : null)}
            </div>
          ))
        )}
      </div>

      {error ? (
        <div className="mx-6 mb-2 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-4 py-3 text-sm text-[var(--accent)]">
          {error}
        </div>
      ) : null}

      <div className="border-t border-[var(--foreground)]/10 p-4">
        <div className="flex items-end gap-3">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="Type a message… (Enter to send, Shift+Enter for a new line)"
            className="max-h-40 min-h-[2.75rem] flex-1 resize-none rounded-lg border border-[var(--foreground)]/15 bg-transparent px-4 py-3 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--foreground)]/40"
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
