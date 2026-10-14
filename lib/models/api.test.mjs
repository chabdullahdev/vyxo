import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModelCatalogResponse } from "./api.ts";
import { SettingsStore } from "../settings/store.ts";

const root = await mkdtemp(join(tmpdir(), "vyxo-models-api-test-"));

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function freshStore(overrides = {}) {
  const dir = await mkdtemp(join(root, "case-"));
  const filePath = join(dir, "settings.json");
  return { store: new SettingsStore({ filePath, defaultModel: "qwen3:8b", ...overrides }), filePath };
}

test("returns the catalog for the stored selection", async () => {
  const { store } = await freshStore();
  const response = await getModelCatalogResponse(store, async () => ({
    ok: true,
    models: ["gemma4:latest", "qwen3:8b"],
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "ok");
  assert.equal(body.selectedModel, "qwen3:8b");
  assert.equal(body.selectedInstalled, true);
  assert.deepEqual(body.models, ["gemma4:latest", "qwen3:8b"]);
});

test("reflects a selected model that is no longer installed", async () => {
  const { store } = await freshStore();
  await store.setSelectedModel("removed:latest");
  const response = await getModelCatalogResponse(store, async () => ({
    ok: true,
    models: ["qwen3:8b"],
  }));
  const body = await response.json();
  assert.equal(body.status, "ok");
  assert.equal(body.selectedInstalled, false);
});

test("surfaces an unavailable Ollama service", async () => {
  const { store } = await freshStore();
  const response = await getModelCatalogResponse(store, async () => ({
    ok: false,
    message: "Ollama is not reachable on this Mac.",
  }));
  const body = await response.json();
  assert.equal(body.status, "unavailable");
  assert.equal(body.message, "Ollama is not reachable on this Mac.");
});

test("fails safely when the settings file is corrupt", async () => {
  const { store, filePath } = await freshStore();
  await writeFile(filePath, "{ broken", "utf8");
  const response = await getModelCatalogResponse(store, async () => ({ ok: true, models: [] }));
  assert.equal(response.status, 500);
});
