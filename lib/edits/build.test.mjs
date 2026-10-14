import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectFileService } from "../files/service.ts";
import { buildProposalOperations, parseProposalOutput } from "./build.ts";
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
