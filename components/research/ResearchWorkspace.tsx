"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface ResearchSource {
  url: string;
  canonicalUrl: string;
  title: string;
  retrievedAt: string;
  httpStatus: number;
  extractedChars: number;
  text: string;
  limitations: string[];
}

interface ResearchReport {
  question: string;
  sources: ResearchSource[];
  summary: string;
  citationCheck: { cited: number[]; invalid: number[]; verified: boolean };
  limitations: string[];
  createdAt: string;
}

interface ResearchConfig {
  providerStatus: string;
  allowedHosts: string[];
  message: string;
}

type RunState = "idle" | "running" | "done" | "failed";

export function ResearchWorkspace() {
  const [config, setConfig] = useState<ResearchConfig | null>(null);
  const [question, setQuestion] = useState("");
  const [urlsText, setUrlsText] = useState("");
  const [state, setState] = useState<RunState>("idle");
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/research", { cache: "no-store" });
        const data = (await response.json().catch(() => null)) as ResearchConfig | null;
        if (active && response.ok && data) setConfig(data);
      } catch {
        // config status is informational
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const run = useCallback(async () => {
    const q = question.trim();
    const urls = urlsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (q.length === 0 || urls.length === 0 || state === "running") return;

    setState("running");
    setError(null);
    setReport(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, urls }),
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => null)) as { report?: ResearchReport; error?: string } | null;
      if (!response.ok) {
        setError(data?.error ?? `Request failed (status ${response.status}).`);
        setState("failed");
        return;
      }
      setReport(data?.report ?? null);
      setState("done");
    } catch (caught) {
      if (controller.signal.aborted) {
        setState("idle");
        return;
      }
      setError(caught instanceof Error ? caught.message : "The research request failed.");
      setState("failed");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [question, state, urlsText]);

  const copySummary = useCallback(() => {
    if (!report) return;
    const lines = report.sources.map((source, index) => `[${index + 1}] ${source.title} — ${source.canonicalUrl}`);
    const text = `${report.summary}\n\nSources:\n${lines.join("\n")}`;
    void navigator.clipboard?.writeText(text);
  }, [report]);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <h3 className="font-[family-name:var(--font-display)] text-base font-medium text-[var(--foreground)]">
          Research a question
        </h3>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {config?.message ??
            "Research retrieves approved public documentation pages and summarizes them with the local model."}
        </p>

        <div className="mt-3 space-y-2">
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={2}
            placeholder="e.g. How do I define route handlers in the Next.js App Router?"
            className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent-border)]"
          />
          <textarea
            value={urlsText}
            onChange={(event) => setUrlsText(event.target.value)}
            rows={3}
            spellCheck={false}
            placeholder={"One approved documentation URL per line, e.g.\nhttps://nextjs.org/docs/app/building-your-application/routing/route-handlers"}
            className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2 font-mono text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent-border)]"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void run()}
              disabled={state === "running" || question.trim().length === 0 || urlsText.trim().length === 0}
              className="rounded-lg bg-[var(--foreground)] px-4 py-2 text-xs font-medium text-[var(--background)] transition hover:bg-[var(--silver)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {state === "running" ? "Researching…" : "Run research"}
            </button>
            {state === "running" ? (
              <button
                type="button"
                onClick={cancel}
                className="rounded-lg border border-[var(--line)] px-4 py-2 text-xs text-[var(--muted)] transition hover:text-[var(--foreground)]"
              >
                Cancel
              </button>
            ) : null}
            {report ? (
              <button
                type="button"
                onClick={copySummary}
                className="rounded-lg border border-[var(--line)] px-4 py-2 text-xs text-[var(--muted)] transition hover:text-[var(--foreground)]"
              >
                Copy summary with sources
              </button>
            ) : null}
          </div>
        </div>

        {config ? (
          <p className="mt-3 text-[11px] text-[var(--muted)]">
            Approved hosts: {config.allowedHosts.join(", ")}
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="mt-3 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 py-2 text-xs text-[var(--accent-text)]">
            {error}
          </p>
        ) : null}
      </section>

      {report ? (
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-[family-name:var(--font-display)] text-base font-medium text-[var(--foreground)]">
              Findings
            </h3>
            <span className="text-[11px] text-[var(--muted)]">
              {report.sources.length} source{report.sources.length === 1 ? "" : "s"} retrieved
            </span>
          </div>

          <div className="mt-3">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">
              Local summary (generated)
            </p>
            <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--line)] bg-[var(--background)] p-3 text-sm leading-6 text-[var(--foreground)]">
              {report.summary}
            </pre>
            {report.citationCheck ? (
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                {report.citationCheck.invalid.length > 0 ? (
                  <>
                    Unverified citation number(s) not retrieved in this run:{" "}
                    {report.citationCheck.invalid.map((n) => `[${n}]`).join(", ")}.{" "}
                  </>
                ) : null}
                Inline citations are model-selected and not independently verified as claim support.
              </p>
            ) : null}
          </div>

          <div className="mt-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">
              Sources (retrieved)
            </p>
            <ol className="mt-2 space-y-2">
              {report.sources.map((source, index) => (
                <li key={source.canonicalUrl} className="rounded-lg border border-[var(--line)] p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-xs font-medium text-[var(--foreground)]">
                      [{index + 1}] {source.title}
                    </span>
                    <span className="text-[11px] text-[var(--muted)]">
                      HTTP {source.httpStatus} · {source.extractedChars} chars · retrieved{" "}
                      {new Date(source.retrievedAt).toLocaleString()}
                    </span>
                  </div>
                  <a
                    href={source.canonicalUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-1 block break-all text-[11px] text-[var(--accent-text)] underline underline-offset-2"
                  >
                    {source.canonicalUrl}
                  </a>
                  {source.limitations.length > 0 ? (
                    <p className="mt-1 text-[11px] text-[var(--muted)]">{source.limitations.join(" ")}</p>
                  ) : null}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] text-[var(--muted)]">
                      Show extracted text
                    </summary>
                    <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--background)] p-2 text-[11px] leading-5 text-[var(--foreground)]">
                      {source.text}
                    </pre>
                  </details>
                </li>
              ))}
            </ol>
          </div>

          {report.limitations.length > 0 ? (
            <div className="mt-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">Limitations</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-[11px] text-[var(--muted)]">
                {report.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="mt-4 text-[11px] text-[var(--muted)]">
            The summary above is generated locally. Source pages are shown as retrieved; the model may summarize
            them imperfectly, so verify important details at the linked source.
          </p>
        </section>
      ) : null}
    </div>
  );
}
