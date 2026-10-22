import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rm, symlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { isForbiddenRoot } from "../files/policy.ts";
import type { Project, ProjectStore } from "../projects/store.ts";
import { WorkspaceError, isErrno } from "./errors.ts";
import { getTemplate } from "./templates.ts";

export const MARKER_DIR = ".vyxo";
export const MARKER_PATH = `${MARKER_DIR}/project.json`;
export const MARKER_VERSION = 1;

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_FOLDER_NAME_CHARS = 60;
const MAX_FOLDER_ATTEMPTS = 200;

export interface WorkspaceMarker {
  version: number;
  projectId: string;
  name: string;
  template: string;
  createdAt: string;
}

/** A readable folder name: letters, digits, spaces, dashes, underscores. Never starts with a dot. */
export function folderNameFor(projectName: string): string {
  const cleaned = projectName
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} _-]+/gu, "-")
    .replace(/\s+/g, " ")
    .replace(/-{2,}/g, "-")
    .replace(/^[\s.-]+|[\s.-]+$/g, "")
    .slice(0, MAX_FOLDER_NAME_CHARS)
    .replace(/[\s.-]+$/g, "");
  return cleaned.length > 0 ? cleaned : "Project";
}

async function writeNewFile(path: string, content: string): Promise<void> {
  const handle = await open(path, "wx", FILE_MODE);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Create the next free folder named after the project. `mkdir` without `recursive` fails if it exists. */
async function createUniqueFolder(projectsDir: string, projectName: string): Promise<string> {
  const base = folderNameFor(projectName);
  for (let attempt = 1; attempt <= MAX_FOLDER_ATTEMPTS; attempt += 1) {
    const candidate = join(projectsDir, attempt === 1 ? base : `${base} ${attempt}`);
    try {
      await mkdir(candidate, { mode: DIR_MODE });
      return candidate;
    } catch (error) {
      if (isErrno(error, "EEXIST")) continue;
      throw new WorkspaceError("STORAGE_IO", "Could not create the project folder.");
    }
  }
  throw new WorkspaceError("LIMIT_EXCEEDED", "There are too many folders with that name. Choose a different project name.");
}

export interface CreateManagedProjectInput {
  name: string;
  description?: string;
  template: unknown;
}

export interface CreateManagedProjectDeps {
  store: ProjectStore;
  projectsDir: string;
  /** The folder with the site packages that ship with VYXO. Needed by templates that build a site. */
  siteDepsDir?: string | null;
  now?: () => Date;
  idFactory?: () => string;
}

/**
 * Create a workspace project: a new folder inside the projects directory, filled from a template,
 * plus the project record that points at it. If anything fails, only what this call created is removed.
 */
export async function createManagedProject(
  deps: CreateManagedProjectDeps,
  input: CreateManagedProjectInput,
): Promise<Project> {
  const template = getTemplate(input.template);
  if (!template) throw new WorkspaceError("INVALID_TEMPLATE", "Choose one of the available starting points.");

  const trimmedName = typeof input.name === "string" ? input.name.trim() : "";
  if (trimmedName.length === 0) {
    // Let the store produce its standard message.
    return deps.store.createProject(input.name);
  }

  try {
    await mkdir(deps.projectsDir, { recursive: true, mode: DIR_MODE });
  } catch {
    throw new WorkspaceError("STORAGE_IO", "Could not create the projects folder.");
  }
  let projectsRoot: string;
  try {
    projectsRoot = await realpath(deps.projectsDir);
  } catch {
    throw new WorkspaceError("STORAGE_IO", "The projects folder cannot be read.");
  }
  if (isForbiddenRoot(projectsRoot)) {
    throw new WorkspaceError("UNSAFE", "The projects folder must be inside your home folder.");
  }

  const id = (deps.idFactory ?? randomUUID)();
  const createdAt = (deps.now ?? (() => new Date()))().toISOString();
  const folder = await createUniqueFolder(projectsRoot, trimmedName);

  try {
    const files = template.files(trimmedName);
    const marker: WorkspaceMarker = {
      version: MARKER_VERSION,
      projectId: id,
      name: trimmedName,
      template: template.id,
      createdAt,
    };
    await mkdir(join(folder, MARKER_DIR), { mode: DIR_MODE });
    await writeNewFile(join(folder, MARKER_PATH), `${JSON.stringify(marker, null, 2)}\n`);

    for (const [relativePath, content] of Object.entries(files)) {
      const target = join(folder, relativePath);
      await mkdir(dirname(target), { recursive: true, mode: DIR_MODE });
      await writeNewFile(target, content);
    }

    if (template.needsSiteDeps) {
      if (!deps.siteDepsDir) {
        throw new WorkspaceError("UNSUPPORTED", "The Next.js tools are not included in this build of VYXO.");
      }
      // A link to the packages that ship with VYXO: nothing is copied, and nothing is downloaded.
      // Windows links folders as junctions, which need no administrator rights.
      await symlink(deps.siteDepsDir, join(folder, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    }

    return await deps.store.createProject(trimmedName, input.description, {
      id,
      kind: "managed",
      template: template.id,
      sourceFolder: folder,
    });
  } catch (error) {
    // `folder` was created by this call and is still empty or holds only our files.
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function readMarker(folder: string): Promise<WorkspaceMarker | null> {
  try {
    const parsed = JSON.parse(await readFile(join(folder, MARKER_PATH), "utf8")) as Partial<WorkspaceMarker>;
    if (
      parsed &&
      parsed.version === MARKER_VERSION &&
      typeof parsed.projectId === "string" &&
      typeof parsed.name === "string" &&
      typeof parsed.template === "string" &&
      typeof parsed.createdAt === "string"
    ) {
      return parsed as WorkspaceMarker;
    }
  } catch {
    // missing or unreadable marker
  }
  return null;
}

/**
 * Permanently delete a workspace project's folder. This only ever deletes a folder that sits directly
 * inside the projects directory, is not a link, and carries a marker naming this exact project.
 */
export async function removeWorkspaceFolder(project: Project, projectsDir: string): Promise<void> {
  if (project.kind !== "managed" || !project.sourceFolder) {
    throw new WorkspaceError("NOT_A_WORKSPACE", "This project's files are not managed by VYXO.");
  }

  let root: string;
  let folder: string;
  try {
    root = await realpath(projectsDir);
    const info = await lstat(project.sourceFolder);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new WorkspaceError("UNSAFE", "The project folder is not a normal folder, so it was not deleted.");
    }
    folder = await realpath(project.sourceFolder);
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    if (isErrno(error, "ENOENT")) return; // already gone
    throw new WorkspaceError("STORAGE_IO", "The project folder could not be inspected.");
  }

  if (resolve(dirname(folder)) !== resolve(root) || folder === root || !folder.startsWith(`${root}${sep}`)) {
    throw new WorkspaceError("UNSAFE", "The project folder is outside the projects directory, so it was not deleted.");
  }
  const marker = await readMarker(folder);
  if (!marker || marker.projectId !== project.id) {
    throw new WorkspaceError("UNSAFE", "The project folder does not belong to this project, so it was not deleted.");
  }

  try {
    await rm(folder, { recursive: true, force: true });
  } catch {
    throw new WorkspaceError("STORAGE_IO", "Some files could not be deleted.");
  }
}
