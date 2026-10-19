import type { Metadata } from "next";
import { ProjectsWorkspace } from "@/components/projects/ProjectsWorkspace";

export const metadata: Metadata = {
  title: "Projects · VYXO",
  description: "Organize conversations into local project workspaces.",
};

export default function ProjectsPage() {
  return (
    <section className="mx-auto max-w-5xl">
      <header className="mb-8 max-w-2xl">
        <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.24em] text-[var(--accent-text)]">
          Projects / local only
        </p>
        <h2 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)] sm:text-4xl">
          A home for the work.
        </h2>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          Group conversations into projects. Projects store only a name,
          description, and archive state on this Mac — conversations and
          memories are kept separately.
        </p>
      </header>
      <ProjectsWorkspace />
    </section>
  );
}
