import type { Metadata } from "next";
import { AppWindow } from "@/components/web/AppWindow";
import { DataFlow } from "@/components/web/DataFlow";
import { ISSUES_URL, OLLAMA_URL, RELEASES_URL, REPO_URL } from "@/lib/site/links";

const title = "VYXO: the AI that stays in the room";
const description =
  "VYXO is a private AI workspace that runs on your own computer, for lawyers, developers, consultants, and researchers who can't send client or unreleased work to a cloud chatbot.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/web" },
  openGraph: { title, description, type: "website", siteName: "VYXO", url: "/web" },
  twitter: { card: "summary_large_image", title, description },
};

const wrap = "mx-auto w-full max-w-[1240px] px-5 sm:px-8";
const eyebrow = "font-mono text-[11px] uppercase tracking-[0.2em]";
const display = "font-[family-name:var(--font-display)]";
const serif = "font-[family-name:var(--font-serif)] italic font-normal";

const audiences = [
  {
    name: "Lawyers and legal teams",
    scenario:
      "Summarise a lease, compare two drafts, or prepare questions for a deposition, without a client's documents reaching anyone's servers.",
  },
  {
    name: "Developers",
    scenario:
      "Ask about code that is under NDA or not yet released. Connect a folder read-only, choose the exact files the model sees, and approve any change as a diff before it is written.",
  },
  {
    name: "Consultants and finance",
    scenario:
      "Work through client numbers, draft the memo, and pressure-test the argument while everything stays inside the engagement.",
  },
  {
    name: "Researchers and journalists",
    scenario:
      "Sort interview notes, outline a story, and check your reasoning without sending a source or an unpublished draft anywhere.",
  },
];

const comparison = [
  ["Where your text goes", "A company's servers", "Your computer only"],
  ["Account", "Required", "None"],
  ["Works offline", "No", "Yes, once a model is installed"],
  ["Who can read your history", "The provider, under its policy", "Whoever can open your computer"],
  ["Cost", "Subscription or per message", "Free. You bring the hardware"],
  ["Strongest models", "Larger, often smarter", "Smaller. Good, not the best available"],
];

const capabilities = [
  ["Chat", "Streaming answers with history you can search, rename, archive, and delete."],
  ["Projects", "Goals, stack, and instructions per project, plus a read-only code folder you pick files from."],
  ["Edits you approve", "Proposed changes arrive as a diff. Nothing is written until you say so, and it can be undone."],
  ["Agents", "A planner splits a large request into small tasks for specialists that run one at a time."],
  ["Memory", "Facts the assistant may read. Only you can add, change, or remove them."],
  ["Research", "Summaries of public documentation pages, with citations and a plain statement of limits."],
];

const steps = [
  {
    title: "Install Ollama",
    body: (
      <>
        Download it from{" "}
        <a href={OLLAMA_URL} className="text-[var(--accent-text)] underline underline-offset-4">
          ollama.com
        </a>{" "}
        and open it. It is the engine that runs models on your machine.
      </>
    ),
    code: null,
  },
  {
    title: "Download a model",
    body: "One command, once. Any model Ollama supports will work. Expect a few gigabytes.",
    code: "ollama pull qwen3:8b",
  },
  {
    title: "Open VYXO",
    body: "Download the Mac app, or run it from source. VYXO finds your models by itself and tells you if a step is missing.",
    code: null,
  },
];

export default function WebPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-[var(--line)]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.5] [background-image:linear-gradient(to_right,var(--line)_1px,transparent_1px)] [background-size:calc(100%/12)_100%] [mask-image:linear-gradient(to_bottom,black,transparent_75%)]"
        />
        <div className={`${wrap} relative pb-0 pt-16 sm:pt-24`}>
          <p className={`${eyebrow} web-rise text-[var(--accent-text)]`}>Private · Local · Open source</p>
          <h1
            className={`${display} web-rise mt-6 max-w-[17ch] text-[clamp(3rem,9vw,8.4rem)] font-medium leading-[0.92] tracking-[-0.05em]`}
            style={{ "--delay": "0.08s" } as React.CSSProperties}
          >
            The AI that stays <span className={`${serif} whitespace-nowrap tracking-[-0.03em] text-[var(--accent-text)]`}>in the room.</span>
          </h1>

          <div
            className="web-rise mt-10 grid gap-8 lg:grid-cols-12"
            style={{ "--delay": "0.2s" } as React.CSSProperties}
          >
            <p className="max-w-xl text-lg leading-8 text-[var(--silver)] lg:col-span-6">
              VYXO is a workspace for chat, projects, and research that runs on your own computer. What you type and
              what you open is never uploaded, because there is no server for it to reach.
            </p>
            <div className="flex flex-col gap-3 lg:col-span-5 lg:col-start-8 lg:items-end lg:justify-end">
              <div className="flex flex-wrap gap-3">
                <a
                  href={RELEASES_URL}
                  className="rounded-full bg-[var(--foreground)] px-6 py-3.5 text-sm font-medium text-[var(--background)] transition hover:bg-[var(--silver)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
                >
                  Download for Mac
                </a>
                <a
                  href={REPO_URL}
                  className="rounded-full border border-[var(--line)] px-6 py-3.5 text-sm text-[var(--foreground)] transition hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  Read the source
                </a>
              </div>
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
                Apple Silicon · Free · MIT license
              </p>
            </div>
          </div>

          <div
            className="web-rise relative mt-16 [mask-image:linear-gradient(to_bottom,black_70%,transparent)]"
            style={{ "--delay": "0.34s" } as React.CSSProperties}
          >
            <AppWindow />
          </div>
        </div>
      </section>

      {/* Proof line */}
      <section aria-label="At a glance" className="border-b border-[var(--line)]">
        <ul
          className={`${wrap} grid grid-cols-2 gap-y-px py-6 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted)] sm:grid-cols-4`}
        >
          {["No account", "No telemetry", "Works offline", "Open source, MIT"].map((item) => (
            <li key={item} className="flex items-center gap-3 py-2">
              <span aria-hidden="true" className="h-1 w-1 bg-[var(--accent)]" />
              {item}
            </li>
          ))}
        </ul>
      </section>

      {/* Problem */}
      <section className={`${wrap} py-28 sm:py-40`}>
        <p className={`${eyebrow} text-[var(--muted)]`}>The problem</p>
        <p
          className={`${display} web-reveal mt-8 max-w-[22ch] text-[clamp(2rem,5vw,4.2rem)] font-medium leading-[1.04] tracking-[-0.035em] sm:max-w-[26ch]`}
        >
          Pasting a client file into a chatbot <span className={`${serif} text-[var(--muted)]`}>is handing it over.</span>
        </p>
        <p className="web-reveal mt-10 max-w-xl text-base leading-7 text-[var(--muted)]">
          Plenty of firms and teams now forbid it, and they are right to. But the work is still there, and the tools
          are genuinely useful. VYXO is what is left when you take the cloud out: the same kind of assistant, on your
          own machine, where the file never leaves.
        </p>
      </section>

      {/* Audience: the one light section */}
      <section id="who" className="scroll-mt-16 bg-[var(--foreground)] text-[var(--background)]">
        <div className={`${wrap} py-24 sm:py-32`}>
          <div className="grid gap-10 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <p className={`${eyebrow} text-[#6b46e0]`}>Who it is for</p>
              <h2 className={`${display} mt-6 text-[clamp(2.2rem,4.4vw,3.6rem)] font-medium leading-[1] tracking-[-0.04em]`}>
                People whose work is <span className={serif}>not theirs to share.</span>
              </h2>
            </div>
            <ul className="lg:col-span-8">
              {audiences.map((audience) => (
                <li
                  key={audience.name}
                  className="web-reveal grid gap-3 border-t border-[#09080c]/15 py-8 first:border-t-0 first:pt-0 sm:grid-cols-[minmax(0,15rem)_1fr] sm:gap-10"
                >
                  <h3 className={`${display} text-xl font-medium tracking-[-0.02em]`}>{audience.name}</h3>
                  <p className="text-[15px] leading-7 text-[#09080c]/75">{audience.scenario}</p>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-14 max-w-2xl border-t border-[#09080c]/15 pt-6 text-sm leading-6 text-[#09080c]/65">
            VYXO keeps your data on your machine. It is not a compliance certification: duties such as privilege,
            GDPR, HIPAA, or client contracts remain yours, and local models can still be wrong. Check what you rely on.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className={`${wrap} scroll-mt-16 py-24 sm:py-36`}>
        <p className={`${eyebrow} text-[var(--muted)]`}>How your data moves</p>
        <h2
          className={`${display} mt-6 max-w-[20ch] text-[clamp(2rem,4.4vw,3.6rem)] font-medium leading-[1] tracking-[-0.04em]`}
        >
          One loop, <span className={`${serif} text-[var(--accent-text)]`}>entirely on your machine.</span>
        </h2>
        <div className="web-reveal mt-14">
          <DataFlow />
        </div>
      </section>

      {/* Capabilities */}
      <section className="border-y border-[var(--line)]">
        <div className={`${wrap} grid gap-12 py-24 sm:py-32 lg:grid-cols-12`}>
          <h2
            className={`${display} text-[clamp(2rem,4vw,3.2rem)] font-medium leading-[1] tracking-[-0.04em] lg:col-span-4`}
          >
            What it <span className={serif}>does.</span>
          </h2>
          <ol className="lg:col-span-8">
            {capabilities.map(([name, body], index) => (
              <li
                key={name}
                className="web-reveal grid grid-cols-[3rem_1fr] gap-x-4 border-t border-[var(--line)] py-6 first:border-t-0 first:pt-0 sm:grid-cols-[3rem_14rem_1fr]"
              >
                <span className="font-mono text-xs text-[var(--accent-text)]">{String(index + 1).padStart(2, "0")}</span>
                <h3 className={`${display} text-lg font-medium tracking-[-0.01em]`}>{name}</h3>
                <p className="col-start-2 mt-1 text-[15px] leading-7 text-[var(--muted)] sm:col-start-3 sm:mt-0">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Compare */}
      <section id="compare" className={`${wrap} scroll-mt-16 py-24 sm:py-36`}>
        <p className={`${eyebrow} text-[var(--muted)]`}>An honest comparison</p>
        <h2
          className={`${display} mt-6 max-w-[18ch] text-[clamp(2rem,4.4vw,3.6rem)] font-medium leading-[1] tracking-[-0.04em]`}
        >
          What you gain, <span className={serif}>and what you give up.</span>
        </h2>
        <div className="web-reveal mt-14 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-[15px]">
            <caption className="sr-only">Cloud chatbot compared with VYXO</caption>
            <thead>
              <tr className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
                <th scope="col" className="w-[30%] border-b border-[var(--line)] pb-4 font-normal" />
                <th scope="col" className="border-b border-[var(--line)] pb-4 font-normal">
                  A cloud chatbot
                </th>
                <th scope="col" className="border-b border-[var(--accent-border)] pb-4 font-normal text-[var(--accent-text)]">
                  VYXO
                </th>
              </tr>
            </thead>
            <tbody>
              {comparison.map(([row, cloud, vyxo]) => (
                <tr key={row}>
                  <th scope="row" className="border-b border-[var(--line)] py-5 pr-6 font-normal text-[var(--muted)]">
                    {row}
                  </th>
                  <td className="border-b border-[var(--line)] py-5 pr-6 text-[var(--silver)]">{cloud}</td>
                  <td className="border-b border-[var(--line)] py-5 text-[var(--foreground)]">{vyxo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-6 max-w-xl text-sm leading-6 text-[var(--muted)]">
          The last row is the real trade. If you need the very best model available and your material is not
          sensitive, a cloud service may serve you better.
        </p>
      </section>

      {/* Get started */}
      <section id="start" className="scroll-mt-16 border-t border-[var(--line)]">
        <div className={`${wrap} grid gap-12 py-24 sm:py-32 lg:grid-cols-12`}>
          <h2
            className={`${display} text-[clamp(2rem,4vw,3.2rem)] font-medium leading-[1] tracking-[-0.04em] lg:col-span-4`}
          >
            Running in <span className={serif}>ten minutes.</span>
          </h2>
          <ol className="space-y-10 lg:col-span-7 lg:col-start-6">
            {steps.map((step, index) => (
              <li key={step.title} className="web-reveal grid grid-cols-[3rem_1fr] gap-x-4">
                <span className={`${display} text-3xl font-medium leading-none text-[var(--accent-text)]`}>
                  {index + 1}
                </span>
                <div>
                  <h3 className={`${display} text-xl font-medium tracking-[-0.02em]`}>{step.title}</h3>
                  <p className="mt-2 max-w-md text-[15px] leading-7 text-[var(--muted)]">{step.body}</p>
                  {step.code ? (
                    <pre className="mt-4 overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--surface-deep)] px-4 py-3 font-mono text-[13px] text-[var(--silver)]">
                      <span className="select-none text-[var(--muted)]">$ </span>
                      {step.code}
                    </pre>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Closing */}
      <section className="border-t border-[var(--line)]">
        <div className={`${wrap} py-28 sm:py-44`}>
          <h2
            className={`${display} max-w-[12ch] text-[clamp(3rem,8vw,7rem)] font-medium leading-[0.94] tracking-[-0.05em]`}
          >
            Keep it <span className={`${serif} text-[var(--accent-text)]`}>in the room.</span>
          </h2>
          <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-4">
            <a
              href={RELEASES_URL}
              className="rounded-full bg-[var(--foreground)] px-7 py-4 text-sm font-medium text-[var(--background)] transition hover:bg-[var(--silver)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
            >
              Download for Mac
            </a>
            <a
              href={ISSUES_URL}
              className="text-sm text-[var(--silver)] underline underline-offset-[6px] transition hover:text-[var(--foreground)]"
            >
              Found a problem? Tell us
            </a>
          </div>
          <p className="mt-6 max-w-lg text-sm leading-6 text-[var(--muted)]">
            The Mac app is not yet signed by Apple, so macOS asks you to confirm the first launch (right-click the
            app, choose Open), and updates open the download page instead of installing in place.
          </p>
        </div>
      </section>
    </>
  );
}
