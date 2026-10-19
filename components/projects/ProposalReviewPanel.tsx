"use client";

import { useCallback, useEffect, useState } from "react";
import type { EditProposal, ProposalStatus } from "@/lib/edits/types";

interface ProposalSummaryEntry {
  id: string;
  summary: string;
  status: ProposalStatus;
  fileCount: number;
  createdAt: string;
  operations: { op: string; path: string; added: number; removed: number }[];
}

interface RecoveryListItem {
  proposalId: string;
  path: string;
  operation: string;
  status: string;
  createdAt: string;
}

interface ApplyResultEntry {
  path: string;
  op: string;
  status: string;
  message?: string;
}

type LoadState = "loading" | "ready" | "failed";

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

const STATUS_LABELS: Record<ProposalStatus, string> = {
  ready_for_review: "Ready for review",
  approved: "Approved",
  applying: "Applying…",
  applied: "Applied",
  rejected: "Rejected",
  cancelled: "Cancelled",
  stale: "Stale",
  failed: "Failed",
  recovery_required: "Recovery required",
};

export function ProposalReviewPanel({ projectId }: { projectId: string }) {
  const [request, setRequest] = useState("");
  const [proposing, setProposing] = useState(false);
  const [proposals, setProposals] = useState<ProposalSummaryEntry[]>([]);
  const [listState, setListState] = useState<LoadState>("loading");
  const [selected, setSelected] = useState<EditProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResultEntry[] | null>(null);
  const [recovery, setRecovery] = useState<RecoveryListItem[]>([]);

  const base = `/api/projects/${encodeURIComponent(projectId)}`;

  const loadLists = useCallback(async () => {
    const [list, rec] = await Promise.all([
      requestJson<{ proposals: ProposalSummaryEntry[] }>(`${base}/proposals`),
      requestJson<{ entries: RecoveryListItem[] }>(`${base}/recovery`),
    ]);
    if (list.ok) {
      setProposals(list.data.proposals);
      setListState("ready");
    } else {
      setListState("failed");
    }
    if (rec.ok) setRecovery(rec.data.entries);
  }, [base]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [list, rec] = await Promise.all([
        requestJson<{ proposals: ProposalSummaryEntry[] }>(`${base}/proposals`),
        requestJson<{ entries: RecoveryListItem[] }>(`${base}/recovery`),
      ]);
      if (!active) return;
      if (list.ok) {
        setProposals(list.data.proposals);
        setListState("ready");
      } else {
        setListState("failed");
      }
      if (rec.ok) setRecovery(rec.data.entries);
    })();
    return () => {
      active = false;
    };
  }, [base]);

  const openProposal = useCallback(
    async (id: string) => {
      setError(null);
      setApplyResult(null);
      const result = await requestJson<{ proposal: EditProposal }>(`${base}/proposals/${encodeURIComponent(id)}`);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSelected(result.data.proposal);
    },
    [base],
  );

  const propose = useCallback(async () => {
    const value = request.trim();
    if (value.length === 0 || proposing) return;
    setProposing(true);
    setError(null);
    const result = await requestJson<{ proposal: EditProposal }>(`${base}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: value }),
    });
    setProposing(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRequest("");
    setSelected(result.data.proposal);
    setApplyResult(null);
    await loadLists();
  }, [base, loadLists, proposing, request]);

  const transition = useCallback(
    async (id: string, action: "approve" | "reject") => {
      if (busy) return;
      setBusy(true);
      setError(null);
      const result =
        action === "approve"
          ? await requestJson<{ proposal: EditProposal }>(`${base}/proposals/${encodeURIComponent(id)}/approve`, { method: "POST" })
          : await requestJson<{ proposal: EditProposal }>(`${base}/proposals/${encodeURIComponent(id)}`, { method: "DELETE" });
      setBusy(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSelected(result.data.proposal);
      await loadLists();
    },
    [base, busy, loadLists],
  );

  const apply = useCallback(async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    const result = await requestJson<{ proposal: EditProposal; status: string; results: ApplyResultEntry[] }>(
      `${base}/proposals/${encodeURIComponent(selected.id)}/apply`,
      { method: "POST" },
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSelected(result.data.proposal);
    setApplyResult(result.data.results);
    await loadLists();
  }, [base, busy, loadLists, selected]);

  const restore = useCallback(
    async (proposalId: string) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      const result = await requestJson<{ restored: number; conflicts: string[] }>(`${base}/recovery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId }),
      });
      setBusy(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.data.conflicts.length > 0) {
        setError(`Some files changed since apply and were not restored: ${result.data.conflicts.join(", ")}.`);
      }
      await loadLists();
    },
    [base, busy, loadLists],
  );

  return (
    <section
      aria-label="Proposed changes"
      className="mb-4 rounded-xl border border-[var(--line)] bg-[var(--surface-deep)]/40 p-4"
    >
      <div className="mb-3">
        <h4 className="font-[family-name:var(--font-display)] text-sm font-medium text-[var(--foreground)]">
          Proposed changes
        </h4>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          Ask VYXO to propose an edit. Nothing is written to your files until you review and approve a proposal.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void propose();
          }}
          placeholder="e.g. Add a retry helper in src/utils.ts"
          aria-label="Describe the change you want"
          className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent-border)]"
        />
        <button
          type="button"
          onClick={() => void propose()}
          disabled={proposing || request.trim().length === 0}
          className="rounded-lg bg-[var(--foreground)] px-3 py-2 text-xs font-medium text-[var(--background)] transition hover:bg-[var(--silver)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {proposing ? "Proposing…" : "Propose changes"}
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 py-2 text-xs text-[var(--accent-text)]">
          {error}
        </p>
      ) : null}

      {listState === "loading" ? (
        <p className="mt-3 text-xs text-[var(--muted)]">Loading proposals…</p>
      ) : proposals.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {proposals.map((proposal) => (
            <li key={proposal.id}>
              <button
                type="button"
                onClick={() => void openProposal(proposal.id)}
                className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition ${
                  selected?.id === proposal.id
                    ? "border-[var(--accent-border)] bg-[var(--accent-soft)]"
                    : "border-[var(--line)] hover:bg-[var(--surface-hover)]"
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-[var(--foreground)]">{proposal.summary}</span>
                <span className="text-[var(--muted)]">
                  {proposal.fileCount} file{proposal.fileCount === 1 ? "" : "s"} · {STATUS_LABELS[proposal.status]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-[var(--muted)]">No proposals yet.</p>
      )}

      {selected ? (
        <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-[var(--foreground)]">{STATUS_LABELS[selected.status]}</span>
            <span className="text-[11px] text-[var(--muted)]">
              {selected.model ? `Model: ${selected.model}` : ""}
            </span>
          </div>
          <p className="mt-2 text-sm text-[var(--foreground)]">{selected.summary}</p>
          {selected.error ? (
            <p role="alert" className="mt-2 text-xs text-[var(--accent-text)]">
              {selected.error}
            </p>
          ) : null}

          <ul className="mt-3 space-y-2">
            {selected.operations.map((operation) => (
              <li key={operation.path} className="rounded-lg border border-[var(--line)] p-2">
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
                  <pre className="mt-2 max-h-56 overflow-auto whitespace-pre rounded-md bg-[var(--background)] p-2 font-mono text-[11px] leading-5">
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

          <div className="mt-3 flex flex-wrap gap-2">
            {selected.status === "ready_for_review" ? (
              <>
                <button
                  type="button"
                  onClick={() => void transition(selected.id, "approve")}
                  disabled={busy}
                  className="rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-xs font-medium text-[var(--background)] transition hover:bg-[var(--silver)] disabled:opacity-40"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => void transition(selected.id, "reject")}
                  disabled={busy}
                  className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--muted)] transition hover:text-[var(--foreground)] disabled:opacity-40"
                >
                  Reject
                </button>
              </>
            ) : null}
            {selected.status === "approved" ? (
              <button
                type="button"
                onClick={() => void apply()}
                disabled={busy}
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--background)] disabled:opacity-40"
              >
                {busy ? "Applying…" : "Apply approved changes"}
              </button>
            ) : null}
          </div>

          {applyResult ? (
            <ul className="mt-3 space-y-1 text-xs">
              {applyResult.map((entry) => (
                <li key={entry.path} className="text-[var(--muted)]">
                  <span className="text-[var(--foreground)]">{entry.status}</span> {entry.path}
                  {entry.message ? ` — ${entry.message}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {recovery.length > 0 ? (
        <div className="mt-4 rounded-lg border border-[var(--line)] p-3">
          <p className="text-xs font-medium text-[var(--foreground)]">Recovery</p>
          <ul className="mt-2 space-y-1">
            {recovery.map((entry) => (
              <li key={`${entry.proposalId}:${entry.path}`} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-mono text-[var(--muted)]">
                  {entry.operation} {entry.path}
                </span>
                <button
                  type="button"
                  onClick={() => void restore(entry.proposalId)}
                  disabled={busy}
                  className="rounded-md border border-[var(--line)] px-2 py-1 text-[11px] text-[var(--foreground)] transition hover:bg-[var(--surface-hover)] disabled:opacity-40"
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
