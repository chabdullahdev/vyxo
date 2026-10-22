export type RequestResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Fetch JSON and turn every failure into a message a person can read. */
export async function requestJson<T>(url: string, options?: RequestInit): Promise<RequestResult<T>> {
  try {
    const response = await fetch(url, options);
    const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!response.ok) {
      return { ok: false, error: data?.error ?? `Request failed (status ${response.status}).` };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Is the app still running?" };
  }
}

export function postJson<T>(url: string, body: unknown): Promise<RequestResult<T>> {
  return requestJson<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export interface WorkspaceInfo {
  projectId: string;
  name: string;
  folder: string;
  template: string | null;
  templateLabel: string | null;
  previewable: boolean;
  fileCount: number;
  trashCount: number;
  markerOk: boolean;
}
