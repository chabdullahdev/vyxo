/* eslint-disable @typescript-eslint/no-require-imports -- Node-only Electron test launcher. */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const electronPath = require("electron");
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), "shipstudio-picker-e2e-home-"));
const fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), "shipstudio-picker-e2e-project-"));
const sourceDirectory = path.join(fixturePath, "src");

fs.mkdirSync(sourceDirectory);
fs.writeFileSync(
  path.join(sourceDirectory, "sample.ts"),
  "export const desktopPickerFixture = true;\n",
  { mode: 0o600 },
);

const child = spawn(electronPath, [projectRoot], {
  cwd: projectRoot,
  env: {
    ...process.env,
    HOME: testHome,
    SHIPSTUDIO_DESKTOP_DEV: "1",
    SHIPSTUDIO_DESKTOP_PICKER_SMOKE: "1",
    SHIPSTUDIO_PICKER_FIXTURE_PATH: fixturePath,
  },
  stdio: "inherit",
});

let timedOut = false;
const timeout = setTimeout(() => {
  timedOut = true;
  child.kill("SIGTERM");
}, 120_000);

child.once("error", (error) => {
  console.error(`[picker-e2e] Could not launch Electron: ${error.message}`);
});

child.once("exit", (code, signal) => {
  clearTimeout(timeout);
  fs.rmSync(fixturePath, { recursive: true, force: true });
  fs.rmSync(testHome, { recursive: true, force: true });

  if (timedOut) {
    console.error("[picker-e2e] FAIL: Electron did not finish the picker check within 120 seconds.");
    process.exitCode = 1;
  } else if (code !== 0) {
    console.error(`[picker-e2e] FAIL: Electron exited with code ${code ?? "none"} (${signal ?? "no signal"}).`);
    process.exitCode = 1;
  }
});
