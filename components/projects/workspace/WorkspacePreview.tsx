"use client";

import { useCallback, useEffect, useState } from "react";
import { postJson, requestJson } from "@/components/projects/workspace/request";

const WIDTHS = [
  { id: "phone", label: "Phone", width: 390 },
  { id: "tablet", label: "Tablet", width: 820 },
  { id: "desktop", label: "Desktop", width: null },
] as const;

type BuildStatus = "none" | "building" | "ready" | "failed";

interface BuildResponse {
  build: { status: BuildStatus; message: string | null };
  needsBuild: boolean;
}

/**
 * Shows the project's website in a sandboxed frame. The frame has no network access, so the page
 * can't reach the internet or this app's data. A Next.js website is built first, and the Preview
 * waits for that build and shows the reason if it fails.
 */
export function WorkspacePreview({ projectId, refreshKey }: { projectId: string; refreshKey: number }) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/workspace/build`;
  const [device, setDevice] = useState<(typeof WIDTHS)[number]["id"]>("desktop");
  const [reloadKey, setReloadKey] = useState(0);
  const [needsBuild, setNeedsBuild] = useState<boolean | null>(null);
  const [build, setBuild] = useState<{ status: BuildStatus; message: string | null }>({ status: "none", message: null });
  const [pageState, setPageState] = useState<"checking" | "ready" | "missing" | "failed">("checking");
  const [failure, setFailure] = useState<string | null>(null);

  const runBuild = useCallback(async () => {
    setBuild({ status: "building", message: null });
    const result = await postJson<BuildResponse>(base, {});
    if (!result.ok) {
      setBuild({ status: "failed", message: result.error });
      return;
    }
    setBuild(result.data.build);
    setReloadKey((value) => value + 1);
  }, [base]);

  // Read the build state. A new Next.js site that has never been built is built straight away.
  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await requestJson<BuildResponse>(base);
      if (!active) return;
      if (!result.ok) {
        setNeedsBuild(false);
        setBuild({ status: "failed", message: result.error });
        return;
      }
      setNeedsBuild(result.data.needsBuild);
      setBuild(result.data.build);
      if (result.data.needsBuild && result.data.build.status === "none") void runBuild();
    })();
    return () => {
      active = false;
    };
  }, [base, refreshKey, runBuild]);

  // While a build runs (started from another tab), check again until it finishes.
  useEffect(() => {
    if (build.status !== "building" || needsBuild === false) return;
    const timer = window.setInterval(() => {
      void (async () => {
        const result = await requestJson<BuildResponse>(base);
        if (result.ok && result.data.build.status !== "building") {
          setBuild(result.data.build);
          setReloadKey((value) => value + 1);
        }
      })();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [base, build.status, needsBuild]);

  const ready = build.status === "ready" || (needsBuild === false && build.status !== "building");
  const src = `/api/preview/${encodeURIComponent(projectId)}/index.html?v=${reloadKey}-${refreshKey}`;

  // Check that the page exists before showing the frame.
  useEffect(() => {
    if (!ready) return;
    let active = true;
    void (async () => {
      try {
        const response = await fetch(src, { cache: "no-store" });
        await response.body?.cancel().catch(() => {});
        if (!active) return;
        if (response.ok) setPageState("ready");
        else if (response.status === 404) setPageState("missing");
        else {
          setFailure(`The preview could not be loaded (status ${response.status}).`);
          setPageState("failed");
        }
      } catch {
        if (!active) return;
        setFailure("Couldn't reach the server. Is the app still running?");
        setPageState("failed");
      }
    })();
    return () => {
      active = false;
    };
  }, [ready, src]);

  const selected = WIDTHS.find((item) => item.id === device) ?? WIDTHS[2];
  const isBuilding = build.status === "building";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Preview size" className="inline-flex rounded-lg border border-[var(--line)] p-1">
          {WIDTHS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={device === item.id}
              onClick={() => setDevice(item.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                device === item.id ? "bg-[var(--foreground)] text-[var(--background)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {needsBuild ? (
            <button
              type="button"
              disabled={isBuilding}
              onClick={() => void runBuild()}
              className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--foreground)] transition hover:bg-[var(--surface-hover)] disabled:opacity-40"
            >
              {isBuilding ? "Building…" : "Build again"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setReloadKey((value) => value + 1)}
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--foreground)] transition hover:bg-[var(--surface-hover)]"
          >
            Reload
          </button>
        </div>
      </div>

      {isBuilding ? (
        <p role="status" className="text-sm text-[var(--muted)]">
          Building your site. This usually takes 10 to 30 seconds.
        </p>
      ) : null}

      {build.status === "failed" ? (
        <div role="alert" className="rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 p-4">
          <p className="text-sm text-[var(--foreground)]">The site could not be built, so there is nothing to show yet.</p>
          {build.message ? (
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-[var(--muted)]">
              {build.message}
            </pre>
          ) : null}
          <p className="mt-2 text-xs text-[var(--muted)]">
            Ask for a fix in the Chat tab (Build mode), for example “fix the build error”.
          </p>
        </div>
      ) : null}

      {!isBuilding && build.status !== "failed" && pageState === "checking" && ready ? (
        <p className="text-sm text-[var(--muted)]">Loading preview…</p>
      ) : null}

      {pageState === "missing" ? (
        <div className="rounded-2xl border border-dashed border-[var(--line)] p-8 text-center">
          <p className="text-sm text-[var(--foreground)]">There is no website to preview yet.</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Ask for one in the Chat tab (Build mode), for example “make a one-page site with a heading and a contact link”.
          </p>
        </div>
      ) : null}

      {pageState === "failed" ? <p role="alert" className="text-sm text-[var(--accent-text)]">{failure}</p> : null}

      {!isBuilding && build.status !== "failed" && pageState === "ready" ? (
        <div className="flex min-h-[420px] flex-1 justify-center overflow-auto rounded-xl border border-[var(--line)] bg-[var(--surface-deep)] p-3">
          <iframe
            key={`${device}-${reloadKey}-${refreshKey}`}
            src={src}
            title="Website preview"
            sandbox="allow-scripts"
            style={{ width: selected.width ? `${selected.width}px` : "100%", maxWidth: "100%" }}
            className="h-[70vh] min-h-[420px] rounded-lg bg-white"
          />
        </div>
      ) : null}
    </div>
  );
}
