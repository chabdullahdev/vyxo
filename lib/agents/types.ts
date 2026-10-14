import { join } from "node:path";
import { DEFAULT_STORAGE_DIR } from "../memory/store.ts";

export const AGENT_CAPABILITIES = [
  "chat.respond",
  "project.read",
  "memory.read",
  "edit.propose",
  "research.local",
] as const;
export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];

export const AGENT_TASK_TYPES = [
  "plan",
  "answer",
  "explain",
  "debug",
  "review",
  "edit",
  "teach",
  "research",
] as const;
export type AgentTaskType = (typeof AGENT_TASK_TYPES)[number];

export interface AgentLimits {
  maxInputChars: number;
  maxOutputChars: number;
  timeoutMs: number;
}

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  purpose: string;
  instructions: string;
  taskTypes: readonly AgentTaskType[];
  capabilities: readonly AgentCapability[];
  context: {
    projectContext: boolean;
    projectEvidence: boolean;
    memory: boolean;
  };
  limits: AgentLimits;
}

export const AGENT_PLAN_SCHEMA_VERSION = 1;
export const DEFAULT_AGENT_PLAN_STORAGE_PATH = join(DEFAULT_STORAGE_DIR, "agent-plans.json");

export const MAX_PLAN_TASKS = 8;
export const MAX_TASK_TITLE_CHARS = 120;
export const MAX_TASK_INSTRUCTION_CHARS = 4_000;
export const MAX_PLAN_REQUEST_CHARS = 4_000;
export const MAX_PLAN_SUMMARY_CHARS = 2_000;
export const MAX_STORED_PLANS = 30;
export const MAX_FINAL_RESPONSE_CHARS = 20_000;
export const MAX_TASK_OUTPUT_CHARS = 12_000;

export const TASK_STATES = [
  "pending",
  "ready",
  "running",
  "completed",
  "failed",
  "blocked",
  "cancelled",
] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const PLAN_STATUSES = [
  "pending",
  "running",
  "completed",
  "partial",
  "failed",
  "cancelled",
] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export interface AgentTask {
  id: string;
  agentId: string;
  taskType: AgentTaskType;
  title: string;
  instruction: string;
  dependsOn: string[];
  status: TaskState;
  result: string | null;
  error: string | null;
  proposalId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface AgentPlan {
  id: string;
  conversationId: string | null;
  projectId: string | null;
  request: string;
  summary: string;
  status: PlanStatus;
  tasks: AgentTask[];
  finalResponse: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentPlanDocument {
  version: number;
  plans: AgentPlan[];
}

export type AgentErrorCode =
  | "INVALID_PLAN"
  | "INVALID_AGENT"
  | "INVALID_CAPABILITY"
  | "INVALID_DEPENDENCY"
  | "CYCLE"
  | "LIMIT_EXCEEDED"
  | "INVALID_STATE"
  | "NOT_FOUND"
  | "MODEL_UNAVAILABLE"
  | "CANCELLED"
  | "EXECUTION_FAILED"
  | "CORRUPT_DATA"
  | "UNSUPPORTED_VERSION"
  | "STORAGE_IO";

export class AgentError extends Error {
  readonly code: AgentErrorCode;

  constructor(code: AgentErrorCode, message: string) {
    super(message);
    this.name = "AgentError";
    this.code = code;
  }
}

const TASK_TRANSITIONS: Record<TaskState, TaskState[]> = {
  pending: ["ready", "cancelled", "blocked"],
  ready: ["running", "cancelled", "blocked"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  blocked: [],
  cancelled: [],
};

export function canTransitionTask(from: TaskState, to: TaskState): boolean {
  if (from === to) return true;
  return TASK_TRANSITIONS[from]?.includes(to) ?? false;
}

const PLAN_TRANSITIONS: Record<PlanStatus, PlanStatus[]> = {
  pending: ["running", "cancelled"],
  running: ["completed", "partial", "failed", "cancelled"],
  completed: [],
  partial: [],
  failed: [],
  cancelled: [],
};

export function canTransitionPlan(from: PlanStatus, to: PlanStatus): boolean {
  if (from === to) return true;
  return PLAN_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminalTask(status: TaskState): boolean {
  return status === "completed" || status === "failed" || status === "blocked" || status === "cancelled";
}
