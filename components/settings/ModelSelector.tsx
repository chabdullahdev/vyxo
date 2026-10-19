"use client";

import { useCallback, useEffect, useState } from "react";
import { MODEL_CHANGED_EVENT } from "@/components/workspace/useModelCatalog";
import type { ModelCatalog } from "@/lib/models/catalog";

interface ModelSelectorProps {
  variant?: "compact" | "panel";
}

type LoadState = "loading" | "ready" | "error";

type CatalogResult =
  | { ok: true; catalog: ModelCatalog }
  | { ok: false; error: string };

const NOT_INSTALLED_SUFFIX = " (not installed)";

async function fetchCatalog(): Promise<CatalogResult> {
  try {
    const response = await fetch("/api/models", { cache: "no-store" });
    const data = (await response.json().catch(() => null)) as ModelCatalog | null;
    if (!response.ok || !data) {
      return { ok: false, error: "Could not read the local model list." };
    }
    return { ok: true, catalog: data };
  } catch {
    return { ok: false, error: "Couldn't reach the local server." };
  }
}

export function ModelSelector({ variant = "compact" }: ModelSelectorProps) {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const apply = useCallback((result: CatalogResult) => {
    if (result.ok) {
      setCatalog(result.catalog);
      setError(null);
      setState("ready");
    } else {
      setError(result.error);
      setState("error");
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await fetchCatalog();
      if (active) apply(result);
    })();
    return () => {
      active = false;
    };
  }, [apply]);

  const refresh = useCallback(() => {
    setState("loading");
    void (async () => {
      apply(await fetchCatalog());
    })();
  }, [apply]);

  const select = useCallback(
    async (model: string) => {
      setSaving(true);
      setError(null);
      try {
        const response = await fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selectedModel: model }),
        });
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) {
          setError(data?.error ?? "Could not change the model.");
          return;
        }
        apply(await fetchCatalog());
        window.dispatchEvent(new Event(MODEL_CHANGED_EVENT));
      } catch {
        setError("Couldn't reach the local server.");
      } finally {
        setSaving(false);
      }
    },
    [apply],
  );

  const isPanel = variant === "panel";
  const selected = catalog?.selectedModel ?? "";
  const models = catalog?.models ?? [];
  const selectedKnown = models.includes(selected);

  const statusLabel =
    state === "loading"
      ? "Checking local models…"
      : state === "error"
        ? (error ?? "Model list unavailable.")
        : catalog?.status === "unavailable"
          ? (catalog.message ?? "Ollama is not reachable.")
          : catalog?.status === "empty"
            ? (catalog.message ?? "No local models are installed.")
            : null;

  return (
    <div className={isPanel ? "space-y-3" : "flex flex-wrap items-center gap-2"}>
      {state === "ready" && catalog?.status === "ok" ? (
        <select
          value={selected}
          onChange={(event) => void select(event.target.value)}
          disabled={saving}
          aria-label="Local model"
          className={`rounded-lg border border-[var(--line)] bg-[var(--surface-deep)] text-[var(--foreground)] outline-none focus:border-[var(--accent-border)] disabled:opacity-50 ${
            isPanel ? "w-full px-3 py-2 text-sm" : "max-w-[190px] px-2.5 py-1.5 text-xs"
          }`}
        >
          {!selectedKnown && selected ? (
            <option value={selected}>{`${selected}${NOT_INSTALLED_SUFFIX}`}</option>
          ) : null}
          {models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      ) : null}

      {isPanel ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={refresh}
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            Check again
          </button>
          {saving ? <span className="text-xs text-[var(--muted)]">Saving…</span> : null}
        </div>
      ) : state === "error" || catalog?.status !== "ok" ? (
        <button
          type="button"
          onClick={refresh}
          className="rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-xs text-[var(--muted)] transition hover:text-[var(--foreground)]"
        >
          Retry
        </button>
      ) : null}

      {statusLabel ? (
        <p
          role={state === "error" ? "alert" : undefined}
          className={`${isPanel ? "text-sm" : "text-[11px]"} ${
            state === "error" ? "text-[var(--accent-text)]" : "text-[var(--muted)]"
          }`}
        >
          {statusLabel}
        </p>
      ) : null}

      {isPanel && catalog?.status === "ok" ? (
        <p className="text-xs text-[var(--muted)]">
          {selectedKnown
            ? `${models.length} local model${models.length === 1 ? "" : "s"} available.`
            : `The saved model “${selected}” is not installed. Choose an installed model.`}
        </p>
      ) : null}
    </div>
  );
}
