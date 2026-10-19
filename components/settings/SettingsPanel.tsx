"use client";

import { useEffect, useState } from "react";
import { ModelSelector } from "@/components/settings/ModelSelector";

interface StorageInfo {
  directory: string;
  files: {
    memory: string;
    conversations: string;
    projects: string;
    settings: string;
  };
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6">
      <h3 className="font-[family-name:var(--font-display)] text-lg font-medium text-[var(--foreground)]">
        {title}
      </h3>
      <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function SettingsPanel() {
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/settings", { cache: "no-store" });
        const data = (await response.json().catch(() => null)) as { storage?: StorageInfo } | null;
        if (!active) return;
        if (!response.ok || !data?.storage) {
          setStorageError("Could not read the local storage locations.");
          return;
        }
        setStorage(data.storage);
        setStorageError(null);
      } catch {
        if (active) setStorageError("Couldn't reach the local server.");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-5">
      <Section
        title="Local model"
        description="VYXO talks to Ollama running on this Mac. Choose which installed model answers your messages. The selected model is used for every new response."
      >
        <ModelSelector variant="panel" />
      </Section>

      <Section
        title="Storage on this Mac"
        description="Your data stays in the local application data folder. Nothing here is uploaded."
      >
        {storageError ? (
          <p role="alert" className="text-sm text-[var(--accent-text)]">
            {storageError}
          </p>
        ) : storage ? (
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">Folder</dt>
              <dd className="mt-0.5 break-all font-mono text-xs text-[var(--foreground)]">
                {storage.directory}
              </dd>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["Memories", storage.files.memory],
                  ["Conversations", storage.files.conversations],
                  ["Projects", storage.files.projects],
                  ["Settings", storage.files.settings],
                ] as const
              ).map(([label, file]) => (
                <div key={label} className="rounded-lg border border-[var(--line)] px-3 py-2">
                  <dt className="text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">{label}</dt>
                  <dd className="mt-0.5 font-mono text-xs text-[var(--foreground)]">{file}</dd>
                </div>
              ))}
            </div>
          </dl>
        ) : (
          <p className="text-sm text-[var(--muted)]">Reading storage locations…</p>
        )}
      </Section>

      <Section
        title="What VYXO stores locally"
        description="These are the only things VYXO keeps on this Mac."
      >
        <ul className="space-y-2 text-sm text-[var(--muted)]">
          <li>Saved conversations and their messages, with timestamps.</li>
          <li>Long-term memories you add on the Memory page.</li>
          <li>Projects you create, and which conversations belong to them.</li>
          <li>Your selected local model.</li>
        </ul>
      </Section>

      <Section
        title="Internet access"
        description="This phase makes no external network requests."
      >
        <ul className="space-y-2 text-sm text-[var(--muted)]">
          <li>The app connects only to Ollama at 127.0.0.1:11434 — your own machine.</li>
          <li>Scheduled conversations, projects, files, and memories are never sent to external services.</li>
          <li>Project file reading uses your browser/desktop file permissions and stays local.</li>
          <li>There is no cloud sync, no accounts, and no external AI provider.</li>
        </ul>
      </Section>

      <Section
        title="If Ollama is unavailable"
        description="Chat needs Ollama running with at least one installed model."
      >
        <ol className="list-decimal space-y-2 pl-5 text-sm text-[var(--muted)]">
          <li>Open the Ollama app, or run <span className="font-mono text-[var(--foreground)]">ollama serve</span>.</li>
          <li>Install a model, for example <span className="font-mono text-[var(--foreground)]">ollama pull qwen3:8b</span>.</li>
          <li>Return here and press <span className="text-[var(--foreground)]">Check again</span>.</li>
        </ol>
      </Section>
    </div>
  );
}
