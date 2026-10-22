import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectFileService } from "../files/service.ts";
import { buildProposalOperations, parseBlockOutput, parseProposalOutput, readBuilderOutput } from "./build.ts";
import { EditError } from "./types.ts";

const service = new ProjectFileService();
let base;
let folder;

before(async () => {
  base = await mkdtemp(join(tmpdir(), "vyxo-edits-build-"));
  folder = join(base, "project");
  await mkdir(join(folder, "src"), { recursive: true });
  await writeFile(join(folder, "src", "app.ts"), "export const value = 1;\n", "utf8");
  await writeFile(join(folder, ".env"), "SECRET=1\n", "utf8");
});

after(async () => {
  await rm(base, { recursive: true, force: true });
});

const isCode = (code) => (error) => error instanceof EditError && error.code === code;

test("parses fenced JSON model output", () => {
  const raw = parseProposalOutput(
    '```json\n{"summary":"Fix it","operations":[{"op":"modify","path":"src/app.ts","content":"x"}]}\n```',
  );
  assert.equal(raw.summary, "Fix it");
  assert.deepEqual(raw.operations, [{ op: "modify", path: "src/app.ts", content: "x" }]);
});

test("rejects malformed or unsupported proposals", () => {
  assert.throws(() => parseProposalOutput("not json"), isCode("INVALID_PROPOSAL"));
  assert.throws(() => parseProposalOutput('{"summary":"x"}'), isCode("INVALID_PROPOSAL"));
  assert.throws(
    () => parseProposalOutput('{"summary":"x","operations":[{"op":"move","path":"a","content":"b"}]}'),
    isCode("INVALID_PROPOSAL"),
  );
  assert.throws(
    () => parseProposalOutput('{"summary":"x","operations":[{"op":"delete","path":"a","content":"b"}]}'),
    isCode("INVALID_PROPOSAL"),
  );
});

test("builds a modify operation with original content, hash and diff", async () => {
  const operations = await buildProposalOperations(service, folder, {
    summary: "s",
    operations: [{ op: "modify", path: "src/app.ts", content: "export const value = 2;\n" }],
  });
  assert.equal(operations.length, 1);
  assert.equal(operations[0].originalContent, "export const value = 1;\n");
  assert.match(operations[0].originalHash, /^[a-f0-9]{64}$/);
  assert.equal(operations[0].diff.added, 1);
  assert.equal(operations[0].diff.removed, 1);
});

test("rejects traversal, absolute paths, secrets, and unknown files", async () => {
  await assert.rejects(
    buildProposalOperations(service, folder, { summary: "s", operations: [{ op: "modify", path: "../outside.ts", content: "x" }] }),
    isCode("INVALID_PATH"),
  );
  await assert.rejects(
    buildProposalOperations(service, folder, { summary: "s", operations: [{ op: "create", path: "/etc/passwd", content: "x" }] }),
    isCode("INVALID_PATH"),
  );
  await assert.rejects(
    buildProposalOperations(service, folder, { summary: "s", operations: [{ op: "modify", path: ".env", content: "x" }] }),
    isCode("SENSITIVE"),
  );
  await assert.rejects(
    buildProposalOperations(service, folder, { summary: "s", operations: [{ op: "modify", path: "src/missing.ts", content: "x" }] }),
    isCode("STALE"),
  );
});

test("rejects duplicate targets and creating an existing file", async () => {
  await assert.rejects(
    buildProposalOperations(service, folder, {
      summary: "s",
      operations: [
        { op: "modify", path: "src/app.ts", content: "a" },
        { op: "modify", path: "src/app.ts", content: "b" },
      ],
    }),
    isCode("DUPLICATE_PATH"),
  );
  await assert.rejects(
    buildProposalOperations(service, folder, { summary: "s", operations: [{ op: "create", path: "src/app.ts", content: "x" }] }),
    isCode("INVALID_OPERATION"),
  );
});

test("accepts creating a new file", async () => {
  const operations = await buildProposalOperations(service, folder, {
    summary: "s",
    operations: [{ op: "create", path: "src/new.ts", content: "export const fresh = true;\n" }],
  });
  assert.equal(operations[0].op, "create");
  assert.equal(operations[0].originalHash, null);
  assert.equal(operations[0].diff.added, 1);
});

// ---- File-block format (what small local models write most reliably) ----


test("reads a well-formed file-block answer", () => {
  const text = [
    "SUMMARY: Made the header dark and added a services section.",
    "<<<FILE index.html>>>",
    "<h1>Hi</h1>",
    "<<<END>>>",
    "<<<FILE styles.css>>>",
    "body { color: white; }",
    "",
    "<<<END>>>",
  ].join("\n");
  const raw = parseBlockOutput(text, true);
  assert.equal(raw.summary, "Made the header dark and added a services section.");
  assert.deepEqual(raw.operations, [
    { op: "write", path: "index.html", content: "<h1>Hi</h1>\n" },
    { op: "write", path: "styles.css", content: "body { color: white; }\n" },
  ]);
});

test("a final block the model forgot to close is accepted only if the model finished by itself", () => {
  const text = "SUMMARY: Added a memo.\n<<<FILE drafts/memo.md>>>\n# Memo\n\nBody text";
  assert.deepEqual(parseBlockOutput(text, true).operations, [{ op: "write", path: "drafts/memo.md", content: "# Memo\n\nBody text\n" }]);
  assert.throws(() => parseBlockOutput(text, false), (error) => error instanceof EditError && /cut off/.test(error.message));
});

test("a block the model forgot to close before the next one is still read correctly", () => {
  const text = "<<<FILE a.md>>>\nA\n<<<FILE b.md>>>\nB\n<<<END>>>";
  assert.deepEqual(parseBlockOutput(text, true).operations.map((op) => [op.path, op.content]), [
    ["a.md", "A\n"],
    ["b.md", "B\n"],
  ]);
});

test("a file wrapped in one code fence is unwrapped, but fences inside a file are kept", () => {
  const wrapped = "<<<FILE a.html>>>\n```html\n<p>x</p>\n```\n<<<END>>>";
  assert.equal(parseBlockOutput(wrapped, true).operations[0].content, "<p>x</p>\n");
  const inner = "<<<FILE guide.md>>>\n# Guide\n\n```sh\nnpm test\n```\n\nDone.\n<<<END>>>";
  assert.equal(parseBlockOutput(inner, true).operations[0].content, "# Guide\n\n```sh\nnpm test\n```\n\nDone.\n");
});

test("deletes, Windows line endings, and tidy paths are handled", () => {
  const text = "SUMMARY: Tidy.\r\n<<<FILE `./notes/a.md`>>>\r\nline\r\n<<<END>>>\r\n<<<DELETE old.md>>>\r\n";
  const raw = parseBlockOutput(text, true);
  assert.deepEqual(raw.operations, [
    { op: "write", path: "notes/a.md", content: "line\n" },
    { op: "delete", path: "old.md", content: null },
  ]);
});

test("a missing summary gets a plain default, and text with no markers is not a block answer", () => {
  assert.equal(parseBlockOutput("<<<FILE a.md>>>\nx\n<<<END>>>", true).summary, "Updated 1 file.");
  assert.equal(parseBlockOutput("<<<FILE a.md>>>\nx\n<<<END>>>\n<<<FILE b.md>>>\ny\n<<<END>>>", true).summary, "Updated 2 files.");
  assert.equal(parseBlockOutput("Just a plain answer with no files.", true), null);
  assert.equal(parseBlockOutput("", true), null);
});

test("Build mode tells changes, answers, and the older JSON form apart", () => {
  const changes = readBuilderOutput("SUMMARY: x\n<<<FILE a.md>>>\nhi\n<<<END>>>", true);
  assert.equal(changes.kind, "changes");

  const answer = readBuilderOutput("The page has a header and two sections. Nothing needs to change.", true);
  assert.deepEqual(answer, { kind: "answer", text: "The page has a header and two sections. Nothing needs to change." });

  const json = readBuilderOutput('{"summary":"s","operations":[{"op":"create","path":"a.md","content":"x"}]}', true);
  assert.equal(json.kind, "changes");
  assert.equal(json.proposal.operations[0].op, "create");

  assert.throws(() => readBuilderOutput("   ", true), (error) => error instanceof EditError);
  assert.throws(
    () => readBuilderOutput("<<<FILE a.md>>>\nhalf a fi", false),
    (error) => error instanceof EditError && /cut off/.test(error.message),
  );
});

test("an answer is never mistaken for changes just because it mentions a file", () => {
  const text = "I would put that in index.html, under the header. Do you want me to make the change?";
  assert.equal(readBuilderOutput(text, true).kind, "answer");
});

test("too many files in one answer is refused", () => {
  const blocks = Array.from({ length: 21 }, (_, i) => `<<<FILE f${i}.md>>>\nx\n<<<END>>>`).join("\n");
  assert.throws(() => readBuilderOutput(blocks, true), (error) => error instanceof EditError && error.code === "LIMIT_EXCEEDED");
});

test("a written file becomes a create or a modify depending on whether it exists, and unchanged files are left out", async () => {
  const operations = await buildProposalOperations(service, folder, {
    summary: "s",
    operations: [
      { op: "write", path: "src/app.ts", content: "export const value = 2;\n" },
      { op: "write", path: "src/new.ts", content: "export const added = true;\n" },
    ],
  });
  assert.deepEqual(operations.map((operation) => [operation.op, operation.path]), [
    ["modify", "src/app.ts"],
    ["create", "src/new.ts"],
  ]);
  assert.equal(operations[0].originalContent, "export const value = 1;\n");

  const withUnchanged = await buildProposalOperations(service, folder, {
    summary: "s",
    operations: [
      { op: "write", path: "src/app.ts", content: "export const value = 1;\n" },
      { op: "write", path: "src/other.ts", content: "x\n" },
    ],
  });
  assert.deepEqual(withUnchanged.map((operation) => operation.path), ["src/other.ts"]);

  await assert.rejects(
    buildProposalOperations(service, folder, {
      summary: "s",
      operations: [{ op: "write", path: "src/app.ts", content: "export const value = 1;\n" }],
    }),
    isCode("INVALID_PROPOSAL"),
  );
});

test("a written file still goes through every path and sensitivity check", async () => {
  for (const path of ["../outside.ts", "/etc/passwd", ".env", "src/../../x.ts"]) {
    await assert.rejects(
      buildProposalOperations(service, folder, { summary: "s", operations: [{ op: "write", path, content: "x\n" }] }),
      (error) => error instanceof EditError,
      path,
    );
  }
});

test("broken JSON is an unreadable proposal, never shown as an answer", () => {
  const brokenLikeTheRealModel =
    '{"summary":"Created a memo.","operations":[{"op":"create","path":"drafts/memo.md","content":"# Memo\\n\\nBody"}]';
  assert.throws(
    () => readBuilderOutput(brokenLikeTheRealModel, true),
    (error) => error instanceof EditError && error.code === "INVALID_PROPOSAL",
  );
  assert.equal(readBuilderOutput("The summary of the contract is on page two.", true).kind, "answer");
});
