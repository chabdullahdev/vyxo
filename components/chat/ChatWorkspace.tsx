"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatView, type ChatMessageView } from "@/components/chat/ChatView";
import { ConversationRail } from "@/components/chat/ConversationRail";
import { chooseInitialConversation } from "@/lib/conversations/selection";
import type { Conversation, ConversationSummary } from "@/lib/conversations/store";
import type { Project } from "@/lib/projects/store";

type ListState = "loading" | "ready" | "failed";
type DetailState = "idle" | "loading" | "ready" | "failed";

interface ChatWorkspaceProps {
  initialConversationId?: string | null;
  initialProjectId?: string | null;
}

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
    return { ok: false, error: "Couldn't reach the server. Is the app still running?" };
  }
}

export function toMessageViews(conversation: Conversation): ChatMessageView[] {
  return conversation.messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    status: message.status,
    ...(message.error ? { error: message.error } : {}),
  }));
}

export function ChatWorkspace({
  initialConversationId = null,
  initialProjectId = null,
}: ChatWorkspaceProps) {
  const [summaries, setSummaries] = useState<ConversationSummary[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(initialProjectId);
  const [listState, setListState] = useState<ListState>("loading");
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filter, setFilter] = useState<"active" | "archived">("active");
  const [refreshToken, setRefreshToken] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewKey, setViewKey] = useState(0);
  const [detail, setDetail] = useState<Conversation | null>(null);
  const [detailState, setDetailState] = useState<DetailState>("idle");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false);

  const detailRequestRef = useRef(0);
  const didInitialSelectRef = useRef(false);

  const refreshList = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await requestJson<{ projects: Project[] }>("/api/projects?archived=active");
      if (!active || !result.ok) return;
      setProjects(result.data.projects);
    })();
    return () => {
      active = false;
    };
  }, []);

  const selectConversation = useCallback(async (id: string) => {
    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;
    setViewKey((value) => value + 1);
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
    setDetailState("loading");
    setRailOpen(false);

    const result = await requestJson<{ conversation: Conversation }>(
      `/api/conversations/${encodeURIComponent(id)}`,
    );
    if (detailRequestRef.current !== requestId) return;

    if (result.ok) {
      setDetail(result.data.conversation);
      setActiveProjectId(result.data.conversation.projectId);
      setDetailState("ready");
    } else {
      setDetailError(result.error);
      setDetailState("failed");
    }
  }, []);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    const trimmed = debouncedQuery.trim();
    if (trimmed.length > 0) params.set("q", trimmed);
    params.set("archived", filter);

    void (async () => {
      const result = await requestJson<{ conversations: ConversationSummary[] }>(
        `/api/conversations?${params.toString()}`,
      );
      if (!active) return;
      if (result.ok) {
        setSummaries(result.data.conversations);
        setListError(null);
        setListState("ready");
        if (!didInitialSelectRef.current) {
          didInitialSelectRef.current = true;
          const selection = chooseInitialConversation({
            initialConversationId,
            initialProjectId,
            conversations: result.data.conversations,
          });
          if (selection.kind === "open") {
            void selectConversation(selection.id);
          }
        }
      } else {
        setListError(result.error);
        setListState("failed");
      }
    })();

    return () => {
      active = false;
    };
  }, [debouncedQuery, filter, initialConversationId, initialProjectId, refreshToken, selectConversation]);

  const handleConversationChanged = useCallback(
    (id: string) => {
      setSelectedId(id);
      refreshList();
    },
    [refreshList],
  );

  const handleStreamSettled = useCallback(() => {
    refreshList();
  }, [refreshList]);

  const startNewChat = useCallback(() => {
    detailRequestRef.current += 1;
    setViewKey((value) => value + 1);
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
    setDetailState("idle");
    setActionError(null);
    setRailOpen(false);
  }, []);

  const renameConversation = useCallback(async (id: string, title: string) => {
    const result = await requestJson<{ conversation: Conversation }>(
      `/api/conversations/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      },
    );
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    setActionError(null);
    const updated = result.data.conversation;
    setSummaries((prev) =>
      prev.map((item) => (item.id === id ? { ...item, title: updated.title } : item)),
    );
    setDetail((prev) => (prev && prev.id === id ? { ...prev, title: updated.title } : prev));
  }, []);

  const setConversationArchived = useCallback(
    async (id: string, archived: boolean) => {
      const result = await requestJson<{ conversation: Conversation }>(
        `/api/conversations/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived }),
        },
      );
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      setActionError(null);
      refreshList();
    },
    [refreshList],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      const result = await requestJson<{ deleted: true }>(
        `/api/conversations/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      setActionError(null);
      setSummaries((prev) => prev.filter((item) => item.id !== id));
      if (selectedId === id) startNewChat();
    },
    [selectedId, startNewChat],
  );

  const changeProject = useCallback(
    async (projectId: string | null) => {
      if (!detail || !selectedId) {
        setActiveProjectId(projectId);
        return;
      }
      setActionError(null);
      const result = await requestJson<{ conversation: Conversation }>(
        `/api/conversations/${encodeURIComponent(selectedId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId }),
        },
      );
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      setDetail(result.data.conversation);
      setActiveProjectId(projectId);
      refreshList();
    },
    [detail, refreshList, selectedId],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 lg:flex-row">
      <div
        className={`${railOpen ? "block" : "hidden"} min-h-0 lg:block lg:w-[290px] lg:shrink-0`}
      >
        <ConversationRail
          summaries={summaries}
          listState={listState}
          listError={listError}
          actionError={actionError}
          query={query}
          filter={filter}
          selectedId={selectedId}
          projects={projects.map((project) => ({ id: project.id, name: project.name }))}
          projectId={activeProjectId}
          onQueryChange={setQuery}
          onFilterChange={setFilter}
          onSelect={(id) => void selectConversation(id)}
          onNewChat={startNewChat}
          onProjectChange={(id) => void changeProject(id)}
          onRename={(id, title) => void renameConversation(id, title)}
          onArchiveToggle={(id, archived) => void setConversationArchived(id, archived)}
          onDelete={(id) => void deleteConversation(id)}
          onRetry={refreshList}
        />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="mb-3 flex shrink-0 items-center justify-between gap-3 lg:hidden">
          <button
            type="button"
            onClick={() => setRailOpen((value) => !value)}
            aria-expanded={railOpen}
            className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-hover)]"
          >
            {railOpen ? "Hide history" : "History"}
          </button>
          <button
            type="button"
            onClick={startNewChat}
            className="rounded-lg bg-[var(--foreground)] px-3 py-2 text-xs font-medium text-[var(--background)] transition hover:bg-[var(--silver)]"
          >
            New chat
          </button>
        </div>

        {detailState === "loading" ? (
          <div
            aria-hidden="true"
            className="min-h-0 flex-1 space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6"
          >
            <div className="h-10 w-1/3 animate-pulse rounded-lg bg-[var(--surface-deep)]" />
            <div className="h-16 w-2/3 animate-pulse rounded-2xl bg-[var(--surface-deep)]" />
            <div className="ml-auto h-16 w-2/3 animate-pulse rounded-2xl bg-[var(--surface-deep)]" />
          </div>
        ) : null}

        {detailState === "failed" ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 text-center">
            <p className="text-sm text-[var(--muted)]">
              {detailError ?? "This conversation could not be opened."}
            </p>
            <button
              type="button"
              onClick={() => {
                if (selectedId) void selectConversation(selectedId);
              }}
              className="mt-4 rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-hover)]"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={startNewChat}
              className="mt-2 text-xs text-[var(--muted)] underline underline-offset-2 hover:text-[var(--foreground)]"
            >
              Start a new chat
            </button>
          </div>
        ) : null}

        {detailState === "idle" || detailState === "ready" ? (
          <ChatView
            key={viewKey}
            conversationId={selectedId}
            projectId={activeProjectId}
            initialMessages={detail ? toMessageViews(detail) : []}
            onConversationChanged={handleConversationChanged}
            onStreamSettled={handleStreamSettled}
          />
        ) : null}
      </div>
    </div>
  );
}
