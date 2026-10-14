import {
  PROJECT_FILE_READ_TIMEOUT_MS,
  PROJECT_MAX_CONTEXT_CHARS,
  PROJECT_MAX_DIRECTORY_DEPTH,
  PROJECT_MAX_TOTAL_READ_MS,
  PROJECT_MAX_SELECTED_FILES,
  PROJECT_MAX_FILE_BYTES,
  classifyProjectFilePath,
  containsBinaryBytes,
  containsLikelySecret,
  isExcludedProjectDirectory,
  isSafeRelativeProjectPath,
  validateAndBuildProjectContext,
  type ProjectFilePayload,
} from "./policy.ts";

export interface ReadPermissionHandle {
  queryPermission?: (descriptor: { mode: "read" }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: "read" }) => Promise<PermissionState>;
}

export interface ProjectFileObject {
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ProjectFileHandle extends ReadPermissionHandle {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<ProjectFileObject>;
}

export interface ProjectDirectoryHandle extends ReadPermissionHandle {
  readonly kind: "directory";
  readonly name: string;
  entries(): AsyncIterable<[string, unknown]>;
}

export interface SelectedProjectFile {
  path: string;
  handle: ProjectFileHandle;
}

interface ProjectTreeEntryBase {
  name: string;
  path: string;
  depth: number;
}

export type ProjectTreeEntry =
  | (ProjectTreeEntryBase & {
      kind: "directory";
      depthLimited: boolean;
      handle: ProjectDirectoryHandle;
    })
  | (ProjectTreeEntryBase & {
      kind: "file";
      fileStatus: "allowed" | "unsupported" | "sensitive";
      fileType: string;
      handle: ProjectFileHandle;
    });

export interface DirectoryEntryBudget {
  remaining: number;
}

export interface DirectoryListing {
  entries: ProjectTreeEntry[];
  truncated: boolean;
}

export type ProjectFileReadResult =
  | { ok: true; files: ProjectFilePayload[] }
  | { ok: false; error: string };

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options: {
    mode: "read";
  }) => Promise<ProjectDirectoryHandle>;
}

function isFileHandle(value: unknown): value is ProjectFileHandle {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "file" &&
    "name" in value &&
    typeof value.name === "string" &&
    "getFile" in value &&
    typeof value.getFile === "function"
  );
}

function isDirectoryHandle(value: unknown): value is ProjectDirectoryHandle {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "directory" &&
    "name" in value &&
    typeof value.name === "string" &&
    "entries" in value &&
    typeof value.entries === "function"
  );
}

export function supportsProjectFolderPicker(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function"
  );
}

export async function chooseProjectFolder(): Promise<ProjectDirectoryHandle> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) {
    throw new Error(
      "Folder access is unavailable in this browser. Try a current version of Chrome or Edge.",
    );
  }
  return picker.call(window, { mode: "read" });
}

function fileTypeFromName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toUpperCase() : "TEXT";
}

export async function listProjectDirectory(
  directory: ProjectDirectoryHandle,
  parentPath: string,
  parentDepth: number,
  budget: DirectoryEntryBudget,
): Promise<DirectoryListing> {
  const entries: ProjectTreeEntry[] = [];
  let truncated = false;

  for await (const [name, handle] of directory.entries()) {
    if (budget.remaining <= 0) {
      truncated = true;
      break;
    }
    budget.remaining -= 1;

    if (
      typeof name !== "string" ||
      name.length === 0 ||
      name.includes("/") ||
      name.includes("\\") ||
      name.includes("\0")
    ) {
      continue;
    }

    const path = parentPath ? `${parentPath}/${name}` : name;
    if (!isSafeRelativeProjectPath(path)) continue;

    if (isDirectoryHandle(handle)) {
      if (handle.name !== name) continue;
      if (isExcludedProjectDirectory(path)) continue;
      const depth = parentDepth + 1;
      entries.push({
        name,
        path,
        kind: "directory",
        depth,
        depthLimited: depth >= PROJECT_MAX_DIRECTORY_DEPTH,
        handle,
      });
      continue;
    }

    if (isFileHandle(handle)) {
      if (handle.name !== name) continue;
      const fileStatus = classifyProjectFilePath(path);
      if (fileStatus === "unsafe") continue;
      entries.push({
        name,
        path,
        kind: "file",
        depth: parentDepth + 1,
        fileStatus,
        fileType: fileTypeFromName(name),
        handle,
      });
    }
    // Unknown handle kinds (including a symbolic-link-like handle) are ignored.
  }

  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return { entries, truncated };
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Project file read timed out.")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function ensureReadPermission(handle: ReadPermissionHandle): Promise<void> {
  if (!handle.queryPermission) return;

  let permission = await handle.queryPermission({ mode: "read" });
  if (permission === "prompt" && handle.requestPermission) {
    permission = await handle.requestPermission({ mode: "read" });
  }
  if (permission !== "granted") {
    throw new Error("Project read permission is unavailable.");
  }
}

export async function readSelectedProjectFiles(
  selected: readonly SelectedProjectFile[],
): Promise<ProjectFileReadResult> {
  if (selected.length > PROJECT_MAX_SELECTED_FILES) {
    return {
      ok: false,
      error: `Select no more than ${PROJECT_MAX_SELECTED_FILES} project files.`,
    };
  }

  const startedAt = Date.now();
  const payloads: ProjectFilePayload[] = [];

  for (const selection of selected) {
    if (
      classifyProjectFilePath(selection.path) !== "allowed" ||
      !isSafeRelativeProjectPath(selection.path) ||
      !isFileHandle(selection.handle) ||
      selection.handle.name !== selection.path.split("/").at(-1)
    ) {
      return {
        ok: false,
        error: "A selected project file is no longer available or is not allowed.",
      };
    }

    const fileStartedAt = Date.now();
    const remainingTime = () =>
      Math.min(
        PROJECT_FILE_READ_TIMEOUT_MS - (Date.now() - fileStartedAt),
        PROJECT_MAX_TOTAL_READ_MS - (Date.now() - startedAt),
      );
    if (remainingTime() <= 0) {
      return {
        ok: false,
        error: "Reading the selected files took too long. Select fewer files and try again.",
      };
    }

    try {
      await withTimeout(
        ensureReadPermission(selection.handle),
        remainingTime(),
      );
      const file = await withTimeout(
        selection.handle.getFile(),
        remainingTime(),
      );
      if (
        !Number.isFinite(file.size) ||
        file.size > PROJECT_MAX_FILE_BYTES
      ) {
        return {
          ok: false,
          error: "A selected project file is too large to include.",
        };
      }

      const bytes = new Uint8Array(
        await withTimeout(file.arrayBuffer(), remainingTime()),
      );
      if (
        bytes.byteLength > PROJECT_MAX_FILE_BYTES ||
        bytes.byteLength !== file.size
      ) {
        return {
          ok: false,
          error: "A selected project file is too large to include.",
        };
      }
      if (containsBinaryBytes(bytes)) {
        return {
          ok: false,
          error: "A selected project file appears to be binary and was not included.",
        };
      }

      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return {
          ok: false,
          error: "A selected project file is not readable as plain text.",
        };
      }

      if (containsLikelySecret(content)) {
        return {
          ok: false,
          error: "A selected project file may contain credentials and was not sent.",
        };
      }
      payloads.push({ path: selection.path, content });
    } catch (caught) {
      if (
        caught instanceof Error &&
        caught.message === "Project file read timed out."
      ) {
        return {
          ok: false,
          error: "Reading the selected files took too long. Select fewer files and try again.",
        };
      }
      return {
        ok: false,
        error:
          "Could not read a selected file. Check its read permission and whether it is still available, then try again.",
      };
    }
  }

  const validated = validateAndBuildProjectContext(payloads);
  if (!validated.ok) return validated;
  if (validated.context && validated.context.length > PROJECT_MAX_CONTEXT_CHARS) {
    return {
      ok: false,
      error: "The selected files exceed the project context limit. Remove some files and try again.",
    };
  }

  return { ok: true, files: validated.files };
}
