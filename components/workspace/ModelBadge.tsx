"use client";

import { useModelCatalog } from "@/components/workspace/useModelCatalog";

/** Header pill showing the model that will actually answer, and whether it is reachable. */
export function ModelBadge() {
  const { catalog, state } = useModelCatalog();

  let dot = "bg-[var(--muted)]";
  let label = "Checking…";
  let title = "Checking your local model";

  if (state === "error") {
    label = "Offline";
    title = "Could not reach the local server";
  } else if (catalog) {
    if (catalog.status === "unavailable") {
      dot = "bg-amber-400";
      label = "Ollama not running";
      title = catalog.message ?? "Ollama is not reachable";
    } else if (catalog.status === "empty") {
      dot = "bg-amber-400";
      label = "No models";
      title = catalog.message ?? "No local models are installed";
    } else if (!catalog.selectedInstalled) {
      dot = "bg-amber-400";
      label = "Choose a model";
      title = `The saved model “${catalog.selectedModel}” is not installed`;
    } else {
      dot = "bg-emerald-400";
      label = catalog.selectedModel;
      title = `Answering with ${catalog.selectedModel}, running locally`;
    }
  }

  return (
    <div
      title={title}
      role="status"
      className="ml-auto flex max-w-[60%] items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      <span className="hidden sm:inline">Local</span>
      <span className="truncate text-[var(--foreground)]">{label}</span>
    </div>
  );
}
