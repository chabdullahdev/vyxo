"use client";

import { useState } from "react";
import type { ConversationSummary } from "@/lib/conversations/store";

type ListState = "loading" | "ready" | "failed";

export interface ProjectOption {
  id: string;
  name: string;
}

export interface ConversationRailProps {
  summaries: ConversationSummary[];
  listState: ListState;
  listError: string | null;
  actionError: string | null;
  query: string;
  filter: "active" | "archived";
  selectedId: string | null;
  projects: ProjectOption[];
  projectId: string | null;
  onQueryChange: (value: string) => void;
  onFilterChange: (filter: "active" | "archived") => void;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onProjectChange: (projectId: string | null) => void;
  onRename: (id: string, title: string) => void;
  onArchiveToggle: (id: string, archived: boolean) => void;
  onDelete: (id: string) => void;
  onRetry: () => void;
}

function formatConversationDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function ConversationRail({
  summaries,
  listState,
  listError,
  actionError,
  query,
  filter,
  selectedId,
  projects,
  projectId,
  onQueryChange,
  onFilterChange,
  onSelect,
  onNewChat,
  onProjectChange,
  onRename,
  onArchiveToggle,
  onDelete,
  onRetry,
}: ConversationRailProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const startRename = (id: string, title: string) => {
    setConfirmDeleteId(null);
    setRenamingId(id);
    setRenameValue(title);
  };

  const submitRename = () => {
    if (!renamingId) return;
    const title = renameValue.trim();
    if (title.length > 0) onRename(renamingId, title);
    setRenamingId(null);
    setRenameValue("");
  };

  return (
    <aside
      aria-label="Conversation history"
      className="flex min-h-0 max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] lg:h-full lg:max-h-none"
    >
      <div className="space-y-3 border-b border-[var(--line)] p-3">
        <button
          type="button"
          onClick={onNewChat}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--foreground)] px-3 py-2.5 text-sm font-medium text-[var(--background)] transition hover:bg-[var(--silver)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          New chat
        </button>
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search conversations…"
          aria-label="Search conversations"
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-deep)] px-3 py-2 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent-border)]"
        />
        <div
          role="group"
          aria-label="Conversation filter"
          className="inline-flex w-full rounded-lg border border-[var(--line)] p-1"
        >
          <button
            type="button"
            aria-pressed={filter === "active"}
            onClick={() => onFilterChange("active")}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              filter === "active"
                ? "bg-[var(--foreground)] text-[var(--background)]"
                : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            Active
          </button>
          <button
            type="button"
            aria-pressed={filter === "archived"}
            onClick={() => onFilterChange("archived")}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              filter === "archived"
                ? "bg-[var(--foreground)] text-[var(--background)]"
                : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            Archived
          </button>
        </div>
        <label className="block">
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">
            Project
          </span>
          <select
            value={projectId ?? ""}
            onChange={(event) => onProjectChange(event.target.value || null)}
            aria-label="Project for this conversation"
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-deep)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent-border)]"
          >
            <option value="">Unassigned</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {actionError ? (
          <p
            role="alert"
            className="mb-2 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 py-2 text-xs text-[var(--accent-text)]"
          >
            {actionError}
          </p>
        ) : null}

        {listState === "loading" ? (
          <div className="space-y-2 p-1" aria-hidden="true">
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                className="h-12 animate-pulse rounded-lg bg-[var(--surface-deep)]"
              />
            ))}
          </div>
        ) : null}

        {listState === "failed" ? (
          <div className="rounded-lg border border-[var(--line)] p-4 text-center">
            <p className="text-xs text-[var(--muted)]">
              {listError ?? "Conversations could not be loaded."}
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-hover)]"
            >
              Try again
            </button>
          </div>
        ) : null}

        {listState === "ready" && summaries.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-[var(--muted)]">
            {query.trim().length > 0
              ? `No conversations match “${query.trim()}”.`
              : filter === "archived"
                ? "No archived conversations."
                : "No conversations yet. Start a new chat."}
          </p>
        ) : null}

        {listState === "ready" && summaries.length > 0 ? (
          <ul className="space-y-1">
            {summaries.map((conversation) => {
              const isActive = conversation.id === selectedId;
              const isRenaming = renamingId === conversation.id;
              const isConfirming = confirmDeleteId === conversation.id;
              const title = conversation.title || "New conversation";

              return (
                <li key={conversation.id} className="group">
                  {isRenaming ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        submitRename();
                      }}
                      className="rounded-lg border border-[var(--line)] bg-[var(--surface-deep)] p-2"
                    >
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            setRenamingId(null);
                            setRenameValue("");
                          }
                        }}
                        maxLength={120}
                        aria-label="Conversation title"
                        className="w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-2 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent-border)]"
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingId(null);
                            setRenameValue("");
                          }}
                          className="rounded-md px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={renameValue.trim().length === 0}
                          className="rounded-md bg-[var(--foreground)] px-2 py-1 text-xs font-medium text-[var(--background)] disabled:opacity-40"
                        >
                          Save
                        </button>
                      </div>
                    </form>
                  ) : isConfirming ? (
                    <div className="rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/5 p-3">
                      <p className="text-xs text-[var(--foreground)]">
                        Delete this conversation? This cannot be undone. Saved
                        memories are not affected.
                      </p>
                      <div className="mt-2 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded-md px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onDelete(conversation.id);
                            setConfirmDeleteId(null);
                          }}
                          className="rounded-md bg-[var(--accent)] px-2 py-1 text-xs font-medium text-[var(--background)]"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onSelect(conversation.id)}
                        aria-current={isActive ? "true" : undefined}
                        className={`block w-full rounded-lg px-3 py-2 text-left transition ${
                          isActive
                            ? "bg-[var(--accent-soft)] shadow-[inset_0_0_0_1px_var(--accent-border)]"
                            : "hover:bg-[var(--surface-hover)]"
                        }`}
                      >
                        <span className="block truncate text-sm text-[var(--foreground)]">
                          {title}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-[var(--muted)]">
                          {formatConversationDate(conversation.updatedAt)}
                          {conversation.preview ? ` · ${conversation.preview}` : ""}
                        </span>
                      </button>
                      <div
                        className={`flex items-center gap-1 px-2 pb-1 transition ${
                          isActive
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => startRename(conversation.id, conversation.title)}
                          className="rounded px-1.5 py-0.5 text-[10px] text-[var(--muted)] hover:text-[var(--foreground)]"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => onArchiveToggle(conversation.id, !conversation.archived)}
                          className="rounded px-1.5 py-0.5 text-[10px] text-[var(--muted)] hover:text-[var(--foreground)]"
                        >
                          {conversation.archived ? "Restore" : "Archive"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(conversation.id)}
                          className="rounded px-1.5 py-0.5 text-[10px] text-[var(--muted)] hover:text-[var(--accent-text)]"
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </aside>
  );
}
