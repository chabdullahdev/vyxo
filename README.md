# VYXO

**A private AI workspace that runs on your own computer.**

**Website:** [vyxo.mabdullahshahzad.com](https://vyxo.mabdullahshahzad.com)

VYXO gives you chat, projects, memory, research, and agents on top of models
running locally through [Ollama](https://ollama.com). Your conversations and
files are never uploaded. There is no account, no telemetry, and no cloud sync.

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
git clone https://github.com/chabdullahdev/vyxo.git
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

macOS on Apple Silicon only; Windows and Intel Macs are not supported yet.
Builds are attached to each
[release](https://github.com/chabdullahdev/vyxo/releases/latest).

The app is not signed with a paid Apple Developer certificate, so macOS asks you
to approve the first launch (once):

- **macOS 15 Sequoia or later:** double-click VYXO. macOS says "Apple could not verify
  VYXO is free of malware…", which is expected; close it without moving the app
  to the Trash. Open
  **System Settings → Privacy & Security**, scroll to Security, click **Open
  Anyway**, and enter your password. The button is available for about an hour
  after you try to open the app.
- **macOS 14 Sonoma or earlier:** Control-click VYXO, choose **Open**, then Open.
- **Terminal alternative:** `xattr -dr com.apple.quarantine /Applications/VYXO.app`

The release build is ad-hoc signed (free) so macOS reports "unidentified
developer" rather than "damaged".

**Updates.** The app checks GitHub Releases shortly after launch and every six
hours, and asks before doing anything. Choose **Update now** and VYXO downloads the
new version, checks its checksum, signature, version, and processor type, then
replaces itself and restarts. Your conversations, projects, and settings live
outside the app and are kept. The old app is held as a hidden backup until the new
one has started, and any failure leaves the installed app untouched. This works
without a paid Apple certificate because VYXO replaces its own app file instead of
using macOS's built-in updater (which requires one). It needs VYXO to be installed
in a folder you can write to, such as Applications; if it is running from the disk
image, it asks you to move it first. Versions before 0.2.1 can't update themselves
this way, so moving from 0.2.0 to 0.2.1 is a one-time manual install.
Set `VYXO_DISABLE_UPDATES=1` to turn checking off.

## Privacy, concretely

- The browser never talks to Ollama. Every request goes through the app's own
  local server, which validates input first.
- Conversations, projects, and memories are plain JSON files in your user data
  folder, written atomically with owner-only permissions. On macOS that is
  `~/Library/Application Support/VYXO Data/`; on Windows `%APPDATA%\VYXO Data`;
  on Linux `~/.local/share/VYXO Data`. Early builds used a `ShipStudioAI` folder;
  on first launch VYXO copies it across and leaves the original as a backup.
- Project folders are read-only. File and credential checks are defensive
  filters, not a guarantee; don't connect folders holding secrets you can't
  afford to expose to a local model.
- Research is the only feature that fetches web pages. It accepts only pages
  from a short allowlist of documentation sites (extend it with
  `RESEARCH_ALLOWED_HOSTS`), blocks private and loopback addresses, refuses
  redirects, and bounds response size. The request carries only the page
  address; your question and files go to the local model alone.
- The desktop app checks GitHub Releases for updates. Set
  `VYXO_DISABLE_UPDATES=1` to turn that off.

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Where Ollama is listening |
| `DEFAULT_MODEL` | `qwen3:8b` | Model used until you pick another in Settings |
| `VYXO_PUBLIC_SITE` | unset | Set to `1` to serve **only** the website (`/web`) and block the app and API, for hosting it publicly |
| `NEXT_PUBLIC_SITE_URL` | `https://vyxo.mabdullahshahzad.com` | Absolute site URL for share images, canonical links, and the sitemap |
| `VYXO_DISABLE_UPDATES` | unset | Set to `1` to stop the desktop app checking for updates |
| `VYXO_DATA_DIR` | see above | Store conversations, projects, and memories somewhere else |

## The website

The website lives at `/web`: a landing page plus `/web/terms` and `/web/privacy`.
It includes a social share image (`app/web/opengraph-image.tsx`, drawn from the
brand logo and colours).

To host it on Vercel, import the repo and set these environment variables:

```
VYXO_PUBLIC_SITE=1
NEXT_PUBLIC_SITE_URL=https://vyxo.mabdullahshahzad.com
```

With `VYXO_PUBLIC_SITE=1`, `/` shows the website and every app page and API
route returns 404, so nothing private is reachable on the hosted copy.
Without it, the same code is the full app and `/web` is its About page.

## Releasing

1. Bump `version` in `package.json` and commit.
2. Tag it and push: `git tag v0.2.0 && git push origin v0.2.0`.
3. The Release workflow builds the `.dmg` and `.zip`, and publishes them with
   `latest-mac.yml`, which installed apps read to find the update.

To sign and notarize, add `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` as repository secrets.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run lint` / `npm run typecheck` / `npm test` | Checks |
| `npm run build` | Production build |
| `npm run desktop:dev` | Electron window against the dev server |
| `npm run desktop:dmg` | Build the macOS `.dmg` and update `.zip` into `release/` |

## Project layout

```
app/          Pages and API routes (Next.js App Router)
components/   UI: chat, projects, agents, memory, research, settings
lib/          Model provider, stores, file policy, edit engine, agents, research
desktop/      Electron shell
SITE.md       Detailed design notes, API schemas, and change history
```

`SITE.md` is the long-form record of how each feature works and why.

## Platforms

The desktop app is built for macOS on Apple Silicon. The web version runs
anywhere Node.js and Ollama do (`npm run dev`), with data stored in the
platform's normal user-data folder. Windows and Linux desktop builds are not
published yet; contributions are welcome.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md)
and the [Code of Conduct](CODE_OF_CONDUCT.md) first. Please run `npm run lint && npm run typecheck && npm test` before
opening a PR.

## License

[MIT](LICENSE)
