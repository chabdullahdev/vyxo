import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir, tmpdir } from "node:os";
import { isForbiddenRoot, isPathInsideRoot } from "./policy.ts";

test("rejects filesystem and home roots", () => {
  for (const path of ["/", homedir(), "/System", "/System/Library", "/usr/bin", "/private/etc", "/Volumes", "/Applications"]) {
    assert.equal(isForbiddenRoot(path), true, path);
  }
});

test("allows ordinary project folders", () => {
  for (const path of [tmpdir(), "/Users/someone/code/project", "/private/var/folders/xy/T/project"]) {
    assert.equal(isForbiddenRoot(path), false, path);
  }
  assert.equal(isForbiddenRoot("relative/path"), true);
});

test("checks containment inside a root", () => {
  const root = "/Users/me/project";
  assert.equal(isPathInsideRoot(root, root), true);
  assert.equal(isPathInsideRoot(root, `${root}/src/index.ts`), true);
  assert.equal(isPathInsideRoot(root, "/Users/me/projectile"), false);
  assert.equal(isPathInsideRoot(root, "/Users/me"), false);
  assert.equal(isPathInsideRoot(root, "/Users/me/project/../secret"), false);
});
