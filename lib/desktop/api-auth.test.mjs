import { test } from "node:test";
import assert from "node:assert/strict";
import { isAuthorizedDesktopRequest } from "./api-auth.ts";

const DESKTOP_ENV_KEYS = [
  "SHIPSTUDIO_DESKTOP",
  "SHIPSTUDIO_DESKTOP_TOKEN",
  "SHIPSTUDIO_DESKTOP_ORIGIN",
];

function withDesktopEnvironment(values, run) {
  const previous = new Map(
    DESKTOP_ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  for (const key of DESKTOP_ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);

  try {
    run();
  } finally {
    for (const key of DESKTOP_ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function makeRequest(url, { host, origin, token } = {}) {
  const headers = new Headers();
  if (host) headers.set("host", host);
  if (origin) headers.set("origin", origin);
  if (token) headers.set("x-shipstudio-desktop-token", token);
  return new Request(url, { headers });
}

test("regular local development stays compatible when desktop auth is disabled", () => {
  withDesktopEnvironment({}, () => {
    assert.equal(
      isAuthorizedDesktopRequest(new Request("http://127.0.0.1:3697/api/chat")),
      true,
    );
  });
});

test("desktop requests require the app token and expected loopback origin", () => {
  withDesktopEnvironment(
    {
      SHIPSTUDIO_DESKTOP: "1",
      SHIPSTUDIO_DESKTOP_TOKEN: "synthetic-test-token",
      SHIPSTUDIO_DESKTOP_ORIGIN: "http://127.0.0.1:49321",
    },
    () => {
      assert.equal(
        isAuthorizedDesktopRequest(
          makeRequest("http://127.0.0.1:49321/api/chat", {
            host: "127.0.0.1:49321",
            origin: "http://127.0.0.1:49321",
            token: "synthetic-test-token",
          }),
        ),
        true,
      );
      assert.equal(
        isAuthorizedDesktopRequest(
          makeRequest("http://localhost:49321/api/chat", {
            host: "127.0.0.1:49321",
            origin: "http://127.0.0.1:49321",
            token: "synthetic-test-token",
          }),
        ),
        true,
      );
      assert.equal(
        isAuthorizedDesktopRequest(
          makeRequest("http://127.0.0.1:49321/api/chat", {
            host: "127.0.0.1:49321",
            origin: "http://127.0.0.1:49321",
          }),
        ),
        false,
      );
      assert.equal(
        isAuthorizedDesktopRequest(
          makeRequest("http://127.0.0.1:49321/api/chat", {
            host: "127.0.0.1:49321",
            origin: "http://127.0.0.1:49321",
            token: "wrong-token",
          }),
        ),
        false,
      );
      assert.equal(
        isAuthorizedDesktopRequest(
          makeRequest("http://127.0.0.1:49321/api/chat", {
            host: "localhost:49321",
            origin: "http://localhost:49321",
            token: "synthetic-test-token",
          }),
        ),
        false,
      );
    },
  );
});

test("desktop mode fails closed when its launch token or origin is missing", () => {
  withDesktopEnvironment({ SHIPSTUDIO_DESKTOP: "1" }, () => {
    assert.equal(
      isAuthorizedDesktopRequest(
        makeRequest("http://127.0.0.1:49321/api/chat", {
          host: "127.0.0.1:49321",
          token: "synthetic-test-token",
        }),
      ),
      false,
    );
  });
});
