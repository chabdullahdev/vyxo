import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectFileService } from "../files/service.ts";
import { ProjectStore } from "../projects/store.ts";
import { ProposalStore, RecoveryStore } from "./store.ts";
import {
  applyProposalResponse,
  approveProposalResponse,
  createProposalResponse,
  getProposalResponse,
  listProposalsResponse,
  recoverProposalResponse,
  recoveryListResponse,
  rejectProposalResponse,
} from "./api.ts";

const service = new ProjectFileService();
let base;
let folder;
let projectStore;
let projectId;
let proposalStore;
let recoveryStore;
let deps;

before(async () => {
  base = await mkdtemp(join(tmpdir(), "vyxo-edits-api-"));
  folder = join(base, "project");
  await mkdir(join(folder, "src"), { recursive: true });
  await writeFile(join(folder, "src", "app.ts"), "export const value = 1;\n", "utf8");
  projectStore = new ProjectStore({ filePath: join(base, "projects.json") });
  const project = await projectStore.createProject("P");
  projectId = project.id;
  await projectStore.setProjectSourceFolder(projectId, folder);
  proposalStore = new ProposalStore(join(base, "proposals.json"));
  recoveryStore = new RecoveryStore(join(base, "recovery.json"));
  deps = { service, proposalStore, recoveryStore, projectStore };
});

after(async () => {
  await rm(base, { recursive: true, force: true });
});

function jsonRequest(body) {
  return new Request("http://localhost/api/projects/x/proposals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function generateWith(text) {
  return async () => ({ text, model: "test-model" });
}

async function createProposal(text, options = {}) {
  await writeFile(join(folder, "src", "app.ts"), "export const value = 1;\n", "utf8");
  return createProposalResponse(
    { projectStore, proposalStore, service, generate: generateWith(text) },
    projectId,
    jsonRequest({ request: options.request ?? "change the value" }),
  );
}

test("creates a proposal from model output", async () => {
  const response = await createProposal(
    JSON.stringify({ summary: "Bump value", operations: [{ op: "modify", path: "src/app.ts", content: "export const value = 2;\n" }] }),
  );
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.proposal.status, "ready_for_review");
  assert.equal(body.proposal.operations[0].diff.added, 1);
});

test("rejects malformed and unsafe proposals with clear statuses", async () => {
  const malformed = await createProposal("not json at all");
  assert.equal(malformed.status, 400);

  const traversal = await createProposal(
    JSON.stringify({ summary: "s", operations: [{ op: "modify", path: "../escape.ts", content: "x" }] }),
  );
  assert.equal(traversal.status, 400);

  const secret = await createProposal(
    JSON.stringify({ summary: "s", operations: [{ op: "modify", path: ".env", content: "x" }] }),
  );
  assert.equal(secret.status, 403);

  const wrongType = await createProposalResponse(
    { projectStore, proposalStore, service, generate: generateWith("{}") },
    projectId,
    new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "hi" }),
  );
  assert.equal(wrongType.status, 415);
});

test("lists and fetches proposals, scoped to the project", async () => {
  const list = await listProposalsResponse(proposalStore, projectId).then((response) => response.json());
  assert.ok(Array.isArray(list.proposals));
  const id = list.proposals[0].id;

  const fetched = await getProposalResponse(proposalStore, projectId, id);
  assert.equal(fetched.status, 200);

  const crossProject = await getProposalResponse(proposalStore, "other-project", id);
  assert.equal(crossProject.status, 404);
});

test("approve, apply, and reject transitions work end-to-end", async () => {
  const created = await createProposal(
    JSON.stringify({ summary: "Bump", operations: [{ op: "modify", path: "src/app.ts", content: "export const value = 7;\n" }] }),
  );
  const proposalId = (await created.json()).proposal.id;

  const applied = await applyProposalResponse(deps, projectId, proposalId);
  assert.equal(applied.status, 409);

  const approved = await approveProposalResponse(proposalStore, projectId, proposalId);
  assert.equal(approved.status, 200);

  const result = await applyProposalResponse(deps, projectId, proposalId);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).status, "applied");
  assert.equal(await readFile(join(folder, "src", "app.ts"), "utf8"), "export const value = 7;\n");

  const replay = await applyProposalResponse(deps, projectId, proposalId);
  assert.equal(replay.status, 409);

  const second = await createProposal(
    JSON.stringify({ summary: "Again", operations: [{ op: "modify", path: "src/app.ts", content: "export const value = 8;\n" }] }),
  );
  const secondId = (await second.json()).proposal.id;
  const rejected = await rejectProposalResponse(proposalStore, projectId, secondId);
  assert.equal(rejected.status, 200);
  const approveRejected = await approveProposalResponse(proposalStore, projectId, secondId);
  assert.equal(approveRejected.status, 409);
});

test("recovery lists and restores an applied change", async () => {
  const created = await createProposal(
    JSON.stringify({ summary: "Bump", operations: [{ op: "modify", path: "src/app.ts", content: "export const value = 11;\n" }] }),
  );
  const proposalId = (await created.json()).proposal.id;
  await approveProposalResponse(proposalStore, projectId, proposalId);
  await applyProposalResponse(deps, projectId, proposalId);

  const list = await recoveryListResponse(recoveryStore, projectId).then((response) => response.json());
  assert.ok(list.entries.some((entry) => entry.proposalId === proposalId));

  const recovered = await recoverProposalResponse(deps, projectId, proposalId);
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).restored, 1);
  assert.equal(await readFile(join(folder, "src", "app.ts"), "utf8"), "export const value = 1;\n");
});
