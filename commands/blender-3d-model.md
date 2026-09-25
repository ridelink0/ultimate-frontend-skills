---
description: "Model a 3D object in Blender headless for a website - export a GLB with named parts for a three.js exploded view, bake texture maps, or render a turntable frame sequence"
argument-hint: "<what to model or the .blend/.py to use> [glb|bake|frames]"
disable-model-invocation: true
---

The request is the text the user typed with this command (Claude Code appends
it below as ARGUMENTS; in Codex it is the rest of the message).

`${CLAUDE_PLUGIN_ROOT}` is this plugin's folder. Codex runs this command as a
skill and leaves that variable empty; there, use the folder that holds
`.codex-plugin/`, three levels above this file.

Read `${CLAUDE_PLUGIN_ROOT}/skills/ultimate-frontend-skills/references/blender.md`
first. It opens with when Blender is not the answer; most pages should not use
it, and procedural three.js from the markup is often enough.

Then prove Blender is here before planning around it:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" blender probe
```

Exit 3 means absent: say so and offer the procedural route instead. If
present:

- a model for the page: `blender glb <script.py> --out <file.glb>` - name
  every part, it is what the exploded view pulls apart
- texture maps: `blender bake <file.blend> --out <dir> [--passes diffuse,normal,ao]`
- a sequence: `blender frames <file.blend> --out <dir> --count N`

The templates it drives are in `${CLAUDE_PLUGIN_ROOT}/scripts/blender/`. Report
what the command proved (bytes, node names, frame count), not what was hoped.
