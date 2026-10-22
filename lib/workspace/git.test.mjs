import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkRemoteAddress, gitInit, gitPush, gitSetRemote, gitSnapshot, gitStatus, GITIGNORE } from "./git.ts";
import { WorkspaceError } from "./errors.ts";

const root = await mkdtemp(join(tmpdir(), "vyxo-git-test-"));
after(() => rm(root, { recursive: true, force: true }));

const identity = { name: "Test Person", email: "test@example.com" };

async function project(name) {
  const folder = join(root, name);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "README.md"), "# Project\n");
  await writeFile(join(folder, "index.html"), "<h1>Hello</h1>\n");
  return folder;
}

function git(folder, ...args) {
  return execFileSync("git", args, { cwd: folder, encoding: "utf8" }).trim();
}

test("a folder that is not a repository says so, and status never changes anything", async () => {
  const folder = await project("plain");
  const status = await gitStatus(folder);
  assert.equal(status.repository, false);
  await assert.rejects(readFile(join(folder, ".git", "HEAD"), "utf8"));
});

test("set up Git: the first snapshot holds the project's files and nothing private or built", async () => {
  const folder = await project("setup");
  await symlink(join(root, "plain"), join(folder, "node_modules"));
  await mkdir(join(folder, ".next"), { recursive: true });
  await writeFile(join(folder, ".next", "cache.txt"), "cache");
  await writeFile(join(folder, ".env"), "SECRET=1");
  const status = await gitInit(folder, identity);
  assert.equal(status.repository, true);
  assert.equal(status.branch, "main");
  assert.equal(status.commits[0].subject, "Start project");
  const tracked = git(folder, "ls-files").split("\n");
  assert.ok(tracked.includes("README.md"));
  assert.ok(tracked.includes("index.html"));
  assert.ok(tracked.includes(".gitignore"));
  assert.equal(tracked.some((path) => path.startsWith("node_modules") || path.startsWith(".next") || path.startsWith(".env")), false);
  assert.equal(await readFile(join(folder, ".gitignore"), "utf8"), GITIGNORE);
});

test("a snapshot saves changes, and says so when nothing changed", async () => {
  const folder = await project("snapshots");
  await gitInit(folder, identity);
  await writeFile(join(folder, "index.html"), "<h1>Changed</h1>\n");
  const status = await gitSnapshot(folder, "New heading");
  assert.equal(status.commits[0].subject, "New heading");
  assert.equal(status.changeCount, 0);
  await assert.rejects(gitSnapshot(folder, "Again"), (error) => error instanceof WorkspaceError && /Nothing has changed/.test(error.message));
});

test("private-looking files are refused, and nothing is left staged", async () => {
  const folder = await project("private");
  await gitInit(folder, identity);
  await writeFile(join(folder, "credentials.json"), "hunter2");
  await assert.rejects(
    gitSnapshot(folder, "Add notes"),
    (error) => error instanceof WorkspaceError && /look private/.test(error.message),
  );
  assert.equal(git(folder, "diff", "--cached", "--name-only"), "");
  assert.equal(git(folder, "rev-list", "--count", "HEAD"), "1");
});

test("the remote address must be a web or SSH address; nothing else is accepted", () => {
  assert.equal(checkRemoteAddress("https://github.com/someone/site.git"), "https://github.com/someone/site.git");
  assert.equal(checkRemoteAddress("git@github.com:someone/site.git"), "git@github.com:someone/site.git");
  for (const bad of ["--upload-pack=evil", "/tmp/somewhere", "file:///tmp/x", "https://x.com/a b", ""]) {
    assert.throws(() => checkRemoteAddress(bad), WorkspaceError, bad);
  }
});

test("push sends the snapshots to the remote, and says what to do when there is no remote", async () => {
  const folder = await project("push");
  const bare = join(root, "remote-push.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
  await gitInit(folder, identity);
  await assert.rejects(gitPush(folder), (error) => /Connect a GitHub repository first/.test(error.message));
  git(folder, "remote", "add", "origin", bare);
  await gitPush(folder);
  assert.equal(execFileSync("git", ["--git-dir", bare, "log", "--format=%s", "-1", "main"], { encoding: "utf8" }).trim(), "Start project");
});

test("an address that the remote refuses gives a plain message", async () => {
  const folder = await project("refused");
  await gitInit(folder, identity);
  git(folder, "remote", "add", "origin", join(root, "does-not-exist.git"));
  await assert.rejects(gitPush(folder), (error) => error instanceof WorkspaceError && error.message.length > 0 && !/fatal:/.test(error.message));
});

test("connecting a remote stores its address for the project", async () => {
  const folder = await project("connect");
  await gitInit(folder, identity);
  const status = await gitSetRemote(folder, "https://github.com/someone/connect.git");
  assert.equal(status.remote, "https://github.com/someone/connect.git");
});
