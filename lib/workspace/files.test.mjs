import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanRelativePath,
  cleanUploadName,
  countFiles,
  createFile,
  createFolder,
  emptyTrash,
  importFiles,
  listAllFiles,
  listTrash,
  openWorkspace,
  readWorkspaceFile,
  renameEntry,
  restoreEntry,
  trashEntry,
} from "./files.ts";
import { WorkspaceError } from "./errors.ts";

const base = await mkdtemp(join(tmpdir(), "vyxo-files-test-"));
after(() => rm(base, { recursive: true, force: true }));

const isCode = (code) => (error) => error instanceof WorkspaceError && error.code === code;
const text = (value) => new TextEncoder().encode(value);

async function workspace() {
  const dir = await mkdtemp(join(base, "ws-"));
  const folder = join(dir, "project");
  await mkdir(join(folder, ".vyxo"), { recursive: true });
  await writeFile(join(folder, "README.md"), "# hi");
  return { dir, folder };
}

test("accepts plain relative paths and rejects every kind of trick", () => {
  assert.equal(cleanRelativePath("notes/draft.md"), "notes/draft.md");
  assert.equal(cleanRelativePath("  a.txt  "), "a.txt");
  assert.equal(cleanRelativePath("Client A/Müller.md"), "Client A/Müller.md");
  assert.equal(cleanRelativePath("", { allowEmpty: true }), "");

  for (const bad of [
    "",
    "   ",
    "/etc/passwd",
    "../secret",
    "a/../b",
    "a/./b",
    "./a",
    "a//b",
    "a/",
    "a\\b",
    "a\0b",
    "a\nb",
    "C:\\Windows",
    "c:evil",
    ".vyxo",
    ".VYXO/trash",
    "notes/.vyxo/x",
    "name.",
    "a/ b",
    "a /b",
    "x".repeat(600),
    `${"y".repeat(250)}/z`,
    42,
    null,
    undefined,
  ]) {
    assert.throws(() => cleanRelativePath(bad), (error) => error instanceof WorkspaceError, JSON.stringify(bad));
  }
});

test("only a real, ordinary folder can be opened as a workspace", async () => {
  const { dir, folder } = await workspace();
  assert.ok(await openWorkspace(folder));
  await assert.rejects(openWorkspace(join(dir, "missing")), isCode("NOT_FOUND"));
  await assert.rejects(openWorkspace(null), isCode("NOT_A_WORKSPACE"));
  await writeFile(join(dir, "afile"), "x");
  await assert.rejects(openWorkspace(join(dir, "afile")), isCode("UNSAFE"));
  await symlink(folder, join(dir, "alias"));
  await assert.rejects(openWorkspace(join(dir, "alias")), isCode("UNSAFE"));
});

test("creates files and folders, including nested ones, with private permissions", async () => {
  const { folder } = await workspace();
  assert.deepEqual(await createFile(folder, "notes/2026/march.md", "# March"), { path: "notes/2026/march.md" });
  assert.equal(await readFile(join(folder, "notes/2026/march.md"), "utf8"), "# March");
  assert.equal((await stat(join(folder, "notes/2026/march.md"))).mode & 0o777, 0o600);
  assert.equal((await stat(join(folder, "notes/2026"))).mode & 0o777, 0o700);
  await createFolder(folder, "sources/contracts");
  assert.ok((await stat(join(folder, "sources/contracts"))).isDirectory());
});

test("never overwrites an existing file or folder", async () => {
  const { folder } = await workspace();
  await assert.rejects(createFile(folder, "README.md", "replaced"), isCode("EXISTS"));
  assert.equal(await readFile(join(folder, "README.md"), "utf8"), "# hi");
  await createFolder(folder, "docs");
  await assert.rejects(createFolder(folder, "docs"), isCode("EXISTS"));
  await assert.rejects(createFile(folder, "docs/", "x"), (error) => error instanceof WorkspaceError);
});

test("the reserved bookkeeping folder cannot be touched by any operation", async () => {
  const { folder } = await workspace();
  await assert.rejects(createFile(folder, ".vyxo/project.json", "{}"), isCode("INVALID_PATH"));
  await assert.rejects(createFolder(folder, ".vyxo/trash/x"), isCode("INVALID_PATH"));
  await assert.rejects(renameEntry(folder, "README.md", ".vyxo/README.md"), isCode("INVALID_PATH"));
  await assert.rejects(renameEntry(folder, ".vyxo", "gone"), isCode("INVALID_PATH"));
  await assert.rejects(trashEntry(folder, ".vyxo"), isCode("INVALID_PATH"));
  await assert.rejects(readWorkspaceFile(folder, ".vyxo/project.json"), isCode("INVALID_PATH"));
});

test("links can never be used to reach outside the workspace", async () => {
  const { dir, folder } = await workspace();
  const outside = join(dir, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "secret.txt"), "top secret");
  await symlink(outside, join(folder, "link"));
  await symlink(join(outside, "secret.txt"), join(folder, "file-link.txt"));

  await assert.rejects(createFile(folder, "link/new.txt", "x"), isCode("UNSAFE"));
  await assert.rejects(createFolder(folder, "link/sub"), isCode("UNSAFE"));
  await assert.rejects(readWorkspaceFile(folder, "link/secret.txt"), isCode("UNSAFE"));
  await assert.rejects(readWorkspaceFile(folder, "file-link.txt"), isCode("UNSAFE"));
  await assert.rejects(trashEntry(folder, "link"), isCode("UNSAFE"));
  await assert.rejects(trashEntry(folder, "file-link.txt"), isCode("UNSAFE"));
  await assert.rejects(renameEntry(folder, "link", "moved"), isCode("UNSAFE"));
  await assert.rejects(renameEntry(folder, "README.md", "link/stolen.md"), isCode("UNSAFE"));
  await assert.rejects(importFiles(folder, "link", [{ name: "x.txt", data: text("x") }]), isCode("UNSAFE"));

  assert.equal(await readFile(join(outside, "secret.txt"), "utf8"), "top secret");
  assert.deepEqual(await readdir(outside), ["secret.txt"]);
  assert.deepEqual((await listAllFiles(folder)).map((file) => file.path), ["README.md"], "links are skipped by listings");
});

test("renames and moves without ever overwriting", async () => {
  const { folder } = await workspace();
  await createFile(folder, "a.md", "A");
  await createFile(folder, "b.md", "B");
  await createFolder(folder, "docs");

  assert.deepEqual(await renameEntry(folder, "a.md", "docs/a2.md"), { path: "docs/a2.md" });
  assert.equal(await readFile(join(folder, "docs/a2.md"), "utf8"), "A");
  await assert.rejects(renameEntry(folder, "b.md", "docs/a2.md"), isCode("EXISTS"));
  assert.equal(await readFile(join(folder, "b.md"), "utf8"), "B");
  await assert.rejects(renameEntry(folder, "missing.md", "x.md"), isCode("NOT_FOUND"));

  assert.deepEqual(await renameEntry(folder, "b.md", "new/place/b.md"), { path: "new/place/b.md" });
  await assert.rejects(renameEntry(folder, "docs", "docs/inner"), isCode("INVALID_PATH"));
  assert.deepEqual(await renameEntry(folder, "docs/a2.md", "docs/A2.md"), { path: "docs/A2.md" }, "case-only rename");
  assert.deepEqual(await renameEntry(folder, "docs", "docs"), { path: "docs" });
});

test("trash keeps everything restorable, and restoring never overwrites", async () => {
  const { folder } = await workspace();
  await createFile(folder, "notes/idea.md", "idea");
  await createFolder(folder, "old");
  await createFile(folder, "old/one.md", "1");

  const file = await trashEntry(folder, "notes/idea.md");
  const dir = await trashEntry(folder, "old");
  await assert.rejects(readFile(join(folder, "notes/idea.md")), { code: "ENOENT" });
  const listed = await listTrash(folder);
  assert.deepEqual(listed.map((entry) => entry.originalPath).sort(), ["notes/idea.md", "old"]);
  assert.deepEqual(listed.map((entry) => entry.kind).sort(), ["directory", "file"]);

  await createFile(folder, "notes/idea.md", "a newer file with the same name");
  const restoredFile = await restoreEntry(folder, file.id);
  assert.deepEqual(restoredFile, { path: "notes/idea (restored).md", renamed: true });
  assert.equal(await readFile(join(folder, "notes/idea.md"), "utf8"), "a newer file with the same name");
  assert.equal(await readFile(join(folder, "notes/idea (restored).md"), "utf8"), "idea");

  assert.deepEqual(await restoreEntry(folder, dir.id), { path: "old", renamed: false });
  assert.equal(await readFile(join(folder, "old/one.md"), "utf8"), "1");
  assert.deepEqual(await listTrash(folder), []);
  await assert.rejects(restoreEntry(folder, file.id), isCode("NOT_FOUND"));
});

test("trash rejects forged ids and ignores stray folders", async () => {
  const { folder } = await workspace();
  await createFile(folder, "keep.md", "k");
  await assert.rejects(restoreEntry(folder, "../../README.md"), isCode("INVALID_PATH"));
  await assert.rejects(restoreEntry(folder, "x"), isCode("INVALID_PATH"));
  await assert.rejects(restoreEntry(folder, 7), isCode("INVALID_PATH"));
  await assert.rejects(trashEntry(folder, "nope.md"), isCode("NOT_FOUND"));
  await mkdir(join(folder, ".vyxo/trash/junk"), { recursive: true });
  await mkdir(join(folder, ".vyxo/trash/abc123-aabbcc"), { recursive: true });
  assert.deepEqual(await listTrash(folder), []);
});

test("a tampered trash note cannot restore a file outside the workspace", async () => {
  const { dir, folder } = await workspace();
  await createFile(folder, "victim.md", "v");
  const entry = await trashEntry(folder, "victim.md");
  const note = join(folder, ".vyxo/trash", entry.id, "meta.json");
  const meta = JSON.parse(await readFile(note, "utf8"));
  await writeFile(note, JSON.stringify({ ...meta, originalPath: "../../escaped.md" }));
  await assert.rejects(restoreEntry(folder, entry.id), isCode("INVALID_PATH"));
  await assert.rejects(readFile(join(dir, "escaped.md")), { code: "ENOENT" });
});

test("emptying the trash deletes only trashed items", async () => {
  const { folder } = await workspace();
  await createFile(folder, "a.md", "a");
  await createFile(folder, "b.md", "b");
  await trashEntry(folder, "a.md");
  assert.deepEqual(await emptyTrash(folder), { removed: 1 });
  assert.deepEqual(await listTrash(folder), []);
  assert.equal(await readFile(join(folder, "b.md"), "utf8"), "b");
  assert.deepEqual(await emptyTrash(folder), { removed: 0 });
});

test("adds files from the computer safely, numbering copies instead of overwriting", async () => {
  const { folder } = await workspace();
  const first = await importFiles(folder, "sources", [
    { name: "contract.txt", data: text("one") },
    { name: "contract.txt", data: text("two") },
    { name: "../../evil.txt", data: text("x") },
    { name: "C:\\fakepath\\scan.md", data: text("y") },
  ]);
  assert.deepEqual(first.added.map((file) => file.path), [
    "sources/contract.txt",
    "sources/contract (2).txt",
    "sources/evil.txt",
    "sources/scan.md",
  ]);
  assert.equal(await readFile(join(folder, "sources/contract.txt"), "utf8"), "one");
  assert.equal(await readFile(join(folder, "sources/contract (2).txt"), "utf8"), "two");

  const again = await importFiles(folder, "sources", [{ name: "contract.txt", data: text("three") }]);
  assert.equal(again.added[0].path, "sources/contract (3).txt");
  assert.equal(await readFile(join(folder, "sources/contract.txt"), "utf8"), "one", "the original is untouched");

  const root = await importFiles(folder, "", [{ name: "top.md", data: text("t") }]);
  assert.equal(root.added[0].path, "top.md");
});

test("uploads are limited in count, size, and name", async () => {
  const { folder } = await workspace();
  await assert.rejects(importFiles(folder, "", []), isCode("INVALID_PATH"));
  await assert.rejects(
    importFiles(folder, "", Array.from({ length: 26 }, (_, i) => ({ name: `f${i}.txt`, data: text("x") }))),
    isCode("LIMIT_EXCEEDED"),
  );
  await assert.rejects(importFiles(folder, "", [{ name: "big.bin", data: new Uint8Array(21 * 1024 * 1024) }]), isCode("TOO_LARGE"));
  await assert.rejects(importFiles(folder, "", [{ name: ".vyxo", data: text("x") }]), isCode("INVALID_PATH"));
  await assert.rejects(importFiles(folder, "", [{ name: "   ", data: text("x") }]), isCode("INVALID_PATH"));
  await assert.rejects(importFiles(folder, ".vyxo", [{ name: "x.txt", data: text("x") }]), isCode("INVALID_PATH"));
  assert.equal(cleanUploadName("a/b/c.txt"), "c.txt");
  assert.equal(cleanUploadName("tab\tname.txt"), "tabname.txt");
});

test("listings and counts ignore VYXO's own bookkeeping", async () => {
  const { folder } = await workspace();
  await createFile(folder, "notes/a.md", "a");
  await createFile(folder, "b.md", "b");
  await trashEntry(folder, "b.md");
  assert.deepEqual((await listAllFiles(folder)).map((file) => file.path).sort(), ["README.md", "notes/a.md"]);
  assert.equal(await countFiles(await openWorkspace(folder)), 2);
  await assert.rejects(listAllFiles(folder, { maxFiles: 1 }), isCode("LIMIT_EXCEEDED"));
  await assert.rejects(listAllFiles(folder, { maxBytes: 1 }), isCode("TOO_LARGE"));
});

test("reads a file's bytes, but not folders", async () => {
  const { folder } = await workspace();
  await createFile(folder, "d/x.md", "hello");
  assert.equal((await readWorkspaceFile(folder, "d/x.md")).toString(), "hello");
  await assert.rejects(readWorkspaceFile(folder, "d"), isCode("INVALID_PATH"));
  await assert.rejects(readWorkspaceFile(folder, "nope.md"), isCode("NOT_FOUND"));
});
