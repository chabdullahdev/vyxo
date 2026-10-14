import { join } from "node:path";
import { DEFAULT_STORAGE_DIR } from "../memory/store.ts";

export const EDIT_PROPOSAL_SCHEMA_VERSION = 1;
export const EDIT_RECOVERY_SCHEMA_VERSION = 1;

export const DEFAULT_EDIT_STORAGE_PATH = join(DEFAULT_STORAGE_DIR, "edit-proposals.json");
export const DEFAULT_RECOVERY_STORAGE_PATH = join(DEFAULT_STORAGE_DIR, "edit-recovery.json");
export const DEFAULT_RECOVERY_DIR = join(DEFAULT_STORAGE_DIR, "edit-recovery");

export const MAX_PROPOSAL_OPERATIONS = 20;
export const MAX_PROPOSAL_FILE_BYTES = 200 * 1024;
export const MAX_PROPOSAL_TOTAL_BYTES = 600 * 1024;
export const MAX_PROPOSAL_SUMMARY_CHARS = 2_000;
export const MAX_PROPOSAL_REQUEST_CHARS = 4_000;
export const MAX_STORED_PROPOSALS = 25;
export const DIFF_MAX_LINES = 400;

export type ProposalStatus =
  | "ready_for_review"
  | "approved"
  | "applying"
  | "applied"
  | "rejected"
  | "cancelled"
  | "stale"
  | "failed"
  | "recovery_required";

export type ProposalOperationType = "create" | "modify" | "delete";

export type DiffLineType = "context" | "added" | "removed";

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface FileDiff {
  added: number;
  removed: number;
  lines: DiffLine[];
  truncated: boolean;
}

export interface ProposalOperation {
  op: ProposalOperationType;
  path: string;
  originalHash: string | null;
  originalContent: string | null;
  newContent: string | null;
  diff: FileDiff | null;
}

export interface ProposalOperationResult {
  path: string;
  op: ProposalOperationType;
  status: "applied" | "failed" | "skipped";
  message?: string;
}

export interface EditProposal {
  id: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  request: string;
  summary: string;
  model: string | null;
  status: ProposalStatus;
  operations: ProposalOperation[];
  approvedAt: string | null;
  appliedAt: string | null;
  results: ProposalOperationResult[] | null;
  error: string | null;
}

export interface ProposalDocument {
  version: number;
  proposals: EditProposal[];
}

export interface RecoveryEntry {
  proposalId: string;
  projectId: string;
  path: string;
  absolutePath: string;
  operation: ProposalOperationType;
  originalHash: string | null;
  originalContent: string | null;
  newHash: string | null;
  status: "pending" | "applied" | "restored" | "conflict";
  createdAt: string;
}

export interface RecoveryDocument {
  version: number;
  entries: RecoveryEntry[];
}

export type EditErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_PROPOSAL"
  | "INVALID_OPERATION"
  | "INVALID_PATH"
  | "SENSITIVE"
  | "UNSUPPORTED_TYPE"
  | "DUPLICATE_PATH"
  | "TOO_LARGE"
  | "LIMIT_EXCEEDED"
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "STALE"
  | "CONFLICT"
  | "NOT_AUTHORIZED"
  | "RECOVERY_FAILED"
  | "CORRUPT_DATA"
  | "UNSUPPORTED_VERSION"
  | "STORAGE_IO";

export class EditError extends Error {
  readonly code: EditErrorCode;

  constructor(code: EditErrorCode, message: string) {
    super(message);
    this.name = "EditError";
    this.code = code;
  }
}
