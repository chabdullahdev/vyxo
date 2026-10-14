"use client";

import { useState } from "react";
import {
  DEFAULT_MAX_PROJECT_CONTEXT_CHARS,
  PROJECT_CONTEXT_FIELD_LIMITS,
  projectContextIsEmpty,
  type ProjectContext,
} from "@/lib/projects/context";
import type { Project } from "@/lib/projects/store";

type SaveState = "idle" | "saving" | "saved" | "error";

const FIELDS: ReadonlyArray<{
  key: keyof ProjectContext;
  label: string;
  hint: string;
  rows: number;
}> = [
  { key: "purpose", label: "Purpose", hint: "What this project is and why it exists.", rows: 2 },
  { key: "goals", label: "Goals", hint: "What you want to accomplish.", rows: 3 },
  {
    key: "techStack",
    label: "Technology stack",
    hint: "Languages, frameworks, services, and tools.",
    rows: 2,
  },
  {
    key: "instructions",
    label: "Custom instructions",
    hint: "How VYXO should behave here — preferences only, not permissions.",
    rows: 4,
  },
  { key: "notes", label: "Notes", hint: "Anything else worth keeping with this project.", rows: 5 },
];

export function ProjectContextEditor({
  project,
  onSaved,
}: {
  project: Project;
  onSaved: (project: Project) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProjectContext>(project.context);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  const total = FIELDS.reduce((sum, field) => sum + draft[field.key].length, 0);
  const overLimit =
    FIELDS.some((field) => draft[field.key].length > PROJECT_CONTEXT_FIELD_LIMITS[field.key]) ||
    total > DEFAULT_MAX_PROJECT_CONTEXT_CHARS;

  const startEdit = () => {
    setDraft(project.context);
    setEditing(true);
    setError(null);
    setSaveState("idle");
  };

  const cancelEdit = () => {
    setEditing(false);
    setError(null);
    setSaveState("idle");
  };

  const save = async () => {
    if (overLimit) return;
    setSaveState("saving");
    setError(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: draft }),
      });
      const data = (await response.json().catch(() => null)) as
        | { project?: Project; error?: string }
        | null;
      if (!response.ok || !data?.project) {
        setError(data?.error ?? "Could not save the project context.");
        setSaveState("error");
        return;
      }
      onSaved(data.project);
      setEditing(false);
      setSaveState("saved");
    } catch {
      setError("Couldn't reach the server. Is the app still running?");
      setSaveState("error");
    }
  };

  const empty = projectContextIsEmpty(project.context);

  return (
    <section
      aria-label="Project context"
      className="mb-4 rounded-xl border border-[var(--line)] bg-[var(--surface-deep)]/40 p-4"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-[family-name:var(--font-display)] text-sm font-medium text-[var(--foreground)]">
            Project context
          </h4>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            VYXO uses this as background when you chat in this project.
          </p>
        </div>
        {editing ? null : (
          <div className="flex items-center gap-3">
            {saveState === "saved" ? (
              <span className="text-xs text-[var(--accent)]">Saved</span>
            ) : null}
            <button
              type="button"
              onClick={startEdit}
              className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              {empty ? "Add context" : "Edit context"}
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="space-y-4">
          {FIELDS.map((field) => {
            const value = draft[field.key];
            const limit = PROJECT_CONTEXT_FIELD_LIMITS[field.key];
            const fieldOver = value.length > limit;
            return (
              <div key={field.key}>
                <div className="mb-1 flex items-center justify-between gap-3">
                  <label
                    htmlFor={`context-${field.key}`}
                    className="text-xs font-medium text-[var(--foreground)]"
                  >
                    {field.label}
                  </label>
                  <span className={`text-[10px] ${fieldOver ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}>
                    {value.length}/{limit}
                  </span>
                </div>
                <p className="mb-1 text-[11px] text-[var(--muted)]">{field.hint}</p>
                <textarea
                  id={`context-${field.key}`}
                  value={value}
                  rows={field.rows}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))
                  }
                  className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent-border)]"
                />
              </div>
            );
          })}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className={`text-[11px] ${overLimit ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}>
              {total}/{DEFAULT_MAX_PROJECT_CONTEXT_CHARS} characters total
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={cancelEdit}
                disabled={saveState === "saving"}
                className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={overLimit || saveState === "saving"}
                className="rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-sm font-medium text-[var(--background)] transition hover:bg-[var(--silver)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saveState === "saving" ? "Saving…" : "Save context"}
              </button>
            </div>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-[var(--accent)]">
              {error}
            </p>
          ) : null}
        </div>
      ) : empty ? (
        <p className="text-sm text-[var(--muted)]">
          No context yet. Add a purpose, goals, or notes so VYXO can use them in this project.
        </p>
      ) : (
        <div className="space-y-3">
          {FIELDS.map((field) => {
            const value = project.context[field.key].trim();
            if (value.length === 0) return null;
            return (
              <div key={field.key}>
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">
                  {field.label}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--foreground)]">{value}</p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
