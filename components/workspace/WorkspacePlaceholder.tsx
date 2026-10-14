import Link from "next/link";

interface WorkspacePlaceholderProps {
  eyebrow: string;
  title: string;
  description: string;
  detail: string;
  action?: { href: string; label: string };
}

export function WorkspacePlaceholder({
  eyebrow,
  title,
  description,
  detail,
  action,
}: WorkspacePlaceholderProps) {
  return (
    <section className="mx-auto max-w-5xl">
      <div className="max-w-2xl">
        <p className="mb-3 text-[10px] font-medium uppercase tracking-[0.24em] text-[var(--accent)]">
          {eyebrow}
        </p>
        <h2 className="font-[family-name:var(--font-display)] text-4xl font-semibold tracking-[-0.04em] text-[var(--foreground)] sm:text-5xl">
          {title}
        </h2>
        <p className="mt-5 max-w-xl text-base leading-7 text-[var(--muted)]">
          {description}
        </p>
      </div>

      <div className="mt-14 grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 sm:p-8">
          <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
            Not available yet
          </div>
          <h3 className="mt-10 font-[family-name:var(--font-display)] text-xl font-medium text-[var(--foreground)]">
            This workspace is reserved for a later phase.
          </h3>
          <p className="mt-3 max-w-lg text-sm leading-6 text-[var(--muted)]">
            {detail}
          </p>
          {action ? (
            <Link
              href={action.href}
              className="mt-7 inline-flex items-center gap-2 rounded-xl bg-[var(--foreground)] px-4 py-2.5 text-sm font-medium text-[var(--background)] transition hover:bg-[var(--silver)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
            >
              {action.label}
              <span aria-hidden="true">-&gt;</span>
            </Link>
          ) : null}
        </div>

        <div className="relative min-h-[250px] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-deep)] p-6">
          <div className="absolute inset-6 border border-[var(--line)]" aria-hidden="true" />
          <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-[var(--accent-border)]" aria-hidden="true" />
          <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)]" aria-hidden="true" />
          <p className="absolute bottom-6 left-6 text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
            Phase 1 / shell only
          </p>
        </div>
      </div>
    </section>
  );
}
