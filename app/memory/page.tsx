import type { Metadata } from "next";
import Link from "next/link";
import { MemoryManager } from "@/components/memory/MemoryManager";

export const metadata: Metadata = {
  title: "Memory · VYXO",
  description: "Manage the memories stored on this Mac.",
};

export default function MemoryPage() {
  return (
    <section className="mx-auto max-w-5xl">
      <header className="mb-8 max-w-2xl">
        <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.24em] text-[var(--accent)]">
          Local storage / user managed
        </p>
        <h2 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)] sm:text-4xl">
          Memory, kept visible.
        </h2>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          Review the notes VYXO can use as background. They stay on this Mac and
          can be edited or removed at any time.
        </p>
      </header>

      <MemoryManager />

      <p className="mt-8 text-sm text-[var(--muted)]">
        <Link href="/chat" className="inline-flex items-center gap-2 transition hover:text-[var(--foreground)]">
          <span aria-hidden="true">&larr;</span>
          Back to chat
        </Link>
      </p>
    </section>
  );
}
