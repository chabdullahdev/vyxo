import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationStore } from "./store.ts";
import { ProjectStore } from "../projects/store.ts";
import { isAuthorizedDesktopRequest } from "../desktop/api-auth.ts";
import {
  createConversationResponse,
  deleteConversationResponse,
  getConversationResponse,
  listConversationsResponse,
  methodNotAllowedResponse,
  updateConversationResponse,
} from "./api.ts";

const root = await mkdtemp(join(tmpdir(), "vyxo-conversation-api-test-"));

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function freshStore(overrides = {}) {
  const dir = await mkdtemp(join(root, "case-"));
  const filePath = join(dir, "conversations.json");
  let tick = 0;
  let counter = 0;
  const store = new ConversationStore({
    filePath,
    clock: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
    idFactory: () => `id-${++counter}`,
    ...overrides,
  });
  return { store, filePath, dir };
}

function jsonRequest(method, body, options = {}) {
  const { contentType = "application/json", rawBody, url = "http://localhost/api/conversations" } = options;
  const init = { method, headers: {} };
  if (contentType !== null) init.headers["Content-Type"] = contentType;
  if (rawBody !== undefined) {
    init.body = rawBody;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

async function freshProjectStore() {
  const dir = await mkdtemp(join(root, "projects-"));
  let counter = 0;
  return new ProjectStore({
    filePath: join(dir, "projects.json"),
    idFactory: () => `p-${++counter}`,
  });
}

test("associates, moves and clears a conversation's project through the API", async () => {
  const { store } = await freshStore();
  const projectStore = await freshProjectStore();
  const alpha = await projectStore.createProject("Alpha");
  const beta = await projectStore.createProject("Beta");

  const created = await createConversationResponse(
    store,
    jsonRequest("POST", { projectId: alpha.id }),
    projectStore,
  );
  assert.equal(created.status, 201);
  const conversationId = (await created.json()).conversation.id;

  const unknown = await createConversationResponse(
    store,
    jsonRequest("POST", { projectId: "missing" }),
    projectStore,
  );
  assert.equal(unknown.status, 400);
  assert.match((await unknown.json()).error, /does not exist/i);

  const badType = await createConversationResponse(store, jsonRequest("POST", { projectId: 42 }), projectStore);
  assert.equal(badType.status, 400);

  const moved = await updateConversationResponse(
    store,
    conversationId,
    jsonRequest("PATCH", { projectId: beta.id }),
    projectStore,
  );
  assert.equal(moved.status, 200);
  assert.equal((await moved.json()).conversation.projectId, beta.id);

  const listed = await listConversationsResponse(
    store,
    jsonRequest("GET", undefined, { url: "http://localhost/api/conversations?projectId=p-2&archived=all" }),
  );
  assert.deepEqual((await listed.json()).conversations.map((item) => item.id), [conversationId]);

  const cleared = await updateConversationResponse(
    store,
    conversationId,
    jsonRequest("PATCH", { projectId: null }),
    projectStore,
  );
  assert.equal((await cleared.json()).conversation.projectId, null);

  const toMissing = await updateConversationResponse(
    store,
    conversationId,
    jsonRequest("PATCH", { projectId: "missing" }),
    projectStore,
  );
  assert.equal(toMissing.status, 400);
});

test("GET returns an empty list on first use", async () => {
  const { store } = await freshStore();
  const response = await listConversationsResponse(store, jsonRequest("GET"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { conversations: [] });
});

test("POST creates a conversation and GET lists it", async () => {
  const { store } = await freshStore();

  const created = await createConversationResponse(store, jsonRequest("POST", { title: "Plan" }));
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.conversation.title, "Plan");
  assert.equal(createdBody.conversation.id, "id-1");

  const list = await listConversationsResponse(store, jsonRequest("GET"));
  assert.equal((await list.json()).conversations.length, 1);
});

test("POST accepts an empty body and rejects invalid input", async () => {
  const { store } = await freshStore();

  const empty = await createConversationResponse(store, jsonRequest("POST", {}));
  assert.equal(empty.status, 201);

  const cases = [
    jsonRequest("POST", { title: 42 }),
    jsonRequest("POST", undefined, { rawBody: "{ not json" }),
    jsonRequest("POST", [1, 2, 3]),
  ];
  for (const request of cases) {
    const response = await createConversationResponse(store, request);
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, "string");
  }
});

test("POST and PATCH require an application/json content type", async () => {
  const { store } = await freshStore();
  const post = await createConversationResponse(
    store,
    jsonRequest("POST", { title: "x" }, { contentType: "text/plain" }),
  );
  assert.equal(post.status, 415);

  const created = await (await createConversationResponse(store, jsonRequest("POST", {}))).json();
  const patch = await updateConversationResponse(
    store,
    created.conversation.id,
    jsonRequest("PATCH", { title: "y" }, { contentType: "text/plain" }),
  );
  assert.equal(patch.status, 415);
});

test("GET by id returns the conversation or a safe 404", async () => {
  const { store } = await freshStore();
  await createConversationResponse(store, jsonRequest("POST", { title: "One" }));

  const found = await getConversationResponse(store, "id-1");
  assert.equal(found.status, 200);
  assert.equal((await found.json()).conversation.title, "One");

  const missing = await getConversationResponse(store, "does-not-exist");
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, "Conversation not found.");
});

test("PATCH renames, archives and unarchives, and validates its body", async () => {
  const { store } = await freshStore();
  await createConversationResponse(store, jsonRequest("POST", { title: "Before" }));

  const renamed = await updateConversationResponse(store, "id-1", jsonRequest("PATCH", { title: "After" }));
  assert.equal(renamed.status, 200);
  assert.equal((await renamed.json()).conversation.title, "After");

  const archived = await updateConversationResponse(store, "id-1", jsonRequest("PATCH", { archived: true }));
  assert.equal(archived.status, 200);
  assert.equal((await archived.json()).conversation.archived, true);

  assert.deepEqual(
    (await listConversationsResponse(store, jsonRequest("GET", undefined, { url: "http://localhost/api/conversations?archived=archived" })).then((r) => r.json())).conversations.length,
    1,
  );

  const restored = await updateConversationResponse(store, "id-1", jsonRequest("PATCH", { archived: false }));
  assert.equal((await restored.json()).conversation.archived, false);

  const empty = await updateConversationResponse(store, "id-1", jsonRequest("PATCH", {}));
  assert.equal(empty.status, 400);

  const badArchived = await updateConversationResponse(store, "id-1", jsonRequest("PATCH", { archived: "yes" }));
  assert.equal(badArchived.status, 400);

  const missing = await updateConversationResponse(store, "nope", jsonRequest("PATCH", { title: "x" }));
  assert.equal(missing.status, 404);
});

test("DELETE removes a conversation and reports a missing one", async () => {
  const { store } = await freshStore();
  await createConversationResponse(store, jsonRequest("POST", { title: "Bye" }));

  const deleted = await deleteConversationResponse(store, "id-1");
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { deleted: true });

  const again = await deleteConversationResponse(store, "id-1");
  assert.equal(again.status, 404);
});

test("GET searches titles and message text", async () => {
  const { store } = await freshStore();
  await createConversationResponse(store, jsonRequest("POST", { title: "Work plan" }));
  const recipes = await createConversationResponse(store, jsonRequest("POST", { title: "Recipes" }));
  const recipesId = (await recipes.json()).conversation.id;

  const search = await listConversationsResponse(
    store,
    jsonRequest("GET", undefined, { url: "http://localhost/api/conversations?q=work" }),
  );
  assert.deepEqual((await search.json()).conversations.map((item) => item.id), ["id-1"]);

  const invalid = await listConversationsResponse(
    store,
    jsonRequest("GET", undefined, { url: "http://localhost/api/conversations?archived=weird" }),
  );
  assert.equal(invalid.status, 400);

  const tooLong = await listConversationsResponse(
    store,
    jsonRequest("GET", undefined, { url: `http://localhost/api/conversations?q=${"a".repeat(201)}` }),
  );
  assert.equal(tooLong.status, 400);

  assert.equal(recipesId, "id-2");
});

test("unsupported methods return 405 with an Allow header", async () => {
  const response = methodNotAllowedResponse(["GET", "POST"]);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET, POST");
});

test("storage failures return a safe 500 without leaking paths or data", async () => {
  const { store, filePath } = await freshStore();
  const corrupt = "{ this is not valid json";
  await writeFile(filePath, corrupt, "utf8");

  const list = await listConversationsResponse(store, jsonRequest("GET"));
  assert.equal(list.status, 500);
  const listBody = await list.json();
  assert.equal(listBody.error, "The conversation store is unavailable.");
  assert.ok(!listBody.error.includes(root));

  const create = await createConversationResponse(store, jsonRequest("POST", { title: "no" }));
  assert.equal(create.status, 500);

  assert.equal(await readFile(filePath, "utf8"), corrupt);
});

test("starting a chat in a project saves the association and survives reload", async () => {
  const { store, filePath } = await freshStore();
  const projectStore = await freshProjectStore();
  const projectA = await projectStore.createProject("Project A");

  const created = await createConversationResponse(
    store,
    jsonRequest("POST", { projectId: projectA.id }),
    projectStore,
  );
  assert.equal(created.status, 201);
  const conversationId = (await created.json()).conversation.id;

  const reopened = new ConversationStore({ filePath });
  const persisted = await reopened.getConversation(conversationId);
  assert.equal(persisted.projectId, projectA.id);

  const listed = await listConversationsResponse(
    store,
    jsonRequest("GET", undefined, { url: `http://localhost/api/conversations?projectId=${projectA.id}&archived=all` }),
  );
  assert.deepEqual((await listed.json()).conversations.map((item) => item.id), [conversationId]);
});

test("conversations in different projects stay in the correct project", async () => {
  const { store } = await freshStore();
  const projectStore = await freshProjectStore();
  const projectA = await projectStore.createProject("Project A");
  const projectB = await projectStore.createProject("Project B");

  const inA = await (await createConversationResponse(store, jsonRequest("POST", { projectId: projectA.id }), projectStore)).json();
  const inB = await (await createConversationResponse(store, jsonRequest("POST", { projectId: projectB.id }), projectStore)).json();
  const unassigned = await (await createConversationResponse(store, jsonRequest("POST", {}), projectStore)).json();

  assert.equal(inA.conversation.projectId, projectA.id);
  assert.equal(inB.conversation.projectId, projectB.id);
  assert.equal(unassigned.conversation.projectId, null);

  const listA = await listConversationsResponse(store, jsonRequest("GET", undefined, { url: `http://localhost/api/conversations?projectId=${projectA.id}&archived=all` }));
  assert.deepEqual((await listA.json()).conversations.map((item) => item.id), [inA.conversation.id]);

  const listB = await listConversationsResponse(store, jsonRequest("GET", undefined, { url: `http://localhost/api/conversations?projectId=${projectB.id}&archived=all` }));
  assert.deepEqual((await listB.json()).conversations.map((item) => item.id), [inB.conversation.id]);
});

test("moving one conversation does not change unrelated associations", async () => {
  const { store } = await freshStore();
  const projectStore = await freshProjectStore();
  const projectA = await projectStore.createProject("Project A");
  const projectB = await projectStore.createProject("Project B");

  const first = await (await createConversationResponse(store, jsonRequest("POST", { projectId: projectA.id }), projectStore)).json();
  const second = await (await createConversationResponse(store, jsonRequest("POST", { projectId: projectA.id }), projectStore)).json();

  const moved = await updateConversationResponse(
    store,
    first.conversation.id,
    jsonRequest("PATCH", { projectId: projectB.id }),
    projectStore,
  );
  assert.equal((await moved.json()).conversation.projectId, projectB.id);

  const untouched = await getConversationResponse(store, second.conversation.id);
  assert.equal((await untouched.json()).conversation.projectId, projectA.id);

  const removed = await updateConversationResponse(
    store,
    second.conversation.id,
    jsonRequest("PATCH", { projectId: null }),
    projectStore,
  );
  assert.equal((await removed.json()).conversation.projectId, null);
});

test("invalid or unknown project ids are rejected with a clear error", async () => {
  const { store } = await freshStore();
  const projectStore = await freshProjectStore();

  const malformed = await createConversationResponse(
    store,
    jsonRequest("POST", { projectId: "not a valid id" }),
    projectStore,
  );
  assert.equal(malformed.status, 400);
  assert.match((await malformed.json()).error, /not a valid id/i);

  const unknown = await createConversationResponse(
    store,
    jsonRequest("POST", { projectId: "missing-project" }),
    projectStore,
  );
  assert.equal(unknown.status, 400);
  assert.match((await unknown.json()).error, /does not exist/i);

  const created = await (await createConversationResponse(store, jsonRequest("POST", {}), projectStore)).json();
  const badMove = await updateConversationResponse(
    store,
    created.conversation.id,
    jsonRequest("PATCH", { projectId: "not a valid id" }),
    projectStore,
  );
  assert.equal(badMove.status, 400);

  const stillUnassigned = await getConversationResponse(store, created.conversation.id);
  assert.equal((await stillUnassigned.json()).conversation.projectId, null);
});

test("conversation endpoints share the desktop local-only authentication contract", () => {
  const previous = new Map(
    ["SHIPSTUDIO_DESKTOP", "SHIPSTUDIO_DESKTOP_TOKEN", "SHIPSTUDIO_DESKTOP_ORIGIN"].map((key) => [
      key,
      process.env[key],
    ]),
  );
  for (const key of previous.keys()) delete process.env[key];

  try {
    assert.equal(
      isAuthorizedDesktopRequest(new Request("http://127.0.0.1:49321/api/conversations")),
      true,
    );

    process.env.SHIPSTUDIO_DESKTOP = "1";
    process.env.SHIPSTUDIO_DESKTOP_TOKEN = "synthetic-token";
    process.env.SHIPSTUDIO_DESKTOP_ORIGIN = "http://127.0.0.1:49321";

    const unauthorized = new Request("http://127.0.0.1:49321/api/conversations", {
      headers: { host: "127.0.0.1:49321", origin: "http://127.0.0.1:49321" },
    });
    assert.equal(isAuthorizedDesktopRequest(unauthorized), false);

    const authorized = new Request("http://127.0.0.1:49321/api/conversations", {
      headers: {
        host: "127.0.0.1:49321",
        origin: "http://127.0.0.1:49321",
        "x-shipstudio-desktop-token": "synthetic-token",
      },
    });
    assert.equal(isAuthorizedDesktopRequest(authorized), true);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
