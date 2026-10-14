import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseInitialConversation } from "./selection.ts";

const conversations = [
  { id: "recent", archived: false },
  { id: "older", archived: false },
  { id: "archived", archived: true },
];

test("opens an explicitly requested conversation", () => {
  assert.deepEqual(
    chooseInitialConversation({
      initialConversationId: "older",
      initialProjectId: null,
      conversations,
    }),
    { kind: "open", id: "older" },
  );
});

test("regression: a project target starts a fresh draft instead of clobbering the project", () => {
  const selection = chooseInitialConversation({
    initialConversationId: null,
    initialProjectId: "project-a",
    conversations,
  });
  assert.deepEqual(selection, { kind: "draft" });
});

test("an explicit conversation wins over a project target", () => {
  assert.deepEqual(
    chooseInitialConversation({
      initialConversationId: "recent",
      initialProjectId: "project-a",
      conversations,
    }),
    { kind: "open", id: "recent" },
  );
});

test("auto-opens the most recent active conversation when nothing is targeted", () => {
  assert.deepEqual(
    chooseInitialConversation({
      initialConversationId: null,
      initialProjectId: null,
      conversations,
    }),
    { kind: "open", id: "recent" },
  );
});

test("returns a draft when there are no active conversations", () => {
  assert.deepEqual(
    chooseInitialConversation({
      initialConversationId: null,
      initialProjectId: null,
      conversations: [],
    }),
    { kind: "draft" },
  );
  assert.deepEqual(
    chooseInitialConversation({
      initialConversationId: null,
      initialProjectId: null,
      conversations: [{ id: "archived", archived: true }],
    }),
    { kind: "draft" },
  );
});
