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
skill and leaves that variable empty; there, put the plugin folder in its
place in every command. The plugin's session note names it ("ultimate-frontend-skills
is installed at ..."); without the note, it is the folder that holds
`.codex-plugin/` under `~/.codex/plugins/cache/`.
