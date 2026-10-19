import type { Metadata } from "next";
import { SettingsPanel } from "@/components/settings/SettingsPanel";

export const metadata: Metadata = {
  title: "Settings · VYXO",
  description: "Local model, storage, and privacy settings for VYXO.",
};

export default function SettingsPage() {
  return (
    <section className="mx-auto max-w-3xl">
      <header className="mb-8 max-w-2xl">
        <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.24em] text-[var(--accent-text)]">
          Settings / local only
        </p>
        <h2 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)] sm:text-4xl">
          The controls belong here.
        </h2>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          Choose your local model and review what is stored on this Mac. Nothing
          on this page sends your data anywhere.
        </p>
      </header>
      <SettingsPanel />
    </section>
  );
}
