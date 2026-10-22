import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../projects/store.ts";
import { createManagedProject } from "./create.ts";
import {
  workspaceExportResponse,
  workspaceFilesActionResponse,
  workspaceInfoResponse,
  workspaceRevealResponse,
  workspaceTrashResponse,
  workspaceUploadResponse,
} from "./api.ts";

const base = await mkdtemp(join(tmpdir(), "vyxo-workspace-api-test-"));
after(() => rm(base, { recursive: true, force: true }));

async function fresh(template = "documents") {
  const dir = await mkdtemp(join(base, "case-"));
  let counter = 0;
  const store = new ProjectStore({ filePath: join(dir, "projects.json"), idFactory: () => `p-${++counter}` });
  const project = await createManagedProject(
    { store, projectsDir: join(dir, "VYXO Projects"), idFactory: () => `ws-${++counter}` },
    { name: "Client A", template },
  );
  return { dir, store, project };
}

const post = (body) =>
  new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const act = (store, id, body) => workspaceFilesActionResponse(store, id, post(body));

test("info describes the workspace", async () => {
  const { store, project } = await fresh("website");
  const response = await workspaceInfoResponse(store, project.id);
  assert.equal(response.status, 200);
  const { workspace } = await response.json();
  assert.equal(workspace.projectId, project.id);
  assert.equal(workspace.template, "website");
  assert.equal(workspace.previewable, true);
  assert.equal(workspace.fileCount, 4);
  assert.equal(workspace.trashCount, 0);
  assert.equal(workspace.markerOk, true);
  assert.equal(workspace.folder.endsWith("/VYXO Projects/Client A"), true);
});

test("every workspace route refuses a project VYXO does not manage, and a project that does not exist", async () => {
  const { store } = await fresh();
  const connected = await store.createProject("Mine");
  for (const response of [
    await workspaceInfoResponse(store, connected.id),
    await workspaceTrashResponse(store, connected.id),
    await workspaceExportResponse(store, connected.id),
    await workspaceRevealResponse(store, connected.id, { opener: async () => assert.fail("must not open") }),
    await act(store, connected.id, { action: "create-file", path: "x.md" }),
  ]) {
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "NOT_A_WORKSPACE");
  }
  assert.equal((await workspaceInfoResponse(store, "missing")).status, 404);
  assert.equal((await act(store, "missing", { action: "trash", path: "x" })).status, 404);
});

test("files can be created, renamed, trashed, restored, and the trash emptied", async () => {
  const { store, project } = await fresh();
  const folder = project.sourceFolder;

  assert.equal((await act(store, project.id, { action: "create-file", path: "notes/new.md", content: "# new" })).status, 201);
  assert.equal(await readFile(join(folder, "notes/new.md"), "utf8"), "# new");
  assert.equal((await act(store, project.id, { action: "create-folder", path: "sources" })).status, 201);
  assert.equal((await act(store, project.id, { action: "rename", from: "notes/new.md", to: "sources/renamed.md" })).status, 200);

  const trashed = await (await act(store, project.id, { action: "trash", path: "sources/renamed.md" })).json();
  assert.equal(trashed.trashed.originalPath, "sources/renamed.md");
  const listed = await (await workspaceTrashResponse(store, project.id)).json();
  assert.equal(listed.entries.length, 1);

  const restored = await (await act(store, project.id, { action: "restore", trashId: trashed.trashed.id })).json();
  assert.deepEqual(restored, { path: "sources/renamed.md", renamed: false });
  assert.equal(await readFile(join(folder, "sources/renamed.md"), "utf8"), "# new");

  await act(store, project.id, { action: "trash", path: "sources/renamed.md" });
  assert.deepEqual(await (await act(store, project.id, { action: "empty-trash" })).json(), { removed: 1 });
});

test("bad requests get clear errors and change nothing", async () => {
  const { store, project } = await fresh();
  const cases = [
    [{ action: "nope" }, 400],
    [{}, 400],
    [{ action: "create-file", path: "../escape.md" }, 400],
    [{ action: "create-file", path: ".vyxo/x" }, 400],
    [{ action: "create-file", path: "README.md" }, 409],
    [{ action: "create-file", path: "a.md", content: 5 }, 400],
    [{ action: "rename", from: "missing.md", to: "x.md" }, 404],
    [{ action: "trash", path: "missing.md" }, 404],
    [{ action: "restore", trashId: "../../x" }, 400],
  ];
  for (const [body, status] of cases) {
    const response = await act(store, project.id, body);
    assert.equal(response.status, status, JSON.stringify(body));
    assert.equal(typeof (await response.json()).error, "string");
  }
  assert.equal((await act(store, project.id, { action: "create-file", path: "../escape.md" })).status, 400);
  const wrongType = await workspaceFilesActionResponse(
    store,
    project.id,
    new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "x" }),
  );
  assert.equal(wrongType.status, 415);
});

function upload(files, folder) {
  const form = new FormData();
  if (folder !== undefined) form.set("folder", folder);
  for (const [name, content] of files) form.append("files", new File([content], name));
  return new Request("http://localhost/x", { method: "POST", body: form });
}

test("uploads add files and never overwrite", async () => {
  const { store, project } = await fresh();
  const first = await workspaceUploadResponse(store, project.id, upload([["brief.txt", "one"], ["brief.txt", "two"]], "sources"));
  assert.equal(first.status, 201);
  const { added } = await first.json();
  assert.deepEqual(added.map((file) => file.path), ["sources/brief.txt", "sources/brief (2).txt"]);
  assert.equal(await readFile(join(project.sourceFolder, "sources/brief.txt"), "utf8"), "one");
  const hostile = await workspaceUploadResponse(store, project.id, upload([["../../evil.txt", "x"]]));
  assert.equal((await hostile.json()).added[0].path, "evil.txt");
});

test("uploads reject the wrong content type, a missing project, and oversized batches", async () => {
  const { store, project } = await fresh();
  const wrongType = await workspaceUploadResponse(store, project.id, post({ files: [] }));
  assert.equal(wrongType.status, 415);
  assert.equal((await workspaceUploadResponse(store, "missing", upload([["a.txt", "a"]]))).status, 404);
  const empty = await workspaceUploadResponse(store, project.id, upload([]));
  assert.equal(empty.status, 400);
  const many = await workspaceUploadResponse(store, project.id, upload(Array.from({ length: 30 }, (_, i) => [`f${i}.txt`, "x"])));
  assert.equal(many.status, 400);
  const declaredHuge = new Request("http://localhost/x", {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=x", "Content-Length": String(500 * 1024 * 1024) },
    body: "--x--",
  });
  assert.equal((await workspaceUploadResponse(store, project.id, declaredHuge)).status, 413);
});

test("export downloads a zip named after the project", async () => {
  const { store, project } = await fresh();
  const response = await workspaceExportResponse(store, project.id);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/zip");
  assert.match(response.headers.get("content-disposition"), /attachment; filename="Client A\.zip"/);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  assert.equal(Number(response.headers.get("content-length")), bytes.length);
});

test("reveal opens the project's own folder and never a path from the request", async () => {
  const { store, project } = await fresh();
  const calls = [];
  const response = await workspaceRevealResponse(store, project.id, {
    platform: "darwin",
    opener: async (command, args) => calls.push([command, args]),
  });
  const body = await response.json();
  assert.equal(body.opened, true);
  assert.deepEqual(calls, [["open", [body.folder]]]);
  assert.equal(body.folder.endsWith("/VYXO Projects/Client A"), true);

  const other = [];
  await workspaceRevealResponse(store, project.id, { platform: "win32", opener: async (c) => other.push(c) });
  await workspaceRevealResponse(store, project.id, { platform: "linux", opener: async (c) => other.push(c) });
  assert.deepEqual(other, ["explorer", "xdg-open"]);

  const failed = await workspaceRevealResponse(store, project.id, {
    opener: async () => {
      throw new Error("no file browser");
    },
  });
  const failedBody = await failed.json();
  assert.equal(failed.status, 200);
  assert.equal(failedBody.opened, false);
  assert.ok(failedBody.folder);
});

test("a workspace whose folder was deleted outside VYXO reports it instead of crashing", async () => {
  const { store, project } = await fresh();
  await rm(project.sourceFolder, { recursive: true });
  const response = await workspaceInfoResponse(store, project.id);
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /missing/);
});
