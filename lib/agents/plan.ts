import { agentSupportsTaskType, getAgent, isAgentTaskType } from "./registry.ts";
import { AgentError, MAX_PLAN_SUMMARY_CHARS, MAX_PLAN_TASKS, MAX_TASK_INSTRUCTION_CHARS, MAX_TASK_TITLE_CHARS } from "./types.ts";
import type { AgentTask } from "./types.ts";;

export interface RawPlanTask {
  id: unknown;
  agentId: unknown;
  taskType: unknown;
  title: unknown;
  instruction: unknown;
  dependsOn: unknown;
}

export interface RawPlan {
  summary: string;
  tasks: RawPlanTask[];
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const withoutFence = trimmed.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "").trim();
  const candidates = [withoutFence];
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(withoutFence.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next
    }
  }
  throw new AgentError("INVALID_PLAN", "The planner did not return readable JSON.");
}

export function parsePlanOutput(text: string): RawPlan {
  const parsed = extractJson(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AgentError("INVALID_PLAN", "The plan must be a JSON object.");
  }
  const summary = (parsed as { summary?: unknown }).summary;
  if (typeof summary !== "string" || summary.trim().length === 0) {
    throw new AgentError("INVALID_PLAN", "The plan is missing a summary.");
  }
  if (summary.length > MAX_PLAN_SUMMARY_CHARS) {
    throw new AgentError("INVALID_PLAN", "The plan summary is too long.");
  }
  const tasks = (parsed as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new AgentError("INVALID_PLAN", "The plan has no tasks.");
  }
  if (tasks.length > MAX_PLAN_TASKS) {
    throw new AgentError("LIMIT_EXCEEDED", `A plan may contain at most ${MAX_PLAN_TASKS} tasks.`);
  }
  return {
    summary: summary.trim(),
    tasks: tasks.map((entry) => {
      const record = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
      return {
        id: record.id,
        agentId: record.agentId,
        taskType: record.taskType,
        title: record.title,
        instruction: record.instruction,
        dependsOn: record.dependsOn,
      };
    }),
  };
}

export function detectCycle(tasks: readonly { id: string; dependsOn: string[] }[]): boolean {
  const remaining = new Map(tasks.map((task) => [task.id, new Set(task.dependsOn)]));
  let progressed = true;
  while (progressed && remaining.size > 0) {
    progressed = false;
    for (const [id, deps] of [...remaining.entries()]) {
      let ready = true;
      for (const dep of deps) {
        if (remaining.has(dep)) {
          ready = false;
          break;
        }
      }
      if (ready) {
        remaining.delete(id);
        progressed = true;
      }
    }
  }
  return remaining.size > 0;
}

export function validatePlanTasks(raw: RawPlan): AgentTask[] {
  const ids = new Set<string>();
  const tasks: AgentTask[] = [];

  for (const entry of raw.tasks) {
    if (typeof entry.id !== "string" || entry.id.trim().length === 0) {
      throw new AgentError("INVALID_PLAN", "Every task needs a non-empty id.");
    }
    const id = entry.id.trim();
    if (ids.has(id)) throw new AgentError("INVALID_PLAN", `Duplicate task id: ${id}`);
    ids.add(id);

    if (typeof entry.agentId !== "string" || !getAgent(entry.agentId)) {
      throw new AgentError("INVALID_AGENT", `Task ${id} references an unknown specialist.`);
    }
    const agent = getAgent(entry.agentId);

    if (!isAgentTaskType(entry.taskType) || !agent || !agentSupportsTaskType(agent, entry.taskType)) {
      throw new AgentError("INVALID_PLAN", `Task ${id} has a task type that specialist cannot perform.`);
    }
    if (typeof entry.title !== "string" || entry.title.trim().length === 0 || entry.title.length > MAX_TASK_TITLE_CHARS) {
      throw new AgentError("INVALID_PLAN", `Task ${id} needs a short title.`);
    }
    if (typeof entry.instruction !== "string" || entry.instruction.trim().length === 0) {
      throw new AgentError("INVALID_PLAN", `Task ${id} needs instructions.`);
    }
    if (entry.instruction.length > MAX_TASK_INSTRUCTION_CHARS) {
      throw new AgentError("LIMIT_EXCEEDED", `Task ${id} instructions are too long.`);
    }

    const dependsOn = entry.dependsOn === undefined ? [] : entry.dependsOn;
    if (!Array.isArray(dependsOn) || !dependsOn.every((dep) => typeof dep === "string")) {
      throw new AgentError("INVALID_DEPENDENCY", `Task ${id} has invalid dependencies.`);
    }

    tasks.push({
      id,
      agentId: entry.agentId,
      taskType: entry.taskType,
      title: entry.title.trim(),
      instruction: entry.instruction.trim(),
      dependsOn: [...new Set(dependsOn as string[])],
      status: "pending",
      result: null,
      error: null,
      proposalId: null,
      startedAt: null,
      finishedAt: null,
    });
  }

  for (const task of tasks) {
    if (task.dependsOn.includes(task.id)) {
      throw new AgentError("INVALID_DEPENDENCY", `Task ${task.id} cannot depend on itself.`);
    }
    for (const dep of task.dependsOn) {
      if (!ids.has(dep)) {
        throw new AgentError("INVALID_DEPENDENCY", `Task ${task.id} depends on unknown task ${dep}.`);
      }
    }
  }

  if (detectCycle(tasks)) {
    throw new AgentError("CYCLE", "The plan contains a dependency cycle.");
  }

  return tasks;
}

export function readyTaskIds(tasks: readonly AgentTask[]): string[] {
  const completed = new Set(tasks.filter((task) => task.status === "completed").map((task) => task.id));
  return tasks
    .filter((task) => task.status === "pending" && task.dependsOn.every((dep) => completed.has(dep)))
    .map((task) => task.id);
}

export function blockedTaskIds(tasks: readonly AgentTask[]): string[] {
  const blocked = new Set(
    tasks
      .filter((task) => task.status === "failed" || task.status === "blocked" || task.status === "cancelled")
      .map((task) => task.id),
  );
  return tasks
    .filter((task) => task.status === "pending" && task.dependsOn.some((dep) => blocked.has(dep)))
    .map((task) => task.id);
}
