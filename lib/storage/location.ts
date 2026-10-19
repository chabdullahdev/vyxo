import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Electron keeps its own profile in a folder named after the app ("vyxo"),
 * and macOS treats that as the same folder as "VYXO". Our data therefore lives
 * in a differently named folder so the two never mix.
 */
export const DATA_FOLDER_NAME = "VYXO Data";

const LEGACY_MAC_FOLDER_NAME = "ShipStudioAI";
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

type Environment = Record<string, string | undefined>;

/** Where VYXO keeps conversations, projects, memories, and settings. */
export function resolveDataDirectory(
  env: Environment = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (env.VYXO_DATA_DIR) return env.VYXO_DATA_DIR;
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", DATA_FOLDER_NAME);
  }
  if (platform === "win32") {
    return join(env.APPDATA ?? join(home, "AppData", "Roaming"), DATA_FOLDER_NAME);
  }
  return join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), DATA_FOLDER_NAME);
}

/** The folder early builds used (macOS only). */
export function legacyDataDirectory(
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string | null {
  if (platform !== "darwin") return null;
  return join(home, "Library", "Application Support", LEGACY_MAC_FOLDER_NAME);
}

function tightenPermissions(directory: string): void {
  chmodSync(directory, DIR_MODE);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) tightenPermissions(path);
    else if (entry.isFile()) chmodSync(path, FILE_MODE);
  }
}

/** Cleanup must never turn a recoverable failure into a crash. */
function removeQuietly(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // Leaving a stray staging folder behind is harmless.
  }
}

export type MigrationResult = "migrated" | "already-present" | "nothing-to-migrate" | "failed";

/**
 * Copy data from the old folder to the new one, once. The old folder is left in
 * place as a backup. The copy happens beside the target and is renamed into
 * place, so a crash never leaves a half-copied folder behind.
 */
export function migrateLegacyData(target: string, legacy: string | null): MigrationResult {
  if (!legacy || legacy === target) return "nothing-to-migrate";
  if (existsSync(target)) return "already-present";
  try {
    if (!statSync(legacy).isDirectory()) return "nothing-to-migrate";
  } catch {
    return "nothing-to-migrate";
  }

  const staging = `${target}.migrating-${process.pid}`;
  try {
    mkdirSync(dirname(target), { recursive: true });
    removeQuietly(staging);
    cpSync(legacy, staging, { recursive: true, preserveTimestamps: true });
    tightenPermissions(staging);
    renameSync(staging, target);
    return "migrated";
  } catch {
    removeQuietly(staging);
    // Another process may have finished the same migration first.
    return existsSync(target) ? "already-present" : "failed";
  }
}

/**
 * Resolve the data folder, moving old data across on first run. If the move
 * fails, keep using the old folder rather than starting empty.
 */
export function prepareDataDirectory(
  env: Environment = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  const target = resolveDataDirectory(env, platform, home);
  if (env.VYXO_DATA_DIR) return target;
  const legacy = legacyDataDirectory(platform, home);
  if (migrateLegacyData(target, legacy) === "failed" && legacy) return legacy;
  return target;
}
