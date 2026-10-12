# Local AI Platform

> A private, self-hosted AI app running open-weight models on this Mac. No cloud, no recurring model API costs.

## What this is

A Next.js app that talks to AI models running locally through Ollama. All model
requests go through a server-side API route; the browser never contacts Ollama
directly. Conversations are **not** saved yet — they live only in the open tab.

## Brand / Visual

- Personality: private, calm, technical but plain-spoken.
- Colors: existing starter palette — off-white `#fafaf9` on off-black `#1c1917`,
  muted grey, red accent. Reused as-is.
- Fonts: Space Grotesk (display) + DM Sans (body), from the starter.

## Pages

- **Homepage** (`/`) — the original Ship Studio starter page, now with links to
  "Open AI Chat" and "Manage Memory".
- **Chat** (`/chat`) — local chat interface that streams answers from Qwen3 8B.
  Now uses a small, relevant slice of your saved memories as background.
- **Memory** (`/memory`) — manage the memories saved on this Mac (add, view,
  edit, delete with confirmation). Manage these by hand; the assistant can only
  read them.

## How it is structured

The model runtime is kept separate from everything else so memory, agents, and
permissions can be added later without touching chat.

```
lib/config.ts            Model name, Ollama URL, context size, request limits
lib/models/types.ts      The ModelProvider interface (the swap-in point)
lib/models/ollama.ts     Talks to Ollama, streams tokens, hides "thinking" output
lib/models/registry.ts   Returns the active provider (currently Ollama/Qwen3)
app/api/chat/route.ts    Server route: validates input, streams reply, handles cancel
app/chat/page.tsx        Chat page shell
components/chat/ChatView.tsx  The chat UI (input, messages, Stop button)
lib/memory/store.ts      Local memory storage (JSON file, atomic writes, validation)
lib/memory/retrieval.ts  Read-only relevance matcher + prompt formatting for chat
lib/memory/api.ts        Memory request/response logic (status codes, safe errors)
app/api/memories/route.ts       List + create memories
app/api/memories/[id]/route.ts  Get / update / delete one memory
app/memory/page.tsx      Memory page shell
components/memory/MemoryManager.tsx  The memory manager UI
```

## Memory API (schemas)

- `GET /api/memories` → `200 { memories: Memory[] }`
- `POST /api/memories` `{ content: string }` → `201 { memory }`
- `GET /api/memories/{id}` → `200 { memory }`
- `PATCH /api/memories/{id}` `{ content: string }` → `200 { memory }`
- `DELETE /api/memories/{id}` → `200 { deleted: true }`
- Errors → `{ error: string }` with `400` invalid input, `404` not found,
  `405` method not allowed, `415` wrong content type, `500` safe storage error.

A `Memory` is `{ id, content, createdAt, updatedAt }` (timestamps are ISO 8601).

## How memories are used in chat (read-only)

- For each chat request the server picks a **small, relevant** set of memories
  using a simple matcher (lowercased, punctuation stripped, common stop words
  ignored, plus light word-form normalization so e.g. `run`/`running` and
  `explain`/`explanations` match). Memories that share no meaningful word with
  your message are skipped — it never dumps the whole collection into the prompt.
- Limits (configurable in `lib/config.ts`): at most `MEMORY_MAX_RESULTS` (5)
  memories and `MEMORY_MAX_CONTEXT_CHARS` (2000) characters of memory text.
- The selected notes are sent to Qwen in a single **system** message that clearly
  labels them as **untrusted reference data, not instructions**. Their text is
  never executed, never treated as commands, and never able to change
  permissions or authorize tools.
- Chat can only **read** memories. Creating, editing and deleting happens by hand
  on `/memory`. If memory storage is missing or unreadable, chat continues
  without memory and logs only a safe code (no contents, no paths).

## Current model settings

- Model: `qwen3:8b` (only one, no picker yet).
- Context window: 8192 tokens (set via Ollama `num_ctx`; verified applied).
- Thinking output: hidden. Only the final answer is shown.
- Ollama stays bound to `localhost:11434` and is never exposed.

## Network / local access

- The dev server is configured to bind **only to `127.0.0.1:3697`** via the
  `dev` script (`next dev -H 127.0.0.1 -p 3697`). It is not reachable from other
  devices on your network.
- To confirm: `lsof -nP -iTCP:3697 -sTCP:LISTEN` should show `127.0.0.1:3697`
  (not `*:3697`). This applies on the next relaunch of the preview.
- This does not change the macOS firewall, and it does not secure the whole
  machine — it only limits where this app listens.

## How to customize

- To use a different model later: change `DEFAULT_MODEL` in `lib/config.ts`
  (or set the `DEFAULT_MODEL` environment variable). The chat UI does not need
  changes.
- To point at a different Ollama port: set `OLLAMA_BASE_URL` in `lib/config.ts`.
- To change context size or message limits: edit `MODEL_CONTEXT_TOKENS`,
  `MAX_HISTORY_MESSAGES`, `MAX_MESSAGE_CHARS` in `lib/config.ts`.
- To change how much memory chat uses: edit `MEMORY_MAX_RESULTS` and
  `MEMORY_MAX_CONTEXT_CHARS` in `lib/config.ts`. The matcher itself lives in
  `lib/memory/retrieval.ts`.
- To view or edit your saved memories by hand: the file is
  `~/Library/Application Support/ShipStudioAI/memories.json`. Prefer the
  `/memory` page, which validates data on the way in.

## Recent Changes

- 2026-10-13: Milestone 1 — added `/chat`, a server-side streaming route to
  Ollama, and a modular model layer. Added Stop/cancel, request validation,
  error handling, and hidden reasoning output. Conversations are client-side only.
- 2026-10-13: Added an "Open AI Chat" button to the homepage that links to `/chat`.
- 2026-10-13: Milestone 2A — added a local memory **storage layer** (no UI yet).
  Memories are saved to `~/Library/Application Support/ShipStudioAI/memories.json`
  with locked-down file permissions. Not connected to chat yet; no memory is
  created automatically. Covered by 14 dependency-free tests (`lib/memory`).
- 2026-10-13: Milestone 2B — added a Memory Manager: `/memory` page with add,
  edit and delete (with confirmation), plus `/api/memories` routes. Verified
  live against the dev server. 23 dependency-free tests total. Still **not**
  connected to the chat or the model.
- 2026-10-13: Milestone 2C — chat now reads a small, relevant slice of saved
  memories and passes them to Qwen as clearly-labelled untrusted reference data.
  Read-only; no auto-saving or auto-extraction. Verified live (model answered
  from a test memory, then it was removed). 34 dependency-free tests total.
- 2026-10-13: Improved memory retrieval matching — added light word-form
  normalization (e.g. `run`/`running`, `cost`/`costs`, `explain`/`explanations`)
  and added `am`/`being` to the stop words. 39 dependency-free tests total.
  Retrieval-only change; schema, API, UI, prompt and streaming are unchanged.
- 2026-10-13: Bound the dev server to `127.0.0.1:3697` (`next dev -H 127.0.0.1
  -p 3697`) so it is no longer reachable over the LAN. Verified in an isolated
  copy of the project (loopback-only; LAN refused). Ollama binding, app code,
  and macOS firewall were not changed.

## Not built yet (planned later)

- Automatic memory saving or extraction from conversations (chat can only read).
- Model switching UI.
- Specialized agents (Webflow, audits, coding, learning).
- Backend-enforced permissions with approval for sensitive actions.
- Secure access from phone and laptop.
