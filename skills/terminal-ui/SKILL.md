---
name: terminal-ui
description: Build and review terminal interfaces, CLI output, keyboard workflows, resize behavior, plain output, and accessible terminal interaction. Includes a dependency-free output reference and terminal framework sources.
---

# Terminal UI

Read `references/terminal.md`. Use the existing project's framework; choose a
framework only for a new project. Website CSS rules do not apply to terminal cells.

From the full UFS plugin, run `node scripts/terminal-ui.mjs` for a portable
output reference. This is a static rendering example, not a full-screen input
framework. Its ASCII contract is deliberate; use a framework's display-width
implementation for multilingual cells rather than string.length.

Build the real operation first. Separate stdout data from stderr progress.
Provide help, plain/JSON output, documented exit codes, empty/error states and
Ctrl+C cleanup. Use the host's approval UI for consequential commands. Never
embed credentials or terminal escape sequences supplied by a server.

Check keyboard-only operation, redirected output, NO_COLOR, TERM=dumb, an
80x24 terminal and narrow resizing. Keep completed output selectable and useful.
Test functional flow, then adversarial input and interrupted cleanup. No emojis.
