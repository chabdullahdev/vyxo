"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ProjectContextEditor } from "@/components/projects/ProjectContextEditor";
import { ProjectFilesPanel } from "@/components/projects/ProjectFilesPanel";
import { ProposalReviewPanel } from "@/components/projects/ProposalReviewPanel";
import { NewProjectCard, type NewProjectValues } from "@/components/projects/workspace/NewProjectCard";
import type { ConversationSummary } from "@/lib/conversations/store";
import type { Project } from "@/lib/projects/store";

interface ProjectWithCount extends Project {
  conversationCount: number;
}

type ListState = "loading" | "ready" | "failed";
type ConversationState = "idle" | "loading" | "ready" | "failed";

async function requestJson<T>(
  url: string,
  options?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, options);
    const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!response.ok) {
      return { ok: false, error: data?.error ?? `Request failed (status ${response.status}).` };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Is the app still running?" };
  }
}

export function ProjectsWorkspace() {
  const [projects, setProjects] = useState<ProjectWithCount[]>([]);
  const [listState, setListState] = useState<ListState>("loading");
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filter, setFilter] = useState<"active" | "archived">("active");
  const [refreshToken, setRefreshToken] = useState(0);

  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameDescription, setRenameDescription] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [alsoDeleteFiles, setAlsoDeleteFiles] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationState, setConversationState] = useState<ConversationState>("idle");
  const [conversationError, setConversationError] = useState<string | null>(null);

  const conversationRequestRef = useRef(0);

  const refreshList = useCallback(() => setRefreshToken((value) => value + 1), []);

  const handleProjectSaved = useCallback((updated: Project) => {
    setProjects((prev) =>
      prev.map((project) => (project.id === updated.id ? { ...project, ...updated } : project)),
    );
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    const trimmed = debouncedQuery.trim();
    if (trimmed.length > 0) params.set("q", trimmed);
    params.set("archived", filter);

    void (async () => {
      const result = await requestJson<{ projects: ProjectWithCount[] }>(
        `/api/projects?${params.toString()}`,
      );
      if (!active) return;
      if (result.ok) {
        setProjects(result.data.projects);
        setListError(null);
        setListState("ready");
      } else {
        setListError(result.error);
        setListState("failed");
      }
    })();

    return () => {
      active = false;
    };
  }, [debouncedQuery, filter, refreshToken]);

  const loadConversations = useCallback(async (projectId: string) => {
    const requestId = conversationRequestRef.current + 1;
    conversationRequestRef.current = requestId;
    setConversationState("loading");
    setConversationError(null);

    const result = await requestJson<{ conversations: ConversationSummary[] }>(
      `/api/conversations?projectId=${encodeURIComponent(projectId)}&archived=all`,
    );
    if (conversationRequestRef.current !== requestId) return;
    if (result.ok) {
      setConversations(result.data.conversations);
      setConversationState("ready");
    } else {
      setConversationError(result.error);
      setConversationState("failed");
    }
  }, []);

  const selectProject = useCallback(
    (projectId: string) => {
      setSelectedId(projectId);
      setConfirmDeleteId(null);
      void loadConversations(projectId);
    },
    [loadConversations],
  );

  const createProject = useCallback(
    async (values: NewProjectValues) => {
      if (creating) return;
      setCreating(true);
      setCreateError(null);
      setNotice(null);
      const result = await requestJson<{ project: Project }>("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      setCreating(false);
      if (!result.ok) {
        setCreateError(result.error);
        return;
      }
      // A new workspace opens straight away; a connected folder is set up from its list entry.
      if (values.kind === "managed") {
        const id = encodeURIComponent(result.data.project.id);
        const brief = values.brief.trim();
        router.push(brief ? `/projects/${id}?brief=${encodeURIComponent(brief)}` : `/projects/${id}`);
        return;
      }
      refreshList();
    },
    [creating, refreshList, router],
  );

  const startRename = (project: ProjectWithCount) => {
    setConfirmDeleteId(null);
    setRenamingId(project.id);
    setRenameName(project.name);
    setRenameDescription(project.description);
  };

  const saveRename = useCallback(async () => {
    if (!renamingId) return;
    const name = renameName.trim();
    if (name.length === 0 || savingEdit) return;
    setSavingEdit(true);
    setActionError(null);
    const result = await requestJson<{ project: Project }>(
      `/api/projects/${encodeURIComponent(renamingId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: renameDescription.trim() }),
      },
    );
    setSavingEdit(false);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    setRenamingId(null);
    refreshList();
  }, [refreshList, renameDescription, renameName, renamingId, savingEdit]);

  const toggleArchived = useCallback(
    async (project: ProjectWithCount) => {
      setActionError(null);
      const result = await requestJson<{ project: Project }>(
        `/api/projects/${encodeURIComponent(project.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived: !project.archived }),
        },
      );
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      refreshList();
    },
    [refreshList],
  );

  const deleteProject = useCallback(
    async (projectId: string, withFiles: boolean) => {
      setActionError(null);
      setNotice(null);
      const query = withFiles ? "?deleteFiles=true" : "";
      const result = await requestJson<{ deleted: true; filesNote?: string | null }>(
        `/api/projects/${encodeURIComponent(projectId)}${query}`,
        { method: "DELETE" },
      );
      setConfirmDeleteId(null);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      if (result.data.filesNote) setNotice(result.data.filesNote);
      if (selectedId === projectId) {
        setSelectedId(null);
        setConversations([]);
        setConversationState("idle");
      }
      refreshList();
    },
    [refreshList, selectedId],
  );

  const moveConversation = useCallback(
    async (conversationId: string, projectId: string | null) => {
      setActionError(null);
      const result = await requestJson<{ conversation: ConversationSummary }>(
        `/api/conversations/${encodeURIComponent(conversationId)}`,
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
      if (selectedId) {
        await loadConversations(selectedId);
      }
      refreshList();
    },
    [loadConversations, refreshList, selectedId],
  );

  return (
    <div className="space-y-5">
      <NewProjectCard creating={creating} error={createError} onCreate={(values) => void createProject(values)} />

      {notice ? (
        <p role="status" className="rounded-lg border border-[var(--line)] px-4 py-3 text-sm text-[var(--foreground)]">
          {notice}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search projects…"
          aria-label="Search projects"
          className="w-full max-w-xs rounded-lg border border-[var(--line)] bg-[var(--surface-deep)] px-3 py-2 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent-border)]"
        />
        <div role="group" aria-label="Project filter" className="inline-flex rounded-lg border border-[var(--line)] p-1">
          {(["active", "archived"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${
                filter === value ? "bg-[var(--foreground)] text-[var(--background)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      {actionError ? (
        <p role="alert" className="rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-4 py-3 text-sm text-[var(--accent-text)]">
          {actionError}
        </p>
      ) : null}

      {listState === "loading" ? (
        <div className="space-y-3" aria-hidden="true">
          {[0, 1].map((row) => (
            <div key={row} className="h-20 animate-pulse rounded-2xl bg-[var(--surface)]" />
          ))}
        </div>
      ) : null}

      {listState === "failed" ? (
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 text-center">
          <p className="text-sm text-[var(--muted)]">{listError ?? "Projects could not be loaded."}</p>
          <button
            type="button"
            onClick={refreshList}
            className="mt-3 rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-hover)]"
          >
            Try again
          </button>
        </div>
      ) : null}

      {listState === "ready" && projects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--line)] p-8 text-center">
          <p className="text-sm text-[var(--muted)]">
            {query.trim().length > 0
              ? `No projects match “${query.trim()}”.`
              : filter === "archived"
                ? "No archived projects."
                : "No projects yet. Create your first one above."}
          </p>
        </div>
      ) : null}

      {projects.length > 0 ? (
        <ul className="space-y-3">
          {projects.map((project) => {
            const isSelected = selectedId === project.id;
            const isRenaming = renamingId === project.id;
            const isConfirming = confirmDeleteId === project.id;

            return (
              <li key={project.id} className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
                {isRenaming ? (
                  <div className="space-y-3">
                    <input
                      value={renameName}
                      onChange={(event) => setRenameName(event.target.value)}
                      aria-label="Project name"
                      maxLength={120}
                      className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-deep)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent-border)]"
                    />
                    <textarea
                      value={renameDescription}
                      onChange={(event) => setRenameDescription(event.target.value)}
                      aria-label="Project description"
                      rows={2}
                      maxLength={2000}
                      className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--surface-deep)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent-border)]"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setRenamingId(null)}
                        className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--muted)] transition hover:text-[var(--foreground)]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveRename()}
                        disabled={renameName.trim().length === 0 || savingEdit}
                        className="rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-xs font-medium text-[var(--background)] disabled:opacity-40"
                      >
                        {savingEdit ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => selectProject(project.id)}
                          className="text-left"
                          aria-expanded={isSelected}
                        >
                          <span className="flex items-center gap-2 font-[family-name:var(--font-display)] text-base font-medium text-[var(--foreground)]">
                            {project.name}
                            <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
                              {project.kind === "managed" ? "Workspace" : "Folder"}
                            </span>
                            {project.archived ? (
                              <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
                                Archived
                              </span>
                            ) : null}
                          </span>
                        </button>
                        {project.description ? (
                          <p className="mt-1 max-w-xl text-sm text-[var(--muted)]">{project.description}</p>
                        ) : null}
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {project.conversationCount} conversation{project.conversationCount === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {project.kind === "managed" ? (
                          <Link
                            href={`/projects/${encodeURIComponent(project.id)}`}
                            className="rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-xs font-medium text-[var(--background)] transition hover:bg-[var(--silver)]"
                          >
                            Open workspace
                          </Link>
                        ) : (
                          <>
                            <Link
                              href={`/chat?project=${encodeURIComponent(project.id)}`}
                              className="rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-xs font-medium text-[var(--background)] transition hover:bg-[var(--silver)]"
                            >
                              New chat
                            </Link>
                            <button
                              type="button"
                              onClick={() => selectProject(project.id)}
                              className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-hover)]"
                            >
                              {isSelected ? "Viewing" : "Open"}
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => startRename(project)}
                          className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--muted)] transition hover:text-[var(--foreground)]"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggleArchived(project)}
                          className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--muted)] transition hover:text-[var(--foreground)]"
                        >
                          {project.archived ? "Restore" : "Archive"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAlsoDeleteFiles(false);
                            setConfirmDeleteId(project.id);
                          }}
                          className="rounded-lg border border-[var(--accent)]/40 px-3 py-1.5 text-xs text-[var(--accent-text)] transition hover:bg-[var(--accent)]/10"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {isConfirming ? (
                      <div className="mt-4 flex flex-col gap-3 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-2">
                          <p className="text-sm text-[var(--foreground)]">
                            Delete “{project.name}”? Its conversations are kept but become unassigned. Saved
                            memories are not affected.
                          </p>
                          {project.kind === "managed" ? (
                            <label className="flex items-center gap-2 text-xs text-[var(--foreground)]">
                              <input
                                type="checkbox"
                                checked={alsoDeleteFiles}
                                onChange={(event) => setAlsoDeleteFiles(event.target.checked)}
                              />
                              Also permanently delete this project&apos;s files from its folder
                            </label>
                          ) : null}
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteProject(project.id, project.kind === "managed" && alsoDeleteFiles)}
                            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--background)]"
                          >
                            Delete project
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {isSelected ? (
                      <div className="mt-4 border-t border-[var(--line)] pt-4">
                        <ProjectContextEditor
                          key={project.id}
                          project={project}
                          onSaved={handleProjectSaved}
                        />
                        {project.kind === "managed" ? (
                          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--line)] p-4">
                            <p className="text-sm text-[var(--muted)]">
                              Files, changes and the website preview for this project are on its workspace page.
                            </p>
                            <Link
                              href={`/projects/${encodeURIComponent(project.id)}`}
                              className="rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-xs font-medium text-[var(--background)] transition hover:bg-[var(--silver)]"
                            >
                              Open workspace
                            </Link>
                          </div>
                        ) : (
                          <>
                            <ProjectFilesPanel key={`files-${project.id}`} projectId={project.id} />
                            <ProposalReviewPanel key={`proposals-${project.id}`} projectId={project.id} />
                          </>
                        )}
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--muted)]">
                            Conversations in this project
                          </p>
                          <Link
                            href={`/chat?project=${encodeURIComponent(project.id)}`}
                            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-hover)]"
                          >
                            Start a chat in this project
                          </Link>
                        </div>
                        {conversationState === "loading" ? (
                          <p className="text-sm text-[var(--muted)]">Loading conversations…</p>
                        ) : conversationState === "failed" ? (
                          <div className="flex items-center gap-3">
                            <p className="text-sm text-[var(--accent-text)]">{conversationError}</p>
                            <button
                              type="button"
                              onClick={() => void loadConversations(project.id)}
                              className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--foreground)]"
                            >
                              Retry
                            </button>
                          </div>
                        ) : conversations.length === 0 ? (
                          <p className="text-sm text-[var(--muted)]">
                            No conversations in this project yet. Use “Start a chat in this project”.
                          </p>
                        ) : (
                          <ul className="space-y-2">
                            {conversations.map((conversation) => (
                              <li
                                key={conversation.id}
                                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--line)] px-3 py-2"
                              >
                                <span className="min-w-0 flex-1 truncate text-sm text-[var(--foreground)]">
                                  {conversation.title || "New conversation"}
                                </span>
                                <div className="flex items-center gap-2">
                                  <Link
                                    href={`/chat?conversation=${encodeURIComponent(conversation.id)}`}
                                    className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-hover)]"
                                  >
                                    Open
                                  </Link>
                                  <select
                                    aria-label={`Project for ${conversation.title || "conversation"}`}
                                    value={conversation.projectId ?? ""}
                                    onChange={(event) =>
                                      void moveConversation(conversation.id, event.target.value || null)
                                    }
                                    className="rounded-lg border border-[var(--line)] bg-[var(--surface-deep)] px-2 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--accent-border)]"
                                  >
                                    <option value="">Unassigned</option>
                                    {projects
                                      .filter((option) => !option.archived)
                                      .map((option) => (
                                        <option key={option.id} value={option.id}>
                                          {option.name}
                                        </option>
                                      ))}
                                  </select>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : null}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
