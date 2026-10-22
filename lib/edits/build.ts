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
  /** "write" (from the file-block format) means create or modify, decided by whether the file exists. */
  op: ProposalOperationType | "write";
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

const FILE_HEADER = /^<<<FILE[ \t]+(.+?)[ \t]*>>>[ \t]*$/;
const DELETE_HEADER = /^<<<DELETE[ \t]+(.+?)[ \t]*>>>[ \t]*$/;
const END_MARKER = /^<<<END>>>[ \t]*$/;
const MARKER_START = /^<<<(?:FILE|DELETE|END)\b/;

function cleanBlockPath(raw: string): string {
  return raw
    .trim()
    .replace(/^[`'"]+|[`'"]+$/g, "")
    .replace(/^\.\//, "")
    .trim();
}

/** A model sometimes wraps a whole file in one markdown fence even when told not to. Remove only that. */
function unwrapFence(lines: string[]): string[] {
  if (lines.length >= 2 && /^```[\w+-]*[ \t]*$/.test(lines[0]) && /^```[ \t]*$/.test(lines[lines.length - 1])) {
    return lines.slice(1, -1);
  }
  return lines;
}

/**
 * Read the file-block format:
 *
 *   SUMMARY: what changed
 *   <<<FILE path>>>
 *   the complete file
 *   <<<END>>>
 *   <<<DELETE path>>>
 *
 * Returns null if the text has no file markers at all. A block that never closes is accepted only when
 * `finished` says the model stopped by itself; if it ran out of room the answer is rejected rather than
 * saving half a file.
 */
export function parseBlockOutput(text: string, finished: boolean): RawProposal | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const operations: RawProposalOperation[] = [];
  const summaryLines: string[] = [];
  let current: { path: string; lines: string[] } | null = null;
  let sawMarker = false;
  let cutOff = false;

  const closeCurrent = () => {
    if (!current) return;
    const body = unwrapFence(current.lines);
    // Drop blank lines at both ends, then end the file with exactly one newline.
    while (body.length > 0 && body[body.length - 1].trim() === "") body.pop();
    while (body.length > 0 && body[0].trim() === "") body.shift();
    operations.push({ op: "write", path: current.path, content: body.length > 0 ? `${body.join("\n")}\n` : "" });
    current = null;
  };

  for (const line of lines) {
    const file = FILE_HEADER.exec(line);
    const del = DELETE_HEADER.exec(line);
    if (file || del) {
      sawMarker = true;
      closeCurrent(); // a new block also ends one the model forgot to close
      if (del) {
        operations.push({ op: "delete", path: cleanBlockPath(del[1]), content: null });
      } else {
        current = { path: cleanBlockPath((file as RegExpExecArray)[1]), lines: [] };
      }
      continue;
    }
    if (END_MARKER.test(line)) {
      sawMarker = true;
      closeCurrent();
      continue;
    }
    if (current) {
      current.lines.push(line);
    } else if (operations.length === 0 && !MARKER_START.test(line)) {
      summaryLines.push(line);
    }
  }

  if (current) {
    if (finished) closeCurrent();
    else cutOff = true;
  }
  if (!sawMarker) return null;
  if (cutOff) {
    throw new EditError("INVALID_PROPOSAL", "The assistant's answer was cut off before the last file was finished, so nothing was changed. Try asking for a smaller change.");
  }

  const summaryText = summaryLines
    .join(" ")
    .replace(/^\s*SUMMARY:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const summary =
    summaryText.length > 0
      ? summaryText.slice(0, MAX_PROPOSAL_SUMMARY_CHARS)
      : `Updated ${operations.length} file${operations.length === 1 ? "" : "s"}.`;
  return { summary, operations };
}

export type BuilderReading =
  | { kind: "changes"; proposal: RawProposal }
  | { kind: "answer"; text: string };

/**
 * Read what the assistant said in Build mode. File blocks (or the older JSON form) are changes to review;
 * plain text with no files is an answer to show in the chat, not an error.
 */
export function readBuilderOutput(text: string, finished: boolean): BuilderReading {
  const blocks = parseBlockOutput(text, finished);
  if (blocks && blocks.operations.length > 0) {
    if (blocks.operations.length > MAX_PROPOSAL_OPERATIONS) {
      throw new EditError("LIMIT_EXCEEDED", `A proposal may contain at most ${MAX_PROPOSAL_OPERATIONS} operations.`);
    }
    return { kind: "changes", proposal: blocks };
  }
  try {
    return { kind: "changes", proposal: parseProposalOutput(text) };
  } catch {
    // Not JSON either.
  }
  const answer = text.replace(/\s*<<<END>>>\s*$/g, "").trim();
  if (answer.length === 0) throw new EditError("INVALID_PROPOSAL", "The assistant did not give an answer.");
  // Broken JSON is an unfinished proposal, not something to show the person as an answer.
  if (/^(?:```(?:json)?\s*)?\{/.test(answer) && /"(?:operations|summary)"\s*:/.test(answer)) {
    throw new EditError("INVALID_PROPOSAL", "The assistant's answer could not be read.");
  }
  return { kind: "answer", text: answer };
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

    const operation: ProposalOperationType = entry.op === "write" ? (target.exists ? "modify" : "create") : entry.op;

    if (operation === "create") {
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

    if (operation === "delete") {
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
    // Rewriting a file with the same text is not a change; leave it out rather than ask for approval.
    if (content === existing.content) continue;
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
  if (operations.length === 0) {
    throw new EditError("INVALID_PROPOSAL", "The assistant's answer did not change anything.");
  }

  return operations;
}
