"use client";

import { useCallback, useEffect, useState } from "react";
import { postJson, requestJson } from "@/components/projects/workspace/request";

interface GitCommit {
  hash: string;
  subject: string;
  date: string;
}

interface GitStatus {
  repository: boolean;
  branch: string | null;
  changes: string[];
  changeCount: number;
  commits: GitCommit[];
  remote: string | null;
  identityReady: boolean;
}

const inputClass =
  "rounded-lg border border-[var(--line)] bg-[var(--surface-deep)] px-3 py-2 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent-border)]";
const buttonClass =
  "rounded-lg bg-[var(--foreground)] px-3 py-2 text-xs font-medium text-[var(--background)] transition hover:bg-[var(--silver)] disabled:cursor-not-allowed disabled:opacity-40";

function slugFor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

/** Git for this project: save snapshots on this Mac, then push them to GitHub when you choose. */
export function WorkspaceGit({ projectId, projectName }: { projectId: string; projectName: string }) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/workspace/git`;
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [authorName, setAuthorName] = useState("");
  const [authorEmail, setAuthorEmail] = useState("");
  const [snapshotText, setSnapshotText] = useState("");
  const [repoName, setRepoName] = useState(slugFor(projectName));
  const [address, setAddress] = useState("");

  const load = useCallback(async () => {
    const result = await requestJson<{ git: GitStatus }>(base);
    if (result.ok) {
      setStatus(result.data.git);
      setLoadError(null);
    } else {
      setLoadError(result.error);
    }
  }, [base]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await requestJson<{ git: GitStatus }>(base);
      if (!active) return;
      if (result.ok) {
        setStatus(result.data.git);
        setLoadError(null);
      } else {
        setLoadError(result.error);
      }
    })();
    return () => {
      active = false;
    };
  }, [base]);

  const run = async (body: Record<string, unknown>, done: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await postJson<{ git: GitStatus }>(base, body);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      await load();
      return;
    }
    setStatus(result.data.git);
    setMessage(done);
  };

  const identity = authorName.trim() && authorEmail.trim() ? { name: authorName.trim(), email: authorEmail.trim() } : null;

  if (loadError && !status) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-sm text-[var(--accent-text)]">{loadError}</p>
        <button type="button" onClick={() => void load()} className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--foreground)]">
          Try again
        </button>
      </div>
    );
  }
  if (!status) return <p className="text-sm text-[var(--muted)]">Loading Git…</p>;

  return (
    <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto lg:grid-cols-[1fr_1fr]">
      <section aria-label="Git setup and snapshots" className="space-y-4">
        {!status.repository ? (
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
            <h3 className="font-[family-name:var(--font-display)] text-base font-medium text-[var(--foreground)]">Track changes with Git</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
              Save snapshots of this project on your Mac, and share them on GitHub when you choose. Private files, keys, and build output are kept out.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <input aria-label="Your name for snapshots" value={authorName} onChange={(event) => setAuthorName(event.target.value)} placeholder="Your name" maxLength={100} className={inputClass} />
              <input aria-label="Your email for snapshots" value={authorEmail} onChange={(event) => setAuthorEmail(event.target.value)} placeholder="Your email" maxLength={200} className={inputClass} />
            </div>
            <button type="button" disabled={busy || !identity} onClick={() => void run({ action: "init", identity }, "Git is set up. The first snapshot is saved.")} className={`${buttonClass} mt-4`}>
              {busy ? "Setting up…" : "Set up Git"}
            </button>
          </div>
        ) : (
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
            <p className="text-xs text-[var(--muted)]">Branch {status.branch ?? "main"} · {status.changeCount} file{status.changeCount === 1 ? "" : "s"} changed</p>
            {!status.identityReady ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <input aria-label="Your name for snapshots" value={authorName} onChange={(event) => setAuthorName(event.target.value)} placeholder="Your name" maxLength={100} className={inputClass} />
                <input aria-label="Your email for snapshots" value={authorEmail} onChange={(event) => setAuthorEmail(event.target.value)} placeholder="Your email" maxLength={200} className={inputClass} />
                <button type="button" disabled={busy || !identity} onClick={() => void run({ action: "init", identity }, "Name and email saved.")} className={buttonClass}>
                  Save name and email
                </button>
              </div>
            ) : null}

            <h3 className="mt-5 text-sm font-medium text-[var(--foreground)]">Save a snapshot</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              <input aria-label="What changed" value={snapshotText} onChange={(event) => setSnapshotText(event.target.value)} placeholder="What changed? e.g. New menu prices" maxLength={120} className={`${inputClass} min-w-0 flex-1`} />
              <button type="button" disabled={busy || status.changeCount === 0 || !status.identityReady} onClick={() => void run({ action: "snapshot", message: snapshotText }, "Snapshot saved.").then(() => setSnapshotText(""))} className={buttonClass}>
                Save snapshot
              </button>
            </div>
            {status.changes.length > 0 ? (
              <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto font-mono text-xs text-[var(--muted)]">
                {status.changes.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-[var(--muted)]">Nothing has changed since the last snapshot.</p>
            )}
          </div>
        )}

        {error ? <p role="alert" className="rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 py-2 text-xs text-[var(--accent-text)]">{error}</p> : null}
        {message ? <p role="status" className="text-xs text-[var(--muted)]">{message}</p> : null}
      </section>

      <section aria-label="GitHub" className="space-y-4">
        {status.repository ? (
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
            <h3 className="font-[family-name:var(--font-display)] text-base font-medium text-[var(--foreground)]">GitHub</h3>
            {status.remote ? (
              <div className="mt-3 space-y-3">
                <p className="break-all font-mono text-xs text-[var(--muted)]">{status.remote}</p>
                <button type="button" disabled={busy || status.commits.length === 0} onClick={() => void run({ action: "push" }, "Pushed to GitHub.")} className={buttonClass}>
                  {busy ? "Pushing…" : "Push to GitHub"}
                </button>
                <p className="text-xs text-[var(--muted)]">Pushing sends the saved snapshots to this repository. Nothing is sent until you press this button.</p>
              </div>
            ) : (
              <div className="mt-3 space-y-5">
                <div>
                  <p className="text-sm text-[var(--foreground)]">Create a private repository on GitHub</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">Uses the GitHub sign-in on this Mac (gh auth login).</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input aria-label="Repository name" value={repoName} onChange={(event) => setRepoName(slugFor(event.target.value))} maxLength={80} className={`${inputClass} min-w-0 flex-1`} />
                    <button type="button" disabled={busy || repoName.length === 0} onClick={() => void run({ action: "create-github", name: repoName }, "Repository created and connected.")} className={buttonClass}>
                      Create
                    </button>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-[var(--foreground)]">Or connect a repository you already have</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input aria-label="Repository address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="https://github.com/you/your-repo.git" maxLength={300} className={`${inputClass} min-w-0 flex-1`} />
                    <button type="button" disabled={busy || address.trim().length === 0} onClick={() => void run({ action: "set-remote", url: address }, "Repository connected.")} className={buttonClass}>
                      Connect
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {status.commits.length > 0 ? (
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
            <h3 className="text-sm font-medium text-[var(--foreground)]">History</h3>
            <ul className="mt-3 space-y-2">
              {status.commits.map((commit) => (
                <li key={commit.hash} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="text-[var(--foreground)]">{commit.subject}</span>
                  <span className="font-mono text-xs text-[var(--muted)]">{commit.hash} · {new Date(commit.date).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
