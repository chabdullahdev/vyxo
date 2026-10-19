import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import logoWhite from "../../public/brand/logo-white.svg";
import { ISSUES_URL, OLLAMA_URL, RELEASES_URL, REPO_URL } from "@/lib/site/links";

const title = "VYXO: an AI workspace that never leaves your computer";
const description =
  "VYXO is a private AI workspace that runs on your own computer. Chat, organise projects, keep memory, and delegate to agents without sending a word to the cloud.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/web" },
  openGraph: { title, description, type: "website", siteName: "VYXO", url: "/web" },
  twitter: { card: "summary_large_image", title, description },
};

const features = [
  {
    title: "Chat that stays home",
    body: "Streaming answers from a model on your machine. Conversations are saved in a file you can find, search, and delete.",
  },
  {
    title: "Projects with context",
    body: "Give each project goals, a tech stack, and instructions. Connect a code folder read-only and pick exactly which files the model sees.",
  },
  {
    title: "Edits you approve",
    body: "The assistant proposes changes as a diff. Nothing is written until you approve it, and every applied change can be recovered.",
  },
  {
    title: "Agents with limits",
    body: "A planner splits a big request into small tasks for specialists. They run one at a time, with bounded context, and you review the results.",
  },
  {
    title: "Memory you control",
    body: "Save facts the assistant should remember. It can read them; only you can add, edit, or delete them.",
  },
  {
    title: "Stays up to date",
    body: "VYXO checks for new versions and asks before updating. Your conversations, projects, and memories are kept.",
  },
  {
    title: "Research with citations",
    body: "Fetch approved public documentation pages and get a summary that cites its sources and states its limits.",
  },
];

const steps = [
  {
    title: "Install Ollama",
    body: (
      <>
        Download it from{" "}
        <a href={OLLAMA_URL} className="text-[var(--accent-text)] underline underline-offset-2">
          ollama.com
        </a>{" "}
        and open it. It runs the models.
      </>
    ),
  },
  {
    title: "Pull a model",
    body: (
      <>
        In a terminal, run <code className="rounded bg-[var(--surface)] px-1.5 py-0.5 font-mono text-xs">ollama pull qwen3:8b</code>.
        Any model Ollama supports works.
      </>
    ),
  },
  {
    title: "Open VYXO",
    body: "Download the Mac app, or run it from source. VYXO finds your models by itself.",
  },
];

export default function AboutPage() {
  return (
    <article className="mx-auto max-w-4xl pb-16">
      <header className="pb-14 pt-6 sm:pt-12">
        <Image
          src={logoWhite}
          alt="VYXO"
          width={753}
          height={240}
          priority
          className="mb-10 h-9 w-auto"
        />
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-semibold leading-[1.05] tracking-[-0.04em] sm:text-6xl">
          An AI workspace
          <br />
          that never leaves
          <br />
          <span className="text-[var(--accent-text)]">your computer.</span>
        </h1>
        <p className="mt-6 max-w-xl text-base leading-7 text-[var(--muted)]">
          VYXO runs open models through Ollama on your own machine. Your
          conversations, files, and memory are never uploaded, because there is
          nowhere for them to go.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href={RELEASES_URL}
            className="rounded-xl bg-[var(--foreground)] px-5 py-3 text-sm font-medium text-[var(--background)] transition hover:bg-[var(--silver)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            Download for Mac
          </a>
          <a
            href={REPO_URL}
            className="rounded-xl border border-[var(--line)] px-5 py-3 text-sm text-[var(--foreground)] transition hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            View the source
          </a>
        </div>
        <p className="mt-3 text-xs text-[var(--muted)]">
          Apple Silicon, macOS. Free and open source (MIT).
        </p>
      </header>

      <section aria-labelledby="privacy" className="border-y border-[var(--line)] py-12">
        <h2 id="privacy" className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-[-0.03em]">
          What &ldquo;private&rdquo; means here
        </h2>
        <ul className="mt-6 grid gap-x-10 gap-y-4 text-sm leading-6 text-[var(--silver)] sm:grid-cols-2">
          <li>The browser never talks to Ollama. Every request goes through the app&apos;s own local server.</li>
          <li>Conversations, projects, and memories are plain files in your user data folder, readable only by you.</li>
          <li>No accounts, no analytics, no telemetry, no cloud sync.</li>
          <li>The only outbound requests are the public pages you ask Research to fetch, with private network addresses blocked.</li>
        </ul>
      </section>

      <section aria-labelledby="features" className="py-14">
        <h2 id="features" className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-[-0.03em]">
          What you can do
        </h2>
        <dl className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2">
          {features.map((feature) => (
            <div key={feature.title} className="bg-[var(--surface)] p-6 sm:[&:last-child:nth-child(odd)]:col-span-2">
              <dt className="font-[family-name:var(--font-display)] text-base font-medium">{feature.title}</dt>
              <dd className="mt-2 text-sm leading-6 text-[var(--muted)]">{feature.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="start" className="pb-14">
        <h2 id="start" className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-[-0.03em]">
          Running in three steps
        </h2>
        <ol className="mt-8 space-y-6">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-5">
              <span className="w-8 shrink-0 font-[family-name:var(--font-display)] text-3xl font-semibold text-[var(--accent-text)]">
                {index + 1}
              </span>
              <div>
                <h3 className="text-base font-medium">{step.title}</h3>
                <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="honest" className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 sm:p-8">
        <h2 id="honest" className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-[-0.02em]">
          Good to know
        </h2>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          Local models are smaller than the biggest cloud models, so expect
          answers that are good rather than perfect, and slower on older
          hardware. The Mac app is not yet signed by Apple, so macOS asks you to
          confirm the first launch (right-click the app, then choose Open), and
          updates open the download page instead of installing in place.
          Found a bug or want a feature?{" "}
          <a href={ISSUES_URL} className="text-[var(--accent-text)] underline underline-offset-2">
            Open an issue
          </a>
          .
        </p>
        {process.env.VYXO_PUBLIC_SITE === "1" ? null : (
          <div className="mt-5">
            <Link
              href="/chat"
              className="text-sm text-[var(--foreground)] underline underline-offset-4 hover:text-[var(--accent-text)]"
            >
              Open the workspace →
            </Link>
          </div>
        )}
      </section>
    </article>
  );
}
