/* eslint-disable @typescript-eslint/no-require-imports -- Electron's main entry is CommonJS. */
const path = require("node:path");
const { execFile } = require("node:child_process");
const {
  classifyInstall,
  cleanUpLeftovers,
  installProblemMessage,
  launchSwap,
  prepareUpdate,
} = require("./inplace-update.cjs");

const RELEASES_URL = "https://github.com/chabdullahdev/vyxo/releases/latest";
const FIRST_CHECK_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * macOS only installs an update with its own updater when the running app carries a real
 * developer signature. Builds without one are updated by VYXO's in-place updater instead.
 */
function isDeveloperSigned(codesignOutput) {
  return /^Authority=Developer ID Application:/m.test(codesignOutput);
}

function readCodesignOutput() {
  return new Promise((resolve) => {
    if (process.platform !== "darwin") {
      resolve("");
      return;
    }
    const bundle = path.resolve(process.execPath, "..", "..", "..");
    execFile("codesign", ["-dv", "--verbose=2", bundle], (_error, stdout, stderr) => {
      resolve(`${stdout}\n${stderr}`);
    });
  });
}

/**
 * Check GitHub Releases for a newer version and let the user choose to update.
 * Nothing is downloaded or installed without a click, the installed app is only touched
 * after the new one has been downloaded and checked, and failures never interrupt the app.
 */
function setupAutoUpdate({ app, dialog, shell, getWindow, beforeInstall }) {
  if (!app.isPackaged) return;
  if (process.env.SHIPSTUDIO_DESKTOP_SMOKE === "1" || process.env.VYXO_DISABLE_UPDATES === "1") return;

  // Test-only hooks for the end-to-end update check. They do nothing unless VYXO_E2E=1, and
  // an update feed can then only be a loopback address.
  const e2e = process.env.VYXO_E2E === "1";
  const e2eFeed = e2e ? process.env.VYXO_E2E_UPDATE_FEED : undefined;
  const autoAccept = e2e && process.env.VYXO_E2E_AUTOACCEPT === "1";

  const { autoUpdater } = require("electron-updater");
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = null;
  if (e2eFeed && /^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(e2eFeed)) {
    autoUpdater.setFeedURL({ provider: "generic", url: e2eFeed });
  }

  // "squirrel": standard macOS updater (needs a Developer ID). "inplace": VYXO swaps its own
  // app. "manual": VYXO can't replace itself where it is installed, so explain why.
  let mode = "manual";
  let install = { ok: false, reason: "not-an-app", bundle: "" };
  let promptOpen = false;
  let busy = false;

  const box = (options) => {
    // In the end-to-end check, accept offers but always cancel error dialogs so nothing opens a browser.
    if (autoAccept) return Promise.resolve({ response: options.type === "warning" ? 1 : 0 });
    const window = getWindow();
    return window && !window.isDestroyed()
      ? dialog.showMessageBox(window, options)
      : dialog.showMessageBox(options);
  };

  const openReleases = () => shell.openExternal(RELEASES_URL);

  const setProgress = (fraction) => {
    const window = getWindow();
    if (window && !window.isDestroyed()) window.setProgressBar(fraction);
  };

  async function offerManualDownload(info, detail) {
    const { response } = await box({
      type: "info",
      title: "Update available",
      message: `VYXO ${info.version} is available`,
      detail,
      buttons: ["Download", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) await openReleases();
  }

  async function updateInPlace(info) {
    busy = true;
    try {
      setProgress(0);
      const prepared = await prepareUpdate({
        info,
        currentVersion: app.getVersion(),
        bundle: install.bundle,
        onProgress: setProgress,
        allowLoopback: Boolean(e2eFeed),
        feedBase: e2eFeed || null,
      });
      setProgress(-1);

      const { response } = await box({
        type: "info",
        title: "Ready to install",
        message: `VYXO ${prepared.version} is ready`,
        detail: "VYXO will restart on the new version. Your conversations, projects, and settings are kept.",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
      });
      if (response !== 0) return;

      launchSwap({
        bundle: install.bundle,
        staging: prepared.staging,
        openCommand: e2e ? process.env.VYXO_E2E_OPEN_COMMAND : undefined,
      });
      await beforeInstall?.();
      app.quit();
    } catch {
      setProgress(-1);
      const { response } = await box({
        type: "warning",
        title: "Update could not be installed",
        message: "VYXO couldn't update itself.",
        detail: "Nothing was changed. You can download the latest version instead; your data is untouched.",
        buttons: ["Open download page", "Cancel"],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) await openReleases();
    } finally {
      busy = false;
    }
  }

  async function updateWithSquirrel() {
    busy = true;
    try {
      await autoUpdater.downloadUpdate();
    } catch {
      busy = false;
      await openReleases();
    }
  }

  autoUpdater.on("update-available", async (info) => {
    if (promptOpen || busy) return;
    promptOpen = true;
    try {
      if (mode === "manual") {
        await offerManualDownload(info, `You have ${app.getVersion()}. ${installProblemMessage(install.reason)}`);
        return;
      }
      const { response } = await box({
        type: "info",
        title: "Update available",
        message: `VYXO ${info.version} is available`,
        detail: `You have ${app.getVersion()}. Update now and VYXO will restart on the new version. Your conversations, projects, and settings are kept.`,
        buttons: ["Update now", "Later"],
        defaultId: 0,
        cancelId: 1,
      });
      if (response !== 0) return;
      if (mode === "inplace") await updateInPlace(info);
      else await updateWithSquirrel();
    } finally {
      promptOpen = false;
    }
  });

  autoUpdater.on("update-downloaded", async (info) => {
    // Only the standard macOS updater reaches here.
    busy = false;
    const { response } = await box({
      type: "info",
      title: "Ready to install",
      message: `VYXO ${info.version} is ready`,
      detail: "Restart now to finish updating, or it will be there next time you open VYXO.",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      await beforeInstall?.();
      setImmediate(() => autoUpdater.quitAndInstall());
    } else {
      autoUpdater.autoInstallOnAppQuit = true;
    }
  });

  autoUpdater.on("error", async () => {
    // Offline or rate-limited checks stay silent. A failed standard-updater download offers the manual route.
    if (mode !== "squirrel" || !busy) return;
    busy = false;
    const { response } = await box({
      type: "warning",
      title: "Update could not be installed",
      message: "VYXO couldn't update itself.",
      detail: "You can download the latest version instead. Your data is untouched.",
      buttons: ["Open download page", "Cancel"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) await openReleases();
  });

  const check = () => {
    autoUpdater.checkForUpdates().catch(() => {});
  };

  readCodesignOutput().then((output) => {
    install = classifyInstall(process.execPath);
    if (isDeveloperSigned(output)) mode = "squirrel";
    else mode = install.ok ? "inplace" : "manual";

    // The app has started, so any backup left by a finished update is no longer needed.
    if (install.ok) cleanUpLeftovers(install.bundle);

    const delay = e2e ? 1_000 : FIRST_CHECK_DELAY_MS;
    setTimeout(() => {
      check();
      setInterval(check, CHECK_INTERVAL_MS).unref();
    }, delay).unref();
  });
}

module.exports = { setupAutoUpdate, isDeveloperSigned, RELEASES_URL };
