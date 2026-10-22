import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../projects/store.ts";
import { EditError } from "../edits/types.ts";
import { createManagedProject } from "./create.ts";
import { createFile } from "./files.ts";
import {
  BUILDER_SYSTEM_PROMPT,
  CONTEXT_CHAR_BUDGET,
  buildWorkspaceContext,
  runWorkspaceBuilder,
} from "./builder.ts";

const base = await mkdtemp(join(tmpdir(), "vyxo-builder-test-"));
after(() => rm(base, { recursive: true, force: true }));

async function fresh(template = "website") {
  const dir = await mkdtemp(join(base, "case-"));
  let counter = 0;
  const store = new ProjectStore({ filePath: join(dir, "projects.json"), idFactory: () => `p-${++counter}` });
  const project = await createManagedProject(
    { store, projectsDir: join(dir, "VYXO Projects"), idFactory: () => `ws-${++counter}` },
    { name: "Site", template },
  );
  return project.sourceFolder;
}

test("the model is shown the file list and the files the request is about", async () => {
  const folder = await fresh();
  const context = await buildWorkspaceContext(folder, "make the header in index.html darker");
  assert.match(context, /Files in the project:/);
  for (const name of ["index.html", "styles.css", "script.js", "README.md"]) assert.ok(context.includes(`- ${name} (`), name);
  assert.ok(context.includes("--- index.html ---"));
  assert.ok(context.includes("<header class=\"site-header\">"));
  assert.equal(context.includes(".vyxo"), false, "VYXO's bookkeeping is never shown");
});

test("files named in the request come first, and the budget is respected", async () => {
  const folder = await fresh("blank");
  const filler = "word ".repeat(2000); // ~10,000 characters
  for (let i = 0; i < 6; i += 1) await createFile(folder, `notes/note-${i}.md`, filler);
  await createFile(folder, "contract-terms.md", "THE-IMPORTANT-FILE");
  const context = await buildWorkspaceContext(folder, "summarise contract-terms.md for the client");
  assert.ok(context.includes("THE-IMPORTANT-FILE"));
  const shown = context.split("\n--- ").length - 1;
  assert.ok(shown >= 1 && shown < 8, "not everything fits");
  assert.ok(context.length < CONTEXT_CHAR_BUDGET + 4_000, "stays within the budget plus the file list");
});

test("secrets, binary files, and oversized files are never put in front of the model", async () => {
  const folder = await fresh("blank");
  await createFile(folder, "config.md", 'const apiKey = "sk_" + "live_abcdefghijklmnop1234567890";');
  await createFile(folder, "big.md", "x".repeat(50_000));
  await writeFile(join(folder, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
  await createFile(folder, ".env", "TOKEN=abcdefghijklmnopqrstuvwxyz123456");
  await createFile(folder, "ok.md", "plain notes");
  const context = await buildWorkspaceContext(folder, "anything");
  assert.equal(context.includes("sk_live"), false);
  assert.equal(context.includes("TOKEN="), false);
  assert.equal(context.includes("xxxxxxxxxx"), false);
  assert.ok(context.includes("plain notes"));
  assert.ok(context.includes("- big.md ("), "large files are still listed by name");
});

test("an empty project is described as empty", async () => {
  const folder = await fresh("blank");
  const { rm: remove } = await import("node:fs/promises");
  await remove(join(folder, "README.md"));
  assert.equal(await buildWorkspaceContext(folder, "start"), "The project has no files yet.");
});

const asChat = (...answers) => {
  const calls = [];
  const chat = async (call) => {
    calls.push(call);
    const next = answers[Math.min(calls.length - 1, answers.length - 1)];
    return typeof next === "function" ? next(call) : next;
  };
  return { chat, calls };
};
const deps = (chat) => ({ resolveModel: async () => "qwen-test", chat });
const run = async (folder, request, chat, extra = {}) =>
  runWorkspaceBuilder({ folder, request, projectNotes: null, ...extra }, deps(chat));

test("file blocks become a change proposal, with the prompt, context, and request sent to the model", async () => {
  const folder = await fresh();
  const { chat, calls } = asChat({ text: "SUMMARY: Dark header.\n<<<FILE styles.css>>>\nbody{color:#fff}\n<<<END>>>", finished: true });
  const result = await run(folder, "Make the header dark", chat, { projectNotes: "Purpose: a bakery site" });

  assert.equal(result.kind, "changes");
  assert.equal(result.model, "qwen-test");
  assert.equal(result.proposal.summary, "Dark header.");
  assert.deepEqual(result.proposal.operations, [{ op: "write", path: "styles.css", content: "body{color:#fff}\n" }]);

  assert.equal(calls.length, 1);
  const roles = calls[0].messages.map((message) => message.role);
  assert.deepEqual(roles, ["system", "system", "system", "user"]);
  assert.equal(calls[0].messages[0].content, BUILDER_SYSTEM_PROMPT);
  assert.equal(calls[0].messages[1].content, "Purpose: a bakery site");
  assert.match(calls[0].messages[2].content, /--- index\.html ---/);
  assert.equal(calls[0].messages[3].content, "Make the header dark");
});

test("a question gets an answer, not a proposal", async () => {
  const folder = await fresh();
  const { chat } = asChat({ text: "The page has a header, an about section and a contact section.", finished: true });
  const result = await run(folder, "What is on this page?", chat);
  assert.deepEqual(result, { kind: "answer", text: "The page has a header, an about section and a contact section.", model: "qwen-test" });
});

test("an unreadable answer is retried once, with the previous answer and a clear correction", async () => {
  const folder = await fresh();
  const broken = '{"summary":"x","operations":[{"op":"create","path":"a.md","content":"hi"}]';
  const good = "SUMMARY: Added a note.\n<<<FILE notes.md>>>\nhi\n<<<END>>>";
  const { chat, calls } = asChat({ text: broken, finished: true }, { text: good, finished: true });
  const result = await run(folder, "add a note", chat);
  assert.equal(result.kind, "changes");
  assert.equal(calls.length, 2);
  const retryMessages = calls[1].messages;
  assert.equal(retryMessages.at(-2).role, "assistant");
  assert.equal(retryMessages.at(-2).content, broken);
  assert.match(retryMessages.at(-1).content, /could not be read/);
});

test("it gives up after one retry, and never retries a cut-off answer", async () => {
  const folder = await fresh();
  const broken = { text: '{"summary":"x","operations":[', finished: true };
  const twice = asChat(broken, broken);
  await assert.rejects(run(folder, "add", twice.chat), (error) => error instanceof EditError && error.code === "INVALID_PROPOSAL");
  assert.equal(twice.calls.length, 2);

  const cut = asChat({ text: "<<<FILE a.md>>>\nhalf a docu", finished: false });
  await assert.rejects(run(folder, "add", cut.chat), (error) => error instanceof EditError && /cut off/.test(error.message));
  assert.equal(cut.calls.length, 1);
});

test("cancelling stops before a retry, and model problems are reported as they are", async () => {
  const folder = await fresh();
  const controller = new AbortController();
  const { chat, calls } = asChat(() => {
    controller.abort();
    return { text: '{"summary":"x","operations":[', finished: true };
  });
  await assert.rejects(run(folder, "add", chat, { signal: controller.signal }), (error) => error instanceof EditError);
  assert.equal(calls.length, 1);

  await assert.rejects(
    runWorkspaceBuilder(
      { folder, request: "x", projectNotes: null },
      { resolveModel: async () => Promise.reject(new EditError("INVALID_REQUEST", "Ollama is not running.")), chat: async () => assert.fail("no call") },
    ),
    /Ollama is not running/,
  );
});
