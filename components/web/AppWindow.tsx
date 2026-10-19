import Image from "next/image";
import logoWhite from "../../public/brand/logo-white.svg";

const nav = ["Chat", "Agents", "Projects", "Memory", "Research", "Settings"];

/** A drawn replica of the VYXO window, using the app's real colours. Purely illustrative. */
export function AppWindow() {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-deep)] shadow-[0_50px_140px_-40px_rgba(130,89,255,0.28)]"
    >
      <div className="flex h-10 items-center gap-2 border-b border-[var(--line)] px-4">
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--surface-hover)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--surface-hover)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--surface-hover)]" />
        <span className="mx-auto font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
          VYXO / Local workspace
        </span>
        <span className="flex items-center gap-1.5 rounded-full border border-[var(--line)] px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span className="hidden text-[var(--foreground)] sm:inline">qwen3.5:9b</span>
        </span>
      </div>

      <div className="grid min-h-[430px] sm:grid-cols-[190px_1fr]">
        <div className="hidden flex-col gap-1 border-r border-[var(--line)] bg-[var(--background)] p-3 sm:flex">
          <Image src={logoWhite} alt="" width={753} height={240} className="mb-4 ml-1.5 mt-1 h-5 w-auto" />
          <div className="mb-3 rounded-lg bg-[var(--foreground)] px-3 py-2 text-xs font-medium text-[var(--background)]">
            + New chat
          </div>
          {nav.map((item, index) => (
            <div
              key={item}
              className={`rounded-lg px-3 py-2 text-xs ${
                index === 0
                  ? "bg-[var(--accent-soft)] text-[var(--foreground)] shadow-[inset_0_0_0_1px_var(--accent-border)]"
                  : "text-[var(--muted)]"
              }`}
            >
              {item}
            </div>
          ))}
        </div>

        <div className="flex flex-col">
          <div className="flex-1 space-y-5 p-5 sm:p-7">
            <div className="ml-auto max-w-[78%] rounded-2xl rounded-br-sm bg-[var(--foreground)] px-4 py-3 text-[13px] leading-5 text-[var(--background)]">
              Summarise the indemnity clause in the draft lease and flag anything unusual.
            </div>
            <div className="max-w-[88%] rounded-2xl rounded-bl-sm border border-[var(--line)] px-4 py-3 text-[13px] leading-5 text-[var(--foreground)]">
              <p>
                Clause 14 makes the tenant responsible for losses arising from their use of the premises. Two things
                stand out:
              </p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 marker:text-[var(--muted)]">
                <li>
                  <strong className="font-semibold">No cap</strong> on the tenant&apos;s liability, unlike the cap in
                  clause 9.
                </li>
                <li>
                  <strong className="font-semibold">The indemnity survives termination</strong> with no end date.
                </li>
              </ol>
            </div>
          </div>
          <div className="border-t border-[var(--line)] p-4">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
              Reading 1 selected file · lease-draft-v3.txt
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 rounded-lg border border-[var(--line)] px-4 py-2.5 text-xs text-[var(--muted)]">
                Type a message…
              </div>
              <div className="rounded-lg bg-[var(--foreground)]/20 px-4 py-2.5 text-xs text-[var(--muted)]">Send</div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-[var(--line)] bg-[var(--background)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
        <span>Running on this computer</span>
        <span>
          Outbound requests while chatting: <span className="text-[var(--foreground)]">none</span>
        </span>
      </div>
    </div>
  );
}
