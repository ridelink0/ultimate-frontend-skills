---
description: "Find and download free CC0 PBR textures and HDRI environment lighting from Poly Haven and ambientCG, verified, with the three.js material code that wires them up"
argument-hint: "<surface or material, e.g. brushed steel> | textures <slug> | hdri <slug>"
disable-model-invocation: true
---

The request is the text the user typed with this command (Claude Code appends
it below as ARGUMENTS; in Codex it is the rest of the message).

`${CLAUDE_PLUGIN_ROOT}` is this plugin's folder. Codex runs this command as a
skill and leaves that variable empty; there, use the folder that holds
`.codex-plugin/`, three levels above this file.

1. Search first unless a slug was given:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" assets search "<surface>" [--source polyhaven|ambientcg]`
2. Download the set that fits:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" assets textures <slug> [--res 2k] [--out DIR]`
   or the environment map:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" assets hdri <slug> [--res 2k] [--out DIR]`

The command verifies the checksum, writes provenance and prints the three.js
material or PMREM wiring; use that code rather than hand-writing it.
`references/three.md` and `references/image-gen.md` under
`${CLAUDE_PLUGIN_ROOT}/skills/ultimate-frontend-skills/` cover light and
materials on a scroll page.

Both sources are CC0: no key, no attribution needed on the site. Keep 1k or 2k
for the web unless the object fills the screen.
