"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
      <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-[var(--accent-text)]">
        Something broke
      </p>
      <h2 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold tracking-[-0.03em]">
        This page hit an error.
      </h2>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
        Your saved conversations, projects, and memories are stored separately and
        weren&apos;t affected. Try again, or head back to chat.
      </p>
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--background)] transition hover:bg-[var(--silver)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          Try again
        </button>
        <Link
          href="/chat"
          className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm text-[var(--foreground)] transition hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          Back to chat
        </Link>
      </div>
    </section>
  );
}
