import assert from "node:assert/strict";
import test from "node:test";

import { decidePublicRoute } from "./publicMode.ts";

test("the home page shows the About page", () => {
  assert.equal(decidePublicRoute("/"), "home");
});

test("About and brand assets stay reachable", () => {
  assert.equal(decidePublicRoute("/about"), "allow");
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
    "/about/../chat",
    "/aboutx",
  ]) {
    assert.equal(decidePublicRoute(path), "block", path);
  }
});
