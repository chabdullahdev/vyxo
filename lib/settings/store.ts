import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { DEFAULT_MODEL } from "../config.ts";
import { isValidModelName } from "../models/catalog.ts";
import { DEFAULT_STORAGE_DIR } from "../memory/store.ts";

export const SETTINGS_SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS_STORAGE_PATH = join(DEFAULT_STORAGE_DIR, "settings.json");

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export interface AppSettings {
  selectedModel: string;
}

export interface SettingsDocument {
  version: number;
  selectedModel: string;
}

export type SettingsErrorCode =
  | "INVALID_MODEL"
  | "UNSUPPORTED_VERSION"
  | "CORRUPT_DATA"
  | "STORAGE_IO";

export class SettingsError extends Error {
  readonly code: SettingsErrorCode;

  constructor(code: SettingsErrorCode, message: string) {
    super(message);
    this.name = "SettingsError";
    this.code = code;
  }
}

export interface SettingsStoreOptions {
  filePath?: string;
  defaultModel?: string;
}

function isErrnoWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === code
  );
}

export function validateSettingsDocument(input: unknown): SettingsDocument {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new SettingsError("CORRUPT_DATA", "The settings file has an invalid structure.");
  }

  const { version, selectedModel } = input as {
    version?: unknown;
    selectedModel?: unknown;
  };

  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new SettingsError("CORRUPT_DATA", "The settings file is missing a valid schema version.");
  }

  if (version !== SETTINGS_SCHEMA_VERSION) {
    throw new SettingsError(
      "UNSUPPORTED_VERSION",
      `Unsupported settings schema version ${version}. Expected ${SETTINGS_SCHEMA_VERSION}.`,
    );
  }

  if (!isValidModelName(selectedModel)) {
    throw new SettingsError("CORRUPT_DATA", "The settings file has an invalid model name.");
  }

  return { version, selectedModel };
}

export class SettingsStore {
  readonly filePath: string;

  readonly #defaultModel: string;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: SettingsStoreOptions = {}) {
    this.filePath = options.filePath ?? DEFAULT_SETTINGS_STORAGE_PATH;
    this.#defaultModel = options.defaultModel ?? DEFAULT_MODEL;
  }

  getSettings(): Promise<AppSettings> {
    return this.#exclusive(async () => {
      const document = await this.#read();
      return { selectedModel: document.selectedModel };
    });
  }

  setSelectedModel(selectedModel: string): Promise<AppSettings> {
    return this.#exclusive(async () => {
      if (!isValidModelName(selectedModel)) {
        throw new SettingsError("INVALID_MODEL", "A valid model name is required.");
      }
      await this.#read();
      const updated: SettingsDocument = {
        version: SETTINGS_SCHEMA_VERSION,
        selectedModel,
      };
      await this.#write(updated);
      return { selectedModel: updated.selectedModel };
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

  async #read(): Promise<SettingsDocument> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isErrnoWithCode(error, "ENOENT")) {
        return { version: SETTINGS_SCHEMA_VERSION, selectedModel: this.#defaultModel };
      }
      throw new SettingsError("STORAGE_IO", "Could not read the settings file.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new SettingsError(
        "CORRUPT_DATA",
        "The settings file is not valid JSON. It was left unchanged.",
      );
    }

    return validateSettingsDocument(parsed);
  }

  async #write(document: SettingsDocument): Promise<void> {
    const validated = validateSettingsDocument(document);
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
      throw new SettingsError(
        "STORAGE_IO",
        "Could not save settings. Existing data was left unchanged.",
      );
    }
  }
}

export function createSettingsStore(options: SettingsStoreOptions = {}): SettingsStore {
  return new SettingsStore(options);
}

export const settingsStore = new SettingsStore();
