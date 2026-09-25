---
description: "Scaffold a new website from the section library - pick a preset and sections, write index.html with the CSS chassis and motion runtime, or add one section to an existing page"
argument-hint: "<dir> [name] [preset bone|ink|cinema|fable] [sections] | add <section-id> <file> | list"
disable-model-invocation: true
---

Use the `ultimate-frontend-skills` skill (`${CLAUDE_PLUGIN_ROOT}/skills/ultimate-frontend-skills/SKILL.md`)
and follow its rule zero: build the files, keep design reasoning out of the reply.

The request is the text the user typed with this command (Claude Code appends
it below as ARGUMENTS; in Codex it is the rest of the message).

`${CLAUDE_PLUGIN_ROOT}` is this plugin's folder. Codex runs this command as a
skill and leaves that variable empty; there, use the folder that holds
`.codex-plugin/`, three levels above this file.

- **list**, or no section ids given: show the library first -
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" sections`
- `add <id> <file>`: insert one section before `</main>` -
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" add <id> --to <file>`
- **a directory**: choose the register (object, place, service, argument) and
  take the sections from the register table in the skill, then
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" new <dir> --preset <bone|ink|cinema|fable> --name "<Name>" --sections <ids>`
  Do not pick `bone` because it is first; the skill says when each preset fits.

A fresh scaffold is meant to fail the audit on scaffold copy. After
scaffolding, rewrite every word, set the hero image and `--accent-h`, then
`node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" audit <dir>` must exit 0.
Report the paths in two sentences.
