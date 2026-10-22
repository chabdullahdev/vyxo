import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { createFile, trashEntry } from "./files.ts";
import { WorkspaceError } from "./errors.ts";
import { createZip, crc32, exportWorkspaceZip } from "./zip.ts";

const base = await mkdtemp(join(tmpdir(), "vyxo-zip-test-"));
after(() => rm(base, { recursive: true, force: true }));

/** A deliberately separate, minimal reader, so the writer is not checked against itself. */
function readZip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, "end of central directory");
  const count = buffer.readUInt16LE(end + 10);
  let pointer = buffer.readUInt32LE(end + 16);
  const files = {};
  for (let i = 0; i < count; i += 1) {
    assert.equal(buffer.readUInt32LE(pointer), 0x02014b50);
    const method = buffer.readUInt16LE(pointer + 10);
    const crc = buffer.readUInt32LE(pointer + 16);
    const compressed = buffer.readUInt32LE(pointer + 20);
    const size = buffer.readUInt32LE(pointer + 24);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const offset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.subarray(pointer + 46, pointer + 46 + nameLength).toString("utf8");
    assert.equal(buffer.readUInt32LE(offset), 0x04034b50);
    const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    const body = buffer.subarray(start, start + compressed);
    const data = method === 8 ? inflateRawSync(body) : body;
    assert.equal(data.length, size, name);
    assert.equal(crc32(data), crc, `${name} checksum`);
    files[name] = data.toString("utf8");
    pointer += 46 + nameLength;
  }
  return files;
}

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test("a zip round-trips text, empty files, unicode names, and large content", () => {
  const big = "lorem ipsum ".repeat(50_000);
  const zip = createZip([
    { name: "a.txt", data: new TextEncoder().encode("hello"), modified: new Date(2026, 2, 14, 9, 30) },
    { name: "empty.md", data: new Uint8Array(), modified: new Date() },
    { name: "Müller/项目.md", data: new TextEncoder().encode("é 项目"), modified: new Date() },
    { name: "big.txt", data: new TextEncoder().encode(big), modified: new Date() },
  ]);
  const files = readZip(zip);
  assert.deepEqual(Object.keys(files), ["a.txt", "empty.md", "Müller/项目.md", "big.txt"]);
  assert.equal(files["a.txt"], "hello");
  assert.equal(files["empty.md"], "");
  assert.equal(files["Müller/项目.md"], "é 项目");
  assert.equal(files["big.txt"], big);
  assert.ok(zip.length < big.length / 5, "content is actually compressed");
});

test("a zip made here opens with the system unzip tool", async (t) => {
  const dir = await mkdtemp(join(base, "tool-"));
  const path = join(dir, "x.zip");
  await writeFile(
    path,
    createZip([
      { name: "one.txt", data: new TextEncoder().encode("1"), modified: new Date() },
      { name: "sub/two.txt", data: new TextEncoder().encode("22"), modified: new Date() },
    ]),
  );
  try {
    execFileSync("unzip", ["-tq", path], { stdio: "pipe" });
  } catch (error) {
    if (error.code === "ENOENT") return t.skip("unzip is not installed");
    throw error;
  }
});

async function workspace() {
  const dir = await mkdtemp(join(base, "ws-"));
  const folder = join(dir, "project");
  await mkdir(join(folder, ".vyxo"), { recursive: true });
  await writeFile(join(folder, ".vyxo", "project.json"), "{}");
  return { dir, folder };
}

test("exports a workspace's own files only, never bookkeeping, trash, or linked files", async () => {
  const { dir, folder } = await workspace();
  await createFile(folder, "README.md", "# readme");
  await createFile(folder, "notes/idea.md", "idea");
  await createFile(folder, "gone.md", "deleted");
  await trashEntry(folder, "gone.md");
  await writeFile(join(dir, "outside.txt"), "outside");
  await symlink(join(dir, "outside.txt"), join(folder, "link.txt"));

  const { data, count } = await exportWorkspaceZip(folder);
  const files = readZip(data);
  assert.equal(count, 2);
  assert.deepEqual(Object.keys(files).sort(), ["README.md", "notes/idea.md"]);
  assert.equal(files["README.md"], "# readme");
  assert.equal(Object.keys(files).some((name) => name.startsWith(".vyxo")), false);
});

test("exporting an empty workspace says so instead of making an empty zip", async () => {
  const { folder } = await workspace();
  await assert.rejects(exportWorkspaceZip(folder), (error) => error instanceof WorkspaceError && error.code === "NOT_FOUND");
});

test("an exported workspace's file contents match what is on disk", async () => {
  const { folder } = await workspace();
  const text = "line\n".repeat(10_000);
  await createFile(folder, "long.md", text);
  const files = readZip((await exportWorkspaceZip(folder)).data);
  assert.equal(files["long.md"], await readFile(join(folder, "long.md"), "utf8"));
});
