"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { postJson, requestJson } from "@/components/projects/workspace/request";

interface DirectoryEntry {
  name: string;
  path: string;
  kind: "directory" | "file" | "symlink";
  status: "allowed" | "unsupported" | "sensitive";
}

interface DirectoryListing {
  path: string;
  entries: DirectoryEntry[];
  truncated: boolean;
}

interface TrashEntry {
  id: string;
  name: string;
  originalPath: string;
  kind: "file" | "directory";
  trashedAt: string;
}

type Pending = { kind: "file" | "folder" } | { rename: string } | null;

/** Folders a Next.js site creates for itself. They are generated, so the Files tab hides them. */
const GENERATED_AT_ROOT = new Set(["node_modules", ".next", "out"]);

function joinPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}

function parentOf(folder: string): string {
  const index = folder.lastIndexOf("/");
  return index === -1 ? "" : folder.slice(0, index);
}

/** Browse the project's files, open text files, and make simple changes. Deleted items go to Trash first. */
export function WorkspaceFiles({ projectId, refreshKey }: { projectId: string; refreshKey: number }) {
  const base = `/api/projects/${encodeURIComponent(projectId)}`;
  const [folder, setFolder] = useState("");
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [openFile, setOpenFile] = useState<{ path: string; content: string } | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [draftName, setDraftName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [list, bin] = await Promise.all([
        requestJson<DirectoryListing>(`${base}/files?path=${encodeURIComponent(folder)}`),
        requestJson<{ entries: TrashEntry[] }>(`${base}/workspace/trash`),
      ]);
      if (!active) return;
      if (list.ok) {
        setListing(list.data);
        setListError(null);
      } else {
        setListError(list.error);
      }
      if (bin.ok) setTrash(bin.data.entries);
    })();
    return () => {
      active = false;
    };
  }, [base, folder, refreshKey, refreshToken]);

  const refresh = useCallback(() => setRefreshToken((value) => value + 1), []);

  const run = async (action: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage(done);
    setPending(null);
    setDraftName("");
    refresh();
  };

  const workspaceAction = (body: Record<string, unknown>) =>
    postJson<unknown>(`${base}/workspace/files`, body).then((result) =>
      result.ok ? { ok: true as const } : { ok: false as const, error: result.error },
    );

  const submitDraft = () => {
    const name = draftName.trim();
    if (!pending || name.length === 0) return;
    if ("rename" in pending) {
      void run(
        () => workspaceAction({ action: "rename", from: pending.rename, to: joinPath(parentOf(pending.rename), name) }),
        "Renamed.",
      );
      return;
    }
    const path = joinPath(folder, name);
    void run(
      () => workspaceAction({ action: pending.kind === "file" ? "create-file" : "create-folder", path, content: "" }),
      pending.kind === "file" ? "File created." : "Folder created.",
    );
  };

  // Trash is reversible (see Restore below), so this does not ask for confirmation.
  const moveToTrash = (entry: DirectoryEntry) => {
    void run(() => workspaceAction({ action: "trash", path: entry.path }), `“${entry.name}” moved to Trash.`);
  };

  const openFileAt = async (entry: DirectoryEntry) => {
    setOpenError(null);
    const result = await requestJson<{ path: string; content: string }>(
      `${base}/files/read?path=${encodeURIComponent(entry.path)}`,
    );
    if (result.ok) setOpenFile({ path: result.data.path, content: result.data.content });
    else setOpenError(result.error);
  };

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const form = new FormData();
    form.set("folder", folder);
    for (const file of Array.from(files)) form.append("files", file);
    try {
      const response = await fetch(`${base}/workspace/upload`, { method: "POST", body: form });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) setError(data?.error ?? `Upload failed (status ${response.status}).`);
      else setMessage(`Added ${files.length} file${files.length === 1 ? "" : "s"}.`);
    } catch {
      setError("Couldn't reach the server. Is the app still running?");
    }
    setBusy(false);
    if (uploadRef.current) uploadRef.current.value = "";
    refresh();
  };

  const crumbs = folder ? folder.split("/") : [];

  return (
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_1fr]">
      <section aria-label="Project files" className="min-h-0 space-y-3 overflow-y-auto">
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Folder path" className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-xs">
            <button type="button" onClick={() => setFolder("")} className="rounded px-1 text-[var(--foreground)] hover:bg-[var(--surface-hover)]">
              Project
            </button>
            {crumbs.map((crumb, index) => {
              const target = crumbs.slice(0, index + 1).join("/");
              return (
                <span key={target} className="flex items-center gap-1">
                  <span className="text-[var(--muted)]">/</span>
                  <button type="button" onClick={() => setFolder(target)} className="rounded px-1 text-[var(--foreground)] hover:bg-[var(--surface-hover)]">
                    {crumb}
                  </button>
                </span>
              );
            })}
          </nav>
          <button type="button" disabled={busy} onClick={() => setPending({ kind: "file" })} className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--foreground)] transition hover:bg-[var(--surface-hover)] disabled:opacity-40">
            New file
          </button>
          <button type="button" disabled={busy} onClick={() => setPending({ kind: "folder" })} className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--foreground)] transition hover:bg-[var(--surface-hover)] disabled:opacity-40">
            New folder
          </button>
          <button type="button" disabled={busy} onClick={() => uploadRef.current?.click()} className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--foreground)] transition hover:bg-[var(--surface-hover)] disabled:opacity-40">
            Add files
          </button>
          <input ref={uploadRef} type="file" multiple className="sr-only" aria-label="Choose files to add" onChange={(event) => void upload(event.target.files)} />
        </div>

        {pending ? (
          <div className="flex flex-wrap gap-2 rounded-lg border border-[var(--line)] p-3">
            <input
              autoFocus
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitDraft();
                if (event.key === "Escape") setPending(null);
              }}
              placeholder={"rename" in pending ? "New name" : pending.kind === "file" ? "File name, e.g. notes.md" : "Folder name"}
              aria-label={"rename" in pending ? "New name" : "Name"}
              maxLength={200}
              className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface-deep)] px-3 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent-border)]"
            />
            <button type="button" onClick={() => setPending(null)} className="rounded-lg px-3 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)]">
              Cancel
            </button>
            <button type="button" onClick={submitDraft} disabled={busy || draftName.trim().length === 0} className="rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-xs font-medium text-[var(--background)] disabled:opacity-40">
              Save
            </button>
          </div>
        ) : null}

        {error ? <p role="alert" className="rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 py-2 text-xs text-[var(--accent-text)]">{error}</p> : null}
        {message ? <p role="status" className="text-xs text-[var(--muted)]">{message}</p> : null}
        {listError ? (
          <div className="flex items-center gap-3">
            <p className="text-sm text-[var(--accent-text)]">{listError}</p>
            <button type="button" onClick={refresh} className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--foreground)]">Try again</button>
          </div>
        ) : null}

        {listing && listing.entries.length === 0 && !listError ? (
          <p className="rounded-xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">This folder is empty.</p>
        ) : null}

        {listing && listing.entries.length > 0 ? (
          <ul className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)]">
            {listing.entries
              .filter((entry) => !(folder === "" && GENERATED_AT_ROOT.has(entry.name)))
              .map((entry) => {
              const isFolder = entry.kind === "directory";
              const canOpen = entry.kind === "file" && entry.status === "allowed";
              const renaming = pending !== null && "rename" in pending && pending.rename === entry.path;
              return (
                <li key={entry.path} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  {renaming ? null : (
                    <button
                      type="button"
                      disabled={!isFolder && !canOpen}
                      onClick={() => (isFolder ? setFolder(entry.path) : void openFileAt(entry))}
                      className="min-w-0 flex-1 truncate text-left text-sm text-[var(--foreground)] disabled:text-[var(--muted)]"
                    >
                      {isFolder ? "📁 " : ""}{entry.name}
                      {entry.status === "sensitive" ? <span className="ml-2 text-xs text-[var(--muted)]">(private, not shown)</span> : null}
                      {entry.status === "unsupported" ? <span className="ml-2 text-xs text-[var(--muted)]">(can&apos;t open this type)</span> : null}
                    </button>
                  )}
                  <div className="flex gap-2">
                    <button type="button" disabled={busy} onClick={() => { setPending({ rename: entry.path }); setDraftName(entry.name); }} className="rounded-md border border-[var(--line)] px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-40">
                      Rename
                    </button>
                    <button type="button" disabled={busy} onClick={() => moveToTrash(entry)} className="rounded-md border border-[var(--line)] px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-40">
                      Move to Trash
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
        {listing?.truncated ? <p className="text-xs text-[var(--muted)]">Only the first items are shown.</p> : null}
      </section>

      <section aria-label="File contents and trash" className="min-h-0 space-y-4 overflow-y-auto">
        {openError ? <p role="alert" className="text-sm text-[var(--accent-text)]">{openError}</p> : null}
        {openFile ? (
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="truncate font-mono text-xs text-[var(--foreground)]">{openFile.path}</p>
              <button type="button" onClick={() => setOpenFile(null)} className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]">Close</button>
            </div>
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-[var(--foreground)]">{openFile.content || "(empty file)"}</pre>
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">Click a file on the left to read it here.</p>
        )}

        <div className="rounded-xl border border-[var(--line)] p-3">
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={() => setShowTrash((value) => !value)} aria-expanded={showTrash} className="text-xs font-medium text-[var(--foreground)]">
              Trash ({trash.length})
            </button>
            {trash.length > 0 && showTrash ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => workspaceAction({ action: "empty-trash" }), "Trash emptied.")}
                className="rounded-md border border-[var(--line)] px-2 py-1 text-[11px] text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-40"
              >
                Empty Trash
              </button>
            ) : null}
          </div>
          {showTrash ? (
            trash.length === 0 ? (
              <p className="mt-2 text-xs text-[var(--muted)]">Nothing in Trash.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {trash.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate font-mono text-[var(--muted)]">{entry.originalPath}</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(() => workspaceAction({ action: "restore", trashId: entry.id }), `“${entry.name}” restored.`)}
                      className="rounded-md border border-[var(--line)] px-2 py-1 text-[11px] text-[var(--foreground)] hover:bg-[var(--surface-hover)] disabled:opacity-40"
                    >
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      </section>
    </div>
  );
}
