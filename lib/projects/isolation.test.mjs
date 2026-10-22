import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "./store.ts";
import { isolatesGlobalMemory } from "./isolation.ts";

const base = await mkdtemp(join(tmpdir(), "vyxo-isolation-test-"));
after(() => rm(base, { recursive: true, force: true }));

test("only workspace projects are kept apart from the global memories", async () => {
  const store = new ProjectStore({ filePath: join(base, "projects.json") });
  const connected = await store.createProject("Connected");
  const managed = await store.createProject("Managed", "", { kind: "managed", template: "blank", sourceFolder: "/Users/me/VYXO Projects/m" });

  assert.equal(await isolatesGlobalMemory(store, managed.id), true);
  assert.equal(await isolatesGlobalMemory(store, connected.id), false);
  assert.equal(await isolatesGlobalMemory(store, null), false);
  assert.equal(await isolatesGlobalMemory(store, undefined), false);
  assert.equal(await isolatesGlobalMemory(store, "does-not-exist"), false);
});

test("the chat route really uses the isolation check before loading memories", async () => {
  const route = await readFile(new URL("../../app/api/chat/route.ts", import.meta.url), "utf8");
  const check = route.indexOf("isolatesGlobalMemory(");
  const load = route.indexOf("loadMemoryContext(memoryStore");
  assert.ok(check > 0, "the chat route must call isolatesGlobalMemory");
  assert.ok(load > 0);
  assert.ok(check < load, "the isolation check must come before memories are loaded");
});
