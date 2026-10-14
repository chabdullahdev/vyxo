import { listAgents } from "./registry.ts";
import { executePlan } from "./engine.ts";
import type { TaskRunner } from "./engine.ts";;
import { createPlanFromModel } from "./runner.ts";
import type { PlanStore } from "./store.ts";
import { AgentError, MAX_PLAN_REQUEST_CHARS } from "./types.ts";
import type { AgentPlan } from "./types.ts";;

const MAX_BODY_BYTES = 32_000;

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function toErrorResponse(error: unknown): Response {
  if (error instanceof AgentError) {
    const statusByCode: Partial<Record<AgentError["code"], number>> = {
      INVALID_PLAN: 400,
      INVALID_AGENT: 400,
      INVALID_CAPABILITY: 403,
      INVALID_DEPENDENCY: 400,
      CYCLE: 400,
      LIMIT_EXCEEDED: 413,
      INVALID_STATE: 409,
      CANCELLED: 409,
      NOT_FOUND: 404,
      MODEL_UNAVAILABLE: 503,
      EXECUTION_FAILED: 500,
      CORRUPT_DATA: 500,
      UNSUPPORTED_VERSION: 500,
      STORAGE_IO: 500,
    };
    return jsonResponse({ error: error.message }, statusByCode[error.code] ?? 400);
  }
  console.error("[agents] request failed");
  return jsonResponse({ error: "The agent request could not be completed." }, 500);
}

async function readJsonObject(
  request: Request,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return { ok: false, response: jsonResponse({ error: "Content-Type must be application/json." }, 415) };
  }
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, response: jsonResponse({ error: "Could not read the request body." }, 400) };
  }
  if (raw.length > MAX_BODY_BYTES) {
    return { ok: false, response: jsonResponse({ error: "Request body is too large." }, 413) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, response: jsonResponse({ error: "Request body must be valid JSON." }, 400) };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, response: jsonResponse({ error: "Request body must be a JSON object." }, 400) };
  }
  return { ok: true, body: parsed as Record<string, unknown> };
}

function planView(plan: AgentPlan) {
  return plan;
}

export function listAgentsResponse(): Response {
  return jsonResponse(
    {
      agents: listAgents().map((agent) => ({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        purpose: agent.purpose,
        taskTypes: agent.taskTypes,
        capabilities: agent.capabilities,
      })),
    },
    200,
  );
}

export interface CreatePlanDeps {
  store: PlanStore;
  plan?: typeof createPlanFromModel;
  now?: () => string;
}

export async function createPlanResponse(deps: CreatePlanDeps, request: Request): Promise<Response> {
  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;

  const requestText = parsed.body.request;
  if (typeof requestText !== "string" || requestText.trim().length === 0) {
    return jsonResponse({ error: "`request` must be a non-empty string." }, 400);
  }
  if (requestText.length > MAX_PLAN_REQUEST_CHARS) {
    return jsonResponse({ error: "That request is too long." }, 413);
  }
  const projectId = typeof parsed.body.projectId === "string" ? parsed.body.projectId : null;
  const conversationId = typeof parsed.body.conversationId === "string" ? parsed.body.conversationId : null;

  try {
    const planner = deps.plan ?? createPlanFromModel;
    const plan = await planner({ request: requestText.trim(), projectId, conversationId });
    await deps.store.create(plan);
    return jsonResponse({ plan: planView(plan) }, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function listPlansResponse(store: PlanStore, now: string): Promise<Response> {
  try {
    await store.recoverInterrupted(now);
    return jsonResponse({ plans: (await store.list()).map(planView) }, 200);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function getPlanResponse(store: PlanStore, id: string): Promise<Response> {
  try {
    return jsonResponse({ plan: planView(await store.get(id)) }, 200);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export interface RunPlanDeps {
  store: PlanStore;
  runner: TaskRunner;
  now?: () => string;
}

export async function runPlanResponse(
  deps: RunPlanDeps,
  id: string,
  signal?: AbortSignal,
): Promise<Response> {
  try {
    const plan = await deps.store.get(id);
    if (plan.status !== "pending") {
      return jsonResponse({ error: "Only a pending plan can be run." }, 409);
    }
    const executed = await executePlan(plan, { store: deps.store, runner: deps.runner, signal, now: deps.now });
    return jsonResponse({ plan: planView(executed) }, 200);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function cancelPlanResponse(store: PlanStore, id: string, now: string): Promise<Response> {
  try {
    const plan = await store.get(id);
    if (plan.status === "completed" || plan.status === "partial" || plan.status === "failed" || plan.status === "cancelled") {
      return jsonResponse({ plan: planView(plan) }, 200);
    }
    for (const task of plan.tasks) {
      if (task.status === "pending" || task.status === "ready" || task.status === "running") {
        task.status = "cancelled";
        task.error = "Cancelled.";
        task.finishedAt = now;
      }
    }
    plan.status = "cancelled";
    plan.updatedAt = now;
    const saved = await store.save(plan);
    return jsonResponse({ plan: planView(saved) }, 200);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export function methodNotAllowedResponse(allowed: string[]): Response {
  return new Response(JSON.stringify({ error: "Method not allowed." }), {
    status: 405,
    headers: { ...JSON_HEADERS, Allow: allowed.join(", ") },
  });
}
