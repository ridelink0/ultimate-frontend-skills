---
description: "Design parity check - compare a built page against its Claude Design artboard or a reference page: type sizes, palette, vertical rhythm and layout geometry"
argument-hint: "<built dir, file or URL> --design <seeded canvas.html or page>"
disable-model-invocation: true
---

The request is the text the user typed with this command (Claude Code appends
it below as ARGUMENTS; in Codex it is the rest of the message). It needs both
a built page and a design reference; ask for whichever is missing.

`${CLAUDE_PLUGIN_ROOT}` is this plugin's folder. Codex runs this command as a
skill and leaves that variable empty; there, use the folder that holds
`.codex-plugin/`, three levels above this file.

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" parity <dir|file|url> --design <canvas.html|page> [--widths 1440]
```

Hand it a seeded canvas page or a plain HTML rendering of the design; a bare
`.dc.html` is not a renderable page and is refused. An ERROR naming absent
type sizes and colours means the design was rebuilt in the house style
instead of kept - fix the page, not the check.
`${CLAUDE_PLUGIN_ROOT}/skills/ultimate-frontend-skills/references/claude-design.md`
covers the routes. Report each difference with its measured values.
