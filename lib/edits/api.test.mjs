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

// ---- Build mode for workspace projects ----

import { createManagedProject } from "../workspace/create.ts";

async function managedProject() {
  const store = new ProjectStore({ filePath: join(base, `managed-${Math.random().toString(36).slice(2)}.json`) });
  const project = await createManagedProject(
    { store, projectsDir: join(base, `VYXO Projects ${Math.random().toString(36).slice(2)}`) },
    { name: "Site", template: "website" },
  );
  return { store, project };
}

test("a workspace project's Build request becomes a proposal to review, not a change", async () => {
  const { store, project } = await managedProject();
  const calls = [];
  const response = await createProposalResponse(
    {
      projectStore: store,
      proposalStore,
      service,
      workspaceBuilder: async (input) => {
        calls.push(input);
        return {
          kind: "changes",
          model: "builder-model",
          proposal: { summary: "Dark header", operations: [{ op: "write", path: "styles.css", content: "body{background:#000}\n" }] },
        };
      },
      generate: async () => assert.fail("workspace projects must not use the connected-folder generator"),
    },
    project.id,
    jsonRequest({ request: "make it dark" }),
  );
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.proposal.status, "ready_for_review");
  assert.equal(body.proposal.model, "builder-model");
  assert.equal(body.proposal.operations[0].op, "modify");
  assert.equal(body.proposal.operations[0].path, "styles.css");
  assert.equal(calls[0].folder, project.sourceFolder);
  assert.equal(calls[0].request, "make it dark");
  assert.ok(calls[0].signal, "cancelling the request can stop the model");
  assert.match(await readFile(join(project.sourceFolder, "styles.css"), "utf8"), /--ink/, "nothing is written until approval");
});

test("a workspace project's Build request that is only a question returns the answer", async () => {
  const { store, project } = await managedProject();
  const response = await createProposalResponse(
    { projectStore: store, proposalStore, service, workspaceBuilder: async () => ({ kind: "answer", text: "It is a one-page site.", model: "m" }) },
    project.id,
    jsonRequest({ request: "what is this?" }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { answer: "It is a one-page site.", model: "m" });
  assert.deepEqual((await proposalStore.list(project.id)).length, 0, "no proposal is stored for an answer");
});

test("a Build change that touches nothing real is reported, and a new file is created", async () => {
  const { store, project } = await managedProject();
  const same = await readFile(join(project.sourceFolder, "script.js"), "utf8");
  const unchanged = await createProposalResponse(
    {
      projectStore: store,
      proposalStore,
      service,
      workspaceBuilder: async () => ({ kind: "changes", model: "m", proposal: { summary: "s", operations: [{ op: "write", path: "script.js", content: same }] } }),
    },
    project.id,
    jsonRequest({ request: "nothing" }),
  );
  assert.equal(unchanged.status, 400);
  assert.match((await unchanged.json()).error, /did not change anything/);

  const created = await createProposalResponse(
    {
      projectStore: store,
      proposalStore,
      service,
      workspaceBuilder: async () => ({ kind: "changes", model: "m", proposal: { summary: "New page", operations: [{ op: "write", path: "about.html", content: "<h1>About</h1>\n" }] } }),
    },
    project.id,
    jsonRequest({ request: "add an about page" }),
  );
  assert.equal(created.status, 201);
  assert.equal((await created.json()).proposal.operations[0].op, "create");
});

test("a connected project still uses the original generator and format", async () => {
  const response = await createProposal(
    JSON.stringify({ summary: "Bump value", operations: [{ op: "modify", path: "src/app.ts", content: "export const value = 3;\n" }] }),
  );
  assert.equal(response.status, 201);
});

import { ConversationStore } from "../conversations/store.ts";
import { proposalChatMessage } from "./api.ts";

test("a Build exchange is saved to the project's chat, and only to that project's chat", async () => {
  const { store, project } = await managedProject();
  const conversations = new ConversationStore({ filePath: join(base, `conv-${Math.random().toString(36).slice(2)}.json`) });
  const mine = await conversations.createConversation("Build chat", project.id);
  const other = await conversations.createConversation("Elsewhere", "some-other-project");
  const stranger = await conversations.createConversation("No project", null);

  const builder = async () => ({
    kind: "changes",
    model: "m",
    proposal: { summary: "Added an about page", operations: [{ op: "write", path: "about.html", content: "<h1>About</h1>\n" }] },
  });
  const ask = async (conversationId) =>
    createProposalResponse(
      { projectStore: store, proposalStore, service, conversationStore: conversations, workspaceBuilder: builder },
      project.id,
      jsonRequest({ request: "add an about page", conversationId }),
    );

  const response = await ask(mine.id);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.match(body.assistantMessage, /I prepared 1 change for you to review: Added an about page/);
  assert.match(body.assistantMessage, /new file: `about\.html`/);
  assert.match(body.assistantMessage, /Nothing has been changed yet/);

  const saved = await conversations.getConversation(mine.id);
  assert.deepEqual(saved.messages.map((message) => message.role), ["user", "assistant"]);
  assert.equal(saved.messages[0].content, "add an about page");
  assert.equal(saved.messages[1].content, body.assistantMessage);

  assert.equal((await ask(other.id)).status, 201);
  assert.equal((await conversations.getConversation(other.id)).messages.length, 0, "another project's chat is never written to");
  assert.equal((await ask(stranger.id)).status, 201);
  assert.equal((await conversations.getConversation(stranger.id)).messages.length, 0);
  assert.equal((await ask("does-not-exist")).status, 201, "a missing chat never fails the build");
  assert.equal((await createProposalResponse({ projectStore: store, proposalStore, service, workspaceBuilder: builder }, project.id, jsonRequest({ request: "x" }))).status, 201);
});

test("an answer in Build mode is saved to the project's chat too", async () => {
  const { store, project } = await managedProject();
  const conversations = new ConversationStore({ filePath: join(base, `conv-${Math.random().toString(36).slice(2)}.json`) });
  const chat = await conversations.createConversation("Q", project.id);
  const response = await createProposalResponse(
    { projectStore: store, proposalStore, service, conversationStore: conversations, workspaceBuilder: async () => ({ kind: "answer", text: "Two sections.", model: "m" }) },
    project.id,
    jsonRequest({ request: "what is here?", conversationId: chat.id }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await conversations.getConversation(chat.id)).messages.map((message) => message.content), ["what is here?", "Two sections."]);
});

test("the review message is plain, accurate, and honest that nothing changed yet", () => {
  const message = proposalChatMessage({
    summary: "Tidied the notes",
    operations: [
      { op: "modify", path: "a.md", diff: { added: 3, removed: 1 } },
      { op: "delete", path: "b.md", diff: null },
    ],
  });
  assert.match(message, /I prepared 2 changes/);
  assert.match(message, /- change: `a\.md` \(\+3 −1\)/);
  assert.match(message, /- delete: `b\.md`/);
});
