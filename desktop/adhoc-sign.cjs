/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder hooks are CommonJS. */
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { isDeveloperSigned } = require("./updater.cjs");

const run = promisify(execFile);

/**
 * Apple Silicon refuses to run an app whose signature does not match its
 * contents ("the app is damaged"). Electron's stock signature stops matching
 * once the app is renamed and rebranded, so without a paid certificate we
 * re-sign it ad hoc, which is free. An ad-hoc signature does not identify a
 * developer, so macOS still asks the user to approve the first launch.
 *
 * If a real Developer ID signature is present (CSC_LINK was provided), leave it alone.
 */
module.exports = async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const inspect = await run("codesign", ["-dv", "--verbose=2", appPath]).catch((error) => ({
    stdout: error.stdout ?? "",
    stderr: error.stderr ?? "",
  }));
  if (isDeveloperSigned(`${inspect.stdout}\n${inspect.stderr}`)) {
    console.log("  • adhoc-sign: Developer ID signature found, leaving it as is");
    return;
  }

  console.log("  • adhoc-sign: no Developer ID signature, signing ad hoc");
  await run("codesign", ["--force", "--deep", "--sign", "-", appPath]);
  await run("codesign", ["--verify", "--deep", "--strict", appPath]);
  console.log("  • adhoc-sign: signature verified");
};
