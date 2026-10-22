import { after, test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  PROJECT_SCHEMA_VERSION,
  ProjectError,
  ProjectStore,
  createProjectStore,
  projectMatchesQuery,
} from "./store.ts";
import { PROJECT_CONTEXT_FIELD_LIMITS } from "./context.ts";

const root = await mkdtemp(join(tmpdir(), "vyxo-project-test-"));

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function freshPath() {
  const dir = await mkdtemp(join(root, "case-"));
  return join(dir, "projects.json");
}

function makeStore(filePath, overrides = {}) {
  let tick = 0;
  let counter = 0;
  return new ProjectStore({
    filePath,
    clock: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
    idFactory: () => `id-${++counter}`,
    ...overrides,
  });
}

const isCode = (code) => (error) => error instanceof ProjectError && error.code === code;

test("first use returns an empty list without creating a file", async () => {
  const path = await freshPath();
  const store = makeStore(path);
  assert.deepEqual(await store.listProjects(), []);
  await assert.rejects(stat(path), (error) => error.code === "ENOENT");
});

test("creates, lists, updates, archives, restores and deletes projects", async () => {
  const path = await freshPath();
  const store = makeStore(path);

  const created = await store.createProject("  Website rebuild  ", "  A fresh marketing site  ");
  assert.equal(created.name, "Website rebuild");
  assert.equal(created.description, "A fresh marketing site");
  assert.equal(created.archived, false);

  assert.equal((await store.listProjects()).length, 1);
  assert.deepEqual(await store.getProject(created.id), created);

  const renamed = await store.updateProject(created.id, { name: "Marketing site", description: "Copy and design" });
  assert.equal(renamed.name, "Marketing site");
  assert.equal(renamed.description, "Copy and design");
  assert.equal(renamed.createdAt, created.createdAt);

  const archived = await store.setProjectArchived(created.id, true);
  assert.equal(archived.archived, true);
  assert.deepEqual(await store.listProjects({ archived: "active" }), []);
  assert.equal((await store.listProjects({ archived: "archived" })).length, 1);
  assert.equal((await store.listProjects({ archived: "all" })).length, 1);

  assert.equal(await store.deleteProject(created.id), true);
  assert.deepEqual(await store.listProjects(), []);
  assert.equal(await store.deleteProject(created.id), false);
});

test("persists projects across store reinitialization", async () => {
  const path = await freshPath();
  const store = makeStore(path);
  const created = await store.createProject("Persist", "Kept");
  const reopened = makeStore(path);
  const listed = await reopened.listProjects();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, created.id);
  assert.equal(listed[0].description, "Kept");
});

test("persists a versioned document with restrictive permissions", async () => {
  const path = await freshPath();
  const store = makeStore(path);
  await store.createProject("Permissions");

  const parsed = JSON.parse(await readFile(path, "utf8"));
  assert.equal(parsed.version, PROJECT_SCHEMA_VERSION);

  if (process.platform !== "win32") {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await stat(dirname(path))).mode & 0o777, 0o700);
  }
});

test("createProjectStore returns an independent store", async () => {
  const path = await freshPath();
  const store = createProjectStore({ filePath: path, idFactory: () => "one" });
  const created = await store.createProject("Independent");
  assert.equal(created.id, "one");
});

test("rejects invalid names, descriptions and arguments", async () => {
  const path = await freshPath();
  const store = makeStore(path, { maxNameLength: 8, maxDescriptionLength: 8 });
  const created = await store.createProject("ok");

  await assert.rejects(store.createProject(""), isCode("INVALID_NAME"));
  await assert.rejects(store.createProject("   "), isCode("INVALID_NAME"));
  await assert.rejects(store.createProject(42), isCode("INVALID_NAME"));
  await assert.rejects(store.createProject("x".repeat(9)), isCode("INVALID_NAME"));
  await assert.rejects(store.createProject("ok", 42), isCode("INVALID_DESCRIPTION"));
  await assert.rejects(store.createProject("ok", "y".repeat(9)), isCode("INVALID_DESCRIPTION"));
  await assert.rejects(store.updateProject(created.id, { name: "" }), isCode("INVALID_NAME"));
  await assert.rejects(store.updateProject("missing", { name: "x" }), isCode("NOT_FOUND"));
  await assert.rejects(store.getProject(""), isCode("INVALID_ARGUMENT"));
  await assert.rejects(store.setProjectArchived(created.id, "yes"), isCode("INVALID_ARGUMENT"));
});

test("does not silently replace a corrupt file", async () => {
  const path = await freshPath();
  const corrupt = "{ this is not json";
  await writeFile(path, corrupt, "utf8");
  const store = makeStore(path);
  await assert.rejects(store.listProjects(), isCode("CORRUPT_DATA"));
  await assert.rejects(store.createProject("no write"), isCode("CORRUPT_DATA"));
  assert.equal(await readFile(path, "utf8"), corrupt);
  assert.deepEqual((await readdir(dirname(path))).filter((f) => f.endsWith(".tmp")), []);
});

test("rejects unsupported versions, duplicate ids and invalid records", async () => {
  const path = await freshPath();
  const valid = {
    id: "p-1",
    name: "Ok",
    description: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archived: false,
  };

  await writeFile(path, JSON.stringify({ version: 999, projects: [] }), "utf8");
  await assert.rejects(makeStore(path).listProjects(), isCode("UNSUPPORTED_VERSION"));

  await writeFile(path, JSON.stringify({ version: 1, projects: [valid, { ...valid, name: "Two" }] }), "utf8");
  await assert.rejects(makeStore(path).listProjects(), isCode("DUPLICATE_ID"));

  const badDocuments = [
    { version: 1, projects: [{ ...valid, createdAt: "nope" }] },
    { version: 1, projects: [{ ...valid, archived: "no" }] },
    { version: 1, projects: [{ ...valid, name: "" }] },
    { version: 1, projects: [{ ...valid, id: "has space" }] },
    { version: 1, projects: ["not an object"] },
  ];
  for (const document of badDocuments) {
    await writeFile(path, JSON.stringify(document), "utf8");
    await assert.rejects(makeStore(path).listProjects(), isCode("CORRUPT_DATA"));
  }
});

test("atomic write failure leaves existing data intact", async (t) => {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    t.skip("cannot test a read-only directory as root");
    return;
  }

  const path = await freshPath();
  const store = makeStore(path);
  const first = await store.createProject("Keep me");
  const before = await readFile(path, "utf8");

  await chmod(dirname(path), 0o500);
  try {
    await assert.rejects(store.createProject("cannot write"), isCode("STORAGE_IO"));
  } finally {
    await chmod(dirname(path), 0o700);
  }

  assert.equal(await readFile(path, "utf8"), before);
  assert.deepEqual((await store.listProjects()).map((item) => item.id), [first.id]);
});

test("concurrent creates do not lose projects and enforce limits", async () => {
  const path = await freshPath();
  const store = makeStore(path, { maxProjects: 5 });

  await Promise.all(Array.from({ length: 5 }, (_, index) => store.createProject(`Project ${index}`)));
  const listed = await store.listProjects();
  assert.equal(listed.length, 5);
  assert.equal(new Set(listed.map((item) => item.id)).size, 5);

  await assert.rejects(store.createProject("Too many"), isCode("LIMIT_EXCEEDED"));
});

test("loads legacy projects without context using empty defaults", async () => {
  const path = await freshPath();
  const legacy = {
    id: "p-1",
    name: "Legacy",
    description: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archived: false,
  };
  await writeFile(path, JSON.stringify({ version: 1, projects: [legacy] }), "utf8");

  const project = await makeStore(path).getProject("p-1");
  assert.deepEqual(project.context, { purpose: "", goals: "", techStack: "", instructions: "", notes: "" });
  assert.equal(JSON.parse(await readFile(path, "utf8")).projects[0].context, undefined);
});

test("persists project context across reinitialization", async () => {
  const path = await freshPath();
  const store = makeStore(path);
  const created = await store.createProject("Context");

  const updated = await store.updateProject(created.id, {
    context: { purpose: "P", goals: "G", techStack: "T", instructions: "I", notes: "N" },
  });
  assert.equal(updated.context.purpose, "P");

  const reopened = makeStore(path);
  assert.equal((await reopened.getProject(created.id)).context.notes, "N");
});

test("validates context fields and combined size", async () => {
  const path = await freshPath();
  const store = makeStore(path);
  const created = await store.createProject("Validate");

  await assert.rejects(store.updateProject(created.id, { context: "nope" }), isCode("INVALID_CONTEXT"));
  await assert.rejects(store.updateProject(created.id, { context: [] }), isCode("INVALID_CONTEXT"));
  await assert.rejects(store.updateProject(created.id, { context: { purpose: 42 } }), isCode("INVALID_CONTEXT"));
  await assert.rejects(
    store.updateProject(created.id, { context: { purpose: "x".repeat(PROJECT_CONTEXT_FIELD_LIMITS.purpose + 1) } }),
    isCode("INVALID_CONTEXT"),
  );
  await assert.rejects(
    store.updateProject(created.id, {
      context: {
        notes: "n".repeat(PROJECT_CONTEXT_FIELD_LIMITS.notes),
        goals: "g".repeat(PROJECT_CONTEXT_FIELD_LIMITS.goals),
        instructions: "i".repeat(PROJECT_CONTEXT_FIELD_LIMITS.instructions),
        purpose: "p".repeat(PROJECT_CONTEXT_FIELD_LIMITS.purpose),
      },
    }),
    isCode("INVALID_CONTEXT"),
  );
});

test("rejects corrupt stored context without rewriting the file", async () => {
  const path = await freshPath();
  const corrupt = JSON.stringify({
    version: 1,
    projects: [
      {
        id: "p-1",
        name: "X",
        description: "",
        context: "not-an-object",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        archived: false,
      },
    ],
  });
  await writeFile(path, corrupt, "utf8");
  await assert.rejects(makeStore(path).listProjects(), isCode("CORRUPT_DATA"));
  assert.equal(await readFile(path, "utf8"), corrupt);
});

test("returns context copies that cannot mutate stored data", async () => {
  const path = await freshPath();
  const store = makeStore(path);
  const created = await store.createProject("Copies");
  await store.updateProject(created.id, { context: { notes: "original" } });

  const copy = await store.getProject(created.id);
  copy.context.notes = "tampered";
  assert.equal((await store.getProject(created.id)).context.notes, "original");
});

test("searches project context as well as name and description", async () => {
  const path = await freshPath();
  const store = makeStore(path);
  const created = await store.createProject("Alpha");
  await store.updateProject(created.id, { context: { techStack: "Next.js and Ollama" } });
  assert.deepEqual((await store.listProjects({ query: "ollama" })).map((item) => item.id), [created.id]);
});

test("connects and disconnects a source folder with validation", async () => {
  const path = await freshPath();
  const store = makeStore(path);
  const created = await store.createProject("Folder");
  assert.equal(created.sourceFolder, null);

  const connected = await store.setProjectSourceFolder(created.id, "  /Users/me/code/app  ");
  assert.equal(connected.sourceFolder, "/Users/me/code/app");
  assert.equal((await makeStore(path).getProject(created.id)).sourceFolder, "/Users/me/code/app");

  const cleared = await store.setProjectSourceFolder(created.id, null);
  assert.equal(cleared.sourceFolder, null);

  await assert.rejects(store.setProjectSourceFolder(created.id, 42), isCode("INVALID_FOLDER"));
  await assert.rejects(store.setProjectSourceFolder(created.id, "x".repeat(5000)), isCode("INVALID_FOLDER"));
});

test("loads legacy projects without a source folder", async () => {
  const path = await freshPath();
  const legacy = {
    id: "p-1",
    name: "Legacy",
    description: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archived: false,
  };
  await writeFile(path, JSON.stringify({ version: 1, projects: [legacy] }), "utf8");
  assert.equal((await makeStore(path).getProject("p-1")).sourceFolder, null);
});

test("rejects a corrupt stored source folder without rewriting the file", async () => {
  const path = await freshPath();
  const corrupt = JSON.stringify({
    version: 1,
    projects: [
      {
        id: "p-1",
        name: "X",
        description: "",
        sourceFolder: 42,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        archived: false,
      },
    ],
  });
  await writeFile(path, corrupt, "utf8");
  await assert.rejects(makeStore(path).listProjects(), isCode("CORRUPT_DATA"));
  assert.equal(await readFile(path, "utf8"), corrupt);
});

test("searches and filters and returns copies that cannot mutate stored data", async () => {
  const path = await freshPath();
  const store = makeStore(path);
  const alpha = await store.createProject("Alpha design", "Landing page");
  const beta = await store.createProject("Beta API", "Backend work");
  await store.setProjectArchived(beta.id, true);

  assert.deepEqual((await store.listProjects({ query: "landing" })).map((item) => item.id), [alpha.id]);
  assert.deepEqual((await store.listProjects({ query: "beta", archived: "all" })).map((item) => item.id), [beta.id]);
  assert.equal(projectMatchesQuery({ name: "Alpha", description: "" }, "  "), true);
  assert.equal(projectMatchesQuery({ name: "Alpha", description: "" }, "zzz"), false);

  const copy = await store.getProject(alpha.id);
  copy.name = "tampered";
  assert.equal((await store.getProject(alpha.id)).name, "Alpha design");
});

test("projects saved before workspace projects existed load as connected", async () => {
  const path = await freshPath();
  const legacy = {
    version: PROJECT_SCHEMA_VERSION,
    projects: [
      {
        id: "old-1",
        name: "Old project",
        description: "",
        context: {},
        sourceFolder: "/Users/me/code/app",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        archived: false,
      },
    ],
  };
  await writeFile(path, JSON.stringify(legacy), "utf8");
  const store = makeStore(path);
  const project = await store.getProject("old-1");
  assert.equal(project.kind, "connected");
  assert.equal(project.template, null);
  assert.equal(project.sourceFolder, "/Users/me/code/app");
});

test("a workspace project keeps its kind, template, and folder across reloads", async () => {
  const path = await freshPath();
  const created = await makeStore(path).createProject("Client A", "Lease review", {
    id: "chosen-id",
    kind: "managed",
    template: "client-matter",
    sourceFolder: "/Users/me/VYXO Projects/client-a",
  });
  assert.equal(created.id, "chosen-id");
  const reloaded = await makeStore(path).getProject("chosen-id");
  assert.equal(reloaded.kind, "managed");
  assert.equal(reloaded.template, "client-matter");
  assert.equal(reloaded.sourceFolder, "/Users/me/VYXO Projects/client-a");
});

test("a workspace project needs a folder, and a connected one cannot be created with one", async () => {
  const store = makeStore(await freshPath());
  await assert.rejects(store.createProject("No folder", "", { kind: "managed" }), isCode("INVALID_FOLDER"));
  await assert.rejects(
    store.createProject("Early folder", "", { kind: "connected", sourceFolder: "/Users/me/x" }),
    isCode("INVALID_ARGUMENT"),
  );
  await assert.rejects(store.createProject("Bad kind", "", { kind: "other" }), isCode("INVALID_ARGUMENT"));
  await assert.rejects(
    store.createProject("Bad template", "", { kind: "managed", sourceFolder: "/x", template: "../etc" }),
    isCode("INVALID_ARGUMENT"),
  );
  await assert.rejects(store.createProject("Bad id", "", { id: "has space" }), isCode("INVALID_ARGUMENT"));
});

test("a chosen project id cannot collide with an existing one", async () => {
  const store = makeStore(await freshPath());
  await store.createProject("First", "", { id: "same" });
  await assert.rejects(store.createProject("Second", "", { id: "same" }), isCode("DUPLICATE_ID"));
});

test("a workspace project's folder cannot be reconnected or removed", async () => {
  const store = makeStore(await freshPath());
  const created = await store.createProject("Managed", "", {
    kind: "managed",
    template: "blank",
    sourceFolder: "/Users/me/VYXO Projects/managed",
  });
  await assert.rejects(store.setProjectSourceFolder(created.id, "/Users/me/elsewhere"), isCode("INVALID_FOLDER"));
  await assert.rejects(store.setProjectSourceFolder(created.id, null), isCode("INVALID_FOLDER"));
  assert.equal((await store.getProject(created.id)).sourceFolder, "/Users/me/VYXO Projects/managed");
});

test("saved data that breaks the workspace rules is rejected, not silently fixed", async () => {
  const base = {
    id: "x",
    name: "X",
    description: "",
    context: {},
    sourceFolder: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archived: false,
  };
  for (const bad of [
    { ...base, kind: "managed" },
    { ...base, kind: "weird", sourceFolder: "/x" },
    { ...base, template: "Has Caps", sourceFolder: "/x" },
  ]) {
    const path = await freshPath();
    await writeFile(path, JSON.stringify({ version: PROJECT_SCHEMA_VERSION, projects: [bad] }), "utf8");
    await assert.rejects(makeStore(path).listProjects(), isCode("CORRUPT_DATA"));
  }
});
