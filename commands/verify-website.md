---
description: "Verify a website before shipping - one verdict from the source audit, the browser render and quality pass, the security scan and optional design parity, by severity"
argument-hint: "<site dir or URL> [--design canvas.html] [--widths 1440,390]"
disable-model-invocation: true
---

The request is the text the user typed with this command (Claude Code appends
it below as ARGUMENTS; in Codex it is the rest of the message). With no
target, verify the current directory.

`${CLAUDE_PLUGIN_ROOT}` is this plugin's folder. Codex runs this command as a
skill and leaves that variable empty; there, use the folder that holds
`.codex-plugin/`, three levels above this file.

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" verify <dir|url> [--widths 1440,390] [--design <seeded canvas>.html]
```

Report every finding in severity order (error, warning, low, note) with where
it is and the fix. A URL has no source, so its audit and security sections
come back `skipped` - say that, never count a skipped check as passed. Open
the screenshots it writes before calling the render clean.

Exit 1 means something failed. Fix what the user asks for and run it again;
never weaken a check to reach exit 0.
