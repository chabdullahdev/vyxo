import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  SWAP_SCRIPT,
  BACKUP_PREFIX,
  STAGING_PREFIX,
  classifyInstall,
  cleanUpLeftovers,
  compareVersions,
  downloadVerified,
  isTrustedDownloadUrl,
  launchSwap,
  pickZipFile,
} = require("./inplace-update.cjs");

const temp = () => mkdtempSync(join(tmpdir(), "vyxo-inplace-test-"));
const sha512 = (buffer) => createHash("sha512").update(buffer).digest("base64");

test("compares versions the way a person would", () => {
  assert.equal(compareVersions("0.2.1", "0.2.0"), 1);
  assert.equal(compareVersions("0.10.0", "0.9.9"), 1);
  assert.equal(compareVersions("1.0.0", "0.99.99"), 1);
  assert.equal(compareVersions("0.2.0", "0.2.0"), 0);
  assert.equal(compareVersions("0.2.0", "0.2.1"), -1);
  assert.equal(compareVersions("v0.3.0", "0.3.0"), 0);
  assert.equal(compareVersions("0.3.0", "0.3.0-beta.1"), 1);
  assert.equal(compareVersions("0.3.0-beta.1", "0.3.0"), -1);
});

test("picks this machine's zip and nothing else", () => {
  const info = {
    files: [
      { url: "VYXO-0.2.1-arm64.dmg", sha512: "a", size: 10 },
      { url: "VYXO-0.2.1-x64.zip", sha512: "b", size: 10 },
      { url: "VYXO-0.2.1-arm64.zip", sha512: "c", size: 10 },
    ],
  };
  assert.deepEqual(pickZipFile(info, "arm64"), { name: "VYXO-0.2.1-arm64.zip", sha512: "c", size: 10 });
  assert.equal(pickZipFile(info, "x64").name, "VYXO-0.2.1-x64.zip");
  assert.equal(pickZipFile(info, "ia32"), null);
});

test("refuses unusual file names, sizes, and feeds", () => {
  for (const url of [
    "../VYXO-0.2.1-arm64.zip",
    "sub/VYXO-0.2.1-arm64.zip",
    "https://evil.example/VYXO-0.2.1-arm64.zip",
    "VYXO-0.2.1-arm64.zip?x=1",
    "evil.zip",
    "VYXO-latest-arm64.zip",
  ]) {
    assert.equal(pickZipFile({ files: [{ url, sha512: "x", size: 10 }] }, "arm64"), null, url);
  }
  assert.equal(pickZipFile({ files: [{ url: "VYXO-0.2.1-arm64.zip", sha512: "x", size: 5 * 1024 ** 3 }] }, "arm64"), null);
  assert.equal(pickZipFile({ files: [{ url: "VYXO-0.2.1-arm64.zip", sha512: "x", size: 0 }] }, "arm64"), null);
  for (const bad of [null, undefined, 1, "x", {}, { files: "no" }, { files: [null, 1, {}] }]) {
    assert.equal(pickZipFile(bad), null);
  }
});

test("only GitHub over https is a trusted download host", () => {
  assert.equal(isTrustedDownloadUrl("https://github.com/chabdullahdev/vyxo/releases/download/v1/x.zip"), true);
  assert.equal(isTrustedDownloadUrl("https://objects.githubusercontent.com/abc"), true);
  assert.equal(isTrustedDownloadUrl("https://release-assets.githubusercontent.com/abc"), true);
  for (const url of [
    "http://github.com/x",
    "https://evil.example/x",
    "https://github.com.evil.example/x",
    "https://evilgithub.com/x",
    "https://user:pass@github.com/x",
    "https://github.com:8443/x",
    "ftp://github.com/x",
    "javascript:alert(1)",
    "not a url",
  ]) {
    assert.equal(isTrustedDownloadUrl(url), false, url);
  }
  assert.equal(isTrustedDownloadUrl("http://127.0.0.1:9999/x.zip"), false);
  assert.equal(isTrustedDownloadUrl("http://127.0.0.1:9999/x.zip", { allowLoopback: true }), true);
  assert.equal(isTrustedDownloadUrl("http://evil.example/x.zip", { allowLoopback: true }), false);
});

test("explains why an app cannot replace itself", () => {
  const yes = () => true;
  const no = () => false;
  assert.deepEqual(classifyInstall("/Applications/VYXO.app/Contents/MacOS/VYXO", { canWrite: yes }), {
    ok: true,
    bundle: "/Applications/VYXO.app",
  });
  assert.equal(classifyInstall("/Applications/VYXO.app/Contents/MacOS/VYXO", { canWrite: no }).reason, "read-only");
  assert.equal(
    classifyInstall("/private/var/folders/x/AppTranslocation/ABC/d/VYXO.app/Contents/MacOS/VYXO", { canWrite: yes }).reason,
    "translocated",
  );
  assert.equal(classifyInstall("/Volumes/VYXO 0.2.0/VYXO.app/Contents/MacOS/VYXO", { canWrite: yes }).reason, "disk-image");
  assert.equal(classifyInstall("/usr/local/bin/node", { canWrite: yes }).reason, "not-an-app");
});

function fakeResponse(buffer, { status = 200, url = "https://github.com/x", length = buffer.length } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: new Headers({ "content-length": String(length) }),
    body: new Response(buffer).body,
  };
}

test("keeps a download only when its checksum and size match", async () => {
  const dir = temp();
  const data = Buffer.from("pretend this is a zip file".repeat(100));
  const dest = join(dir, "ok.zip");
  const seen = [];
  await downloadVerified({
    url: "https://github.com/chabdullahdev/vyxo/releases/download/v1/x.zip",
    destination: dest,
    sha512: sha512(data),
    size: data.length,
    fetchImpl: async () => fakeResponse(data),
    onProgress: (value) => seen.push(value),
  });
  assert.deepEqual(readFileSync(dest), data);
  assert.equal(seen.at(-1), 1);
});

test("throws away a download that does not match, and says why", async () => {
  const dir = temp();
  const data = Buffer.from("real contents");
  const common = { url: "https://github.com/chabdullahdev/vyxo/releases/download/v1/x.zip", size: data.length };

  const wrongHash = join(dir, "a.zip");
  await assert.rejects(
    downloadVerified({ ...common, destination: wrongHash, sha512: sha512(Buffer.from("other")), fetchImpl: async () => fakeResponse(data) }),
    /checksum/,
  );
  assert.equal(existsSync(wrongHash), false);

  const wrongSize = join(dir, "b.zip");
  await assert.rejects(
    downloadVerified({ ...common, destination: wrongSize, size: data.length + 5, sha512: sha512(data), fetchImpl: async () => fakeResponse(data) }),
    /incomplete|larger/,
  );
  assert.equal(existsSync(wrongSize), false);

  await assert.rejects(
    downloadVerified({ ...common, destination: join(dir, "c.zip"), sha512: sha512(data), fetchImpl: async () => fakeResponse(data, { status: 404 }) }),
    /status 404/,
  );
  await assert.rejects(
    downloadVerified({ ...common, url: "https://evil.example/x.zip", destination: join(dir, "d.zip"), sha512: sha512(data), fetchImpl: async () => fakeResponse(data) }),
    /not trusted/,
  );
  await assert.rejects(
    downloadVerified({ ...common, destination: join(dir, "e.zip"), sha512: sha512(data), fetchImpl: async () => fakeResponse(data, { url: "https://evil.example/x.zip" }) }),
    /untrusted/,
  );
  await assert.rejects(
    downloadVerified({ ...common, destination: join(dir, "f.zip"), sha512: sha512(data), fetchImpl: async () => fakeResponse(data, { length: 10 ** 12 }) }),
    /larger/,
  );
});

function makeApps(root) {
  const target = join(root, "VYXO.app");
  const staged = join(root, `${STAGING_PREFIX}1`);
  for (const [dir, label] of [[target, "old"], [staged, "new"]]) {
    mkdirSync(join(dir, "Contents"), { recursive: true });
    writeFileSync(join(dir, "Contents", "version.txt"), label);
  }
  return { target, staged, backup: join(root, `${BACKUP_PREFIX}1`) };
}

const runSwap = (args) => {
  try {
    execFileSync("/bin/sh", ["-c", SWAP_SCRIPT, "swap", ...args], { stdio: "ignore" });
    return 0;
  } catch (error) {
    return error.status;
  }
};

const DEAD_PID = "99999999";

test("the swap puts the new app in place and keeps the old one as a backup", () => {
  const root = temp();
  const { target, staged, backup } = makeApps(root);
  assert.equal(runSwap([DEAD_PID, target, staged, backup, "/usr/bin/true"]), 0);
  assert.equal(readFileSync(join(target, "Contents", "version.txt"), "utf8"), "new");
  assert.equal(readFileSync(join(backup, "Contents", "version.txt"), "utf8"), "old");
  assert.equal(existsSync(staged), false);
});

test("a failed swap puts the old app back exactly as it was", () => {
  const root = temp();
  const { target, staged, backup } = makeApps(root);
  execFileSync("rm", ["-rf", staged]);
  assert.equal(runSwap([DEAD_PID, target, staged, backup, "/usr/bin/true"]), 1);
  assert.equal(readFileSync(join(target, "Contents", "version.txt"), "utf8"), "old");
  assert.equal(existsSync(backup), false);
});

test("the swap waits for VYXO to quit before touching anything", async () => {
  const root = temp();
  const { target, staged, backup } = makeApps(root);
  const sleeper = spawn("/bin/sleep", ["1.5"]);
  const swap = spawn("/bin/sh", ["-c", SWAP_SCRIPT, "swap", String(sleeper.pid), target, staged, backup, "/usr/bin/true"], { stdio: "ignore" });
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(readFileSync(join(target, "Contents", "version.txt"), "utf8"), "old", "must not swap while VYXO is still running");
  await new Promise((resolve) => swap.on("exit", resolve));
  assert.equal(readFileSync(join(target, "Contents", "version.txt"), "utf8"), "new");
});

test("paths with spaces and quote characters are handled as plain arguments", () => {
  const root = join(temp(), `Apps with "odd" 'names' $HOME`);
  mkdirSync(root, { recursive: true });
  const { target, staged, backup } = makeApps(root);
  assert.equal(runSwap([DEAD_PID, target, staged, backup, "/usr/bin/true"]), 0);
  assert.equal(readFileSync(join(target, "Contents", "version.txt"), "utf8"), "new");
});

test("launchSwap writes a private script and hands paths over as arguments", () => {
  const root = temp();
  const { target, staged } = makeApps(root);
  const calls = [];
  const { scriptPath, backup } = launchSwap({
    bundle: target,
    staging: staged,
    pid: 4242,
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      return { unref() {} };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "/bin/sh");
  assert.deepEqual(calls[0].args.slice(0, 5), [scriptPath, "4242", target, staged, backup]);
  assert.equal(calls[0].options.detached, true);
  assert.equal(readFileSync(scriptPath, "utf8"), SWAP_SCRIPT);
  assert.equal(SWAP_SCRIPT.includes(target), false);
});

test("cleanup removes only update leftovers beside the app", () => {
  const root = temp();
  const bundle = join(root, "VYXO.app");
  mkdirSync(bundle);
  for (const name of [`${BACKUP_PREFIX}123`, `${STAGING_PREFIX}9`, "Other.app", "notes.txt"]) {
    mkdirSync(join(root, name), { recursive: true });
  }
  cleanUpLeftovers(bundle);
  assert.deepEqual(readdirSync(root).sort(), ["Other.app", "VYXO.app", "notes.txt"]);
  assert.doesNotThrow(() => cleanUpLeftovers("/definitely/not/here/VYXO.app"));
});
