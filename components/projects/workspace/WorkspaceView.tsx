"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { WorkspaceChanges } from "@/components/projects/workspace/WorkspaceChanges";
import { WorkspaceChat } from "@/components/projects/workspace/WorkspaceChat";
import { WorkspaceFiles } from "@/components/projects/workspace/WorkspaceFiles";
import { WorkspaceGit } from "@/components/projects/workspace/WorkspaceGit";
import { WorkspacePreview } from "@/components/projects/workspace/WorkspacePreview";
import { postJson, requestJson, type WorkspaceInfo } from "@/components/projects/workspace/request";

type Tab = "chat" | "files" | "changes" | "preview" | "git";

const TABS: { id: Tab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "files", label: "Files" },
  { id: "changes", label: "Changes" },
  { id: "preview", label: "Preview" },
  { id: "git", label: "Git" },
];

/**
 * The page for one workspace project. Every tab stays mounted, so a chat that is
 * still answering keeps going when you look at another tab.
 */
/** A new project's description is turned into a first draft only once, even if the page renders twice. */
const draftsStarted = new Set<string>();

export function WorkspaceView({ projectId, brief = null }: { projectId: string; brief?: string | null }) {
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [tab, setTab] = useState<Tab>("chat");
  const [focusProposalId, setFocusProposalId] = useState<string | null>(null);
  const [changesRefresh, setChangesRefresh] = useState(0);
  const [filesRefresh, setFilesRefresh] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [template, setTemplate] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await requestJson<{ workspace: WorkspaceInfo }>(
        `/api/projects/${encodeURIComponent(projectId)}/workspace`,
      );
      if (!active) return;
      if (result.ok) {
        setInfo(result.data.workspace);
        setTemplate(result.data.workspace.template);
        setLoadError(null);
        setLoadState("ready");
      } else {
        setLoadError(result.error);
        setLoadState("failed");
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId, reloadToken]);

  const handleProposal = useCallback((proposalId: string) => {
    setFocusProposalId(proposalId);
    setChangesRefresh((value) => value + 1);
    setTab("changes");
  }, []);

  const handleFilesChanged = useCallback(async (change: "applied" | "undone") => {
    setFilesRefresh((value) => value + 1);
    const done = change === "applied" ? "Changes applied" : "Changes undone";
    if (template !== "website-nextjs") {
      setNotice(change === "applied" ? `${done}. You can undo them from the Changes tab.` : `${done}.`);
      return;
    }
    setNotice(`${done}. Building the site for the Preview…`);
    const built = await postJson<{ build: { status: string } }>(
      `/api/projects/${encodeURIComponent(projectId)}/workspace/build`,
      {},
    );
    setFilesRefresh((value) => value + 1);
    setNotice(
      built.ok && built.data.build.status === "ready"
        ? `${done}, and the site is built.`
        : `${done}, but the site did not build. The Preview tab shows why.`,
    );
  }, [projectId, template]);

  // Turn the description from the "New project" form into a first draft for review. Runs once per project.
  useEffect(() => {
    if (!brief || draftsStarted.has(projectId)) return;
    draftsStarted.add(projectId);
    window.history.replaceState(null, "", `/projects/${encodeURIComponent(projectId)}`);

    void (async () => {
      setDrafting(true);
      const request = `Build the whole site described below in this project. Replace the starter page as needed.\n\n${brief}`;
      const result = await postJson<{ proposal?: { id: string }; answer?: string }>(
        `/api/projects/${encodeURIComponent(projectId)}/proposals`,
        { request },
      );
      setDrafting(false);
      if (!result.ok) {
        setNotice(`The first draft could not be written. ${result.error}`);
        return;
      }
      if (result.data.proposal) {
        handleProposal(result.data.proposal.id);
        setNotice("Your first draft is ready to review. Nothing is saved until you apply it.");
      } else {
        setNotice(result.data.answer ?? "No draft was written. Try describing the site again in the Chat tab.");
      }
    })();
  }, [brief, handleProposal, projectId]);

  const copyPath = async () => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.folder);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setNotice(`Copy this path by hand: ${info.folder}`);
    }
  };

  const reveal = async () => {
    const result = await postJson<{ opened: boolean }>(
      `/api/projects/${encodeURIComponent(projectId)}/workspace/reveal`,
      {},
    );
    if (!result.ok) setNotice(result.error);
    else if (!result.data.opened) setNotice("Couldn't open the folder. You can copy its path instead.");
  };

  if (loadState === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted)]">Loading project…</div>
    );
  }

  if (loadState === "failed" || !info) {
    return (
      <div className="mx-auto mt-10 max-w-md rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 text-center">
        <p className="text-sm text-[var(--foreground)]">{loadError ?? "This project could not be opened."}</p>
        <div className="mt-4 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              setLoadState("loading");
              setReloadToken((value) => value + 1);
            }}
            className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-hover)]"
          >
            Try again
          </button>
          <Link
            href="/projects"
            className="rounded-lg px-4 py-2 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]"
          >
            Back to projects
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="mb-4 flex shrink-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link href="/projects" className="text-xs text-[var(--muted)] transition hover:text-[var(--foreground)]">
            ← All projects
          </Link>
          <h2 className="mt-1 truncate font-[family-name:var(--font-display)] text-2xl font-semibold tracking-[-0.03em] text-[var(--foreground)]">
            {info.name}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
            {info.templateLabel ? <span>{info.templateLabel}</span> : null}
            <span className="min-w-0 truncate font-mono" title={info.folder}>
              {info.folder}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void copyPath()}
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--foreground)] transition hover:bg-[var(--surface-hover)]"
          >
            {copied ? "Copied" : "Copy path"}
          </button>
          <button
            type="button"
            onClick={() => void reveal()}
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--foreground)] transition hover:bg-[var(--surface-hover)]"
          >
            Show in Finder
          </button>
          <a
            href={`/api/projects/${encodeURIComponent(projectId)}/workspace/export`}
            download
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--foreground)] transition hover:bg-[var(--surface-hover)]"
          >
            Export .zip
          </a>
        </div>
      </header>

      {!info.markerOk ? (
        <p role="alert" className="mb-3 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-4 py-2 text-xs text-[var(--accent-text)]">
          The project folder does not match this project any more, so changes are paused. Check the folder before editing.
        </p>
      ) : null}

      {drafting ? (
        <div role="status" className="mb-3 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 py-2 text-xs text-[var(--foreground)]">
          Writing your first draft. This can take a minute or two. Stay on this page, or come back to the Changes tab later.
        </div>
      ) : null}

      {notice ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] px-4 py-2 text-xs text-[var(--foreground)]">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-[var(--muted)] hover:text-[var(--foreground)]">
            Dismiss
          </button>
        </div>
      ) : null}

      <div role="tablist" aria-label="Project sections" className="mb-4 flex shrink-0 gap-1 border-b border-[var(--line)]">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`panel-${item.id}`}
            onClick={() => setTab(item.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
              tab === item.id
                ? "border-[var(--foreground)] font-medium text-[var(--foreground)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div id="panel-chat" role="tabpanel" aria-labelledby="tab-chat" hidden={tab !== "chat"} className="flex min-h-0 flex-1 flex-col">
        <WorkspaceChat projectId={projectId} onProposal={handleProposal} />
      </div>
      <div id="panel-files" role="tabpanel" aria-labelledby="tab-files" hidden={tab !== "files"} className="flex min-h-0 flex-1 flex-col">
        <WorkspaceFiles projectId={projectId} refreshKey={filesRefresh} />
      </div>
      <div id="panel-changes" role="tabpanel" aria-labelledby="tab-changes" hidden={tab !== "changes"} className="flex min-h-0 flex-1 flex-col">
        <WorkspaceChanges
          projectId={projectId}
          focusProposalId={focusProposalId}
          refreshKey={changesRefresh}
          onFilesChanged={handleFilesChanged}
        />
      </div>
      <div id="panel-preview" role="tabpanel" aria-labelledby="tab-preview" hidden={tab !== "preview"} className="flex min-h-0 flex-1 flex-col">
        <WorkspacePreview projectId={projectId} refreshKey={filesRefresh} />
      </div>
      <div id="panel-git" role="tabpanel" aria-labelledby="tab-git" hidden={tab !== "git"} className="flex min-h-0 flex-1 flex-col">
        <WorkspaceGit projectId={projectId} projectName={info.name} />
      </div>
    </div>
  );
}
