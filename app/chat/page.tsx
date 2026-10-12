import type { Metadata } from "next";
import { ChatView } from "@/components/chat/ChatView";

export const metadata: Metadata = {
  title: "Chat · Ship Studio",
  description: "Private local chat powered by your own machine.",
};

export default function ChatPage() {
  return (
    <div className="min-h-screen bg-[var(--background)]">
      <main className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-8">
          <p className="mb-2 text-sm font-medium uppercase tracking-wider text-[var(--muted)]">
            Local model
          </p>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight text-[var(--foreground)]">
            Chat
          </h1>
          <p className="mt-2 text-[var(--muted)]">
            Talking to Qwen3 8B on this Mac. Conversations live in this tab only.
          </p>
        </header>
        <ChatView />
      </main>
    </div>
  );
}
