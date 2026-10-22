import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../projects/store.ts";
import { buildSite, problemSummary, renameSiteAssets, siteBuildState } from "./build.ts";
import { createManagedProject } from "./create.ts";
import { listAllFiles, listFilesLimited } from "./files.ts";
import { resolveSiteDepsDir, siteRuntime } from "./runtime.ts";
import { previewResponse } from "./preview.ts";

const root = await mkdtemp(join(tmpdir(), "vyxo-build-test-"));
after(() => rm(root, { recursive: true, force: true }));

// These tests build a real Next.js site with the packages in this repository's node_modules.
const depsDir = resolveSiteDepsDir(process.env, process.cwd());
const runtime = siteRuntime(depsDir);
const skip = runtime ? false : "the Next.js packages are not installed in this checkout";

async function websiteProject(name) {
  const dir = await mkdtemp(join(root, "case-"));
  const store = new ProjectStore({ filePath: join(dir, "projects.json"), idFactory: randomUUID });
  const project = await createManagedProject(
    { store, projectsDir: join(dir, "VYXO Projects"), siteDepsDir: depsDir, idFactory: randomUUID },
    { name, template: "website-nextjs" },
  );
  return { store, project };
}

test("a Next.js starter builds into a static site that the preview can show", { skip, timeout: 240_000 }, async () => {
  const { store, project } = await websiteProject("Bakery Studio");
  const state = await buildSite({ projectId: project.id, folder: project.sourceFolder, runtime });
  assert.equal(state.status, "ready", state.message ?? "");
  assert.equal(siteBuildState(project.id).status, "ready");

  const html = await readFile(join(project.sourceFolder, "out", "index.html"), "utf8");
  assert.ok(html.includes("Bakery Studio"));

  const page = await previewResponse(store, project.id, []);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") ?? "", /text\/html/);
  assert.match(page.headers.get("content-security-policy") ?? "", /connect-src 'none'/);
  assert.ok((await page.text()).includes("Bakery Studio"));

  // Styles and scripts are loaded through the preview too, so they must resolve inside the site.
  const css = html.match(/\/api\/preview\/[^"]+\.css/);
  assert.ok(css, "the built page should link its stylesheet through the preview");
  const style = await previewResponse(store, project.id, css[0].split("/").slice(4));
  assert.equal(style.status, 200);
  assert.match(style.headers.get("content-type") ?? "", /text\/css/);
  assert.ok((await stat(join(project.sourceFolder, "out", "vyxo-assets"))).isDirectory());
  assert.equal(html.includes("/_next/"), false, "the built page must not use the _next folder name");
});

test("a site that does not compile reports the problem and shows no stale build", { skip, timeout: 240_000 }, async () => {
  const { store, project } = await websiteProject("Broken Page");
  await writeFile(join(project.sourceFolder, "app", "page.tsx"), "export default function Home() {\n  return <main>\n", "utf8");
  const state = await buildSite({ projectId: project.id, folder: project.sourceFolder, runtime });
  assert.equal(state.status, "failed");
  assert.ok(state.message && state.message.length > 0);

  const page = await previewResponse(store, project.id, []);
  assert.equal(page.status, 404);
  assert.match(await page.text(), /not been built yet/);
});

test("a build that takes too long is stopped with a plain message", { skip, timeout: 240_000 }, async () => {
  const { project } = await websiteProject("Slow Build");
  const state = await buildSite({ projectId: project.id, folder: project.sourceFolder, runtime, timeoutMs: 1 });
  assert.equal(state.status, "failed");
  assert.match(state.message, /took too long/);
});

test("error summaries leave out colour codes and keep the useful lines", () => {
  const output = "\u001b[31mError:\u001b[0m Module not found: './missing'\nsome progress line\nFailed to compile.\n";
  const summary = problemSummary(output, false);
  assert.equal(summary.includes("\u001b"), false);
  assert.ok(summary.includes("Module not found"));
  assert.equal(problemSummary("", false), "The build failed for an unknown reason.");
});

test("the bundled site packages are found from the override folder, and a missing install is reported", async () => {
  const fake = await mkdtemp(join(root, "found-"));
  await mkdir(join(fake, "next", "dist", "bin"), { recursive: true });
  await writeFile(join(fake, "next", "dist", "bin", "next"), "// stand-in\n");
  assert.equal(resolveSiteDepsDir({ VYXO_SITE_DEPS: fake }, root), fake);
  assert.equal(siteRuntime(fake, "/usr/bin/node").nextBin, join(fake, "next", "dist", "bin", "next"));

  const empty = await mkdtemp(join(root, "empty-"));
  assert.equal(resolveSiteDepsDir({ VYXO_SITE_DEPS: empty }, root), null);
  assert.equal(siteRuntime(null), null);
});

test("after a build, the export and the assistant's file list leave out the build folders", { skip, timeout: 240_000 }, async () => {
  const { project } = await websiteProject("Export Check");
  const state = await buildSite({ projectId: project.id, folder: project.sourceFolder, runtime });
  assert.equal(state.status, "ready", state.message ?? "");

  const exported = (await listAllFiles(project.sourceFolder)).map((file) => file.path);
  assert.ok(exported.includes("app/page.tsx"));
  assert.ok(exported.includes("package.json"));
  assert.equal(exported.some((path) => path.startsWith(".next/") || path.startsWith("out/") || path.startsWith("node_modules")), false);

  const context = (await listFilesLimited(project.sourceFolder, 300)).files.map((file) => file.path);
  assert.ok(context.includes("app/page.tsx"));
  assert.equal(context.some((path) => path.startsWith(".next/") || path.startsWith("out/")), false);
});

test("the asset folder is renamed and every reference in the built files follows it", async () => {
  const out = await mkdtemp(join(root, "assets-"));
  await mkdir(join(out, "_next", "static", "css"), { recursive: true });
  await writeFile(join(out, "_next", "static", "css", "a.css"), "body{}");
  await writeFile(join(out, "index.html"), '<link href="/api/preview/x/_next/static/css/a.css"><script src="_next/static/x.js"></script>');
  await writeFile(join(out, "_next", "static", "x.js"), 'var p="/_next/static/";var q="my_next/keep";');
  await renameSiteAssets(out);
  assert.equal(await readFile(join(out, "index.html"), "utf8"), '<link href="/api/preview/x/vyxo-assets/static/css/a.css"><script src="vyxo-assets/static/x.js"></script>');
  assert.match(await readFile(join(out, "vyxo-assets", "static", "x.js"), "utf8"), /"\/vyxo-assets\/static\/"/);
  assert.match(await readFile(join(out, "vyxo-assets", "static", "x.js"), "utf8"), /my_next\/keep/);
});
