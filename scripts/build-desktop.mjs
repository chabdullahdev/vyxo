// Builds the desktop app's Next.js server. Written as a script so it runs the same on macOS and Windows.
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const result = spawnSync(process.execPath, [nextBin, "build"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, SHIPSTUDIO_DESKTOP: "1", SHIPSTUDIO_DESKTOP_BUILD: "1" },
});
process.exit(result.status ?? 1);
