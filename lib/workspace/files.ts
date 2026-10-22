import { randomBytes } from "node:crypto";
import { access, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, extname, join, sep } from "node:path";
import { isExcludedProjectDirectory } from "../project/policy.ts";
import { SITE_OUTPUT_DIR } from "./build.ts";
import { MARKER_DIR } from "./create.ts";
import { WorkspaceError, isErrno } from "./errors.ts";

/**
 * File operations inside one workspace project.
 *
 * Every path that comes from outside is checked by `cleanRelativePath` and then proven to stay
 * inside the workspace (no links, no "..") before it is used. The bookkeeping folder `.vyxo` is
 * off limits. Removing a file moves it to a trash inside the workspace instead of deleting it.
 */

export const MAX_PATH_CHARS = 512;
export const MAX_SEGMENT_CHARS = 200;
export const MAX_UPLOAD_FILES = 25;
export const MAX_UPLOAD_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_UPLOAD_TOTAL_BYTES = 100 * 1024 * 1024;
export const MAX_WORKSPACE_FILES = 5_000;
export const MAX_TRASH_ENTRIES = 500;

const TRASH_DIR = `${MARKER_DIR}/trash`;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** Validate a path typed or sent by the user and return it in a single canonical form. */
export function cleanRelativePath(input: unknown, options: { allowEmpty?: boolean } = {}): string {
  if (typeof input !== "string") throw new WorkspaceError("INVALID_PATH", "A file path is required.");
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    if (options.allowEmpty) return "";
    throw new WorkspaceError("INVALID_PATH", "A file path is required.");
  }
  if (trimmed.length > MAX_PATH_CHARS) throw new WorkspaceError("INVALID_PATH", "That path is too long.");
  if (/[\u0000-\u001f\u007f\\]/.test(trimmed) || trimmed.startsWith("/") || /^[a-z]:/i.test(trimmed)) {
    throw new WorkspaceError("INVALID_PATH", "That path is not allowed. Use a simple name like notes/draft.md.");
  }
  const segments = trimmed.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === ".." || segment.length > MAX_SEGMENT_CHARS) {
      throw new WorkspaceError("INVALID_PATH", "That path is not allowed. Use a simple name like notes/draft.md.");
    }
    if (segment.toLowerCase() === MARKER_DIR) {
      throw new WorkspaceError("INVALID_PATH", `${MARKER_DIR} is reserved for VYXO and cannot be used.`);
    }
    if (segment !== segment.trim() || segment.endsWith(".")) {
      throw new WorkspaceError("INVALID_PATH", "Names cannot start or end with spaces, or end with a dot.");
    }
  }
  return segments.join("/");
}

/** The real, absolute workspace folder. Fails if it is missing or not an ordinary folder. */
export async function openWorkspace(folder: string | null | undefined): Promise<string> {
  if (!folder) throw new WorkspaceError("NOT_A_WORKSPACE", "This project has no workspace folder.");
  try {
    const info = await lstat(folder);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new WorkspaceError("UNSAFE", "The workspace folder is not a normal folder.");
    }
    return await realpath(folder);
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    if (isErrno(error, "ENOENT")) {
      throw new WorkspaceError("NOT_FOUND", "The workspace folder is missing. It may have been moved or deleted outside VYXO.");
    }
    throw new WorkspaceError("STORAGE_IO", "The workspace folder cannot be read.");
  }
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

/** Resolve an existing path and prove it is a real file or folder inside the workspace. */
async function resolveExisting(root: string, relative: string): Promise<{ absolute: string; isDirectory: boolean }> {
  const absolute = join(root, relative);
  let info;
  try {
    info = await lstat(absolute);
  } catch (error) {
    if (isErrno(error, "ENOENT") || isErrno(error, "ENOTDIR")) throw new WorkspaceError("NOT_FOUND", `${relative} was not found.`);
    throw new WorkspaceError("STORAGE_IO", "That file could not be read.");
  }
  if (info.isSymbolicLink()) throw new WorkspaceError("UNSAFE", `${relative} is a link, which VYXO will not follow.`);
  const real = await realpath(absolute);
  if (!isInside(root, real) || real === root) throw new WorkspaceError("UNSAFE", `${relative} is outside the workspace.`);
  return { absolute: real, isDirectory: info.isDirectory() };
}

/** Make sure every folder on the way to `relative` exists, is real, and is inside the workspace. */
async function ensureParentFolders(root: string, relative: string): Promise<string> {
  const segments = relative.split("/").slice(0, -1);
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new WorkspaceError("UNSAFE", "Part of that path is a file or a link, so it cannot be used as a folder.");
      }
    } catch (error) {
      if (error instanceof WorkspaceError) throw error;
      if (!isErrno(error, "ENOENT")) throw new WorkspaceError("STORAGE_IO", "That folder could not be prepared.");
      try {
        await mkdir(current, { mode: DIR_MODE });
      } catch {
        throw new WorkspaceError("STORAGE_IO", "That folder could not be created.");
      }
    }
    if (!isInside(root, await realpath(current))) throw new WorkspaceError("UNSAFE", "That path leaves the workspace.");
  }
  return join(root, relative);
}

async function exists(absolute: string): Promise<boolean> {
  try {
    await lstat(absolute);
    return true;
  } catch {
    return false;
  }
}

async function writeNewFile(absolute: string, data: string | Uint8Array): Promise<void> {
  let handle;
  try {
    handle = await open(absolute, "wx", FILE_MODE);
  } catch (error) {
    if (isErrno(error, "EEXIST")) throw new WorkspaceError("EXISTS", "A file with that name already exists.");
    throw new WorkspaceError("STORAGE_IO", "The file could not be created.");
  }
  try {
    await handle.writeFile(data);
    await handle.sync();
  } catch {
    await handle.close().catch(() => undefined);
    await rm(absolute, { force: true }).catch(() => undefined);
    throw new WorkspaceError("STORAGE_IO", "The file could not be written.");
  }
  await handle.close();
}

export async function createFile(folder: string, relativePath: unknown, content = ""): Promise<{ path: string }> {
  const root = await openWorkspace(folder);
  const relative = cleanRelativePath(relativePath);
  if (content.length > MAX_UPLOAD_FILE_BYTES) throw new WorkspaceError("TOO_LARGE", "That file is too large.");
  const absolute = await ensureParentFolders(root, relative);
  await writeNewFile(absolute, content);
  return { path: relative };
}

export async function createFolder(folder: string, relativePath: unknown): Promise<{ path: string }> {
  const root = await openWorkspace(folder);
  const relative = cleanRelativePath(relativePath);
  const absolute = await ensureParentFolders(root, relative);
  try {
    await mkdir(absolute, { mode: DIR_MODE });
  } catch (error) {
    if (isErrno(error, "EEXIST")) throw new WorkspaceError("EXISTS", "Something with that name already exists.");
    throw new WorkspaceError("STORAGE_IO", "The folder could not be created.");
  }
  return { path: relative };
}

/** Rename or move a file or folder. Never overwrites, and a folder cannot be moved into itself. */
export async function renameEntry(folder: string, fromPath: unknown, toPath: unknown): Promise<{ path: string }> {
  const root = await openWorkspace(folder);
  const from = cleanRelativePath(fromPath);
  const to = cleanRelativePath(toPath);
  if (from === to) return { path: to };
  const source = await resolveExisting(root, from);
  if (source.isDirectory && (to === from || to.startsWith(`${from}/`))) {
    throw new WorkspaceError("INVALID_PATH", "A folder cannot be moved into itself.");
  }
  const target = await ensureParentFolders(root, to);
  if (await exists(target)) {
    // A case-only rename on a case-insensitive disk "exists" as the same entry.
    const sameEntry = from.toLowerCase() === to.toLowerCase();
    if (!sameEntry) throw new WorkspaceError("EXISTS", `${to} already exists.`);
  }
  try {
    await rename(source.absolute, target);
  } catch {
    throw new WorkspaceError("STORAGE_IO", "That could not be renamed.");
  }
  return { path: to };
}

export interface TrashEntry {
  id: string;
  name: string;
  originalPath: string;
  kind: "file" | "directory";
  trashedAt: string;
}

interface TrashMeta extends TrashEntry {
  version: 1;
}

function trashId(now: Date): string {
  return `${now.getTime().toString(36)}-${randomBytes(3).toString("hex")}`;
}

/** Move a file or folder to the workspace trash. Nothing is deleted, and it can be restored. */
export async function trashEntry(folder: string, relativePath: unknown, now: () => Date = () => new Date()): Promise<TrashEntry> {
  const root = await openWorkspace(folder);
  const relative = cleanRelativePath(relativePath);
  const source = await resolveExisting(root, relative);

  const existing = await listTrash(folder).catch(() => []);
  if (existing.length >= MAX_TRASH_ENTRIES) {
    throw new WorkspaceError("LIMIT_EXCEEDED", "The trash is full. Empty it first.");
  }

  const when = now();
  const id = trashId(when);
  const slot = join(root, TRASH_DIR, id);
  try {
    await mkdir(slot, { recursive: true, mode: DIR_MODE });
    await rename(source.absolute, join(slot, "item"));
    const meta: TrashMeta = {
      version: 1,
      id,
      name: basename(relative),
      originalPath: relative,
      kind: source.isDirectory ? "directory" : "file",
      trashedAt: when.toISOString(),
    };
    const handle = await open(join(slot, "meta.json"), "wx", FILE_MODE);
    await handle.writeFile(`${JSON.stringify(meta, null, 2)}\n`);
    await handle.close();
    return meta;
  } catch {
    // Put it back if the move happened but the note could not be written.
    if (await exists(join(slot, "item"))) await rename(join(slot, "item"), source.absolute).catch(() => undefined);
    await rm(slot, { recursive: true, force: true }).catch(() => undefined);
    throw new WorkspaceError("STORAGE_IO", "That could not be moved to the trash.");
  }
}

function validTrashId(id: unknown): id is string {
  return typeof id === "string" && /^[a-z0-9]+-[a-f0-9]{6}$/.test(id);
}

export async function listTrash(folder: string): Promise<TrashEntry[]> {
  const root = await openWorkspace(folder);
  let names: string[];
  try {
    names = await readdir(join(root, TRASH_DIR));
  } catch {
    return [];
  }
  const entries: TrashEntry[] = [];
  for (const name of names) {
    if (!validTrashId(name)) continue;
    try {
      const meta = JSON.parse(await readFile(join(root, TRASH_DIR, name, "meta.json"), "utf8")) as Partial<TrashMeta>;
      if (
        meta.version === 1 &&
        meta.id === name &&
        typeof meta.name === "string" &&
        typeof meta.originalPath === "string" &&
        (meta.kind === "file" || meta.kind === "directory") &&
        typeof meta.trashedAt === "string"
      ) {
        entries.push({ id: meta.id, name: meta.name, originalPath: meta.originalPath, kind: meta.kind, trashedAt: meta.trashedAt });
      }
    } catch {
      // A trash folder without readable notes is ignored, never guessed at.
    }
  }
  return entries.sort((a, b) => b.trashedAt.localeCompare(a.trashedAt));
}

/** Put a trashed item back where it was, or beside it under a new name if that place is taken. */
export async function restoreEntry(folder: string, id: unknown): Promise<{ path: string; renamed: boolean }> {
  const root = await openWorkspace(folder);
  if (!validTrashId(id)) throw new WorkspaceError("INVALID_PATH", "That trash item is not valid.");
  const entry = (await listTrash(folder)).find((candidate) => candidate.id === id);
  if (!entry) throw new WorkspaceError("NOT_FOUND", "That item is no longer in the trash.");

  const originalPath = cleanRelativePath(entry.originalPath);
  let destination = originalPath;
  let renamed = false;
  const extension = entry.kind === "file" ? extname(originalPath) : "";
  const stem = extension ? originalPath.slice(0, -extension.length) : originalPath;
  for (let attempt = 1; ; attempt += 1) {
    const absolute = await ensureParentFolders(root, destination);
    if (!(await exists(absolute))) break;
    if (attempt > 50) throw new WorkspaceError("LIMIT_EXCEEDED", "Could not find a free name to restore it under.");
    destination = `${stem} (restored${attempt > 1 ? ` ${attempt}` : ""})${extension}`;
    renamed = true;
  }

  const slot = join(root, TRASH_DIR, id);
  try {
    await rename(join(slot, "item"), join(root, destination));
  } catch {
    throw new WorkspaceError("STORAGE_IO", "That could not be restored.");
  }
  await rm(slot, { recursive: true, force: true }).catch(() => undefined);
  return { path: destination, renamed };
}

/** Permanently delete everything in the trash. */
export async function emptyTrash(folder: string): Promise<{ removed: number }> {
  const root = await openWorkspace(folder);
  const trash = join(root, TRASH_DIR);
  let names: string[];
  try {
    names = await readdir(trash);
  } catch {
    return { removed: 0 };
  }
  let removed = 0;
  for (const name of names) {
    if (!validTrashId(name)) continue;
    await rm(join(trash, name), { recursive: true, force: true });
    removed += 1;
  }
  return { removed };
}

export interface UploadedFile {
  name: string;
  data: Uint8Array;
}

/** A single safe file name taken from whatever the browser says the file is called. */
export function cleanUploadName(raw: string): string {
  const base = basename(raw.replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/\.+$/g, "");
  const name = base.slice(0, MAX_SEGMENT_CHARS);
  if (name.length === 0 || name === "." || name === ".." || name.toLowerCase() === MARKER_DIR) {
    throw new WorkspaceError("INVALID_PATH", "One of the files has a name that cannot be used.");
  }
  return name;
}

/** Add files from the user's computer. Existing files are never overwritten; a copy gets a number. */
export async function importFiles(
  folder: string,
  destinationFolder: unknown,
  files: UploadedFile[],
): Promise<{ added: { name: string; path: string; size: number }[] }> {
  const root = await openWorkspace(folder);
  const directory = cleanRelativePath(destinationFolder ?? "", { allowEmpty: true });
  if (files.length === 0) throw new WorkspaceError("INVALID_PATH", "No files were provided.");
  if (files.length > MAX_UPLOAD_FILES) throw new WorkspaceError("LIMIT_EXCEEDED", `Add at most ${MAX_UPLOAD_FILES} files at a time.`);

  let total = 0;
  for (const file of files) {
    if (file.data.byteLength > MAX_UPLOAD_FILE_BYTES) {
      throw new WorkspaceError("TOO_LARGE", `${file.name} is larger than ${MAX_UPLOAD_FILE_BYTES / (1024 * 1024)} MB.`);
    }
    total += file.data.byteLength;
  }
  if (total > MAX_UPLOAD_TOTAL_BYTES) throw new WorkspaceError("TOO_LARGE", "Those files are too large to add together.");
  if ((await countFiles(root)) + files.length > MAX_WORKSPACE_FILES) {
    throw new WorkspaceError("LIMIT_EXCEEDED", "This project has reached its file limit.");
  }

  const added: { name: string; path: string; size: number }[] = [];
  for (const file of files) {
    const name = cleanUploadName(file.name);
    const extension = extname(name);
    const stem = extension ? name.slice(0, -extension.length) : name;
    for (let attempt = 1; attempt <= 200; attempt += 1) {
      const candidate = attempt === 1 ? name : `${stem} (${attempt})${extension}`;
      const relative = cleanRelativePath(directory ? `${directory}/${candidate}` : candidate);
      const absolute = await ensureParentFolders(root, relative);
      try {
        await writeNewFile(absolute, file.data);
        added.push({ name: candidate, path: relative, size: file.data.byteLength });
        break;
      } catch (error) {
        if (error instanceof WorkspaceError && error.code === "EXISTS" && attempt < 200) continue;
        throw error;
      }
    }
  }
  return { added };
}

/** Count the user's files (not VYXO's bookkeeping), stopping early once the limit is passed. */
export async function countFiles(root: string): Promise<number> {
  let count = 0;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (current === root && entry.name === MARKER_DIR) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) pending.push(join(current, entry.name));
      else if (entry.isFile()) {
        count += 1;
        if (count > MAX_WORKSPACE_FILES * 2) return count;
      }
    }
  }
  return count;
}

export interface WorkspaceFileRecord {
  path: string;
  size: number;
  modified: Date;
}

/** Every real file in the workspace except VYXO's bookkeeping. Links are skipped. */
/** Next.js keeps its build cache in `.next`; a Next.js site's built pages are in `out`. Neither is the user's work. */
async function generatedRootFolders(root: string): Promise<Set<string>> {
  const generated = new Set([".next"]);
  try {
    await access(join(root, "next.config.mjs"));
    generated.add(SITE_OUTPUT_DIR);
  } catch {
    // Not a Next.js site, so `out` belongs to the user.
  }
  return generated;
}

export async function listAllFiles(
  folder: string,
  limits: { maxFiles?: number; maxBytes?: number } = {},
): Promise<WorkspaceFileRecord[]> {
  const root = await openWorkspace(folder);
  const maxFiles = limits.maxFiles ?? MAX_WORKSPACE_FILES;
  const maxBytes = limits.maxBytes ?? 300 * 1024 * 1024;
  const files: WorkspaceFileRecord[] = [];
  let bytes = 0;
  const generated = await generatedRootFolders(root);

  const visit = async (directory: string, prefix: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!prefix && entry.name === MARKER_DIR) continue;
      if (!prefix && entry.isDirectory() && generated.has(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await visit(join(directory, entry.name), relative);
      } else if (entry.isFile()) {
        const info = await stat(join(directory, entry.name));
        bytes += info.size;
        if (files.length + 1 > maxFiles) throw new WorkspaceError("LIMIT_EXCEEDED", "This project has too many files to export.");
        if (bytes > maxBytes) throw new WorkspaceError("TOO_LARGE", "This project is too large to export in one piece.");
        files.push({ path: relative, size: info.size, modified: info.mtime });
      }
    }
  };
  await visit(root, "");
  return files;
}

/** The first `maxFiles` files, top folders first, without failing on big projects. For showing the assistant what exists. */
export async function listFilesLimited(
  folder: string,
  maxFiles: number,
): Promise<{ files: WorkspaceFileRecord[]; truncated: boolean }> {
  const root = await openWorkspace(folder);
  const files: WorkspaceFileRecord[] = [];
  let truncated = false;
  const queue: { directory: string; prefix: string }[] = [{ directory: root, prefix: "" }];

  while (queue.length > 0 && !truncated) {
    const { directory, prefix } = queue.shift() as { directory: string; prefix: string };
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!prefix && entry.name === MARKER_DIR) continue;
      if (entry.isSymbolicLink()) continue;
      // Folders the assistant may never read (build output, caches, packages) must not use up the file limit.
      if (entry.isDirectory() && isExcludedProjectDirectory(relative)) continue;
      if (entry.isDirectory()) {
        queue.push({ directory: join(directory, entry.name), prefix: relative });
      } else if (entry.isFile()) {
        if (files.length >= maxFiles) {
          truncated = true;
          break;
        }
        try {
          const info = await stat(join(directory, entry.name));
          files.push({ path: relative, size: info.size, modified: info.mtime });
        } catch {
          // The file vanished while listing; skip it.
        }
      }
    }
  }
  return { files, truncated };
}

export async function readWorkspaceFile(folder: string, relativePath: unknown): Promise<Buffer> {
  const root = await openWorkspace(folder);
  const relative = cleanRelativePath(relativePath);
  const target = await resolveExisting(root, relative);
  if (target.isDirectory) throw new WorkspaceError("INVALID_PATH", `${relative} is a folder.`);
  try {
    return await readFile(target.absolute);
  } catch {
    throw new WorkspaceError("STORAGE_IO", "That file could not be read.");
  }
}

