---
description: Use Claude Design with Ultimate Frontend Skills to create or implement a design.
---
Read skills/ultimate-frontend-skills/references/claude-design.md and skills/ultimate-frontend-skills/SKILL.md in this plugin, then apply the user's brief below.

Find out which route exists before assuming one: `node "${CLAUDE_PLUGIN_ROOT}/scripts/design.mjs" detect`. On a current Claude Code build the live routes are the built-in `design` canvas skill and the native `DesignSync` tool - neither is an MCP server, so do not go looking for a connected Design server or explain MCP setup unless `detect` says that is the only route this host has. Never register anything, consent or log in on the user's behalf, and never report a remote Design operation as successful without its actual result.

A supplied design - a published canvas, an exported bundle, a Design project - takes precedence over this plugin's house style completely. Preserve its typography, spacing, composition and palette; the house style is for a project with no design, never a reason to overwrite one that has.

That rule is now measurable rather than merely stated. When a design reference is supplied, prove you kept it:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" verify <built dir|url> --design <seeded canvas>.html
```

A design that was rebuilt in the house style shows up there as an ERROR naming the type sizes and colours that are absent from it. Hand a seeded canvas page (or a plain HTML rendering of the design), not a bare `.dc.html` - that is not a renderable page and parity refuses it.

$ARGUMENTS
