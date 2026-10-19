"use client";

import Link from "next/link";
import { useModelCatalog } from "@/components/workspace/useModelCatalog";
import { CopyButton } from "@/components/chat/CopyButton";

function Command({ command }: { command: string }) {
  return (
    <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-deep)] px-3 py-2">
      <code className="min-w-0 truncate font-mono text-xs text-[var(--silver)]">{command}</code>
      <CopyButton text={command} label={`Copy command ${command}`} />
    </div>
  );
}

/**
 * First-run help. Renders nothing while everything works, and walks the user
 * through the one missing step (Ollama, a model, or a model choice) otherwise.
 */
export function SetupGuide() {
  const { catalog, state, refresh } = useModelCatalog();

  if (state !== "ready" || !catalog || (catalog.status === "ok" && catalog.selectedInstalled)) {
    return null;
  }

  let title: string;
  let body: React.ReactNode;

  if (catalog.status === "unavailable") {
    title = "Start Ollama to begin";
    body = (
      <>
        <p>
          VYXO runs models through Ollama on this computer, and it isn&apos;t
          running yet. Install it from{" "}
          <a
            href="https://ollama.com/download"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent-text)] underline underline-offset-2"
          >
            ollama.com/download
          </a>
          , open it, then come back here.
        </p>
        <p className="mt-3">Already installed? Start it from a terminal:</p>
        <Command command="ollama serve" />
      </>
    );
  } else if (catalog.status === "empty") {
    title = "Download your first model";
    body = (
      <>
        <p>Ollama is running, but no models are installed. Run this once in a terminal:</p>
        <Command command={`ollama pull ${catalog.selectedModel}`} />
        <p className="mt-3 text-[var(--muted)]">
          It&apos;s a multi-gigabyte download. This page updates when it finishes.
        </p>
      </>
    );
  } else {
    title = "Pick an installed model";
    body = (
      <div>
        <p>
          The saved model <strong>{catalog.selectedModel}</strong> isn&apos;t installed. Choose
          one of your installed models in{" "}
          <Link href="/settings" className="text-[var(--accent-text)] underline underline-offset-2">
            Settings
          </Link>
          , or install it:
        </p>
        <Command command={`ollama pull ${catalog.selectedModel}`} />
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label="Setup"
      className="mb-5 shrink-0 rounded-2xl border border-[var(--accent-border)] bg-[var(--accent-soft)] p-5 text-sm leading-6 text-[var(--foreground)]"
    >
      <div className="flex items-start justify-between gap-4">
        <h3 className="font-[family-name:var(--font-display)] text-base font-medium">{title}</h3>
        <button
          type="button"
          onClick={() => void refresh()}
          className="shrink-0 rounded-lg border border-[var(--line)] px-3 py-1 text-xs text-[var(--foreground)] transition hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          Check again
        </button>
      </div>
      <div className="mt-2">{body}</div>
    </div>
  );
}
