import { homedir } from "node:os";
import { isAbsolute, normalize } from "node:path";

export const FILES_MAX_READ_BYTES = 256 * 1024;
export const FILES_MAX_LISTING_ENTRIES = 500;
export const FILES_MAX_SEARCH_RESULTS = 40;
export const FILES_MAX_SEARCH_FILES = 2_000;
export const FILES_MAX_SEARCH_FILE_BYTES = 256 * 1024;
export const FILES_MAX_SNIPPET_CHARS = 300;
export const FILES_MAX_QUERY_CHARS = 200;
export const FILES_MAX_EVIDENCE_CHARS = 10_000;
export const FILES_MAX_RELATIVE_PATH_CHARS = 1_024;
export const FILES_MAX_FOLDER_PATH_CHARS = 4_096;

const FORBIDDEN_ROOT_PREFIXES = [
  "/System",
  "/Library",
  "/usr",
  "/bin",
  "/sbin",
  "/etc",
  "/dev",
  "/Volumes",
  "/Applications",
  "/cores",
  "/private/etc",
  "/private/var/db",
  "/private/var/root",
];

function withoutTrailingSlash(value: string): string {
  const trimmed = value.replace(/\/+$/, "");
  return trimmed.length === 0 ? "/" : trimmed;
}

export function isForbiddenRoot(resolvedPath: string): boolean {
  if (typeof resolvedPath !== "string" || !isAbsolute(resolvedPath)) return true;

  const normalized = withoutTrailingSlash(resolvedPath);
  if (normalized === "/") return true;

  const home = withoutTrailingSlash(homedir());
  if (normalized === home) return true;

  return FORBIDDEN_ROOT_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

export function isPathInsideRoot(root: string, candidate: string): boolean {
  const normalizedRoot = normalize(root);
  const normalizedCandidate = normalize(candidate);
  if (normalizedCandidate === normalizedRoot) return true;
  return normalizedCandidate.startsWith(`${normalizedRoot}/`);
}
