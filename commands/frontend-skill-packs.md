---
description: "Manage frontend skill packs - list the design and animation packs UFS works with, install the missing ones, add a new pack from a GitHub repo, vendor or remove one"
argument-hint: "[install | add owner/repo | vendor <id> | remove <id>]"
disable-model-invocation: true
---

The request is the text the user typed with this command (Claude Code appends
it below as ARGUMENTS; in Codex it is the rest of the message).

`${CLAUDE_PLUGIN_ROOT}` is this plugin's folder. Codex runs this command as a
skill and leaves that variable empty; there, use the folder that holds
`.codex-plugin/`, three levels above this file.

Read `${CLAUDE_PLUGIN_ROOT}/skills/ultimate-frontend-skills/references/skill-packs.md`
for which pack owns what and the component-versus-page line. Then:

- nothing given: `node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" packs`
- **install**: show the plan first with
  `packs --install --dry-run`, then `packs --install [--only <id>]`
- **add owner/repo**: `packs add <owner/repo> [--owns "..."] [--why "..."]`
- `vendor <id>`: `packs vendor <id>` (copies it into `packs/`; it refuses a
  licence that does not clearly permit a copy, and `--force` is only for a
  licence the user has checked)
- `remove <id>`: `packs remove <id>`

Every subcommand runs as `node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" packs ...`.
Report what it did and what it refused. It never spawns a tool that is not on
the machine; do not work around that.
