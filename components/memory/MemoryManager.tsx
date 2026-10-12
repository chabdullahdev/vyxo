"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Memory {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

type LoadState = "loading" | "ready" | "failed";

async function requestJson<T>(
  url: string,
  options?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, options);
    const data = (await response.json().catch(() => null)) as
      | (T & { error?: string })
      | null;

    if (!response.ok) {
      return {
        ok: false,
        error: data?.error ?? `Request failed (status ${response.status}).`,
      };
    }
    return { ok: true, data: data as T };
  } catch {
    return {
      ok: false,
      error: "Couldn't reach the server. Is the app still running?",
    };
  }
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function MemoryManager() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [newContent, setNewContent] = useState("");
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 3000);
  }, []);

  const applyResult = useCallback(
    (
      result:
        | { ok: true; data: { memories: Memory[] } }
        | { ok: false; error: string },
    ) => {
      if (!result.ok) {
        setError(result.error);
        setLoadState("failed");
        return;
      }
      setMemories(result.data.memories);
      setError(null);
      setLoadState("ready");
    },
    [],
  );

  const reload = useCallback(() => {
    setLoadState("loading");
    void requestJson<{ memories: Memory[] }>("/api/memories").then(applyResult);
  }, [applyResult]);

  useEffect(() => {
    let active = true;
    requestJson<{ memories: Memory[] }>("/api/memories").then((result) => {
      if (active) applyResult(result);
    });
    return () => {
      active = false;
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, [applyResult]);

  const create = useCallback(async () => {
    const content = newContent.trim();
    if (!content || creating) return;

    setCreating(true);
    setError(null);
    const result = await requestJson<{ memory: Memory }>("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    setCreating(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMemories((prev) => [result.data.memory, ...prev]);
    setNewContent("");
    flashNotice("Memory added.");
  }, [creating, flashNotice, newContent]);

  const saveEdit = useCallback(
    async (id: string) => {
      const content = editContent.trim();
      if (!content || saving) return;

      setSaving(true);
      setBusyId(id);
      setError(null);
      const result = await requestJson<{ memory: Memory }>(
        `/api/memories/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        },
      );
      setSaving(false);
      setBusyId(null);

      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMemories((prev) =>
        prev.map((memory) => (memory.id === id ? result.data.memory : memory)),
      );
      setEditingId(null);
      setEditContent("");
      flashNotice("Memory updated.");
    },
    [editContent, flashNotice, saving],
  );

  const remove = useCallback(
    async (id: string) => {
      setBusyId(id);
      setError(null);
      const result = await requestJson<{ deleted: true }>(
        `/api/memories/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      setBusyId(null);
      setConfirmDeleteId(null);

      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMemories((prev) => prev.filter((memory) => memory.id !== id));
      flashNotice("Memory deleted.");
    },
    [flashNotice],
  );

  const startEdit = (memory: Memory) => {
    setEditingId(memory.id);
    setEditContent(memory.content);
    setConfirmDeleteId(null);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[var(--foreground)]/10 p-5">
        <label
          htmlFor="new-memory"
          className="mb-2 block text-sm font-medium text-[var(--foreground)]"
        >
          Add a memory
        </label>
        <textarea
          id="new-memory"
          value={newContent}
          onChange={(event) => setNewContent(event.target.value)}
          rows={3}
          placeholder="Something you want your assistant to remember…"
          className="w-full resize-y rounded-lg border border-[var(--foreground)]/15 bg-transparent px-4 py-3 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--foreground)]/40"
        />
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => void create()}
            disabled={newContent.trim().length === 0 || creating}
            className="rounded-lg bg-[var(--foreground)] px-5 py-2.5 text-sm font-medium text-[var(--background)] transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            {creating ? "Adding…" : "Add memory"}
          </button>
        </div>
      </section>

      <div aria-live="polite" className="space-y-3">
        {error ? (
          <div className="flex items-start justify-between gap-4 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-4 py-3 text-sm text-[var(--accent)]">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="shrink-0 font-medium underline"
            >
              Dismiss
            </button>
          </div>
        ) : null}
        {notice ? (
          <div className="rounded-lg border border-[var(--foreground)]/15 bg-[var(--foreground)]/5 px-4 py-3 text-sm text-[var(--foreground)]">
            {notice}
          </div>
        ) : null}
      </div>

      {loadState === "loading" ? (
        <p className="py-8 text-center text-sm text-[var(--muted)]">
          Loading memories…
        </p>
      ) : null}

      {loadState === "failed" ? (
        <div className="rounded-xl border border-[var(--foreground)]/10 p-6 text-center">
          <p className="text-sm text-[var(--muted)]">
            Memories could not be loaded.
          </p>
          <button
            type="button"
            onClick={() => reload()}
            className="mt-3 rounded-lg border border-[var(--foreground)]/20 px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--foreground)]/5"
          >
            Try again
          </button>
        </div>
      ) : null}

      {loadState === "ready" && memories.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--foreground)]/15 p-8 text-center">
          <p className="text-sm text-[var(--muted)]">
            No memories yet. Add your first one above.
          </p>
        </div>
      ) : null}

      {memories.length > 0 ? (
        <ul className="space-y-3">
          {memories.map((memory) => {
            const isEditing = editingId === memory.id;
            const isConfirming = confirmDeleteId === memory.id;
            const isBusy = busyId === memory.id;

            return (
              <li
                key={memory.id}
                className="rounded-xl border border-[var(--foreground)]/10 p-5"
              >
                {isEditing ? (
                  <div>
                    <textarea
                      value={editContent}
                      onChange={(event) => setEditContent(event.target.value)}
                      rows={3}
                      className="w-full resize-y rounded-lg border border-[var(--foreground)]/15 bg-transparent px-4 py-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--foreground)]/40"
                    />
                    <div className="mt-3 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(null);
                          setEditContent("");
                        }}
                        className="rounded-lg border border-[var(--foreground)]/20 px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--foreground)]/5"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveEdit(memory.id)}
                        disabled={editContent.trim().length === 0 || saving}
                        className="rounded-lg bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--background)] transition disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {saving ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap text-sm text-[var(--foreground)]">
                      {memory.content}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="text-xs text-[var(--muted)]">
                        <span>Created {formatTimestamp(memory.createdAt)}</span>
                        {memory.updatedAt !== memory.createdAt ? (
                          <span> · Updated {formatTimestamp(memory.updatedAt)}</span>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(memory)}
                          disabled={isBusy}
                          className="rounded-lg border border-[var(--foreground)]/20 px-3 py-1.5 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--foreground)]/5 disabled:opacity-40"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(memory.id)}
                          disabled={isBusy}
                          className="rounded-lg border border-[var(--accent)]/40 px-3 py-1.5 text-sm font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/10 disabled:opacity-40"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {isConfirming ? (
                  <div className="mt-4 flex flex-col gap-3 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-[var(--foreground)]">
                      Delete this memory? This can&apos;t be undone.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        disabled={isBusy}
                        className="rounded-lg border border-[var(--foreground)]/20 px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--foreground)]/5 disabled:opacity-40"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(memory.id)}
                        disabled={isBusy}
                        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition disabled:opacity-40"
                      >
                        {isBusy ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
