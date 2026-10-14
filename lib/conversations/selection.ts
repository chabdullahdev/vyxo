export interface InitialSelectionConversation {
  id: string;
  archived: boolean;
}

export type InitialSelection =
  | { kind: "open"; id: string }
  | { kind: "draft" };

export interface InitialSelectionInput {
  initialConversationId: string | null;
  initialProjectId: string | null;
  conversations: readonly InitialSelectionConversation[];
}

export function chooseInitialConversation({
  initialConversationId,
  initialProjectId,
  conversations,
}: InitialSelectionInput): InitialSelection {
  if (initialConversationId) {
    return { kind: "open", id: initialConversationId };
  }

  if (initialProjectId) {
    return { kind: "draft" };
  }

  const firstActive = conversations.find((conversation) => !conversation.archived);
  return firstActive ? { kind: "open", id: firstActive.id } : { kind: "draft" };
}
