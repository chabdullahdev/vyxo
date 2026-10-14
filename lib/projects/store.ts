import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { DEFAULT_STORAGE_DIR } from "../memory/store.ts";
import {
  createEmptyProjectContext,
  DEFAULT_MAX_PROJECT_CONTEXT_CHARS,
  PROJECT_CONTEXT_FIELD_LIMITS,
  PROJECT_CONTEXT_KEYS,
  type ProjectContext,
} from "./context.ts";

export const PROJECT_SCHEMA_VERSION = 1;

export const DEFAULT_MAX_PROJECT_NAME_LENGTH = 120;
export const DEFAULT_MAX_PROJECT_DESCRIPTION_LENGTH = 2_000;
export const DEFAULT_MAX_PROJECTS = 200;

export const DEFAULT_PROJECT_STORAGE_PATH = join(DEFAULT_STORAGE_DIR, "projects.json");

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_ID_LENGTH = 256;
const MAX_ID_ATTEMPTS = 10;

export interface Project {
  id: string;
  name: string;
  description: string;
  context: ProjectContext;
  sourceFolder: string | null;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

export interface ProjectDocument {
  version: number;
  projects: Project[];
}

export interface ProjectLimits {
  maxNameLength: number;
  maxDescriptionLength: number;
}

export type ProjectErrorCode =
  | "INVALID_NAME"
  | "INVALID_DESCRIPTION"
  | "INVALID_CONTEXT"
  | "INVALID_FOLDER"
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "DUPLICATE_ID"
  | "LIMIT_EXCEEDED"
  | "UNSUPPORTED_VERSION"
  | "CORRUPT_DATA"
  | "STORAGE_IO";

export class ProjectError extends Error {
  readonly code: ProjectErrorCode;

  constructor(code: ProjectErrorCode, message: string) {
    super(message);
    this.name = "ProjectError";
    this.code = code;
  }
}

export interface ProjectStoreOptions {
  filePath?: string;
  clock?: () => Date;
  idFactory?: () => string;
  maxNameLength?: number;
  maxDescriptionLength?: number;
  maxProjects?: number;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  context?: unknown;
}

export interface ListProjectsOptions {
  query?: string;
  archived?: "active" | "archived" | "all";
}

function isErrnoWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === code
  );
}

export function isValidProjectId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    value.trim() === value &&
    !/\s/.test(value)
  );
}

function isValidTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

function normalizeName(value: unknown, maxNameLength: number): string {
  if (typeof value !== "string") {
    throw new ProjectError("INVALID_NAME", "A project name must be text.");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ProjectError("INVALID_NAME", "A project name cannot be empty.");
  }
  if (trimmed.length > maxNameLength) {
    throw new ProjectError(
      "INVALID_NAME",
      `A project name exceeds the maximum length of ${maxNameLength} characters.`,
    );
  }
  return trimmed;
}

function normalizeDescription(value: unknown, maxDescriptionLength: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new ProjectError("INVALID_DESCRIPTION", "A project description must be text.");
  }
  const trimmed = value.trim();
  if (trimmed.length > maxDescriptionLength) {
    throw new ProjectError(
      "INVALID_DESCRIPTION",
      `A project description exceeds the maximum length of ${maxDescriptionLength} characters.`,
    );
  }
  return trimmed;
}

function normalizeProjectContext(
  input: unknown,
  existing: ProjectContext,
  errorCode: "INVALID_CONTEXT" | "CORRUPT_DATA",
): ProjectContext {
  if (input === undefined) return existing;
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ProjectError(errorCode, "Project context must be an object.");
  }

  const record = input as Record<string, unknown>;
  const next: ProjectContext = { ...existing };

  for (const key of PROJECT_CONTEXT_KEYS) {
    if (!(key in record)) continue;
    const value = record[key];
    if (value === undefined || value === null) {
      next[key] = "";
      continue;
    }
    if (typeof value !== "string") {
      throw new ProjectError(errorCode, `\`context.${key}\` must be text.`);
    }
    if (value.length > PROJECT_CONTEXT_FIELD_LIMITS[key]) {
      throw new ProjectError(
        errorCode,
        `\`context.${key}\` exceeds the maximum length of ${PROJECT_CONTEXT_FIELD_LIMITS[key]} characters.`,
      );
    }
    next[key] = value;
  }

  const combined = PROJECT_CONTEXT_KEYS.reduce((sum, key) => sum + next[key].length, 0);
  if (combined > DEFAULT_MAX_PROJECT_CONTEXT_CHARS) {
    throw new ProjectError(
      errorCode,
      `Project context exceeds the maximum combined length of ${DEFAULT_MAX_PROJECT_CONTEXT_CHARS} characters.`,
    );
  }

  return next;
}

const MAX_SOURCE_FOLDER_LENGTH = 4_096;

function normalizeSourceFolder(
  input: unknown,
  errorCode: "INVALID_FOLDER" | "CORRUPT_DATA",
): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== "string") {
    throw new ProjectError(errorCode, "The connected folder must be a path string.");
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_SOURCE_FOLDER_LENGTH) {
    throw new ProjectError(errorCode, "The connected folder path is too long.");
  }
  return trimmed;
}

export function projectMatchesQuery(
  project: Pick<Project, "name" | "description"> & { context?: ProjectContext },
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  if (
    project.name.toLowerCase().includes(needle) ||
    project.description.toLowerCase().includes(needle)
  ) {
    return true;
  }
  if (!project.context) return false;
  return PROJECT_CONTEXT_KEYS.some((key) =>
    project.context?.[key].toLowerCase().includes(needle),
  );
}

export function validateProjectDocument(
  input: unknown,
  limits: ProjectLimits = {
    maxNameLength: DEFAULT_MAX_PROJECT_NAME_LENGTH,
    maxDescriptionLength: DEFAULT_MAX_PROJECT_DESCRIPTION_LENGTH,
  },
): ProjectDocument {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ProjectError("CORRUPT_DATA", "The project file has an invalid structure.");
  }

  const { version, projects } = input as { version?: unknown; projects?: unknown };

  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new ProjectError("CORRUPT_DATA", "The project file is missing a valid schema version.");
  }

  if (version !== PROJECT_SCHEMA_VERSION) {
    throw new ProjectError(
      "UNSUPPORTED_VERSION",
      `Unsupported project schema version ${version}. Expected ${PROJECT_SCHEMA_VERSION}.`,
    );
  }

  if (!Array.isArray(projects)) {
    throw new ProjectError("CORRUPT_DATA", "The project file is missing its project list.");
  }

  const seen = new Set<string>();
  const validated: Project[] = [];

  for (const entry of projects) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new ProjectError("CORRUPT_DATA", "The project file contains an invalid record.");
    }

    const record = entry as {
      id?: unknown;
      name?: unknown;
      description?: unknown;
      context?: unknown;
      sourceFolder?: unknown;
      createdAt?: unknown;
      updatedAt?: unknown;
      archived?: unknown;
    };

    if (!isValidProjectId(record.id)) {
      throw new ProjectError("CORRUPT_DATA", "The project file contains a record with an invalid id.");
    }
    if (seen.has(record.id)) {
      throw new ProjectError("DUPLICATE_ID", `Duplicate project id: ${record.id}`);
    }
    seen.add(record.id);

    let name: string;
    try {
      name = normalizeName(record.name, limits.maxNameLength);
    } catch {
      throw new ProjectError("CORRUPT_DATA", `Project ${record.id} has an invalid name.`);
    }

    let description: string;
    try {
      description = normalizeDescription(record.description, limits.maxDescriptionLength);
    } catch {
      throw new ProjectError("CORRUPT_DATA", `Project ${record.id} has an invalid description.`);
    }

    if (!isValidTimestamp(record.createdAt)) {
      throw new ProjectError("CORRUPT_DATA", `Project ${record.id} has an invalid createdAt timestamp.`);
    }
    if (!isValidTimestamp(record.updatedAt)) {
      throw new ProjectError("CORRUPT_DATA", `Project ${record.id} has an invalid updatedAt timestamp.`);
    }
    if (typeof record.archived !== "boolean") {
      throw new ProjectError("CORRUPT_DATA", `Project ${record.id} has an invalid archived flag.`);
    }

    const context = normalizeProjectContext(
      record.context,
      createEmptyProjectContext(),
      "CORRUPT_DATA",
    );

    const sourceFolder = normalizeSourceFolder(record.sourceFolder, "CORRUPT_DATA");

    validated.push({
      id: record.id,
      name,
      description,
      context,
      sourceFolder,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      archived: record.archived,
    });
  }

  return { version, projects: validated };
}

function cloneProject(project: Project): Project {
  return { ...project, context: { ...project.context } };
}

export class ProjectStore {
  readonly filePath: string;

  readonly #clock: () => Date;
  readonly #idFactory: () => string;
  readonly #maxNameLength: number;
  readonly #maxDescriptionLength: number;
  readonly #maxProjects: number;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: ProjectStoreOptions = {}) {
    this.filePath = options.filePath ?? DEFAULT_PROJECT_STORAGE_PATH;
    this.#clock = options.clock ?? (() => new Date());
    this.#idFactory = options.idFactory ?? (() => randomUUID());
    this.#maxNameLength = options.maxNameLength ?? DEFAULT_MAX_PROJECT_NAME_LENGTH;
    this.#maxDescriptionLength =
      options.maxDescriptionLength ?? DEFAULT_MAX_PROJECT_DESCRIPTION_LENGTH;
    this.#maxProjects = options.maxProjects ?? DEFAULT_MAX_PROJECTS;
  }

  listProjects(options: ListProjectsOptions = {}): Promise<Project[]> {
    return this.#exclusive(async () => {
      const document = await this.#read();
      const archived = options.archived ?? "active";
      const query = options.query ?? "";

      return document.projects
        .filter((project) => {
          if (archived === "active") return !project.archived;
          if (archived === "archived") return project.archived;
          return true;
        })
        .filter((project) => projectMatchesQuery(project, query))
        .map(cloneProject)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    });
  }

  getProject(id: string): Promise<Project> {
    return this.#exclusive(async () => {
      this.#assertId(id);
      const document = await this.#read();
      const found = document.projects.find((project) => project.id === id);
      if (!found) {
        throw new ProjectError("NOT_FOUND", "Project not found.");
      }
      return cloneProject(found);
    });
  }

  createProject(name: string, description?: string): Promise<Project> {
    return this.#exclusive(async () => {
      const normalizedName = normalizeName(name, this.#maxNameLength);
      const normalizedDescription = normalizeDescription(description, this.#maxDescriptionLength);
      const document = await this.#read();
      if (document.projects.length >= this.#maxProjects) {
        throw new ProjectError(
          "LIMIT_EXCEEDED",
          `The project limit of ${this.#maxProjects} has been reached. Delete or archive older projects.`,
        );
      }
      const id = this.#generateId(document);
      const now = this.#clock().toISOString();
      const project: Project = {
        id,
        name: normalizedName,
        description: normalizedDescription,
        context: createEmptyProjectContext(),
        sourceFolder: null,
        createdAt: now,
        updatedAt: now,
        archived: false,
      };
      document.projects.push(project);
      await this.#write(document);
      return cloneProject(project);
    });
  }

  updateProject(id: string, input: UpdateProjectInput): Promise<Project> {
    return this.#exclusive(async () => {
      this.#assertId(id);
      const document = await this.#read();
      const project = document.projects.find((entry) => entry.id === id);
      if (!project) {
        throw new ProjectError("NOT_FOUND", "Project not found.");
      }
      if (input.name !== undefined) {
        project.name = normalizeName(input.name, this.#maxNameLength);
      }
      if (input.description !== undefined) {
        project.description = normalizeDescription(input.description, this.#maxDescriptionLength);
      }
      if (input.context !== undefined) {
        project.context = normalizeProjectContext(input.context, project.context, "INVALID_CONTEXT");
      }
      project.updatedAt = this.#clock().toISOString();
      await this.#write(document);
      return cloneProject(project);
    });
  }

  setProjectArchived(id: string, archived: boolean): Promise<Project> {
    return this.#exclusive(async () => {
      this.#assertId(id);
      if (typeof archived !== "boolean") {
        throw new ProjectError("INVALID_ARGUMENT", "`archived` must be a boolean.");
      }
      const document = await this.#read();
      const project = document.projects.find((entry) => entry.id === id);
      if (!project) {
        throw new ProjectError("NOT_FOUND", "Project not found.");
      }
      project.archived = archived;
      await this.#write(document);
      return cloneProject(project);
    });
  }

  setProjectSourceFolder(id: string, sourceFolder: string | null): Promise<Project> {
    return this.#exclusive(async () => {
      this.#assertId(id);
      const normalized = normalizeSourceFolder(sourceFolder, "INVALID_FOLDER");
      const document = await this.#read();
      const project = document.projects.find((entry) => entry.id === id);
      if (!project) {
        throw new ProjectError("NOT_FOUND", "Project not found.");
      }
      project.sourceFolder = normalized;
      project.updatedAt = this.#clock().toISOString();
      await this.#write(document);
      return cloneProject(project);
    });
  }

  deleteProject(id: string): Promise<boolean> {
    return this.#exclusive(async () => {
      this.#assertId(id);
      const document = await this.#read();
      const remaining = document.projects.filter((project) => project.id !== id);
      if (remaining.length === document.projects.length) {
        return false;
      }
      document.projects = remaining;
      await this.#write(document);
      return true;
    });
  }

  #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(operation, operation);
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  #assertId(id: unknown): asserts id is string {
    if (!isValidProjectId(id)) {
      throw new ProjectError("INVALID_ARGUMENT", "A valid project id is required.");
    }
  }

  #generateId(document: ProjectDocument): string {
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
      const candidate = this.#idFactory();
      if (isValidProjectId(candidate) && !document.projects.some((project) => project.id === candidate)) {
        return candidate;
      }
    }
    throw new ProjectError("DUPLICATE_ID", "Could not generate a unique project id.");
  }

  async #read(): Promise<ProjectDocument> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isErrnoWithCode(error, "ENOENT")) {
        return { version: PROJECT_SCHEMA_VERSION, projects: [] };
      }
      throw new ProjectError("STORAGE_IO", "Could not read the project file.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ProjectError(
        "CORRUPT_DATA",
        "The project file is not valid JSON. It was left unchanged.",
      );
    }

    return validateProjectDocument(parsed, {
      maxNameLength: this.#maxNameLength,
      maxDescriptionLength: this.#maxDescriptionLength,
    });
  }

  async #write(document: ProjectDocument): Promise<void> {
    const validated = validateProjectDocument(document, {
      maxNameLength: this.#maxNameLength,
      maxDescriptionLength: this.#maxDescriptionLength,
    });
    const data = `${JSON.stringify(validated, null, 2)}\n`;
    const directory = dirname(this.filePath);
    const temporaryPath = join(
      directory,
      `.${basename(this.filePath)}.${process.pid}.${randomUUID()}.tmp`,
    );

    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      await mkdir(directory, { recursive: true, mode: DIR_MODE });
      handle = await open(temporaryPath, "wx", FILE_MODE);
      await handle.writeFile(data, "utf8");
      await handle.chmod(FILE_MODE);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, this.filePath);
    } catch {
      if (handle) {
        try {
          await handle.close();
        } catch {
          // ignore cleanup failure
        }
      }
      try {
        await unlink(temporaryPath);
      } catch {
        // ignore cleanup failure
      }
      throw new ProjectError(
        "STORAGE_IO",
        "Could not save project data. Existing data was left unchanged.",
      );
    }
  }
}

export function createProjectStore(options: ProjectStoreOptions = {}): ProjectStore {
  return new ProjectStore(options);
}

export const projectStore = new ProjectStore();
