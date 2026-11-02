---
description: "Render real websites in a headless browser into screenshot contact sheets and measure their palette and typefaces - visual research on competitors, styles and design references"
argument-hint: "<URLs, or a list name: editorial, object, cinema, product>"
disable-model-invocation: true
---

Render websites with the image-deep-research skill. Read
`${CLAUDE_PLUGIN_ROOT}/skills/image-deep-research/SKILL.md` first and follow
its loop and its report.

The sites are the text the user typed with this command (Claude Code appends
it below as ARGUMENTS; in Codex it is the rest of the message). If it is
empty, ask one question: which sites, or which kind of site.

`${CLAUDE_PLUGIN_ROOT}` is this plugin's folder. Codex runs this command as a
skill and leaves that variable empty; there, use the folder that holds
`.codex-plugin/`, three levels above this file.

Run, with URLs:

`node "${CLAUDE_PLUGIN_ROOT}/skills/image-deep-research/scripts/study.mjs" <url> <url>`

or with a curated list:

`node "${CLAUDE_PLUGIN_ROOT}/skills/image-deep-research/scripts/study.mjs" --list editorial`

Add `--width 390` for a phone read. Then open the contact sheets and read them
before writing a word about them; the grounds, ink colours and typefaces it
prints are what the browser computed.

Report the sheet paths and, per site, the one concrete move worth taking.
Name every site that rendered as a wall or failed, and do not guess what is
behind it.
