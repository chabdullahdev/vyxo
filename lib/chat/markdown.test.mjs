import assert from "node:assert/strict";
import test from "node:test";

import { parseMarkdown, safeHref } from "./markdown.ts";

const text = (value) => ({ type: "text", text: value });

test("renders bold, italic, and inline code", () => {
  const [block] = parseMarkdown("Use **bold**, *italic* and `code` here.");
  assert.equal(block.type, "paragraph");
  assert.deepEqual(block.children, [
    text("Use "),
    { type: "strong", children: [text("bold")] },
    text(", "),
    { type: "em", children: [text("italic")] },
    text(" and "),
    { type: "code", text: "code" },
    text(" here."),
  ]);
});

test("does not treat snake_case or math stars as emphasis", () => {
  const [block] = parseMarkdown("call my_function_name and 2 * 3 * 4");
  assert.deepEqual(block.children, [text("call my_function_name and 2 * 3 * 4")]);
});

test("parses headings, lists, quotes, and rules", () => {
  const blocks = parseMarkdown(
    ["## Title", "", "- one", "- two", "", "3. three", "4. four", "", "> quoted", "", "---"].join("\n"),
  );
  assert.deepEqual(
    blocks.map((block) => block.type),
    ["heading", "list", "list", "quote", "rule"],
  );
  assert.equal(blocks[0].level, 2);
  assert.equal(blocks[1].ordered, false);
  assert.equal(blocks[1].items.length, 2);
  assert.equal(blocks[2].ordered, true);
  assert.equal(blocks[2].start, 3);
});

test("keeps fenced code verbatim, including markdown inside it", () => {
  const blocks = parseMarkdown("Before\n```js\nconst a = **b**;\n```\nAfter");
  assert.deepEqual(
    blocks.map((block) => block.type),
    ["paragraph", "code", "paragraph"],
  );
  assert.equal(blocks[1].language, "js");
  assert.equal(blocks[1].content, "const a = **b**;");
});

test("only http, https, and mailto links become links", () => {
  assert.equal(safeHref("https://example.com/a"), "https://example.com/a");
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("data:text/html,<b>x</b>"), null);

  const [bad] = parseMarkdown("[click](javascript:alert(1))");
  assert.ok(bad.children.every((node) => node.type === "text"));

  const [good] = parseMarkdown("See [docs](https://example.com) and https://vyxo.dev.");
  const links = good.children.filter((node) => node.type === "link");
  assert.equal(links.length, 2);
  assert.equal(links[1].href, "https://vyxo.dev");
});

test("never produces raw HTML nodes", () => {
  const [block] = parseMarkdown("<script>alert(1)</script> <img src=x onerror=alert(1)>");
  assert.ok(block.children.every((node) => node.type === "text"));
});

test("handles an unterminated fence while streaming", () => {
  const blocks = parseMarkdown("Here:\n```py\nprint(1)");
  assert.equal(blocks[1].type, "code");
  assert.equal(blocks[1].content, "print(1)");
});

test("empty input yields no crash", () => {
  assert.doesNotThrow(() => parseMarkdown(""));
});
