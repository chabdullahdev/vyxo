# VYXO development guide

This file is the shared memory for everyone who builds VYXO: people, and AI coding agents (Claude Code on Mac or Windows). Keep it current when you change how the project works. Facts that only exist in one person's chat history do not count.

## What VYXO is

A private, local-first AI workspace for the desktop. It runs a Next.js app inside Electron, talks to a model running on the same machine through Ollama (`http://127.0.0.1:11434`), and keeps all data on the computer. The public website is the same code with `VYXO_PUBLIC_SITE=1`.

Main parts:
- **Chat and memory:** `components/chat`, `lib/conversations`, `lib/memory`.
- **Projects (connected folders):** `components/projects/ProjectsWorkspace.tsx`, `lib/projects`, `lib/files`, `lib/edits` (proposed changes, approve, apply, undo).
- **Workspace projects (managed by VYXO):** `lib/workspace` (create, files, Build mode in `builder.ts`, preview, export, Git in `git.ts`, Next.js builds in `build.ts`). Screens: `components/projects/workspace`, route `app/projects/[id]`.
- **Desktop shell:** `desktop/main.cjs` (windows, menu, server), `desktop/updater.cjs` and `desktop/inplace-update.cjs` (updates), `desktop/site-deps` (the packages a Next.js website needs).
- **Website:** `app/web`, `components/web`.

## Set up

Needs Node.js 22 or newer, Git, and Ollama with a model (the app's default is `qwen3:8b`; set `DEFAULT_MODEL` to use another installed model).

```
npm install
npm run dev              # the app on http://127.0.0.1:3697
```

For the desktop app in development: `npm run desktop:dev` (works on Mac and Windows).

To try the app by hand without touching your real data, use the test folder:

```
npm run desktop:test               # development version
npm run desktop:test -- --built    # the app from release/ (after desktop:win or desktop:dir)
npm run desktop:test -- --reset    # start again with an empty test folder
```

The test folder is `~/VYXO Test` (outside the repository): `Data/`, `Projects/`, the window's own `Profile/`, and a `Sample folder/` to connect as a project. It runs even while the real VYXO is open.

On Windows, if `node_moduleselectrondist` is missing after `npm install`, run `node node_modules/electron/install.js`. (`package.json` allows Electron's download step under `allowScripts`, which newer npm versions require.)

## Checks (run before every commit)

```
npm run typecheck
npm run lint
npm test                 # about 400 tests, real Git and real Next.js builds included
```

Some tests build a real Next.js site and take a few seconds each. They need `node_modules` in the repository.

## Packaging

- **Windows (on a Windows machine):** `npm run desktop:win`. The installer is written to `release\`. It is not code-signed yet.
- **Check a build:** `npm run desktop:smoke` starts the unpacked app with temporary folders and checks chat, Stop, memory, security headers and shutdown. The folder-picker step is automated on macOS only; on Windows it is skipped and must be checked by hand.
- **Mac:** `npm run desktop:dir` (folder build) or `npm run desktop:dmg` (installer). Mac builds are ad-hoc signed, not notarized.
- Every desktop build first runs `scripts/prepare-site-deps.mjs`, which installs the Next.js packages for the machine doing the build into `build/site-deps`. Never copy `build/` between machines. Each machine prepares its own.

## Safety rules (read before running anything)

- **Never touch real user data.** For tests and manual runs, set `VYXO_DATA_DIR` and `VYXO_PROJECTS_DIR` to a temporary folder. The default data folder is `~/Library/Application Support/VYXO Data` on Mac and `%APPDATA%\VYXO Data` on Windows.
- **Pushing to `main` publishes the code, and `main` also deploys the public website (Vercel).** Only push when the person you work for has said so.
- **Releases** (tags `vX.Y.Z`) build the Mac and Windows installers on GitHub and put both in one draft release. Publish a release only after the owner has checked the draft.
- Do not commit `.shipstudio/`, `build/`, `release/`, `.next*`, `out/`, or any file with keys or personal data. They are in `.gitignore`; keep it that way.
- Test fixtures may contain words such as `SECRET`; that is test data, not a leak.

## How work is checked

- Every change is covered by tests in `lib/**/*.test.mjs` or `components/**` where practical.
- UI changes are checked in a browser against an isolated copy of the app (temporary data folders, a separate port), not against the owner's own data.
- Claims in the docs must match what was verified. `SITE.md` has a "Recent Changes" log that lists what was verified and what was not.

## Platform notes

- **macOS:** the release is Apple Silicon only (arm64). Updates replace the app in place (`inplace-update.cjs`).
- **Windows:** the installer is x64. Updates open the downloads page for now (`updater.cjs` falls back when the app is not a Mac bundle). Project links use junctions. Git and the GitHub CLI are found in their default Windows folders. Verified on Windows 11 (2026-10-24): `npm run desktop:win` builds the installer, and `desktop:smoke` passes on the unpacked app (chat streaming and Stop, Debug Mode, memory, API authorization, CSP, clean shutdown). Not yet verified on Windows: the folder picker, the installed app running a project, the site build, the preview, Git, and the update message.

## Open work

- SvelteKit and Astro website starters are not built (they would add more package size).
- Windows: checking the items listed under Platform notes, a signed installer, real auto-update, an automated folder-picker check.
- Website builds use the packages in `desktop/site-deps`. Sites are built offline; npm is run with `npm_config_offline`.
- The model's website drafts still need prompt and design work (the layout is fixed; the model writes `site/content.ts`).

## Decisions already made (do not re-ask)

- Workspace projects live in `~/VYXO Projects` (not Documents, because of macOS permission prompts after updates).
- Build mode writes files only after the person approves them. Nothing is written silently.
- Workspace chats never see the global memories.
- Git is used through the person's own sign-in. VYXO stores no tokens. Pushing happens only when the person presses the button.
- Private files (keys, `.env`, credentials) are never added to a Git snapshot.
