import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { prepareDataDirectory } from "../storage/location.ts";

export const SCHEMA_VERSION = 1;

export const DEFAULT_MAX_CONTENT_LENGTH = 10_000;

export const DEFAULT_STORAGE_DIR = prepareDataDirectory();

export const DEFAULT_STORAGE_PATH = join(DEFAULT_STORAGE_DIR, "memories.json");

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_ID_LENGTH = 256;
const MAX_ID_ATTEMPTS = 10;

export interface Memory {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryDocument {
  version: number;
  memories: Memory[];
}

export type MemoryErrorCode =
  | "INVALID_CONTENT"
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "DUPLICATE_ID"
  | "UNSUPPORTED_VERSION"
  | "CORRUPT_DATA"
  | "STORAGE_IO";

export class MemoryError extends Error {
  readonly code: MemoryErrorCode;

  constructor(code: MemoryErrorCode, message: string) {
    super(message);
    this.name = "MemoryError";
    this.code = code;
  }
}

export interface MemoryStoreOptions {
  filePath?: string;
  clock?: () => Date;
  idFactory?: () => string;
  maxContentLength?: number;
}

function isErrnoWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === code
  );
}

function isValidId(value: unknown): value is string {
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

function validateStoredContent(value: unknown, max: number, id: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new MemoryError(
      "CORRUPT_DATA",
      `Memory ${id} has empty or non-text content.`,
    );
  }
  if (value.length > max) {
    throw new MemoryError(
      "CORRUPT_DATA",
      `Memory ${id} exceeds the maximum content length of ${max} characters.`,
    );
  }
  return value;
}

export function validateMemoryDocument(
  input: unknown,
  maxContentLength: number = DEFAULT_MAX_CONTENT_LENGTH,
): MemoryDocument {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new MemoryError("CORRUPT_DATA", "The memory file has an invalid structure.");
  }

  const { version, memories } = input as {
    version?: unknown;
    memories?: unknown;
  };

  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new MemoryError("CORRUPT_DATA", "The memory file is missing a valid schema version.");
  }

  if (version !== SCHEMA_VERSION) {
    throw new MemoryError(
      "UNSUPPORTED_VERSION",
      `Unsupported memory schema version ${version}. Expected ${SCHEMA_VERSION}.`,
    );
  }

  if (!Array.isArray(memories)) {
    throw new MemoryError("CORRUPT_DATA", "The memory file is missing its memory list.");
  }

  const seen = new Set<string>();
  const validated: Memory[] = [];

  for (const entry of memories) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new MemoryError("CORRUPT_DATA", "The memory file contains an invalid record.");
    }

    const record = entry as {
      id?: unknown;
      content?: unknown;
      createdAt?: unknown;
      updatedAt?: unknown;
    };

    if (!isValidId(record.id)) {
      throw new MemoryError("CORRUPT_DATA", "The memory file contains a record with an invalid id.");
    }

    if (seen.has(record.id)) {
      throw new MemoryError("DUPLICATE_ID", `Duplicate memory id: ${record.id}`);
    }
    seen.add(record.id);

    const content = validateStoredContent(record.content, maxContentLength, record.id);

    if (!isValidTimestamp(record.createdAt)) {
      throw new MemoryError("CORRUPT_DATA", `Memory ${record.id} has an invalid createdAt timestamp.`);
    }

    if (!isValidTimestamp(record.updatedAt)) {
      throw new MemoryError("CORRUPT_DATA", `Memory ${record.id} has an invalid updatedAt timestamp.`);
    }

    validated.push({
      id: record.id,
      content,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }

  return { version, memories: validated };
}

export function normalizeContent(
  content: unknown,
  maxContentLength: number = DEFAULT_MAX_CONTENT_LENGTH,
): string {
  if (typeof content !== "string") {
    throw new MemoryError("INVALID_CONTENT", "Memory content must be text.");
  }

  const trimmed = content.trim();

  if (trimmed.length === 0) {
    throw new MemoryError("INVALID_CONTENT", "Memory content cannot be empty.");
  }

  if (trimmed.length > maxContentLength) {
    throw new MemoryError(
      "INVALID_CONTENT",
      `Memory content exceeds the maximum length of ${maxContentLength} characters.`,
    );
  }

  return trimmed;
}

export class MemoryStore {
  readonly filePath: string;

  readonly #clock: () => Date;
  readonly #idFactory: () => string;
  readonly #maxContentLength: number;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: MemoryStoreOptions = {}) {
    this.filePath = options.filePath ?? DEFAULT_STORAGE_PATH;
    this.#clock = options.clock ?? (() => new Date());
    this.#idFactory = options.idFactory ?? (() => randomUUID());
    this.#maxContentLength =
      options.maxContentLength ?? DEFAULT_MAX_CONTENT_LENGTH;
  }

  listMemories(): Promise<Memory[]> {
    return this.#exclusive(async () => {
      const document = await this.#read();
      return document.memories.map((memory) => ({ ...memory }));
    });
  }

  getMemory(id: string): Promise<Memory> {
    return this.#exclusive(async () => {
      this.#assertId(id);
      const document = await this.#read();
      const found = document.memories.find((memory) => memory.id === id);
      if (!found) {
        throw new MemoryError("NOT_FOUND", `Memory not found: ${id}`);
      }
      return { ...found };
    });
  }

  createMemory(content: string): Promise<Memory> {
    return this.#exclusive(async () => {
      const normalized = normalizeContent(content, this.#maxContentLength);
      const document = await this.#read();
      const id = this.#generateId(document);
      const now = this.#clock().toISOString();
      const memory: Memory = {
        id,
        content: normalized,
        createdAt: now,
        updatedAt: now,
      };
      document.memories.push(memory);
      await this.#write(document);
      return { ...memory };
    });
  }

  updateMemory(id: string, content: string): Promise<Memory> {
    return this.#exclusive(async () => {
      this.#assertId(id);
      const normalized = normalizeContent(content, this.#maxContentLength);
      const document = await this.#read();
      const index = document.memories.findIndex((memory) => memory.id === id);
      if (index === -1) {
        throw new MemoryError("NOT_FOUND", `Memory not found: ${id}`);
      }
      const existing = document.memories[index];
      const updated: Memory = {
        id: existing.id,
        content: normalized,
        createdAt: existing.createdAt,
        updatedAt: this.#clock().toISOString(),
      };
      document.memories[index] = updated;
      await this.#write(document);
      return { ...updated };
    });
  }

  deleteMemory(id: string): Promise<boolean> {
    return this.#exclusive(async () => {
      this.#assertId(id);
      const document = await this.#read();
      const remaining = document.memories.filter((memory) => memory.id !== id);
      if (remaining.length === document.memories.length) {
        return false;
      }
      document.memories = remaining;
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
    if (!isValidId(id)) {
      throw new MemoryError("INVALID_ARGUMENT", "A valid memory id is required.");
    }
  }

  #generateId(document: MemoryDocument): string {
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
      const candidate = this.#idFactory();
      if (isValidId(candidate) && !document.memories.some((m) => m.id === candidate)) {
        return candidate;
      }
    }
    throw new MemoryError("DUPLICATE_ID", "Could not generate a unique memory id.");
  }

  async #read(): Promise<MemoryDocument> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isErrnoWithCode(error, "ENOENT")) {
        return { version: SCHEMA_VERSION, memories: [] };
      }
      throw new MemoryError("STORAGE_IO", "Could not read the memory file.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new MemoryError(
        "CORRUPT_DATA",
        "The memory file is not valid JSON. It was left unchanged.",
      );
    }

    return validateMemoryDocument(parsed, this.#maxContentLength);
  }

  async #write(document: MemoryDocument): Promise<void> {
    const validated = validateMemoryDocument(document, this.#maxContentLength);
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
      throw new MemoryError(
        "STORAGE_IO",
        "Could not save memory data. Existing data was left unchanged.",
      );
    }
  }
}

export function createMemoryStore(options: MemoryStoreOptions = {}): MemoryStore {
  return new MemoryStore(options);
}

export const memoryStore = new MemoryStore();
