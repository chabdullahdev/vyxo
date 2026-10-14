import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "./store.ts";
import { PROJECT_CONTEXT_FIELD_LIMITS } from "./context.ts";
import { ConversationStore } from "../conversations/store.ts";
import {
  createProjectResponse,
  deleteProjectResponse,
  getProjectResponse,
  listProjectsResponse,
  methodNotAllowedResponse,
  updateProjectResponse,
} from "./api.ts";

const root = await mkdtemp(join(tmpdir(), "vyxo-project-api-test-"));

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function freshStores() {
  const dir = await mkdtemp(join(root, "case-"));
  let tick = 0;
  let counter = 0;
  const projectStore = new ProjectStore({
    filePath: join(dir, "projects.json"),
    clock: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
    idFactory: () => `p-${++counter}`,
  });
  const conversationStore = new ConversationStore({
    filePath: join(dir, "conversations.json"),
    clock: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
    idFactory: () => `c-${++counter}`,
  });
  return { projectStore, conversationStore, dir };
}

function jsonRequest(method, body, options = {}) {
  const { contentType = "application/json", rawBody, url = "http://localhost/api/projects" } = options;
  const init = { method, headers: {} };
  if (contentType !== null) init.headers["Content-Type"] = contentType;
  if (rawBody !== undefined) init.body = rawBody;
  else if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(url, init);
}

test("GET returns an empty project list on first use", async () => {
  const { projectStore, conversationStore } = await freshStores();
  const response = await listProjectsResponse(projectStore, conversationStore, jsonRequest("GET"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { projects: [] });
});

test("POST creates a project and GET lists it with a conversation count", async () => {
  const { projectStore, conversationStore } = await freshStores();

  const created = await createProjectResponse(projectStore, jsonRequest("POST", { name: "Website", description: "Rebuild" }));
  assert.equal(created.status, 201);
  const project = (await created.json()).project;
  assert.equal(project.name, "Website");

  await conversationStore.createConversation("Chat one", project.id);
  await conversationStore.createConversation("Chat two", project.id);
  await conversationStore.createConversation("Unassigned");

  const list = await listProjectsResponse(projectStore, conversationStore, jsonRequest("GET"));
  const body = await list.json();
  assert.equal(body.projects.length, 1);
  assert.equal(body.projects[0].conversationCount, 2);
});

test("GET by id and PATCH update name, description, and archive state", async () => {
  const { projectStore, conversationStore } = await freshStores();
  await createProjectResponse(projectStore, jsonRequest("POST", { name: "Before" }));

  const found = await getProjectResponse(projectStore, "p-1");
  assert.equal(found.status, 200);

  const renamed = await updateProjectResponse(projectStore, "p-1", jsonRequest("PATCH", { name: "After", description: "New" }));
  assert.equal(renamed.status, 200);
  const project = (await renamed.json()).project;
  assert.equal(project.name, "After");
  assert.equal(project.description, "New");

  const archived = await updateProjectResponse(projectStore, "p-1", jsonRequest("PATCH", { archived: true }));
  assert.equal((await archived.json()).project.archived, true);

  const list = await listProjectsResponse(projectStore, conversationStore, jsonRequest("GET", undefined, { url: "http://localhost/api/projects?archived=archived" }));
  assert.equal((await list.json()).projects.length, 1);

  const empty = await updateProjectResponse(projectStore, "p-1", jsonRequest("PATCH", {}));
  assert.equal(empty.status, 400);

  const missing = await updateProjectResponse(projectStore, "nope", jsonRequest("PATCH", { name: "x" }));
  assert.equal(missing.status, 404);
});

test("DELETE removes the project and unassigns its conversations without deleting them", async () => {
  const { projectStore, conversationStore } = await freshStores();
  await createProjectResponse(projectStore, jsonRequest("POST", { name: "Doomed" }));
  const conversation = await conversationStore.createConversation("Keep me", "p-1");

  const deleted = await deleteProjectResponse(projectStore, conversationStore, "p-1");
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { deleted: true });

  const stillThere = await conversationStore.getConversation(conversation.id);
  assert.equal(stillThere.projectId, null);

  const missing = await deleteProjectResponse(projectStore, conversationStore, "p-1");
  assert.equal(missing.status, 404);
});

test("POST and PATCH validate their bodies and content type", async () => {
  const { projectStore } = await freshStores();

  assert.equal((await createProjectResponse(projectStore, jsonRequest("POST", { name: 42 }))).status, 400);
  assert.equal((await createProjectResponse(projectStore, jsonRequest("POST", { name: "x" }, { contentType: "text/plain" }))).status, 415);
  assert.equal((await createProjectResponse(projectStore, jsonRequest("POST", undefined, { rawBody: "{ bad" }))).status, 400);

  await createProjectResponse(projectStore, jsonRequest("POST", { name: "One" }));
  assert.equal((await updateProjectResponse(projectStore, "p-1", jsonRequest("PATCH", { archived: "yes" }))).status, 400);
});

test("PATCH persists project context and GET returns it", async () => {
  const { projectStore } = await freshStores();
  await createProjectResponse(projectStore, jsonRequest("POST", { name: "With context" }));

  const patched = await updateProjectResponse(
    projectStore,
    "p-1",
    jsonRequest("PATCH", { context: { purpose: "P", techStack: "Next.js" } }),
  );
  assert.equal(patched.status, 200);
  const project = (await patched.json()).project;
  assert.equal(project.context.purpose, "P");
  assert.equal(project.context.techStack, "Next.js");
  assert.equal(project.context.notes, "");

  const fetched = await getProjectResponse(projectStore, "p-1");
  assert.equal((await fetched.json()).project.context.purpose, "P");
});

test("PATCH rejects invalid or oversized context", async () => {
  const { projectStore } = await freshStores();
  await createProjectResponse(projectStore, jsonRequest("POST", { name: "Ctx" }));

  assert.equal(
    (await updateProjectResponse(projectStore, "p-1", jsonRequest("PATCH", { context: "nope" }))).status,
    400,
  );
  assert.equal(
    (
      await updateProjectResponse(
        projectStore,
        "p-1",
        jsonRequest("PATCH", {
          context: { purpose: "x".repeat(PROJECT_CONTEXT_FIELD_LIMITS.purpose + 1) },
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (await updateProjectResponse(projectStore, "p-1", jsonRequest("PATCH", { context: null }))).status,
    400,
  );
});

test("unsupported methods return 405 with an Allow header", async () => {
  const response = methodNotAllowedResponse(["GET", "POST"]);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET, POST");
});

test("search filters projects and storage failures are safe", async () => {
  const { projectStore, conversationStore, dir } = await freshStores();
  await createProjectResponse(projectStore, jsonRequest("POST", { name: "Alpha" }));
  await createProjectResponse(projectStore, jsonRequest("POST", { name: "Beta" }));

  const search = await listProjectsResponse(projectStore, conversationStore, jsonRequest("GET", undefined, { url: "http://localhost/api/projects?q=alp" }));
  assert.deepEqual((await search.json()).projects.map((project) => project.name), ["Alpha"]);

  await writeFile(join(dir, "projects.json"), "{ broken", "utf8");
  const failure = await listProjectsResponse(projectStore, conversationStore, jsonRequest("GET"));
  assert.equal(failure.status, 500);
  assert.equal((await failure.json()).error, "The project store is unavailable.");
  assert.ok(!(await readFile(join(dir, "projects.json"), "utf8")).includes("Alpha"));
});
