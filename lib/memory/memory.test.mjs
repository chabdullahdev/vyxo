import { after, test } from "node:test";
import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  MemoryError,
  MemoryStore,
  SCHEMA_VERSION,
  createMemoryStore,
} from "./store.ts";

const VALID_TIMESTAMP = "2026-01-01T00:00:00.000Z";

const root = await mkdtemp(join(tmpdir(), "shipstudio-memory-test-"));

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function freshPath() {
  const dir = await mkdtemp(join(root, "case-"));
  return join(dir, "memories.json");
}

function makeStore(filePath, overrides = {}) {
  let tick = 0;
  let counter = 0;
  return new MemoryStore({
    filePath,
    clock: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
    idFactory: () => `id-${++counter}`,
    ...overrides,
  });
}

const isCode = (code) => (error) =>
  error instanceof MemoryError && error.code === code;

test("first use returns an empty versioned store without creating a file", async () => {
  const path = await freshPath();
  const store = makeStore(path);

  assert.deepEqual(await store.listMemories(), []);
  await assert.rejects(stat(path), (error) => error.code === "ENOENT");
});

test("create, list, get, update and delete work end to end", async () => {
  const path = await freshPath();
  const store = makeStore(path);

  const created = await store.createMemory("  first memory  ");
  assert.equal(created.content, "first memory");
  assert.equal(created.createdAt, created.updatedAt);
  assert.equal((await store.listMemories()).length, 1);
  assert.deepEqual(await store.getMemory(created.id), created);

  const updated = await store.updateMemory(created.id, "updated memory");
  assert.equal(updated.id, created.id);
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.content, "updated memory");
  assert.notEqual(updated.updatedAt, created.updatedAt);

  assert.equal(await store.deleteMemory(created.id), true);
  assert.deepEqual(await store.listMemories(), []);
  assert.equal(await store.deleteMemory(created.id), false);
});

test("persists a versioned document with restrictive permissions", async () => {
  const path = await freshPath();
  const store = makeStore(path);
  await store.createMemory("permission check");

  const parsed = JSON.parse(await readFile(path, "utf8"));
  assert.equal(parsed.version, SCHEMA_VERSION);
  assert.equal(parsed.memories.length, 1);

  if (process.platform !== "win32") {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await stat(dirname(path))).mode & 0o777, 0o700);
  }
});

test("createMemoryStore returns an independent store", async () => {
  const path = await freshPath();
  const store = createMemoryStore({ filePath: path, idFactory: () => "one" });
  const memory = await store.createMemory("hello");
  assert.equal(memory.id, "one");
});

test("rejects empty, whitespace, non-text and oversized content", async () => {
  const path = await freshPath();
  const store = makeStore(path, { maxContentLength: 10 });

  for (const bad of ["", "   ", "\n\t "]) {
    await assert.rejects(store.createMemory(bad), isCode("INVALID_CONTENT"));
  }
  await assert.rejects(store.createMemory("x".repeat(11)), isCode("INVALID_CONTENT"));
  await assert.rejects(store.createMemory(123), isCode("INVALID_CONTENT"));
  await assert.rejects(store.updateMemory("missing", ""), isCode("INVALID_CONTENT"));
});

test("reports missing ids clearly", async () => {
  const path = await freshPath();
  const store = makeStore(path);

  await assert.rejects(store.getMemory("nope"), isCode("NOT_FOUND"));
  await assert.rejects(store.updateMemory("nope", "text"), isCode("NOT_FOUND"));
  assert.equal(await store.deleteMemory("nope"), false);
  await assert.rejects(store.getMemory(""), isCode("INVALID_ARGUMENT"));
});

test("does not silently replace a corrupt file", async () => {
  const path = await freshPath();
  const corrupt = "{ this is not json";
  await writeFile(path, corrupt, "utf8");
  const store = makeStore(path);

  await assert.rejects(store.listMemories(), isCode("CORRUPT_DATA"));
  await assert.rejects(store.createMemory("should not write"), isCode("CORRUPT_DATA"));
  assert.equal(await readFile(path, "utf8"), corrupt);
  assert.deepEqual((await readdir(dirname(path))).filter((f) => f.endsWith(".tmp")), []);
});

test("rejects unsupported schema versions", async () => {
  const path = await freshPath();
  const document = JSON.stringify({ version: 999, memories: [] });
  await writeFile(path, document, "utf8");

  await assert.rejects(makeStore(path).listMemories(), isCode("UNSUPPORTED_VERSION"));
  assert.equal(await readFile(path, "utf8"), document);
});

test("rejects duplicate ids", async () => {
  const path = await freshPath();
  const memory = {
    id: "dup",
    content: "text",
    createdAt: VALID_TIMESTAMP,
    updatedAt: VALID_TIMESTAMP,
  };
  await writeFile(path, JSON.stringify({ version: 1, memories: [memory, { ...memory }] }), "utf8");

  await assert.rejects(makeStore(path).listMemories(), isCode("DUPLICATE_ID"));
});

test("rejects invalid records", async () => {
  const path = await freshPath();
  const store = makeStore(path);
  const badDocuments = [
    { version: 1, memories: [{ id: "a", content: "x", createdAt: "nope", updatedAt: VALID_TIMESTAMP }] },
    { version: 1, memories: [{ id: "a", content: "   ", createdAt: VALID_TIMESTAMP, updatedAt: VALID_TIMESTAMP }] },
    { version: 1, memories: [{ content: "x", createdAt: VALID_TIMESTAMP, updatedAt: VALID_TIMESTAMP }] },
    { version: 1, memories: ["not an object"] },
    { memories: [] },
    { version: 1 },
    { version: "1", memories: [] },
  ];

  for (const document of badDocuments) {
    await writeFile(path, JSON.stringify(document), "utf8");
    await assert.rejects(store.listMemories(), isCode("CORRUPT_DATA"));
  }
});

test("atomic write failure leaves existing data intact", async (t) => {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    t.skip("cannot test a read-only directory as root");
    return;
  }

  const path = await freshPath();
  const store = makeStore(path);
  const first = await store.createMemory("keep me");
  const before = await readFile(path, "utf8");
  const directory = dirname(path);

  await chmod(directory, 0o500);
  try {
    await assert.rejects(store.createMemory("cannot write"), isCode("STORAGE_IO"));
  } finally {
    await chmod(directory, 0o700);
  }

  assert.equal(await readFile(path, "utf8"), before);
  assert.deepEqual(await store.listMemories(), [first]);
  assert.deepEqual((await readdir(directory)).filter((f) => f.endsWith(".tmp")), []);
});

test("concurrent creates do not lose updates", async () => {
  const path = await freshPath();
  const store = makeStore(path);

  const results = await Promise.all(
    Array.from({ length: 25 }, (_, i) => store.createMemory(`memory ${i}`)),
  );

  assert.equal(new Set(results.map((m) => m.id)).size, 25);
  assert.equal((await store.listMemories()).length, 25);
  assert.equal(JSON.parse(await readFile(path, "utf8")).memories.length, 25);
});

test("concurrent updates do not lose unrelated data", async () => {
  const path = await freshPath();
  const store = makeStore(path);

  const created = await Promise.all(
    Array.from({ length: 10 }, (_, i) => store.createMemory(`item ${i}`)),
  );
  await Promise.all(created.map((m, i) => store.updateMemory(m.id, `updated ${i}`)));

  const listed = await store.listMemories();
  assert.deepEqual(
    listed.map((m) => m.content).sort(),
    created.map((_, i) => `updated ${i}`).sort(),
  );
});

test("listMemories returns copies that cannot mutate stored data", async () => {
  const path = await freshPath();
  const store = makeStore(path);
  await store.createMemory("original");

  const list = await store.listMemories();
  list[0].content = "tampered";
  list.length = 0;

  const again = await store.listMemories();
  assert.equal(again.length, 1);
  assert.equal(again[0].content, "original");
});
