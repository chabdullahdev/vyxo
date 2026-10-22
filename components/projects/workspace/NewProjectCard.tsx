"use client";

import { useEffect, useState } from "react";
import { requestJson } from "@/components/projects/workspace/request";

interface TemplateOption {
  id: string;
  label: string;
  tagline: string;
  suits: string;
  previewable: boolean;
}

interface TemplatesResponse {
  projectsFolder: string;
  templates: TemplateOption[];
}

export interface NewProjectValues {
  name: string;
  description: string;
  kind: "managed" | "connected";
  template: string;
  /** For a website: what it is for. VYXO writes a first draft from it for review. */
  brief: string;
}

const inputClass =
  "rounded-lg border border-[var(--line)] bg-[var(--surface-deep)] px-3 py-2 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent-border)]";

/** The "New project" form: a workspace VYXO looks after (default), or a folder you already have. */
export function NewProjectCard({
  creating,
  error,
  onCreate,
}: {
  creating: boolean;
  error: string | null;
  onCreate: (values: NewProjectValues) => void;
}) {
  const [kind, setKind] = useState<"managed" | "connected">("managed");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState("blank");
  const [brief, setBrief] = useState("");
  const [data, setData] = useState<TemplatesResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await requestJson<TemplatesResponse>("/api/projects/templates");
      if (!active) return;
      if (result.ok) setData(result.data);
      else setFailed(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  const submit = () => {
    if (name.trim().length === 0 || creating) return;
    onCreate({
      name: name.trim(),
      description: description.trim(),
      kind,
      template,
      brief: template.startsWith("website") ? brief.trim() : "",
    });
  };

  return (
    <section aria-labelledby="new-project-heading" className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <h3 id="new-project-heading" className="font-[family-name:var(--font-display)] text-base font-medium text-[var(--foreground)]">
        New project
      </h3>

      <div role="group" aria-label="Project type" className="mt-3 inline-flex rounded-lg border border-[var(--line)] p-1">
        {(
          [
            ["managed", "Workspace"],
            ["connected", "Existing folder"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            onClick={() => setKind(value)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              kind === value ? "bg-[var(--foreground)] text-[var(--background)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-2 max-w-2xl text-xs leading-5 text-[var(--muted)]">
        {kind === "managed"
          ? `VYXO creates a folder for this project${data ? ` in ${data.projectsFolder}` : ""} and looks after its files. You get a private chat, a file manager, and changes you review before they are applied.`
          : "Point VYXO at a folder you already have. It can read the files you choose, and edits only happen after you approve them."}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1.4fr]">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
          placeholder="Project name"
          aria-label="New project name"
          maxLength={120}
          className={inputClass}
        />
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Short description (optional)"
          aria-label="New project description"
          maxLength={2000}
          className={inputClass}
        />
      </div>

      {kind === "managed" ? (
        <fieldset className="mt-4">
          <legend className="text-xs font-medium text-[var(--silver)]">Start from</legend>
          {failed ? (
            <p className="mt-2 text-xs text-[var(--accent-text)]">The starting points could not be loaded. A blank project will be created.</p>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(data?.templates ?? []).map((option) => (
                <label
                  key={option.id}
                  className={`cursor-pointer rounded-xl border p-3 text-left transition focus-within:ring-2 focus-within:ring-[var(--accent)] ${
                    template === option.id
                      ? "border-[var(--accent-border)] bg-[var(--accent-soft)]"
                      : "border-[var(--line)] hover:bg-[var(--surface-hover)]"
                  }`}
                >
                  <input
                    type="radio"
                    name="template"
                    value={option.id}
                    checked={template === option.id}
                    onChange={() => setTemplate(option.id)}
                    className="sr-only"
                  />
                  <span className="block text-sm font-medium text-[var(--foreground)]">{option.label}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--muted)]">{option.tagline}</span>
                  <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">{option.suits}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
      ) : null}

      {kind === "managed" && template.startsWith("website") ? (
        <div className="mt-4">
          <label htmlFor="site-brief" className="text-xs font-medium text-[var(--silver)]">
            Describe your site (optional)
          </label>
          <textarea
            id="site-brief"
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="For example: a website for my bakery in Lahore, with a menu, opening hours, and a contact form."
            rows={3}
            maxLength={2000}
            className={`${inputClass} mt-2 w-full resize-y`}
          />
          <p className="mt-1 text-xs text-[var(--muted)]">
            VYXO writes a first draft from this. You review it in the Changes tab before anything is saved.
          </p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 py-2 text-sm text-[var(--accent-text)]">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={name.trim().length === 0 || creating}
          className="rounded-lg bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--background)] transition hover:bg-[var(--silver)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {creating ? "Creating…" : kind === "managed" ? "Create workspace" : "Create project"}
        </button>
      </div>
    </section>
  );
}
