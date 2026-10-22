import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../projects/store.ts";
import { createManagedProject } from "./create.ts";
import { createFile } from "./files.ts";
import { MAX_PREVIEW_FILE_BYTES, PREVIEW_CSP, previewResponse } from "./preview.ts";

const base = await mkdtemp(join(tmpdir(), "vyxo-preview-test-"));
after(() => rm(base, { recursive: true, force: true }));

async function fresh(template = "website") {
  const dir = await mkdtemp(join(base, "case-"));
  let counter = 0;
  const store = new ProjectStore({ filePath: join(dir, "projects.json"), idFactory: () => `p-${++counter}` });
  const project = await createManagedProject(
    { store, projectsDir: join(dir, "VYXO Projects"), idFactory: () => `ws-${++counter}` },
    { name: "Site", template },
  );
  return { dir, store, project };
}

test("serves the project's index page by default, with the right type", async () => {
  const { store, project } = await fresh();
  for (const segments of [undefined, [], ["index.html"]]) {
    const response = await previewResponse(store, project.id, segments);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
    assert.match(await response.text(), /<title>Site<\/title>/);
  }
  assert.equal((await previewResponse(store, project.id, ["styles.css"])).headers.get("content-type"), "text/css; charset=utf-8");
  assert.equal((await previewResponse(store, project.id, ["script.js"])).headers.get("content-type"), "text/javascript; charset=utf-8");
});

test("every response carries a policy that blocks the network and isolates the page", async () => {
  const { store, project } = await fresh();
  for (const segments of [["index.html"], ["styles.css"], ["nope.html"], ["..", "x"]]) {
    const response = await previewResponse(store, project.id, segments);
    const csp = response.headers.get("content-security-policy");
    assert.ok(csp, "a policy is always sent");
    assert.match(csp, /sandbox/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
  const ok = (await previewResponse(store, project.id, ["index.html"])).headers.get("content-security-policy");
  assert.equal(ok, PREVIEW_CSP);
  for (const required of ["sandbox allow-scripts", "default-src 'none'", "connect-src 'none'", "frame-src 'none'", "object-src 'none'", "form-action 'none'", "frame-ancestors 'self'"]) {
    assert.ok(ok.includes(required), required);
  }
  assert.equal(/allow-same-origin|allow-top-navigation|allow-popups|allow-forms/.test(ok), false, "no sandbox escapes are granted");
  assert.equal(/https?:|\*/.test(ok), false, "no outside address or wildcard is allowed");
});

test("a page cannot read outside its own project", async () => {
  const { dir, store, project } = await fresh();
  await writeFile(join(dir, "outside.html"), "<p>secret</p>");
  await mkdir(join(dir, "outside"));
  await writeFile(join(dir, "outside", "a.css"), "x");
  await symlink(join(dir, "outside"), join(project.sourceFolder, "link"));
  await symlink(join(dir, "outside.html"), join(project.sourceFolder, "peek.html"));

  const attempts = [
    ["..", "outside.html"],
    ["..", "..", "projects.json"],
    ["%2e%2e", "outside.html"],
    ["sub", "..", "..", "outside.html"],
    [".", "index.html"],
    ["", "index.html"],
    ["link", "a.css"],
    ["peek.html"],
    ["\0", "index.html"],
    ["a\\..\\..\\outside.html"],
    ["/etc/passwd"],
  ];
  for (const segments of attempts) {
    const response = await previewResponse(store, project.id, segments);
    assert.notEqual(response.status, 200, JSON.stringify(segments));
    assert.equal((await response.text()).includes("secret"), false);
  }
});

test("VYXO's own bookkeeping is never served", async () => {
  const { store, project } = await fresh();
  for (const segments of [[".vyxo", "project.json"], [".VYXO", "project.json"], [".vyxo"], ["x", ".vyxo", "trash"]]) {
    const response = await previewResponse(store, project.id, segments);
    assert.notEqual(response.status, 200, JSON.stringify(segments));
    assert.equal((await response.text()).includes("projectId"), false);
  }
});

test("only web file types are served", async () => {
  const { store, project } = await fresh();
  for (const name of ["run.sh", ".env", "notes.docx", "data.sqlite", "tool.exe", "page.php", "noextension"]) {
    await createFile(project.sourceFolder, name, "x");
    const response = await previewResponse(store, project.id, [name]);
    assert.equal(response.status, 415, name);
  }
  await createFile(project.sourceFolder, "logo.svg", "<svg xmlns='http://www.w3.org/2000/svg'/>");
  const svg = await previewResponse(store, project.id, ["logo.svg"]);
  assert.equal(svg.status, 200);
  assert.equal(svg.headers.get("content-type"), "image/svg+xml");
  assert.match(svg.headers.get("content-security-policy"), /sandbox/, "svg scripts stay sandboxed");
});

test("a folder serves its index page and is never listed", async () => {
  const { store, project } = await fresh();
  await createFile(project.sourceFolder, "docs/index.html", "<h1>Docs</h1>");
  await createFile(project.sourceFolder, "empty/readme.txt", "x");
  assert.equal(await (await previewResponse(store, project.id, ["docs"])).text(), "<h1>Docs</h1>");
  const listing = await previewResponse(store, project.id, ["empty"]);
  assert.equal(listing.status, 404);
  assert.equal((await listing.text()).includes("readme.txt"), false);
});

test("missing files, huge files, and other kinds of projects get plain refusals", async () => {
  const { store, project } = await fresh();
  assert.equal((await previewResponse(store, project.id, ["missing.html"])).status, 404);
  await createFile(project.sourceFolder, "big.js", "x".repeat(MAX_PREVIEW_FILE_BYTES + 1));
  assert.equal((await previewResponse(store, project.id, ["big.js"])).status, 413);

  const connected = await store.createProject("Mine");
  assert.equal((await previewResponse(store, connected.id, ["index.html"])).status, 404);
  assert.equal((await previewResponse(store, "unknown", ["index.html"])).status, 404);
});

test("the page reflects edits immediately, and nothing is cached", async () => {
  const { store, project } = await fresh();
  await writeFile(join(project.sourceFolder, "index.html"), "<h1>one</h1>");
  assert.equal(await (await previewResponse(store, project.id, ["index.html"])).text(), "<h1>one</h1>");
  await writeFile(join(project.sourceFolder, "index.html"), "<h1>two</h1>");
  const second = await previewResponse(store, project.id, ["index.html"]);
  assert.equal(await second.text(), "<h1>two</h1>");
  assert.match(second.headers.get("cache-control"), /no-store/);
});
