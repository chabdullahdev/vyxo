import assert from "node:assert/strict";
import test from "node:test";

import { pickDmgUrl } from "./download.ts";

const base = "https://github.com/chabdullahdev/vyxo/releases/download/v0.2.0";
const asset = (name, url = `${base}/${name}`) => ({ name, browser_download_url: url });
const release = (assets, extra = {}) => ({ draft: false, prerelease: false, assets, ...extra });

test("picks the Apple Silicon dmg, not the zip or blockmap", () => {
  const url = pickDmgUrl(
    release([
      asset("latest-mac.yml"),
      asset("VYXO-0.2.0-arm64.zip"),
      asset("VYXO-0.2.0-arm64.dmg.blockmap"),
      asset("VYXO-0.2.0-arm64.dmg"),
    ]),
  );
  assert.equal(url, `${base}/VYXO-0.2.0-arm64.dmg`);
});

test("follows the newest version without any code change", () => {
  const next = "https://github.com/chabdullahdev/vyxo/releases/download/v0.3.0/VYXO-0.3.0-arm64.dmg";
  assert.equal(pickDmgUrl(release([asset("VYXO-0.3.0-arm64.dmg", next)])), next);
});

test("never redirects anywhere but this project's own release downloads", () => {
  for (const url of [
    "https://evil.example/releases/download/v1/VYXO-0.2.0-arm64.dmg",
    "https://github.com/someone-else/vyxo/releases/download/v1/VYXO-0.2.0-arm64.dmg",
    "http://github.com/chabdullahdev/vyxo/releases/download/v1/VYXO-0.2.0-arm64.dmg",
    `${base}/VYXO-0.2.0-arm64.dmg?next=https://evil.example`,
    `${base}/other-name.dmg`,
    "javascript:alert(1)",
  ]) {
    assert.equal(pickDmgUrl(release([asset("VYXO-0.2.0-arm64.dmg", url)])), null, url);
  }
});

test("ignores drafts, prereleases, and malformed responses", () => {
  const files = [asset("VYXO-0.2.0-arm64.dmg")];
  assert.equal(pickDmgUrl(release(files, { draft: true })), null);
  assert.equal(pickDmgUrl(release(files, { prerelease: true })), null);
  for (const bad of [null, undefined, 42, "x", {}, { assets: "nope" }, { assets: [null, 1, {}] }]) {
    assert.equal(pickDmgUrl(bad), null);
  }
  assert.equal(pickDmgUrl(release([asset("VYXO-0.2.0-x64.dmg")])), null);
});
