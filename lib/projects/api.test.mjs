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

test("POST creates a workspace project with its own folder, and the folder cannot be reconnected", async () => {
  const { projectStore, dir } = await freshStores();
  const projectsDir = join(dir, "VYXO Projects");

  const response = await createProjectResponse(
    projectStore,
    jsonRequest("POST", { name: "Client A", kind: "managed", template: "client-matter" }),
    { projectsDir },
  );
  assert.equal(response.status, 201);
  const { project } = await response.json();
  assert.equal(project.kind, "managed");
  assert.equal(project.template, "client-matter");
  assert.equal(project.sourceFolder.endsWith("/VYXO Projects/Client A"), true);
  assert.ok((await readFile(join(project.sourceFolder, "overview.md"), "utf8")).includes("Overview"));

  const { connectFolderResponse, disconnectFolderResponse } = await import("../files/api.ts");
  const { ProjectFileService } = await import("../files/service.ts");
  const connect = await connectFolderResponse(
    projectStore,
    new ProjectFileService(),
    project.id,
    jsonRequest("POST", { path: dir }),
  );
  assert.equal(connect.status >= 400, true);
  const disconnect = await disconnectFolderResponse(projectStore, project.id);
  assert.equal(disconnect.status >= 400, true);
  assert.equal((await projectStore.getProject(project.id)).sourceFolder, project.sourceFolder);
});

test("POST validates workspace fields and defaults the template to blank", async () => {
  const { projectStore, dir } = await freshStores();
  const projectsDir = join(dir, "VYXO Projects");
  const post = (body) => createProjectResponse(projectStore, jsonRequest("POST", body), { projectsDir });

  assert.equal((await post({ name: "X", kind: "weird" })).status, 400);
  assert.equal((await post({ name: "X", kind: "managed", template: 5 })).status, 400);
  const unknownTemplate = await post({ name: "X", kind: "managed", template: "nope" });
  assert.equal(unknownTemplate.status, 400);
  assert.equal((await unknownTemplate.json()).code, "INVALID_TEMPLATE");
  assert.equal((await post({ name: "  ", kind: "managed", template: "blank" })).status, 400);

  const blank = await post({ name: "Plain", kind: "managed" });
  assert.equal(blank.status, 201);
  assert.equal((await blank.json()).project.template, "blank");
});

test("DELETE keeps a workspace's files unless asked, and deletes only that project's folder when asked", async () => {
  const { projectStore, conversationStore, dir } = await freshStores();
  const projectsDir = join(dir, "VYXO Projects");
  const make = async (name) =>
    (await (await createProjectResponse(projectStore, jsonRequest("POST", { name, kind: "managed", template: "blank" }), { projectsDir })).json()).project;
  const keep = await make("Keep files");
  const wipe = await make("Wipe files");

  const kept = await deleteProjectResponse(projectStore, conversationStore, keep.id, { projectsDir });
  assert.deepEqual(await kept.json(), { deleted: true, filesRemoved: false, filesNote: null, folder: keep.sourceFolder });
  assert.ok(await readFile(join(keep.sourceFolder, "README.md"), "utf8"));

  const wiped = await deleteProjectResponse(projectStore, conversationStore, wipe.id, { projectsDir, deleteFiles: true });
  const body = await wiped.json();
  assert.equal(body.filesRemoved, true);
  await assert.rejects(readFile(join(wipe.sourceFolder, "README.md"), "utf8"), { code: "ENOENT" });
  assert.ok(await readFile(join(keep.sourceFolder, "README.md"), "utf8"));
});

test("DELETE refuses to delete files for a connected project", async () => {
  const { projectStore, conversationStore, dir } = await freshStores();
  const created = await (await createProjectResponse(projectStore, jsonRequest("POST", { name: "Mine" }))).json();
  const response = await deleteProjectResponse(projectStore, conversationStore, created.project.id, {
    projectsDir: join(dir, "VYXO Projects"),
    deleteFiles: true,
  });
  assert.equal(response.status, 400);
  assert.equal((await projectStore.listProjects()).length, 1, "the project must not be removed when the request is refused");
});

test("DELETE removes the project even if the files cannot be deleted, and says so", async () => {
  const { projectStore, conversationStore, dir } = await freshStores();
  const projectsDir = join(dir, "VYXO Projects");
  const created = await (
    await createProjectResponse(projectStore, jsonRequest("POST", { name: "Odd", kind: "managed", template: "blank" }), { projectsDir })
  ).json();
  await rm(join(created.project.sourceFolder, ".vyxo", "project.json")); // folder no longer provably this project's
  const response = await deleteProjectResponse(projectStore, conversationStore, created.project.id, { projectsDir, deleteFiles: true });
  const body = await response.json();
  assert.equal(body.deleted, true);
  assert.equal(body.filesRemoved, false);
  assert.match(body.filesNote, /does not belong/);
  assert.ok(await readFile(join(created.project.sourceFolder, "README.md"), "utf8"), "unverifiable files are left alone");
});
