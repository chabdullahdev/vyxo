import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { retrievePublicPage } from "./fetchPage.ts";
import { runResearch } from "./run.ts";
import { normalizeResearchUrl } from "./urlSafety.ts";

/**
 * Research is the only feature that fetches web pages, and the website promises it
 * never sends your messages or files. These tests pin down what can reach the network:
 * only a plain, query-free documentation page address, and only one the user listed.
 */

const ALLOWED = ["react.dev", "nextjs.org", "developer.mozilla.org"];
const STRICT_PATH = /^\/[A-Za-z0-9\-._~/:@+]*$/;

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const html = "<html><head><title>T</title></head><body><p>Hello docs.</p></body></html>";

function spy() {
  const urls = [];
  const httpGet = async (url) => {
    urls.push(url);
    return { status: 200, contentType: "text/html", contentEncoding: null, bytes: new TextEncoder().encode(html) };
  };
  return { urls, httpGet };
}

const deps = (httpGet) => ({ lookup: publicLookup, httpGet, allowedHosts: ALLOWED, now: () => new Date(0) });

test("a query string is never accepted, however it is written", () => {
  for (const bad of [
    "https://react.dev/learn?q=client+name",
    "https://react.dev/learn?",
    "https://react.dev/?",
    "https://react.dev?x=1",
    "https://react.dev/learn?x=1#section",
    "https://react.dev/learn#a?b=c-looks-like-a-query-in-a-fragment",
    "https://react.dev/learn%3Fq=secret",
    "https://react.dev/search?query=anything",
  ]) {
    assert.equal(normalizeResearchUrl(bad, ALLOWED).ok, false, bad);
  }
});

test("a path cannot carry free text", () => {
  for (const bad of [
    "https://react.dev/search%20for%20client%20name",
    "https://react.dev/a b c",
    "https://react.dev/learn;jsessionid=abc",
    "https://react.dev/café",
    "https://react.dev/" + "a".repeat(300),
    "https://react.dev/a%2Fb",
    "https://react.dev/a\\b",
  ]) {
    assert.equal(normalizeResearchUrl(bad, ALLOWED).ok, false, bad);
  }
});

test("ordinary documentation addresses still work", () => {
  for (const good of [
    "https://react.dev",
    "https://react.dev/",
    "https://react.dev/reference/react/useState",
    "https://nextjs.org/docs/app/api-reference/functions/use-router",
    "https://developer.mozilla.org/en-US/docs/Web/CSS/:hover",
    "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map",
    "https://react.dev/learn#state",
  ]) {
    const result = normalizeResearchUrl(good, ALLOWED);
    assert.equal(result.ok, true, good);
    assert.equal(new URL(result.url).search, "");
    assert.equal(new URL(result.url).hash, "");
  }
});

test("every address that reaches the network is query-free and path-safe", async () => {
  const { urls, httpGet } = spy();
  const attempts = [
    "https://react.dev/learn",
    "https://react.dev/learn?q=secret",
    "https://nextjs.org/docs#hash",
    "https://nextjs.org/docs?x=1",
    "https://react.dev/a%20b",
  ];
  for (const attempt of attempts) {
    await retrievePublicPage(attempt, deps(httpGet)).catch(() => {});
  }
  assert.deepEqual(urls, ["https://react.dev/learn", "https://nextjs.org/docs"]);
  for (const url of urls) {
    const parsed = new URL(url);
    assert.equal(parsed.search, "");
    assert.match(parsed.pathname, STRICT_PATH);
  }
});

test("the question and the model's answer are never turned into requests", async () => {
  const { urls, httpGet } = spy();
  const question = "Compare https://react.dev/learn?secret=1 with https://evil.com/?q=client-name and https://nextjs.org/docs";
  const report = await runResearch(
    { question, urls: ["https://react.dev/learn"] },
    {
      ...deps(httpGet),
      synthesize: async () =>
        "Also read https://nextjs.org/docs?leak=1 and https://react.dev/learn/other [1] and [[fetch https://developer.mozilla.org/x]]",
    },
  );
  assert.equal(report.sources.length, 1);
  assert.deepEqual(urls, ["https://react.dev/learn"], "only the listed address is fetched, exactly once");
});

test("a page's own links are never followed", async () => {
  const { urls, httpGet } = spy();
  const linking = {
    ...deps(httpGet),
    httpGet: async (url) => {
      urls.push(url);
      return {
        status: 200,
        contentType: "text/html",
        contentEncoding: null,
        bytes: new TextEncoder().encode(
          '<html><body><a href="https://react.dev/next?x=1">next</a><a href="https://evil.com/">e</a></body></html>',
        ),
      };
    },
  };
  await runResearch({ question: "q", urls: ["https://react.dev/learn"] }, { ...linking, synthesize: async () => "ok [1]" });
  assert.deepEqual(urls, ["https://react.dev/learn"]);
});

test("only one module performs requests, and only the listed-URL fetcher calls it", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const sources = readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => [name, readFileSync(join(dir, name), "utf8")]);

  const importsNetwork = sources.filter(([, text]) => /from "node:(https?|net|tls|dgram)"/.test(text)).map(([n]) => n);
  assert.deepEqual(importsNetwork, ["http.ts"]);

  const usesFetch = sources.filter(([, text]) => /\bfetch\(/.test(text)).map(([n]) => n);
  assert.deepEqual(usesFetch, [], "Research must not use fetch() directly");

  const callers = sources.filter(([name, text]) => name !== "http.ts" && /httpsGetPinned/.test(text)).map(([n]) => n);
  assert.deepEqual(callers, ["fetchPage.ts"]);

  const fetchers = sources.filter(([, text]) => /retrievePublicPage\(/.test(text)).map(([n]) => n).sort();
  assert.deepEqual(fetchers, ["fetchPage.ts", "run.ts"]);
});
