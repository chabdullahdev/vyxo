import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { isValidProjectId } from "../projects/store.ts";
import {
  DEFAULT_EDIT_STORAGE_PATH,
  DEFAULT_RECOVERY_STORAGE_PATH,
  EDIT_PROPOSAL_SCHEMA_VERSION,
  EDIT_RECOVERY_SCHEMA_VERSION,
  EditError,
  MAX_STORED_PROPOSALS,
  type EditProposal,
  type FileDiff,
  type ProposalDocument,
  type ProposalOperation,
  type ProposalOperationResult,
  type ProposalStatus,
  type RecoveryDocument,
  type RecoveryEntry,
} from "./types.ts";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

const PROPOSAL_STATUSES: ReadonlySet<string> = new Set([
  "ready_for_review",
  "approved",
  "applying",
  "applied",
  "rejected",
  "cancelled",
  "stale",
  "failed",
  "recovery_required",
]);

const STATUS_TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
  ready_for_review: ["approved", "rejected", "cancelled", "stale"],
  approved: ["applying", "rejected", "cancelled", "stale"],
  applying: ["applied", "failed", "recovery_required", "stale"],
  recovery_required: ["failed", "recovery_required"],
  applied: ["failed"],
  rejected: [],
  cancelled: [],
  stale: [],
  failed: [],
};

export function canTransition(from: ProposalStatus, to: ProposalStatus): boolean {
  if (from === to) return true;
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function hashProposalOperations(operations: readonly ProposalOperation[]): string {
  const canonical = operations.map((operation) => [
    operation.op,
    operation.path,
    operation.originalHash ?? "",
    operation.newContent === null ? "null" : `len:${operation.newContent.length}`,
    operation.newContent ?? "",
  ]);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

function validateDiff(input: unknown): FileDiff {
  if (typeof input !== "object" || input === null) {
    throw new EditError("CORRUPT_DATA", "A stored proposal diff is invalid.");
  }
  const record = input as { added?: unknown; removed?: unknown; lines?: unknown; truncated?: unknown };
  if (typeof record.added !== "number" || typeof record.removed !== "number") {
    throw new EditError("CORRUPT_DATA", "A stored proposal diff is missing counts.");
  }
  if (!Array.isArray(record.lines)) {
    throw new EditError("CORRUPT_DATA", "A stored proposal diff is missing lines.");
  }
  const lines = record.lines.map((line) => {
    if (typeof line !== "object" || line === null) {
      throw new EditError("CORRUPT_DATA", "A stored diff line is invalid.");
    }
    const entry = line as { type?: unknown; text?: unknown };
    if (entry.type !== "context" && entry.type !== "added" && entry.type !== "removed") {
      throw new EditError("CORRUPT_DATA", "A stored diff line has an invalid type.");
    }
    if (typeof entry.text !== "string") {
      throw new EditError("CORRUPT_DATA", "A stored diff line has invalid text.");
    }
    return { type: entry.type as "context" | "added" | "removed", text: entry.text };
  });
  return {
    added: record.added,
    removed: record.removed,
    lines,
    truncated: record.truncated === true,
  };
}

function validateOperation(input: unknown): ProposalOperation {
  if (typeof input !== "object" || input === null) {
    throw new EditError("CORRUPT_DATA", "A stored proposal operation is invalid.");
  }
  const record = input as Record<string, unknown>;
  if (record.op !== "create" && record.op !== "modify" && record.op !== "delete") {
    throw new EditError("CORRUPT_DATA", "A stored proposal operation has an invalid type.");
  }
  if (typeof record.path !== "string" || record.path.length === 0) {
    throw new EditError("CORRUPT_DATA", "A stored proposal operation has an invalid path.");
  }
  const stringOrNull = (value: unknown): string | null =>
    value === null || value === undefined ? null : typeof value === "string" ? value : null;
  return {
    op: record.op,
    path: record.path,
    originalHash: stringOrNull(record.originalHash),
    originalContent: stringOrNull(record.originalContent),
    newContent: stringOrNull(record.newContent),
    diff: record.diff === null || record.diff === undefined ? null : validateDiff(record.diff),
  };
}

function validateResults(input: unknown): ProposalOperationResult[] | null {
  if (input === null || input === undefined) return null;
  if (!Array.isArray(input)) throw new EditError("CORRUPT_DATA", "Stored proposal results are invalid.");
  return input.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      throw new EditError("CORRUPT_DATA", "A stored proposal result is invalid.");
    }
    const record = entry as { path?: unknown; op?: unknown; status?: unknown; message?: unknown };
    if (typeof record.path !== "string" || (record.op !== "create" && record.op !== "modify" && record.op !== "delete")) {
      throw new EditError("CORRUPT_DATA", "A stored proposal result is invalid.");
    }
    if (record.status !== "applied" && record.status !== "failed" && record.status !== "skipped") {
      throw new EditError("CORRUPT_DATA", "A stored proposal result has an invalid status.");
    }
    return {
      path: record.path,
      op: record.op,
      status: record.status,
      ...(typeof record.message === "string" ? { message: record.message } : {}),
    };
  });
}

function validateProposal(input: unknown): EditProposal {
  if (typeof input !== "object" || input === null) {
    throw new EditError("CORRUPT_DATA", "A stored proposal is invalid.");
  }
  const record = input as Record<string, unknown>;
  if (!isValidProjectId(record.id) || !isValidProjectId(record.projectId)) {
    throw new EditError("CORRUPT_DATA", "A stored proposal has an invalid id.");
  }
  if (!isTimestamp(record.createdAt) || !isTimestamp(record.updatedAt)) {
    throw new EditError("CORRUPT_DATA", "A stored proposal has an invalid timestamp.");
  }
  if (typeof record.request !== "string" || typeof record.summary !== "string") {
    throw new EditError("CORRUPT_DATA", "A stored proposal is missing text fields.");
  }
  if (typeof record.status !== "string" || !PROPOSAL_STATUSES.has(record.status)) {
    throw new EditError("CORRUPT_DATA", "A stored proposal has an invalid status.");
  }
  if (!Array.isArray(record.operations)) {
    throw new EditError("CORRUPT_DATA", "A stored proposal is missing operations.");
  }
  const stringOrNull = (value: unknown): string | null =>
    typeof value === "string" ? value : null;
  return {
    id: record.id,
    projectId: record.projectId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    request: record.request,
    summary: record.summary,
    model: stringOrNull(record.model),
    status: record.status as ProposalStatus,
    operations: record.operations.map(validateOperation),
    approvedAt: stringOrNull(record.approvedAt),
    appliedAt: stringOrNull(record.appliedAt),
    results: validateResults(record.results),
    error: stringOrNull(record.error),
  };
}

export function validateProposalDocument(input: unknown): ProposalDocument {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new EditError("CORRUPT_DATA", "The proposal file has an invalid structure.");
  }
  const { version, proposals } = input as { version?: unknown; proposals?: unknown };
  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new EditError("CORRUPT_DATA", "The proposal file is missing a version.");
  }
  if (version !== EDIT_PROPOSAL_SCHEMA_VERSION) {
    throw new EditError("UNSUPPORTED_VERSION", `Unsupported proposal schema version ${version}.`);
  }
  if (!Array.isArray(proposals)) {
    throw new EditError("CORRUPT_DATA", "The proposal file is missing its list.");
  }
  const seen = new Set<string>();
  const validated = proposals.map((entry) => {
    const proposal = validateProposal(entry);
    if (seen.has(proposal.id)) throw new EditError("CORRUPT_DATA", "Duplicate proposal id.");
    seen.add(proposal.id);
    return proposal;
  });
  return { version, proposals: validated };
}

function cloneProposal(proposal: EditProposal): EditProposal {
  return {
    ...proposal,
    operations: proposal.operations.map((operation) => ({
      ...operation,
      diff: operation.diff ? { ...operation.diff, lines: operation.diff.lines.map((line) => ({ ...line })) } : null,
    })),
    results: proposal.results ? proposal.results.map((result) => ({ ...result })) : null,
  };
}

async function writeDocument<T>(filePath: string, data: T): Promise<void> {
  const serialized = `${JSON.stringify(data, null, 2)}\n`;
  const directory = dirname(filePath);
  const temporaryPath = join(directory, `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    await mkdir(directory, { recursive: true, mode: DIR_MODE });
    handle = await open(temporaryPath, "wx", FILE_MODE);
    await handle.writeFile(serialized, "utf8");
    await handle.chmod(FILE_MODE);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, filePath);
  } catch {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporaryPath).catch(() => {});
    throw new EditError("STORAGE_IO", "Could not save edit data. Existing data was left unchanged.");
  }
}

export class ProposalStore {
  readonly filePath: string;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(filePath: string = DEFAULT_EDIT_STORAGE_PATH) {
    this.filePath = filePath;
  }

  list(projectId?: string): Promise<EditProposal[]> {
    return this.#exclusive(async () => {
      const document = await this.#read();
      const proposals = projectId
        ? document.proposals.filter((proposal) => proposal.projectId === projectId)
        : document.proposals;
      return proposals
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
        .map(cloneProposal);
    });
  }

  get(id: string): Promise<EditProposal> {
    return this.#exclusive(async () => {
      const document = await this.#read();
      const found = document.proposals.find((proposal) => proposal.id === id);
      if (!found) throw new EditError("NOT_FOUND", "Proposal not found.");
      return cloneProposal(found);
    });
  }

  create(proposal: EditProposal): Promise<EditProposal> {
    return this.#exclusive(async () => {
      const document = await this.#read();
      document.proposals.push(proposal);
      document.proposals = this.#prune(document.proposals);
      await this.#write(document);
      return cloneProposal(proposal);
    });
  }

  update(
    id: string,
    changes: Partial<Pick<EditProposal, "status" | "approvedAt" | "appliedAt" | "results" | "error" | "summary">>,
    now: string,
  ): Promise<EditProposal> {
    return this.#exclusive(async () => {
      const document = await this.#read();
      const index = document.proposals.findIndex((proposal) => proposal.id === id);
      if (index === -1) throw new EditError("NOT_FOUND", "Proposal not found.");
      const current = document.proposals[index];
      if (changes.status !== undefined && !canTransition(current.status, changes.status)) {
        throw new EditError("INVALID_STATE", `Cannot move a proposal from ${current.status} to ${changes.status}.`);
      }
      const updated: EditProposal = {
        ...current,
        ...changes,
        updatedAt: now,
      };
      document.proposals[index] = updated;
      await this.#write(document);
      return cloneProposal(updated);
    });
  }

  #prune(proposals: EditProposal[]): EditProposal[] {
    if (proposals.length <= MAX_STORED_PROPOSALS) return proposals;
    const terminal: ProposalStatus[] = ["applied", "rejected", "cancelled", "stale", "failed"];
    const sorted = proposals.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const removable = sorted.filter((proposal) => terminal.includes(proposal.status));
    const keep = new Set(proposals.map((proposal) => proposal.id));
    for (const proposal of removable) {
      if (keep.size <= MAX_STORED_PROPOSALS) break;
      keep.delete(proposal.id);
    }
    return proposals.filter((proposal) => keep.has(proposal.id));
  }

  #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(operation, operation);
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #read(): Promise<ProposalDocument> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT") {
        return { version: EDIT_PROPOSAL_SCHEMA_VERSION, proposals: [] };
      }
      throw new EditError("STORAGE_IO", "Could not read the proposal file.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new EditError("CORRUPT_DATA", "The proposal file is not valid JSON. It was left unchanged.");
    }
    return validateProposalDocument(parsed);
  }

  #write(document: ProposalDocument): Promise<void> {
    return writeDocument(this.filePath, validateProposalDocument(document));
  }
}

function validateRecoveryDocument(input: unknown): RecoveryDocument {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new EditError("CORRUPT_DATA", "The recovery file has an invalid structure.");
  }
  const { version, entries } = input as { version?: unknown; entries?: unknown };
  if (typeof version !== "number" || version !== EDIT_RECOVERY_SCHEMA_VERSION) {
    throw new EditError("UNSUPPORTED_VERSION", "Unsupported recovery schema version.");
  }
  if (!Array.isArray(entries)) {
    throw new EditError("CORRUPT_DATA", "The recovery file is missing its entries.");
  }
  return { version, entries: entries as RecoveryEntry[] };
}

export class RecoveryStore {
  readonly filePath: string;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(filePath: string = DEFAULT_RECOVERY_STORAGE_PATH) {
    this.filePath = filePath;
  }

  list(projectId?: string): Promise<RecoveryEntry[]> {
    return this.#exclusive(async () => {
      const document = await this.#read();
      const entries = projectId
        ? document.entries.filter((entry) => entry.projectId === projectId)
        : document.entries;
      return entries.map((entry) => ({ ...entry }));
    });
  }

  append(entries: RecoveryEntry[]): Promise<void> {
    return this.#exclusive(async () => {
      const document = await this.#read();
      document.entries.push(...entries);
      await this.#write(document);
    });
  }

  updateEntryStatus(proposalId: string, path: string, status: RecoveryEntry["status"]): Promise<void> {
    return this.#exclusive(async () => {
      const document = await this.#read();
      let changed = false;
      for (const entry of document.entries) {
        if (entry.proposalId === proposalId && entry.path === path && entry.status !== status) {
          entry.status = status;
          changed = true;
        }
      }
      if (changed) await this.#write(document);
    });
  }

  updateStatusForProposal(proposalId: string, status: RecoveryEntry["status"]): Promise<void> {
    return this.#exclusive(async () => {
      const document = await this.#read();
      let changed = false;
      for (const entry of document.entries) {
        if (entry.proposalId === proposalId) {
          entry.status = status;
          changed = true;
        }
      }
      if (changed) await this.#write(document);
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

  async #read(): Promise<RecoveryDocument> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT") {
        return { version: EDIT_RECOVERY_SCHEMA_VERSION, entries: [] };
      }
      throw new EditError("STORAGE_IO", "Could not read the recovery file.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new EditError("CORRUPT_DATA", "The recovery file is not valid JSON.");
    }
    return validateRecoveryDocument(parsed);
  }

  #write(document: RecoveryDocument): Promise<void> {
    return writeDocument(this.filePath, validateRecoveryDocument(document));
  }
}

export const proposalStore = new ProposalStore();
export const recoveryStore = new RecoveryStore();
