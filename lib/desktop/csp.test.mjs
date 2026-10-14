import { test } from "node:test";
import assert from "node:assert/strict";
import { createDesktopContentSecurityPolicy } from "./csp.ts";

test("desktop CSP uses a per-response nonce and allows only local resources", () => {
  const policy = createDesktopContentSecurityPolicy("synthetic-nonce");

  assert.ok(policy.includes("script-src 'self' 'nonce-synthetic-nonce' 'strict-dynamic'"));
  assert.ok(policy.includes("style-src 'self' 'nonce-synthetic-nonce'"));
  assert.ok(policy.includes("connect-src 'self'"));
  assert.ok(policy.includes("frame-src 'none'"));
  assert.ok(policy.includes("object-src 'none'"));
  assert.ok(policy.includes("frame-ancestors 'none'"));
  assert.equal(policy.includes("unsafe-eval"), false);
  assert.equal(policy.includes("unsafe-inline"), false);
  assert.equal(policy.includes("https://"), false);
});
