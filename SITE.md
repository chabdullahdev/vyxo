# VYXO

> A private, local-first AI workspace for thinking, learning, and building.

## What this is

A Next.js app that talks to AI models running locally through Ollama. All model
requests go through a server-side API route; the browser never contacts Ollama
directly. Conversations are saved to a **separate local file** on this Mac and
return after a restart. The workspace shell is branded VYXO, and the existing
chat, project files, Debug Mode, and memory tools remain the working features.

## Brand / Visual

- Personality: private, calm, precise, and quietly futuristic.
- Colors: obsidian `#0b0c10`, deep surfaces, silver-white text, muted grey, and a
  restrained electric-violet accent `#a99bff`.
- Fonts: Space Grotesk (display) + DM Sans (body), from the starter.
- The in-app mark is the VYXO wordmark at `public/brand/logo-white.svg` (off-white,
  for the dark obsidian sidebar) with `public/brand/logo-black.svg` kept for light
  backgrounds; `public/brand/app-icon.png` is the 864×864 RGBA app-icon source. The
  placeholder at `public/brand/vyxo-mark-placeholder.svg` is no longer referenced.
- Electron points to `desktop/resources/icon.icns`, built from
  `public/brand/app-icon.png` (converted to a macOS `.icns` icon set). The app icon
  appears in the packaged `.app`, the macOS Dock, and the installer volume.

## Pages

- **Main page** (`/`) — opens the VYXO Chat workspace.
- **Chat** (`/chat`) — local chat interface that streams answers from the selected
  local model. Includes Stop, Debug Mode, read-only Project files, a model
  selector, and a saved conversation history rail with search, rename, archive,
  delete, and a project association.
- **Agents** (`/agents`) — plan a request, delegate bounded subtasks to
  specialists, and review the sequential results.
- **Projects** (`/projects`) — create and manage projects, edit each project's
  context (purpose, goals, tech stack, custom instructions, notes), connect a
  read-only source-code folder with a file explorer and search, view its
  conversations, and move conversations between projects. Stored locally.
- **Memory** (`/memory`) — manage the memories saved on this Mac (add, view,
  edit, delete with confirmation). Manage these by hand; the assistant can only
  read them.
- **Research** (`/research`) — retrieve approved public documentation pages and
  summarize them with the local model, with citations and limitations.
- **Settings** (`/settings`) — choose the local model, check Ollama status, and
  review local storage locations and the privacy explanation.

## How it is structured

The model runtime is kept separate from everything else so memory, agents, and
permissions can be added later without touching chat.

```
lib/config.ts            Default model, Ollama URL, context size, request limits
lib/models/types.ts      The ModelProvider interface (the swap-in point)
lib/models/ollama.ts     Talks to Ollama, streams tokens, hides "thinking" output
lib/models/catalog.ts    Discovers installed Ollama models, validates names, builds the catalog
lib/models/api.ts        Model catalog response (status / installed / selected)
lib/models/registry.ts   Returns a provider for the requested model id
lib/settings/store.ts    Local settings storage (selected model; atomic writes, validation)
lib/settings/api.ts      Settings request/response logic
app/api/models/route.ts  Read-only installed-model catalog + status
app/api/settings/route.ts  Read / update the selected model and storage info
lib/projects/store.ts    Project storage (separate JSON file, atomic writes, validation)
lib/projects/context.ts  Project context types, limits, formatting, and authoritative loading
lib/projects/api.ts      Project request/response logic
app/api/projects/route.ts       List + create projects
app/api/projects/[id]/route.ts  Get / update / archive / delete one project
components/projects/ProjectsWorkspace.tsx  Projects UI and conversation moves
components/projects/ProjectContextEditor.tsx  Project context editor (purpose, goals, stack, instructions, notes)
components/projects/ProjectFilesPanel.tsx  Read-only source folder connect + explorer/search/preview
lib/files/policy.ts      Filesystem limits, forbidden roots, path containment
lib/files/service.ts     Read-only filesystem service (list/read/search with strict validation)
lib/files/api.ts         Files/folder request-response logic and status codes
lib/files/retrieval.ts   Bounded, untrusted project-file evidence for chat
app/api/projects/[id]/folder/route.ts        Connect/disconnect/status the source folder
app/api/projects/[id]/files/route.ts         List a permitted directory
app/api/projects/[id]/files/read/route.ts    Read a permitted text file
app/api/projects/[id]/files/search/route.ts  Search permitted files
lib/edits/types.ts       Proposal/recovery types, limits, and error codes
lib/edits/diff.ts        Dependency-free line diff (added/removed/context)
lib/edits/build.ts       Parse model output + validate operations against the folder
lib/edits/store.ts       Proposal + recovery stores (versioned, atomic, 0600)
lib/edits/apply.ts       Approved writes, atomic replace, hash revalidation, recovery
lib/edits/generate.ts    Ask the local model for a structured proposal
lib/edits/api.ts         Proposal/recovery request-response logic
app/api/projects/[id]/proposals/route.ts                 List + create proposals
app/api/projects/[id]/proposals/[proposalId]/route.ts    Get / reject a proposal
app/api/projects/[id]/proposals/[proposalId]/approve/route.ts  Approve a proposal
app/api/projects/[id]/proposals/[proposalId]/apply/route.ts    Apply an approved proposal
app/api/projects/[id]/recovery/route.ts                  List / run recovery
components/projects/ProposalReviewPanel.tsx  Proposal diff review, approve/apply, recovery UI
app/projects/[id]/page.tsx                   Workspace page for one managed project
lib/workspace/build.ts                       Builds a Next.js website into out/ (timeout, one build at a time)
lib/workspace/runtime.ts                     Finds the bundled Next.js packages
lib/workspace/git.ts                         Git for a project: snapshots, remote, push (no stored credentials)
components/projects/workspace/WorkspaceGit.tsx  The Git tab
desktop/site-deps/package.json               The locked list of packages a Next.js website needs
components/projects/workspace/WorkspaceView.tsx    Workspace header and the four tabs
components/projects/workspace/WorkspaceChat.tsx    Project chat (Ask/Build) and conversation picker
components/projects/workspace/WorkspaceFiles.tsx   Files tab: browse, open, edit, Trash
components/projects/workspace/WorkspaceChanges.tsx Changes tab: review, apply, undo
components/projects/workspace/WorkspacePreview.tsx Website preview (sandboxed frame)
lib/agents/types.ts      Specialist/task/plan types, states, limits, error codes
lib/agents/registry.ts   The four specialist definitions and validation
lib/agents/plan.ts       Planner output parsing + plan validation (deps, cycles, limits)
lib/agents/store.ts      Versioned plan store + interrupted-run recovery
lib/agents/engine.ts     Sequential orchestration engine and final synthesis
lib/agents/runner.ts     Model execution, bounded context, and edit proposals
lib/agents/api.ts        Agent/plan request-response logic
app/api/agents/route.ts  List specialists
app/api/agents/plans/route.ts            List + create plans
app/api/agents/plans/[planId]/route.ts   Get a plan
app/api/agents/plans/[planId]/run/route.ts     Run a plan
app/api/agents/plans/[planId]/cancel/route.ts  Cancel a plan
components/agents/AgentsWorkspace.tsx  Specialists, planning, run status, results
lib/research/types.ts    Research types, limits, and error codes
lib/research/urlSafety.ts  URL normalization, allowlist, private-IP blocking (IPv4/IPv6)
lib/research/fetchPage.ts  SSRF-hardened public-page fetcher (no redirects, bounded)
lib/research/extract.ts    Dependency-free HTML-to-text extraction
lib/research/run.ts        Bounded research orchestration + local-model synthesis
lib/research/api.ts        Research request-response logic
app/api/research/route.ts  Research config + run
components/research/ResearchWorkspace.tsx  Research UI (sources, evidence, limitations)
components/settings/ModelSelector.tsx      Local model dropdown + status
components/settings/SettingsPanel.tsx      Settings and privacy screen
app/api/chat/route.ts    Server route: validates input, resolves the model, streams reply, handles cancel
app/chat/page.tsx        Chat page shell
components/chat/ChatView.tsx  The chat UI (input, messages, Stop button)
components/chat/ProjectExplorer.tsx  Read-only folder picker and file tree in chat
lib/project/browser.ts  Uses browser folder handles to list and read selected files
lib/project/policy.ts   File allowlist, exclusions, path checks and context limits
lib/memory/store.ts      Local memory storage (JSON file, atomic writes, validation)
lib/memory/retrieval.ts  Read-only relevance matcher + prompt formatting for chat
lib/memory/api.ts        Memory request/response logic (status codes, safe errors)
app/api/memories/route.ts       List + create memories
app/api/memories/[id]/route.ts  Get / update / delete one memory
app/memory/page.tsx      Memory page shell
components/memory/MemoryManager.tsx  The memory manager UI
lib/conversations/store.ts      Conversation history storage (separate JSON file, atomic writes, validation)
lib/conversations/api.ts        Conversation request/response logic (status codes, safe errors)
app/api/conversations/route.ts       List + create conversations
app/api/conversations/[id]/route.ts  Get / rename / archive / delete one conversation
components/chat/ChatWorkspace.tsx      Owns conversation state, history, and the chat surface
components/chat/ConversationRail.tsx   Searchable history list with rename / archive / delete
components/workspace/WorkspaceShell.tsx  VYXO sidebar, navigation, and responsive shell
components/workspace/WorkspacePlaceholder.tsx  Honest placeholders for planned workspaces
public/brand/vyxo-mark-placeholder.svg  Replaceable in-app icon placeholder
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

## Saved conversations (separate from memory)

Conversation history is stored in its own file, **not** in the memory file:

```
~/Library/Application Support/VYXO Data/conversations.json
```

- Same user-data directory and security as memories: directory `0700`, file
  `0600`, atomic temp-write plus rename, serialized writes, and full validation.
- Versioned schema (`version: 1`). A `Conversation` is
  `{ id, title, createdAt, updatedAt, archived, projectId, messages[] }`.
  `projectId` is an **additive, backward-compatible** field: conversations saved
  before this phase have no `projectId` and read back as `null`.
- A `ConversationMessage` is
  `{ id, role: "user" | "assistant", content, status, error?, createdAt }`.
- Message `status` is `complete`, `interrupted`, or `failed`. A partial answer is
  saved as `interrupted`, never as `complete`; a failure is saved as `failed` with
  a short error. User messages are always `complete`.
- Titles are derived from the opening user message and can be renamed. The
  conversation file never contains API keys or other secrets.
- Deleting or archiving a conversation never touches saved memories. Nothing is
  sent to the cloud and there is no sync.

### Conversation API (schemas)

- `GET /api/conversations?q={search}&archived=active|archived|all&projectId={id}` →
  `200 { conversations: ConversationSummary[] }`
- `POST /api/conversations` `{ title?: string, projectId?: string | null }` →
  `201 { conversation }`
- `GET /api/conversations/{id}` → `200 { conversation }`
- `PATCH /api/conversations/{id}`
  `{ title?: string, archived?: boolean, projectId?: string | null }` →
  `200 { conversation }`
- `DELETE /api/conversations/{id}` → `200 { deleted: true }`
- Errors → `{ error: string }` with `400` invalid input, `404` not found,
  `405` method not allowed, `415` wrong content type, `500` safe storage error.

The chat route `POST /api/chat` accepts optional `conversationId` and
`userMessageId` fields. It persists the user message before streaming and the
assistant message when the stream settles, and returns extra NDJSON events
(`conversation`, `saved`, `notice`) alongside the existing `delta`/`done`/`error`.

## Local models

VYXO lists the models installed in your local Ollama instance and lets you pick
one. Selection is validated on the server — a model name is only accepted if it
appears in Ollama's installed list, so the app never silently falls back to a
different model.

- Discovery uses Ollama's `/api/tags` through the server route; the browser never
  contacts Ollama directly.
- The chosen model is saved in `settings.json` and used for every new response
  (`POST /api/chat` also accepts an optional `model` field, validated the same way).
- The catalog distinguishes three states: `ok` (models listed), `empty` (Ollama
  reachable but no models installed), and `unavailable` (Ollama stopped or
  unreadable). A selected model that is no longer installed is flagged, not
  auto-replaced.
- `GET /api/models` → `200 { status, models[], selectedModel, selectedInstalled, message }`
- `PATCH /api/settings` `{ selectedModel }` → `200 { settings, catalog }`;
  `400` invalid or not-installed, `503` Ollama unavailable, `415` wrong content type.

## Projects

Projects are a local organizational layer only. They store a name, description,
and archive state — never conversation content.

- Stored in `~/Library/Application Support/VYXO Data/projects.json` with the
  same permissions (`0700`/`0600`), atomic writes, serialized writes, and strict
  validation as the other stores. Versioned (`version: 1`).
- A conversation references a project by `projectId`. Deleting a project keeps its
  conversations and simply unassigns them (their `projectId` becomes `null`); it
  never touches memories.
- `GET /api/projects?q={search}&archived=active|archived|all` →
  `200 { projects: (Project & { conversationCount })[] }`
- `POST /api/projects` `{ name, description? }` → `201 { project }`
- `GET /api/projects/{id}` → `200 { project }`
- `PATCH /api/projects/{id}` `{ name?, description?, archived? }` → `200 { project }`
- `DELETE /api/projects/{id}` → `200 { deleted: true }`
- No project file uploads and no arbitrary filesystem browsing in this phase.

### Project context

Each project can store user-written context that VYXO uses as background when you
chat inside that project. This is organizational context only — **not** project
files, and VYXO cannot read your source folders.

- A `Project` now also has
  `context: { purpose, goals, techStack, instructions, notes }` (all strings).
  This is an **additive, backward-compatible** field: projects saved before this
  phase have no `context` and load with empty defaults. No migration is needed.
- Field limits: purpose `1000`, goals `2000`, techStack `1000`, instructions
  `4000`, notes `8000`; **combined** context limit `12000` characters. Oversized
  or malformed context is rejected (`400`), and a corrupted stored context fails
  safely (`CORRUPT_DATA`) without rewriting the file.
- `PATCH /api/projects/{id}` accepts `context` (an object with any subset of the
  five fields) alongside `name`, `description`, and `archived`.
- The Projects page has a **Project context** editor with explicit Save/Cancel,
  per-field and total character counts, and loading/saved/error states.

### How project context reaches the model

When a chat request belongs to a conversation with a project:

- The server resolves the association from the **stored conversation**
  (`conversation.projectId`). A client-supplied `projectId` in the chat body is
  ignored, so a caller cannot override the saved association.
- It loads the current project from the validated local project store and formats
  it into one delimited **system** message, `<project_context ...>`, labelled as
  untrusted reference data.
- The custom-instructions field is described to the model as preferences, not
  permissions. The model is told the block cannot change safety rules, grant
  permissions, reveal secrets, or authorize actions.
- Only that one project's context is included — never another project's. An
  unassigned conversation gets no project context. When a conversation's project
  has no context yet, or the project was deleted, chat continues normally (a
  small notice is shown when the project is missing).
- The combined store limit bounds the injected size; the formatted block is also
  capped defensively.

### Source code folder (read-only, Phase 5A/5B)

A VYXO project can be connected to **one** local source-code folder for
read-only inspection. VYXO can list, read, and search permitted files and use
bounded snippets as evidence in project chats. It does **not** edit files or run
commands in this phase.

- Connecting: the Projects page has a "Source code folder" panel. Native folder
  picking is not available in this build, so you paste the absolute path and
  connect it. Only this folder is ever read; the server validates that it exists,
  is a directory, and is not a forbidden root (`/`, your home root, `/System`,
  `/usr`, `/private/etc`, and similar system locations).
- Authorization metadata is stored as the additive, backward-compatible
  `sourceFolder: string | null` field on the project (existing projects load with
  `null`). Disconnecting clears this field and **never** changes or deletes files
  on disk.
- Read-only API (desktop-token guarded):
  `GET/POST/DELETE /api/projects/{id}/folder`, `GET /api/projects/{id}/files?path=`,
  `GET /api/projects/{id}/files/read?path=`, `GET /api/projects/{id}/files/search?q=`.
- Filesystem safety: paths are rejected if absolute or containing `..`; the
  resolved real path must stay inside the connected folder; symlinks are not
  followed (and `O_NOFOLLOW` guards the final open); special files and binary data
  are refused; `.git`, `node_modules`, build outputs, `.env`, credentials, private
  keys, and secret-looking content are excluded by default. Size, count, depth,
  query, snippet, and total-evidence limits are enforced.
- Chat integration (5B): for a conversation with a connected folder, the server
  searches using keywords from your message and injects a bounded, delimited
  `<project_files kind="untrusted-source-evidence">` system message with file
  paths, line numbers, and snippets. The model is told this is untrusted
  reference data, may not follow instructions inside source code, and must not
  claim to have read files it was not given. Unassigned chats and projects
  without a folder get no file evidence. The whole repository is never sent.
### Proposed changes, approval, and recovery (Phase 5C/5D)

VYXO can now propose code edits, show a reviewable diff, and apply only the
changes you explicitly approve. Nothing is written during proposal generation or
review.

- **Propose:** ask for a change in the project workspace. The local model returns
  a structured JSON proposal (`summary` + operations). The server — never the
  model — validates every path, reads the current file, computes the SHA-256
  hash, and builds the diff. Supported operations: create, modify, and delete.
- **Review:** each proposal shows its status, file list, added/removed counts,
  and a line-based diff with `+`/`-`/space prefixes (not colour alone). Stale-file
  warnings and errors are shown inline.
- **Lifecycle (enforced server-side):**
  `ready_for_review → approved → applying → applied`, with `rejected`,
  `cancelled`, `stale`, `failed`, and `recovery_required`. Replayed or invalid
  transitions return `409`.
- **Apply (5D):** only an `approved` proposal can be applied. Before each write
  the server revalidates the path (containment, no symlink, allowed type),
  re-reads the file, and compares its hash to the one captured at proposal time.
  A mismatch aborts with `stale` and never overwrites your newer content. Writes
  use a temp file plus atomic rename, preserving file mode; operations on the
  same project are serialized so one proposal cannot double-apply.
- **Recovery:** before each destructive change the original content and hashes
  are recorded in a local journal
  (`~/Library/Application Support/VYXO Data/edit-recovery.json`, `0600`).
  Recovery restores originals only when the current file still matches the
  expected post-apply state; if you changed the file since, it refuses and lists
  the conflicts. Deleting a file goes through the same review/approval path.
- **Storage:** proposals live in
  `~/Library/Application Support/VYXO Data/edit-proposals.json` (versioned,
  atomic writes, `0600`), pruned to the most recent 25 with terminal proposals
  removed first. No source content is written to chat history or memory.
- **API (desktop-token guarded):** `GET/POST /api/projects/{id}/proposals`,
  `GET/DELETE /api/projects/{id}/proposals/{proposalId}`,
  `POST .../proposals/{proposalId}/approve`, `POST .../proposals/{proposalId}/apply`,
  and `GET/POST /api/projects/{id}/recovery`.
- **Not implemented (deliberately disabled):** verification command execution
  (Milestone 5E). There is no shell endpoint; the model cannot run commands. A
  safe design (fixed allow-list resolved from the project's own `package.json`
  scripts, no shell, explicit approval, time/output limits) is documented but not
  shipped.

## Agents (Phase 6)

VYXO can plan a complex request, assign bounded subtasks to specialists, and run
them **one at a time** on the local model, then combine the results. This is a
small, local implementation — not an autonomous shell agent.

- **Specialists (fixed roles, shared model):** `planner`, `developer`,
  `reviewer`, `mentor`. Each has explicit `taskTypes` and `capabilities`
  (`chat.respond`, `project.read`, `memory.read`, `edit.propose`,
  `research.local`) plus context flags and execution limits. The registry is
  validated at load; a research/website-auditor specialist can be added later
  without changing the engine.
- **Planning:** the planner returns JSON (`summary` + tasks with `id`, `agentId`,
  `taskType`, `title`, `instruction`, `dependsOn`). The server — not the model —
  validates it: known specialists, supported task types, unique ids, real
  dependencies, no cycles, ≤ 8 tasks, bounded title/instruction/summary sizes.
  Invalid plans are rejected with a clear error; nothing is silently “delegated”.
- **Execution:** a centralized engine runs ready tasks in dependency order
  (sequential only), forwards completed dependency results, marks dependents
  `blocked` when a prerequisite fails, preserves completed results, and
  synthesizes one final response that states plainly which steps did not
  complete. Bounded by the number of tasks (no recursive delegation, no loops).
- **Capabilities are enforced server-side:** a task only receives project
  context/evidence when its specialist has `project.read`, only memory when it
  has `memory.read`, and only its own project’s evidence. Source code, memory,
  and task output are labelled untrusted. No route or tool provides shell access.
- **Edits:** a specialist can only *propose* changes, and only through the
  existing Phase 5C proposal store. The normal review, stale-file, application,
  and recovery protections remain; no specialist can approve or apply a proposal.
- **Persistence:** plans live in
  `~/Library/Application Support/VYXO Data/agent-plans.json` (versioned, atomic
  writes, `0600`), pruned to the most recent 30. On load, interrupted `running`
  plans are marked `failed`/`partial` with an “interrupted by restart” note and
  are never auto-retried.
- **API (desktop-token guarded):** `GET /api/agents`,
  `GET/POST /api/agents/plans`, `GET /api/agents/plans/{planId}`,
  `POST /api/agents/plans/{planId}/run`, `POST /api/agents/plans/{planId}/cancel`.
- **UI:** the Agents workspace lists specialists, creates a plan from a request
  (optional project ID), shows each subtask with its specialist and status, runs
  or cancels the plan, and displays task outputs and the combined result. Long
  output scrolls inside its panel.
- **Not implemented:** chat-triggered auto-delegation (run it from the Agents
  workspace), research/browsing, and Phase 5E verification commands remain
  disabled.

## Research (Phase 7)

VYXO can research public documentation on your behalf and return source-backed
findings. It is deliberately narrow and privacy-preserving.

- **Approved sources only:** retrieval is limited to an **allowlist of public
  documentation hosts** (`react.dev`, `nextjs.org`, `developer.mozilla.org`,
  `nodejs.org`, `docs.python.org`, `docs.npmjs.com`, `typescriptlang.org`,
  `tailwindcss.com`, `ollama.com`; extend with `RESEARCH_ALLOWED_HOSTS`). There is
  **no automatic web-search provider** — none is bundled (a provider needs
  credentials), so the UI shows this and you provide documentation URLs.
- **SSRF-hardened fetching:** HTTPS only, no credentials in URLs, default port
  only, IP-literal/localhost/.local/.internal hosts rejected, DNS is resolved and
  **every resolved address must be public** (private/loopback/link-local/
  multicast/reserved IPv4 and IPv6 rejected, including cloud metadata addresses).
  Redirects are not followed, content types are restricted to HTML/XHTML/plain
  text, responses are byte-capped, requests time out, and JavaScript is never
  executed. No generic HTTP proxy exists.
- **Extraction:** a minimal, dependency-free HTML-to-text extractor removes
  scripts/styles/nav and preserves headings, paragraphs, lists and code, with a
  text cap. Empty/malformed/oversized results are reported as limitations.
- **Citations:** every displayed source comes from a validated URL and a
  successfully retrieved page, with its title, canonical URL, HTTP status and
  retrieval timestamp. The local model is instructed to cite sources by number,
  to only cite sources that support a statement, to never invent URLs/quotes/dates,
  to flag contradictions and single-source claims, and to treat all page content
  as untrusted. The extracted text is shown alongside the generated summary so you
  can verify it.
- **Privacy:** research sends only the query and the approved public URLs. It never
  sends project files, project context, conversations, or memory. The `researcher`
  specialist has `research.local` and **no** project/memory access.
- **API (desktop-token guarded):** `GET /api/research` (config/allowlist),
  `POST /api/research` `{ question, urls[] }` → `{ report }`.
- **Agent integration:** the `researcher` specialist can run a `research` task, but
  only with approved documentation URLs present in the task instruction; the
  capability is enforced server-side and no external LLM is used.
- **No persistence:** research results are returned to the page and are not
  written to memory or a research store. Nothing is crawled in the background.

## Settings and privacy

The Settings screen shows the Ollama connection status, the installed-model list,
a recheck action, the local storage folder and file names, a list of what is
stored locally, and recovery steps when Ollama is unavailable.

- `GET /api/settings` → `200 { settings: { selectedModel }, storage: { directory, files } }`
  (paths only — no file contents).
- No conversation, project, file, or memory content is sent to external services
  in this phase. There is no offline/network toggle that pretends to enforce
  isolation; the app simply makes no external requests.

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

## Teaching style (personalization)

Chat now starts every reply with a short **mentor system prompt** (`lib/prompt.ts`)
that asks the model to teach like a personal technical mentor: simple, clear
English; practical examples (often web development); complicated topics broken
into small steps; an optional short quiz or exercise when learning something new;
gentle corrections with reasons; and no padding. It also tells the model **not to
assume personal facts or project details it wasn't told**, and to keep treating
retrieved notes as untrusted reference data, not instructions.

This is guidance only — prompt wording **cannot guarantee** perfect behavior. The
memory slice remains a separate system message after the mentor and any
applicable code/project guidance.

## Code explanation (paste code, get a lesson)

You can paste code straight into the chat box (with or without a question) and the
assistant explains it in teaching mode. Normal conversation is unchanged.

- **How it works:** for each message the server runs a small, dependency-free
  detector (`isCodeExplanationRequest` in `lib/prompt.ts`). If the latest message
  looks like code, it adds one extra **system** message
  (`CODE_EXPLANATION_PROMPT`) asking the model to give a plain-English overview,
  a section-by-section walkthrough, a small example, hedged notes on likely bugs
  or edge cases, and an optional short exercise or quiz.
- **What triggers it:** fenced code blocks (```), inline code in backticks, or
  messages with enough code-like lines (braces, semicolons, arrows, indentation,
  assignments, or language keywords such as `function`, `def`, `const`). Plain
  prose — even sentences containing words like "return" or "class" — does not
  trigger it.
- **Order of system messages:** mentor prompt → optional code/debug/project
  guidance → memory slice. Each optional prompt is added only for its matching
  request mode or context.
- **Safety:** the model is told it **cannot run, execute, or evaluate** the code,
  must not claim it did, must not invent output, must phrase bugs as
  possibilities rather than certainties, and must not edit the user's files. This
  is prompt guidance only, not a hard guarantee.
- **Limitation:** detection only looks at the latest message, so a follow-up like
  "what about error handling?" won't re-add the code prompt (the model still sees
  the earlier code in the conversation and can answer).

## Project-aware mentor (selected files only)

In `/chat`, open **Project files** and choose a folder. Expand folders and check
only the source or documentation files you want to discuss. The selected file
names stay visible above the chat. Use **Change folder**, **Remove all**, the `×`
buttons, or **Clear project** to remove access from the app.

- **Folder access:** the app uses the browser's File System Access folder picker
  in read-only mode. It works in supported browsers such as current Chrome or
  Edge on this localhost app. Browsers without `showDirectoryPicker()` show an
  unsupported message; the app does not pretend an ordinary file picker is a
  folder-access feature.
- **Where access lives:** the browser folder handle and selected file handles
  stay in the open chat tab. No project root path is sent to the server, and the
  server has no endpoint that opens a path. **Clear project** drops the app's
  handle and removes the selected files from later requests. A browser may keep
  its own permission until you remove it in that browser's site settings.
- **When files are read:** the app reads checked files only after you send a
  message. Their text is sent to the existing local chat route and Ollama for
  that request. File text is not shown in the chat transcript, saved in browser
  storage, or written to the memory file. The existing memory matcher still uses
  the user's question, not the full project source.
- **How the model sees them:** selected files are added as a separate, clearly
  labeled user-context block, not merged into the mentor instructions. A
  project-aware system prompt labels file contents as untrusted, asks the model
  to cite only supplied file names, separate observations from assumptions, and
  ask for more files when needed. It is also told not to use an earlier answer as
  a substitute for a file that is no longer selected. Project questions use the
  existing teaching-style code explanation prompt. Unrelated questions should
  still get ordinary answers.
- **Blocked items:** `.env` files, credential/private-key names and formats,
  generated/dependency folders (`.git`, `.next`, `node_modules`, `dist`, `build`,
  coverage, caches, and others), OS metadata, unsupported extensions, binary
  data, and text matching common secret patterns are not sent. A suspicious
  selected file stops the request with a safe message that does not include its
  contents.
- **Limits:** depth 8; at most 1,200 directory entries for one selected folder;
  at most 8 selected files; 128 KiB per file; at most 8,000 characters of
  combined project context; 4,000 characters of recent earlier chat while
  project files are attached; 5 seconds per file and 15 seconds for one read
  batch; and a 2 MiB total chat request. Oversized context is rejected rather
  than silently cut off.
- **Important limitations:** file type and credential checks are defensive
  heuristics, not a guarantee that every possible secret will be recognized.
  The browser API does not provide a portable symlink flag; unknown handle kinds
  are ignored and the app never opens user-supplied path strings, but exact
  symlink presentation depends on the browser. For a project where symlink
  escape behavior must be guaranteed, a native helper with filesystem-level
  checks would be needed. The folder picker is not available in every browser.

## AI debugging mentor

Use the **Debug** button above the chat to turn on debugging mode. Describe what
you expected and what happened, or paste an error or stack trace. You can also
select project files in **Project files** below; only those checked files are
included with the next request. You can switch back to **Chat** at any time, and
your conversation stays in the tab.

- The assistant looks only at the error, code, and selected files supplied with
  that request. Without selected files, it should say its analysis is limited to
  what you pasted and cannot confirm runtime behavior.
- For a debugging question, it uses a short report: the leading possible cause,
  evidence from the supplied text/files, confidence, what it cannot verify, and
  a next step. It can show a small suggested change in a code block and explain
  why it may help.
- Suggested changes are text only. The assistant cannot run code, run tests or
  builds, use the shell, install packages, modify files, or apply a fix. It should
  also ask for another file or detail when the current evidence is not enough.
- The debugging mode is sent explicitly with each message while the **Debug**
  option is selected. It does not depend on guessing from keywords. Switching to
  **Chat** omits the debugging instructions on subsequent requests; existing
  code-explanation and selected-file behavior remain available.
- These instructions guide the local model but cannot guarantee every diagnosis
  is correct. Check suggested changes yourself and use the manual verification
  step in the answer before relying on a fix.

## Current model settings

- Model: `qwen3:8b` (only one, no picker yet).
- Context window: 8192 tokens (set via Ollama `num_ctx`; verified applied).
- Thinking output: hidden. Only the final answer is shown.
- Ollama uses `http://127.0.0.1:11434` by default.

## Network / local access

- The dev server is configured to bind **only to `127.0.0.1:3697`** via the
  `dev` script (`next dev -H 127.0.0.1 -p 3697`). It is not reachable from other
  devices on your network.
- The production `start` script is now also bound to `127.0.0.1:3697` instead of
  Next.js's default `0.0.0.0` hostname.
- To confirm: `lsof -nP -iTCP:3697 -sTCP:LISTEN` should show `127.0.0.1:3697`
  (not `*:3697`). This applies on the next relaunch of the preview.
- This does not change the macOS firewall, and it does not secure the whole
  machine — it only limits where this app listens.

## Security model (Phase 8)

### Trust boundaries

- **Renderer (untrusted UI) ↔ local Next server (trusted):** the browser window
  runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
  and `webSecurity: true`. It cannot reach Node APIs or the filesystem directly.
- **Local server ↔ model/network:** the local model runs via Ollama; the only
  outbound network request the app makes is user-initiated research retrieval
  (see Research, Phase 7). No telemetry or analytics is sent anywhere.
- **Retrieved public content (untrusted data):** research pages, model output,
  planner output, and project files are all treated as untrusted input and never
  interpreted as instructions that change permissions.

### Local network exposure and authentication

- The server binds only to `127.0.0.1` (dev and production scripts).
- Every `/api/*` route requires a **per-launch random token** (`randomBytes(32)`),
  compared with `timingSafeEqual`, plus loopback/host/origin/protocol checks
  (`lib/desktop/api-auth.ts`). The token lives in the Electron main process and is
  sent on internal requests only; it is not placed in renderer-visible URLs or
  logs. Cross-origin, malformed-origin, missing-origin, and unsupported-method
  requests fail closed.
- Navigation and new windows are denied by default
  (`setWindowOpenHandler(() => ({ action: "deny" }))` and a `will-navigate`
  origin allowlist); external links open in the OS browser, never inside the
  privileged window. A per-request nonce CSP (`lib/desktop/csp.ts`) uses
  `strict-dynamic` with no unsafe directives.

### Approvals and capability limits

- Project files are **read-only** to the app except through the edit-proposal
  workflow; applying a proposal requires explicit user approval, re-validates the
  file hash, writes atomically, and journals a recovery record.
- Specialists can only **propose** edits — they cannot approve or apply them,
  cannot run shell commands, and receive project/memory context only when their
  registry entry authorizes it. Capabilities are enforced server-side from the
  registry, never from model output.
- Restricted shell execution (Phase 5E) remains **not implemented**.

### Research network boundary (Phase 7 + Phase 8)

- Retrieval is limited to an allowlist of public documentation hosts; malformed
  hosts, trailing-dot hosts, embedded credentials, non-443 ports, disallowed
  schemes, IP literals, and localhost/`.local`/`.internal` names are rejected.
- DNS is resolved, **every** resolved address is checked against public-address
  rules (private/loopback/link-local/multicast/reserved IPv4 and IPv6, including
  IPv4-mapped IPv6 and cloud metadata addresses), and the actual HTTPS connection
  is **pinned to that validated address** via a custom `lookup`
  (`lib/research/http.ts`). TLS still verifies the certificate against the
  hostname (`servername`), so pinning does not weaken certificate checks.
- Redirects are not followed, `Accept-Encoding: identity` is sent and non-identity
  encodings are rejected (so compressed bodies cannot bypass the byte cap),
  responses are byte-capped, content types are restricted to HTML/XHTML/plain
  text, requests time out, and JavaScript is never executed. There is no generic
  HTTP proxy.

### Citation integrity

- Every displayed source comes from a validated URL and a successfully retrieved
  response (title, canonical URL, status, timestamp, and content hash are derived
  from the response, not the model).
- Inline citation numbers in the summary are validated **deterministically**
  against the current run (`lib/research/citations.ts`): numbers outside the
  retrieved range are surfaced as limitations. Whether a cited source actually
  supports a claim is **not** verified — citations are labelled as model-selected.

### Known, documented limitations

- Citation *claim support* is not verified; only citation *range* is.
- Research extraction is heuristic and capped; some pages yield limited text.
- If research is performed with a model that is not installed, the app reports the
  failure and does not substitute an external provider.
- Packaged runtime behavior has been build-checked, not run from a `.app`/`.dmg`
  (see Desktop app section).

### How to run the security-related tests

```
npm test                    # all unit + integration tests (isolated temp HOME)
npm run lint                # includes security-focused lint rules
npm run typecheck
npm run build && npm run build:desktop
git diff --check
npm audit --omit=dev
```

Security-focused suites include `lib/desktop/api-auth.test.mjs`,
`lib/files/files.test.mjs`, `lib/edits/edits.test.mjs`, `lib/agents/agents.test.mjs`,
and `lib/research/research.test.mjs` (SSRF address variants, DNS pinning, redirects,
oversized/compressed/unsupported responses, citation range validation, and
prompt-injection isolation).

### Release checks — verified vs pending

- **Verified:** tests, lint, typecheck, production build, desktop build, diff check,
  production dependency audit, and the **packaged `.app` runtime smoke test**
  (isolated temp `HOME`; startup, renderer, API auth 403, memory CRUD, chat
  streaming/Stop, CSP nonce, and clean shutdown all observed).
- **Pending:** signing, notarization, and producing/distributing a `.dmg` have
  **not** been performed.

## How to customize

- To use a different model later: change `DEFAULT_MODEL` in `lib/config.ts`
  (or set the `DEFAULT_MODEL` environment variable). The chat UI does not need
  changes.
- To point at a different Ollama port: set `OLLAMA_BASE_URL` in `lib/config.ts`.
- To change context size or message limits: edit `MODEL_CONTEXT_TOKENS`,
  `MAX_HISTORY_MESSAGES`, `MAX_MESSAGE_CHARS`, and `MAX_CHAT_REQUEST_BYTES` in
  `lib/config.ts`. Project-specific limits are in `lib/project/policy.ts`.
- To change how the assistant teaches (tone, examples, quizzes, length): edit the
  wording in `MENTOR_SYSTEM_PROMPT` in `lib/prompt.ts`. The memory slice and
  project access limits stay the same.
- To change how code is explained: edit `CODE_EXPLANATION_PROMPT` in
  `lib/prompt.ts`. To change what counts as "code", edit
  `isCodeExplanationRequest` in the same file.
- To change debugging guidance: edit `DEBUGGING_MENTOR_PROMPT` in
  `lib/prompt.ts`. The mode toggle and request validation are in the existing
  chat files; they do not add file-editing or execution tools.
- To run the tests: `npm test` (uses Node's built-in test runner; no extra
  packages).
- To open an Electron preview against a separate development server, run
  `npm run desktop:dev`. To check Electron's browser folder picker against the
  existing preview, run `npm run desktop:picker-check` and choose the disposable
  folder printed in the terminal.
- To change how much memory chat uses: edit `MEMORY_MAX_RESULTS` and
  `MEMORY_MAX_CONTEXT_CHARS` in `lib/config.ts`. The matcher itself lives in
  `lib/memory/retrieval.ts`.
- To view or edit your saved memories by hand: the file is
  `~/Library/Application Support/VYXO Data/memories.json`. Prefer the
  `/memory` page, which validates data on the way in.

## Recent Changes

- 2026-10-24: **Windows app alongside the Mac app, checked on a Windows laptop.**
  - Built `VYXO-0.2.1-x64.exe` on Windows 11 with `npm run desktop:win`. It uses the same icon artwork as
    the Mac app (the 1024px image from `icon.icns`, now saved as `desktop/resources/icon.png`).
  - `npm run desktop:smoke` passes on the Windows build: chat streaming and Stop, Debug Mode, memory,
    API authorization, security headers, clean shutdown. The test now uses temporary Windows data folders
    (`USERPROFILE`, `APPDATA`, `VYXO_DATA_DIR`, `VYXO_PROJECTS_DIR`) so it never touches real data.
  - Not verified on Windows: the folder picker (its automatic check works on macOS only and is skipped on
    Windows), the installed app running a project, the site build, the preview, Git, and updates.
  - Releases: a version tag now builds the Mac and the Windows apps on GitHub and puts both in one draft release.
  - Website: "Download for Windows" buttons next to "Download for Mac" (`/download/windows` finds the newest
    `.exe`, falling back to the releases page), Windows first-launch steps, and an updated platform note.
    Until a release containing a Windows build is published, the Windows button opens the releases page.
  - `npm run desktop:dev` works on Windows (`cross-env`), Electron's download step is allowed in
    `package.json`, and the desktop app now passes `VYXO_PROJECTS_DIR` to its server.
  - New `npm run desktop:test` opens VYXO against a separate test folder (`~/VYXO Test`) with a sample
    project folder, so manual testing never touches real chats, memories, or projects.
  - Known: 118 tests already failed on Windows before these changes (same count before and after),
    mostly path handling in `lib/edits`, `lib/files`, `lib/workspace`, and the Mac-only update swap.

- 2026-10-23: **Windows build.** VYXO can be built for Windows on a Windows laptop with one command.
  - Build on the laptop: install Node.js 22 or newer and Git for Windows, copy the VYXO folder
    (without `node_modules` and `build`), then run `npm install` and `npm run desktop:win`. The
    installer is written to `release\`. Ollama and the model are installed on the laptop as on the Mac.
  - The Next.js packages are installed for the laptop's own system (`build/site-deps/host.txt`
    records it, and a folder prepared on another system is rebuilt).
  - Project links use junctions on Windows (no administrator rights needed). Git and the GitHub
    CLI are looked up in their usual Windows folders.
  - The installer is not signed yet, so Windows shows an "unknown publisher" warning.
    Updates on Windows open the downloads page instead of installing themselves.
  - Not verified on Windows yet: the installed app running a project, the site build, the preview,
    Git, and the update message. A Windows build was produced on this Mac (`--win dir`) to check
    the packaging settings; the Windows-only runtime checks need the laptop.

- 2026-10-23: **Git for each workspace project.** A new **Git** tab lets you set up version
  tracking, save snapshots (commits), connect a repository, create a private GitHub repository,
  and push.
  - Runs with the Git and GitHub CLI already on this Mac (`gh auth login`). VYXO stores no
    tokens. Pushing never happens unless you press **Push to GitHub**.
  - Every new repository ignores `node_modules`, `.next`, `out`, `.vyxo`, `.env*`, `*.pem`,
    and `*.key`. Before a snapshot is saved, its files are checked with the same private-file
    rules as the assistant. If one looks private, nothing is saved and the file is named.
  - Only https, ssh, and git@ addresses are accepted for a remote.
  - Settings' "Internet access" text now says that Push sends a project's snapshots to the
    repository you connected.
  - Verified: 8 tests on real Git and a local bare repository (set up, snapshot, refusal of
    private files, address rules, push, bad remote), and the tab in the browser. The GitHub
    repository creation was not run against GitHub, to avoid creating a repository in tests.

- 2026-10-23: **Websites: Next.js or plain HTML/CSS/JS, from a description.** New website
  projects offer two starting points: **Next.js website** (Tailwind CSS, the default idea
  for web apps) and **HTML, CSS and JS website** (no framework, no build step). Describe the
  site in the form and VYXO writes a first draft in Build mode, which opens in the Changes
  tab for review. Nothing is saved until you apply it.
  - The Next.js packages ship inside the app (`desktop/site-deps/package.json`, installed by
    `scripts/prepare-site-deps.mjs` before `npm run desktop:dir` or `desktop:dmg`). Nothing is
    downloaded on the user's Mac. Each Next.js project links its `node_modules` to them.
  - Preview builds the site with the app's own runtime (`lib/workspace/build.ts`), then shows
    the built pages from `out/`. A build starts when the project is created, after each applied
    change, after an undo, and from the Preview's "Build again" button. Failed builds show the
    reason. A build stops after 3 minutes.
  - The Build mode gets extra instructions for Next.js projects (`builderGuideFor`), and the
    export and the assistant's file list skip build output and caches (`.next`, and `out` in
    Next.js sites).
  - The packages include `@types/react`, `@types/react-dom`, and `@types/node`, so Next.js never
    tries to download types for a site's tsconfig. Site builds also run npm offline.
  - Not yet built into the release: SvelteKit and Astro (these need the same packages added to
    `desktop/site-deps`, and the app grows by their size).
  - Size: the Next.js packages add about 370 MB to the app before compression (Next.js itself
    is about 207 MB, its compiler about 86 MB). Measure the release before deciding on more.
  - Verified: 391 tests, including real Next.js builds of the starter, a broken page, the
    timeout, the preview's asset paths, and the export. In a production build of the app with
    the real model (`qwen3.5:9b`): a description produced a draft, Apply built the site, a
    change to the site rebuilt it, Undo rebuilt it back, and a plain HTML site from a
    description previewed. Packaged app: `npm run desktop:dir` produces a signed app with the
    packages inside (`Resources/site-deps`), and that app's own runtime builds a site offline.
    Not yet verified: the packaged app's window running a whole project (create, build, and
    preview from the app itself).

- 2026-10-23: **Project workspace screens, Check for Updates, and the About link removed
  from the app.**
  - Each workspace project has its own page (`/projects/:id`) with four tabs: **Chat**
    (Ask or Build, conversations kept per project), **Files** (browse, open text files,
    new file/folder, rename, Move to Trash, Restore, Add files, Empty Trash), **Changes**
    (review each diff, Apply changes, Not now, Undo these changes), and **Preview** (the
    website in a sandboxed frame with Phone, Tablet and Desktop widths). Header buttons:
    Copy path, Show in Finder, Export .zip.
  - Build changes open in the Changes tab for review. Undone changes show as "Undone";
    failed applies show as "Not applied".
  - The Projects list uses the new project form (Workspace or Existing folder, with
    starting templates). Workspace projects open their workspace page, and their delete
    confirmation has an "Also permanently delete this project's files" choice.
  - The sidebar's "About" item (which opened the public website page inside the app) is
    removed. The `/web` page itself still serves the public website.
  - VYXO menu → **Check for Updates…** (Help menu on Windows/Linux). It says when you are
    up to date, when a check fails, and starts the update if one exists. Background
    checks stay silent.
  - Verified: typecheck, lint, and all 384 tests pass. In a separate copy of the app with
    temporary data and the real model (`qwen3.5:9b`): created a website project, asked
    for a change in Build, reviewed and applied it, saw the preview update, undid it,
    created/trashed/restored a file, and deleted a project together with its files.
    Not yet verified: the packaged desktop app (its preview frame and the new menu item).
  - Note: the copy of VYXO in `/Applications` is 0.2.0, which predates the in-app
    updater. It needs one manual install of a newer release; updates after that can
    come from inside the app.

- 2026-10-20: **In-app updates that install themselves** (0.2.1). Builds without a
  paid Apple certificate cannot use macOS's updater, so `desktop/inplace-update.cjs`
  replaces the app itself: it downloads the release zip (GitHub hosts only, size and
  SHA-512 checked), unpacks it, verifies the bundle ID, version, processor, and code
  signature, stages it beside the installed app, and swaps the two with plain renames
  after VYXO quits. The old app is kept as a hidden backup until the new one starts,
  and a failure at any step restores or leaves the old app. Files downloaded this way
  have no quarantine flag, so the updated app opens without the first-launch warning.
  Tested with real builds by `desktop/update-e2e.cjs` (normal update and a
  deliberately corrupted download). Apps running from a disk image or a read-only
  location are told to move to Applications first. Versions before 0.2.1 cannot do
  this, so 0.2.0 to 0.2.1 is a one-time manual install. The smoke test now uses its own
  profile folder so it works while the real app is open.

- 2026-10-20: The Download buttons now start the file download directly. They go to
  `/download` (`app/download/route.ts`), which looks up the newest GitHub release and
  redirects to its Apple Silicon dmg (`lib/site/download.ts` only accepts files hosted
  under this project's own release downloads). Falls back to the releases page if GitHub
  is unreachable. Cached for 10 minutes, so a new release is picked up with no site change.

- 2026-10-20: Accuracy and signing pass.
  - **Research can only fetch plain page addresses.** Fetched URLs come solely from
    the list the user types; the question and model output never become requests
    (pinned by `lib/research/privacy.test.mjs`). Query strings and non-documentation
    paths (`%`-encoding, `;params`, over 200 characters) are now rejected in
    `normalizeResearchUrl`, so no text can ride along in a URL.
  - **Landing page copy** now matches what the code does: chatting makes no
    outbound requests; Research (9 allowlisted documentation hosts) and update
    checks are the only features that go online. One model tag
    (`lib/models/recommended.ts`) is used everywhere. Added first-launch steps for
    macOS 14 and 15+, and a platform note beside every Download button.
  - **Release builds are now ad-hoc signed** (`desktop/adhoc-sign.cjs`). The
    previous build failed `codesign --verify`, which macOS reports as "damaged".

- 2026-10-19 (evening): Public launch pass.
  - **Landing page rebuilt** (`app/web/page.tsx`, `components/web/`): editorial
    layout with a drawn replica of the app window, a "who it is for" section
    (lawyers, developers, consultants and finance, researchers and journalists),
    a data-flow diagram, an honest cloud-vs-VYXO comparison, and setup steps.
    One serif italic (Instrument Serif) is used for emphasis; everything else is
    the brand's Space Grotesk and DM Sans.
  - **Terms and Privacy pages** at `/web/terms` and `/web/privacy`, written from
    what the code actually does (no analytics, only Research fetches and update
    checks use the network). Contact: hello@mabdullahshahzad.com. Domain:
    vyxo.mabdullahshahzad.com (`lib/site/links.ts`).
  - **Data folder renamed** from `ShipStudioAI` to `VYXO Data`, and made
    cross-platform (`lib/storage/location.ts`). Existing data is copied across on
    first launch and the old folder is kept as a backup; if the copy fails the
    app keeps using the old folder. The name differs from Electron's own `vyxo`
    profile folder on purpose (macOS ignores case). `VYXO_DATA_DIR` overrides it.
    App ID is now `com.vyxo.app`.
  - **Setup guide** offers one-click "Use <model>" buttons when the saved model is
    not installed but others are.
  - Added `CODE_OF_CONDUCT.md`, a pull request template, and Dependabot.

- 2026-10-19 (later): Website, brand colours, and auto-update.
  - **Website at `/web`** (moved from `/about`). It is also the public landing
    page: `VYXO_PUBLIC_SITE=1` serves it at `/` and returns 404 for everything
    else. Added a share image (`app/web/opengraph-image.tsx` and
    `twitter-image.tsx`, Space Grotesk bundled in `app/web/fonts/`), Open Graph and
    Twitter tags, `robots.txt`, `sitemap.xml`, and `NEXT_PUBLIC_SITE_URL`.
  - **Brand colours**: the logo and icon use background `#09080c`, off-white
    `#f5f4fa`, and violet `#8259ff`, which differed from the app theme. The theme in
    `app/globals.css` now uses those exact values. The brand violet is only 4.5:1
    on the dark background, so small text uses `--accent-text` (`#9577ff`).
  - **Icons**: the browser favicon was the default Next.js triangle. It is now the
    VYXO mark (`app/favicon.ico`, `app/icon.png`, `app/apple-icon.png`). Removed
    the stale placeholder `desktop/resources/icon.svg`.
  - **Desktop links fixed**: the desktop window blocked every link, so links in
    chat replies and the setup guide did nothing. Web and mail links now open in
    the default browser (`desktop/links.cjs`); other schemes are refused.
  - **Auto-update** (`desktop/updater.cjs`, `electron-updater`): checks GitHub
    Releases after launch and every six hours, asks before downloading, and
    installs in place when the app has a Developer ID signature. Unsigned builds
    open the download page instead, because macOS refuses unsigned in-place
    updates. The build now also makes a `.zip` and `latest-mac.yml`.
  - Choosing a project folder now opens the Project files panel automatically.

- 2026-10-19: Public-readiness and polish pass.
  - **Chat**: assistant replies now render markdown (bold, lists, headings,
    quotes, links, code blocks) through `lib/chat/markdown.ts` and
    `components/chat/MarkdownContent.tsx`. It builds React elements only, so model
    output can never inject HTML, and only `http(s)`/`mailto` links are clickable.
    Added Copy buttons (messages and code), a "Jump to latest" button, and
    auto-scroll that no longer pulls you down while you re-read an answer. The
    empty state offers starter prompts. The Project files panel now starts
    collapsed so the conversation has room.
  - **Header**: the model pill used to be hardcoded to "Qwen3:8B". It now shows the
    real selected model and Ollama's status (`components/workspace/ModelBadge.tsx`).
  - **First run**: `components/workspace/SetupGuide.tsx` explains the one missing
    step (start Ollama, pull a model, or choose an installed model) with a
    copyable command, and re-checks when the window regains focus.
  - **Accessibility**: skip-to-content link, Escape closes the mobile menu, live
    regions for streaming and errors, labelled composer.
  - **App shell**: added `app/error.tsx`, `app/not-found.tsx`, viewport/theme
    colour, and an **About** page (`/about`, in the sidebar under System). Removed
    the unused `WorkspacePlaceholder` component. Package renamed from the starter
    template name to `vyxo`.
  - **Public site mode**: setting `VYXO_PUBLIC_SITE=1` makes a hosted copy serve
    only the About page at `/` and return 404 for every app page and API route
    (`lib/site/publicMode.ts`, `proxy.ts`). Use this to host a landing page on a
    service like Vercel; the real app needs the visitor's own Ollama.
  - **Open source**: rewrote `README.md`; added `LICENSE` (MIT), `CONTRIBUTING.md`,
    `SECURITY.md`, issue templates, and GitHub Actions for CI (lint, typecheck,
    tests, build) and tagged macOS releases.
  - 259 tests, lint, and typecheck pass.

- 2026-10-15: Branding and macOS installer — integrated the VYXO wordmark assets
  (`public/brand/logo-white.svg` for the dark sidebar, `public/brand/logo-black.svg`
  for light backgrounds, `public/brand/app-icon.png` as the icon source), replaced
  the sidebar placeholder with the real logo, and built the macOS `.dmg` installer
  (`release/VYXO-0.1.0-arm64.dmg`) using `desktop/resources/icon.icns`
  (converted from the app-icon source via `sips`/`iconutil`). The packaged app,
  Dock icon, and installer volume all use the new branding. 248 tests, lint,
  typecheck, both builds, the desktop `.dmg` build, and the packaged smoke test all
  pass.
- 2026-10-15: Phase 10 stabilization — fixed a chat reliability bug where the
  composer input was cleared before the request reached the server, so a
  recoverable error (server failure or network loss) discarded the user's typed
  message. Input is now cleared only after the request is accepted, and the
  typed text is restored on a non-cancelled failure so nothing is lost.
  Validated end-to-end with the packaged smoke test (chat streaming/Stop,
  memory CRUD, API auth, CSP, clean shutdown against an isolated HOME). 248
  tests, lint, typecheck, both builds, diff check, and production audit all
  pass.
- 2026-10-13: Milestone 1 — added `/chat`, a server-side streaming route to
  Ollama, and a modular model layer. Added Stop/cancel, request validation,
  error handling, and hidden reasoning output. Conversations are client-side only.
- 2026-10-13: Added an "Open AI Chat" button to the homepage that links to `/chat`.
- 2026-10-13: Milestone 2A — added a local memory **storage layer** (no UI yet).
  Memories are saved to `~/Library/Application Support/VYXO Data/memories.json`
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
- 2026-10-13: Added a minimal teaching/personalization layer — a mentor system
  prompt (`lib/prompt.ts`) prepended to every chat request, with the memory slice
  kept as a separate system message. Memory retrieval, schema, storage, API, UI,
  streaming, model settings and network binding are unchanged. 3 new
  dependency-free tests (`lib/prompt.test.mjs`); 42 total.
- 2026-10-13: Added a minimal **code-explanation workflow**. Pasting code into the
  existing chat now adds a second system prompt (`CODE_EXPLANATION_PROMPT`) that
  asks for a plain-English overview, section-by-section walkthrough, a small
  example, hedged bug/edge-case notes, and an optional short exercise. A
  dependency-free `isCodeExplanationRequest` detector in `lib/prompt.ts` decides
  when to add it; normal conversation is unchanged. The model is told not to run
  or evaluate code and not to edit files. No code is executed. Added `npm test`
  (Node's built-in runner). 4 new tests; 46 total. Lint and typecheck pass.
- 2026-10-13: Added the **Project-Aware AI Mentor** to the existing chat. A
  read-only browser folder picker displays a bounded, collapsible file tree. Only
  explicitly checked, supported files are read when a message is sent; path,
  name, content, byte-size, secret-pattern, and context limits are checked on
  both sides of the chat request. Selected text is added as clearly labeled
  untrusted context for the existing local model, memory and streaming remain in
  place, and no project content is persisted. Added synthetic filesystem and
  project-context tests (16 new; 62 total). Both `dev` and `start` now use
  `127.0.0.1:3697`.
- 2026-10-13: Added an explicit **Debug** mode to the existing chat. It asks the
  local mentor for an evidence-based diagnosis, confidence, limits, next steps,
  and a minimal suggested change when supported by the supplied code or selected
  files. Suggestions remain text only; no code is executed and no files are
  changed. Normal chat and existing code/project prompts remain available. Added
  3 prompt/mode tests; 65 total. Tests, lint, and typecheck pass.
- 2026-10-14: Phase 0 and Phase 1 desktop preview completed. Electron launches the
  app in a native window, its own Next server runs on a random `127.0.0.1` port,
  and the existing features still work. The project-folder picker is available in
  Electron; because Electron does not report `isMainFrame` for File System Access
  permission checks, the read-only permission is granted per launch to the exact
  app origin instead. The desktop adds a per-launch request token (checked by the
  chat and memory routes), a production Content Security Policy with a per-response
  nonce, and hardened window settings. Built and tested an unpacked `.app` with an
  isolated temporary memory home: project picker/file display, memory CRUD, chat
  streaming, Stop, Debug Mode, API protection, CSP, loopback-only binding, and
  clean shutdown all passed. No `.dmg` was built. 69 tests pass; lint, typecheck,
  and the desktop build pass. The October 14 Next.js security update is now
  addressed by the separate Next.js 16.4.1 maintenance update below.
- 2026-10-14: Security maintenance updated Next.js and its matching lint rules
  to 16.4.1, the official patched release for the October 14 Critical and High
  advisories. React remains 19.2.3. The 69 tests, typecheck, production build,
  and standalone desktop build pass. Lint still reports the existing Project
  Explorer state-in-effect issue, and the production audit reports one high
  indirect `source-map-js` issue, so this is not a release-ready security result
  yet. The memory file and desktop configuration were not changed.
- 2026-10-14: Finalized the security and quality checks without changing the
  product UI or desktop configuration. Updated the allowed transitive
  `source-map-js` package to patched version 1.2.2, and changed the Project
  Explorer capability check to update after hydration with cleanup. The 69
  tests, lint, typecheck, production build, standalone desktop build, and
  production dependency audit all pass with zero reported vulnerabilities.
- 2026-10-14: Added the VYXO Phase 1 workspace shell with a collapsible sidebar,
  responsive mobile navigation, VYXO placeholder mark, dark obsidian palette,
  electric-violet active states, and honest placeholder pages for Agents,
  Projects, Research, and Settings. Chat, Project files, Debug Mode, Memory,
  local Ollama behavior, and existing desktop security controls remain in place.
- 2026-10-14: Phase 2 — added **persistent local chat history** in a separate
  `conversations.json` file. Conversations are created automatically on the first
  message, titled from that message, and saved with timestamps; the Chat sidebar
  now lists history with search, rename, archive/restore, and delete-with-
  confirmation. Assistant replies are saved as `complete`, `interrupted`, or
  `failed`, and partial output is never saved as complete. The memory file and
  schema are unchanged, deletion never affects memories, and all storage stays
  local. Added 31 conversation store and API tests (100 total). Verified an
  isolated end-to-end run: streaming saved as complete, cancellation saved as
  interrupted, and search/rename/archive/delete all passed.
- 2026-10-15: Phase 9 — packaged desktop runtime validation. Built the real
  unsigned `.app` (`--mac dir`, to a temporary output so the existing bundle was
  preserved) and ran `npm run desktop:smoke` against an isolated temporary `HOME`.
  Observed a clean pass: private loopback server startup, production `/chat`
  renderer (secure context, no Node globals), CSP nonce with no unsafe script
  directives, unauthenticated API request rejected with 403, memory CRUD in the
  throwaway home, Debug Mode + ordinary chat streaming through local Ollama with
  working Stop cancellation, and clean shutdown with no leftover processes. Bundle
  inspection found no `.env`, `*.pem`, `memories.json`, or smoke scripts. Documented
  one non-fatal Next/third-party CSP inline-*style* violation (fails closed; no
  first-party inline styles). Added a `SHIPSTUDIO_SMOKE_APP_EXECUTABLE` override to
  the smoke harness so it can target a custom bundle path. Real user data was
  unchanged; nothing was signed, notarized, or distributed.
- 2026-10-15: Phase 8 — security hardening and release readiness. Added a
  DNS-rebinding defense: research HTTPS connections are now pinned to the
  validated resolved address via a custom `lookup`, while TLS still verifies the
  certificate against the hostname (`lib/research/http.ts`); fetch was moved from
  the global `fetch` to `node:https` with `Accept-Encoding: identity` so compressed
  bodies cannot bypass the byte cap, and non-identity encodings are rejected. Added
  deterministic inline-citation validation (`lib/research/citations.ts`) that
  surfaces citation numbers not retrieved in the current run, surfaced in the
  Research UI. Added regression tests for DNS pinning, encoded/oversized/redirected
  responses, citation ranges, and a source injecting an unrelated URL (15 research
  tests; 247 total). Documented the security model, trust boundaries, and remaining
  limitations in `SITE.md`. Lint, typecheck, both builds, and `npm audit` pass.
- 2026-10-14: Phase 7 — controlled web research. Added a provider-independent
  research core with a documentation allowlist, SSRF-hardened page retrieval
  (HTTPS-only, public-IP validation for IPv4/IPv6, no redirects, size/time limits,
  no JavaScript), a dependency-free HTML-to-text extractor, bounded orchestration
  with local-model synthesis and numbered citations, a `researcher` specialist with
  a server-enforced `research.local` capability, and a Research workspace. No
  automatic search provider is bundled and no external LLM is used; research never
  sends project files, context, conversations, or memory. Added 10 tests (243
  total); lint, typecheck, both builds, and the production audit pass. Verified
  live retrieval of `https://react.dev/reference/react/useState` (HTTP 200,
  extracted text) and mocked unit coverage for blocked IPs, redirects, oversized
  and unsupported responses, citation/source building, and request bounds.
- 2026-10-14: Phase 6 — specialist agents and task delegation. Added four
  specialists (planner, developer, reviewer, mentor) with explicit, server-enforced
  capabilities; a validated JSON planner; a sequential orchestration engine with
  dependency ordering, failure/partial reporting, and cancellation; a versioned
  plan store with interrupted-run recovery; desktop-token-guarded agent routes;
  and a functional Agents workspace. Specialists can only *propose* edits through
  the existing Phase 5C approval workflow. Added 12 tests (233 total); lint,
  typecheck, both builds, and the production audit pass; verified a plan → delegate
  → run cycle end-to-end against an isolated server with a mock model (2 tasks,
  sequential, combined result, replayed run rejected with 409).
- 2026-10-14: Phase 5C/5D — review-first code edits. Added structured edit
  proposals (create/modify/delete) generated by the local model and validated
  server-side (paths, containment, type, size, duplicates), a line-based diff,
  an enforced proposal lifecycle, an explicit approve step, safe atomic writes
  with hash revalidation before every write, a local recovery journal with
  guarded restore, and a proposal review panel in the project workspace. Nothing
  is written while proposing or reviewing. Verification command execution (5E)
  remains disabled. Added 26 tests (221 total); lint, typecheck, both builds, and
  the production audit pass; verified an end-to-end propose → approve → apply →
  recover cycle against an isolated server with a mock model.
- 2026-10-14: Chat UI fixes. (1) The workspace no longer grows with long
  responses: the app shell is now bound to the viewport (`h-screen` + scrollable
  `main`), the chat card and its columns use `min-h-0`/`flex-1` instead of fixed
  minimum heights, and message content wraps long tokens
  (`overflow-wrap: anywhere`) so long URLs, unbroken strings, and code never
  expand the page; fenced code blocks now render in a `<pre>` that scrolls
  horizontally. (2) The composer auto-grows with each line up to 200px and then
  scrolls internally; Enter sends, Shift+Enter inserts a newline, Enter during
  IME composition is ignored, and multiline user messages render with their
  newlines preserved. Added 4 fenced-code tests (195 total). Verified with an
  Electron run against an isolated server + mock Ollama: composer 44→84px with
  3 lines and capped at 200px, Shift+Enter did not send, Enter sent, newlines
  preserved, document stayed 1200×768 (no horizontal or vertical page
  overflow), messages scrolled internally, and the code block scrolled
  internally. Lint, typecheck, both builds, and the production audit pass.
- 2026-10-14: Phase 5A/5B — read-only source folders and evidence-based answers.
  A project can be connected to one local source-code folder (additive
  `sourceFolder` field). Added a server-side, strictly validated read-only
  filesystem service (list/read/search) with forbidden-root, traversal, symlink,
  binary, secret, size, and count protections, plus desktop-token-guarded routes
  and a Projects UI panel (connect/disconnect, explorer, search, read-only
  preview). Project chats now inject bounded, delimited, untrusted
  `<project_files>` evidence from the connected folder only. Edits (5C/5D) and
  verification commands (5E) are intentionally not implemented — VYXO cannot
  write files or run commands. Added 24 tests (191 total); lint, typecheck, both
  builds, and the production audit pass; verified with a mock-Ollama run that a
  project chat receives its own file evidence (and never `.env` contents) while
  unassigned chats receive none.
- 2026-10-14: Phase 4 — project intelligence and context. Projects now store
  **purpose, goals, technology stack, custom instructions, and notes** (additive,
  backward-compatible `context` field; existing projects load with empty
  defaults). Added a Project context editor with explicit Save/Cancel and
  size limits, and project-scoped chat now injects the conversation's own project
  context as a delimited, untrusted `<project_context>` system message resolved
  from the stored association (a client-supplied project ID is ignored). Unassigned
  chats get no project context; deleted/empty projects fail safely. Added 14 tests
  (167 total); lint, typecheck, both builds, and the production audit pass.
  Verified with a mock-Ollama end-to-end run that a project conversation receives
  only its owner project's context and that a client-supplied project ID cannot
  override the stored association.
- 2026-10-14: Bug fix — chatting inside a project. Two causes were fixed: (1) the
  Projects page had no way to start a chat in a project, so a **“New chat”** and a
  **“Start a chat in this project”** action now open `/chat?project={id}`; and (2)
  `ChatWorkspace` auto-opened the most recent conversation on load, which
  overwrote the project target and dropped the association. A project target now
  starts a fresh draft instead. Starting a chat in a project that fails to save
  shows a clear error instead of silently dropping the association. Added a
  regression test for the selection logic and project-association API tests.
- 2026-10-14: Phase 3 — added a **local model selector**, **project workspaces**,
  and a real **Settings** screen. Installed Ollama models are discovered and
  validated server-side; the selected model is stored in a new `settings.json`
  and used for chat (no silent fallback). Projects are stored in a new
  `projects.json`; conversations gained a backward-compatible optional
  `projectId`, and deleting a project keeps its conversations (they become
  unassigned) and never touches memories. Settings now shows Ollama status, the
  model list with a recheck action, storage locations, and privacy/recovery
  guidance. Added 44 tests (144 total); lint, typecheck, both builds, and the
  production audit pass. Verified an isolated end-to-end run: model discovery,
  selection, invalid-model rejection, project creation, conversation association,
  chat with the switched model, and project deletion/reattribution.

## Desktop app (technical preview)

Phase 1 wraps the existing app in an Electron window for macOS. It is a preview,
not a release: it is unsigned and has no `.dmg` yet.

- **What it does:** starts a private copy of the Next.js server on a random
  `127.0.0.1` port, opens the existing `/chat` interface in a native window, and
  stops the server when the app quits. Renderer Node integration is off, context
  isolation and sandboxing are on, and navigation/windows are limited to the local
  app origin.
- **API protection:** the main process writes a random per-launch token into chat
  and memory API requests from the app window. Requests without the token are
  rejected. The token is never exposed to page JavaScript. This raises the bar for
  other local pages; it is not full protection against malicious software running
  as the same macOS user.
- **Memory/data:** the desktop uses the same files as the web preview —
  `memories.json`, `conversations.json`, `projects.json`, and `settings.json` in
  `~/Library/Application Support/VYXO Data/`. Nothing is migrated or rewritten.
  Tests used an isolated temporary home instead of your real data.
- **Production CSP:** desktop production responses include a nonce-based
  `Content-Security-Policy` with no `unsafe-inline`/`unsafe-eval` scripts. The
  desktop app can only connect back to its own loopback origin.
- **Commands:** `npm run build:desktop` builds the isolated `.next-desktop` output;
  `npm run desktop:dir` builds the unpacked `.app` at
  `release/mac-arm64/VYXO.app`; `npm run desktop:dev` opens an Electron
  window against a separate dev server; `npm run desktop:picker-check` runs the
  read-only folder-picker check; `npm run desktop:smoke` runs the unpacked-app
  smoke test (requires the `.app` and a local Ollama model).

### Packaged runtime validation (Phase 9)

The real unsigned `.app` was built (`--mac dir`), launched, and exercised with
`npm run desktop:smoke` against an **isolated temporary `HOME`** (so all
persistence resolved to a throwaway directory; the real Application Support store
was never opened for writing). Observed results from that run:

- **Startup/shutdown:** the main process started the private server on a random
  `127.0.0.1` port, loaded the production `/chat` interface, and quit cleanly —
  after quit the local server stopped answering, and no app/next-server processes
  were left behind.
- **Renderer:** secure context `true`, no `require`/`process` in the renderer, the
  picker capability present, the production CSP nonce present with no
  `unsafe-eval`/`unsafe-inline` scripts and `connect-src 'self'`.
- **API authentication:** an unauthenticated `GET /api/memories` returned **403**
  (`token-missing`); the app-window request carried the per-launch token and
  succeeded.
- **Persistence isolation:** memory GET/POST/PATCH/GET/DELETE worked against the
  temporary home, which began empty.
- **Chat/model:** Debug Mode and ordinary chat streamed through the packaged
  server against the local Ollama model; **Stop** cancelled the in-flight stream.
- **Package contents:** no `.env`, `*.pem`, `memories.json`, or smoke-test scripts
  were present in the bundled output.
- **Observed non-fatal issue:** the renderer logged one CSP inline-**style**
  violation (`style-src` has no `unsafe-inline`). No first-party component uses
  inline styles, so this comes from Next/third-party markup; it fails closed
  (style blocked) and did not affect any tested workflow. Not fixed, because the
  only in-place fixes would weaken the CSP.
- **Not exercised in this phase:** Ollama-unavailable behavior (would require
  stopping the user's Ollama), research/agents/edit-proposal packaged flows (not
  part of the smoke harness; routes compile and load), and signed/notarized `.dmg`
  distribution.

Use `SHIPSTUDIO_SMOKE_APP_EXECUTABLE=/path/to/VYXO` to point the smoke at
a bundle built to a non-default output directory.

## Not built yet (planned later)

- Automatic memory saving or extraction from conversations (chat can only read).
- Specialist agents (Webflow, audits, coding, learning) and agent orchestration.
- Web browsing or automated internet research.
- External AI providers, cloud sync, and user accounts.
- Project file uploads and per-project AI isolation.
- Backend-enforced permissions with approval for sensitive actions.
- Secure access from phone and laptop.
- Per-profile isolation for conversations, memories, and settings (single local
  profile only for now).
- Retrying a specific failed response from the history sidebar (a retry currently
  re-sends a new message).
