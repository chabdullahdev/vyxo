"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  DirectoryEntry,
  DirectoryListing,
  FileContent,
  SearchResults,
} from "@/lib/files/service";

interface FolderView {
  path: string;
  name: string;
  available: boolean;
}

type LoadState = "idle" | "loading" | "ready" | "failed";

async function requestJson<T>(
  url: string,
  options?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
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

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

export function ProjectFilesPanel({ projectId }: { projectId: string }) {
  const [folder, setFolder] = useState<FolderView | null>(null);
  const [folderState, setFolderState] = useState<LoadState>("idle");
  const [folderError, setFolderError] = useState<string | null>(null);

  const [pathInput, setPathInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const [currentDir, setCurrentDir] = useState("");
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [listingState, setListingState] = useState<LoadState>("idle");
  const [listingError, setListingError] = useState<string | null>(null);

  const [preview, setPreview] = useState<FileContent | null>(null);
  const [previewState, setPreviewState] = useState<LoadState>("idle");
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [searchState, setSearchState] = useState<LoadState>("idle");
  const [searchError, setSearchError] = useState<string | null>(null);

  const openDirectory = useCallback(
    async (path: string) => {
      setListingState("loading");
      setListingError(null);
      const result = await requestJson<DirectoryListing>(
        `/api/projects/${encodeURIComponent(projectId)}/files?path=${encodeURIComponent(path)}`,
      );
      if (!result.ok) {
        setListingError(result.error);
        setListingState("failed");
        return;
      }
      setCurrentDir(path);
      setListing(result.data);
      setListingState("ready");
    },
    [projectId],
  );

  const openFile = useCallback(
    async (path: string) => {
      setPreviewState("loading");
      setPreviewError(null);
      setPreview(null);
      const result = await requestJson<FileContent>(
        `/api/projects/${encodeURIComponent(projectId)}/files/read?path=${encodeURIComponent(path)}`,
      );
      if (!result.ok) {
        setPreviewError(result.error);
        setPreviewState("failed");
        return;
      }
      setPreview(result.data);
      setPreviewState("ready");
    },
    [projectId],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const status = await requestJson<{ folder: FolderView | null }>(
        `/api/projects/${encodeURIComponent(projectId)}/folder`,
      );
      if (!active) return;
      if (!status.ok) {
        setFolderError(status.error);
        setFolderState("failed");
        return;
      }
      setFolder(status.data.folder);
      setFolderState("ready");
      if (status.data.folder?.available) {
        const result = await requestJson<DirectoryListing>(
          `/api/projects/${encodeURIComponent(projectId)}/files?path=`,
        );
        if (!active) return;
        if (result.ok) {
          setListing(result.data);
          setListingState("ready");
        } else {
          setListingError(result.error);
          setListingState("failed");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId]);

  const connect = useCallback(async () => {
    const path = pathInput.trim();
    if (path.length === 0 || connecting) return;
    setConnecting(true);
    setConnectError(null);
    const result = await requestJson<{ folder: FolderView }>(
      `/api/projects/${encodeURIComponent(projectId)}/folder`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      },
    );
    setConnecting(false);
    if (!result.ok) {
      setConnectError(result.error);
      return;
    }
    setFolder(result.data.folder);
    setPathInput("");
    setPreview(null);
    setSearchResults(null);
    setConfirmDisconnect(false);
    await openDirectory("");
  }, [connecting, openDirectory, pathInput, projectId]);

  const disconnect = useCallback(async () => {
    setConnectError(null);
    const result = await requestJson<{ folder: null }>(
      `/api/projects/${encodeURIComponent(projectId)}/folder`,
      { method: "DELETE" },
    );
    setConfirmDisconnect(false);
    if (!result.ok) {
      setConnectError(result.error);
      return;
    }
    setFolder(null);
    setListing(null);
    setPreview(null);
    setSearchResults(null);
    setListingState("idle");
    setCurrentDir("");
  }, [projectId]);

  const search = useCallback(async () => {
    const query = searchQuery.trim();
    if (query.length === 0) return;
    setSearchState("loading");
    setSearchError(null);
    const result = await requestJson<SearchResults>(
      `/api/projects/${encodeURIComponent(projectId)}/files/search?q=${encodeURIComponent(query)}`,
    );
    if (!result.ok) {
      setSearchError(result.error);
      setSearchState("failed");
      return;
    }
    setSearchResults(result.data);
    setSearchState("ready");
  }, [projectId, searchQuery]);

  const connected = Boolean(folder);

  return (
    <section
      aria-label="Source code folder"
      className="mb-4 rounded-xl border border-[var(--line)] bg-[var(--surface-deep)]/40 p-4"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-[family-name:var(--font-display)] text-sm font-medium text-[var(--foreground)]">
            Source code folder
          </h4>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Read-only. VYXO can list, read, and search these files — it never edits them in this phase.
          </p>
        </div>
        {connected ? (
          <span className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
            <span
              className={`h-1.5 w-1.5 rounded-full ${folder?.available ? "bg-[var(--accent)]" : "bg-[var(--accent)]/40"}`}
            />
            {folder?.available ? "Connected" : "Unavailable"}
          </span>
        ) : null}
      </div>

      {folderState === "loading" ? (
        <p className="text-sm text-[var(--muted)]">Checking folder…</p>
      ) : null}

      {folderState === "failed" ? (
        <p role="alert" className="text-sm text-[var(--accent)]">
          {folderError}
        </p>
      ) : null}

      {folderState === "ready" && !connected ? (
        <div className="space-y-2">
          <label htmlFor={`folder-path-${projectId}`} className="block text-xs text-[var(--muted)]">
            Paste the absolute path of the folder to connect:
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id={`folder-path-${projectId}`}
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              placeholder="/Users/you/code/my-project"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2 font-mono text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent-border)]"
            />
            <button
              type="button"
              onClick={() => void connect()}
              disabled={connecting || pathInput.trim().length === 0}
              className="rounded-lg bg-[var(--foreground)] px-3 py-2 text-xs font-medium text-[var(--background)] transition hover:bg-[var(--silver)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {connecting ? "Connecting…" : "Connect folder"}
            </button>
          </div>
          <p className="text-[11px] text-[var(--muted)]">
            Native folder picking is not available in this build, so enter the path directly. Only this
            folder is ever read.
          </p>
        </div>
      ) : null}

      {connected ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2">
            <span className="min-w-0 truncate font-mono text-xs text-[var(--foreground)]" title={folder?.path}>
              {folder?.path}
            </span>
            {confirmDisconnect ? (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDisconnect(false)}
                  className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void disconnect()}
                  className="rounded-md bg-[var(--accent)] px-2 py-1 text-xs font-medium text-[var(--background)]"
                >
                  Disconnect
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDisconnect(true)}
                className="rounded-md border border-[var(--line)] px-2 py-1 text-xs text-[var(--muted)] transition hover:text-[var(--foreground)]"
              >
                Disconnect
              </button>
            )}
          </div>
          <p className="text-[11px] text-[var(--muted)]">
            Disconnecting removes VYXO&apos;s access only; it never changes or deletes files on disk.
          </p>

          <div className="flex flex-wrap gap-2">
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void search();
              }}
              placeholder="Search files and contents…"
              aria-label="Search project files"
              className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent-border)]"
            />
            <button
              type="button"
              onClick={() => void search()}
              disabled={searchState === "loading" || searchQuery.trim().length === 0}
              className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-hover)] disabled:opacity-40"
            >
              {searchState === "loading" ? "Searching…" : "Search"}
            </button>
          </div>

          {searchError ? (
            <p role="alert" className="text-sm text-[var(--accent)]">
              {searchError}
            </p>
          ) : null}

          {searchResults ? (
            searchResults.hits.length > 0 ? (
              <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-[var(--line)] p-1">
                {searchResults.hits.map((hit) => (
                  <li key={`${hit.path}:${hit.line}:${hit.preview}`}>
                    <button
                      type="button"
                      onClick={() => void openFile(hit.path)}
                      className="w-full rounded-md px-2 py-1.5 text-left text-xs transition hover:bg-[var(--surface-hover)]"
                    >
                      <span className="font-mono text-[var(--accent)]">
                        {hit.path}
                        {hit.line > 0 ? `:${hit.line}` : ""}
                      </span>
                      <span className="mt-0.5 block truncate text-[var(--muted)]">{hit.preview}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-[var(--muted)]">No matching files or text.</p>
            )
          ) : null}

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-[var(--line)] p-2">
              <div className="mb-2 flex items-center gap-2 text-xs text-[var(--muted)]">
                <button
                  type="button"
                  onClick={() => void openDirectory(parentPath(currentDir))}
                  disabled={currentDir.length === 0 || listingState === "loading"}
                  className="rounded-md border border-[var(--line)] px-2 py-0.5 transition hover:text-[var(--foreground)] disabled:opacity-40"
                >
                  Up
                </button>
                <span className="min-w-0 truncate font-mono">/{currentDir}</span>
              </div>
              {listingState === "loading" ? (
                <p className="p-2 text-xs text-[var(--muted)]">Loading…</p>
              ) : listingState === "failed" ? (
                <p role="alert" className="p-2 text-xs text-[var(--accent)]">
                  {listingError}
                </p>
              ) : listing && listing.entries.length > 0 ? (
                <ul className="max-h-64 space-y-0.5 overflow-y-auto">
                  {listing.entries.map((entry) => (
                    <li key={entry.path}>
                      <FileEntry entry={entry} onOpenDirectory={openDirectory} onOpenFile={openFile} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-2 text-xs text-[var(--muted)]">No permitted files here.</p>
              )}
              {listing?.truncated ? (
                <p className="px-2 pt-1 text-[10px] text-[var(--muted)]">Listing truncated.</p>
              ) : null}
            </div>

            <div className="rounded-lg border border-[var(--line)] p-2">
              {previewState === "idle" ? (
                <p className="p-2 text-xs text-[var(--muted)]">
                  Select a file to preview it (read-only).
                </p>
              ) : previewState === "loading" ? (
                <p className="p-2 text-xs text-[var(--muted)]">Reading…</p>
              ) : previewState === "failed" ? (
                <p role="alert" className="p-2 text-xs text-[var(--accent)]">
                  {previewError}
                </p>
              ) : preview ? (
                <div>
                  <p className="mb-1 truncate font-mono text-[11px] text-[var(--muted)]">{preview.path}</p>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--background)] p-2 font-mono text-[11px] text-[var(--foreground)]">
                    {preview.content}
                  </pre>
                </div>
              ) : null}
            </div>
          </div>

          {connectError ? (
            <p role="alert" className="text-sm text-[var(--accent)]">
              {connectError}
            </p>
          ) : null}
        </div>
      ) : null}

      {!connected && connectError ? (
        <p role="alert" className="mt-2 text-sm text-[var(--accent)]">
          {connectError}
        </p>
      ) : null}
    </section>
  );
}

function FileEntry({
  entry,
  onOpenDirectory,
  onOpenFile,
}: {
  entry: DirectoryEntry;
  onOpenDirectory: (path: string) => void;
  onOpenFile: (path: string) => void;
}) {
  if (entry.kind === "directory") {
    return (
      <button
        type="button"
        onClick={() => void onOpenDirectory(entry.path)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-[var(--foreground)] transition hover:bg-[var(--surface-hover)]"
      >
        <span aria-hidden="true" className="text-[var(--accent)]">
          ▸
        </span>
        <span className="truncate">{entry.name}</span>
      </button>
    );
  }

  const disabled = entry.status !== "allowed" || entry.kind === "symlink";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void onOpenFile(entry.path)}
      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs text-[var(--foreground)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="truncate font-mono">{entry.name}</span>
      {disabled ? (
        <span className="shrink-0 text-[10px] text-[var(--muted)]">
          {entry.kind === "symlink" ? "symlink" : entry.status === "sensitive" ? "blocked" : "unsupported"}
        </span>
      ) : null}
    </button>
  );
}
