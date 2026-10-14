import { ProjectFileError, type ProjectFileService } from "../files/service.ts";
import { computeLineDiff } from "./diff.ts";
import {
  EditError,
  MAX_PROPOSAL_FILE_BYTES,
  MAX_PROPOSAL_OPERATIONS,
  MAX_PROPOSAL_SUMMARY_CHARS,
  MAX_PROPOSAL_TOTAL_BYTES,
  type ProposalOperation,
  type ProposalOperationType,
} from "./types.ts";

export interface RawProposalOperation {
  op: ProposalOperationType;
  path: string;
  content: string | null;
}

export interface RawProposal {
  summary: string;
  operations: RawProposalOperation[];
}

const VALID_OPS = new Set<ProposalOperationType>(["create", "modify", "delete"]);

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```[a-zA-Z]*\s*/, "")
    .replace(/\s*```$/, "")
    .trim();

  const candidates = [withoutFence];
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(withoutFence.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }
  throw new EditError("INVALID_PROPOSAL", "The model did not return a readable JSON proposal.");
}

export function parseProposalOutput(text: string): RawProposal {
  const parsed = extractJson(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new EditError("INVALID_PROPOSAL", "The proposal must be a JSON object.");
  }

  const summary = (parsed as { summary?: unknown }).summary;
  if (typeof summary !== "string" || summary.trim().length === 0) {
    throw new EditError("INVALID_PROPOSAL", "The proposal is missing a summary.");
  }
  if (summary.length > MAX_PROPOSAL_SUMMARY_CHARS) {
    throw new EditError("INVALID_PROPOSAL", "The proposal summary is too long.");
  }

  const operations = (parsed as { operations?: unknown }).operations;
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new EditError("INVALID_PROPOSAL", "The proposal has no file operations.");
  }
  if (operations.length > MAX_PROPOSAL_OPERATIONS) {
    throw new EditError("LIMIT_EXCEEDED", `A proposal may contain at most ${MAX_PROPOSAL_OPERATIONS} operations.`);
  }

  const result: RawProposalOperation[] = [];
  for (const entry of operations) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new EditError("INVALID_PROPOSAL", "A proposal operation is invalid.");
    }
    const record = entry as { op?: unknown; path?: unknown; content?: unknown };
    if (typeof record.op !== "string" || !VALID_OPS.has(record.op as ProposalOperationType)) {
      throw new EditError("INVALID_PROPOSAL", "A proposal operation has an unsupported type.");
    }
    if (typeof record.path !== "string" || record.path.trim().length === 0) {
      throw new EditError("INVALID_PROPOSAL", "A proposal operation is missing its path.");
    }
    const op = record.op as ProposalOperationType;
    let content: string | null = null;
    if (op === "delete") {
      if (record.content !== undefined && record.content !== null && record.content !== "") {
        throw new EditError("INVALID_PROPOSAL", "A delete operation must not include content.");
      }
    } else {
      if (typeof record.content !== "string") {
        throw new EditError("INVALID_PROPOSAL", "A create or modify operation must include the new file content.");
      }
      content = record.content;
    }
    result.push({ op, path: record.path.trim(), content });
  }

  return { summary: summary.trim(), operations: result };
}

function mapFileError(error: unknown): EditError {
  if (error instanceof ProjectFileError) {
    switch (error.code) {
      case "INVALID_PATH":
      case "OUTSIDE_FOLDER":
      case "SYMLINK":
        return new EditError("INVALID_PATH", error.message);
      case "SENSITIVE":
        return new EditError("SENSITIVE", error.message);
      case "UNSUPPORTED_TYPE":
      case "BINARY":
        return new EditError("UNSUPPORTED_TYPE", error.message);
      case "NOT_FOUND":
        return new EditError("NOT_FOUND", error.message);
      case "TOO_LARGE":
        return new EditError("TOO_LARGE", error.message);
      default:
        return new EditError("INVALID_OPERATION", error.message);
    }
  }
  return new EditError("INVALID_OPERATION", "The target file could not be validated.");
}

export async function buildProposalOperations(
  service: ProjectFileService,
  folderPath: string,
  raw: RawProposal,
): Promise<ProposalOperation[]> {
  const seen = new Set<string>();
  const operations: ProposalOperation[] = [];
  let totalBytes = 0;

  for (const entry of raw.operations) {
    let target;
    try {
      target = await service.prepareWriteTarget(folderPath, entry.path);
    } catch (error) {
      throw mapFileError(error);
    }
    if (seen.has(target.relativePath)) {
      throw new EditError("DUPLICATE_PATH", `The path ${target.relativePath} appears more than once.`);
    }
    seen.add(target.relativePath);

    if (entry.op === "create") {
      if (target.exists) {
        throw new EditError("INVALID_OPERATION", `${target.relativePath} already exists; propose a modify instead.`);
      }
      const content = entry.content ?? "";
      if (content.length > MAX_PROPOSAL_FILE_BYTES) {
        throw new EditError("TOO_LARGE", `${target.relativePath} is larger than the allowed proposal size.`);
      }
      totalBytes += content.length;
      operations.push({
        op: "create",
        path: target.relativePath,
        originalHash: null,
        originalContent: null,
        newContent: content,
        diff: computeLineDiff("", content),
      });
      continue;
    }

    if (!target.exists) {
      throw new EditError("STALE", `${target.relativePath} does not exist; it may have changed since you asked.`);
    }

    let existing;
    try {
      existing = await service.readExistingFile(folderPath, target.relativePath);
    } catch (error) {
      throw mapFileError(error);
    }

    if (entry.op === "delete") {
      operations.push({
        op: "delete",
        path: target.relativePath,
        originalHash: existing.sha256,
        originalContent: existing.content,
        newContent: null,
        diff: null,
      });
      continue;
    }

    const content = entry.content ?? "";
    if (content.length > MAX_PROPOSAL_FILE_BYTES) {
      throw new EditError("TOO_LARGE", `${target.relativePath} is larger than the allowed proposal size.`);
    }
    totalBytes += content.length;
    operations.push({
      op: "modify",
      path: target.relativePath,
      originalHash: existing.sha256,
      originalContent: existing.content,
      newContent: content,
      diff: computeLineDiff(existing.content, content),
    });
  }

  if (totalBytes > MAX_PROPOSAL_TOTAL_BYTES) {
    throw new EditError("TOO_LARGE", "The proposal is larger than the allowed total size.");
  }

  return operations;
}
