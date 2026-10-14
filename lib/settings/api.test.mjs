import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsStore } from "./store.ts";
import { getSettingsResponse, updateSettingsResponse } from "./api.ts";

const root = await mkdtemp(join(tmpdir(), "vyxo-settings-api-test-"));

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function freshStore() {
  const dir = await mkdtemp(join(root, "case-"));
  const filePath = join(dir, "settings.json");
  return { store: new SettingsStore({ filePath, defaultModel: "qwen3:8b" }), filePath };
}

function jsonRequest(method, body, options = {}) {
  const { contentType = "application/json", rawBody } = options;
  const init = { method, headers: {} };
  if (contentType !== null) init.headers["Content-Type"] = contentType;
  if (rawBody !== undefined) init.body = rawBody;
  else if (body !== undefined) init.body = JSON.stringify(body);
  return new Request("http://localhost/api/settings", init);
}

const discoverOk = async () => ({ ok: true, models: ["gemma4:latest", "qwen3:8b"] });

test("GET returns the settings and local storage locations", async () => {
  const { store } = await freshStore();
  const response = await getSettingsResponse(store);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.settings.selectedModel, "qwen3:8b");
  assert.equal(body.storage.files.conversations, "conversations.json");
  assert.equal(body.storage.files.settings, "settings.json");
  assert.equal(typeof body.storage.directory, "string");
});

test("PATCH persists an installed model", async () => {
  const { store, filePath } = await freshStore();
  const response = await updateSettingsResponse(
    store,
    jsonRequest("PATCH", { selectedModel: "gemma4:latest" }),
    discoverOk,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.settings.selectedModel, "gemma4:latest");
  assert.equal(body.catalog.status, "ok");
  assert.equal(JSON.parse(await readFile(filePath, "utf8")).selectedModel, "gemma4:latest");
});

test("PATCH rejects invalid and uninstalled models", async () => {
  const { store } = await freshStore();

  const invalid = await updateSettingsResponse(store, jsonRequest("PATCH", { selectedModel: "bad name" }), discoverOk);
  assert.equal(invalid.status, 400);

  const missing = await updateSettingsResponse(
    store,
    jsonRequest("PATCH", { selectedModel: "not-installed:latest" }),
    discoverOk,
  );
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /not installed/i);
});

test("PATCH reports an unavailable Ollama service", async () => {
  const { store } = await freshStore();
  const response = await updateSettingsResponse(
    store,
    jsonRequest("PATCH", { selectedModel: "qwen3:8b" }),
    async () => ({ ok: false, message: "Ollama is not reachable on this Mac." }),
  );
  assert.equal(response.status, 503);
});

test("PATCH validates content type and body", async () => {
  const { store } = await freshStore();
  assert.equal((await updateSettingsResponse(store, jsonRequest("PATCH", { selectedModel: "qwen3:8b" }, { contentType: "text/plain" }), discoverOk)).status, 415);
  assert.equal((await updateSettingsResponse(store, jsonRequest("PATCH", undefined, { rawBody: "{ nope" }), discoverOk)).status, 400);
  assert.equal((await updateSettingsResponse(store, jsonRequest("PATCH", { selectedModel: 42 }), discoverOk)).status, 400);
});
