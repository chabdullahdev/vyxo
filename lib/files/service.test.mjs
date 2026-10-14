import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectFileService, ProjectFileError } from "./service.ts";
import { FILES_MAX_READ_BYTES } from "./policy.ts";

const service = new ProjectFileService();

let base;
let root;
let outside;

before(async () => {
  base = await mkdtemp(join(tmpdir(), "vyxo-files-test-"));
  root = join(base, "project");
  outside = join(base, "outside");
  await mkdir(root);
  await mkdir(outside);
  await mkdir(join(root, "src"));
  await mkdir(join(root, "node_modules"));
  await mkdir(join(root, ".git"));

  await writeFile(join(root, "README.md"), "# Fixture\n", "utf8");
  await writeFile(join(root, "src", "index.ts"), "export const answer = 42;\n", "utf8");
  await writeFile(join(root, "src", "util.ts"), "export function add(a, b) { return a + b; }\n", "utf8");
  await writeFile(join(root, "node_modules", "index.js"), "export const pkg = true;\n", "utf8");
  await writeFile(join(root, ".git", "config"), "secret git config\n", "utf8");
  await writeFile(join(root, ".env"), "DATABASE_URL=postgres://user:pass@localhost\n", "utf8");
  await writeFile(join(root, "secret.ts"), 'const api_key = "synthetic-example-token-123456";\n', "utf8");
  await writeFile(join(root, "binary.ts"), Buffer.from([0x61, 0x00, 0x62]), "utf8");
  await writeFile(join(root, "big.ts"), "x".repeat(FILES_MAX_READ_BYTES + 10), "utf8");
  await writeFile(join(outside, "outside.txt"), "outside data\n", "utf8");
  await symlink(join(outside, "outside.txt"), join(root, "link.ts"));
  await symlink(outside, join(root, "linkdir"));
});

after(async () => {
  await rm(base, { recursive: true, force: true });
});

const isCode = (code) => (error) => error instanceof ProjectFileError && error.code === code;

test("inspects only real, allowed folders", async () => {
  const folder = await service.inspectFolder(root);
  assert.equal(folder.name, "project");
  assert.ok(folder.root.endsWith("project"));

  await assert.rejects(service.inspectFolder("/"), isCode("INVALID_FOLDER"));
  await assert.rejects(service.inspectFolder(homedir()), isCode("INVALID_FOLDER"));
  await assert.rejects(service.inspectFolder(join(root, "README.md")), isCode("INVALID_FOLDER"));
  await assert.rejects(service.inspectFolder(join(base, "missing")), isCode("INVALID_FOLDER"));
});

test("lists permitted directories and hides generated/sensitive trees", async () => {
  const listing = await service.listDirectory(root, "");
  const names = listing.entries.map((entry) => entry.name);
  assert.ok(names.includes("src"));
  assert.ok(names.includes("README.md"));
  assert.ok(!names.includes("node_modules"));
  assert.ok(!names.includes(".git"));

  const envEntry = listing.entries.find((entry) => entry.name === ".env");
  if (envEntry) assert.equal(envEntry.status, "sensitive");

  const linkEntry = listing.entries.find((entry) => entry.name === "link.ts");
  assert.equal(linkEntry?.kind, "symlink");

  const srcListing = await service.listDirectory(root, "src");
  assert.deepEqual(srcListing.entries.map((entry) => entry.name), ["index.ts", "util.ts"]);
});

test("reads allowed text files", async () => {
  const file = await service.readTextFile(root, "src/index.ts");
  assert.equal(file.path, "src/index.ts");
  assert.equal(file.content, "export const answer = 42;\n");
});

test("refuses sensitive, binary, oversized, symlinked, and missing files", async () => {
  await assert.rejects(service.readTextFile(root, ".env"), isCode("SENSITIVE"));
  await assert.rejects(service.readTextFile(root, "secret.ts"), isCode("SENSITIVE"));
  await assert.rejects(service.readTextFile(root, "binary.ts"), isCode("BINARY"));
  await assert.rejects(service.readTextFile(root, "big.ts"), isCode("TOO_LARGE"));
  await assert.rejects(service.readTextFile(root, "link.ts"), isCode("SYMLINK"));
  await assert.rejects(service.readTextFile(root, "missing.ts"), isCode("NOT_FOUND"));
  await assert.rejects(service.readTextFile(root, "src"), isCode("UNSUPPORTED_TYPE"));
});

test("rejects traversal, absolute paths, and symlink directory escape", async () => {
  await assert.rejects(service.readTextFile(root, "../outside/outside.txt"), isCode("INVALID_PATH"));
  await assert.rejects(service.readTextFile(root, "/etc/passwd"), isCode("INVALID_PATH"));
  await assert.rejects(service.readTextFile(root, "src/../../outside.txt"), isCode("INVALID_PATH"));
  await assert.rejects(service.readTextFile(root, "linkdir/outside.txt"), isCode("OUTSIDE_FOLDER"));
  await assert.rejects(service.listDirectory(root, "../outside"), isCode("INVALID_PATH"));
});

test("searches permitted files without leaking secrets or generated folders", async () => {
  const hit = await service.search(root, "answer");
  assert.equal(hit.hits.length, 1);
  assert.equal(hit.hits[0].path, "src/index.ts");
  assert.equal(hit.hits[0].line, 1);

  const secretHits = await service.search(root, "synthetic-example-token");
  assert.equal(secretHits.hits.length, 0);

  const pkgHits = await service.search(root, "pkg");
  assert.ok(!pkgHits.hits.some((entry) => entry.path.includes("node_modules")));

  const empty = await service.search(root, "   ");
  assert.deepEqual(empty.hits, []);

  const filenameHit = await service.search(root, "index.ts");
  assert.ok(filenameHit.hits.some((entry) => entry.path === "src/index.ts" && entry.line === 0));
});
