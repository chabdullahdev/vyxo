import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { externalUrlToOpen } = require("./links.cjs");
const { isDeveloperSigned } = require("./updater.cjs");

test("web and mail links open externally", () => {
  assert.equal(externalUrlToOpen("https://ollama.com/download"), "https://ollama.com/download");
  assert.equal(externalUrlToOpen("http://example.com/a?b=1"), "http://example.com/a?b=1");
  assert.equal(externalUrlToOpen("mailto:a@b.co"), "mailto:a@b.co");
});

test("dangerous or malformed links are never opened", () => {
  for (const url of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,<b>x</b>",
    "vscode://open",
    "smb://host/share",
    "not a url",
    "",
  ]) {
    assert.equal(externalUrlToOpen(url), null, url);
  }
});

test("only a real Developer ID signature allows in-place updates", () => {
  assert.equal(
    isDeveloperSigned("Identifier=com.vyxo.app\nAuthority=Developer ID Application: Jane (ABCDE12345)\n"),
    true,
  );
  assert.equal(isDeveloperSigned("Identifier=com.vyxo.app\nSignature=adhoc\n"), false);
  assert.equal(isDeveloperSigned("code object is not signed at all"), false);
  assert.equal(isDeveloperSigned(""), false);
});
