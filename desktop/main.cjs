/* eslint-disable @typescript-eslint/no-require-imports -- Electron's main entry is CommonJS. */
const { randomBytes } = require("node:crypto");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const { app, BrowserWindow, dialog, session, utilityProcess } = require("electron");

const TOKEN_HEADER = "x-shipstudio-desktop-token";
const IS_PACKAGED = app.isPackaged;
const DEV_PROJECT_ROOT = path.resolve(__dirname, "..");
const execFileAsync = promisify(execFile);

let desktopWindow = null;
let nextServer = null;
let serverOrigin = null;
let serverToken = null;
let serverExitCode = null;
let serverExited = false;
let quitting = false;
let shutdownComplete = false;
let desktopSession = null;

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.quit();

if (singleInstanceLock) {
  app.on("second-instance", () => {
    if (desktopWindow) {
      if (desktopWindow.isMinimized()) desktopWindow.restore();
      desktopWindow.focus();
    }
  });

  app.whenReady().then(startDesktop).catch((error) => {
    console.error("[desktop] startup failed:", error instanceof Error ? error.message : "unknown");
    if (process.env.SHIPSTUDIO_DESKTOP_SMOKE === "1" && error instanceof Error) {
      console.error(error.stack);
    }
    process.exitCode = 1;
    dialog.showErrorBox(
      "VYXO could not start",
      "The local app server did not start. The existing development preview and your memories were not changed.",
    );
    app.quit();
  });
}

function inheritedRuntimeEnvironment() {
  const environment = {};
  for (const key of ["HOME", "PATH", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "USER", "LOGNAME"]) {
    const value = process.env[key];
    if (typeof value === "string") environment[key] = value;
  }
  return environment;
}

function getAvailableLoopbackPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close(() => reject(new Error("Could not allocate a local port.")));
        return;
      }
      probe.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function launchNextServer(port, token, origin) {
  const desktopBuildRoot = path.join(process.resourcesPath, "next-server");
  const serverPath = IS_PACKAGED
    ? path.join(desktopBuildRoot, "server.js")
    : path.join(DEV_PROJECT_ROOT, "node_modules", "next", "dist", "bin", "next");

  if (IS_PACKAGED && !fs.existsSync(serverPath)) {
    throw new Error("The packaged Next.js server files are missing.");
  }

  const environment = {
    ...inheritedRuntimeEnvironment(),
    NODE_ENV: IS_PACKAGED ? "production" : "development",
    SHIPSTUDIO_DESKTOP: "1",
    SHIPSTUDIO_DESKTOP_TOKEN: token,
    SHIPSTUDIO_DESKTOP_ORIGIN: origin,
    OLLAMA_BASE_URL: "http://127.0.0.1:11434",
    NEXT_TELEMETRY_DISABLED: "1",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
  };
  if (process.env.SHIPSTUDIO_DESKTOP_SMOKE === "1") {
    environment.SHIPSTUDIO_DESKTOP_SMOKE = "1";
  }

  const args = IS_PACKAGED
    ? []
    : ["dev", "-H", "127.0.0.1", "-p", String(port)];
  const workingDirectory = IS_PACKAGED ? desktopBuildRoot : DEV_PROJECT_ROOT;

  return utilityProcess.fork(serverPath, args, {
    cwd: workingDirectory,
    env: environment,
    serviceName: "VYXO Next.js server",
    stdio: ["ignore", "ignore", "pipe"],
  });
}

async function waitForServer(origin, timeoutMilliseconds) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMilliseconds) {
    if (serverExited) return false;

    try {
      const response = await fetch(`${origin}/chat`, {
        signal: AbortSignal.timeout(1500),
        cache: "no-store",
      });
      await response.body?.cancel().catch(() => {});
      if (response.ok) return true;
    } catch {
      // The server may still be compiling or starting.
    }

    await delay(250);
  }

  return false;
}

async function stopNextServer(child) {
  if (!child) return;
  const exited = new Promise((resolve) => {
    if (serverExited) resolve(serverExitCode);
    else child.once("exit", resolve);
  });
  const childPid = child.pid;
  child.kill();
  await Promise.race([exited, delay(5000)]);
  if (!serverExited && childPid) {
    try {
      process.kill(childPid, "SIGKILL");
    } catch {
      // The utility process may have exited between the check and signal.
    }
    await Promise.race([exited, delay(2000)]);
  }
}

async function startManagedServer() {
  if (!IS_PACKAGED && process.env.SHIPSTUDIO_DESKTOP_DEV !== "1") {
    throw new Error("Use `npm run desktop:dev` to start the separate desktop dev server.");
  }

  let lastFailure = "The local server did not become ready.";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const port = await getAvailableLoopbackPort();
    const origin = `http://127.0.0.1:${port}`;
    const token = randomBytes(32).toString("base64url");
    serverExitCode = null;
    serverExited = false;

    let child;
    try {
      child = launchNextServer(port, token, origin);
      nextServer = child;
      child.stderr?.on("data", (chunk) => {
        const message = chunk.toString().trim();
        if (message) console.error(`[desktop-server] ${message.slice(0, 4000)}`);
      });
      child.once("exit", (code) => {
        serverExitCode = code;
        serverExited = true;
        if (!quitting && desktopWindow && !desktopWindow.isDestroyed()) {
          console.error(`[desktop] local server exited (code ${code}).`);
          dialog.showErrorBox(
            "VYXO server stopped",
            "The local app server stopped unexpectedly. Quit and reopen the app to try again.",
          );
          app.quit();
        }
      });

      if (await waitForServer(origin, IS_PACKAGED ? 45_000 : 90_000)) {
        serverOrigin = origin;
        serverToken = token;
        console.info(`[desktop] Local server ready at ${origin}`);
        return origin;
      }

      const exitedDuringStartup = serverExited;
      lastFailure = serverExitCode === null
        ? "The local server did not answer the readiness check in time."
        : `The local server exited during startup (code ${serverExitCode}).`;
      await stopNextServer(child);
      nextServer = null;
      if (!exitedDuringStartup) break;
    } catch (error) {
      if (child) await stopNextServer(child);
      nextServer = null;
      lastFailure = error instanceof Error ? error.message : lastFailure;
    }
  }

  throw new Error(lastFailure);
}

function configureAppSession(window, origin, token) {
  const allowedOrigin = new URL(origin).origin;
  // Electron URL filters do not consistently match explicit ports, so filter
  // loopback broadly and verify the exact per-launch origin in the callback.
  const apiFilter = { urls: ["http://127.0.0.1/*"] };
  const webFilter = {
    urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"],
  };

  const isReadOnlyRequestFromApp = (requestingUrl, accessType) => {
    if (accessType !== "readable") return false;
    try {
      return new URL(requestingUrl).origin === allowedOrigin;
    } catch {
      return false;
    }
  };

  desktopSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) => {
      // Electron documents that isMainFrame can be false for File System Access checks.
      // The permission is bound to this session and the exact app origin instead.
      const allowed = permission === "fileSystem" && isReadOnlyRequestFromApp(
        details.requestingUrl ?? requestingOrigin,
        details.fileAccessType,
      );
      if (permission === "fileSystem") {
        let urlOrigin = "invalid";
        try {
          urlOrigin = new URL(details.requestingUrl ?? requestingOrigin).origin;
        } catch {
          // Keep diagnostics free of untrusted URL text.
        }
        console.info(`[desktop] fileSystem permission check: owner=${window.webContents.id}, requester=${webContents?.id ?? "none"}, origin=${urlOrigin}, access=${details.fileAccessType ?? "unset"}, mainFrame=${details.isMainFrame}, allowed=${allowed}`);
      }
      return allowed;
    },
  );
  desktopSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const allowed =
        permission === "fileSystem" &&
        webContents.id === window.webContents.id &&
        isReadOnlyRequestFromApp(details.requestingUrl, details.fileAccessType);
      if (permission === "fileSystem") {
        console.info(`[desktop] fileSystem permission request: access=${details.fileAccessType ?? "unset"}, allowed=${allowed}`);
      }
      callback(allowed);
    },
  );

  desktopSession.webRequest.onBeforeSendHeaders(apiFilter, (details, callback) => {
    const requestHeaders = { ...details.requestHeaders };
    try {
      const requestUrl = new URL(details.url);
      if (
        details.webContentsId === window.webContents.id &&
        requestUrl.origin === allowedOrigin
      ) {
        requestHeaders[TOKEN_HEADER] = token;
        console.info("[desktop] Attached the private API header to a same-window loopback API request.");
      } else if (requestUrl.pathname.startsWith("/api/")) {
        console.warn(`[desktop] Did not attach API authorization: windowMatch=${details.webContentsId === window.webContents.id}, originMatch=${requestUrl.origin === allowedOrigin}`);
      }
    } catch {
      // Do not attach credentials to malformed or unexpected URLs.
    }
    callback({ requestHeaders });
  });

  desktopSession.webRequest.onBeforeRequest(webFilter, (details, callback) => {
    if (details.webContentsId !== window.webContents.id) {
      callback({});
      return;
    }

    let requestOrigin = "";
    try {
      const requestUrl = new URL(details.url);
      if (requestUrl.protocol === "ws:") requestUrl.protocol = "http:";
      else if (requestUrl.protocol === "wss:") requestUrl.protocol = "https:";
      requestOrigin = requestUrl.origin;
    } catch {
      callback({ cancel: true });
      return;
    }
    const cancel = requestOrigin !== allowedOrigin;
    if (details.resourceType === "mainFrame" || cancel) {
      console.info(`[desktop] renderer navigation request: type=${details.resourceType}, origin=${requestOrigin || "invalid"}, allowed=${!cancel}`);
    }
    callback(cancel ? { cancel: true } : {});
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    try {
      const allowed = new URL(targetUrl).origin === allowedOrigin;
      console.info(`[desktop] will-navigate: origin=${new URL(targetUrl).origin}, allowed=${allowed}`);
      if (!allowed) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  window.webContents.on("will-redirect", (event, targetUrl) => {
    try {
      if (new URL(targetUrl).origin !== allowedOrigin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
}

async function createWindow(origin) {
  desktopSession = session.fromPartition(`shipstudio-${randomBytes(12).toString("hex")}`);
  desktopWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 760,
    minHeight: 600,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      session: desktopSession,
    },
  });

  if (serverToken) configureAppSession(desktopWindow, origin, serverToken);
  desktopWindow.once("ready-to-show", () => desktopWindow?.show());
  desktopWindow.webContents.on("console-message", (details) => {
    console.info(`[desktop:renderer:${details.level}] ${details.message}`);
  });
  desktopWindow.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    console.error(`[desktop] renderer load failed: code=${code}, mainFrame=${isMainFrame}, url=${url}, error=${description}`);
  });
  desktopWindow.webContents.on("did-fail-provisional-load", (_event, code, description, url, isMainFrame) => {
    console.error(`[desktop] provisional renderer load failed: code=${code}, mainFrame=${isMainFrame}, url=${url}, error=${description}`);
  });
  desktopWindow.webContents.on("did-start-navigation", (_event, url, isInPlace, isMainFrame) => {
    if (isMainFrame) console.info(`[desktop] main-frame navigation started: ${url}`);
  });
  desktopWindow.webContents.on("did-navigate", (_event, url) => {
    console.info(`[desktop] main-frame navigation completed: ${new URL(url).origin}`);
  });
  desktopWindow.on("closed", () => {
    desktopWindow = null;
  });

  console.info(`[desktop] Loading chat window from ${origin}/chat`);
  try {
    await desktopWindow.loadURL(`${origin}/chat`);
  } catch (error) {
    let responseStatus = "unavailable";
    try {
      const response = await fetch(`${origin}/chat`, {
        signal: AbortSignal.timeout(3000),
        cache: "no-store",
      });
      responseStatus = String(response.status);
      await response.body?.cancel().catch(() => {});
    } catch {
      // Do not include response data or request details in logs.
    }
    console.error(`[desktop] BrowserWindow load failed; local server status=${responseStatus}; ${error instanceof Error ? error.message : "unknown load error"}`);
    throw error;
  }
  console.info("[desktop] Chat document loaded.");
  const browserCapabilities = await desktopWindow.webContents.executeJavaScript(
    "({ secure: window.isSecureContext, directoryPicker: typeof window.showDirectoryPicker })",
  );
  console.info(
    `[desktop] folder picker capability: ${browserCapabilities.directoryPicker}; secure context: ${browserCapabilities.secure}`,
  );
}

async function runFolderPickerSmoke() {
  console.info("[desktop] Starting read-only project-folder picker smoke test.");
  const fixturePath = process.env.SHIPSTUDIO_PICKER_FIXTURE_PATH;
  const temporaryRoot = path.resolve(os.tmpdir());
  if (
    !fixturePath ||
    !path.resolve(fixturePath).startsWith(`${temporaryRoot}${path.sep}`)
  ) {
    throw new Error("The picker smoke test requires a disposable folder under the system temp directory.");
  }

  const pickerWindow = desktopWindow;
  if (!pickerWindow) throw new Error("The desktop window was not created.");

  const visibleDeadline = Date.now() + 10_000;
  while (!pickerWindow.isVisible() && Date.now() < visibleDeadline) {
    await delay(100);
  }
  if (!pickerWindow.isVisible()) throw new Error("The desktop window did not become visible.");

  await pickerWindow.webContents.executeJavaScript(`(() => {
    const original = window.showDirectoryPicker.bind(window);
    window.__desktopPickerProbe = { attempts: [] };
    window.showDirectoryPicker = (options) => {
      const attempt = {
        mode: options?.mode,
        userActivation: navigator.userActivation?.isActive ?? null,
        status: 'pending'
      };
      window.__desktopPickerProbe.attempts.push(attempt);
      return original(options).then((handle) => {
        attempt.status = 'resolved';
        attempt.directoryName = handle.name;
        return handle;
      }).catch((error) => {
        attempt.status = 'rejected';
        attempt.errorName = error?.name ?? 'Error';
        attempt.errorMessage = error?.message ?? 'Unknown picker error';
        throw error;
      });
    };
  })()`);

  const chooseButton = await pickerWindow.webContents.executeJavaScript(`(() => {
    const button = Array.from(document.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('Choose project folder')
    );
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  if (!chooseButton) throw new Error("The existing project folder button was not found.");

  pickerWindow.focus();
  pickerWindow.webContents.sendInputEvent({
    type: "mouseDown",
    x: chooseButton.x,
    y: chooseButton.y,
    button: "left",
    clickCount: 1,
  });
  pickerWindow.webContents.sendInputEvent({
    type: "mouseUp",
    x: chooseButton.x,
    y: chooseButton.y,
    button: "left",
    clickCount: 1,
  });

  // Allow the native macOS picker panel to become the active window first.
  await delay(1500);
  const escapedPath = fixturePath.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  const appleScript = `tell application "System Events"
    tell (first process whose unix id is ${process.pid})
      set frontmost to true
      keystroke "g" using {command down, shift down}
      delay 0.5
      keystroke "${escapedPath}"
      key code 36
      delay 1
      key code 36
    end tell
  end tell`;
  await execFileAsync("/usr/bin/osascript", ["-e", appleScript], { timeout: 15_000 });

  const expectedFolder = path.basename(fixturePath);
  const selectionDeadline = Date.now() + 20_000;
  let status = null;
  while (Date.now() < selectionDeadline) {
    status = await pickerWindow.webContents.executeJavaScript(`({
      folderShown: document.body.innerText.includes(${JSON.stringify(expectedFolder)}),
      sourceFolderShown: Array.from(document.querySelectorAll('button')).some((item) =>
        Array.from(item.querySelectorAll('span')).some((span) => span.textContent?.trim() === 'src')
      ),
      attempts: window.__desktopPickerProbe?.attempts ?? [],
      uiError: document.querySelector('[role="alert"]')?.textContent ?? null
    })`);
    if (status.folderShown && status.sourceFolderShown) break;
    await delay(200);
  }

  if (!status?.folderShown || !status.sourceFolderShown) {
    throw new Error(`The project picker did not return the test folder. State: ${JSON.stringify(status)}`);
  }
  if (status.attempts.at(-1)?.mode !== "read" || status.attempts.at(-1)?.status !== "resolved") {
    throw new Error(`The folder handle was not resolved in read-only mode. State: ${JSON.stringify(status.attempts)}`);
  }

  await pickerWindow.webContents.executeJavaScript(`(() => {
    const source = Array.from(document.querySelectorAll('button')).find((item) =>
      Array.from(item.querySelectorAll('span')).some((span) => span.textContent?.trim() === 'src')
    );
    source?.click();
  })()`);
  const fileDeadline = Date.now() + 10_000;
  let sampleCheckboxShown = false;
  while (Date.now() < fileDeadline) {
    sampleCheckboxShown = await pickerWindow.webContents.executeJavaScript(
      `Boolean(document.querySelector('input[aria-label*="src/sample.ts"]'))`,
    );
    if (sampleCheckboxShown) break;
    await delay(200);
  }
  if (!sampleCheckboxShown) throw new Error("The selected folder did not list src/sample.ts.");

  await pickerWindow.webContents.executeJavaScript(`(() => {
    document.querySelector('input[aria-label*="src/sample.ts"]')?.click();
  })()`);
  const selected = await pickerWindow.webContents.executeJavaScript(
    `document.body.innerText.includes('In context')`,
  );
  if (!selected) throw new Error("The synthetic source file could not be selected as chat context.");
  console.info("[desktop] Picker smoke passed: read-only handle resolved and src/sample.ts was displayed and selected.");
}

async function startDesktop() {
  if (IS_PACKAGED || process.env.SHIPSTUDIO_DESKTOP_DEV === "1") {
    const origin = await startManagedServer();
    await createWindow(origin);
    if (process.env.SHIPSTUDIO_DESKTOP_PICKER_SMOKE === "1") {
      await runFolderPickerSmoke();
      if (process.env.SHIPSTUDIO_DESKTOP_SMOKE !== "1") app.quit();
    }
    return;
  }

  throw new Error("Use `npm run desktop:dev` to start the desktop preview.");
}

async function shutdown() {
  if (shutdownComplete) return;
  shutdownComplete = true;
  quitting = true;
  await stopNextServer(nextServer);
  nextServer = null;
}

app.on("before-quit", (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  shutdown().finally(() => app.quit());
});

process.on("SIGTERM", () => app.quit());
process.on("SIGINT", () => app.quit());

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (!desktopWindow && serverOrigin) {
    createWindow(serverOrigin).catch((error) => {
      console.error("[desktop] window could not be reopened:", error instanceof Error ? error.message : "unknown");
      app.quit();
    });
  }
});
