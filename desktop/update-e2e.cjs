/* eslint-disable @typescript-eslint/no-require-imports -- a Node script run by hand. */
/**
 * End-to-end check of the in-place updater, using real builds.
 *
 *   node desktop/update-e2e.cjs <VYXO.app to install> <feed folder> <new version> [tamper]
 *
 * Each run installs a fresh copy of the app into a throwaway folder. With "tamper" the zip in
 * the feed is corrupted after its checksum was written, and the app must refuse it.
 *
 * The feed folder holds latest-mac.yml and the new version's zip. The script serves it on
 * loopback, starts the installed app with throwaway profile and data folders, lets it find
 * and install the update by itself, then checks the result. It never touches the real
 * /Applications or the real VYXO data.
 */
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const [pristineApp, sourceFeedDir, expectedVersion, scenario = "update"] = process.argv.slice(2);
if (!pristineApp || !sourceFeedDir || !expectedVersion) {
  console.error("usage: node desktop/update-e2e.cjs <VYXO.app> <feed folder> <new version> [tamper]");
  process.exit(2);
}

const tamper = scenario === "tamper";
const work = fs.mkdtempSync(path.join(os.tmpdir(), "vyxo-e2e-install-"));
const appPath = path.join(work, "VYXO.app");
execFileSync("/usr/bin/ditto", [pristineApp, appPath]);

let feedDir = sourceFeedDir;
if (tamper) {
  feedDir = fs.mkdtempSync(path.join(os.tmpdir(), "vyxo-e2e-feed-"));
  for (const name of fs.readdirSync(sourceFeedDir)) {
    fs.copyFileSync(path.join(sourceFeedDir, name), path.join(feedDir, name));
    if (name.endsWith(".zip")) {
      const fd = fs.openSync(path.join(feedDir, name), "r+");
      const middle = Math.floor(fs.fstatSync(fd).size / 2);
      const byte = Buffer.alloc(1);
      fs.readSync(fd, byte, 0, 1, middle);
      byte[0] ^= 0xff;
      fs.writeSync(fd, byte, 0, 1, middle);
      fs.closeSync(fd);
    }
  }
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const plist = (key) =>
  execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, path.join(appPath, "Contents", "Info.plist")], {
    encoding: "utf8",
  }).trim();
const installedFolder = path.dirname(appPath);

async function waitFor(condition, seconds, label) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await sleep(500);
  }
  console.log(`(timed out waiting for ${label})`);
  return false;
}

function launch(env, logFile) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "vyxo-e2e-profile-"));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "vyxo-e2e-data-"));
  const log = fs.openSync(logFile, "a");
  const child = spawn(path.join(appPath, "Contents", "MacOS", "VYXO"), [`--user-data-dir=${profile}`], {
    env: { ...process.env, VYXO_DATA_DIR: data, ...env },
    stdio: ["ignore", log, log],
  });
  return { child, profile, data };
}

(async () => {
  const before = plist("CFBundleShortVersionString");
  console.log(`Installed version: ${before}. Update on offer: ${expectedVersion}\n`);

  const requested = [];
  const server = http.createServer((request, response) => {
    requested.push(request.url);
    const file = path.join(feedDir, path.basename(request.url.split("?")[0]));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-length": fs.statSync(file).size });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const feed = `http://127.0.0.1:${server.address().port}`;

  const logFile = path.join(os.tmpdir(), `vyxo-e2e-${Date.now()}.log`);
  const first = launch(
    {
      VYXO_E2E: "1",
      VYXO_E2E_UPDATE_FEED: feed,
      VYXO_E2E_AUTOACCEPT: "1",
      VYXO_E2E_OPEN_COMMAND: "/usr/bin/true",
    },
    logFile,
  );
  const firstExited = new Promise((resolve) => first.child.on("exit", resolve));

  const zipRequested = () => requested.some((url) => new URL(url, "http://x").pathname.endsWith(".zip"));
  const feedRequested = () => requested.some((url) => new URL(url, "http://x").pathname.endsWith("latest-mac.yml"));

  if (tamper) {
    await waitFor(zipRequested, 120, "the app to try the download");
    await sleep(25_000);
    check("the app found the update and tried to download it", feedRequested() && zipRequested());
    check("the corrupted download was refused: installed version is unchanged", plist("CFBundleShortVersionString") === before);
    const names = fs.readdirSync(installedFolder);
    check("nothing was left behind (no backup, no staging)", !names.some((n) => n.startsWith(".VYXO-")));
    check("the app is still running normally", first.child.exitCode === null);
    let ok = false;
    try {
      execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "ignore" });
      ok = true;
    } catch {
      // reported below
    }
    check("the installed app's signature is still valid", ok);
    first.child.kill("SIGTERM");
  } else {
    const swapped = await waitFor(() => plist("CFBundleShortVersionString") === expectedVersion, 240, "the app to be replaced");
    check("the installed app was replaced by the new version", swapped, `now ${plist("CFBundleShortVersionString")}`);
    check("the old app quit on its own", await Promise.race([firstExited.then(() => true), sleep(20_000).then(() => false)]));
    check("the update was fetched from the feed", feedRequested() && zipRequested());

    const leftovers = fs.readdirSync(installedFolder);
    const backup = leftovers.find((name) => name.startsWith(".VYXO-previous-"));
    check("the old app was kept as a backup", Boolean(backup));
    if (backup) {
      const old = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", path.join(installedFolder, backup, "Contents", "Info.plist")], { encoding: "utf8" }).trim();
      check("the backup is the previous version", old === before, old);
    }
    check("no staging folder was left behind", !leftovers.some((name) => name.startsWith(".VYXO-staging-")));

    let signatureOk = false;
    try {
      execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "ignore" });
      signatureOk = true;
    } catch {
      // reported below
    }
    check("the new app's signature is valid", signatureOk);

    const attributes = execFileSync("/usr/bin/xattr", ["-lr", appPath], { encoding: "utf8" });
    check("the new app carries no download-quarantine flag", !attributes.includes("com.apple.quarantine"));

    // Start the updated app on its own and confirm it runs and tidies up the backup.
    const second = launch({}, logFile);
    const stayedUp = await Promise.race([
      new Promise((resolve) => second.child.on("exit", () => resolve(false))),
      sleep(12_000).then(() => true),
    ]);
    check("the updated app starts and keeps running", stayedUp);
    const tidied = await waitFor(() => !fs.readdirSync(installedFolder).some((name) => name.startsWith(".VYXO-previous-")), 30, "backup cleanup");
    check("the backup is removed once the new app has started", tidied);
    second.child.kill("SIGTERM");
  }

  server.close();
  const passed = results.every(Boolean);
  console.log(`\n${passed ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"}  (log: ${logFile})`);
  process.exit(passed ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
