import type { PlanStore } from "./store.ts";
import { blockedTaskIds, readyTaskIds } from "./plan.ts";
import { AgentError, MAX_FINAL_RESPONSE_CHARS, MAX_TASK_OUTPUT_CHARS } from "./types.ts";
import type { AgentPlan, AgentTask, PlanStatus, TaskState } from "./types.ts";;

export interface TaskContext {
  planId: string;
  projectId: string | null;
  conversationId: string | null;
  request: string;
  previousResults: { taskId: string; title: string; output: string }[];
  signal?: AbortSignal;
}

export interface TaskRunResult {
  output: string;
  proposalId?: string | null;
}

export type TaskRunner = (task: AgentTask, context: TaskContext) => Promise<TaskRunResult>;

export interface EngineDeps {
  store: PlanStore;
  runner: TaskRunner;
  now?: () => string;
  signal?: AbortSignal;
  onProgress?: (plan: AgentPlan) => void;
}

function updateTask(plan: AgentPlan, taskId: string, changes: Partial<AgentTask>): void {
  const index = plan.tasks.findIndex((task) => task.id === taskId);
  if (index === -1) return;
  plan.tasks[index] = { ...plan.tasks[index], ...changes };
}

function bounded(text: string): string {
  if (text.length <= MAX_TASK_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_TASK_OUTPUT_CHARS)}\n… (truncated)`;
}

export function synthesizeFinalResponse(plan: AgentPlan): string {
  const completed = plan.tasks.filter((task) => task.status === "completed" && task.result);
  if (completed.length === 0) {
    return "No task produced a result.";
  }
  const parts =
    completed.length === 1
      ? [completed[0].result as string]
      : completed.map((task) => `### ${task.title} (${task.agentId})\n${task.result}`);

  const notCompleted = plan.tasks.filter((task) => task.status !== "completed");
  if (notCompleted.length > 0) {
    parts.push(
      `---\nSome steps did not complete: ${notCompleted
        .map((task) => `${task.title} (${task.status})`)
        .join(", ")}.`,
    );
  }

  const text = parts.join("\n\n");
  return text.length <= MAX_FINAL_RESPONSE_CHARS ? text : `${text.slice(0, MAX_FINAL_RESPONSE_CHARS)}\n… (truncated)`;
}

function planStatusAfterRun(tasks: readonly AgentTask[]): PlanStatus {
  const completed = tasks.filter((task) => task.status === "completed").length;
  if (completed === tasks.length) return "completed";
  if (completed > 0) return "partial";
  return tasks.some((task) => task.status === "cancelled") ? "cancelled" : "failed";
}

export async function executePlan(plan: AgentPlan, deps: EngineDeps): Promise<AgentPlan> {
  const now = deps.now ?? (() => new Date().toISOString());

  plan.status = "running";
  plan.updatedAt = now();
  await deps.store.save(plan);
  deps.onProgress?.(plan);

  const maxSteps = plan.tasks.length;
  for (let step = 0; step < maxSteps; step += 1) {
    if (deps.signal?.aborted) break;

    for (const taskId of blockedTaskIds(plan.tasks)) {
      updateTask(plan, taskId, { status: "blocked", error: "A prerequisite task did not complete.", finishedAt: now() });
    }

    const ready = readyTaskIds(plan.tasks);
    if (ready.length === 0) break;

    const taskId = ready[0];
    const task = plan.tasks.find((entry) => entry.id === taskId);
    if (!task) break;

    updateTask(plan, taskId, { status: "running", startedAt: now(), error: null });
    plan.updatedAt = now();
    await deps.store.save(plan);
    deps.onProgress?.(plan);

    const previousResults = plan.tasks
      .filter((entry) => task.dependsOn.includes(entry.id) && entry.status === "completed" && entry.result)
      .map((entry) => ({ taskId: entry.id, title: entry.title, output: entry.result as string }));

    try {
      const result = await deps.runner(task, {
        planId: plan.id,
        projectId: plan.projectId,
        conversationId: plan.conversationId,
        request: plan.request,
        previousResults,
        signal: deps.signal,
      });
      updateTask(plan, taskId, {
        status: "completed",
        result: bounded(result.output),
        proposalId: result.proposalId ?? null,
        finishedAt: now(),
      });
    } catch (error) {
      const cancelled = deps.signal?.aborted || (error instanceof AgentError && error.code === "CANCELLED");
      const state: TaskState = cancelled ? "cancelled" : "failed";
      updateTask(plan, taskId, {
        status: state,
        error: error instanceof Error ? error.message : "The task failed.",
        finishedAt: now(),
      });
    }

    plan.updatedAt = now();
    await deps.store.save(plan);
    deps.onProgress?.(plan);
  }

  for (const task of plan.tasks) {
    if (task.status === "pending" || task.status === "ready") {
      task.status = deps.signal?.aborted ? "cancelled" : "blocked";
      task.error = deps.signal?.aborted ? "Cancelled." : "A prerequisite task did not complete.";
      task.finishedAt = now();
    }
  }

  plan.status = deps.signal?.aborted ? "cancelled" : planStatusAfterRun(plan.tasks);
  plan.finalResponse = synthesizeFinalResponse(plan);
  plan.updatedAt = now();
  await deps.store.save(plan);
  deps.onProgress?.(plan);
  return plan;
}
