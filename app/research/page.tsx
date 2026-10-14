import type { Metadata } from "next";
import { ResearchWorkspace } from "@/components/research/ResearchWorkspace";

export const metadata: Metadata = {
  title: "Research · VYXO",
  description: "Bounded research of approved public documentation sources.",
};

export default function ResearchPage() {
  return (
    <section className="mx-auto max-w-4xl">
      <header className="mb-8 max-w-2xl">
        <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.24em] text-[var(--accent)]">
          Research / approved sources only
        </p>
        <h2 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)] sm:text-4xl">
          Current knowledge, carefully fetched.
        </h2>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          VYXO retrieves public pages only from an approved documentation allowlist,
          extracts readable text, and summarizes it with your local model. Private
          project files, memory, and conversations are never sent.
        </p>
      </header>
      <ResearchWorkspace />
    </section>
  );
}
