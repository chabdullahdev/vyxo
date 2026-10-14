import { after, test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SETTINGS_SCHEMA_VERSION, SettingsError, SettingsStore } from "./store.ts";

const root = await mkdtemp(join(tmpdir(), "vyxo-settings-test-"));

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function freshPath() {
  const dir = await mkdtemp(join(root, "case-"));
  return join(dir, "settings.json");
}

const isCode = (code) => (error) => error instanceof SettingsError && error.code === code;

test("returns the configured default when no settings file exists", async () => {
  const path = await freshPath();
  const store = new SettingsStore({ filePath: path, defaultModel: "qwen3:8b" });

  assert.deepEqual(await store.getSettings(), { selectedModel: "qwen3:8b" });
  await assert.rejects(stat(path), (error) => error.code === "ENOENT");
});

test("persists and reloads the selected model", async () => {
  const path = await freshPath();
  const store = new SettingsStore({ filePath: path, defaultModel: "qwen3:8b" });

  const updated = await store.setSelectedModel("gemma4:latest");
  assert.equal(updated.selectedModel, "gemma4:latest");

  const reopened = new SettingsStore({ filePath: path, defaultModel: "qwen3:8b" });
  assert.deepEqual(await reopened.getSettings(), { selectedModel: "gemma4:latest" });

  const parsed = JSON.parse(await readFile(path, "utf8"));
  assert.equal(parsed.version, SETTINGS_SCHEMA_VERSION);
  assert.equal(parsed.selectedModel, "gemma4:latest");
});

test("writes a versioned file with restrictive permissions", async () => {
  const path = await freshPath();
  const store = new SettingsStore({ filePath: path });
  await store.setSelectedModel("qwen3:8b");

  if (process.platform !== "win32") {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await stat(dirname(path))).mode & 0o777, 0o700);
  }
});

test("rejects invalid model names", async () => {
  const path = await freshPath();
  const store = new SettingsStore({ filePath: path });

  for (const bad of ["", " ", "bad name", 42, null, undefined]) {
    await assert.rejects(store.setSelectedModel(bad), isCode("INVALID_MODEL"));
  }
  await assert.rejects(stat(path), (error) => error.code === "ENOENT");
});

test("does not silently replace a corrupt settings file", async () => {
  const path = await freshPath();
  const corrupt = "{ not json";
  await writeFile(path, corrupt, "utf8");
  const store = new SettingsStore({ filePath: path });

  await assert.rejects(store.getSettings(), isCode("CORRUPT_DATA"));
  await assert.rejects(store.setSelectedModel("qwen3:8b"), isCode("CORRUPT_DATA"));
  assert.equal(await readFile(path, "utf8"), corrupt);
});

test("rejects unsupported versions and invalid stored values", async () => {
  const path = await freshPath();
  await writeFile(path, JSON.stringify({ version: 999, selectedModel: "qwen3:8b" }), "utf8");
  await assert.rejects(new SettingsStore({ filePath: path }).getSettings(), isCode("UNSUPPORTED_VERSION"));

  await writeFile(path, JSON.stringify({ version: 1, selectedModel: "bad name" }), "utf8");
  await assert.rejects(new SettingsStore({ filePath: path }).getSettings(), isCode("CORRUPT_DATA"));
});

test("atomic write failure leaves existing data intact", async (t) => {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    t.skip("cannot test a read-only directory as root");
    return;
  }

  const path = await freshPath();
  const store = new SettingsStore({ filePath: path });
  await store.setSelectedModel("qwen3:8b");
  const before = await readFile(path, "utf8");

  await chmod(dirname(path), 0o500);
  try {
    await assert.rejects(store.setSelectedModel("gemma4:latest"), isCode("STORAGE_IO"));
  } finally {
    await chmod(dirname(path), 0o700);
  }

  assert.equal(await readFile(path, "utf8"), before);
  assert.deepEqual((await readdir(dirname(path))).filter((f) => f.endsWith(".tmp")), []);
});

test("serializes concurrent writes without losing the last value", async () => {
  const path = await freshPath();
  const store = new SettingsStore({ filePath: path });
  await Promise.all([
    store.setSelectedModel("qwen3:8b"),
    store.setSelectedModel("gemma4:latest"),
    store.setSelectedModel("gemma4:12b"),
  ]);
  const final = await store.getSettings();
  assert.ok(["qwen3:8b", "gemma4:latest", "gemma4:12b"].includes(final.selectedModel));
  assert.equal(JSON.parse(await readFile(path, "utf8")).selectedModel, final.selectedModel);
});
