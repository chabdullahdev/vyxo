import { randomUUID } from "node:crypto";
import { lstat, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { hashContent, ProjectFileError, type ProjectFileService } from "../files/service.ts";
import type { ProjectStore } from "../projects/store.ts";
import {
  EditError,
  type EditProposal,
  type ProposalOperation,
  type ProposalOperationResult,
  type RecoveryEntry,
} from "./types.ts";
import type { ProposalStore, RecoveryStore } from "./store.ts";

export interface ApplyDependencies {
  service: ProjectFileService;
  proposalStore: ProposalStore;
  recoveryStore: RecoveryStore;
  projectStore: ProjectStore;
  now?: () => Date;
}

const projectLocks = new Map<string, Promise<unknown>>();

function withProjectLock<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
  const previous = projectLocks.get(projectId) ?? Promise.resolve();
  const run = previous.then(operation, operation);
  projectLocks.set(
    projectId,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

async function writeFileAtomic(absolutePath: string, content: string, mode: number): Promise<void> {
  const directory = dirname(absolutePath);
  const temporaryPath = join(directory, `.${basename(absolutePath)}.vyxo-${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, "wx", mode);
    await handle.writeFile(content, "utf8");
    await handle.chmod(mode);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, absolutePath);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function currentFileHash(absolutePath: string): Promise<string | null> {
  let info;
  try {
    info = await lstat(absolutePath);
  } catch {
    return null;
  }
  if (info.isSymbolicLink() || !info.isFile()) return null;
  return hashContent(await readFile(absolutePath, "utf8"));
}

export interface ApplyOutcome {
  proposal: EditProposal;
  status: "applied" | "partial" | "failed";
  results: ProposalOperationResult[];
}

export async function applyProposal(
  projectId: string,
  proposalId: string,
  deps: ApplyDependencies,
): Promise<ApplyOutcome> {
  const now = () => (deps.now ?? (() => new Date()))().toISOString();
  const proposal = await deps.proposalStore.get(proposalId);
  if (proposal.projectId !== projectId) {
    throw new EditError("NOT_FOUND", "Proposal not found.");
  }
  if (proposal.status !== "approved") {
    throw new EditError("INVALID_STATE", "Only an approved proposal can be applied.");
  }

  return withProjectLock(projectId, async () => {
    const project = await deps.projectStore.getProject(projectId);
    if (!project.sourceFolder) {
      throw new EditError("NOT_AUTHORIZED", "No source folder is connected to this project.");
    }
    await deps.proposalStore.update(proposalId, { status: "applying", error: null }, now());

    const results: ProposalOperationResult[] = [];
    let aborted = false;

    for (const operation of proposal.operations) {
      if (aborted) {
        results.push({ path: operation.path, op: operation.op, status: "skipped" });
        continue;
      }
      try {
        await applyOperation(project.sourceFolder, proposal, operation, deps, now);
        results.push({ path: operation.path, op: operation.op, status: "applied" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "The operation failed.";
        results.push({ path: operation.path, op: operation.op, status: "failed", message });
        aborted = true;
      }
    }

    const appliedCount = results.filter((result) => result.status === "applied").length;
    const failedCount = results.filter((result) => result.status === "failed").length;

    if (appliedCount === 0) {
      const failed = await deps.proposalStore.update(
        proposalId,
        { status: "failed", results, error: results.find((r) => r.message)?.message ?? "No operations were applied." },
        now(),
      );
      return { proposal: failed, status: "failed", results };
    }

    if (failedCount > 0) {
      const partial = await deps.proposalStore.update(
        proposalId,
        { status: "recovery_required", results, error: "Only some operations were applied. Recovery is available." },
        now(),
      );
      return { proposal: partial, status: "partial", results };
    }

    const applied = await deps.proposalStore.update(
      proposalId,
      { status: "applied", results, appliedAt: now(), error: null },
      now(),
    );
    return { proposal: applied, status: "applied", results };
  });
}

async function applyOperation(
  folder: string,
  proposal: EditProposal,
  operation: ProposalOperation,
  deps: ApplyDependencies,
  now: () => string,
): Promise<void> {
  let target;
  try {
    target = await deps.service.prepareWriteTarget(folder, operation.path);
  } catch (error) {
    if (error instanceof ProjectFileError) throw new EditError("INVALID_PATH", error.message);
    throw error;
  }

  const record = async (entry: Omit<RecoveryEntry, "proposalId" | "projectId" | "status" | "createdAt">) => {
    await deps.recoveryStore.append([
      {
        ...entry,
        proposalId: proposal.id,
        projectId: proposal.projectId,
        status: "pending",
        createdAt: now(),
      },
    ]);
  };

  if (operation.op === "create") {
    if (target.exists) {
      throw new EditError("STALE", `${operation.path} already exists and changed since the proposal was created.`);
    }
    const content = operation.newContent ?? "";
    await record({
      path: operation.path,
      absolutePath: target.absolutePath,
      operation: "create",
      originalHash: null,
      originalContent: null,
      newHash: hashContent(content),
    });
    await writeFileAtomic(target.absolutePath, content, 0o644);
    await deps.recoveryStore.updateEntryStatus(proposal.id, operation.path, "applied");
    return;
  }

  if (!target.exists) {
    throw new EditError("STALE", `${operation.path} no longer exists; it changed since the proposal was created.`);
  }
  const existingHash = await currentFileHash(target.absolutePath);
  if (existingHash === null || existingHash !== operation.originalHash) {
    throw new EditError("STALE", `${operation.path} has changed since the proposal was created.`);
  }

  if (operation.op === "delete") {
    await record({
      path: operation.path,
      absolutePath: target.absolutePath,
      operation: "delete",
      originalHash: operation.originalHash,
      originalContent: operation.originalContent,
      newHash: null,
    });
    await unlink(target.absolutePath);
    await deps.recoveryStore.updateEntryStatus(proposal.id, operation.path, "applied");
    return;
  }

  const content = operation.newContent ?? "";
  const mode = (await stat(target.absolutePath)).mode & 0o777;
  await record({
    path: operation.path,
    absolutePath: target.absolutePath,
    operation: "modify",
    originalHash: operation.originalHash,
    originalContent: operation.originalContent,
    newHash: hashContent(content),
  });
  await writeFileAtomic(target.absolutePath, content, mode || 0o644);
  await deps.recoveryStore.updateEntryStatus(proposal.id, operation.path, "applied");
}

export interface RecoverOutcome {
  restored: number;
  conflicts: string[];
}

export async function recoverProposal(
  projectId: string,
  proposalId: string,
  deps: ApplyDependencies,
): Promise<RecoverOutcome> {
  const now = () => (deps.now ?? (() => new Date()))().toISOString();
  const proposal = await deps.proposalStore.get(proposalId);
  if (proposal.projectId !== projectId) {
    throw new EditError("NOT_FOUND", "Proposal not found.");
  }
  const entries = (await deps.recoveryStore.list()).filter(
    (entry) => entry.proposalId === proposalId && entry.status === "applied",
  );

  return withProjectLock(projectId, async () => {
    const conflicts: string[] = [];
    let restored = 0;

    for (const entry of entries.slice().reverse()) {
      const existingHash = await currentFileHash(entry.absolutePath);
      const canRestore =
        entry.operation === "delete"
          ? existingHash === null
          : existingHash !== null && existingHash === entry.newHash;

      if (!canRestore) {
        conflicts.push(entry.path);
        continue;
      }

      if (entry.operation === "create") {
        await unlink(entry.absolutePath);
      } else {
        const original = entry.originalContent ?? "";
        const mode = existingHash !== null ? (await stat(entry.absolutePath)).mode & 0o777 : 0o644;
        await writeFileAtomic(entry.absolutePath, original, mode || 0o644);
      }
      restored += 1;
    }

    if (conflicts.length === 0) {
      await deps.recoveryStore.updateStatusForProposal(proposalId, "restored");
      await deps.proposalStore.update(proposalId, { status: "failed", error: "Rolled back by the user." }, now());
    } else {
      await deps.recoveryStore.updateStatusForProposal(proposalId, "conflict");
    }

    return { restored, conflicts };
  });
}
