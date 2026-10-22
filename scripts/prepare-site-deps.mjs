// Installs the packages that a VYXO Next.js website needs into build/site-deps, so the release can
// ship them inside the app. Runs once per build; the locked versions come from desktop/site-deps.
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "desktop", "site-deps");
const target = join(root, "build", "site-deps");
const installed = join(target, "node_modules", "next", "dist", "bin", "next");

// The packages contain programs for one system and processor, so a folder prepared elsewhere is rebuilt.
const host = `${process.platform}-${process.arch}`;
const hostMarker = join(target, "host.txt");
const preparedHere = existsSync(hostMarker) && readFileSync(hostMarker, "utf8").trim() === host;
if (existsSync(installed) && preparedHere && !process.argv.includes("--force")) {
  console.log(`Site packages are already prepared for ${host} in build/site-deps (use --force to rebuild).`);
  process.exit(0);
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(join(source, "package.json"), join(target, "package.json"));

const install = spawnSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts"], {
  cwd: target,
  stdio: "inherit",
  // On Windows npm is npm.cmd, which only runs through the shell.
  shell: process.platform === "win32",
});
if (install.status !== 0) {
  console.error("Installing the site packages failed.");
  process.exit(install.status ?? 1);
}
if (!existsSync(installed)) {
  console.error("The Next.js command was not found after installing the site packages.");
  process.exit(1);
}
await writeFile(hostMarker, `${host}\n`);
console.log(`Site packages are ready in build/site-deps for ${host}.`);
