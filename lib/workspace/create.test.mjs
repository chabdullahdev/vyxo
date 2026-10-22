import { after, test } from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../projects/store.ts";
import { classifyProjectFilePath, isExcludedProjectDirectory } from "../project/policy.ts";
import { createManagedProject, folderNameFor, readMarker, removeWorkspaceFolder } from "./create.ts";
import { WorkspaceError } from "./errors.ts";
import { listTemplates } from "./templates.ts";

const root = await mkdtemp(join(tmpdir(), "vyxo-workspace-test-"));
after(() => rm(root, { recursive: true, force: true }));

/** A stand-in for the site packages that ship with VYXO: just enough to show they are present. */
async function fakeSiteDeps() {
  const dir = await mkdtemp(join(root, "site-deps-"));
  await mkdir(join(dir, "next", "dist", "bin"), { recursive: true });
  await writeFile(join(dir, "next", "dist", "bin", "next"), "// stand-in\n");
  return dir;
}

async function fresh(overrides = {}) {
  const dir = await mkdtemp(join(root, "case-"));
  const projectsDir = join(dir, "VYXO Projects");
  let counter = 0;
  const store = new ProjectStore({ filePath: join(dir, "projects.json"), idFactory: () => `p-${++counter}`, ...overrides });
  const siteDepsDir = await fakeSiteDeps();
  return { dir, projectsDir, store, deps: { store, projectsDir, siteDepsDir, idFactory: () => `ws-${++counter}` } };
}

const isCode = (code) => (error) => error instanceof WorkspaceError && error.code === code;
const walk = async (dir, prefix = "") => {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out.sort();
};

test("creates a visible folder, the template's files, a marker, and the project record", async () => {
  const { projectsDir, store, deps } = await fresh();
  const project = await createManagedProject(deps, { name: "Acme lease review", description: "Q3", template: "client-matter" });

  assert.equal(project.kind, "managed");
  assert.equal(project.template, "client-matter");
  assert.equal(project.sourceFolder.endsWith("/VYXO Projects/Acme lease review"), true);
  assert.deepEqual(await walk(project.sourceFolder), [
    ".vyxo/project.json",
    "README.md",
    "checklist.md",
    "drafts/README.md",
    "overview.md",
    "sources/README.md",
    "timeline.md",
  ]);
  const marker = await readMarker(project.sourceFolder);
  assert.equal(marker.projectId, project.id);
  assert.equal(marker.template, "client-matter");
  assert.equal((await readFile(join(project.sourceFolder, "README.md"), "utf8")).startsWith("# Acme lease review"), true);
  assert.equal((await store.getProject(project.id)).sourceFolder, project.sourceFolder);
  assert.equal((await stat(project.sourceFolder)).mode & 0o777, 0o700);
  assert.equal((await stat(join(project.sourceFolder, "README.md"))).mode & 0o777, 0o600);
  assert.ok((await readdir(projectsDir)).includes("Acme lease review"));
});

test("every template works for every audience and is fully readable by the assistant", async () => {
  const { deps } = await fresh();
  for (const template of listTemplates()) {
    const project = await createManagedProject(deps, { name: `T ${template.id}`, template: template.id });
    // The packages link (node_modules) is the one thing the assistant must never read; it is checked separately.
    const files = (await walk(project.sourceFolder)).filter(
      (path) => !path.startsWith(".vyxo/") && !path.startsWith("node_modules"),
    );
    assert.ok(files.length > 0, template.id);
    for (const file of files) {
      assert.equal(classifyProjectFilePath(file), "allowed", `${template.id}: ${file}`);
      assert.equal(isExcludedProjectDirectory(file.split("/").slice(0, -1).join("/") || "x"), false, `${template.id}: ${file}`);
    }
  }
});

test("the website template needs no network and escapes the project name", async () => {
  const { deps } = await fresh();
  const project = await createManagedProject(deps, { name: `<script>alert("x")</script> & Co`, template: "website" });
  const html = await readFile(join(project.sourceFolder, "index.html"), "utf8");
  assert.equal(html.includes("<script>alert"), false);
  assert.ok(html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Co"));
  for (const file of ["index.html", "styles.css", "script.js"]) {
    const text = await readFile(join(project.sourceFolder, file), "utf8");
    assert.equal(/https?:\/\//.test(text), false, `${file} must not reference the internet`);
  }
  assert.equal(
    listTemplates().filter((template) => template.previewable).map((template) => template.id).join(),
    "website-nextjs,website",
  );
});

test("a Next.js website links to the bundled packages instead of copying them", async () => {
  const { deps, dir } = await fresh();
  const project = await createManagedProject(deps, { name: "Bakery", template: "website-nextjs" });
  const link = join(project.sourceFolder, "node_modules");
  assert.ok((await lstat(link)).isSymbolicLink());
  assert.equal(await readlink(link), deps.siteDepsDir);
  for (const file of ["package.json", "next.config.mjs", "app/page.tsx", "app/layout.tsx", "app/globals.css", "site/content.ts", "README.md"]) {
    assert.ok((await stat(join(project.sourceFolder, file))).isFile(), file);
  }
  const content = await readFile(join(project.sourceFolder, "site/content.ts"), "utf8");
  assert.ok(content.includes("Bakery"));
  for (const file of ["app/page.tsx", "app/layout.tsx", "site/content.ts", "next.config.mjs"]) {
    const text = await readFile(join(project.sourceFolder, file), "utf8");
    assert.equal(/https?:\/\//.test(text), false, `${file} must not reference the internet`);
  }
  assert.ok(dir);
});

test("a Next.js website is refused, and nothing is left behind, when the bundled packages are missing", async () => {
  const { deps, projectsDir } = await fresh();
  await assert.rejects(
    createManagedProject({ ...deps, siteDepsDir: null }, { name: "No tools", template: "website-nextjs" }),
    (error) => error instanceof WorkspaceError && error.code === "UNSUPPORTED",
  );
  assert.equal((await readdir(projectsDir)).includes("No tools"), false);
});

test("projects with the same name get their own folders", async () => {
  const { deps } = await fresh();
  const first = await createManagedProject(deps, { name: "Notes", template: "blank" });
  const second = await createManagedProject(deps, { name: "Notes", template: "blank" });
  const third = await createManagedProject(deps, { name: "notes", template: "blank" });
  const names = [first, second, third].map((project) => project.sourceFolder.split("/").pop());
  assert.equal(new Set(names).size, 3);
  assert.equal(names[0], "Notes");
  assert.equal(names[1], "Notes 2");
});

test("folder names are readable and can never escape the projects folder", () => {
  assert.equal(folderNameFor("Client A: Lease (2026)"), "Client A- Lease -2026");
  assert.equal(folderNameFor("Müller & Söhne"), "Müller - Söhne");
  assert.equal(folderNameFor("项目 一"), "项目 一");
  for (const hostile of ["../../etc/passwd", "/absolute/path", "..", "...", ".hidden", "a/b\\c", "\0nul", "   ", "", "con", "x".repeat(500)]) {
    const name = folderNameFor(hostile);
    assert.equal(/[\\/\0]/.test(name), false, hostile);
    assert.equal(name.startsWith("."), false, hostile);
    assert.ok(name.length > 0 && name.length <= 60, hostile);
  }
  assert.equal(folderNameFor("../.."), "Project");
});

test("a bad template or name creates nothing", async () => {
  const { projectsDir, store, deps } = await fresh();
  await assert.rejects(createManagedProject(deps, { name: "X", template: "nope" }), isCode("INVALID_TEMPLATE"));
  await assert.rejects(createManagedProject(deps, { name: "X", template: "../blank" }), isCode("INVALID_TEMPLATE"));
  await assert.rejects(createManagedProject(deps, { name: "   ", template: "blank" }), /name cannot be empty/);
  assert.deepEqual(await store.listProjects({ archived: "all" }), []);
  await assert.rejects(readdir(projectsDir), { code: "ENOENT" });
});

test("if saving the project fails, the folder that was just made is removed", async () => {
  const { projectsDir, store, deps } = await fresh({ maxProjects: 1 });
  await createManagedProject(deps, { name: "One", template: "blank" });
  await assert.rejects(createManagedProject(deps, { name: "Two", template: "documents" }), /project limit/);
  assert.deepEqual(await readdir(projectsDir), ["One"]);
  assert.equal((await store.listProjects()).length, 1);
});

test("a projects folder that is not allowed is refused before anything is created", async () => {
  const { store } = await fresh();
  // The home folder itself is never a valid place to create projects (and creating it is a no-op).
  await assert.rejects(
    createManagedProject({ store, projectsDir: homedir() }, { name: "X", template: "blank" }),
    isCode("UNSAFE"),
  );
  assert.deepEqual(await store.listProjects({ archived: "all" }), []);
});

test("deleting a workspace removes its folder and nothing else", async () => {
  const { projectsDir, deps } = await fresh();
  const keep = await createManagedProject(deps, { name: "Keep", template: "blank" });
  const doomed = await createManagedProject(deps, { name: "Doomed", template: "documents" });
  await writeFile(join(projectsDir, "unrelated.txt"), "mine");
  await removeWorkspaceFolder(doomed, projectsDir);
  assert.deepEqual((await readdir(projectsDir)).sort(), ["Keep", "unrelated.txt"]);
  assert.ok(await readMarker(keep.sourceFolder));
  await removeWorkspaceFolder(doomed, projectsDir); // already gone is fine
});

test("deletion refuses anything that is not exactly this project's own folder", async () => {
  const { dir, projectsDir, deps } = await fresh();
  const mine = await createManagedProject(deps, { name: "Mine", template: "blank" });
  const other = await createManagedProject(deps, { name: "Other", template: "blank" });

  // A record pointing at somebody else's workspace.
  await assert.rejects(removeWorkspaceFolder({ ...mine, sourceFolder: other.sourceFolder }, projectsDir), isCode("UNSAFE"));
  // The projects folder itself, a parent, and a folder outside it.
  await assert.rejects(removeWorkspaceFolder({ ...mine, sourceFolder: projectsDir }, projectsDir), isCode("UNSAFE"));
  await assert.rejects(removeWorkspaceFolder({ ...mine, sourceFolder: dir }, projectsDir), isCode("UNSAFE"));
  const outside = join(dir, "outside");
  await mkdir(join(outside, ".vyxo"), { recursive: true });
  await writeFile(join(outside, ".vyxo", "project.json"), JSON.stringify({ version: 1, projectId: mine.id, name: "x", template: "blank", createdAt: "2026-01-01T00:00:00.000Z" }));
  await assert.rejects(removeWorkspaceFolder({ ...mine, sourceFolder: outside }, projectsDir), isCode("UNSAFE"));
  // A folder without a marker, and a connected project.
  await mkdir(join(projectsDir, "plain"));
  await assert.rejects(removeWorkspaceFolder({ ...mine, sourceFolder: join(projectsDir, "plain") }, projectsDir), isCode("UNSAFE"));
  await assert.rejects(removeWorkspaceFolder({ ...mine, kind: "connected" }, projectsDir), isCode("NOT_A_WORKSPACE"));
  // A link pointing at a real workspace.
  await symlink(other.sourceFolder, join(projectsDir, "link"));
  await assert.rejects(removeWorkspaceFolder({ ...mine, sourceFolder: join(projectsDir, "link") }, projectsDir), isCode("UNSAFE"));

  assert.ok(await readMarker(mine.sourceFolder));
  assert.ok(await readMarker(other.sourceFolder));
  assert.ok((await readdir(outside)).length > 0);
});
