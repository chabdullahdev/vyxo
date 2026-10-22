import type { ProjectStore } from "./store.ts";

/**
 * Workspace projects are separate by design: their chats never see the global memories, so a fact about
 * one client or case can never be offered while working on another. Connected-folder projects and
 * ordinary chats keep using memories exactly as before.
 */
export async function isolatesGlobalMemory(store: Pick<ProjectStore, "getProject">, projectId: string | null | undefined): Promise<boolean> {
  if (!projectId) return false;
  try {
    return (await store.getProject(projectId)).kind === "managed";
  } catch {
    return false;
  }
}
