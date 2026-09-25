---
description: "Check the frontend tools bench - which design plugins, skill packs, Blender, ffmpeg, rembg, browsers and credentials are installed, and what changes because of each"
argument-hint: "(no arguments)"
disable-model-invocation: true
---

`${CLAUDE_PLUGIN_ROOT}` is this plugin's folder. Codex runs this command as a
skill and leaves that variable empty; there, use the folder that holds
`.codex-plugin/`, three levels above this file.

Run both and report what they print:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" tools
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" packs
```

The first says what is on this machine and one line on what changes because
of it - for instance, when `frontend-design` is installed it owns the
aesthetic direction and this plugin supplies the chassis, motion, 3D and
verification. The second lists the skill packs this plugin defers to and
which are absent. It reports that a credential is present, never its value;
keep it that way.

Do not install anything from here; `frontend-skill-packs` does that when
asked.
