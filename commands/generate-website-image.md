---
description: "Generate an image for a website - checks what image generation this machine can actually run, writes the prompt without the AI-image tells, and post-processes it"
argument-hint: "\"<prompt or what the picture must show>\" [--out file] [--res 768]"
disable-model-invocation: true
---

The request is the text the user typed with this command (Claude Code appends
it below as ARGUMENTS; in Codex it is the rest of the message).

`${CLAUDE_PLUGIN_ROOT}` is this plugin's folder. Codex runs this command as a
skill and leaves that variable empty; there, use the folder that holds
`.codex-plugin/`, three levels above this file.

Read `${CLAUDE_PLUGIN_ROOT}/skills/ultimate-frontend-skills/references/image-tells.md`
first (what gives a generated picture away, the prompt template, when to
photograph instead), then `references/image-gen.md` for the pipeline.

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" assets gen "<prompt>" [--out FILE] [--res 768]
```

It detects what this machine can do and says what to do next; follow that
rather than assuming a service or a key. Never invent a key.

Open the image before using it. If it shows the tells, fix the prompt or the
post-processing, or say plainly that a photograph is the better answer. A
generated picture never stands in for a real product, place or person the
page claims to show.
