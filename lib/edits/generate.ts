import { discoverInstalledModels } from "../models/catalog.ts";
import { getProvider } from "../models/registry.ts";
import { settingsStore } from "../settings/store.ts";
import { REQUEST_TIMEOUT_MS } from "../config.ts";
import type { ChatMessage } from "../models/types.ts";
import { EditError } from "./types.ts";

export const PROPOSAL_SYSTEM_PROMPT = `You propose precise, minimal code changes for a local project. You never write files yourself; you only return a structured proposal that a human reviews and approves.

Return ONLY a JSON object, with no prose and no markdown fences, in exactly this shape:
{"summary":"one short paragraph describing the change","operations":[{"op":"modify","path":"relative/path.ts","content":"FULL new file content"},{"op":"create","path":"relative/new-file.ts","content":"FULL file content"},{"op":"delete","path":"relative/old-file.ts"}]}

Rules:
- Paths are relative to the project root, using forward slashes. Never use absolute paths or "..".
- "content" must be the complete new file content for create and modify. Omit "content" for delete.
- Only touch files that are truly needed. Do not rewrite unrelated files or reformat whole files.
- Follow the project's existing conventions. Prefer small, focused changes. Add or update tests when it is natural.
- Never propose changes to .env files, credentials, private keys, lockfiles, or generated/dependency folders.
- If the request is ambiguous or destructive, propose the smallest safe change and explain the open question in the summary.
- You cannot run commands or tests; never claim that you did.`;

export interface GenerateInput {
  request: string;
  contextText: string | null;
  evidenceText: string | null;
}

export interface GenerateResult {
  text: string;
  model: string;
}

export async function generateProposalText(input: GenerateInput): Promise<GenerateResult> {
  const selectedModel = (await settingsStore.getSettings()).selectedModel;
  const discovery = await discoverInstalledModels();
  if (!discovery.ok) {
    throw new EditError("INVALID_REQUEST", discovery.message);
  }
  if (!discovery.models.includes(selectedModel)) {
    throw new EditError("INVALID_REQUEST", "The selected model is not installed in Ollama.");
  }

  const messages: ChatMessage[] = [{ role: "system", content: PROPOSAL_SYSTEM_PROMPT }];
  if (input.contextText) messages.push({ role: "system", content: input.contextText });
  if (input.evidenceText) messages.push({ role: "system", content: input.evidenceText });
  messages.push({ role: "user", content: input.request });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let text = "";
  try {
    for await (const chunk of getProvider(selectedModel).streamChat({
      messages,
      signal: controller.signal,
    })) {
      text += chunk;
      if (text.length > 200_000) break;
    }
  } catch {
    throw new EditError("INVALID_REQUEST", "The local model could not generate a proposal.");
  } finally {
    clearTimeout(timeout);
  }

  return { text, model: selectedModel };
}
