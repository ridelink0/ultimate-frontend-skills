---
description: "Image deep research - find reference images, render real websites into screenshot contact sheets, build a moodboard, and read the pictures as pictures (visual research for design references, styles, palettes, typefaces, competitors)"
argument-hint: "<topic, style, palette, typeface, competitor list, or URLs to look at>"
disable-model-invocation: true
---

Read `${CLAUDE_PLUGIN_ROOT}/skills/visual-research/SKILL.md` and follow it. It
is the image research route of Ultimate Frontend Skills: it answers design
questions by looking at pictures, not by reading about them.

The request is the text the user typed with this command (Claude Code appends
it below as ARGUMENTS; in Codex it is the rest of the message). If it is
empty, ask one question: what should be looked at.

`${CLAUDE_PLUGIN_ROOT}` is this plugin's folder. Codex runs this command as a
skill and leaves that variable empty; there, use the folder that holds
`.codex-plugin/`, three levels above this file.

Route by what was asked:

1. **URLs given** - render them into contact sheets:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" study <url> <url> ...`
2. **A style, technique or kind of site** - pick references from the award
   corpus and render them:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" awards "<topic>" --verbose`
   then `node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" study --awards "<topic>" --n 6`.
   Curated sets: `study --list editorial|object|cinema|product`.
3. **Images of a subject, a palette, a material, a moodboard** - search the
   open image sources the skill lists (Openverse, Wikimedia Commons, Art
   Institute of Chicago, the Met), HEAD-check every URL, and keep the licence
   beside each one.

Then **open the contact sheets and read them** before writing a word about
them. Go in with a question (where the eyebrow sits, what the ground colour
is, what the first screen does), not "what do these have in common".

Report: the file paths of the sheets, the verified image URLs with their
licences, and per reference the one concrete move worth taking. Never describe
an image you have not opened; say plainly when a render is a preloader or a
challenge page.
