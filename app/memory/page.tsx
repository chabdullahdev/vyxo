import type { Metadata } from "next";
import Link from "next/link";
import { MemoryManager } from "@/components/memory/MemoryManager";

export const metadata: Metadata = {
  title: "Memory · Ship Studio",
  description: "Manage the memories stored on this Mac.",
};

export default function MemoryPage() {
  return (
    <div className="min-h-screen bg-[var(--background)]">
      <main className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-8">
          <p className="mb-2 text-sm font-medium uppercase tracking-wider text-[var(--muted)]">
            Local storage
          </p>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight text-[var(--foreground)]">
            Memory
          </h1>
          <p className="mt-2 text-[var(--muted)]">
            Things you want your assistant to remember. Stored only on this Mac.
          </p>
        </header>

        <MemoryManager />

        <p className="mt-8 text-sm text-[var(--muted)]">
          <Link href="/chat" className="underline hover:text-[var(--foreground)]">
            Back to chat
          </Link>
        </p>
      </main>
    </div>
  );
}
