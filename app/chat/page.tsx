import type { Metadata } from "next";
import { ChatWorkspace } from "@/components/chat/ChatWorkspace";
import { ModelSelector } from "@/components/settings/ModelSelector";
import { SetupGuide } from "@/components/workspace/SetupGuide";

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
      <header className="mb-4 flex shrink-0 flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.24em] text-[var(--accent)]">
            Private · runs on this computer
          </p>
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-[-0.03em] text-[var(--foreground)]">
            Think out loud.
          </h2>
        </div>
        <ModelSelector />
      </header>
      <SetupGuide />
      <ChatWorkspace initialConversationId={conversationId} initialProjectId={projectId} />
    </section>
  );
}
