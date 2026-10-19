import Link from "next/link";

export default function NotFound() {
  return (
    <section className="mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
      <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-[var(--accent-text)]">
        404
      </p>
      <h2 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold tracking-[-0.03em]">
        There&apos;s nothing here.
      </h2>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
        That page doesn&apos;t exist. Use the sidebar, or start a new conversation.
      </p>
      <Link
        href="/chat"
        className="mt-6 rounded-lg bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--background)] transition hover:bg-[var(--silver)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        Back to chat
      </Link>
    </section>
  );
}
