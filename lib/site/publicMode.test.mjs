import assert from "node:assert/strict";
import test from "node:test";

import { decidePublicRoute } from "./publicMode.ts";

test("the home page shows the website", () => {
  assert.equal(decidePublicRoute("/"), "home");
});

test("the website, share images, icons, and brand assets stay reachable", () => {
  assert.equal(decidePublicRoute("/web"), "allow");
  assert.equal(decidePublicRoute("/web/"), "allow");
  assert.equal(decidePublicRoute("/web/terms"), "allow");
  assert.equal(decidePublicRoute("/web/privacy"), "allow");
  assert.equal(decidePublicRoute("/web/opengraph-image"), "allow");
  assert.equal(decidePublicRoute("/web/twitter-image"), "allow");
  assert.equal(decidePublicRoute("/icon.png"), "allow");
  assert.equal(decidePublicRoute("/sitemap.xml"), "allow");
  assert.equal(decidePublicRoute("/brand/logo-white.svg"), "allow");
});

test("every app page and API route is blocked", () => {
  for (const path of [
    "/chat",
    "/settings",
    "/projects",
    "/memory",
    "/agents",
    "/research",
    "/api/chat",
    "/api/memories",
    "/api/projects/abc/files/read",
    "/about",
    "/webx",
    "/web/other",
    "/web/opengraph-image/../../chat",
  ]) {
    assert.equal(decidePublicRoute(path), "block", path);
  }
});
