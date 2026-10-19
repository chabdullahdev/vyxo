# Contributing to VYXO

Thanks for helping. VYXO's whole promise is that it is private and predictable,
so changes are judged against that first.

## Ground rules

- **Local only.** No feature may send user content to a remote service. Network
  access beyond Ollama and the Research fetcher needs a strong reason and an
  explicit user action.
- **The user stays in control.** Anything that writes files, runs something, or
  changes stored data must be approved by the user first.
- **Fail honestly.** Show real errors and real limits. Don't claim a file was
  read or an action happened when it didn't.

## Setup

```bash
npm install
npm run dev
```

You need Ollama running with at least one model for end-to-end testing.

## Before you open a PR

```bash
npm run lint
npm run typecheck
npm test
```

CI runs the same checks plus a production build.

- Add a test for new logic in `lib/`. Tests are `*.test.mjs` files next to the
  code and run with Node's built-in test runner.
- Match the surrounding code: naming, comment density, Tailwind utility styling,
  and the existing colour tokens in `app/globals.css`.
- Keep UI accessible: labelled controls, visible focus, keyboard operable.
- Update `README.md` or `SITE.md` if behaviour changes.

## Reporting bugs

Open an issue with what you did, what you expected, what happened, your OS, and
your Ollama version and model. For security problems, see
[SECURITY.md](SECURITY.md) instead of filing a public issue.
