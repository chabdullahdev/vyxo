import type { Metadata } from "next";
import { ChatWorkspace } from "@/components/chat/ChatWorkspace";
import { ModelSelector } from "@/components/settings/ModelSelector";

export const metadata: Metadata = {
  title: "Chat · VYXO",
  description: "Private local chat with saved conversations on your own machine.",
};

interface ChatPageProps {
  searchParams: Promise<{
    conversation?: string | string[];
    project?: string | string[];
  }>;
}

export default async function ChatPage({ searchParams }: ChatPageProps) {
  const params = await searchParams;
  const conversationId = typeof params.conversation === "string" ? params.conversation : null;
  const projectId = typeof params.project === "string" ? params.project : null;

  return (
    <section className="mx-auto flex h-full min-h-0 w-full max-w-[1320px] flex-col">
      <header className="mb-6 flex shrink-0 flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.24em] text-[var(--accent)]">
            Local model / saved on this Mac
          </p>
          <h2 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)] sm:text-4xl">
            Think out loud.
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--muted)]">
            Talk with your selected local model on this Mac. Conversations are
            saved locally, and selected project files are read only for the
            current request.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
            No cloud routing
          </div>
          <ModelSelector />
        </div>
      </header>
      <ChatWorkspace initialConversationId={conversationId} initialProjectId={projectId} />
    </section>
  );
}
