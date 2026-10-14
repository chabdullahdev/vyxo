import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { DEFAULT_STORAGE_DIR } from "../memory/store.ts";

export const CONVERSATION_SCHEMA_VERSION = 1;

export const DEFAULT_CONVERSATION_TITLE = "New conversation";

export const DEFAULT_MAX_TITLE_LENGTH = 120;
export const DEFAULT_MAX_MESSAGE_LENGTH = 50_000;
export const DEFAULT_MAX_ERROR_LENGTH = 2_000;
export const DEFAULT_MAX_CONVERSATIONS = 500;
export const DEFAULT_MAX_MESSAGES_PER_CONVERSATION = 1_000;

export const DEFAULT_CONVERSATION_STORAGE_PATH = join(
  DEFAULT_STORAGE_DIR,
  "conversations.json",
);

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_ID_LENGTH = 256;
const MAX_ID_ATTEMPTS = 10;
const PREVIEW_LENGTH = 140;
const TITLE_DERIVE_LENGTH = 64;
const TITLE_MIN_BREAK = 40;

export type ConversationMessageRole = "user" | "assistant";

export type ConversationMessageStatus = "complete" | "interrupted" | "failed";

export interface ConversationMessage {
  id: string;
  role: ConversationMessageRole;
  content: string;
  status: ConversationMessageStatus;
  error?: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  projectId: string | null;
  messages: ConversationMessage[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  projectId: string | null;
  messageCount: number;
  preview: string;
}

export interface ConversationDocument {
  version: number;
  conversations: Conversation[];
}

export interface ConversationLimits {
  maxTitleLength: number;
  maxMessageLength: number;
}

export type ConversationErrorCode =
  | "INVALID_TITLE"
  | "INVALID_CONTENT"
  | "INVALID_ARGUMENT"
  | "INVALID_STATUS"
  | "NOT_FOUND"
  | "DUPLICATE_ID"
  | "LIMIT_EXCEEDED"
  | "UNSUPPORTED_VERSION"
  | "CORRUPT_DATA"
  | "STORAGE_IO";

export class ConversationError extends Error {
  readonly code: ConversationErrorCode;

  constructor(code: ConversationErrorCode, message: string) {
    super(message);
    this.name = "ConversationError";
    this.code = code;
  }
}

export interface ConversationStoreOptions {
  filePath?: string;
  clock?: () => Date;
  idFactory?: () => string;
  maxTitleLength?: number;
  maxMessageLength?: number;
  maxConversations?: number;
  maxMessagesPerConversation?: number;
}

export interface AppendUserMessageInput {
  id?: string;
  content: string;
}

export interface AppendAssistantMessageInput {
  content: string;
  status: ConversationMessageStatus;
  error?: string;
}

export interface AppendUserMessageResult {
  conversation: Conversation;
  message: ConversationMessage;
  created: boolean;
}

export interface AppendAssistantMessageResult {
  conversation: Conversation;
  message: ConversationMessage;
}

export interface ListConversationsOptions {
  query?: string;
  archived?: "active" | "archived" | "all";
  projectId?: string;
}

const ROLES: ReadonlySet<string> = new Set(["user", "assistant"]);
const STATUSES: ReadonlySet<string> = new Set([
  "complete",
  "interrupted",
  "failed",
]);

function isErrnoWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === code
  );
}

export function isValidConversationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    value.trim() === value &&
    !/\s/.test(value)
  );
}

function isValidTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function deriveConversationTitle(content: string): string {
  const collapsed = collapseWhitespace(content);
  if (collapsed.length === 0) return DEFAULT_CONVERSATION_TITLE;
  if (collapsed.length <= TITLE_DERIVE_LENGTH) return collapsed;
  const truncated = collapsed.slice(0, TITLE_DERIVE_LENGTH);
  const lastSpace = truncated.lastIndexOf(" ");
  const base = lastSpace >= TITLE_MIN_BREAK ? truncated.slice(0, lastSpace) : truncated;
  return `${base.trimEnd()}…`;
}

export function conversationMatchesQuery(
  conversation: Pick<Conversation, "title" | "messages">,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  if (conversation.title.toLowerCase().includes(needle)) return true;
  return conversation.messages.some((message) =>
    message.content.toLowerCase().includes(needle),
  );
}

function normalizeTitle(value: unknown, maxTitleLength: number, allowEmpty: boolean): string {
  if (typeof value !== "string") {
    throw new ConversationError("INVALID_TITLE", "A conversation title must be text.");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 && !allowEmpty) {
    throw new ConversationError("INVALID_TITLE", "A conversation title cannot be empty.");
  }
  if (trimmed.length > maxTitleLength) {
    throw new ConversationError(
      "INVALID_TITLE",
      `A conversation title exceeds the maximum length of ${maxTitleLength} characters.`,
    );
  }
  return trimmed;
}

function validateMessageContent(value: unknown, maxMessageLength: number): string {
  if (typeof value !== "string") {
    throw new ConversationError("INVALID_CONTENT", "Message content must be text.");
  }
  if (value.length > maxMessageLength) {
    throw new ConversationError(
      "INVALID_CONTENT",
      `Message content exceeds the maximum length of ${maxMessageLength} characters.`,
    );
  }
  return value;
}

function validateMessageError(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConversationError(
      "INVALID_STATUS",
      "A failed message must include a short error message.",
    );
  }
  if (value.length > DEFAULT_MAX_ERROR_LENGTH) {
    throw new ConversationError(
      "INVALID_STATUS",
      `A failed message error exceeds the maximum length of ${DEFAULT_MAX_ERROR_LENGTH} characters.`,
    );
  }
  return value;
}

function validateStoredMessage(
  input: unknown,
  maxMessageLength: number,
  seenIds: Set<string>,
  conversationId: string,
): ConversationMessage {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ConversationError("CORRUPT_DATA", "The conversation file contains an invalid message.");
  }

  const record = input as {
    id?: unknown;
    role?: unknown;
    content?: unknown;
    status?: unknown;
    error?: unknown;
    createdAt?: unknown;
  };

  if (!isValidConversationId(record.id)) {
    throw new ConversationError("CORRUPT_DATA", "A stored message has an invalid id.");
  }
  if (seenIds.has(record.id)) {
    throw new ConversationError("DUPLICATE_ID", `Duplicate message id: ${record.id}`);
  }
  seenIds.add(record.id);

  if (typeof record.role !== "string" || !ROLES.has(record.role)) {
    throw new ConversationError("CORRUPT_DATA", `Message ${record.id} has an invalid role.`);
  }
  if (typeof record.status !== "string" || !STATUSES.has(record.status)) {
    throw new ConversationError("CORRUPT_DATA", `Message ${record.id} has an invalid status.`);
  }

  const role = record.role as ConversationMessageRole;
  const status = record.status as ConversationMessageStatus;

  if (role === "user" && status !== "complete") {
    throw new ConversationError(
      "CORRUPT_DATA",
      `User message ${record.id} in conversation ${conversationId} must be complete.`,
    );
  }

  const content = validateMessageContent(record.content, maxMessageLength);

  if (!isValidTimestamp(record.createdAt)) {
    throw new ConversationError("CORRUPT_DATA", `Message ${record.id} has an invalid createdAt timestamp.`);
  }

  if (status === "failed") {
    return {
      id: record.id,
      role,
      content,
      status,
      error: validateMessageError(record.error),
      createdAt: record.createdAt,
    };
  }

  if (content.trim().length === 0) {
    throw new ConversationError("CORRUPT_DATA", `Message ${record.id} has empty content.`);
  }
  if (record.error !== undefined) {
    throw new ConversationError("CORRUPT_DATA", `Message ${record.id} has an unexpected error field.`);
  }

  return {
    id: record.id,
    role,
    content,
    status,
    createdAt: record.createdAt,
  };
}

export function validateConversationDocument(
  input: unknown,
  limits: ConversationLimits = {
    maxTitleLength: DEFAULT_MAX_TITLE_LENGTH,
    maxMessageLength: DEFAULT_MAX_MESSAGE_LENGTH,
  },
): ConversationDocument {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ConversationError("CORRUPT_DATA", "The conversation file has an invalid structure.");
  }

  const { version, conversations } = input as {
    version?: unknown;
    conversations?: unknown;
  };

  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new ConversationError("CORRUPT_DATA", "The conversation file is missing a valid schema version.");
  }

  if (version !== CONVERSATION_SCHEMA_VERSION) {
    throw new ConversationError(
      "UNSUPPORTED_VERSION",
      `Unsupported conversation schema version ${version}. Expected ${CONVERSATION_SCHEMA_VERSION}.`,
    );
  }

  if (!Array.isArray(conversations)) {
    throw new ConversationError("CORRUPT_DATA", "The conversation file is missing its conversation list.");
  }

  const seen = new Set<string>();
  const validated: Conversation[] = [];

  for (const entry of conversations) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new ConversationError("CORRUPT_DATA", "The conversation file contains an invalid record.");
    }

    const record = entry as {
      id?: unknown;
      title?: unknown;
      createdAt?: unknown;
      updatedAt?: unknown;
      archived?: unknown;
      projectId?: unknown;
      messages?: unknown;
    };

    if (!isValidConversationId(record.id)) {
      throw new ConversationError("CORRUPT_DATA", "The conversation file contains a record with an invalid id.");
    }
    if (seen.has(record.id)) {
      throw new ConversationError("DUPLICATE_ID", `Duplicate conversation id: ${record.id}`);
    }
    seen.add(record.id);

    const title = normalizeTitle(record.title, limits.maxTitleLength, true);

    if (!isValidTimestamp(record.createdAt)) {
      throw new ConversationError("CORRUPT_DATA", `Conversation ${record.id} has an invalid createdAt timestamp.`);
    }
    if (!isValidTimestamp(record.updatedAt)) {
      throw new ConversationError("CORRUPT_DATA", `Conversation ${record.id} has an invalid updatedAt timestamp.`);
    }
    if (typeof record.archived !== "boolean") {
      throw new ConversationError("CORRUPT_DATA", `Conversation ${record.id} has an invalid archived flag.`);
    }
    if (!Array.isArray(record.messages)) {
      throw new ConversationError("CORRUPT_DATA", `Conversation ${record.id} is missing its message list.`);
    }

    let projectId: string | null = null;
    if (record.projectId !== undefined && record.projectId !== null) {
      if (!isValidConversationId(record.projectId)) {
        throw new ConversationError("CORRUPT_DATA", `Conversation ${record.id} has an invalid projectId.`);
      }
      projectId = record.projectId;
    }

    const messageIds = new Set<string>();
    const messages = record.messages.map((message) =>
      validateStoredMessage(message, limits.maxMessageLength, messageIds, record.id as string),
    );

    validated.push({
      id: record.id,
      title,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      archived: record.archived,
      projectId,
      messages,
    });
  }

  return { version, conversations: validated };
}

function cloneMessage(message: ConversationMessage): ConversationMessage {
  return { ...message };
}

function cloneConversation(conversation: Conversation): Conversation {
  return { ...conversation, messages: conversation.messages.map(cloneMessage) };
}

function summarize(conversation: Conversation): ConversationSummary {
  const last = conversation.messages[conversation.messages.length - 1];
  const rawPreview = last ? collapseWhitespace(last.content) : "";
  const preview =
    rawPreview.length > PREVIEW_LENGTH
      ? `${rawPreview.slice(0, PREVIEW_LENGTH).trimEnd()}…`
      : rawPreview;

  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    archived: conversation.archived,
    projectId: conversation.projectId,
    messageCount: conversation.messages.length,
    preview,
  };
}

export class ConversationStore {
  readonly filePath: string;

  readonly #clock: () => Date;
  readonly #idFactory: () => string;
  readonly #maxTitleLength: number;
  readonly #maxMessageLength: number;
  readonly #maxConversations: number;
  readonly #maxMessagesPerConversation: number;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: ConversationStoreOptions = {}) {
    this.filePath = options.filePath ?? DEFAULT_CONVERSATION_STORAGE_PATH;
    this.#clock = options.clock ?? (() => new Date());
    this.#idFactory = options.idFactory ?? (() => randomUUID());
    this.#maxTitleLength = options.maxTitleLength ?? DEFAULT_MAX_TITLE_LENGTH;
    this.#maxMessageLength = options.maxMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH;
    this.#maxConversations = options.maxConversations ?? DEFAULT_MAX_CONVERSATIONS;
    this.#maxMessagesPerConversation =
      options.maxMessagesPerConversation ?? DEFAULT_MAX_MESSAGES_PER_CONVERSATION;
  }

  listConversations(options: ListConversationsOptions = {}): Promise<ConversationSummary[]> {
    return this.#exclusive(async () => {
      const document = await this.#read();
      const archived = options.archived ?? "active";
      const query = options.query ?? "";
      const projectId = options.projectId;

      return document.conversations
        .filter((conversation) => {
          if (archived === "active") return !conversation.archived;
          if (archived === "archived") return conversation.archived;
          return true;
        })
        .filter((conversation) => projectId === undefined || conversation.projectId === projectId)
        .filter((conversation) => conversationMatchesQuery(conversation, query))
        .map(summarize)
        .sort(
          (a, b) =>
            b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
        );
    });
  }

  getConversation(id: string): Promise<Conversation> {
    return this.#exclusive(async () => {
      this.#assertId(id);
      const document = await this.#read();
      const found = document.conversations.find((conversation) => conversation.id === id);
      if (!found) {
        throw new ConversationError("NOT_FOUND", "Conversation not found.");
      }
      return cloneConversation(found);
    });
  }

  createConversation(title?: string, projectId?: string | null): Promise<Conversation> {
    return this.#exclusive(async () => {
      const normalizedTitle = normalizeTitle(title ?? "", this.#maxTitleLength, true);
      if (projectId !== undefined && projectId !== null && !isValidConversationId(projectId)) {
        throw new ConversationError("INVALID_ARGUMENT", "A project id must be a valid id.");
      }
      const document = await this.#read();
      if (document.conversations.length >= this.#maxConversations) {
        throw new ConversationError(
          "LIMIT_EXCEEDED",
          `The conversation limit of ${this.#maxConversations} has been reached. Delete or archive older conversations.`,
        );
      }
      const id = this.#generateId(document);
      const now = this.#clock().toISOString();
      const conversation: Conversation = {
        id,
        title: normalizedTitle,
        createdAt: now,
        updatedAt: now,
        archived: false,
        projectId: projectId ?? null,
        messages: [],
      };
      document.conversations.push(conversation);
      await this.#write(document);
      return cloneConversation(conversation);
    });
  }

  setConversationProject(id: string, projectId: string | null): Promise<Conversation> {
    return this.#exclusive(async () => {
      this.#assertId(id);
      if (projectId !== null && !isValidConversationId(projectId)) {
        throw new ConversationError("INVALID_ARGUMENT", "A project id must be a valid id.");
      }
      const document = await this.#read();
      const conversation = document.conversations.find((entry) => entry.id === id);
      if (!conversation) {
        throw new ConversationError("NOT_FOUND", "Conversation not found.");
      }
      conversation.projectId = projectId;
      await this.#write(document);
      return cloneConversation(conversation);
    });
  }

  clearConversationsProject(projectId: string): Promise<number> {
    return this.#exclusive(async () => {
      if (!isValidConversationId(projectId)) {
        throw new ConversationError("INVALID_ARGUMENT", "A project id must be a valid id.");
      }
      const document = await this.#read();
      let cleared = 0;
      for (const conversation of document.conversations) {
        if (conversation.projectId === projectId) {
          conversation.projectId = null;
          cleared += 1;
        }
      }
      if (cleared > 0) {
        await this.#write(document);
      }
      return cleared;
    });
  }

  renameConversation(id: string, title: string): Promise<Conversation> {
    return this.#exclusive(async () => {
      this.#assertId(id);
      const normalizedTitle = normalizeTitle(title, this.#maxTitleLength, false);
      const document = await this.#read();
      const conversation = document.conversations.find((entry) => entry.id === id);
      if (!conversation) {
        throw new ConversationError("NOT_FOUND", "Conversation not found.");
      }
      conversation.title = normalizedTitle;
      await this.#write(document);
      return cloneConversation(conversation);
    });
  }

  setConversationArchived(id: string, archived: boolean): Promise<Conversation> {
    return this.#exclusive(async () => {
      this.#assertId(id);
      if (typeof archived !== "boolean") {
        throw new ConversationError("INVALID_ARGUMENT", "`archived` must be a boolean.");
      }
      const document = await this.#read();
      const conversation = document.conversations.find((entry) => entry.id === id);
      if (!conversation) {
        throw new ConversationError("NOT_FOUND", "Conversation not found.");
      }
      conversation.archived = archived;
      await this.#write(document);
      return cloneConversation(conversation);
    });
  }

  deleteConversation(id: string): Promise<boolean> {
    return this.#exclusive(async () => {
      this.#assertId(id);
      const document = await this.#read();
      const remaining = document.conversations.filter((conversation) => conversation.id !== id);
      if (remaining.length === document.conversations.length) {
        return false;
      }
      document.conversations = remaining;
      await this.#write(document);
      return true;
    });
  }

  appendUserMessage(
    conversationId: string,
    input: AppendUserMessageInput,
  ): Promise<AppendUserMessageResult> {
    return this.#exclusive(async () => {
      this.#assertId(conversationId);
      if (input.id !== undefined && !isValidConversationId(input.id)) {
        throw new ConversationError("INVALID_ARGUMENT", "A user message id must be a valid id.");
      }
      const content = validateMessageContent(input.content, this.#maxMessageLength);
      if (content.trim().length === 0) {
        throw new ConversationError("INVALID_CONTENT", "A user message cannot be empty.");
      }

      const document = await this.#read();
      const conversation = document.conversations.find((entry) => entry.id === conversationId);
      if (!conversation) {
        throw new ConversationError("NOT_FOUND", "Conversation not found.");
      }

      if (input.id !== undefined) {
        const existing = conversation.messages.find((message) => message.id === input.id);
        if (existing) {
          return {
            conversation: cloneConversation(conversation),
            message: cloneMessage(existing),
            created: false,
          };
        }
      }

      if (conversation.messages.length >= this.#maxMessagesPerConversation) {
        throw new ConversationError(
          "LIMIT_EXCEEDED",
          `This conversation has reached its message limit of ${this.#maxMessagesPerConversation}. Start a new conversation.`,
        );
      }

      const id = input.id ?? this.#generateMessageId(conversation);
      const now = this.#clock().toISOString();
      const message: ConversationMessage = {
        id,
        role: "user",
        content,
        status: "complete",
        createdAt: now,
      };

      conversation.messages.push(message);
      conversation.updatedAt = now;
      if (conversation.messages.length === 1 && conversation.title.length === 0) {
        conversation.title = deriveConversationTitle(content).slice(0, this.#maxTitleLength);
      }

      await this.#write(document);
      return {
        conversation: cloneConversation(conversation),
        message: cloneMessage(message),
        created: true,
      };
    });
  }

  appendAssistantMessage(
    conversationId: string,
    input: AppendAssistantMessageInput,
  ): Promise<AppendAssistantMessageResult> {
    return this.#exclusive(async () => {
      this.#assertId(conversationId);
      if (typeof input.status !== "string" || !STATUSES.has(input.status)) {
        throw new ConversationError("INVALID_STATUS", "An assistant message status is invalid.");
      }
      const content = validateMessageContent(input.content, this.#maxMessageLength);

      let error: string | undefined;
      if (input.status === "failed") {
        error = validateMessageError(input.error);
      } else {
        if (content.trim().length === 0) {
          throw new ConversationError(
            "INVALID_CONTENT",
            "A saved assistant response must have content.",
          );
        }
        if (input.error !== undefined) {
          throw new ConversationError("INVALID_STATUS", "Only failed messages can include an error.");
        }
      }

      const document = await this.#read();
      const conversation = document.conversations.find((entry) => entry.id === conversationId);
      if (!conversation) {
        throw new ConversationError("NOT_FOUND", "Conversation not found.");
      }
      if (conversation.messages.length >= this.#maxMessagesPerConversation) {
        throw new ConversationError(
          "LIMIT_EXCEEDED",
          `This conversation has reached its message limit of ${this.#maxMessagesPerConversation}. Start a new conversation.`,
        );
      }

      const id = this.#generateMessageId(conversation);
      const now = this.#clock().toISOString();
      const message: ConversationMessage = {
        id,
        role: "assistant",
        content,
        status: input.status,
        ...(error ? { error } : {}),
        createdAt: now,
      };

      conversation.messages.push(message);
      conversation.updatedAt = now;

      await this.#write(document);
      return {
        conversation: cloneConversation(conversation),
        message: cloneMessage(message),
      };
    });
  }

  #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(operation, operation);
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  #assertId(id: unknown): asserts id is string {
    if (!isValidConversationId(id)) {
      throw new ConversationError("INVALID_ARGUMENT", "A valid conversation id is required.");
    }
  }

  #generateId(document: ConversationDocument): string {
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
      const candidate = this.#idFactory();
      if (
        isValidConversationId(candidate) &&
        !document.conversations.some((conversation) => conversation.id === candidate)
      ) {
        return candidate;
      }
    }
    throw new ConversationError("DUPLICATE_ID", "Could not generate a unique conversation id.");
  }

  #generateMessageId(conversation: Conversation): string {
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
      const candidate = this.#idFactory();
      if (
        isValidConversationId(candidate) &&
        !conversation.messages.some((message) => message.id === candidate)
      ) {
        return candidate;
      }
    }
    throw new ConversationError("DUPLICATE_ID", "Could not generate a unique message id.");
  }

  async #read(): Promise<ConversationDocument> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isErrnoWithCode(error, "ENOENT")) {
        return { version: CONVERSATION_SCHEMA_VERSION, conversations: [] };
      }
      throw new ConversationError("STORAGE_IO", "Could not read the conversation file.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ConversationError(
        "CORRUPT_DATA",
        "The conversation file is not valid JSON. It was left unchanged.",
      );
    }

    return validateConversationDocument(parsed, {
      maxTitleLength: this.#maxTitleLength,
      maxMessageLength: this.#maxMessageLength,
    });
  }

  async #write(document: ConversationDocument): Promise<void> {
    const validated = validateConversationDocument(document, {
      maxTitleLength: this.#maxTitleLength,
      maxMessageLength: this.#maxMessageLength,
    });
    const data = `${JSON.stringify(validated, null, 2)}\n`;
    const directory = dirname(this.filePath);
    const temporaryPath = join(
      directory,
      `.${basename(this.filePath)}.${process.pid}.${randomUUID()}.tmp`,
    );

    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      await mkdir(directory, { recursive: true, mode: DIR_MODE });
      handle = await open(temporaryPath, "wx", FILE_MODE);
      await handle.writeFile(data, "utf8");
      await handle.chmod(FILE_MODE);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, this.filePath);
    } catch {
      if (handle) {
        try {
          await handle.close();
        } catch {
          // ignore cleanup failure
        }
      }
      try {
        await unlink(temporaryPath);
      } catch {
        // ignore cleanup failure
      }
      throw new ConversationError(
        "STORAGE_IO",
        "Could not save conversation data. Existing data was left unchanged.",
      );
    }
  }
}

export function createConversationStore(
  options: ConversationStoreOptions = {},
): ConversationStore {
  return new ConversationStore(options);
}

export const conversationStore = new ConversationStore();
