import type { Metadata } from "next";
import { AgentsWorkspace } from "@/components/agents/AgentsWorkspace";

export const metadata: Metadata = {
  title: "Agents · VYXO",
  description: "Plan a task, delegate it to specialists, and review the results.",
};

export default function AgentsPage() {
  return (
    <section className="mx-auto max-w-5xl">
      <header className="mb-8 max-w-2xl">
        <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.24em] text-[var(--accent)]">
          Agents / local only
        </p>
        <h2 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)] sm:text-4xl">
          Specialists, on your behalf.
        </h2>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          VYXO plans a request, assigns bounded subtasks to specialists, and runs
          them one at a time on your local model. Specialists work only within
          their declared capabilities, and any code change is proposed for your
          explicit approval.
        </p>
      </header>
      <AgentsWorkspace />
    </section>
  );
}
