import {
  buildModelCatalog,
  discoverInstalledModels,
  type ModelDiscovery,
} from "./catalog.ts";
import type { SettingsStore } from "../settings/store.ts";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
};

export async function getModelCatalogResponse(
  store: SettingsStore,
  discover: () => Promise<ModelDiscovery> = discoverInstalledModels,
): Promise<Response> {
  let selectedModel: string;
  try {
    selectedModel = (await store.getSettings()).selectedModel;
  } catch {
    return new Response(JSON.stringify({ error: "The settings store is unavailable." }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }

  const discovery = await discover();
  const catalog = buildModelCatalog(selectedModel, discovery);
  return new Response(JSON.stringify(catalog), { status: 200, headers: JSON_HEADERS });
}
