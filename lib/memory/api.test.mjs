import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "./store.ts";
import {
  createMemoryResponse,
  deleteMemoryResponse,
  getMemoryResponse,
  listMemoriesResponse,
  methodNotAllowedResponse,
  updateMemoryResponse,
} from "./api.ts";

const root = await mkdtemp(join(tmpdir(), "shipstudio-memory-api-test-"));

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function freshStore(overrides = {}) {
  const dir = await mkdtemp(join(root, "case-"));
  const filePath = join(dir, "memories.json");
  let tick = 0;
  let counter = 0;
  const store = new MemoryStore({
    filePath,
    clock: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
    idFactory: () => `id-${++counter}`,
    ...overrides,
  });
  return { store, filePath, dir };
}

function jsonRequest(method, body, options = {}) {
  const { contentType = "application/json", rawBody } = options;
  const init = { method, headers: {} };
  if (contentType !== null) init.headers["Content-Type"] = contentType;
  if (rawBody !== undefined) {
    init.body = rawBody;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request("http://localhost/api/memories", init);
}

test("GET returns an empty list on first use", async () => {
  const { store } = await freshStore();
  const response = await listMemoriesResponse(store);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { memories: [] });
});

test("POST creates a memory and GET lists it", async () => {
  const { store } = await freshStore();

  const created = await createMemoryResponse(
    store,
    jsonRequest("POST", { content: "  remember this  " }),
  );
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.memory.content, "remember this");
  assert.equal(createdBody.memory.id, "id-1");

  const list = await listMemoriesResponse(store);
  assert.equal((await list.json()).memories.length, 1);
});

test("POST rejects invalid input", async () => {
  const { store } = await freshStore();

  const cases = [
    jsonRequest("POST", { content: "" }),
    jsonRequest("POST", { content: "   " }),
    jsonRequest("POST", { content: 42 }),
    jsonRequest("POST", {}),
    jsonRequest("POST", [1, 2, 3]),
    jsonRequest("POST", undefined, { rawBody: "{ not json" }),
    jsonRequest("POST", { content: "x".repeat(10_001) }),
  ];

  for (const request of cases) {
    const response = await createMemoryResponse(store, request);
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, "string");
  }
});

test("POST requires an application/json content type", async () => {
  const { store } = await freshStore();
  const response = await createMemoryResponse(
    store,
    jsonRequest("POST", { content: "text" }, { contentType: "text/plain" }),
  );
  assert.equal(response.status, 415);
});

test("GET by id returns the memory or a safe 404", async () => {
  const { store } = await freshStore();
  await createMemoryResponse(store, jsonRequest("POST", { content: "one" }));

  const found = await getMemoryResponse(store, "id-1");
  assert.equal(found.status, 200);
  assert.equal((await found.json()).memory.content, "one");

  const missing = await getMemoryResponse(store, "does-not-exist");
  assert.equal(missing.status, 404);
  const missingBody = await missing.json();
  assert.equal(missingBody.error, "Memory not found.");
});

test("PATCH updates content and preserves createdAt", async () => {
  const { store } = await freshStore();
  const created = await (
    await createMemoryResponse(store, jsonRequest("POST", { content: "before" }))
  ).json();

  const updated = await updateMemoryResponse(
    store,
    "id-1",
    jsonRequest("PATCH", { content: "after" }),
  );
  assert.equal(updated.status, 200);
  const body = (await updated.json()).memory;
  assert.equal(body.content, "after");
  assert.equal(body.id, created.memory.id);
  assert.equal(body.createdAt, created.memory.createdAt);
  assert.notEqual(body.updatedAt, created.memory.updatedAt);

  const missing = await updateMemoryResponse(
    store,
    "nope",
    jsonRequest("PATCH", { content: "after" }),
  );
  assert.equal(missing.status, 404);
});

test("DELETE removes a memory and reports a missing one", async () => {
  const { store } = await freshStore();
  await createMemoryResponse(store, jsonRequest("POST", { content: "bye" }));

  const deleted = await deleteMemoryResponse(store, "id-1");
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { deleted: true });

  const again = await deleteMemoryResponse(store, "id-1");
  assert.equal(again.status, 404);

  assert.deepEqual((await (await listMemoriesResponse(store)).json()).memories, []);
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

  const list = await listMemoriesResponse(store);
  assert.equal(list.status, 500);
  const listBody = await list.json();
  assert.equal(listBody.error, "The memory store is unavailable.");
  assert.ok(!listBody.error.includes(root));

  const create = await createMemoryResponse(
    store,
    jsonRequest("POST", { content: "should not be written" }),
  );
  assert.equal(create.status, 500);

  assert.equal(await readFile(filePath, "utf8"), corrupt);
});
