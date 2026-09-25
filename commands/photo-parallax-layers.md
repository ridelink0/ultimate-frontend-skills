---
description: "Cut one photograph into parallax layers - subject cut-out, background with the hole filled and a mask - locally with rembg, for a layered 3D depth hero"
argument-hint: "<photo path> [--out img] [--name base]"
disable-model-invocation: true
---

The request is the text the user typed with this command (Claude Code appends
it below as ARGUMENTS; in Codex it is the rest of the message). It needs a
photograph; ask for one if none was given.

`${CLAUDE_PLUGIN_ROOT}` is this plugin's folder. Codex runs this command as a
skill and leaves that variable empty; there, use the folder that holds
`.codex-plugin/`, three levels above this file.

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" cut <photo> [--out DIR] [--name base] [--alpha-matting]
```

It needs rembg once: `python -m pip install "rembg[cpu]"`. It runs locally, no
service and no key.

Exit 3 means the cut was refused and the output says why. **Never composite a
refused cut-out** - a subject with a razor edge under it reads as a collage.
Choose another photograph or keep it as one plane.

Open the PNGs it writes before using them. Composing the planes (bands, not
full-height planes, aerial perspective, one grade across them) is in
`${CLAUDE_PLUGIN_ROOT}/skills/ultimate-frontend-skills/references/imagery.md`
and "Layered parallax" in `references/motion.md`.
