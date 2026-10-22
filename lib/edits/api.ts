import { randomUUID } from "node:crypto";
import type { ProjectStore } from "../projects/store.ts";
import type { ConversationStore } from "../conversations/store.ts";
import type { ProjectFileService } from "../files/service.ts";
import { loadProjectContextMessage } from "../projects/context.ts";
import { gatherProjectFileEvidence } from "../files/retrieval.ts";
import { applyProposal, recoverProposal, type ApplyDependencies } from "./apply.ts";
import { buildProposalOperations, parseProposalOutput, type RawProposal } from "./build.ts";
import { runWorkspaceBuilder, type BuilderInput, type BuilderResult } from "../workspace/builder.ts";
import { builderGuideFor, keepEditableOperations } from "../workspace/templates.ts";
import { generateProposalText, type GenerateResult } from "./generate.ts";
import type { ProposalStore, RecoveryStore } from "./store.ts";
import {
  EditError,
  MAX_PROPOSAL_REQUEST_CHARS,
  type EditProposal,
} from "./types.ts";

const MAX_BODY_BYTES = 64_000;

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function editErrorResponse(error: unknown): Response {
  if (error instanceof EditError) {
    const statusByCode: Partial<Record<EditError["code"], number>> = {
      INVALID_REQUEST: 400,
      INVALID_PROPOSAL: 400,
      INVALID_OPERATION: 400,
      INVALID_PATH: 400,
      DUPLICATE_PATH: 400,
      TOO_LARGE: 413,
      LIMIT_EXCEEDED: 400,
      SENSITIVE: 403,
      UNSUPPORTED_TYPE: 403,
      NOT_AUTHORIZED: 403,
      NOT_FOUND: 404,
      INVALID_STATE: 409,
      STALE: 409,
      CONFLICT: 409,
      RECOVERY_FAILED: 500,
      STORAGE_IO: 500,
      CORRUPT_DATA: 500,
      UNSUPPORTED_VERSION: 500,
    };
    return jsonResponse({ error: error.message }, statusByCode[error.code] ?? 400);
  }
  console.error("[edits] request failed");
  return jsonResponse({ error: "The edit request could not be completed." }, 500);
}

async function readJsonObject(
  request: Request,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return { ok: false, response: jsonResponse({ error: "Content-Type must be application/json." }, 415) };
  }
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, response: jsonResponse({ error: "Could not read the request body." }, 400) };
  }
  if (raw.length > MAX_BODY_BYTES) {
    return { ok: false, response: jsonResponse({ error: "Request body is too large." }, 413) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, response: jsonResponse({ error: "Request body must be valid JSON." }, 400) };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, response: jsonResponse({ error: "Request body must be a JSON object." }, 400) };
  }
  return { ok: true, body: parsed as Record<string, unknown> };
}

function proposalSummary(proposal: EditProposal) {
  return {
    id: proposal.id,
    projectId: proposal.projectId,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
    request: proposal.request,
    summary: proposal.summary,
    model: proposal.model,
    status: proposal.status,
    fileCount: proposal.operations.length,
    operations: proposal.operations.map((operation) => ({
      op: operation.op,
      path: operation.path,
      added: operation.diff?.added ?? 0,
      removed: operation.diff?.removed ?? 0,
    })),
    error: proposal.error,
  };
}

export interface CreateProposalDeps {
  projectStore: ProjectStore;
  proposalStore: ProposalStore;
  service: ProjectFileService;
  generate?: (input: {
    request: string;
    contextText: string | null;
    evidenceText: string | null;
  }) => Promise<GenerateResult>;
  /** When given, a Build exchange is also saved to the project's chat so the conversation reads naturally. */
  conversationStore?: ConversationStore;
  /** Build mode for workspace projects. Replaceable in tests. */
  workspaceBuilder?: (input: BuilderInput) => Promise<BuilderResult>;
}

function describeOperation(operation: { op: string; path: string; diff: { added: number; removed: number } | null }): string {
  const verb = operation.op === "create" ? "new file" : operation.op === "delete" ? "delete" : "change";
  const counts = operation.diff ? ` (+${operation.diff.added} −${operation.diff.removed})` : "";
  return `- ${verb}: \`${operation.path}\`${counts}`;
}

/** The chat message that tells the person a proposal is waiting for their review. */
export function proposalChatMessage(proposal: EditProposal): string {
  const count = proposal.operations.length;
  return [
    `I prepared ${count} change${count === 1 ? "" : "s"} for you to review: ${proposal.summary}`,
    "",
    ...proposal.operations.map(describeOperation),
    "",
    "Nothing has been changed yet. Open the **Changes** tab to review it, then apply or reject it.",
  ].join("\n");
}

async function recordBuildTurn(
  store: ConversationStore | undefined,
  conversationId: unknown,
  projectId: string,
  userText: string,
  assistantText: string,
): Promise<void> {
  if (!store || typeof conversationId !== "string" || conversationId.length === 0) return;
  try {
    const conversation = await store.getConversation(conversationId);
    if (conversation.projectId !== projectId) return;
    await store.appendUserMessage(conversationId, { content: userText });
    await store.appendAssistantMessage(conversationId, { content: assistantText, status: "complete" });
  } catch {
    // The proposal itself is fine; only the chat history could not be updated.
    console.error("[edits] could not save the Build exchange to the project chat");
  }
}

export async function createProposalResponse(
  deps: CreateProposalDeps,
  projectId: string,
  request: Request,
): Promise<Response> {
  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;

  const entry = parsed.body.request;
  if (typeof entry !== "string" || entry.trim().length === 0) {
    return jsonResponse({ error: "`request` must be a non-empty string." }, 400);
  }
  if (entry.length > MAX_PROPOSAL_REQUEST_CHARS) {
    return jsonResponse({ error: "That request is too long." }, 413);
  }

  try {
    const project = await deps.projectStore.getProject(projectId);
    if (!project.sourceFolder) {
      return jsonResponse({ error: "Connect a source folder to this project first." }, 403);
    }

    const context = await loadProjectContextMessage(deps.projectStore, projectId);

    let raw: RawProposal;
    let model: string;
    if (project.kind === "managed") {
      // Workspace projects use Build mode: the assistant is shown the project's files and writes whole files.
      const built = await (deps.workspaceBuilder ?? runWorkspaceBuilder)({
        folder: project.sourceFolder,
        request: entry,
        projectNotes: context.status === "loaded" ? context.message : null,
        siteGuide: builderGuideFor(project.template),
        signal: request.signal,
      });
      if (built.kind === "answer") {
        await recordBuildTurn(deps.conversationStore, parsed.body.conversationId, projectId, entry, built.text);
        return jsonResponse({ answer: built.text, model: built.model }, 200);
      }
      // Some files are the site's design and are never changed by Build mode (see templates.ts).
      const editable = keepEditableOperations(project.template, built.proposal.operations);
      if (editable.dropped.length > 0 && editable.kept.length === 0) {
        return jsonResponse(
          {
            answer:
              "The page design of this website is fixed, so VYXO did not change it. Ask for changes to the words, colours, or sections instead, for example: \"make the accent colour emerald\" or \"add a section about our opening hours\".",
            model: built.model,
          },
          200,
        );
      }
      raw = { ...built.proposal, operations: editable.kept };
      model = built.model;
    } else {
      const evidence = await gatherProjectFileEvidence(
        deps.service,
        deps.projectStore,
        projectId,
        entry,
      );
      const generate = deps.generate ?? generateProposalText;
      const generated = await generate({
        request: entry,
        contextText: context.status === "loaded" ? context.message : null,
        evidenceText: evidence.status === "loaded" ? evidence.message : null,
      });
      raw = parseProposalOutput(generated.text);
      model = generated.model;
    }
    const operations = await buildProposalOperations(deps.service, project.sourceFolder, raw);

    const now = new Date().toISOString();
    const proposal: EditProposal = {
      id: randomUUID(),
      projectId,
      createdAt: now,
      updatedAt: now,
      request: entry,
      summary: raw.summary,
      model,
      status: "ready_for_review",
      operations,
      approvedAt: null,
      appliedAt: null,
      results: null,
      error: null,
    };
    await deps.proposalStore.create(proposal);
    const assistantMessage = proposalChatMessage(proposal);
    if (project.kind === "managed") {
      await recordBuildTurn(deps.conversationStore, parsed.body.conversationId, projectId, entry, assistantMessage);
    }
    return jsonResponse({ proposal, assistantMessage }, 201);
  } catch (error) {
    return editErrorResponse(error);
  }
}

export async function listProposalsResponse(
  proposalStore: ProposalStore,
  projectId: string,
): Promise<Response> {
  try {
    const proposals = await proposalStore.list(projectId);
    return jsonResponse({ proposals: proposals.map(proposalSummary) }, 200);
  } catch (error) {
    return editErrorResponse(error);
  }
}

export async function getProposalResponse(
  proposalStore: ProposalStore,
  projectId: string,
  proposalId: string,
): Promise<Response> {
  try {
    const proposal = await proposalStore.get(proposalId);
    if (proposal.projectId !== projectId) throw new EditError("NOT_FOUND", "Proposal not found.");
    return jsonResponse({ proposal }, 200);
  } catch (error) {
    return editErrorResponse(error);
  }
}

async function transition(
  proposalStore: ProposalStore,
  projectId: string,
  proposalId: string,
  status: "rejected" | "cancelled" | "approved",
): Promise<Response> {
  try {
    const proposal = await proposalStore.get(proposalId);
    if (proposal.projectId !== projectId) throw new EditError("NOT_FOUND", "Proposal not found.");
    const now = new Date().toISOString();
    const updated = await proposalStore.update(
      proposalId,
      status === "approved" ? { status, approvedAt: now } : { status },
      now,
    );
    return jsonResponse({ proposal: updated }, 200);
  } catch (error) {
    return editErrorResponse(error);
  }
}

export function rejectProposalResponse(store: ProposalStore, projectId: string, proposalId: string) {
  return transition(store, projectId, proposalId, "rejected");
}

export function approveProposalResponse(store: ProposalStore, projectId: string, proposalId: string) {
  return transition(store, projectId, proposalId, "approved");
}

export async function applyProposalResponse(
  deps: ApplyDependencies,
  projectId: string,
  proposalId: string,
): Promise<Response> {
  try {
    const outcome = await applyProposal(projectId, proposalId, deps);
    return jsonResponse(
      { proposal: outcome.proposal, status: outcome.status, results: outcome.results },
      200,
    );
  } catch (error) {
    return editErrorResponse(error);
  }
}

export async function recoveryListResponse(
  recoveryStore: RecoveryStore,
  projectId: string,
): Promise<Response> {
  try {
    const entries = (await recoveryStore.list(projectId)).filter(
      (entry) => entry.status === "applied" || entry.status === "conflict",
    );
    return jsonResponse(
      {
        entries: entries.map((entry) => ({
          proposalId: entry.proposalId,
          path: entry.path,
          operation: entry.operation,
          status: entry.status,
          createdAt: entry.createdAt,
        })),
      },
      200,
    );
  } catch (error) {
    return editErrorResponse(error);
  }
}

export async function recoverProposalResponse(
  deps: ApplyDependencies,
  projectId: string,
  proposalId: string,
): Promise<Response> {
  try {
    const outcome = await recoverProposal(projectId, proposalId, deps);
    return jsonResponse({ restored: outcome.restored, conflicts: outcome.conflicts }, 200);
  } catch (error) {
    return editErrorResponse(error);
  }
}

export function methodNotAllowedResponse(allowed: string[]): Response {
  return new Response(JSON.stringify({ error: "Method not allowed." }), {
    status: 405,
    headers: { ...JSON_HEADERS, Allow: allowed.join(", ") },
  });
}
