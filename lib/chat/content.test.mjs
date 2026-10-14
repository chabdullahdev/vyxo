import { test } from "node:test";
import assert from "node:assert/strict";
import { splitFencedCode } from "./content.ts";

test("returns a single text segment when there are no fences", () => {
  assert.deepEqual(splitFencedCode("hello\nworld"), [
    { type: "text", content: "hello\nworld", language: null },
  ]);
  assert.deepEqual(splitFencedCode(""), [{ type: "text", content: "", language: null }]);
});

test("extracts fenced code blocks with language and surrounding text", () => {
  const segments = splitFencedCode("Before\n```ts\nconst x = 1;\n```\nAfter");
  assert.deepEqual(segments, [
    { type: "text", content: "Before", language: null },
    { type: "code", content: "const x = 1;", language: "ts" },
    { type: "text", content: "After", language: null },
  ]);
});

test("treats an unterminated fence as code to the end", () => {
  const segments = splitFencedCode("intro\n```\nconst y = 2;");
  assert.deepEqual(segments, [
    { type: "text", content: "intro", language: null },
    { type: "code", content: "const y = 2;", language: null },
  ]);
});

test("preserves multiple code blocks", () => {
  const segments = splitFencedCode("```js\na\n```\ntext\n```py\nb\n```");
  assert.deepEqual(segments, [
    { type: "code", content: "a", language: "js" },
    { type: "text", content: "text", language: null },
    { type: "code", content: "b", language: "py" },
  ]);
});
