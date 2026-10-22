import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DATA_FOLDER_NAME,
  legacyDataDirectory,
  migrateLegacyData,
  PROJECTS_FOLDER_NAME,
  prepareDataDirectory,
  resolveDataDirectory,
  resolveProjectsDirectory,
} from "./location.ts";

const mode = (path) => statSync(path).mode & 0o777;

function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), "vyxo-location-test-"));
  const support = join(home, "Library", "Application Support");
  mkdirSync(support, { recursive: true });
  return { home, support };
}

test("data folder differs from Electron's own profile folder", () => {
  assert.notEqual(DATA_FOLDER_NAME.toLowerCase(), "vyxo");
});

test("resolves a sensible folder on each platform", () => {
  assert.equal(
    resolveDataDirectory({}, "darwin", "/Users/a"),
    `/Users/a/Library/Application Support/${DATA_FOLDER_NAME}`,
  );
  assert.equal(
    resolveDataDirectory({ APPDATA: "C:\\Users\\a\\AppData\\Roaming" }, "win32", "C:\\Users\\a").endsWith(DATA_FOLDER_NAME),
    true,
  );
  assert.equal(resolveDataDirectory({}, "linux", "/home/a"), `/home/a/.local/share/${DATA_FOLDER_NAME}`);
  assert.equal(
    resolveDataDirectory({ XDG_DATA_HOME: "/data" }, "linux", "/home/a"),
    `/data/${DATA_FOLDER_NAME}`,
  );
  assert.equal(resolveDataDirectory({ VYXO_DATA_DIR: "/custom" }, "linux", "/home/a"), "/custom");
});

test("only macOS has a legacy folder", () => {
  assert.equal(legacyDataDirectory("linux", "/home/a"), null);
  assert.equal(legacyDataDirectory("win32", "C:\\a"), null);
  assert.ok(legacyDataDirectory("darwin", "/Users/a")?.endsWith("ShipStudioAI"));
});

test("copies old data once, keeps the backup, and uses private permissions", () => {
  const { home, support } = fakeHome();
  const legacy = join(support, "ShipStudioAI");
  mkdirSync(join(legacy, "edit-recovery"), { recursive: true, mode: 0o755 });
  writeFileSync(join(legacy, "memories.json"), '{"version":1,"memories":[]}', { mode: 0o644 });
  writeFileSync(join(legacy, "edit-recovery", "a.txt"), "x", { mode: 0o644 });

  const dir = prepareDataDirectory({}, "darwin", home);
  assert.equal(dir, join(support, DATA_FOLDER_NAME));
  assert.equal(readFileSync(join(dir, "memories.json"), "utf8"), '{"version":1,"memories":[]}');
  assert.equal(readFileSync(join(dir, "edit-recovery", "a.txt"), "utf8"), "x");
  assert.equal(mode(dir), 0o700);
  assert.equal(mode(join(dir, "memories.json")), 0o600);
  assert.equal(readFileSync(join(legacy, "memories.json"), "utf8"), '{"version":1,"memories":[]}');
});

test("never overwrites data that already exists in the new folder", () => {
  const { home, support } = fakeHome();
  const legacy = join(support, "ShipStudioAI");
  const target = join(support, DATA_FOLDER_NAME);
  mkdirSync(legacy, { recursive: true });
  mkdirSync(target, { recursive: true });
  writeFileSync(join(legacy, "memories.json"), "old");
  writeFileSync(join(target, "memories.json"), "new");

  assert.equal(migrateLegacyData(target, legacy), "already-present");
  assert.equal(readFileSync(join(target, "memories.json"), "utf8"), "new");
  assert.equal(prepareDataDirectory({}, "darwin", home), target);
});

test("a fresh install starts empty and creates nothing", () => {
  const { home, support } = fakeHome();
  const dir = prepareDataDirectory({}, "darwin", home);
  assert.equal(dir, join(support, DATA_FOLDER_NAME));
  assert.equal(existsSync(dir), false);
});

test("an explicit data folder is used as-is without migrating", () => {
  const { home, support } = fakeHome();
  mkdirSync(join(support, "ShipStudioAI"));
  const custom = join(home, "custom");
  assert.equal(prepareDataDirectory({ VYXO_DATA_DIR: custom }, "darwin", home), custom);
  assert.equal(existsSync(custom), false);
});

test("if the copy cannot be made, the old folder keeps being used", () => {
  const { home, support } = fakeHome();
  const legacy = join(support, "ShipStudioAI");
  mkdirSync(legacy);
  writeFileSync(join(legacy, "memories.json"), "old");
  // Make the target's parent unwritable by pointing it at a file.
  const blocker = join(home, "blocker");
  writeFileSync(blocker, "");
  const target = join(blocker, "child");
  assert.equal(migrateLegacyData(target, legacy), "failed");
});

test("projects live in a visible folder in the home directory, not a protected one", () => {
  const dir = resolveProjectsDirectory({}, "/Users/a");
  assert.equal(dir, `/Users/a/${PROJECTS_FOLDER_NAME}`);
  for (const guarded of ["Documents", "Desktop", "Downloads", "Library"]) {
    assert.equal(dir.includes(`/${guarded}/`), false);
  }
  assert.equal(resolveProjectsDirectory({ VYXO_PROJECTS_DIR: "/custom/projects" }, "/Users/a"), "/custom/projects");
});
