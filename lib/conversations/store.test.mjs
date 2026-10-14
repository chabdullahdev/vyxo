import { after, test } from "node:test";
import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
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
  CONVERSATION_SCHEMA_VERSION,
  ConversationError,
  ConversationStore,
  conversationMatchesQuery,
  createConversationStore,
  deriveConversationTitle,
} from "./store.ts";
import { MemoryStore } from "../memory/store.ts";

const VALID_TIMESTAMP = "2026-01-01T00:00:00.000Z";

const root = await mkdtemp(join(tmpdir(), "vyxo-conversation-test-"));

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function freshPath() {
  const dir = await mkdtemp(join(root, "case-"));
  return join(dir, "conversations.json");
}

function makeStore(filePath, overrides = {}) {
  let tick = 0;
  let counter = 0;
  return new ConversationStore({
    filePath,
    clock: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
    idFactory: () => `id-${++counter}`,
    ...overrides,
  });
}

const isCode = (code) => (error) =>
  error instanceof ConversationError && error.code === code;

function message(overrides = {}) {
  return {
    id: "m-1",
    role: "user",
    content: "hello",
    status: "complete",
    createdAt: VALID_TIMESTAMP,
    ...overrides,
  };
}

function conversation(overrides = {}) {
  return {
    id: "c-1",
    title: "Test",
    createdAt: VALID_TIMESTAMP,
    updatedAt: VALID_TIMESTAMP,
    archived: false,
    messages: [],
    ...overrides,
  };
}

test("first use returns an empty list without creating a file", async () => {
  const path = await freshPath();
  const store = makeStore(path);

  assert.deepEqual(await store.listConversations(), []);
  await assert.rejects(stat(path), (error) => error.code === "ENOENT");
});

test("creates, lists, renames, archives, unarchives and deletes conversations", async () => {
  const path = await freshPath();
  const store = makeStore(path);

  const created = await store.createConversation("  Plan  ");
  assert.equal(created.title, "Plan");
  assert.equal(created.archived, false);
  assert.deepEqual(created.messages, []);

  assert.equal((await store.listConversations()).length, 1);
  assert.deepEqual(await store.getConversation(created.id), created);

  const renamed = await store.renameConversation(created.id, "Roadmap");
  assert.equal(renamed.title, "Roadmap");
  assert.equal(renamed.createdAt, created.createdAt);

  const archived = await store.setConversationArchived(created.id, true);
  assert.equal(archived.archived, true);
  assert.deepEqual(await store.listConversations({ archived: "active" }), []);
  assert.equal((await store.listConversations({ archived: "archived" })).length, 1);
  assert.equal((await store.listConversations({ archived: "all" })).length, 1);

  assert.equal(await store.setConversationArchived(created.id, false).then((c) => c.archived), false);

  assert.equal(await store.deleteConversation(created.id), true);
  assert.deepEqual(await store.listConversations(), []);
  assert.equal(await store.deleteConversation(created.id), false);
});

test("derives a title from the opening user message and keeps it", async () => {
  const path = await freshPath();
  const store = makeStore(path);
  const created = await store.createConversation();

  const first = await store.appendUserMessage(created.id, {
    content: "How do I structure a Next.js project?",
  });
  assert.equal(first.created, true);
  assert.equal(first.conversation.title, "How do I structure a Next.js project?");

  const second = await store.appendUserMessage(created.id, {
    content: "And what about testing?",
  });
  assert.equal(second.conversation.title, "How do I structure a Next.js project?");
});

test("returns an idempotent result when the same user message id is appended twice", async () => {
  const path = await freshPath();
  const store = makeStore(path);
  const created = await store.createConversation();

  const first = await store.appendUserMessage(created.id, { id: "user-1", content: "retry me" });
  assert.equal(first.created, true);

  const second = await store.appendUserMessage(created.id, { id: "user-1", content: "retry me" });
  assert.equal(second.created, false);

  const stored = await store.getConversation(created.id);
  assert.equal(stored.messages.length, 1);
});

test("records complete, interrupted and failed assistant responses distinctly", async () => {
  const path = await freshPath();
  const store = makeStore(path);
  const created = await store.createConversation();
  await store.appendUserMessage(created.id, { content: "explain streams" });

  const complete = await store.appendAssistantMessage(created.id, {
    content: "A stream emits chunks.",
    status: "complete",
  });
  assert.equal(complete.message.status, "complete");

  const interrupted = await store.appendAssistantMessage(created.id, {
    content: "Partial answer",
    status: "interrupted",
  });
  assert.equal(interrupted.message.status, "interrupted");

  const failed = await store.appendAssistantMessage(created.id, {
    content: "",
    status: "failed",
    error: "Couldn't reach the local model.",
  });
  assert.equal(failed.message.status, "failed");
  assert.equal(failed.message.error, "Couldn't reach the local model.");

  await assert.rejects(
    store.appendAssistantMessage(created.id, { content: "", status: "complete" }),
    isCode("INVALID_CONTENT"),
  );
  await assert.rejects(
    store.appendAssistantMessage(created.id, { content: "", status: "interrupted" }),
    isCode("INVALID_CONTENT"),
  );
  await assert.rejects(
    store.appendAssistantMessage(created.id, { content: "x", status: "failed" }),
    isCode("INVALID_STATUS"),
  );
  await assert.rejects(
    store.appendAssistantMessage(created.id, { content: "x", status: "weird" }),
    isCode("INVALID_STATUS"),
  );
});

test("persists conversations across store reinitialization", async () => {
  const path = await freshPath();
  const store = makeStore(path);
  const created = await store.createConversation("Persist");
  await store.appendUserMessage(created.id, { content: "Remember the plan." });
  await store.appendAssistantMessage(created.id, { content: "Saved.", status: "complete" });

  const reopened = makeStore(path);
  const listed = await reopened.listConversations();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].title, "Persist");

  const fetched = await reopened.getConversation(created.id);
  assert.equal(fetched.messages.length, 2);
  assert.equal(fetched.messages[0].role, "user");
  assert.equal(fetched.messages[1].status, "complete");
});

test("persists a versioned document with restrictive permissions", async () => {
  const path = await freshPath();
  const store = makeStore(path);
  await store.createConversation("Permissions");

  const parsed = JSON.parse(await readFile(path, "utf8"));
  assert.equal(parsed.version, CONVERSATION_SCHEMA_VERSION);
  assert.equal(parsed.conversations.length, 1);

  if (process.platform !== "win32") {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await stat(dirname(path))).mode & 0o777, 0o700);
  }
});

test("createConversationStore returns an independent store", async () => {
  const path = await freshPath();
  const store = createConversationStore({ filePath: path, idFactory: () => "one" });
  const created = await store.createConversation("Independent");
  assert.equal(created.id, "one");
});

test("rejects invalid titles, content, ids and arguments", async () => {
  const path = await freshPath();
  const store = makeStore(path, { maxTitleLength: 10, maxMessageLength: 10 });
  const created = await store.createConversation("ok");

  await assert.rejects(store.createConversation(42), isCode("INVALID_TITLE"));
  await assert.rejects(store.createConversation("x".repeat(11)), isCode("INVALID_TITLE"));
  await assert.rejects(store.renameConversation(created.id, "   "), isCode("INVALID_TITLE"));
  await assert.rejects(store.renameConversation(created.id, "y".repeat(11)), isCode("INVALID_TITLE"));
  await assert.rejects(store.renameConversation("missing", "ok"), isCode("NOT_FOUND"));

  await assert.rejects(
    store.appendUserMessage(created.id, { content: "   " }),
    isCode("INVALID_CONTENT"),
  );
  await assert.rejects(
    store.appendUserMessage(created.id, { content: "z".repeat(11) }),
    isCode("INVALID_CONTENT"),
  );
  await assert.rejects(
    store.appendUserMessage(created.id, { id: "has space", content: "hi" }),
    isCode("INVALID_ARGUMENT"),
  );
  await assert.rejects(store.getConversation(""), isCode("INVALID_ARGUMENT"));
  await assert.rejects(
    store.setConversationArchived(created.id, "yes"),
    isCode("INVALID_ARGUMENT"),
  );
  await assert.rejects(
    store.appendUserMessage("missing", { content: "hi" }),
    isCode("NOT_FOUND"),
  );
});

test("does not silently replace a corrupt file", async () => {
  const path = await freshPath();
  const corrupt = "{ this is not json";
  await writeFile(path, corrupt, "utf8");
  const store = makeStore(path);

  await assert.rejects(store.listConversations(), isCode("CORRUPT_DATA"));
  await assert.rejects(store.createConversation("no write"), isCode("CORRUPT_DATA"));
  assert.equal(await readFile(path, "utf8"), corrupt);
  assert.deepEqual((await readdir(dirname(path))).filter((f) => f.endsWith(".tmp")), []);
});

test("rejects unsupported schema versions", async () => {
  const path = await freshPath();
  const document = JSON.stringify({ version: 999, conversations: [] });
  await writeFile(path, document, "utf8");
  await assert.rejects(makeStore(path).listConversations(), isCode("UNSUPPORTED_VERSION"));
  assert.equal(await readFile(path, "utf8"), document);
});

test("rejects duplicate conversation and message ids", async () => {
  const path = await freshPath();
  await writeFile(
    path,
    JSON.stringify({
      version: 1,
      conversations: [conversation(), conversation({ title: "Other" })],
    }),
    "utf8",
  );
  await assert.rejects(makeStore(path).listConversations(), isCode("DUPLICATE_ID"));

  await writeFile(
    path,
    JSON.stringify({
      version: 1,
      conversations: [conversation({ messages: [message(), message({ content: "again" })] })],
    }),
    "utf8",
  );
  await assert.rejects(makeStore(path).listConversations(), isCode("DUPLICATE_ID"));
});

test("rejects invalid stored records", async () => {
  const path = await freshPath();
  const store = makeStore(path);
  const badDocuments = [
    { version: 1, conversations: [conversation({ createdAt: "nope" })] },
    { version: 1, conversations: [conversation({ updatedAt: "nope" })] },
    { version: 1, conversations: [conversation({ archived: "no" })] },
    { version: 1, conversations: [conversation({ messages: "not an array" })] },
    { version: 1, conversations: [conversation({ messages: [message({ role: "system" })] })] },
    { version: 1, conversations: [conversation({ messages: [message({ status: "pending" })] })] },
    { version: 1, conversations: [conversation({ messages: [message({ status: "failed" })] })] },
    { version: 1, conversations: [conversation({ messages: [message({ role: "assistant", content: "" })] })] },
    { version: 1, conversations: [conversation({ messages: [message({ id: "has space" })] })] },
    { version: "1", conversations: [] },
    { conversations: [] },
    { version: 1 },
    { version: 1, conversations: ["not an object"] },
  ];

  for (const document of badDocuments) {
    await writeFile(path, JSON.stringify(document), "utf8");
    await assert.rejects(store.listConversations(), isCode("CORRUPT_DATA"));
  }
});

test("atomic write failure leaves existing data intact", async (t) => {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    t.skip("cannot test a read-only directory as root");
    return;
  }

  const path = await freshPath();
  const store = makeStore(path);
  const first = await store.createConversation("Keep me");
  const before = await readFile(path, "utf8");
  const directory = dirname(path);

  await chmod(directory, 0o500);
  try {
    await assert.rejects(store.createConversation("cannot write"), isCode("STORAGE_IO"));
  } finally {
    await chmod(directory, 0o700);
  }

  assert.equal(await readFile(path, "utf8"), before);
  assert.deepEqual((await store.listConversations()).map((item) => item.id), [first.id]);
  assert.deepEqual((await readdir(directory)).filter((f) => f.endsWith(".tmp")), []);
});

test("concurrent appends do not lose messages", async () => {
  const path = await freshPath();
  const store = makeStore(path);
  const created = await store.createConversation("Concurrent");

  await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      store.appendUserMessage(created.id, { content: `message ${index}` }),
    ),
  );

  const stored = await store.getConversation(created.id);
  assert.equal(stored.messages.length, 25);
  assert.equal(new Set(stored.messages.map((m) => m.id)).size, 25);
  assert.equal(JSON.parse(await readFile(path, "utf8")).conversations[0].messages.length, 25);
});

test("returns copies that cannot mutate stored data", async () => {
  const path = await freshPath();
  const store = makeStore(path);
  const created = await store.createConversation("Copies");
  await store.appendUserMessage(created.id, { content: "original" });

  const conversationCopy = await store.getConversation(created.id);
  conversationCopy.title = "tampered";
  conversationCopy.messages[0].content = "tampered";
  conversationCopy.messages.length = 0;

  const summaries = await store.listConversations();
  summaries[0].title = "tampered";
  summaries.length = 0;

  const again = await store.getConversation(created.id);
  assert.equal(again.title, "Copies");
  assert.equal(again.messages.length, 1);
  assert.equal(again.messages[0].content, "original");
});

test("searches titles and message text and filters archived conversations", async () => {
  const path = await freshPath();
  const store = makeStore(path);
  const work = await store.createConversation("Work plan");
  const recipes = await store.createConversation("Recipes");
  await store.appendUserMessage(recipes.id, { content: "Best way to bake sourdough" });
  await store.setConversationArchived(recipes.id, true);

  const byTitle = await store.listConversations({ query: "work" });
  assert.deepEqual(byTitle.map((item) => item.id), [work.id]);

  const byContent = await store.listConversations({ query: "sourdough", archived: "all" });
  assert.deepEqual(byContent.map((item) => item.id), [recipes.id]);

  assert.deepEqual(
    (await store.listConversations({ archived: "archived" })).map((item) => item.id),
    [recipes.id],
  );

  assert.equal(conversationMatchesQuery({ title: "Work", messages: [] }, "  "), true);
  assert.equal(
    conversationMatchesQuery({ title: "Work", messages: [{ content: "hello world" }] }, "WORLD"),
    true,
  );
  assert.equal(
    conversationMatchesQuery({ title: "Work", messages: [{ content: "hello" }] }, "missing"),
    false,
  );
});

test("enforces conversation and message limits", async () => {
  const path = await freshPath();
  const store = makeStore(path, { maxConversations: 2, maxMessagesPerConversation: 2 });

  const first = await store.createConversation("One");
  await store.createConversation("Two");
  await assert.rejects(store.createConversation("Three"), isCode("LIMIT_EXCEEDED"));

  await store.appendUserMessage(first.id, { content: "a" });
  await store.appendUserMessage(first.id, { content: "b" });
  await assert.rejects(
    store.appendUserMessage(first.id, { content: "c" }),
    isCode("LIMIT_EXCEEDED"),
  );
});

test("keeps conversation history isolated from the memory store", async () => {
  const dir = await mkdtemp(join(root, "isolation-"));
  const memoryPath = join(dir, "memories.json");
  const conversationPath = join(dir, "conversations.json");
  await mkdir(dir, { recursive: true });

  const memoryStore = new MemoryStore({ filePath: memoryPath });
  const conversationStore = makeStore(conversationPath);

  await memoryStore.createMemory("Keep this memory");
  const memoryBefore = await readFile(memoryPath, "utf8");

  const created = await conversationStore.createConversation("Work");
  await conversationStore.appendUserMessage(created.id, { content: "a private question" });
  await conversationStore.appendAssistantMessage(created.id, { content: "an answer", status: "complete" });
  await conversationStore.setConversationArchived(created.id, true);
  await conversationStore.deleteConversation(created.id);

  const memoryAfter = await readFile(memoryPath, "utf8");
  assert.equal(memoryAfter, memoryBefore);
  assert.equal((await memoryStore.listMemories()).length, 1);
  assert.notEqual(memoryPath, conversationPath);
});

test("derives compact titles from long opening messages", () => {
  assert.equal(deriveConversationTitle("   "), "New conversation");
  assert.equal(deriveConversationTitle("Short title"), "Short title");
  const long = deriveConversationTitle("word ".repeat(40).trim());
  assert.ok(long.length <= 65);
  assert.ok(long.endsWith("…"));
});

test("associates conversations with projects, moves them, and filters by project", async () => {
  const path = await freshPath();
  const store = makeStore(path);
  const one = await store.createConversation("One", "project-a");
  const two = await store.createConversation("Two");
  await store.createConversation("Three", "project-b");

  assert.equal(one.projectId, "project-a");
  assert.equal(two.projectId, null);

  assert.deepEqual(
    (await store.listConversations({ projectId: "project-a" })).map((item) => item.id),
    [one.id],
  );

  const moved = await store.setConversationProject(two.id, "project-a");
  assert.equal(moved.projectId, "project-a");
  assert.equal((await store.listConversations({ projectId: "project-a" })).length, 2);

  const cleared = await store.clearConversationsProject("project-a");
  assert.equal(cleared, 2);
  assert.deepEqual(await store.listConversations({ projectId: "project-a" }), []);
  assert.equal((await store.getConversation(one.id)).projectId, null);

  await assert.rejects(
    store.setConversationProject(one.id, "has space"),
    isCode("INVALID_ARGUMENT"),
  );
  await assert.rejects(
    store.createConversation("Bad", "has space"),
    isCode("INVALID_ARGUMENT"),
  );
});

test("reads legacy conversations that have no projectId field", async () => {
  const path = await freshPath();
  await writeFile(
    path,
    JSON.stringify({
      version: 1,
      conversations: [
        {
          id: "c-1",
          title: "Legacy",
          createdAt: VALID_TIMESTAMP,
          updatedAt: VALID_TIMESTAMP,
          archived: false,
          messages: [],
        },
      ],
    }),
    "utf8",
  );

  const store = makeStore(path);
  const conversation = await store.getConversation("c-1");
  assert.equal(conversation.projectId, null);
  assert.equal((await store.listConversations())[0].projectId, null);

  const rewritten = JSON.parse(await readFile(path, "utf8"));
  assert.equal(rewritten.conversations[0].projectId, undefined);
});
