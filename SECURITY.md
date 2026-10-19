# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Use GitHub's
private reporting instead: go to the repository's **Security** tab and choose
**Report a vulnerability**.

Include what you found, steps to reproduce, and the impact you expect. You can
expect an acknowledgement within a few days.

## What matters most here

VYXO runs on the user's own machine, so the interesting risks are:

- Reading or writing files outside a folder the user connected (path
  traversal, symlink escapes).
- Applying edits the user did not approve.
- The Research fetcher reaching private or loopback network addresses (SSRF).
- Another local process or web page driving the app's local API.
- Secrets or private content leaking into prompts, logs, or stored files.

## Supported versions

Only the latest release receives fixes.
