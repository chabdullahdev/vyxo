import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLineDiff } from "./diff.ts";

test("computes added and removed line counts", () => {
  const diff = computeLineDiff("a\nb\nc\n", "a\nB\nc\n");
  assert.equal(diff.added, 1);
  assert.equal(diff.removed, 1);
  assert.ok(diff.lines.some((line) => line.type === "removed" && line.text === "b"));
  assert.ok(diff.lines.some((line) => line.type === "added" && line.text === "B"));
});

test("treats a new file as fully added", () => {
  const diff = computeLineDiff("", "one\ntwo");
  assert.equal(diff.removed, 0);
  assert.equal(diff.added, 2);
});

test("caps very large diffs and flags truncation", () => {
  const before = Array.from({ length: 900 }, (_, i) => `line ${i}`).join("\n");
  const after = Array.from({ length: 900 }, (_, i) => `changed ${i}`).join("\n");
  const diff = computeLineDiff(before, after, 50);
  assert.equal(diff.lines.length, 50);
  assert.equal(diff.truncated, true);
  assert.ok(diff.added > 0 && diff.removed > 0);
});

test("reports no changes for identical text", () => {
  const diff = computeLineDiff("same\n", "same\n");
  assert.equal(diff.added, 0);
  assert.equal(diff.removed, 0);
  assert.equal(diff.truncated, false);
});
