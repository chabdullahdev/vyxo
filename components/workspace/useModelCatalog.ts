"use client";

import { useCallback, useEffect, useState } from "react";
import type { ModelCatalog } from "@/lib/models/catalog";

export const MODEL_CHANGED_EVENT = "vyxo:model-changed";

type Result = { ok: true; catalog: ModelCatalog } | { ok: false };

export type CatalogState = "loading" | "ready" | "error";

/**
 * Reads the local model catalog and keeps it fresh: it re-checks when the
 * window regains focus (for example after installing Ollama) and when the
 * model is changed elsewhere in the app.
 */
export function useModelCatalog() {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [state, setState] = useState<CatalogState>("loading");

  const load = useCallback(async (): Promise<Result> => {
    try {
      const response = await fetch("/api/models", { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as ModelCatalog | null;
      if (!response.ok || !data) return { ok: false };
      return { ok: true, catalog: data };
    } catch {
      return { ok: false };
    }
  }, []);

  const apply = useCallback((result: Result) => {
    if (result.ok) {
      setCatalog(result.catalog);
      setState("ready");
    } else {
      setState("error");
    }
  }, []);

  const refresh = useCallback(async () => {
    apply(await load());
  }, [apply, load]);

  useEffect(() => {
    let active = true;
    const check = () => {
      void load().then((result) => {
        if (active) apply(result);
      });
    };
    check();
    window.addEventListener("focus", check);
    window.addEventListener(MODEL_CHANGED_EVENT, check);
    return () => {
      active = false;
      window.removeEventListener("focus", check);
      window.removeEventListener(MODEL_CHANGED_EVENT, check);
    };
  }, [apply, load]);

  return { catalog, state, refresh };
}
