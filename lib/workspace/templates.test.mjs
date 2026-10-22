import { test } from "node:test";
import assert from "node:assert/strict";
import { builderGuideFor, keepEditableOperations } from "./templates.ts";

test("a Next.js site's design files are never changed by Build mode, but its content and new pages are", () => {
  const operations = [
    { op: "write", path: "site/content.ts", content: "export const site = {} as const;" },
    { op: "write", path: "app/page.tsx", content: "export default function Home() {}" },
    { op: "write", path: "app/layout.tsx", content: "" },
    { op: "write", path: "app/menu/page.tsx", content: "export default function Menu() {}" },
  ];
  const { kept, dropped } = keepEditableOperations("website-nextjs", operations);
  assert.deepEqual(kept.map((operation) => operation.path), ["site/content.ts", "app/menu/page.tsx"]);
  assert.deepEqual(dropped.map((operation) => operation.path), ["app/page.tsx", "app/layout.tsx"]);
});

test("plain websites and other templates are not restricted", () => {
  const operations = [{ op: "write", path: "index.html", content: "" }];
  assert.equal(keepEditableOperations("website", operations).kept.length, 1);
  assert.equal(keepEditableOperations("blank", operations).kept.length, 1);
});

test("the Next.js guide tells the Build mode which file to edit", () => {
  assert.match(builderGuideFor("website-nextjs"), /site\/content\.ts/);
  assert.equal(builderGuideFor("website"), null);
});
