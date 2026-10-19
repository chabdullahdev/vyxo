const display = "font-[family-name:var(--font-display)]";

export function LegalPage({
  title,
  summary,
  updated,
  children,
}: {
  title: string;
  summary: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <article className="mx-auto w-full max-w-[1240px] px-5 pb-28 pt-16 sm:px-8 sm:pt-24">
      <header className="grid gap-8 border-b border-[var(--line)] pb-14 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--accent-text)]">Legal</p>
          <h1
            className={`${display} mt-5 text-[clamp(2.6rem,6vw,5rem)] font-medium leading-[0.98] tracking-[-0.045em]`}
          >
            {title}
          </h1>
        </div>
        <div className="lg:col-span-4 lg:col-start-9 lg:self-end">
          <p className="text-[15px] leading-7 text-[var(--silver)]">{summary}</p>
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
            Last updated {updated}
          </p>
        </div>
      </header>
      <div className="mt-14 max-w-2xl space-y-12 lg:ml-[calc(100%/12*4)]">{children}</div>
    </article>
  );
}

export function LegalSection({
  number,
  heading,
  children,
}: {
  number: number;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className={`${display} flex items-baseline gap-4 text-xl font-medium tracking-[-0.02em]`}>
        <span aria-hidden="true" className="font-mono text-xs text-[var(--accent-text)]">{String(number).padStart(2, "0")}</span>
        {heading}
      </h2>
      <div className="mt-4 space-y-4 text-[15px] leading-7 text-[var(--muted)] [&_a]:text-[var(--accent-text)] [&_a]:underline [&_a]:underline-offset-4 [&_li]:pl-1 [&_strong]:font-medium [&_strong]:text-[var(--silver)] [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ul]:marker:text-[var(--muted)]">
        {children}
      </div>
    </section>
  );
}
