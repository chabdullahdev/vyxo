/* eslint-disable @typescript-eslint/no-require-imports -- Node-only unpacked-app smoke test. */
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const projectRoot = path.resolve(__dirname, "..");
// The picker step types into the native folder panel with AppleScript, which only exists on macOS.
const pickerAutomated = process.platform === "darwin";
const appExecutable =
  process.env.SHIPSTUDIO_SMOKE_APP_EXECUTABLE ??
  (process.platform === "win32"
    ? path.join(projectRoot, "release", "win-unpacked", "VYXO.exe")
    : path.join(projectRoot, "release", "mac-arm64", "VYXO.app", "Contents", "MacOS", "VYXO"));

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not reserve a test port.")));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function createCdpClient(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 0;

  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }

    for (const listener of listeners.get(message.method) ?? []) {
      listener(message.params);
    }
  });

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("Could not connect to the test window.")), { once: true });
  });

  return {
    ready,
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, listener) {
      const current = listeners.get(method) ?? [];
      current.push(listener);
      listeners.set(method, current);
    },
    close() {
      socket.close();
    },
  };
}

async function evaluate(cdp, expression) {
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text ?? "Renderer evaluation failed.");
  }
  return response.result?.value;
}

async function waitForPage(debugPort, child, logs) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Unpacked app exited during startup (${child.exitCode}). ${logs()}`);
    }
    try {
      const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
      const page = targets.find((target) => target.type === "page" && target.url.endsWith("/chat"));
      if (page) return page;
    } catch {
      // The BrowserWindow may still be starting.
    }
    await wait(250);
  }
  throw new Error(`Timed out waiting for the unpacked app window. ${logs()}`);
}

async function waitFor(cdp, expression, description, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(cdp, expression);
    if (value) return value;
    await wait(250);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function waitForCondition(condition, description, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function clickButton(cdp, label) {
  const point = await evaluate(cdp, `(() => {
    const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.trim() === ${JSON.stringify(label)});
    if (!button || button.disabled) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  assert.ok(point, `The ${label} button should be visible and enabled.`);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
}

async function setChatInput(cdp, text) {
  const state = await evaluate(cdp, `(() => {
    const textarea = document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(textarea, ${JSON.stringify(text)});
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(text)} }));
    textarea.focus();
    const send = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Send');
    return { value: textarea.value, sendDisabled: send?.disabled ?? true };
  })()`);
  if (state.value !== text || state.sendDisabled) {
    throw new Error(`The chat input did not become sendable in the packaged renderer: ${JSON.stringify(state)}`);
  }
}

async function submitChat(cdp, text) {
  await setChatInput(cdp, text);
  const expected = text.slice(0, 24);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await clickButton(cdp, "Send");
    const accepted = await waitForCondition(
      async () =>
        evaluate(
          cdp,
          `document.querySelector('textarea')?.value === '' || document.body.innerText.includes(${JSON.stringify(expected)})`,
        ),
      "the chat to accept the submitted message",
      4000,
    ).then(
      () => true,
      () => false,
    );
    if (accepted) return;
    if (attempt < 3) console.info(`[unpacked-smoke] Send attempt ${attempt} did not register; retrying.`);
  }
  throw new Error("The chat send action did not register after multiple attempts.");
}

async function waitForAssistantAnswer(cdp) {
  const deadline = Date.now() + 120_000;
  let lastState = null;
  while (Date.now() < deadline) {
    lastState = await evaluate(cdp, `(() => {
      const answers = Array.from(document.querySelectorAll('[data-message-role="assistant"]'));
      const last = answers.at(-1)?.textContent?.trim() ?? '';
      const alerts = Array.from(document.querySelectorAll('div')).filter((element) =>
        typeof element.className === 'string' &&
        element.className.includes('bg-[var(--accent)]/10')
      ).map((element) => element.textContent?.trim() ?? '').filter(Boolean);
      const idle = Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.trim() === 'Send');
      return {
        last,
        idle,
        alerts,
        inputValue: document.querySelector('textarea')?.value ?? '',
        bodyTail: document.body.innerText.slice(-500)
      };
    })()`);
    if (lastState.alerts.length > 0) throw new Error(`Chat UI returned an error: ${lastState.alerts.join(' ')}`);
    if (lastState.last.length > 0 && lastState.last !== 'Thinking…' && lastState.idle) return lastState.last;
    await wait(250);
  }
  throw new Error(`Timed out waiting for a streamed assistant answer. UI state: ${JSON.stringify(lastState)}`);
}

async function runMemoryCrud(cdp) {
  return evaluate(cdp, `(async () => {
    const list = await fetch('/api/memories');
    if (!list.ok) throw new Error('memory list failed: ' + list.status);
    const initial = await list.json();
    if (initial.memories.length !== 0) throw new Error('temporary memory home was not empty');

    const createdResponse = await fetch('/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Synthetic unpacked app memory check.' })
    });
    if (!createdResponse.ok) throw new Error('memory create failed: ' + createdResponse.status);
    const created = (await createdResponse.json()).memory;

    const updatedResponse = await fetch('/api/memories/' + encodeURIComponent(created.id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Synthetic unpacked app memory updated.' })
    });
    if (!updatedResponse.ok) throw new Error('memory update failed: ' + updatedResponse.status);

    const fetchedResponse = await fetch('/api/memories/' + encodeURIComponent(created.id));
    const fetched = (await fetchedResponse.json()).memory;
    if (!fetchedResponse.ok || fetched.content !== 'Synthetic unpacked app memory updated.') {
      throw new Error('memory read returned the wrong test record');
    }

    const deletedResponse = await fetch('/api/memories/' + encodeURIComponent(created.id), { method: 'DELETE' });
    if (!deletedResponse.ok) throw new Error('memory delete failed: ' + deletedResponse.status);
    const finalList = await fetch('/api/memories').then((response) => response.json());
    if (finalList.memories.length !== 0) throw new Error('test memory remained after deletion');
    return 'GET/POST/PATCH/GET/DELETE passed using the temporary HOME';
  })()`);
}

async function main() {
  assert.ok(fs.existsSync(appExecutable), `Unpacked app not found at ${appExecutable}; build it first.`);
  const testHome = fs.mkdtempSync(path.join(os.tmpdir(), "shipstudio-unpacked-smoke-home-"));
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shipstudio-unpacked-smoke-project-"));
  const sourceDirectory = path.join(fixtureRoot, "src");
  fs.mkdirSync(sourceDirectory);
  fs.writeFileSync(
    path.join(sourceDirectory, "sample.ts"),
    "export const desktopPickerFixture = 2 + 1;\n",
    { mode: 0o600 },
  );

  const debugPort = await reservePort();
  const child = spawn(
    appExecutable,
    [
      // Own profile folder, so the check works even while the real VYXO is open (it holds the single-instance lock).
      `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "shipstudio-unpacked-smoke-profile-"))}`,
      `--remote-debugging-port=${debugPort}`,
      "--remote-debugging-address=127.0.0.1",
      `--remote-allow-origins=http://127.0.0.1:${debugPort}`,
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        HOME: testHome,
        // Windows finds the home and data folders through these instead of HOME.
        USERPROFILE: testHome,
        APPDATA: path.join(testHome, "AppData", "Roaming"),
        LOCALAPPDATA: path.join(testHome, "AppData", "Local"),
        VYXO_DATA_DIR: path.join(testHome, "VYXO Data"),
        VYXO_PROJECTS_DIR: path.join(testHome, "VYXO Projects"),
        SHIPSTUDIO_DESKTOP_SMOKE: "1",
        SHIPSTUDIO_DESKTOP_PICKER_SMOKE: pickerAutomated ? "1" : "0",
        SHIPSTUDIO_PICKER_FIXTURE_PATH: fixtureRoot,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let logs = "";
  const collect = (chunk) => {
    const text = chunk.toString();
    logs += text;
    process.stdout.write(text);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  let cdp;
  let activeChatRequestId = null;
  let activeChatWasCancelled = false;
  let serverOrigin = null;
  let cleanedUp = false;

  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    cdp?.close();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        wait(15_000),
      ]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    fs.rmSync(testHome, { recursive: true, force: true });
  };

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      cleanup().finally(() => process.exit(1));
    });
  }

  try {
    const target = await waitForPage(debugPort, child, () => logs);
    serverOrigin = new URL(target.url).origin;
    cdp = createCdpClient(target.webSocketDebuggerUrl);
    await cdp.ready;
    cdp.on("Network.requestWillBeSent", (params) => {
      if (params.request.url.endsWith("/api/chat") && params.request.method === "POST") {
        activeChatRequestId = params.requestId;
        activeChatWasCancelled = false;
        console.info(`[unpacked-smoke] Chat request started (requestId=${params.requestId}, bodyLength=${params.request.postData?.length ?? 0}).`);
      }
    });
    cdp.on("Network.responseReceived", (params) => {
      if (params.requestId === activeChatRequestId) {
        console.info(`[unpacked-smoke] Chat response status=${params.response.status}.`);
      }
    });
    cdp.on("Network.loadingFailed", (params) => {
      if (params.requestId === activeChatRequestId && params.canceled) {
        activeChatWasCancelled = true;
        console.info("[unpacked-smoke] Browser observed the chat request cancellation.");
      }
    });
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Network.enable");

    if (pickerAutomated) {
      await waitFor(
        cdp,
        `document.body.innerText.includes('src/sample.ts') && document.body.innerText.includes('In context')`,
        "the Electron main process to finish the read-only project picker smoke test",
        45_000,
      );
    } else {
      await waitFor(cdp, `Array.from(document.querySelectorAll('button')).some((b) => b.textContent?.trim() === 'Debug')`, "the chat window to load", 45_000);
      console.info("[unpacked-smoke] SKIPPED: the folder picker step is automated on macOS only. Check it by hand on this system.");
    }

    const renderer = await evaluate(cdp, `({
      secureContext: window.isSecureContext,
      noNodeGlobals: typeof window.require === 'undefined' && typeof process === 'undefined',
      debugButton: Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.trim() === 'Debug'),
      projectFileSelected: document.body.innerText.includes('src/sample.ts') && document.body.innerText.includes('In context')
    })`);
    assert.equal(renderer.secureContext, true, "Packaged renderer must use a secure localhost origin");
    assert.equal(renderer.noNodeGlobals, true, "Renderer must not expose Node.js globals");
    assert.equal(renderer.debugButton, true, "Debug Mode should be present");
    if (pickerAutomated) assert.equal(renderer.projectFileSelected, true, "Picker smoke should leave the synthetic file selected in the packaged explorer");

    const pageResponse = await fetch(`${serverOrigin}/chat`, { cache: "no-store" });
    const policy = pageResponse.headers.get("content-security-policy") ?? "";
    assert.equal(pageResponse.status, 200);
    assert.match(policy, /script-src[^;]*'nonce-/i, "Production CSP should include a per-response nonce");
    assert.doesNotMatch(policy, /unsafe-eval|unsafe-inline/i, "Production CSP must not allow unsafe script evaluation or inline scripts");
    assert.match(policy, /connect-src 'self'/i, "Renderer network access should be same-origin only");
    console.info("[unpacked-smoke] Production CSP nonce and local-only renderer policy passed.");

    const unauthenticated = await fetch(`${serverOrigin}/api/memories`);
    assert.equal(unauthenticated.status, 403, "A request without the main-process token should be rejected");

    const memoryResult = await runMemoryCrud(cdp);
    console.info(`[unpacked-smoke] ${memoryResult}`);

    await clickButton(cdp, "Debug");
    const debugEnabled = await evaluate(cdp, `Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.trim() === 'Debug' && button.getAttribute('aria-pressed') === 'true')`);
    assert.equal(debugEnabled, true, "Debug Mode should turn on in the unpacked app");

    await submitChat(cdp, "Debug the calculation in selected src/sample.ts. Explain the evidence, confidence, what cannot be verified, and one manual check.");
    await waitForAssistantAnswer(cdp);
    console.info("[unpacked-smoke] Debug Mode streamed a response with the selected project file.");

    if (pickerAutomated) await clickButton(cdp, "Remove all");
    await clickButton(cdp, "Chat");
    const normalMode = await evaluate(cdp, `Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.trim() === 'Chat' && button.getAttribute('aria-pressed') === 'true')`);
    assert.equal(normalMode, true, "Chat mode should remain available after Debug Mode");

    await submitChat(cdp, "Reply with a short greeting.");
    await waitForAssistantAnswer(cdp);
    console.info("[unpacked-smoke] Ordinary local chat streamed successfully.");

    await submitChat(cdp, "Give a detailed debugging walkthrough with multiple causes and manual checks for a synthetic React state issue.");
    await waitFor(cdp, `Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.trim() === 'Stop')`, "the Stop control");
    await waitFor(cdp, `(() => { const items = Array.from(document.querySelectorAll('[data-message-role="assistant"]')); const last = items.at(-1)?.textContent?.trim() ?? ''; return last.length > 0 && last !== 'Thinking…'; })()`, "the first streamed text before Stop", 30_000);
    await wait(200);
    await clickButton(cdp, "Stop");
    await waitFor(cdp, `Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.trim() === 'Send') && !Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.trim() === 'Stop')`, "the chat to return to idle after Stop", 10_000);
    await waitForCondition(() => activeChatWasCancelled, "the Stop action to cancel the HTTP stream", 10_000);
    console.info("[unpacked-smoke] Stop cancelled the active chat request.");

    console.info(`[unpacked-smoke] PASS: ${pickerAutomated ? "project picker/file display, " : ""}memory CRUD in isolated HOME, chat streaming/Stop, Debug Mode, API authorization, CSP, and renderer isolation.`);
  } finally {
    const origin = serverOrigin;
    await cleanup();

    if (origin) {
      try {
        const response = await fetch(`${origin}/chat`, {
          signal: AbortSignal.timeout(1000),
          cache: "no-store",
        });
        await response.body?.cancel().catch(() => {});
        console.error("[unpacked-smoke] FAIL: the local Next server still answered after the app quit.");
        process.exitCode = 1;
      } catch {
        console.info("[unpacked-smoke] Clean shutdown confirmed: the app server stopped answering after quit.");
      }
    }
  }
}

main().catch((error) => {
  console.error(`[unpacked-smoke] FAIL: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
