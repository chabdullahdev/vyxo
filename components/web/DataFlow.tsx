const steps = [
  { name: "You", note: "type, open files" },
  { name: "VYXO", note: "local server on 127.0.0.1" },
  { name: "Ollama", note: "runs the model" },
  { name: "Model file", note: "stored on your disk" },
];

/** Where your words go. Everything in the dashed box stays on the machine. */
export function DataFlow() {
  return (
    <figure className="grid gap-4 lg:grid-cols-[1fr_auto_220px] lg:items-stretch">
      <div className="relative rounded-2xl border border-dashed border-[var(--accent-border)] p-5 pt-9 sm:p-7 sm:pt-10">
        <span className="absolute left-5 top-3 bg-[var(--background)] px-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--accent-text)] sm:left-7">
          Your computer
        </span>
        <ol className="flex flex-col items-stretch gap-2 sm:flex-row">
          {steps.map((step, index) => (
            <li key={step.name} className="flex flex-1 flex-col items-stretch gap-2 sm:flex-row">
              <div className="flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-4">
                <div className="font-[family-name:var(--font-display)] text-base font-medium">{step.name}</div>
                <div className="mt-1 font-mono text-[10px] uppercase leading-4 tracking-[0.1em] text-[var(--muted)]">
                  {step.note}
                </div>
              </div>
              {index < steps.length - 1 ? (
                <span aria-hidden="true" className="self-center text-[var(--accent-text)] sm:px-1">
                  <span className="sm:hidden">↓</span>
                  <span className="hidden sm:inline">→</span>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </div>

      <div aria-hidden="true" className="flex items-center justify-center gap-2 font-mono text-xs text-[var(--muted)] lg:flex-col">
        <span className="h-px w-8 bg-[var(--line)] lg:h-8 lg:w-px" />
        <span className="text-base text-[var(--accent-text)]">✕</span>
        <span className="h-px w-8 bg-[var(--line)] lg:h-8 lg:w-px" />
      </div>

      <div className="flex flex-col justify-center rounded-2xl border border-[var(--line)] px-6 py-6 opacity-70">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">The internet</div>
        <div className="mt-2 font-[family-name:var(--font-display)] text-base">Your messages and files never go here.</div>
      </div>

      <figcaption className="text-sm leading-6 text-[var(--muted)] lg:col-span-3">
        Two features do reach the internet. <strong className="font-medium text-[var(--silver)]">Research</strong>{" "}
        fetches documentation pages from a short list of public sites (React, MDN, Node.js and a few others) when you
        run it. The app also checks GitHub Releases for new versions, which you can turn off. Neither one sends your
        messages or files.
      </figcaption>
    </figure>
  );
}
