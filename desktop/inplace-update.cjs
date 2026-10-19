/* eslint-disable @typescript-eslint/no-require-imports -- Electron's main entry is CommonJS. */
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { promisify } = require("node:util");

const run = promisify(execFile);

/**
 * In-place updates for builds without a paid Apple certificate.
 *
 * macOS's built-in updater refuses to install an update into an app that is not
 * signed with a Developer ID. This replaces the app bundle itself instead:
 * download the release zip, check it, unpack it next to the installed app, and
 * swap the two once VYXO has quit. Files saved by this process carry no
 * "downloaded from the internet" flag, so the updated app opens without the
 * first-launch warning. Every step checks before it acts, and a failure at any
 * point leaves the installed app exactly as it was.
 */

const BUNDLE_ID = "com.vyxo.app";
const MAX_ZIP_BYTES = 800 * 1024 * 1024;
const RELEASE_BASE = "https://github.com/chabdullahdev/vyxo/releases/download";
const BACKUP_PREFIX = ".VYXO-previous-";
const STAGING_PREFIX = ".VYXO-staging-";
const ZIP_NAME = /^VYXO-\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?-(arm64|x64)\.zip$/;

/** Compare "1.2.3" style versions. Returns 1, 0, or -1. A release outranks its own prerelease. */
function compareVersions(a, b) {
  const parse = (value) => {
    const [core, pre = ""] = String(value).trim().replace(/^v/, "").split("-", 2);
    const nums = core.split(".").map((part) => Number.parseInt(part, 10));
    return { nums: [nums[0] || 0, nums[1] || 0, nums[2] || 0], pre };
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i += 1) {
    if (left.nums[i] !== right.nums[i]) return left.nums[i] > right.nums[i] ? 1 : -1;
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === "") return 1;
  if (right.pre === "") return -1;
  return left.pre > right.pre ? 1 : -1;
}

/** Choose this machine's zip from an update feed. Only plain release file names are accepted. */
function pickZipFile(info, arch = process.arch) {
  if (!info || typeof info !== "object" || !Array.isArray(info.files)) return null;
  for (const file of info.files) {
    if (!file || typeof file.url !== "string" || typeof file.sha512 !== "string") continue;
    const match = ZIP_NAME.exec(file.url);
    if (!match || match[1] !== arch) continue;
    if (typeof file.size === "number" && (file.size <= 0 || file.size > MAX_ZIP_BYTES)) continue;
    return { name: file.url, sha512: file.sha512, size: typeof file.size === "number" ? file.size : null };
  }
  return null;
}

/** Only this project's own release files, served by GitHub, may be downloaded. */
function isTrustedDownloadUrl(rawUrl, { allowLoopback = false } = {}) {
  try {
    const url = new URL(rawUrl);
    if (allowLoopback && url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost")) {
      return true;
    }
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    return host === "github.com" || host.endsWith(".githubusercontent.com");
  } catch {
    return false;
  }
}

function releaseUrl(version, name) {
  return `${RELEASE_BASE}/v${version}/${name}`;
}

/**
 * Work out whether the running app can replace itself. The answer is a reason,
 * not a guess, so the dialog can tell the user what to do.
 */
function classifyInstall(execPath, { canWrite = (target) => isWritable(target) } = {}) {
  const bundle = path.resolve(execPath, "..", "..", "..");
  if (!bundle.endsWith(".app")) return { ok: false, reason: "not-an-app", bundle };
  if (bundle.includes("/AppTranslocation/")) return { ok: false, reason: "translocated", bundle };
  if (bundle.startsWith("/Volumes/")) return { ok: false, reason: "disk-image", bundle };
  if (!canWrite(path.dirname(bundle)) || !canWrite(bundle)) return { ok: false, reason: "read-only", bundle };
  return { ok: true, bundle };
}

function isWritable(target) {
  try {
    fs.accessSync(target, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function installProblemMessage(reason) {
  switch (reason) {
    case "translocated":
    case "disk-image":
      return "VYXO is running from a temporary location. Drag it into your Applications folder, open it from there, and try again.";
    case "read-only":
      return "VYXO is installed somewhere you can't change. Move it to your Applications folder and try again.";
    default:
      return "VYXO can't update itself from here.";
  }
}

/** Download a file, checking the host, the size, and the SHA-512 before anything is kept. */
async function downloadVerified({ url, destination, sha512, size, onProgress, fetchImpl = fetch, allowLoopback = false }) {
  if (!isTrustedDownloadUrl(url, { allowLoopback })) throw new Error("The download address is not trusted.");
  const response = await fetchImpl(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`The download failed (status ${response.status}).`);
  if (response.url && !isTrustedDownloadUrl(response.url, { allowLoopback })) {
    throw new Error("The download was redirected somewhere untrusted.");
  }
  const declared = Number(response.headers.get("content-length"));
  const limit = size ?? MAX_ZIP_BYTES;
  if (Number.isFinite(declared) && declared > 0 && declared > Math.min(limit, MAX_ZIP_BYTES)) {
    throw new Error("The download is larger than expected.");
  }

  const hash = crypto.createHash("sha512");
  let received = 0;
  let lastReport = 0;
  const source = Readable.fromWeb(response.body);
  source.on("data", (chunk) => {
    received += chunk.length;
    if (received > Math.min(limit, MAX_ZIP_BYTES)) source.destroy(new Error("The download is larger than expected."));
    hash.update(chunk);
    const now = Date.now();
    if (onProgress && now - lastReport > 250) {
      lastReport = now;
      onProgress(size ? Math.min(received / size, 1) : 0);
    }
  });

  try {
    await pipeline(source, fs.createWriteStream(destination, { mode: 0o600 }));
  } catch (error) {
    fs.rmSync(destination, { force: true });
    throw error;
  }
  if (size && received !== size) {
    fs.rmSync(destination, { force: true });
    throw new Error("The download is incomplete.");
  }
  if (hash.digest("base64") !== sha512) {
    fs.rmSync(destination, { force: true });
    throw new Error("The download does not match its checksum.");
  }
  onProgress?.(1);
}

async function plistValue(appPath, key) {
  const { stdout } = await run("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, path.join(appPath, "Contents", "Info.plist")]);
  return stdout.trim();
}

/** The unpacked app must be what we expect before it is allowed anywhere near the installed one. */
async function verifyNewBundle(appPath, { expectedVersion, currentVersion, arch = process.arch }) {
  const id = await plistValue(appPath, "CFBundleIdentifier");
  if (id !== BUNDLE_ID) throw new Error("The update is not a VYXO app.");
  const version = await plistValue(appPath, "CFBundleShortVersionString");
  if (version !== expectedVersion) throw new Error("The update has an unexpected version.");
  if (compareVersions(version, currentVersion) <= 0) throw new Error("The update is not newer than this version.");

  const executable = await plistValue(appPath, "CFBundleExecutable");
  const { stdout } = await run("/usr/bin/lipo", ["-archs", path.join(appPath, "Contents", "MacOS", executable)]);
  if (!stdout.trim().split(/\s+/).includes(arch)) throw new Error("The update is for a different processor.");

  await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath]);
}

/**
 * Runs after VYXO has quit. Swaps the apps with plain renames (the staging folder sits
 * beside the installed app, so each move is atomic), keeps the old app as a hidden
 * backup, and puts it back if the swap fails. Paths arrive as arguments, never as script text.
 */
const SWAP_SCRIPT = `#!/bin/sh
PID="$1"; TARGET="$2"; STAGED="$3"; BACKUP="$4"; OPEN="\${5:-/usr/bin/open}"
i=0
while kill -0 "$PID" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 120 ]; then exit 1; fi
  sleep 0.5
done
if mv "$TARGET" "$BACKUP" && mv "$STAGED" "$TARGET"; then
  /usr/bin/xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
  "$OPEN" "$TARGET"
else
  if [ ! -e "$TARGET" ] && [ -e "$BACKUP" ]; then mv "$BACKUP" "$TARGET"; fi
  rm -rf "$STAGED"
  "$OPEN" "$TARGET"
  exit 1
fi
`;

/** Remove leftovers from a finished or abandoned update. Called once the app has started. */
function cleanUpLeftovers(bundle) {
  const folder = path.dirname(bundle);
  try {
    for (const entry of fs.readdirSync(folder)) {
      if (entry.startsWith(BACKUP_PREFIX) || entry.startsWith(STAGING_PREFIX)) {
        fs.rmSync(path.join(folder, entry), { recursive: true, force: true });
      }
    }
  } catch {
    // Nothing to clean, or not allowed to look. Either is fine.
  }
}

/**
 * Download, check, and stage an update. Returns what the swap needs. Nothing about the
 * installed app changes here; the installed app is only touched by `launchSwap`.
 */
async function prepareUpdate({ info, currentVersion, bundle, onProgress, allowLoopback = false, feedBase = null }) {
  const file = pickZipFile(info);
  if (!file) throw new Error("No download for this Mac was found in the update.");

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "vyxo-update-"));
  const zipPath = path.join(workDir, file.name);
  const url = feedBase ? `${feedBase.replace(/\/$/, "")}/${file.name}` : releaseUrl(info.version, file.name);
  const staging = path.join(path.dirname(bundle), `${STAGING_PREFIX}${process.pid}`);

  try {
    await downloadVerified({ url, destination: zipPath, sha512: file.sha512, size: file.size, onProgress, allowLoopback });

    const unpacked = path.join(workDir, "unpacked");
    fs.mkdirSync(unpacked);
    await run("/usr/bin/ditto", ["-x", "-k", zipPath, unpacked]);
    const appName = fs.readdirSync(unpacked).find((name) => name.endsWith(".app"));
    if (!appName) throw new Error("The update did not contain an app.");
    const unpackedApp = path.join(unpacked, appName);

    await verifyNewBundle(unpackedApp, { expectedVersion: info.version, currentVersion });

    // Copy beside the installed app so the final swap is a rename, not a copy.
    fs.rmSync(staging, { recursive: true, force: true });
    await run("/usr/bin/ditto", [unpackedApp, staging]);
    await verifyNewBundle(staging, { expectedVersion: info.version, currentVersion });
    return { staging, version: info.version };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/** Start the swap in a separate process that outlives VYXO, then let the caller quit the app. */
function launchSwap({ bundle, staging, pid = process.pid, spawnImpl = require("node:child_process").spawn, openCommand }) {
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "vyxo-swap-"));
  const scriptPath = path.join(scriptDir, "swap.sh");
  fs.writeFileSync(scriptPath, SWAP_SCRIPT, { mode: 0o700 });
  const backup = path.join(path.dirname(bundle), `${BACKUP_PREFIX}${Date.now()}`);
  const args = [scriptPath, String(pid), bundle, staging, backup];
  if (openCommand) args.push(openCommand);
  const child = spawnImpl("/bin/sh", args, { detached: true, stdio: "ignore" });
  child.unref();
  return { backup, scriptPath };
}

module.exports = {
  BUNDLE_ID,
  BACKUP_PREFIX,
  STAGING_PREFIX,
  SWAP_SCRIPT,
  classifyInstall,
  cleanUpLeftovers,
  compareVersions,
  downloadVerified,
  installProblemMessage,
  isTrustedDownloadUrl,
  launchSwap,
  pickZipFile,
  prepareUpdate,
  releaseUrl,
  verifyNewBundle,
};
