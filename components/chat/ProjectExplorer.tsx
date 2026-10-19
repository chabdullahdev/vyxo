"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  chooseProjectFolder,
  listProjectDirectory,
  supportsProjectFolderPicker,
  type ProjectDirectoryHandle,
  type ProjectTreeEntry,
  type SelectedProjectFile,
} from "@/lib/project/browser";
import {
  PROJECT_MAX_DIRECTORY_DEPTH,
  PROJECT_MAX_DIRECTORY_ENTRIES,
  PROJECT_MAX_SELECTED_FILES,
} from "@/lib/project/policy";

type TreeNode = ProjectTreeEntry & {
  children?: TreeNode[];
  loaded?: boolean;
};

const TREE_INDENT_CLASSES = [
  "pl-[0.5rem]",
  "pl-[1.35rem]",
  "pl-[2.2rem]",
  "pl-[3.05rem]",
  "pl-[3.9rem]",
  "pl-[4.75rem]",
  "pl-[5.6rem]",
  "pl-[6.45rem]",
  "pl-[7.3rem]",
];

function treeIndentClass(depth: number): string {
  return TREE_INDENT_CLASSES[Math.min(depth, TREE_INDENT_CLASSES.length - 1)];
}

interface ProjectExplorerProps {
  disabled: boolean;
  onSelectionChange: (
    projectName: string | null,
    files: SelectedProjectFile[],
  ) => void;
}

function updateTree(
  entries: TreeNode[],
  path: string,
  update: (entry: TreeNode) => TreeNode,
): TreeNode[] {
  return entries.map((entry) => {
    if (entry.path === path) return update(entry);
    if (entry.kind === "directory" && entry.children) {
      return { ...entry, children: updateTree(entry.children, path, update) };
    }
    return entry;
  });
}

function TreeRows({
  entries,
  depth,
  selectedFiles,
  expandedPaths,
  loadingPaths,
  disabled,
  onToggleDirectory,
  onToggleFile,
}: {
  entries: TreeNode[];
  depth: number;
  selectedFiles: ReadonlyMap<string, SelectedProjectFile>;
  expandedPaths: ReadonlySet<string>;
  loadingPaths: ReadonlySet<string>;
  disabled: boolean;
  onToggleDirectory: (entry: Extract<TreeNode, { kind: "directory" }>) => void;
  onToggleFile: (entry: Extract<TreeNode, { kind: "file" }>) => void;
}) {
  return (
    <ul className="space-y-1" role="group">
      {entries.map((entry) => {
        if (entry.kind === "directory") {
          const isExpanded = expandedPaths.has(entry.path);
          const isLoading = loadingPaths.has(entry.path);
          return (
            <li key={entry.path}>
              <button
                type="button"
                aria-expanded={isExpanded}
                disabled={disabled || entry.depthLimited}
                onClick={() => onToggleDirectory(entry)}
                className={`flex w-full items-center gap-2 rounded-md pr-2 py-1.5 text-left text-sm text-[var(--foreground)] transition hover:bg-[var(--foreground)]/5 disabled:cursor-not-allowed disabled:opacity-55 ${treeIndentClass(depth)}`}
              >
                <span aria-hidden="true" className="w-3 text-[var(--muted)]">
                  {isLoading ? "…" : isExpanded ? "⌄" : "›"}
                </span>
                <span aria-hidden="true" className="text-[var(--accent-text)]">
                  ▰
                </span>
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                {entry.depthLimited ? (
                  <span className="text-xs text-[var(--muted)]">
                    depth limit
                  </span>
                ) : null}
              </button>
              {isExpanded && entry.children ? (
                entry.children.length > 0 ? (
                  <TreeRows
                    entries={entry.children}
                    depth={depth + 1}
                    selectedFiles={selectedFiles}
                    expandedPaths={expandedPaths}
                    loadingPaths={loadingPaths}
                    disabled={disabled}
                    onToggleDirectory={onToggleDirectory}
                    onToggleFile={onToggleFile}
                  />
                ) : (
                  <p
                    className={`pr-3 py-2 text-xs text-[var(--muted)] ${treeIndentClass(depth + 1)}`}
                  >
                    This folder has no permitted files.
                  </p>
                )
              ) : null}
            </li>
          );
        }

        const isAllowed = entry.fileStatus === "allowed";
        const isSelected = selectedFiles.has(entry.path);
        return (
          <li key={entry.path}>
            <label
              className={`flex items-center gap-2 rounded-md pr-2 py-1.5 text-sm text-[var(--foreground)] hover:bg-[var(--foreground)]/5 ${treeIndentClass(depth)}`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                disabled={disabled || !isAllowed}
                onChange={() => onToggleFile(entry)}
                aria-label={`${isSelected ? "Remove" : "Add"} ${entry.path} ${isAllowed ? "to" : "from"} chat context`}
                className="h-4 w-4 accent-[var(--foreground)] disabled:cursor-not-allowed"
              />
              <span className="w-10 shrink-0 font-mono text-[10px] text-[var(--muted)]">
                {entry.fileType}
              </span>
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {!isAllowed ? (
                <span className="shrink-0 text-xs text-[var(--muted)]">
                  {entry.fileStatus === "sensitive"
                    ? "Blocked · sensitive"
                    : "Unsupported type"}
                </span>
              ) : null}
              {isSelected ? (
                <span className="shrink-0 text-xs font-medium text-[var(--accent-text)]">
                  In context
                </span>
              ) : null}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

export function ProjectExplorer({
  disabled,
  onSelectionChange,
}: ProjectExplorerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [pickerSupported, setPickerSupported] = useState<boolean | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<
    Map<string, SelectedProjectFile>
  >(() => new Map());
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [isChoosing, setIsChoosing] = useState(false);
  const [listingTruncated, setListingTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rootRef = useRef<ProjectDirectoryHandle | null>(null);
  const generationRef = useRef(0);
  const entryBudgetRef = useRef({ remaining: PROJECT_MAX_DIRECTORY_ENTRIES });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPickerSupported(supportsProjectFolderPicker());
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const resetProject = useCallback(() => {
    generationRef.current += 1;
    rootRef.current = null;
    entryBudgetRef.current = { remaining: PROJECT_MAX_DIRECTORY_ENTRIES };
    setProjectName(null);
    setTree([]);
    setSelectedFiles(new Map());
    setExpandedPaths(new Set());
    setLoadingPaths(new Set());
    setListingTruncated(false);
    setError(null);
    onSelectionChange(null, []);
  }, [onSelectionChange]);

  const chooseFolder = useCallback(async () => {
    setError(null);
    setIsChoosing(true);
    // Show the result (the file tree, or an error) even if the panel was collapsed.
    setIsOpen(true);
    try {
      const root = await chooseProjectFolder();
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      rootRef.current = root;
      entryBudgetRef.current = { remaining: PROJECT_MAX_DIRECTORY_ENTRIES };
      setProjectName(root.name);
      setTree([]);
      setSelectedFiles(new Map());
      setExpandedPaths(new Set());
      setLoadingPaths(new Set());
      setListingTruncated(false);
      onSelectionChange(root.name, []);

      const listing = await listProjectDirectory(
        root,
        "",
        0,
        entryBudgetRef.current,
      );
      if (generation !== generationRef.current) return;
      setTree(listing.entries);
      setListingTruncated(listing.truncated);
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") return;
      setError(
        caught instanceof Error
          ? caught.message
          : "The selected folder could not be opened.",
      );
    } finally {
      setIsChoosing(false);
    }
  }, [onSelectionChange]);

  const toggleDirectory = useCallback(
    async (entry: Extract<TreeNode, { kind: "directory" }>) => {
      if (!rootRef.current || entry.depthLimited || disabled) return;
      if (expandedPaths.has(entry.path)) {
        setExpandedPaths((previous) => {
          const next = new Set(previous);
          next.delete(entry.path);
          return next;
        });
        return;
      }

      setExpandedPaths((previous) => new Set(previous).add(entry.path));
      if (entry.loaded) return;

      const generation = generationRef.current;
      setLoadingPaths((previous) => new Set(previous).add(entry.path));
      try {
        const listing = await listProjectDirectory(
          entry.handle,
          entry.path,
          entry.depth,
          entryBudgetRef.current,
        );
        if (generation !== generationRef.current) return;
        setTree((previous) =>
          updateTree(previous, entry.path, (current) => ({
            ...current,
            children: listing.entries,
            loaded: true,
          })),
        );
        setListingTruncated((previous) => previous || listing.truncated);
      } catch {
        if (generation !== generationRef.current) return;
        setError("This folder could not be listed. Try closing and reopening it.");
        setExpandedPaths((previous) => {
          const next = new Set(previous);
          next.delete(entry.path);
          return next;
        });
      } finally {
        if (generation !== generationRef.current) return;
        setLoadingPaths((previous) => {
          const next = new Set(previous);
          next.delete(entry.path);
          return next;
        });
      }
    },
    [disabled, expandedPaths],
  );

  const toggleFile = useCallback(
    (entry: Extract<TreeNode, { kind: "file" }>) => {
      if (!rootRef.current || disabled || entry.fileStatus !== "allowed") return;
      const next = new Map(selectedFiles);
      if (next.has(entry.path)) {
        next.delete(entry.path);
      } else {
        if (next.size >= PROJECT_MAX_SELECTED_FILES) {
          setError(
            `Choose up to ${PROJECT_MAX_SELECTED_FILES} files at a time.`,
          );
          return;
        }
        next.set(entry.path, { path: entry.path, handle: entry.handle });
      }
      setSelectedFiles(next);
      setError(null);
      onSelectionChange(projectName, [...next.values()]);
    },
    [disabled, onSelectionChange, projectName, selectedFiles],
  );

  const removeSelectedFile = useCallback(
    (path: string) => {
      const next = new Map(selectedFiles);
      next.delete(path);
      setSelectedFiles(next);
      onSelectionChange(projectName, [...next.values()]);
    },
    [onSelectionChange, projectName, selectedFiles],
  );

  const clearSelectedFiles = useCallback(() => {
    setSelectedFiles(new Map());
    onSelectionChange(projectName, []);
    setError(null);
  }, [onSelectionChange, projectName]);

  return (
    <section
      aria-label="Project file explorer"
      className="mb-3 rounded-xl border border-[var(--foreground)]/10 bg-[var(--background)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          <span aria-hidden="true" className="text-[var(--muted)]">
            {isOpen ? "⌄" : "›"}
          </span>
          <span className="font-[family-name:var(--font-display)] text-sm font-semibold text-[var(--foreground)]">
            Project files
          </span>
          {selectedFiles.size > 0 ? (
            <span className="rounded-full bg-[var(--foreground)]/8 px-2 py-0.5 text-xs text-[var(--foreground)]">
              {selectedFiles.size} selected
            </span>
          ) : null}
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {projectName ? (
            <>
              <span className="max-w-40 truncate text-sm text-[var(--muted)]" title={projectName}>
                {projectName}
              </span>
              <button
                type="button"
                onClick={() => void chooseFolder()}
                disabled={disabled || isChoosing || pickerSupported === false}
                className="rounded-md border border-[var(--foreground)]/15 px-2.5 py-1.5 text-xs font-medium text-[var(--foreground)] transition hover:bg-[var(--foreground)]/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Change folder
              </button>
              <button
                type="button"
                onClick={resetProject}
                disabled={disabled || isChoosing}
                className="rounded-md border border-[var(--foreground)]/15 px-2.5 py-1.5 text-xs text-[var(--muted)] transition hover:bg-[var(--foreground)]/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Clear project
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void chooseFolder()}
              disabled={disabled || isChoosing || pickerSupported === false}
              className="rounded-md bg-[var(--foreground)] px-3 py-2 text-xs font-medium text-[var(--background)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isChoosing ? "Opening folder…" : "Choose project folder"}
            </button>
          )}
        </div>
      </div>

      {isOpen ? (
        <div className="border-t border-[var(--foreground)]/10 px-4 py-3">
          {pickerSupported === false ? (
            <p className="mb-3 rounded-md border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-3 py-2 text-xs text-[var(--muted)]">
              Folder picking is not supported in this browser. Use a current
              version of Chrome or Edge. No server-side folder path is used.
            </p>
          ) : null}

          {projectName ? (
            <>
              <p className="mb-2 text-xs text-[var(--muted)]">
                Folder access is read-only. Only checked files are read when you
                send a message. Clear project drops this app&apos;s folder handle;
                your browser may retain its permission until you remove it in
                site settings.
              </p>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--foreground)]/10 p-1">
                {tree.length > 0 ? (
                  <TreeRows
                    entries={tree}
                    depth={0}
                    selectedFiles={selectedFiles}
                    expandedPaths={expandedPaths}
                    loadingPaths={loadingPaths}
                    disabled={disabled || isChoosing}
                    onToggleDirectory={(entry) => void toggleDirectory(entry)}
                    onToggleFile={toggleFile}
                  />
                ) : (
                  <p className="px-3 py-3 text-sm text-[var(--muted)]">
                    {isChoosing
                      ? "Reading the folder list…"
                      : "No permitted files are visible in this folder."}
                  </p>
                )}
              </div>
              {listingTruncated ? (
                <p className="mt-2 text-xs text-[var(--muted)]">
                  The listing limit was reached ({PROJECT_MAX_DIRECTORY_ENTRIES}
                  entries, depth {PROJECT_MAX_DIRECTORY_DEPTH}). Some folders
                  may not be shown.
                </p>
              ) : null}

              {selectedFiles.size > 0 ? (
                <div className="mt-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-xs font-medium text-[var(--foreground)]">
                      Selected for chat context
                    </p>
                    <button
                      type="button"
                      onClick={clearSelectedFiles}
                      disabled={disabled}
                      className="text-xs text-[var(--muted)] underline underline-offset-2 hover:text-[var(--foreground)] disabled:opacity-50"
                    >
                      Remove all
                    </button>
                  </div>
                  <ul className="flex flex-wrap gap-2">
                    {[...selectedFiles.values()].map((file) => (
                      <li
                        key={file.path}
                        className="flex max-w-full items-center gap-2 rounded-md border border-[var(--foreground)]/10 px-2 py-1 text-xs"
                      >
                        <span className="max-w-64 truncate font-mono text-[var(--foreground)]">
                          {file.path}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeSelectedFile(file.path)}
                          disabled={disabled}
                          aria-label={`Remove ${file.path} from chat context`}
                          className="text-[var(--muted)] hover:text-[var(--accent-text)] disabled:opacity-50"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : pickerSupported !== false ? (
            <p className="text-xs text-[var(--muted)]">
              Choose one folder, then open folders and check only the files you
              want the local model to read.
            </p>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="mt-3 rounded-md border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-3 py-2 text-xs text-[var(--accent-text)]"
            >
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
