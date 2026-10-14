import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { isValidProjectId } from "../projects/store.ts";
import { isAgentTaskType } from "./registry.ts";
import { AGENT_PLAN_SCHEMA_VERSION, AgentError, DEFAULT_AGENT_PLAN_STORAGE_PATH, MAX_STORED_PLANS, PLAN_STATUSES, TASK_STATES } from "./types.ts";
import type { AgentPlan, AgentPlanDocument, AgentTask, PlanStatus, TaskState } from "./types.ts";;

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

const stringOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

function validateTask(input: unknown): AgentTask {
  if (typeof input !== "object" || input === null) {
    throw new AgentError("CORRUPT_DATA", "A stored task is invalid.");
  }
  const record = input as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0) {
    throw new AgentError("CORRUPT_DATA", "A stored task has an invalid id.");
  }
  if (typeof record.agentId !== "string" || !isAgentTaskType(record.taskType)) {
    throw new AgentError("CORRUPT_DATA", "A stored task has an invalid specialist or type.");
  }
  if (typeof record.title !== "string" || typeof record.instruction !== "string") {
    throw new AgentError("CORRUPT_DATA", "A stored task is missing text.");
  }
  if (!Array.isArray(record.dependsOn) || !record.dependsOn.every((dep) => typeof dep === "string")) {
    throw new AgentError("CORRUPT_DATA", "A stored task has invalid dependencies.");
  }
  if (typeof record.status !== "string" || !(TASK_STATES as readonly string[]).includes(record.status)) {
    throw new AgentError("CORRUPT_DATA", "A stored task has an invalid status.");
  }
  if (record.startedAt !== null && !isTimestamp(record.startedAt)) {
    throw new AgentError("CORRUPT_DATA", "A stored task has an invalid start time.");
  }
  if (record.finishedAt !== null && !isTimestamp(record.finishedAt)) {
    throw new AgentError("CORRUPT_DATA", "A stored task has an invalid finish time.");
  }
  return {
    id: record.id,
    agentId: record.agentId,
    taskType: record.taskType,
    title: record.title,
    instruction: record.instruction,
    dependsOn: record.dependsOn as string[],
    status: record.status as TaskState,
    result: stringOrNull(record.result),
    error: stringOrNull(record.error),
    proposalId: stringOrNull(record.proposalId),
    startedAt: stringOrNull(record.startedAt),
    finishedAt: stringOrNull(record.finishedAt),
  };
}

export function validatePlanDocument(input: unknown): AgentPlanDocument {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new AgentError("CORRUPT_DATA", "The plan file has an invalid structure.");
  }
  const { version, plans } = input as { version?: unknown; plans?: unknown };
  if (typeof version !== "number" || version !== AGENT_PLAN_SCHEMA_VERSION) {
    throw new AgentError("UNSUPPORTED_VERSION", "Unsupported agent plan schema version.");
  }
  if (!Array.isArray(plans)) {
    throw new AgentError("CORRUPT_DATA", "The plan file is missing its list.");
  }
  const seen = new Set<string>();
  const validated = plans.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      throw new AgentError("CORRUPT_DATA", "A stored plan is invalid.");
    }
    const record = entry as Record<string, unknown>;
    if (!isValidProjectId(record.id)) {
      throw new AgentError("CORRUPT_DATA", "A stored plan has an invalid id.");
    }
    if (seen.has(record.id)) throw new AgentError("CORRUPT_DATA", "Duplicate plan id.");
    seen.add(record.id);
    if (!isTimestamp(record.createdAt) || !isTimestamp(record.updatedAt)) {
      throw new AgentError("CORRUPT_DATA", "A stored plan has invalid timestamps.");
    }
    if (typeof record.request !== "string" || typeof record.summary !== "string") {
      throw new AgentError("CORRUPT_DATA", "A stored plan is missing text.");
    }
    if (typeof record.status !== "string" || !(PLAN_STATUSES as readonly string[]).includes(record.status)) {
      throw new AgentError("CORRUPT_DATA", "A stored plan has an invalid status.");
    }
    if (!Array.isArray(record.tasks)) {
      throw new AgentError("CORRUPT_DATA", "A stored plan is missing tasks.");
    }
    return {
      id: record.id,
      conversationId: stringOrNull(record.conversationId),
      projectId: stringOrNull(record.projectId),
      request: record.request,
      summary: record.summary,
      status: record.status as PlanStatus,
      tasks: record.tasks.map(validateTask),
      finalResponse: stringOrNull(record.finalResponse),
      error: stringOrNull(record.error),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  });
  return { version, plans: validated };
}

function clonePlan(plan: AgentPlan): AgentPlan {
  return { ...plan, tasks: plan.tasks.map((task) => ({ ...task, dependsOn: [...task.dependsOn] })) };
}

export class PlanStore {
  readonly filePath: string;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(filePath: string = DEFAULT_AGENT_PLAN_STORAGE_PATH) {
    this.filePath = filePath;
  }

  list(): Promise<AgentPlan[]> {
    return this.#exclusive(async () => {
      const document = await this.#read();
      return document.plans
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
        .map(clonePlan);
    });
  }

  get(id: string): Promise<AgentPlan> {
    return this.#exclusive(async () => {
      const document = await this.#read();
      const found = document.plans.find((plan) => plan.id === id);
      if (!found) throw new AgentError("NOT_FOUND", "Plan not found.");
      return clonePlan(found);
    });
  }

  create(plan: AgentPlan): Promise<AgentPlan> {
    return this.#exclusive(async () => {
      const document = await this.#read();
      document.plans.push(plan);
      document.plans = this.#prune(document.plans);
      await this.#write(document);
      return clonePlan(plan);
    });
  }

  save(plan: AgentPlan): Promise<AgentPlan> {
    return this.#exclusive(async () => {
      const document = await this.#read();
      const index = document.plans.findIndex((entry) => entry.id === plan.id);
      if (index === -1) throw new AgentError("NOT_FOUND", "Plan not found.");
      document.plans[index] = plan;
      await this.#write(document);
      return clonePlan(plan);
    });
  }

  recoverInterrupted(now: string): Promise<number> {
    return this.#exclusive(async () => {
      const document = await this.#read();
      let recovered = 0;
      for (const plan of document.plans) {
        if (plan.status !== "running") continue;
        recovered += 1;
        for (const task of plan.tasks) {
          if (task.status === "running" || task.status === "ready") {
            task.status = "failed";
            task.error = "Interrupted by an application restart.";
            task.finishedAt = now;
          }
        }
        const completed = plan.tasks.filter((task) => task.status === "completed").length;
        plan.status = completed > 0 ? "partial" : "failed";
        plan.error = "Interrupted by an application restart.";
        plan.updatedAt = now;
      }
      if (recovered > 0) await this.#write(document);
      return recovered;
    });
  }

  #prune(plans: AgentPlan[]): AgentPlan[] {
    if (plans.length <= MAX_STORED_PLANS) return plans;
    const terminal: PlanStatus[] = ["completed", "partial", "failed", "cancelled"];
    const keep = new Set(plans.map((plan) => plan.id));
    for (const plan of plans.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      if (keep.size <= MAX_STORED_PLANS) break;
      if (terminal.includes(plan.status)) keep.delete(plan.id);
    }
    return plans.filter((plan) => keep.has(plan.id));
  }

  #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(operation, operation);
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #read(): Promise<AgentPlanDocument> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT") {
        return { version: AGENT_PLAN_SCHEMA_VERSION, plans: [] };
      }
      throw new AgentError("STORAGE_IO", "Could not read the plan file.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new AgentError("CORRUPT_DATA", "The plan file is not valid JSON. It was left unchanged.");
    }
    return validatePlanDocument(parsed);
  }

  async #write(document: AgentPlanDocument): Promise<void> {
    const validated = validatePlanDocument(document);
    const data = `${JSON.stringify(validated, null, 2)}\n`;
    const directory = dirname(this.filePath);
    const temporaryPath = join(directory, `.${basename(this.filePath)}.${process.pid}.${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      await mkdir(directory, { recursive: true, mode: DIR_MODE });
      handle = await open(temporaryPath, "wx", FILE_MODE);
      await handle.writeFile(data, "utf8");
      await handle.chmod(FILE_MODE);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, this.filePath);
    } catch {
      if (handle) await handle.close().catch(() => {});
      await unlink(temporaryPath).catch(() => {});
      throw new AgentError("STORAGE_IO", "Could not save plan data. Existing data was left unchanged.");
    }
  }
}

export const planStore = new PlanStore();
