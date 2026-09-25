---
description: Inspect a rendered website at desktop and mobile widths, exercise interactions, and review the screenshots.
argument-hint: "<site dir or URL> [--actions FILE] [--motion both|normal|reduce]"
---

Read skills/ultimate-frontend-skills/references/visual-debug.md, then run the debug
command against the requested website:
`node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" debug <dir|url>`. Open its screenshots with the available
image tool, fix observed defects and repeat. Report evidence and unresolved
limitations. Never claim a visual pass from source or JSON checks alone.

`${CLAUDE_PLUGIN_ROOT}` is this plugin's folder. Codex runs this command as a
skill and leaves that variable empty; there, use the folder that holds
`.codex-plugin/`, three levels above this file.
