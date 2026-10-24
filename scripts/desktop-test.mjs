// Opens VYXO against a separate test folder, so trying things out never touches your real chats,
// memories, or projects. Works the same on macOS and Windows.
//
//   npm run desktop:test              the development version (uses this source code)
//   npm run desktop:test -- --built   the app built by desktop:win / desktop:dir
//   npm run desktop:test -- --reset   empty the test folder first
//
// The test folder is "VYXO Test" in your home folder (outside this repository). It holds:
//   Data/            chats, memories, settings (instead of the real VYXO Data folder)
//   Projects/        workspace projects (instead of ~/VYXO Projects)
//   Profile/         the app window's own browser profile, so this runs even while the real VYXO is open
//   Sample folder/   a small folder to connect as a project
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = process.env.VYXO_TEST_DIR ?? join(homedir(), "VYXO Test");
const built = process.argv.includes("--built");

if (process.argv.includes("--reset")) await rm(testRoot, { recursive: true, force: true });

const folders = {
  data: join(testRoot, "Data"),
  projects: join(testRoot, "Projects"),
  profile: join(testRoot, "Profile"),
  sample: join(testRoot, "Sample folder"),
};
for (const folder of Object.values(folders)) await mkdir(folder, { recursive: true });

const sampleFiles = {
  "README.md": "# Sample folder\n\nA small folder for testing VYXO projects. Ask VYXO what these files do, or to change one.\n",
  "src/greeting.ts": 'export function greeting(name: string): string {\n  return `Hello, ${name}!`;\n}\n',
  "src/total.ts": "export function total(prices: number[]): number {\n  return prices.reduce((sum, price) => sum + price, 0);\n}\n",
};
for (const [name, content] of Object.entries(sampleFiles)) {
  const file = join(folders.sample, name);
  if (existsSync(file)) continue;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

let command;
let args;
if (built) {
  command =
    process.platform === "win32"
      ? join(root, "release", "win-unpacked", "VYXO.exe")
      : join(root, "release", "mac-arm64", "VYXO.app", "Contents", "MacOS", "VYXO");
  if (!existsSync(command)) {
    console.error(`No built app at ${command}. Build it first (npm run desktop:win on Windows, npm run desktop:dir on a Mac).`);
    process.exit(1);
  }
  args = [];
} else {
  command = process.execPath;
  args = [join(root, "node_modules", "electron", "cli.js"), "."];
}
args.push(`--user-data-dir=${folders.profile}`);

console.log(`Test folder: ${testRoot}`);
console.log(`Connect "${folders.sample}" as a project to try the project features.`);

const child = spawn(command, args, {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    ...(built ? {} : { SHIPSTUDIO_DESKTOP_DEV: "1" }),
    VYXO_DATA_DIR: folders.data,
    VYXO_PROJECTS_DIR: folders.projects,
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
