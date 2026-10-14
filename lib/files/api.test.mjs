import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../projects/store.ts";
import { ProjectFileService } from "./service.ts";
import {
  connectFolderResponse,
  disconnectFolderResponse,
  folderStatusResponse,
  listFilesResponse,
  readFileResponse,
  searchFilesResponse,
} from "./api.ts";

const fileService = new ProjectFileService();

let base;
let folder;
let outside;

before(async () => {
  base = await mkdtemp(join(tmpdir(), "vyxo-files-api-test-"));
  folder = join(base, "connected");
  outside = join(base, "outside");
  await mkdir(folder);
  await mkdir(join(folder, "src"));
  await mkdir(outside);
  await writeFile(join(folder, "README.md"), "# Hello\n", "utf8");
  await writeFile(join(folder, "src", "app.ts"), "export const value = 1;\n", "utf8");
  await writeFile(join(folder, ".env"), "SECRET=1\n", "utf8");
  await writeFile(join(outside, "outside.txt"), "nope\n", "utf8");
});

after(async () => {
  await rm(base, { recursive: true, force: true });
});

async function freshStore() {
  const dir = await mkdtemp(join(base, "store-"));
  let counter = 0;
  const store = new ProjectStore({
    filePath: join(dir, "projects.json"),
    idFactory: () => `p-${++counter}`,
  });
  await store.createProject("Test", "");
  return store;
}

function jsonRequest(method, body, options = {}) {
  const { contentType = "application/json", rawBody } = options;
  const init = { method, headers: {} };
  if (contentType !== null) init.headers["Content-Type"] = contentType;
  if (rawBody !== undefined) init.body = rawBody;
  else if (body !== undefined) init.body = JSON.stringify(body);
  return new Request("http://localhost/api/projects/p-1/folder", init);
}

function getRequest(url) {
  return new Request(url, { method: "GET" });
}

test("connects an authorized folder and reports status", async () => {
  const store = await freshStore();
  const response = await connectFolderResponse(store, fileService, "p-1", jsonRequest("POST", { path: folder }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.folder.available, true);
  assert.equal(body.folder.name, "connected");
  assert.equal((await store.getProject("p-1")).sourceFolder, body.folder.path);

  const status = await folderStatusResponse(store, fileService, "p-1");
  assert.equal((await status.json()).folder.available, true);
});

test("rejects forbidden, missing, and malformed folder paths", async () => {
  const store = await freshStore();
  assert.equal((await connectFolderResponse(store, fileService, "p-1", jsonRequest("POST", { path: "/" }))).status, 400);
  assert.equal((await connectFolderResponse(store, fileService, "p-1", jsonRequest("POST", { path: join(base, "missing") }))).status, 400);
  assert.equal((await connectFolderResponse(store, fileService, "p-1", jsonRequest("POST", { path: 42 }))).status, 400);
  assert.equal((await connectFolderResponse(store, fileService, "p-1", jsonRequest("POST", {}, { contentType: "text/plain" }))).status, 415);
  assert.equal((await connectFolderResponse(store, fileService, "p-1", jsonRequest("POST", undefined, { rawBody: "{ nope" }))).status, 400);
});

test("lists, reads, and searches within the connected folder", async () => {
  const store = await freshStore();
  await connectFolderResponse(store, fileService, "p-1", jsonRequest("POST", { path: folder }));

  const listing = await listFilesResponse(store, fileService, "p-1", getRequest("http://localhost/api/projects/p-1/files?path="));
  assert.equal(listing.status, 200);
  assert.ok((await listing.json()).entries.some((entry) => entry.name === "src"));

  const read = await readFileResponse(store, fileService, "p-1", getRequest("http://localhost/api/projects/p-1/files/read?path=README.md"));
  assert.equal(read.status, 200);
  assert.equal((await read.json()).content, "# Hello\n");

  const search = await searchFilesResponse(store, fileService, "p-1", getRequest("http://localhost/api/projects/p-1/files/search?q=value"));
  assert.equal(search.status, 200);
  assert.equal((await search.json()).hits[0].path, "src/app.ts");
});

test("denies sensitive reads, traversal, and missing files with clear statuses", async () => {
  const store = await freshStore();
  await connectFolderResponse(store, fileService, "p-1", jsonRequest("POST", { path: folder }));

  const sensitive = await readFileResponse(store, fileService, "p-1", getRequest("http://localhost/api/projects/p-1/files/read?path=.env"));
  assert.equal(sensitive.status, 403);

  const traversal = await readFileResponse(store, fileService, "p-1", getRequest("http://localhost/api/projects/p-1/files/read?path=../outside/outside.txt"));
  assert.equal(traversal.status, 400);

  const missing = await readFileResponse(store, fileService, "p-1", getRequest("http://localhost/api/projects/p-1/files/read?path=missing.ts"));
  assert.equal(missing.status, 404);
});

test("requires a connected folder and a real project", async () => {
  const store = await freshStore();
  const noFolder = await listFilesResponse(store, fileService, "p-1", getRequest("http://localhost/api/projects/p-1/files?path="));
  assert.equal(noFolder.status, 400);
  assert.match((await noFolder.json()).error, /no source folder/i);

  const missingProject = await folderStatusResponse(store, fileService, "nope");
  assert.equal(missingProject.status, 404);
});

test("disconnecting clears the association without touching files", async () => {
  const store = await freshStore();
  await connectFolderResponse(store, fileService, "p-1", jsonRequest("POST", { path: folder }));

  const response = await disconnectFolderResponse(store, "p-1");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).folder, null);
  assert.equal((await store.getProject("p-1")).sourceFolder, null);

  assert.equal((await stat(folder)).isDirectory(), true);
  assert.equal(await readFile(join(folder, "README.md"), "utf8"), "# Hello\n");
});
