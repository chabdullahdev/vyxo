import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import {
  classifyProjectFilePath,
  containsBinaryBytes,
  containsLikelySecret,
  isExcludedProjectDirectory,
  isSafeRelativeProjectPath,
} from "../project/policy.ts";
import {
  FILES_MAX_LISTING_ENTRIES,
  FILES_MAX_QUERY_CHARS,
  FILES_MAX_READ_BYTES,
  FILES_MAX_RELATIVE_PATH_CHARS,
  FILES_MAX_SEARCH_FILE_BYTES,
  FILES_MAX_SEARCH_FILES,
  FILES_MAX_SEARCH_RESULTS,
  FILES_MAX_SNIPPET_CHARS,
  isForbiddenRoot,
  isPathInsideRoot,
} from "./policy.ts";

export type ProjectFileErrorCode =
  | "INVALID_FOLDER"
  | "INVALID_PATH"
  | "OUTSIDE_FOLDER"
  | "NOT_FOUND"
  | "NOT_A_FILE"
  | "NOT_A_DIRECTORY"
  | "SYMLINK"
  | "UNSUPPORTED_TYPE"
  | "SENSITIVE"
  | "BINARY"
  | "TOO_LARGE"
  | "UNREADABLE"
  | "LIMIT_EXCEEDED";

export class ProjectFileError extends Error {
  readonly code: ProjectFileErrorCode;

  constructor(code: ProjectFileErrorCode, message: string) {
    super(message);
    this.name = "ProjectFileError";
    this.code = code;
  }
}

export interface AuthorizedFolder {
  root: string;
  name: string;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  kind: "directory" | "file" | "symlink";
  status: "allowed" | "unsupported" | "sensitive";
}

export interface DirectoryListing {
  path: string;
  entries: DirectoryEntry[];
  truncated: boolean;
}

export interface FileContent {
  path: string;
  content: string;
  size: number;
}

export interface SearchHit {
  path: string;
  line: number;
  preview: string;
}

export interface SearchResults {
  query: string;
  hits: SearchHit[];
  truncated: boolean;
}

export interface WriteTarget {
  root: string;
  relativePath: string;
  absolutePath: string;
  exists: boolean;
}

export interface ExistingFile {
  root: string;
  relativePath: string;
  absolutePath: string;
  content: string;
  sha256: string;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === code
  );
}

export class ProjectFileService {
  async inspectFolder(folderPath: string): Promise<AuthorizedFolder> {
    if (typeof folderPath !== "string" || folderPath.trim().length === 0) {
      throw new ProjectFileError("INVALID_FOLDER", "A folder path is required.");
    }
    const candidate = folderPath.trim();

    let resolved: string;
    try {
      resolved = await realpath(candidate);
    } catch {
      throw new ProjectFileError("INVALID_FOLDER", "That folder does not exist or cannot be read.");
    }

    let info;
    try {
      info = await stat(resolved);
    } catch {
      throw new ProjectFileError("INVALID_FOLDER", "That folder cannot be read.");
    }
    if (!info.isDirectory()) {
      throw new ProjectFileError("INVALID_FOLDER", "The selected path is not a folder.");
    }
    if (isForbiddenRoot(resolved)) {
      throw new ProjectFileError("INVALID_FOLDER", "That location is not allowed. Choose a project folder inside your home directory.");
    }

    return { root: resolved, name: basename(resolved) || resolved };
  }

  async listDirectory(folderPath: string, relativePath = ""): Promise<DirectoryListing> {
    const { root } = await this.inspectFolder(folderPath);
    const rel = this.normalizeRelativePath(relativePath);

    const target = rel.length === 0 ? root : join(root, rel);
    const resolved = await this.#resolveInside(root, target);

    let info;
    try {
      info = await stat(resolved);
    } catch {
      throw new ProjectFileError("UNREADABLE", "That folder cannot be read.");
    }
    if (!info.isDirectory()) {
      throw new ProjectFileError("NOT_A_DIRECTORY", "That path is not a folder.");
    }

    let dirents;
    try {
      dirents = await readdir(resolved, { withFileTypes: true });
    } catch {
      throw new ProjectFileError("UNREADABLE", "That folder cannot be read.");
    }

    const entries: DirectoryEntry[] = [];
    let truncated = false;

    for (const dirent of dirents) {
      if (entries.length >= FILES_MAX_LISTING_ENTRIES) {
        truncated = true;
        break;
      }
      const entryRel = rel.length === 0 ? dirent.name : `${rel}/${dirent.name}`;
      if (entryRel.length > FILES_MAX_RELATIVE_PATH_CHARS) continue;
      if (!isSafeRelativeProjectPath(entryRel)) continue;

      if (dirent.isSymbolicLink()) {
        entries.push({ name: dirent.name, path: entryRel, kind: "symlink", status: "unsupported" });
        continue;
      }
      if (dirent.isDirectory()) {
        if (isExcludedProjectDirectory(entryRel)) continue;
        entries.push({ name: dirent.name, path: entryRel, kind: "directory", status: "allowed" });
        continue;
      }
      if (dirent.isFile()) {
        const status = classifyProjectFilePath(entryRel);
        entries.push({
          name: dirent.name,
          path: entryRel,
          kind: "file",
          status: status === "allowed" ? "allowed" : status === "sensitive" ? "sensitive" : "unsupported",
        });
      }
    }

    entries.sort((a, b) => {
      if (a.kind !== b.kind) {
        if (a.kind === "directory") return -1;
        if (b.kind === "directory") return 1;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    return { path: rel, entries, truncated };
  }

  async readTextFile(folderPath: string, relativePath: string): Promise<FileContent> {
    const { root } = await this.inspectFolder(folderPath);
    const rel = this.normalizeRelativePath(relativePath);
    if (rel.length === 0) {
      throw new ProjectFileError("NOT_A_FILE", "A file path is required.");
    }

    const status = classifyProjectFilePath(rel);
    if (status === "unsafe") {
      throw new ProjectFileError("INVALID_PATH", "That path is not allowed.");
    }
    if (status === "sensitive") {
      throw new ProjectFileError("SENSITIVE", "That file type may contain private data and is not readable here.");
    }
    if (status !== "allowed") {
      throw new ProjectFileError("UNSUPPORTED_TYPE", "That file type is not supported.");
    }

    const target = join(root, rel);
    const content = await this.#readSafeFile(root, rel, target);
    return { path: rel, content: content.toString("utf8"), size: content.byteLength };
  }

  async search(folderPath: string, query: string): Promise<SearchResults> {
    const { root } = await this.inspectFolder(folderPath);
    if (typeof query !== "string") {
      throw new ProjectFileError("INVALID_PATH", "A search query is required.");
    }
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return { query: "", hits: [], truncated: false };
    if (needle.length > FILES_MAX_QUERY_CHARS) {
      throw new ProjectFileError("LIMIT_EXCEEDED", "The search query is too long.");
    }

    const hits: SearchHit[] = [];
    let filesScanned = 0;
    let truncated = false;
    const queue: string[] = [""];

    while (queue.length > 0) {
      const dirRel = queue.shift() as string;
      const dirAbs = dirRel.length === 0 ? root : join(root, dirRel);

      let dirents;
      try {
        dirents = await readdir(dirAbs, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const dirent of dirents) {
        if (hits.length >= FILES_MAX_SEARCH_RESULTS) {
          truncated = true;
          break;
        }
        const entryRel = dirRel.length === 0 ? dirent.name : `${dirRel}/${dirent.name}`;
        if (entryRel.length > FILES_MAX_RELATIVE_PATH_CHARS) continue;
        if (!isSafeRelativeProjectPath(entryRel)) continue;

        if (dirent.isDirectory()) {
          if (isExcludedProjectDirectory(entryRel)) continue;
          queue.push(entryRel);
          continue;
        }
        if (!dirent.isFile()) continue;
        if (classifyProjectFilePath(entryRel) !== "allowed") continue;
        if (filesScanned >= FILES_MAX_SEARCH_FILES) {
          truncated = true;
          break;
        }
        filesScanned += 1;

        if (dirent.name.toLowerCase().includes(needle) && hits.length < FILES_MAX_SEARCH_RESULTS) {
          hits.push({ path: entryRel, line: 0, preview: dirent.name });
        }

        let bytes;
        try {
          bytes = await this.#readSafeFile(root, entryRel, join(root, entryRel));
        } catch {
          continue;
        }
        if (bytes.byteLength > FILES_MAX_SEARCH_FILE_BYTES) continue;

        const text = bytes.toString("utf8");
        const lines = text.split("\n");
        for (let index = 0; index < lines.length; index += 1) {
          if (hits.length >= FILES_MAX_SEARCH_RESULTS) {
            truncated = true;
            break;
          }
          if (lines[index].toLowerCase().includes(needle)) {
            hits.push({
              path: entryRel,
              line: index + 1,
              preview: lines[index].trim().slice(0, FILES_MAX_SNIPPET_CHARS),
            });
          }
        }
      }

      if (hits.length >= FILES_MAX_SEARCH_RESULTS) break;
    }

    return { query: needle, hits, truncated };
  }

  async prepareWriteTarget(folderPath: string, relativePath: string): Promise<WriteTarget> {
    const { root } = await this.inspectFolder(folderPath);
    const rel = this.normalizeRelativePath(relativePath);
    if (rel.length === 0) {
      throw new ProjectFileError("INVALID_PATH", "A file path is required.");
    }

    const status = classifyProjectFilePath(rel);
    if (status === "unsafe") throw new ProjectFileError("INVALID_PATH", "That path is not allowed.");
    if (status === "sensitive") {
      throw new ProjectFileError("SENSITIVE", "That file type may contain private data and cannot be written here.");
    }
    if (status !== "allowed") {
      throw new ProjectFileError("UNSUPPORTED_TYPE", "That file type is not supported.");
    }

    const parent = dirname(rel);
    const parentAbsolute = parent === "." ? root : join(root, parent);
    const resolvedParent = await this.#resolveInside(root, parentAbsolute);
    if (!(await stat(resolvedParent)).isDirectory()) {
      throw new ProjectFileError("NOT_A_DIRECTORY", "The target's parent folder does not exist.");
    }

    const absolutePath = join(root, rel);
    let info;
    try {
      info = await lstat(absolutePath);
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        return { root, relativePath: rel, absolutePath, exists: false };
      }
      throw new ProjectFileError("UNREADABLE", "That path cannot be read.");
    }
    if (info.isSymbolicLink()) {
      throw new ProjectFileError("SYMLINK", "Symbolic links are not written.");
    }
    if (info.isDirectory()) {
      throw new ProjectFileError("NOT_A_FILE", "That path is a folder.");
    }
    if (!info.isFile()) {
      throw new ProjectFileError("UNSUPPORTED_TYPE", "That path is not a regular file.");
    }
    return { root, relativePath: rel, absolutePath, exists: true };
  }

  async readExistingFile(folderPath: string, relativePath: string): Promise<ExistingFile> {
    const target = await this.prepareWriteTarget(folderPath, relativePath);
    if (!target.exists) {
      throw new ProjectFileError("NOT_FOUND", "That file does not exist.");
    }
    const file = await this.readTextFile(folderPath, target.relativePath);
    return {
      root: target.root,
      relativePath: target.relativePath,
      absolutePath: target.absolutePath,
      content: file.content,
      sha256: hashContent(file.content),
    };
  }

  normalizeRelativePath(relativePath: string): string {
    if (typeof relativePath !== "string") {
      throw new ProjectFileError("INVALID_PATH", "A path is required.");
    }
    const trimmed = relativePath.trim();
    if (trimmed.length === 0 || trimmed === "/") return "";
    if (trimmed.length > FILES_MAX_RELATIVE_PATH_CHARS) {
      throw new ProjectFileError("INVALID_PATH", "That path is too long.");
    }
    if (trimmed.startsWith("/")) {
      throw new ProjectFileError("INVALID_PATH", "Paths must be relative to the connected folder.");
    }
    const normalized = trimmed.replace(/^\.\/+/, "").replace(/\/+$/, "");
    if (normalized.length === 0) return "";
    if (!isSafeRelativeProjectPath(normalized)) {
      throw new ProjectFileError("INVALID_PATH", "That path is not allowed.");
    }
    return normalized;
  }

  async #resolveInside(root: string, target: string): Promise<string> {
    let resolved: string;
    try {
      resolved = await realpath(target);
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        throw new ProjectFileError("NOT_FOUND", "That path does not exist.");
      }
      throw new ProjectFileError("UNREADABLE", "That path cannot be read.");
    }
    if (!isPathInsideRoot(root, resolved)) {
      throw new ProjectFileError("OUTSIDE_FOLDER", "That path is outside the connected folder.");
    }
    return resolved;
  }

  async #readSafeFile(root: string, rel: string, target: string): Promise<Buffer> {
    let link;
    try {
      link = await lstat(target);
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        throw new ProjectFileError("NOT_FOUND", "That file does not exist.");
      }
      throw new ProjectFileError("UNREADABLE", "That file cannot be read.");
    }
    if (link.isSymbolicLink()) {
      throw new ProjectFileError("SYMLINK", "Symbolic links are not read.");
    }
    if (!link.isFile()) {
      throw new ProjectFileError("NOT_A_FILE", "That path is not a regular file.");
    }
    if (link.size > FILES_MAX_READ_BYTES) {
      throw new ProjectFileError("TOO_LARGE", "That file is too large to read here.");
    }

    await this.#resolveInside(root, target);

    let handle;
    try {
      handle = await open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    } catch (error) {
      if (isErrno(error, "ELOOP")) {
        throw new ProjectFileError("SYMLINK", "Symbolic links are not read.");
      }
      if (isErrno(error, "ENOENT")) {
        throw new ProjectFileError("NOT_FOUND", "That file no longer exists.");
      }
      throw new ProjectFileError("UNREADABLE", "That file cannot be read.");
    }

    try {
      const info = await handle.stat();
      if (!info.isFile()) {
        throw new ProjectFileError("NOT_A_FILE", "That path is not a regular file.");
      }
      if (info.size > FILES_MAX_READ_BYTES) {
        throw new ProjectFileError("TOO_LARGE", "That file is too large to read here.");
      }
      const buffer = Buffer.alloc(info.size);
      if (info.size > 0) {
        const { bytesRead } = await handle.read(buffer, 0, info.size, 0);
        if (bytesRead !== info.size) {
          throw new ProjectFileError("UNREADABLE", "That file changed while it was being read.");
        }
      }
      if (containsBinaryBytes(buffer)) {
        throw new ProjectFileError("BINARY", "That file appears to be binary and is not read as text.");
      }
      const text = buffer.toString("utf8");
      if (containsLikelySecret(text)) {
        throw new ProjectFileError("SENSITIVE", "That file may contain credentials and was not read.");
      }
      return buffer;
    } finally {
      await handle.close().catch(() => {});
    }
  }
}

export const projectFileService = new ProjectFileService();

export function relativeToRoot(root: string, absolutePath: string): string {
  return relative(root, absolutePath);
}
