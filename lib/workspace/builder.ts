import { containsBinaryBytes, containsLikelySecret, classifyProjectFilePath } from "../project/policy.ts";
import { REQUEST_TIMEOUT_MS } from "../config.ts";
import { readBuilderOutput, type RawProposal } from "../edits/build.ts";
import { discoverInstalledModels } from "../models/catalog.ts";
import { getProvider } from "../models/registry.ts";
import type { ChatMessage } from "../models/types.ts";
import { settingsStore } from "../settings/store.ts";
import { EditError } from "../edits/types.ts";
import { listFilesLimited, readWorkspaceFile } from "./files.ts";

/**
 * Build mode: ask the local model to create or change the files of a workspace project.
 *
 * The prompt and the answer format were chosen by trying real requests against a small local model.
 * A plain "file block" format was read correctly far more often than JSON, which small models often
 * leave unfinished or fill with changes that parse but do nothing. Whatever comes back is still only a
 * proposal: it is checked and shown to the person, and nothing is written until they approve it.
 */

export const BUILD_CONTEXT_TOKENS = 16_384;
export const BUILD_MAX_TOKENS = 8_000;
export const CONTEXT_FILE_LIMIT = 300;
export const CONTEXT_CHAR_BUDGET = 28_000;
export const CONTEXT_MAX_FILE_BYTES = 40_000;

export const BUILDER_SYSTEM_PROMPT = `You are the builder inside VYXO, a private workspace on the user's computer. You create and edit the files of the project the user has open. A person reviews every change before it is applied, so write the files and do not explain at length.

When the person asks for something to be created or changed, reply in exactly this format and nothing else:

SUMMARY: one or two plain sentences saying what you changed.
<<<FILE path/to/file.ext>>>
the COMPLETE new contents of that file
<<<END>>>

Rules for changes:
- Write each file you create or change as one block, with its complete contents. Never write a fragment, "..." or "rest unchanged".
- Close every block with <<<END>>> on its own line.
- To remove a file, write <<<DELETE path/to/file.ext>>> on its own line.
- Paths are relative to the project folder, use forward slashes, and never start with "/" or contain "..".
- Change only what the request needs. Keep every other file, and every other part of a file, exactly as it is.
- Do not put markdown code fences around files.
- A website must work with no internet: no external fonts, scripts, stylesheets, images, or CDNs. Keep everything in the project's own files.
- You cannot run anything, so never say that you tested or ran something.

If the person is only asking a question, or nothing needs to change, answer in a few plain sentences and write no file blocks.`;

const KEY_FILES = new Set([
  "index.html",
  "content.ts",
  "page.tsx",
  "layout.tsx",
  "globals.css",
  "styles.css",
  "style.css",
  "script.js",
  "main.js",
  "app.js",
  "readme.md",
  "summary.md",
  "overview.md",
]);

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);
}

/**
 * Tell the model what exists: the list of files, then the contents of the ones that matter for this
 * request, within a budget that leaves room for the answer.
 */
export async function buildWorkspaceContext(folder: string, request: string): Promise<string> {
  const { files, truncated } = await listFilesLimited(folder, CONTEXT_FILE_LIMIT);
  if (files.length === 0) return "The project has no files yet.";

  const requestLower = request.toLowerCase();
  const requestWords = words(request);

  const candidates: { path: string; score: number; size: number }[] = [];
  for (const file of files) {
    if (classifyProjectFilePath(file.path) !== "allowed" || file.size > CONTEXT_MAX_FILE_BYTES) continue;
    const name = file.path.split("/").pop()?.toLowerCase() ?? "";
    const stem = name.replace(/\.[^.]+$/, "");
    let score = 0;
    if (requestLower.includes(file.path.toLowerCase())) score += 100;
    else if (stem.length >= 3 && requestLower.includes(stem)) score += 60;
    if (KEY_FILES.has(name)) score += 30;
    for (const word of words(file.path)) if (requestWords.has(word)) score += 10;
    candidates.push({ path: file.path, score, size: file.size });
  }
  candidates.sort((a, b) => b.score - a.score || a.size - b.size || a.path.localeCompare(b.path));

  const sections: string[] = [];
  let used = 0;
  for (const candidate of candidates) {
    if (used + candidate.size > CONTEXT_CHAR_BUDGET) continue;
    let bytes: Buffer;
    try {
      bytes = await readWorkspaceFile(folder, candidate.path);
    } catch {
      continue;
    }
    if (containsBinaryBytes(bytes)) continue;
    const text = bytes.toString("utf8");
    if (containsLikelySecret(text)) continue;
    sections.push(`--- ${candidate.path} ---\n${text}`);
    used += text.length;
  }

  const listing = files.map((file) => `- ${file.path} (${file.size} bytes)`).join("\n");
  return [
    `Files in the project${truncated ? ` (first ${files.length} shown)` : ""}:`,
    listing,
    sections.length > 0
      ? `\nContents of the files that matter for this request:\n\n${sections.join("\n\n")}`
      : "\nNo file contents are shown (the files are large or not text).",
  ].join("\n");
}

export interface BuilderInput {
  folder: string;
  request: string;
  /** The project's own notes (purpose, goals, instructions), if any. */
  projectNotes: string | null;
  /** Instructions for the kind of project (for example, how a Next.js site is laid out). */
  siteGuide?: string | null;
  signal?: AbortSignal;
}

export type BuilderResult =
  | { kind: "changes"; proposal: RawProposal; model: string }
  | { kind: "answer"; text: string; model: string };

export interface ChatCall {
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}

export type ChatFn = (call: ChatCall) => Promise<{ text: string; finished: boolean }>;

export interface BuilderDeps {
  resolveModel?: () => Promise<string>;
  chat?: ChatFn;
}

export async function resolveSelectedModel(): Promise<string> {
  const selectedModel = (await settingsStore.getSettings()).selectedModel;
  const discovery = await discoverInstalledModels();
  if (!discovery.ok) throw new EditError("INVALID_REQUEST", discovery.message);
  if (!discovery.models.includes(selectedModel)) {
    throw new EditError("INVALID_REQUEST", "The selected model is not installed in Ollama. Choose an installed model in Settings.");
  }
  return selectedModel;
}

const defaultChat: ChatFn = async ({ model, messages, signal }) => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, REQUEST_TIMEOUT_MS);
  let text = "";
  let finished = false;
  try {
    for await (const chunk of getProvider(model).streamChat({
      messages,
      signal: controller.signal,
      numCtx: BUILD_CONTEXT_TOKENS,
      maxTokens: BUILD_MAX_TOKENS,
      onFinish: (info) => {
        finished = info.doneReason === "stop";
      },
    })) {
      text += chunk;
      if (text.length > 400_000) break;
    }
  } catch {
    if (signal?.aborted) throw new EditError("INVALID_REQUEST", "Cancelled.");
    throw new EditError("INVALID_REQUEST", "The local model could not finish. Make sure Ollama is running, then try again.");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
  return { text, finished };
};

const CORRECTION = `Your last answer could not be read. Answer again using exactly this format and nothing else:

SUMMARY: what you changed.
<<<FILE path/to/file.ext>>>
the complete file
<<<END>>>

If no file needs to change, answer in plain sentences with no file blocks.`;

export async function runWorkspaceBuilder(input: BuilderInput, deps: BuilderDeps = {}): Promise<BuilderResult> {
  const model = await (deps.resolveModel ?? resolveSelectedModel)();
  const chat = deps.chat ?? defaultChat;
  const context = await buildWorkspaceContext(input.folder, input.request);

  const messages: ChatMessage[] = [{ role: "system", content: BUILDER_SYSTEM_PROMPT }];
  if (input.projectNotes) messages.push({ role: "system", content: input.projectNotes });
  if (input.siteGuide) messages.push({ role: "system", content: input.siteGuide });
  messages.push({ role: "system", content: context });
  messages.push({ role: "user", content: input.request });

  const first = await chat({ model, messages, signal: input.signal });
  try {
    return toResult(readBuilderOutput(first.text, first.finished), model);
  } catch (error) {
    // One more try when the answer was unreadable. A cut-off answer would only be cut off again.
    if (!(error instanceof EditError) || error.code !== "INVALID_PROPOSAL" || !first.finished) throw error;
    if (input.signal?.aborted) throw error;
    const retry = await chat({
      model,
      signal: input.signal,
      messages: [
        ...messages,
        { role: "assistant", content: first.text.slice(0, 4_000) },
        { role: "user", content: CORRECTION },
      ],
    });
    return toResult(readBuilderOutput(retry.text, retry.finished), model);
  }
}

function toResult(reading: ReturnType<typeof readBuilderOutput>, model: string): BuilderResult {
  return reading.kind === "changes"
    ? { kind: "changes", proposal: reading.proposal, model }
    : { kind: "answer", text: reading.text, model };
}
