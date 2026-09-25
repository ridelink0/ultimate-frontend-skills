---
description: "Audit a website's source for the AI-generated tells - placeholder copy, missing alt and image sizes, pure black and white, no reduced motion, unused engines - then fix what it finds"
argument-hint: "<site dir or html file>"
disable-model-invocation: true
---

The request is the text the user typed with this command (Claude Code appends
it below as ARGUMENTS; in Codex it is the rest of the message). With no path,
audit the current directory.

`${CLAUDE_PLUGIN_ROOT}` is this plugin's folder. Codex runs this command as a
skill and leaves that variable empty; there, use the folder that holds
`.codex-plugin/`, three levels above this file.

Run the source audit:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" audit <dir|file>
```

`${CLAUDE_PLUGIN_ROOT}/skills/ultimate-frontend-skills/references/tells.md`
explains each finding and what to do instead; `copy-tells.md` covers the copy.
Fix every error and every warning worth fixing, run the audit again until it
exits 0, then walk `references/checklist.md` for what the audit cannot see.

The audit reads source only. Say so, and suggest `render-check-website` or
`verify-website` for the rendered page. Never edit the audit to make a finding
go away.
