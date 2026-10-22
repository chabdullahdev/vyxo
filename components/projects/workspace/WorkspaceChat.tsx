"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChatView, type ProjectModeConfig } from "@/components/chat/ChatView";
import { toMessageViews } from "@/components/chat/ChatWorkspace";
import { requestJson } from "@/components/projects/workspace/request";
import type { Conversation, ConversationSummary } from "@/lib/conversations/store";

/**
 * The project's private chat. Ask answers questions; Build prepares file changes, which
 * appear in the Changes tab for review. Conversations here belong to this project only.
 */
export function WorkspaceChat({
  projectId,
  onProposal,
}: {
  projectId: string;
  onProposal: (proposalId: string) => void;
}) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Conversation | null>(null);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [viewKey, setViewKey] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await requestJson<{ conversations: ConversationSummary[] }>(
        `/api/conversations?projectId=${encodeURIComponent(projectId)}&archived=active`,
      );
      if (!active) return;
      if (result.ok) {
        setConversations(result.data.conversations);
        setListError(null);
      } else {
        setListError(result.error);
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId, refreshToken]);

  const projectMode = useMemo<ProjectModeConfig>(() => ({ projectId, onProposal }), [projectId, onProposal]);

  const startNewChat = useCallback(() => {
    setSelectedId(null);
    setDetail(null);
    setDetailState("idle");
    setDetailError(null);
    setViewKey((value) => value + 1);
  }, []);

  const openConversation = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setDetailState("loading");
    setDetailError(null);
    const result = await requestJson<{ conversation: Conversation }>(`/api/conversations/${encodeURIComponent(id)}`);
    if (result.ok) {
      setDetail(result.data.conversation);
      setDetailState("ready");
      setViewKey((value) => value + 1);
    } else {
      setDetailError(result.error);
      setDetailState("failed");
    }
  }, []);

  // When the first message of a new chat creates its conversation, keep the same view and just remember its id.
  const handleConversationChanged = useCallback((id: string) => {
    setSelectedId(id);
    setRefreshToken((value) => value + 1);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
        <label htmlFor="project-conversation" className="text-xs text-[var(--muted)]">
          Chat
        </label>
        <select
          id="project-conversation"
          value={selectedId ?? ""}
          onChange={(event) => {
            if (event.target.value) void openConversation(event.target.value);
            else startNewChat();
          }}
          className="min-w-0 max-w-xs flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface-deep)] px-3 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent-border)]"
        >
          <option value="">New chat</option>
          {selectedId && !conversations.some((item) => item.id === selectedId) ? (
            <option value={selectedId}>Current chat</option>
          ) : null}
          {conversations.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title || "New conversation"}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={startNewChat}
          className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--foreground)] transition hover:bg-[var(--surface-hover)]"
        >
          New chat
        </button>
        {listError ? <span className="text-xs text-[var(--accent-text)]">{listError}</span> : null}
      </div>

      {detailState === "loading" ? <p className="text-sm text-[var(--muted)]">Opening chat…</p> : null}
      {detailState === "failed" ? (
        <div className="mb-3 flex items-center gap-3">
          <p className="text-sm text-[var(--accent-text)]">{detailError}</p>
          <button
            type="button"
            onClick={() => selectedId && void openConversation(selectedId)}
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--foreground)]"
          >
            Try again
          </button>
        </div>
      ) : null}

      {detailState !== "loading" ? (
        <ChatView
          key={viewKey}
          conversationId={selectedId}
          projectId={projectId}
          projectMode={projectMode}
          initialMessages={detail ? toMessageViews(detail) : []}
          onConversationChanged={handleConversationChanged}
          onStreamSettled={() => setRefreshToken((value) => value + 1)}
        />
      ) : null}
    </div>
  );
}
