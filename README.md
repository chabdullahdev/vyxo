# VYXO

**A private AI workspace that runs on your own computer.**

VYXO gives you chat, projects, memory, research, and agents on top of models
running locally through [Ollama](https://ollama.com). Your conversations and
files are never uploaded. There is no account, no telemetry, and no cloud sync.

<!-- Add a screenshot or short GIF here: docs/screenshot.png -->

## What you get

| | |
|---|---|
| **Chat** | Streaming answers from a local model, with saved history you can search, rename, archive, and delete. Replies render markdown and code with one-click copy. |
| **Projects** | Per-project goals, tech stack, and instructions. Connect a code folder read-only and choose exactly which files the model may see. |
| **Edit proposals** | The assistant proposes file changes as a diff. Nothing is written until you approve, and applied changes can be recovered. |
| **Agents** | A planner splits a request into bounded tasks for specialists. They run one at a time and you review each result. |
| **Memory** | Facts the assistant can read. Only you can add, edit, or delete them. |
| **Research** | Summarises approved public documentation pages with citations and stated limitations. |
| **Debug mode** | Read-only diagnosis and suggested fixes. Nothing is run or applied. |

## Quick start

You need [Ollama](https://ollama.com/download), Node.js 20.9 or newer, and a
model.

```bash
ollama pull qwen3:8b        # any model Ollama supports works
git clone https://github.com/chabdullahdev/ai.git vyxo
cd vyxo
npm install
npm run dev                 # opens on http://127.0.0.1:3697
```

To run it as a desktop window instead of in the browser:

```bash
npm run desktop:dev
```

VYXO detects your installed models. If Ollama isn't running or no model is
installed, the app tells you what to do.

### Download the Mac app

Apple Silicon builds are attached to each
[release](https://github.com/chabdullahdev/ai/releases/latest). Builds are not
yet signed by Apple, so on first launch right-click the app and choose **Open**.

## Privacy, concretely

- The browser never talks to Ollama. Every request goes through the app's own
  local server, which validates input first.
- Conversations, projects, and memories are plain JSON files in your user data
  folder (`~/Library/Application Support/ShipStudioAI/` on macOS), written
  atomically with owner-only permissions.
- Project folders are read-only. File and credential checks are defensive
  filters, not a guarantee; don't connect folders holding secrets you can't
  afford to expose to a local model.
- Research only fetches public pages, blocks private and loopback addresses,
  refuses redirects, and bounds response size.

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Where Ollama is listening |
| `DEFAULT_MODEL` | `qwen3:8b` | Model used until you pick another in Settings |
| `VYXO_PUBLIC_SITE` | unset | Set to `1` to serve **only** the About page and block the app and API, for hosting a public landing page (for example on Vercel) |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run lint` / `npm run typecheck` / `npm test` | Checks |
| `npm run build` | Production build |
| `npm run desktop:dev` | Electron window against the dev server |
| `npm run desktop:dmg` | Build the macOS `.dmg` into `release/` |

## Project layout

```
app/          Pages and API routes (Next.js App Router)
components/   UI: chat, projects, agents, memory, research, settings
lib/          Model provider, stores, file policy, edit engine, agents, research
desktop/      Electron shell
SITE.md       Detailed design notes, API schemas, and change history
```

`SITE.md` is the long-form record of how each feature works and why.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md)
first. Please run `npm run lint && npm run typecheck && npm test` before
opening a PR.

## License

[MIT](LICENSE)
