"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface AgentView {
  id: string;
  name: string;
  description: string;
  purpose: string;
  taskTypes: string[];
  capabilities: string[];
}

interface TaskView {
  id: string;
  agentId: string;
  taskType: string;
  title: string;
  instruction: string;
  dependsOn: string[];
  status: string;
  result: string | null;
  error: string | null;
  proposalId: string | null;
}

interface PlanView {
  id: string;
  request: string;
  summary: string;
  status: string;
  tasks: TaskView[];
  finalResponse: string | null;
  error: string | null;
  createdAt: string;
}

type LoadState = "loading" | "ready" | "failed";

const STATUS_TONE: Record<string, string> = {
  completed: "text-[var(--accent)]",
  running: "text-[var(--foreground)]",
  pending: "text-[var(--muted)]",
  ready: "text-[var(--muted)]",
  failed: "text-[var(--accent)]",
  blocked: "text-[var(--muted)]",
  cancelled: "text-[var(--muted)]",
};

async function requestJson<T>(
  url: string,
  options?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, options);
    const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!response.ok) return { ok: false, error: data?.error ?? `Request failed (status ${response.status}).` };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Is the app still running?" };
  }
}

export function AgentsWorkspace() {
  const [agents, setAgents] = useState<AgentView[]>([]);
  const [plans, setPlans] = useState<PlanView[]>([]);
  const [listState, setListState] = useState<LoadState>("loading");
  const [request, setRequest] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState<"plan" | "run" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [agentList, planList] = await Promise.all([
      requestJson<{ agents: AgentView[] }>("/api/agents"),
      requestJson<{ plans: PlanView[] }>("/api/agents/plans"),
    ]);
    if (agentList.ok) setAgents(agentList.data.agents);
    if (planList.ok) {
      setPlans(planList.data.plans);
      setListState("ready");
    } else {
      setListState("failed");
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [agentList, planList] = await Promise.all([
        requestJson<{ agents: AgentView[] }>("/api/agents"),
        requestJson<{ plans: PlanView[] }>("/api/agents/plans"),
      ]);
      if (!active) return;
      if (agentList.ok) setAgents(agentList.data.agents);
      if (planList.ok) {
        setPlans(planList.data.plans);
        setListState("ready");
      } else {
        setListState("failed");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const selected = plans.find((plan) => plan.id === selectedId) ?? null;

  const createPlan = useCallback(async () => {
    const value = request.trim();
    if (value.length === 0 || busy) return;
    setBusy("plan");
    setError(null);
    const result = await requestJson<{ plan: PlanView }>("/api/agents/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: value, ...(projectId.trim() ? { projectId: projectId.trim() } : {}) }),
    });
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRequest("");
    setSelectedId(result.data.plan.id);
    await load();
  }, [busy, load, projectId, request]);

  const runPlan = useCallback(
    async (id: string) => {
      if (busy) return;
      setBusy("run");
      setError(null);
      const result = await requestJson<{ plan: PlanView }>(`/api/agents/plans/${encodeURIComponent(id)}/run`, {
        method: "POST",
      });
      setBusy(null);
      if (!result.ok) {
        setError(result.error);
        await load();
        return;
      }
      setSelectedId(result.data.plan.id);
      await load();
    },
    [busy, load],
  );

  const cancelPlan = useCallback(
    async (id: string) => {
      if (busy) return;
      setBusy("run");
      const result = await requestJson<{ plan: PlanView }>(`/api/agents/plans/${encodeURIComponent(id)}/cancel`, {
        method: "POST",
      });
      setBusy(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await load();
    },
    [busy, load],
  );

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <h3 className="font-[family-name:var(--font-display)] text-base font-medium text-[var(--foreground)]">
          Delegate a task
        </h3>
        <p className="mt-1 text-xs text-[var(--muted)]">
          VYXO plans the work, assigns it to specialists, and runs the steps one at a time. Specialists can read
          authorized project evidence; any code change is only proposed for your review.
        </p>
        <div className="mt-3 space-y-2">
          <textarea
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            rows={2}
            placeholder="e.g. Plan how to add a settings page, then review the plan for risks."
            className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent-border)]"
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              placeholder="Project ID (optional)"
              aria-label="Project ID"
              className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2 font-mono text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent-border)]"
            />
            <button
              type="button"
              onClick={() => void createPlan()}
              disabled={busy !== null || request.trim().length === 0}
              className="rounded-lg bg-[var(--foreground)] px-4 py-2 text-xs font-medium text-[var(--background)] transition hover:bg-[var(--silver)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === "plan" ? "Planning…" : "Create plan"}
            </button>
          </div>
        </div>
        {error ? (
          <p role="alert" className="mt-3 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 py-2 text-xs text-[var(--accent)]">
            {error}
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <h3 className="font-[family-name:var(--font-display)] text-base font-medium text-[var(--foreground)]">
          Specialists
        </h3>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {agents.map((agent) => (
            <li key={agent.id} className="rounded-xl border border-[var(--line)] p-3">
              <p className="text-sm font-medium text-[var(--foreground)]">{agent.name}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">{agent.description}</p>
              <p className="mt-2 text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
                {agent.capabilities.join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <h3 className="font-[family-name:var(--font-display)] text-base font-medium text-[var(--foreground)]">
          Plans
        </h3>
        {listState === "loading" ? (
          <p className="mt-3 text-sm text-[var(--muted)]">Loading…</p>
        ) : plans.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">No plans yet.</p>
        ) : (
          <ul className="mt-3 space-y-1">
            {plans.map((plan) => (
              <li key={plan.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(plan.id)}
                  className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition ${
                    selectedId === plan.id
                      ? "border-[var(--accent-border)] bg-[var(--accent-soft)]"
                      : "border-[var(--line)] hover:bg-[var(--surface-hover)]"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-[var(--foreground)]">{plan.request}</span>
                  <span className={`${STATUS_TONE[plan.status] ?? "text-[var(--muted)]"}`}>{plan.status}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {selected ? (
          <div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface-deep)]/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={`text-xs font-medium ${STATUS_TONE[selected.status] ?? "text-[var(--muted)]"}`}>
                {selected.status}
              </span>
              <div className="flex gap-2">
                {selected.status === "pending" ? (
                  <button
                    type="button"
                    onClick={() => void runPlan(selected.id)}
                    disabled={busy !== null}
                    className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--background)] disabled:opacity-40"
                  >
                    {busy === "run" ? "Running…" : "Run plan"}
                  </button>
                ) : null}
                {selected.status === "running" || selected.status === "pending" ? (
                  <button
                    type="button"
                    onClick={() => void cancelPlan(selected.id)}
                    disabled={busy !== null}
                    className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--muted)] transition hover:text-[var(--foreground)] disabled:opacity-40"
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>
            <p className="mt-2 text-sm text-[var(--foreground)]">{selected.summary}</p>

            <ol className="mt-3 space-y-2">
              {selected.tasks.map((task, index) => (
                <li key={task.id} className="rounded-lg border border-[var(--line)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-[var(--foreground)]">
                      {index + 1}. {task.title}
                    </span>
                    <span className={`${STATUS_TONE[task.status] ?? "text-[var(--muted)]"}`}>
                      {task.agentId} · {task.status}
                    </span>
                  </div>
                  {task.dependsOn.length > 0 ? (
                    <p className="mt-1 text-[11px] text-[var(--muted)]">after: {task.dependsOn.join(", ")}</p>
                  ) : null}
                  {task.error ? (
                    <p role="alert" className="mt-1 text-[11px] text-[var(--accent)]">
                      {task.error}
                    </p>
                  ) : null}
                  {task.result ? (
                    <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--background)] p-2 text-[11px] leading-5 text-[var(--foreground)]">
                      {task.result}
                    </pre>
                  ) : null}
                  {task.proposalId ? (
                    <p className="mt-2 text-[11px] text-[var(--accent)]">
                      A proposed code change is ready for review.{" "}
                      <Link href="/projects" className="underline underline-offset-2">
                        Open the project workspace
                      </Link>
                      .
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>

            {selected.finalResponse ? (
              <div className="mt-3">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">Result</p>
                <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--line)] bg-[var(--background)] p-3 text-xs leading-5 text-[var(--foreground)]">
                  {selected.finalResponse}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
