"use client";

import { useCallback, useEffect, useState } from "react";
import { requestJson, postJson } from "@/components/projects/workspace/request";
import type { EditProposal, ProposalStatus } from "@/lib/edits/types";

interface ProposalSummaryEntry {
  id: string;
  summary: string;
  status: ProposalStatus;
  fileCount: number;
  createdAt: string;
  error?: string | null;
}

/** The edit engine marks an undone change as "failed" with this message. */
const UNDONE_MESSAGE = "Rolled back by the user.";

function statusLabel(proposal: { status: ProposalStatus; error?: string | null }): string {
  if (proposal.status === "failed" && proposal.error === UNDONE_MESSAGE) return "Undone";
  if (proposal.status === "failed") return "Not applied";
  return STATUS_LABELS[proposal.status];
}

const STATUS_LABELS: Record<ProposalStatus, string> = {
  ready_for_review: "Waiting for you",
  approved: "Ready to apply",
  applying: "Applying…",
  applied: "Applied",
  rejected: "Not applied",
  cancelled: "Cancelled",
  stale: "Out of date",
  failed: "Failed",
  recovery_required: "Needs recovery",
};

interface ApplyResultEntry {
  path: string;
  status: "applied" | "failed" | "skipped";
  message?: string;
}

/**
 * Proposed file changes from Build mode. Nothing is written until "Apply changes".
 * Applied changes can be undone from here.
 */
export function WorkspaceChanges({
  projectId,
  focusProposalId,
  refreshKey,
  onFilesChanged,
}: {
  projectId: string;
  focusProposalId: string | null;
  refreshKey: number;
  onFilesChanged: (change: "applied" | "undone") => void;
}) {
  const [proposals, setProposals] = useState<ProposalSummaryEntry[]>([]);
  const [listState, setListState] = useState<"loading" | "ready" | "failed">("loading");
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<EditProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const base = `/api/projects/${encodeURIComponent(projectId)}`;

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await requestJson<{ proposals: ProposalSummaryEntry[] }>(`${base}/proposals`);
      if (!active) return;
      if (result.ok) {
        setProposals(result.data.proposals);
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
  }, [base, refreshKey, refreshToken]);

  const openProposal = useCallback(
    async (id: string) => {
      setSelectedId(id);
      setError(null);
      setMessage(null);
      const result = await requestJson<{ proposal: EditProposal }>(`${base}/proposals/${encodeURIComponent(id)}`);
      if (result.ok) setSelected(result.data.proposal);
      else setError(result.error);
    },
    [base],
  );

  // Open the change that Build just prepared, once the list has loaded it.
  useEffect(() => {
    if (!focusProposalId) return;
    let active = true;
    void (async () => {
      const result = await requestJson<{ proposal: EditProposal }>(
        `${base}/proposals/${encodeURIComponent(focusProposalId)}`,
      );
      if (!active) return;
      if (result.ok) {
        setSelectedId(focusProposalId);
        setSelected(result.data.proposal);
        setError(null);
        setMessage(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [base, focusProposalId, refreshKey]);

  const refreshAfterChange = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  const applyChanges = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    let current = selected;

    if (current.status === "ready_for_review") {
      const approved = await postJson<{ proposal: EditProposal }>(`${base}/proposals/${encodeURIComponent(current.id)}/approve`, {});
      if (!approved.ok) {
        setBusy(false);
        setError(approved.error);
        return;
      }
      current = approved.data.proposal;
    }

    const applied = await postJson<{ proposal: EditProposal; results: ApplyResultEntry[] }>(
      `${base}/proposals/${encodeURIComponent(current.id)}/apply`,
      {},
    );
    setBusy(false);
    if (!applied.ok) {
      setError(applied.error);
      setSelected(current);
      refreshAfterChange();
      return;
    }
    setSelected(applied.data.proposal);
    const results = applied.data.results ?? [];
    const failed = results.filter((entry) => entry.status !== "applied");
    if (failed.length > 0) {
      setError(`Some files were not changed: ${failed.map((entry) => `${entry.path}${entry.message ? ` (${entry.message})` : ""}`).join(", ")}.`);
    } else {
      setMessage(`Applied ${results.length} file change${results.length === 1 ? "" : "s"}.`);
    }
    onFilesChanged("applied");
    refreshAfterChange();
  };

  const notForNow = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    const result = await requestJson<{ deleted?: boolean }>(`${base}/proposals/${encodeURIComponent(selected.id)}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSelected(null);
    setSelectedId(null);
    setMessage("Changes set aside. No files were changed.");
    refreshAfterChange();
  };

  const undo = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await postJson<{ restored: number; conflicts: string[] }>(`${base}/recovery`, {
      proposalId: selected.id,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.data.conflicts.length > 0) {
      setError(`Some files changed since they were applied, so they were left alone: ${result.data.conflicts.join(", ")}.`);
    } else {
      setMessage(`Undone. ${result.data.restored} file${result.data.restored === 1 ? "" : "s"} put back the way they were.`);
    }
    onFilesChanged("undone");
    // Show the change as it now is on the server (the undo button goes away).
    const refreshed = await requestJson<{ proposal: EditProposal }>(`${base}/proposals/${encodeURIComponent(selected.id)}`);
    if (refreshed.ok) setSelected(refreshed.data.proposal);
    refreshAfterChange();
  };

  return (
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[260px_1fr]">
      <section aria-label="Change list" className="min-h-0 space-y-2 overflow-y-auto">
        {listState === "loading" ? <p className="text-sm text-[var(--muted)]">Loading changes…</p> : null}
        {listState === "failed" ? (
          <div className="space-y-2">
            <p className="text-sm text-[var(--accent-text)]">{listError}</p>
            <button
              type="button"
              onClick={refreshAfterChange}
              className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--foreground)]"
            >
              Try again
            </button>
          </div>
        ) : null}
        {listState === "ready" && proposals.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
            No changes yet. Switch to Build in the Chat tab and ask for a change. It will appear here for you to review.
          </p>
        ) : null}
        {proposals.map((proposal) => (
          <button
            key={proposal.id}
            type="button"
            onClick={() => void openProposal(proposal.id)}
            aria-current={selectedId === proposal.id ? "true" : undefined}
            className={`block w-full rounded-xl border p-3 text-left transition ${
              selectedId === proposal.id
                ? "border-[var(--accent-border)] bg-[var(--accent-soft)]"
                : "border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--surface-hover)]"
            }`}
          >
            <span className="block truncate text-sm text-[var(--foreground)]">{proposal.summary}</span>
            <span className="mt-1 block text-xs text-[var(--muted)]">
              {statusLabel(proposal)} · {proposal.fileCount} file{proposal.fileCount === 1 ? "" : "s"}
            </span>
          </button>
        ))}
      </section>

      <section aria-label="Change details" className="min-h-0 overflow-y-auto">
        {!selected ? (
          <p className="text-sm text-[var(--muted)]">Pick a change on the left to see what it does.</p>
        ) : (
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
            <p className="text-xs text-[var(--muted)]">{statusLabel(selected)}</p>
            <h3 className="mt-1 font-[family-name:var(--font-display)] text-base font-medium text-[var(--foreground)]">
              {selected.summary}
            </h3>

            {selected.error ? (
              <p role="alert" className="mt-2 text-xs text-[var(--accent-text)]">
                {selected.error}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="mt-3 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 py-2 text-xs text-[var(--accent-text)]">
                {error}
              </p>
            ) : null}
            {message ? (
              <p role="status" className="mt-3 rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--foreground)]">
                {message}
              </p>
            ) : null}

            <ul className="mt-4 space-y-2">
              {selected.operations.map((operation) => (
                <li key={`${operation.op}:${operation.path}`} className="rounded-lg border border-[var(--line)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-[var(--foreground)]">
                      <span className="uppercase text-[var(--muted)]">{operation.op}</span> {operation.path}
                    </span>
                    {operation.diff ? (
                      <span className="text-[var(--muted)]">
                        +{operation.diff.added} / −{operation.diff.removed}
                      </span>
                    ) : null}
                  </div>
                  {operation.diff ? (
                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre rounded-md bg-[var(--background)] p-2 font-mono text-[11px] leading-5">
                      {operation.diff.lines.map((line, index) => (
                        <div
                          key={index}
                          className={
                            line.type === "added"
                              ? "text-[var(--accent-text)]"
                              : line.type === "removed"
                                ? "text-[var(--muted)]"
                                : "text-[var(--foreground)]/70"
                          }
                        >
                          {line.type === "added" ? "+ " : line.type === "removed" ? "- " : "  "}
                          {line.text}
                        </div>
                      ))}
                      {operation.diff.truncated ? <div className="text-[var(--muted)]">… diff truncated</div> : null}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ul>

            <div className="mt-4 flex flex-wrap gap-2">
              {selected.status === "ready_for_review" || selected.status === "approved" ? (
                <>
                  <button
                    type="button"
                    onClick={() => void applyChanges()}
                    disabled={busy}
                    className="rounded-lg bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--background)] transition hover:bg-[var(--silver)] disabled:opacity-40"
                  >
                    {busy ? "Applying…" : "Apply changes"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void notForNow()}
                    disabled={busy}
                    className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)] disabled:opacity-40"
                  >
                    Not now
                  </button>
                </>
              ) : null}
              {selected.status === "applied" || selected.status === "recovery_required" ? (
                <button
                  type="button"
                  onClick={() => void undo()}
                  disabled={busy}
                  className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm text-[var(--foreground)] transition hover:bg-[var(--surface-hover)] disabled:opacity-40"
                >
                  Undo these changes
                </button>
              ) : null}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
