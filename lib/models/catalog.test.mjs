import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildModelCatalog,
  discoverInstalledModels,
  isValidModelName,
  normalizeModelList,
  resolveRequestedModel,
} from "./catalog.ts";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("accepts real Ollama model names and rejects invalid ones", () => {
  for (const name of ["qwen3:8b", "gemma4:latest", "llama3.2:3b", "org/model:tag", "nomic-embed-text:latest"]) {
    assert.equal(isValidModelName(name), true, name);
  }
  for (const value of ["", " ", "bad name", " leading", "trailing ", "-starts-with-dash", 42, null, undefined, "a".repeat(121)]) {
    assert.equal(isValidModelName(value), false, String(value));
  }
});

test("normalizes a valid Ollama tags payload", () => {
  const models = normalizeModelList({
    models: [
      { name: "qwen3:8b", size: 1 },
      { name: "gemma4:latest" },
      { model: "gemma4:12b" },
      { name: "qwen3:8b" },
      { name: "bad name" },
      "not-an-object",
    ],
  });
  assert.deepEqual(models, ["gemma4:12b", "gemma4:latest", "qwen3:8b"]);
});

test("rejects malformed Ollama tags payloads", () => {
  assert.throws(() => normalizeModelList(null));
  assert.throws(() => normalizeModelList([]));
  assert.throws(() => normalizeModelList({}));
  assert.throws(() => normalizeModelList({ models: "nope" }));
  assert.throws(() => normalizeModelList({ models: [{ name: "bad name" }] }));
  assert.deepEqual(normalizeModelList({ models: [] }), []);
});

test("discovers models through an injected fetch", async () => {
  const ok = await discoverInstalledModels({
    fetchImpl: async () => jsonResponse({ models: [{ name: "qwen3:8b" }] }),
  });
  assert.deepEqual(ok, { ok: true, models: ["qwen3:8b"] });

  const unreachable = await discoverInstalledModels({
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  assert.equal(unreachable.ok, false);
  assert.match(unreachable.message, /not reachable/i);

  const badStatus = await discoverInstalledModels({
    fetchImpl: async () => new Response("", { status: 500 }),
  });
  assert.equal(badStatus.ok, false);
  assert.match(badStatus.message, /status 500/);

  const malformedJson = await discoverInstalledModels({
    fetchImpl: async () => new Response("{ not json", { status: 200 }),
  });
  assert.equal(malformedJson.ok, false);
  assert.match(malformedJson.message, /unreadable/i);

  const malformedShape = await discoverInstalledModels({
    fetchImpl: async () => jsonResponse({ unexpected: true }),
  });
  assert.equal(malformedShape.ok, false);
});

test("builds a catalog for ok, empty and unavailable states", () => {
  const ok = buildModelCatalog("qwen3:8b", { ok: true, models: ["gemma4:latest", "qwen3:8b"] });
  assert.equal(ok.status, "ok");
  assert.equal(ok.selectedInstalled, true);
  assert.deepEqual(ok.models, ["gemma4:latest", "qwen3:8b"]);
  assert.equal(ok.message, null);

  const missing = buildModelCatalog("qwen3:8b", { ok: true, models: ["gemma4:latest"] });
  assert.equal(missing.status, "ok");
  assert.equal(missing.selectedInstalled, false);

  const empty = buildModelCatalog("qwen3:8b", { ok: true, models: [] });
  assert.equal(empty.status, "empty");
  assert.equal(empty.selectedInstalled, false);
  assert.match(empty.message, /no local models/i);

  const unavailable = buildModelCatalog("qwen3:8b", { ok: false, message: "Ollama is not reachable." });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.selectedInstalled, false);
  assert.equal(unavailable.message, "Ollama is not reachable.");
});

test("resolves an explicit client model or the stored model without silent fallback", () => {
  assert.deepEqual(resolveRequestedModel(undefined, "qwen3:8b"), { ok: true, model: "qwen3:8b" });
  assert.deepEqual(resolveRequestedModel("gemma4:latest", "qwen3:8b"), {
    ok: true,
    model: "gemma4:latest",
  });
  assert.deepEqual(resolveRequestedModel("bad name", "qwen3:8b"), {
    ok: false,
    error: "`model` must be a valid model name.",
  });
  assert.equal(resolveRequestedModel(undefined, "bad name").ok, false);
  assert.equal(resolveRequestedModel(42, "qwen3:8b").ok, false);
});
