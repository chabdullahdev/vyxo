import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAgent, listAgents, validateAgentRegistry } from "./registry.ts";
import { detectCycle, parsePlanOutput, validatePlanTasks } from "./plan.ts";
import { PlanStore } from "./store.ts";
import { executePlan, synthesizeFinalResponse } from "./engine.ts";
import { AgentError, canTransitionTask } from "./types.ts";

const NOW = "2026-06-01T00:00:00.000Z";
let base;

before(async () => {
  base = await mkdtemp(join(tmpdir(), "vyxo-agents-test-"));
});

after(async () => {
  await rm(base, { recursive: true, force: true });
});

const isCode = (code) => (error) => error instanceof AgentError && error.code === code;

test("agent registry is valid and exposes the specialists", () => {
  validateAgentRegistry();
  assert.deepEqual(listAgents().map((agent) => agent.id), ["planner", "developer", "reviewer", "mentor", "researcher"]);
  const researcher = getAgent("researcher");
  assert.ok(researcher.capabilities.includes("research.local"));
  assert.ok(!researcher.capabilities.includes("edit.propose"));
  assert.equal(researcher.context.projectEvidence, false);
  assert.equal(researcher.context.memory, false);
  const developer = getAgent("developer");
  assert.ok(developer.capabilities.includes("edit.propose"));
  assert.ok(!getAgent("reviewer").capabilities.includes("edit.propose"));
  assert.equal(getAgent("nope"), null);
});

test("parses plan output and rejects malformed or oversized plans", () => {
  const plan = parsePlanOutput(
    '{"summary":"Do it","tasks":[{"id":"t1","agentId":"developer","taskType":"explain","title":"t","instruction":"i","dependsOn":[]}]}',
  );
  assert.equal(plan.tasks.length, 1);

  assert.throws(() => parsePlanOutput("nope"), isCode("INVALID_PLAN"));
  assert.throws(() => parsePlanOutput('{"summary":"x"}'), isCode("INVALID_PLAN"));

  const many = { summary: "x", tasks: Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, agentId: "mentor", taskType: "teach", title: "t", instruction: "i", dependsOn: [] })) };
  assert.throws(() => parsePlanOutput(JSON.stringify(many)), isCode("LIMIT_EXCEEDED"));
});

test("validates specialists, task types, dependencies and cycles", () => {
  const base = (overrides) => ({ summary: "s", tasks: [{ id: "t1", agentId: "mentor", taskType: "teach", title: "t", instruction: "i", dependsOn: [], ...overrides }] });

  assert.throws(() => validatePlanTasks(parsePlanOutput(JSON.stringify(base({ agentId: "ghost" })))), isCode("INVALID_AGENT"));
  assert.throws(() => validatePlanTasks(parsePlanOutput(JSON.stringify(base({ agentId: "mentor", taskType: "edit" })))), isCode("INVALID_PLAN"));
  assert.throws(() => validatePlanTasks(parsePlanOutput(JSON.stringify(base({ dependsOn: ["t1"] })))), isCode("INVALID_DEPENDENCY"));

  const cyc = { summary: "s", tasks: [
    { id: "a", agentId: "mentor", taskType: "teach", title: "a", instruction: "i", dependsOn: ["b"] },
    { id: "b", agentId: "reviewer", taskType: "review", title: "b", instruction: "i", dependsOn: ["a"] },
  ] };
  assert.throws(() => validatePlanTasks(parsePlanOutput(JSON.stringify(cyc))), isCode("CYCLE"));
  assert.equal(detectCycle([{ id: "a", dependsOn: ["b"] }, { id: "b", dependsOn: [] }]), false);
});

test("task state transitions are enforced", () => {
  assert.equal(canTransitionTask("pending", "running"), false);
  assert.equal(canTransitionTask("running", "completed"), true);
  assert.equal(canTransitionTask("completed", "running"), false);
});

async function makePlan(rawTasks, projectId = null) {
  const tasks = validatePlanTasks(parsePlanOutput(JSON.stringify({ summary: "s", tasks: rawTasks })));
  return {
    id: randomUUID(),
    conversationId: null,
    projectId,
    request: "Do the thing",
    summary: "s",
    status: "pending",
    tasks,
    finalResponse: null,
    error: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeStore() {
  return new PlanStore(join(base, `plans-${randomUUID()}.json`));
}

function runnerFor(failIds = [], captured = []) {
  return async (task, context) => {
    captured.push({ task, context });
    if (failIds.includes(task.id)) throw new Error(`model failed: ${task.id}`);
    return { output: `result of ${task.id}` };
  };
}

test("engine runs tasks sequentially in dependency order and synthesizes a result", async () => {
  const store = makeStore();
  const captured = [];
  const plan = await makePlan([
    { id: "t1", agentId: "mentor", taskType: "teach", title: "Explain", instruction: "explain it", dependsOn: [] },
    { id: "t2", agentId: "reviewer", taskType: "review", title: "Review", instruction: "review it", dependsOn: ["t1"] },
  ]);
  await store.create(plan);
  const result = await executePlan(plan, { store, runner: runnerFor([], captured), now: () => NOW });

  assert.equal(result.status, "completed");
  assert.equal(result.tasks[0].status, "completed");
  assert.equal(result.tasks[1].status, "completed");
  assert.ok(result.finalResponse.includes("result of t1") && result.finalResponse.includes("result of t2"));
  assert.equal(captured.length, 2);
  assert.deepEqual(captured[0].task.id, "t1");
  assert.deepEqual(captured[1].task.id, "t2");
  assert.equal(captured[1].context.previousResults[0].taskId, "t1");
});

test("engine blocks dependents when a prerequisite fails and preserves completed work", async () => {
  const store = makeStore();
  const plan = await makePlan([
    { id: "t1", agentId: "mentor", taskType: "teach", title: "Explain", instruction: "explain", dependsOn: [] },
    { id: "t2", agentId: "reviewer", taskType: "review", title: "Review", instruction: "review", dependsOn: ["t1"] },
  ]);
  await store.create(plan);
  const result = await executePlan(plan, { store, runner: runnerFor(["t1"]), now: () => NOW });
  assert.equal(result.status, "failed");
  assert.equal(result.tasks[0].status, "failed");
  assert.equal(result.tasks[1].status, "blocked");
});

test("engine reports partial completion honestly", async () => {
  const store = makeStore();
  const plan = await makePlan([
    { id: "t1", agentId: "mentor", taskType: "teach", title: "Explain", instruction: "explain", dependsOn: [] },
    { id: "t2", agentId: "reviewer", taskType: "review", title: "Review", instruction: "review", dependsOn: [] },
  ]);
  await store.create(plan);
  const result = await executePlan(plan, { store, runner: runnerFor(["t2"]), now: () => NOW });
  assert.equal(result.status, "partial");
  assert.equal(result.tasks[0].status, "completed");
  assert.ok(result.finalResponse.includes("result of t1"));
  assert.ok(result.finalResponse.includes("did not complete"));
});

test("engine cancels remaining tasks when aborted and never marks them completed", async () => {
  const store = makeStore();
  const controller = new AbortController();
  controller.abort();
  const plan = await makePlan([
    { id: "t1", agentId: "mentor", taskType: "teach", title: "Explain", instruction: "explain", dependsOn: [] },
    { id: "t2", agentId: "reviewer", taskType: "review", title: "Review", instruction: "review", dependsOn: [] },
  ]);
  await store.create(plan);
  const result = await executePlan(plan, { store, runner: runnerFor(), signal: controller.signal, now: () => NOW });
  assert.equal(result.status, "cancelled");
  assert.ok(result.tasks.every((task) => task.status === "cancelled"));
});

test("engine isolates project context to the plan's project", async () => {
  const store = makeStore();
  const captured = [];
  const plan = await makePlan([{ id: "t1", agentId: "mentor", taskType: "teach", title: "Explain", instruction: "explain", dependsOn: [] }], "project-1");
  await store.create(plan);
  await executePlan(plan, { store, runner: runnerFor([], captured), now: () => NOW });
  assert.equal(captured[0].context.projectId, "project-1");

  const captured2 = [];
  const planNoProject = await makePlan([{ id: "t1", agentId: "mentor", taskType: "teach", title: "Explain", instruction: "explain", dependsOn: [] }]);
  await store.create(planNoProject);
  await executePlan(planNoProject, { store, runner: runnerFor([], captured2), now: () => NOW });
  assert.equal(captured2[0].context.projectId, null);
});

test("synthesizeFinalResponse notes when nothing completed", () => {
  const tasks = [{ status: "failed" }];
  assert.match(synthesizeFinalResponse({ tasks }).toLowerCase(), /no task produced a result/);
});

test("plan store persists, validates, and recovers interrupted runs", async () => {
  const store = makeStore();
  const plan = await makePlan([{ id: "t1", agentId: "mentor", taskType: "teach", title: "Explain", instruction: "explain", dependsOn: [] }]);
  await store.create(plan);
  assert.equal((await store.list()).length, 1);

  const running = { ...plan, status: "running", tasks: [{ ...plan.tasks[0], status: "running" }] };
  await store.save(running);
  const recovered = await store.recoverInterrupted(NOW);
  assert.equal(recovered, 1);
  const after = await store.get(plan.id);
  assert.equal(after.status, "failed");
  assert.equal(after.tasks[0].status, "failed");
  assert.match(after.tasks[0].error, /restart/i);

  const path = store.filePath;
  await writeFile(path, "{ broken", "utf8");
  await assert.rejects(new PlanStore(path).list(), isCode("CORRUPT_DATA"));
  assert.equal(await readFile(path, "utf8"), "{ broken");
});

test("plan store save requires an existing plan", async () => {
  const store = makeStore();
  const plan = await makePlan([{ id: "t1", agentId: "mentor", taskType: "teach", title: "t", instruction: "i", dependsOn: [] }]);
  await assert.rejects(store.save(plan), isCode("NOT_FOUND"));
});
