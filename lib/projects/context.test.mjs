import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEmptyProjectContext,
  DEFAULT_MAX_PROJECT_CONTEXT_CHARS,
  formatProjectContext,
  loadProjectContextMessage,
  PROJECT_CONTEXT_MAX_PROMPT_CHARS,
  PROJECT_CONTEXT_UNTRUSTED_NOTICE,
  projectContextIsEmpty,
} from "./context.ts";
import { ProjectStore } from "./store.ts";

const root = await mkdtemp(join(tmpdir(), "vyxo-project-context-test-"));

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function freshStore() {
  const dir = await mkdtemp(join(root, "case-"));
  let counter = 0;
  return new ProjectStore({
    filePath: join(dir, "projects.json"),
    idFactory: () => `p-${++counter}`,
  });
}

test("creates an empty context by default", () => {
  const context = createEmptyProjectContext();
  assert.deepEqual(context, { purpose: "", goals: "", techStack: "", instructions: "", notes: "" });
  assert.equal(projectContextIsEmpty(context), true);
  assert.equal(projectContextIsEmpty({ ...context, notes: "   " }), true);
  assert.equal(projectContextIsEmpty({ ...context, goals: "Ship it" }), false);
});

test("formats only non-empty fields as delimited untrusted reference data", () => {
  assert.equal(
    formatProjectContext({ name: "Empty", context: createEmptyProjectContext() }),
    null,
  );

  const message = formatProjectContext({
    name: "VYXO",
    context: {
      purpose: "A local-first workspace.",
      goals: "Ship Phase 4.",
      techStack: "",
      instructions: "Prefer short answers.",
      notes: "",
    },
  });

  assert.ok(message);
  assert.match(message, /<project_context kind="untrusted-reference-data">/);
  assert.match(message, /<\/project_context>/);
  assert.match(message, /Project name: VYXO/);
  assert.match(message, /A local-first workspace\./);
  assert.match(message, /Ship Phase 4\./);
  assert.match(message, /Prefer short answers\./);
  assert.ok(message.includes(PROJECT_CONTEXT_UNTRUSTED_NOTICE));
  assert.ok(!message.includes("Technology stack"));
  assert.ok(!message.includes("Notes:"));
});

test("caps the formatted prompt defensively", () => {
  const context = createEmptyProjectContext();
  context.notes = "x".repeat(DEFAULT_MAX_PROJECT_CONTEXT_CHARS) + "y".repeat(500);
  const message = formatProjectContext({ name: "Big", context });
  assert.ok(message);
  assert.ok(message.length <= PROJECT_CONTEXT_MAX_PROMPT_CHARS);
});

test("loads context authoritatively and keeps projects isolated", async () => {
  const store = await freshStore();
  const alpha = await store.createProject("Alpha");
  const beta = await store.createProject("Beta");
  const empty = await store.createProject("Empty");

  await store.updateProject(alpha.id, { context: { purpose: "ALPHA_ONLY_CONTEXT" } });
  await store.updateProject(beta.id, { context: { purpose: "BETA_ONLY_CONTEXT" } });

  const alphaLoad = await loadProjectContextMessage(store, alpha.id);
  assert.equal(alphaLoad.status, "loaded");
  assert.match(alphaLoad.message, /ALPHA_ONLY_CONTEXT/);
  assert.ok(!alphaLoad.message.includes("BETA_ONLY_CONTEXT"));

  const betaLoad = await loadProjectContextMessage(store, beta.id);
  assert.match(betaLoad.message, /BETA_ONLY_CONTEXT/);
  assert.ok(!betaLoad.message.includes("ALPHA_ONLY_CONTEXT"));

  assert.equal((await loadProjectContextMessage(store, empty.id)).status, "empty");
  assert.equal((await loadProjectContextMessage(store, null)).status, "none");
  assert.equal((await loadProjectContextMessage(store, "missing")).status, "missing");
});

test("rethrows unexpected store failures instead of hiding them", async () => {
  const failing = {
    getProject: async () => {
      throw Object.assign(new Error("disk"), { code: "STORAGE_IO" });
    },
  };
  await assert.rejects(loadProjectContextMessage(failing, "p-1"), /disk/);
});
