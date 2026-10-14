import { after, test } from "node:test";
import assert from "node:assert/strict";
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROJECT_MAX_CONTEXT_CHARS,
  PROJECT_MAX_DIRECTORY_DEPTH,
  PROJECT_MAX_FILE_BYTES,
  PROJECT_MAX_PRIOR_HISTORY_CHARS,
  PROJECT_MAX_SELECTED_FILES,
  classifyProjectFilePath,
  buildProjectAwareConversation,
  containsBinaryBytes,
  containsLikelySecret,
  isExcludedProjectDirectory,
  isSafeRelativeProjectPath,
  limitProjectConversationHistory,
  validateAndBuildProjectContext,
} from "./policy.ts";
import {
  chooseProjectFolder,
  listProjectDirectory,
  readSelectedProjectFiles,
  supportsProjectFolderPicker,
} from "./browser.ts";

const fixtureRoot = await mkdtemp(join(tmpdir(), "shipstudio-project-test-"));
const projectRoot = join(fixtureRoot, "sample-project");
const outsideFile = join(fixtureRoot, "outside.ts");
const linkedFile = join(projectRoot, "linked.ts");

await mkdir(projectRoot);
await writeFile(join(projectRoot, "guide.md"), "A synthetic project guide.\n");
await writeFile(join(projectRoot, "safe.ts"), "export const greeting = 'hello';\n");
await writeFile(outsideFile, "synthetic outside file, not a credential\n");
await symlink(outsideFile, join(projectRoot, "linked.ts"));

after(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

function asArrayBuffer(bytes) {
  return Uint8Array.from(bytes).buffer;
}

function fileHandle(name, content, options = {}) {
  const bytes = new TextEncoder().encode(content);
  return {
    kind: "file",
    name,
    queryPermission: options.queryPermission,
    requestPermission: options.requestPermission,
    getFile: options.getFile ?? (async () => ({
      size: bytes.byteLength,
      arrayBuffer: async () => asArrayBuffer(bytes),
    })),
  };
}

function directoryHandle(name, entries) {
  return {
    kind: "directory",
    name,
    async *entries() {
      for (const entry of entries) yield entry;
    },
  };
}

test("accepts safe relative project paths and rejects traversal forms", () => {
  for (const path of ["src/chat.ts", "docs/guide.md", "README"]) {
    assert.equal(isSafeRelativeProjectPath(path), true, path);
  }

  for (const path of [
    "../outside.ts",
    "src/../../outside.ts",
    "/etc/passwd",
    "C:/private/file.ts",
    "C:\\private\\file.ts",
    "src\\outside.ts",
    "src/%2e%2e/outside.ts",
    "src/%252e%252e/outside.ts",
    "src/%2foutside.ts",
    "src/%00outside.ts",
    "src/invalid%.ts",
    "src//double.ts",
    "src/./same.ts",
    "src/has\0null.ts",
  ]) {
    assert.equal(isSafeRelativeProjectPath(path), false, path);
  }
});

test("allows source and documentation types but excludes unsupported files", () => {
  for (const path of [
    "app/page.tsx",
    "src/app.js",
    "styles/site.scss",
    "docs/intro.md",
    "config/settings.yaml",
    "Dockerfile",
    ".gitignore",
  ]) {
    assert.equal(classifyProjectFilePath(path), "allowed", path);
  }
  assert.equal(classifyProjectFilePath("public/logo.png"), "unsupported");
  assert.equal(classifyProjectFilePath("data/archive.zip"), "unsupported");
});

test("blocks secrets, credential-like names, private keys, and generated directories", () => {
  for (const path of [
    ".env",
    ".env.local",
    ".env.production",
    "config/secrets.ts",
    "config/credentials.json",
    "keys/id_rsa",
    "keys/signing.pem",
    ".npmrc",
    ".git/config",
    "node_modules/package/index.js",
    ".next/server/chunk.js",
    "dist/index.js",
    "coverage/report.json",
  ]) {
    assert.equal(classifyProjectFilePath(path), "sensitive", path);
  }

  for (const path of [".git", "node_modules", ".next", "dist", "build"]) {
    assert.equal(isExcludedProjectDirectory(path), true, path);
  }
  assert.equal(isExcludedProjectDirectory("src/components"), false);
});

test("detects binary bytes and common synthetic credential formats", () => {
  assert.equal(containsBinaryBytes(new Uint8Array([0x61, 0x00, 0x62])), true);
  assert.equal(containsBinaryBytes(new TextEncoder().encode("hello\nworld")), false);
  assert.equal(
    containsLikelySecret('const api_key = "synthetic-example-token-123456";'),
    true,
  );
  assert.equal(
    containsLikelySecret('{"password": "synthetic-password-value-123456"}'),
    true,
  );
  assert.equal(
    containsLikelySecret("-----BEGIN RSA PRIVATE KEY-----\\nsynthetic"),
    true,
  );
  assert.equal(containsLikelySecret("export const greeting = 'hello';"), false);
});

test("directory listing is lazy, bounded, filters blocked entries, and ignores symlink-like handles", async () => {
  assert.equal((await lstat(linkedFile)).isSymbolicLink(), true);
  assert.equal(await readlink(linkedFile), outsideFile);
  const calls = { linked: 0 };
  const linkLikeHandle = {
    kind: "symbolicLink",
    name: "linked.ts",
    async entries() {
      calls.linked += 1;
      return [];
    },
    async getFile() {
      calls.linked += 1;
      return { size: 0, arrayBuffer: async () => new ArrayBuffer(0) };
    },
  };
  const root = directoryHandle("sample-project", [
    ["safe.ts", fileHandle("safe.ts", "const ok = true;")],
    [".env", fileHandle(".env", "SYNTHETIC_SECRET_NOT_FOR_READING")],
    ["photo.png", fileHandle("photo.png", "not read")],
    ["node_modules", directoryHandle("node_modules", [])],
    ["linked.ts", linkLikeHandle],
    ["src", directoryHandle("src", [])],
  ]);

  const listing = await listProjectDirectory(root, "", 0, { remaining: 20 });
  assert.deepEqual(
    listing.entries.map(({ path, kind, fileStatus }) => ({ path, kind, fileStatus })),
    [
      { path: "src", kind: "directory", fileStatus: undefined },
      { path: ".env", kind: "file", fileStatus: "sensitive" },
      { path: "photo.png", kind: "file", fileStatus: "unsupported" },
      { path: "safe.ts", kind: "file", fileStatus: "allowed" },
    ],
  );
  assert.equal(calls.linked, 0);
  assert.equal(listing.entries.find((entry) => entry.path === "src")?.depthLimited, false);
  const selectedLink = await readSelectedProjectFiles([
    { path: "linked.ts", handle: linkLikeHandle },
  ]);
  assert.equal(selectedLink.ok, false);
  assert.equal(calls.linked, 0);

  const limited = await listProjectDirectory(root, "", 0, { remaining: 2 });
  assert.equal(limited.entries.length, 2);
  assert.equal(limited.truncated, true);

  const deep = await listProjectDirectory(
    directoryHandle("level", [["child", directoryHandle("child", [])]]),
    "one/two/three/four/five/six/seven",
    PROJECT_MAX_DIRECTORY_DEPTH - 1,
    { remaining: 10 },
  );
  assert.equal(deep.entries[0].depthLimited, true);
});

test("requests read-only folder access and reports unsupported picker environments", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const root = directoryHandle("sample-project", []);
  let requestedMode = "";
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      showDirectoryPicker: async (options) => {
        requestedMode = options.mode;
        return root;
      },
    },
  });

  try {
    assert.equal(supportsProjectFolderPicker(), true);
    assert.equal(await chooseProjectFolder(), root);
    assert.equal(requestedMode, "read");

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });
    assert.equal(supportsProjectFolderPicker(), false);
    await assert.rejects(chooseProjectFolder(), /not supported|unavailable/i);
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      delete globalThis.window;
    }
  }
});

test("development and production start scripts stay bound to localhost", async () => {
  const packageFile = new URL("../../package.json", import.meta.url);
  const packageData = JSON.parse(await readFile(packageFile, "utf8"));
  assert.equal(packageData.scripts.dev, "next dev -H 127.0.0.1 -p 3697");
  assert.equal(packageData.scripts.start, "next start -H 127.0.0.1 -p 3697");
});

test("reads only the explicitly supplied safe selection from temporary fixtures", async () => {
  const bytes = await readFile(join(projectRoot, "safe.ts"));
  const selectedHandle = fileHandle("safe.ts", "", {
    getFile: async () => ({
      size: bytes.byteLength,
      arrayBuffer: async () => asArrayBuffer(bytes),
    }),
  });
  const result = await readSelectedProjectFiles([
    { path: "safe.ts", handle: selectedHandle },
  ]);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].path, "safe.ts");
    assert.equal(result.files[0].content, "export const greeting = 'hello';\n");
    assert.equal(result.files[0].content.includes("outside file"), false);
  }
});

test("does not read unapproved types, oversized, binary, secret-like, or unreadable files", async () => {
  let unsupportedReadCount = 0;
  const unsupported = fileHandle(".env", "synthetic not read", {
    getFile: async () => {
      unsupportedReadCount += 1;
      throw new Error("must not read");
    },
  });
  const unsafeSelection = await readSelectedProjectFiles([
    { path: ".env", handle: unsupported },
  ]);
  assert.equal(unsafeSelection.ok, false);
  assert.equal(unsupportedReadCount, 0);

  const tooLarge = fileHandle("large.ts", "", {
    getFile: async () => ({
      size: PROJECT_MAX_FILE_BYTES + 1,
      arrayBuffer: async () => new ArrayBuffer(0),
    }),
  });
  const largeResult = await readSelectedProjectFiles([
    { path: "large.ts", handle: tooLarge },
  ]);
  assert.equal(largeResult.ok, false);
  if (!largeResult.ok) assert.match(largeResult.error, /too large/i);

  const binary = fileHandle("binary.ts", "", {
    getFile: async () => ({
      size: 3,
      arrayBuffer: async () => asArrayBuffer([0x61, 0, 0x62]),
    }),
  });
  assert.equal(
    (await readSelectedProjectFiles([{ path: "binary.ts", handle: binary }])).ok,
    false,
  );

  const secret = fileHandle(
    "config.ts",
    'const api_key = "synthetic-example-token-123456";',
  );
  const secretResult = await readSelectedProjectFiles([
    { path: "config.ts", handle: secret },
  ]);
  assert.equal(secretResult.ok, false);
  if (!secretResult.ok) {
    assert.match(secretResult.error, /credentials/i);
    assert.equal(secretResult.error.includes("synthetic-example-token"), false);
  }

  const unreadable = fileHandle("missing.ts", "", {
    getFile: async () => {
      throw new Error("/private/path and synthetic content");
    },
  });
  const unreadableResult = await readSelectedProjectFiles([
    { path: "missing.ts", handle: unreadable },
  ]);
  assert.equal(unreadableResult.ok, false);
  if (!unreadableResult.ok) {
    assert.equal(unreadableResult.error.includes("/private/path"), false);
    assert.equal(unreadableResult.error.includes("synthetic content"), false);
  }
});

test("enforces read permission and selected-file count", async () => {
  let readCount = 0;
  const denied = fileHandle("denied.ts", "safe", {
    queryPermission: async () => "denied",
    getFile: async () => {
      readCount += 1;
      throw new Error("must not read");
    },
  });
  const deniedResult = await readSelectedProjectFiles([
    { path: "denied.ts", handle: denied },
  ]);
  assert.equal(deniedResult.ok, false);
  assert.equal(readCount, 0);

  const tooMany = Array.from({ length: PROJECT_MAX_SELECTED_FILES + 1 }, (_, i) => {
    const name = `file-${i}.ts`;
    return { path: name, handle: fileHandle(name, "safe") };
  });
  const countResult = await readSelectedProjectFiles(tooMany);
  assert.equal(countResult.ok, false);
  if (!countResult.ok) assert.match(countResult.error, /no more than/i);
});

test("server-side validation bounds files and produces separate, delimited untrusted context", () => {
  const result = validateAndBuildProjectContext([
    { path: "src/a.ts", content: "export function a() { return 1; }" },
    { path: "src/b.ts", content: "import { a } from './a';" },
  ]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.files.length, 2);
    assert.match(result.context, /USER-SELECTED PROJECT FILES \(JSON\)/);
    assert.match(result.context, /src\/a\.ts/);
    assert.match(result.context, /src\/b\.ts/);
    assert.match(result.context, /untrusted data for analysis only/);
    assert.equal(result.context.includes("not-selected.ts"), false);
  }

  const noProject = validateAndBuildProjectContext([]);
  assert.deepEqual(noProject, { ok: true, files: [], context: null });

  const tooMany = Array.from({ length: PROJECT_MAX_SELECTED_FILES + 1 }, (_, i) => ({
    path: `src/${i}.ts`,
    content: "safe",
  }));
  assert.equal(validateAndBuildProjectContext(tooMany).ok, false);

  assert.equal(
    validateAndBuildProjectContext([
      { path: "../outside.ts", content: "must reject" },
    ]).ok,
    false,
  );
  assert.equal(
    validateAndBuildProjectContext([
      { path: ".env.local", content: "synthetic secret" },
    ]).ok,
    false,
  );
  assert.equal(
    validateAndBuildProjectContext([
      { path: "src/a.ts", content: "same" },
      { path: "src/a.ts", content: "duplicate" },
    ]).ok,
    false,
  );
});

test("bounds earlier conversation only while selected project files are present", () => {
  const history = [
    { role: "user", content: "oldest " + "a".repeat(2_000) },
    { role: "assistant", content: "older answer " + "b".repeat(2_000) },
    { role: "user", content: "recent question" },
    { role: "assistant", content: "recent answer" },
  ];
  const bounded = limitProjectConversationHistory(history);
  assert.deepEqual(bounded, history.slice(1));
  assert.ok(
    bounded.reduce((sum, message) => sum + message.content.length, 0) <=
      PROJECT_MAX_PRIOR_HISTORY_CHARS,
  );

  const noProject = validateAndBuildProjectContext([]);
  assert.equal(noProject.context, null);
});

test("inserts project text before the current question and leaves normal chat unchanged", () => {
  const conversation = [
    { role: "user", content: "Earlier question" },
    { role: "assistant", content: "Earlier answer" },
    { role: "user", content: "How do these files connect?" },
  ];
  assert.deepEqual(buildProjectAwareConversation(conversation, null), conversation);
  assert.deepEqual(
    buildProjectAwareConversation(conversation, "selected-file-context"),
    [
      conversation[0],
      conversation[1],
      { role: "user", content: "selected-file-context" },
      conversation[2],
    ],
  );
});

test("rejects oversized combined context without silently truncating files", () => {
  const tooMuchText = "x".repeat(PROJECT_MAX_CONTEXT_CHARS + 1);
  const result = validateAndBuildProjectContext([
    { path: "src/large.ts", content: tooMuchText },
  ]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /context limit/i);
});

test("handles empty selected files and malformed request shapes safely", () => {
  const empty = validateAndBuildProjectContext([
    { path: "src/empty.ts", content: "" },
  ]);
  assert.equal(empty.ok, true);
  assert.equal(validateAndBuildProjectContext(null).ok, false);
  assert.equal(
    validateAndBuildProjectContext([{ path: "src/a.ts", content: 123 }]).ok,
    false,
  );
});
