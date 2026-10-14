import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectFileService } from "../files/service.ts";
import { ProjectStore } from "../projects/store.ts";
import { ProposalStore, RecoveryStore, canTransition } from "./store.ts";
import { applyProposal, recoverProposal } from "./apply.ts";
import { buildProposalOperations } from "./build.ts";
import { EditError } from "./types.ts";

const service = new ProjectFileService();
let base;
let folder;
let projectStore;
let projectId;
let proposalStore;
let recoveryStore;
let deps;

before(async () => {
  base = await mkdtemp(join(tmpdir(), "vyxo-edits-apply-"));
  folder = join(base, "project");
  await mkdir(join(folder, "src"), { recursive: true });
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

async function resetFiles() {
  await writeFile(join(folder, "src", "app.ts"), "export const value = 1;\n", "utf8");
}

async function buildAndSeed(raw) {
  const operations = await buildProposalOperations(service, folder, raw);
  const now = new Date().toISOString();
  const proposal = {
    id: randomUUID(),
    projectId,
    createdAt: now,
    updatedAt: now,
    request: "r",
    summary: raw.summary,
    model: null,
    status: "ready_for_review",
    operations,
    approvedAt: null,
    appliedAt: null,
    results: null,
    error: null,
  };
  return proposalStore.create(proposal);
}

async function approve(id) {
  return proposalStore.update(id, { status: "approved", approvedAt: new Date().toISOString() }, new Date().toISOString());
}

const isCode = (code) => (error) => error instanceof EditError && error.code === code;

test("enforces proposal lifecycle transitions", async () => {
  assert.equal(canTransition("ready_for_review", "approved"), true);
  assert.equal(canTransition("applied", "approved"), false);
  assert.equal(canTransition("rejected", "approved"), false);

  await resetFiles();
  const proposal = await buildAndSeed({ summary: "s", operations: [{ op: "modify", path: "src/app.ts", content: "x\n" }] });
  await proposalStore.update(proposal.id, { status: "rejected" }, new Date().toISOString());
  await assert.rejects(
    proposalStore.update(proposal.id, { status: "approved" }, new Date().toISOString()),
    isCode("INVALID_STATE"),
  );
});

test("does not write before approval", async () => {
  await resetFiles();
  const proposal = await buildAndSeed({ summary: "s", operations: [{ op: "modify", path: "src/app.ts", content: "export const value = 2;\n" }] });

  await assert.rejects(applyProposal(projectId, proposal.id, deps), isCode("INVALID_STATE"));
  assert.equal(await readFile(join(folder, "src", "app.ts"), "utf8"), "export const value = 1;\n");
});

test("applies an approved modify and records recovery", async () => {
  await resetFiles();
  const proposal = await buildAndSeed({ summary: "s", operations: [{ op: "modify", path: "src/app.ts", content: "export const value = 2;\n" }] });
  await approve(proposal.id);

  const outcome = await applyProposal(projectId, proposal.id, deps);
  assert.equal(outcome.status, "applied");
  assert.equal(await readFile(join(folder, "src", "app.ts"), "utf8"), "export const value = 2;\n");
  const applied = (await recoveryStore.list()).filter((entry) => entry.proposalId === proposal.id && entry.status === "applied");
  assert.equal(applied.length, 1);

  await assert.rejects(applyProposal(projectId, proposal.id, deps), isCode("INVALID_STATE"));
});

test("rejects a stale original and never overwrites newer content", async () => {
  await resetFiles();
  const proposal = await buildAndSeed({ summary: "s", operations: [{ op: "modify", path: "src/app.ts", content: "export const value = 2;\n" }] });
  await approve(proposal.id);

  await writeFile(join(folder, "src", "app.ts"), "export const value = 99;\n", "utf8");
  const outcome = await applyProposal(projectId, proposal.id, deps);
  assert.equal(outcome.status, "failed");
  assert.equal(await readFile(join(folder, "src", "app.ts"), "utf8"), "export const value = 99;\n");
});

test("create fails safely if the file appears after the proposal", async () => {
  await resetFiles();
  const proposal = await buildAndSeed({ summary: "s", operations: [{ op: "create", path: "src/new.ts", content: "fresh\n" }] });
  await approve(proposal.id);

  await writeFile(join(folder, "src", "new.ts"), "someone else\n", "utf8");
  const outcome = await applyProposal(projectId, proposal.id, deps);
  assert.equal(outcome.status, "failed");
  assert.equal(await readFile(join(folder, "src", "new.ts"), "utf8"), "someone else\n");
});

test("modify fails if the file disappears after the proposal", async () => {
  await resetFiles();
  const proposal = await buildAndSeed({ summary: "s", operations: [{ op: "modify", path: "src/app.ts", content: "x\n" }] });
  await approve(proposal.id);

  await unlink(join(folder, "src", "app.ts"));
  const outcome = await applyProposal(projectId, proposal.id, deps);
  assert.equal(outcome.status, "failed");
});

test("reports partial application and can recover it", async () => {
  await resetFiles();
  await writeFile(join(folder, "src", "second.ts"), "second original\n", "utf8");
  const proposal = await buildAndSeed({
    summary: "s",
    operations: [
      { op: "modify", path: "src/app.ts", content: "export const value = 2;\n" },
      { op: "modify", path: "src/second.ts", content: "second changed\n" },
    ],
  });
  await approve(proposal.id);

  await writeFile(join(folder, "src", "second.ts"), "second newer\n", "utf8");
  const outcome = await applyProposal(projectId, proposal.id, deps);
  assert.equal(outcome.status, "partial");
  assert.equal(await readFile(join(folder, "src", "app.ts"), "utf8"), "export const value = 2;\n");
  assert.equal(await readFile(join(folder, "src", "second.ts"), "utf8"), "second newer\n");

  const recovered = await recoverProposal(projectId, proposal.id, deps);
  assert.equal(recovered.restored, 1);
  assert.equal(await readFile(join(folder, "src", "app.ts"), "utf8"), "export const value = 1;\n");
});

test("delete removes a file and recovery restores it", async () => {
  await resetFiles();
  const proposal = await buildAndSeed({ summary: "s", operations: [{ op: "delete", path: "src/app.ts" }] });
  await approve(proposal.id);

  const outcome = await applyProposal(projectId, proposal.id, deps);
  assert.equal(outcome.status, "applied");
  await assert.rejects(readFile(join(folder, "src", "app.ts"), "utf8"));

  const recovered = await recoverProposal(projectId, proposal.id, deps);
  assert.equal(recovered.restored, 1);
  assert.equal(await readFile(join(folder, "src", "app.ts"), "utf8"), "export const value = 1;\n");
});

test("recovery refuses when newer user changes exist", async () => {
  await resetFiles();
  const proposal = await buildAndSeed({ summary: "s", operations: [{ op: "modify", path: "src/app.ts", content: "export const value = 2;\n" }] });
  await approve(proposal.id);
  await applyProposal(projectId, proposal.id, deps);

  await writeFile(join(folder, "src", "app.ts"), "export const value = 3;\n", "utf8");
  const recovered = await recoverProposal(projectId, proposal.id, deps);
  assert.equal(recovered.restored, 0);
  assert.deepEqual(recovered.conflicts, ["src/app.ts"]);
  assert.equal(await readFile(join(folder, "src", "app.ts"), "utf8"), "export const value = 3;\n");
});

test("refuses to build or apply through a symlink", async () => {
  await resetFiles();
  await writeFile(join(base, "outside.ts"), "outside\n", "utf8");
  await symlink(join(base, "outside.ts"), join(folder, "src", "link.ts"));
  await assert.rejects(
    buildProposalOperations(service, folder, { summary: "s", operations: [{ op: "modify", path: "src/link.ts", content: "x\n" }] }),
    isCode("INVALID_PATH"),
  );
});

test("refuses cross-project access", async () => {
  await resetFiles();
  const proposal = await buildAndSeed({ summary: "s", operations: [{ op: "modify", path: "src/app.ts", content: "x\n" }] });
  await approve(proposal.id);
  await assert.rejects(applyProposal("different-project", proposal.id, deps), isCode("NOT_FOUND"));
});
