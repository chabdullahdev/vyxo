/* eslint-disable @typescript-eslint/no-require-imports -- Electron's main entry is CommonJS. */
const path = require("node:path");
const { execFile } = require("node:child_process");

const RELEASES_URL = "https://github.com/chabdullahdev/ai/releases/latest";
const FIRST_CHECK_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * macOS only installs an update in place when the running app carries a real
 * developer signature. Ad-hoc or unsigned builds can still be updated by
 * downloading the new version, so they are handled separately.
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
 * Nothing is downloaded or installed without a click, and failures never
 * interrupt the app.
 */
function setupAutoUpdate({ app, dialog, shell, getWindow, beforeInstall }) {
  if (!app.isPackaged) return;
  if (process.env.SHIPSTUDIO_DESKTOP_SMOKE === "1" || process.env.VYXO_DISABLE_UPDATES === "1") return;

  const { autoUpdater } = require("electron-updater");
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = null;

  let canInstallInPlace = false;
  let promptOpen = false;
  let downloading = false;

  const box = (options) => {
    const window = getWindow();
    return window && !window.isDestroyed()
      ? dialog.showMessageBox(window, options)
      : dialog.showMessageBox(options);
  };

  const openReleases = () => shell.openExternal(RELEASES_URL);

  autoUpdater.on("update-available", async (info) => {
    if (promptOpen || downloading) return;
    promptOpen = true;
    try {
      const inPlace = canInstallInPlace;
      const { response } = await box({
        type: "info",
        title: "Update available",
        message: `VYXO ${info.version} is available`,
        detail: inPlace
          ? `You have ${app.getVersion()}. Update now and VYXO will restart on the new version. Your conversations and settings are kept.`
          : `You have ${app.getVersion()}. Download the new version and replace the app. Your conversations and settings are kept.`,
        buttons: [inPlace ? "Update now" : "Download", "Later"],
        defaultId: 0,
        cancelId: 1,
      });
      if (response !== 0) return;
      if (inPlace) {
        downloading = true;
        await autoUpdater.downloadUpdate();
      } else {
        await openReleases();
      }
    } catch {
      downloading = false;
      await openReleases();
    } finally {
      promptOpen = false;
    }
  });

  autoUpdater.on("update-downloaded", async (info) => {
    downloading = false;
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
    // Offline or rate-limited checks are silent; a failed download offers the manual route.
    if (!downloading) return;
    downloading = false;
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
    canInstallInPlace = isDeveloperSigned(output);
    setTimeout(() => {
      check();
      setInterval(check, CHECK_INTERVAL_MS).unref();
    }, FIRST_CHECK_DELAY_MS).unref();
  });
}

module.exports = { setupAutoUpdate, isDeveloperSigned, RELEASES_URL };
