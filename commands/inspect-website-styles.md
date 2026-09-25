---
description: "Inspect a live website's CSS like the Elements panel - computed fonts, loaded font files, type scale, colours and what it fetched - to learn from a reference site"
argument-hint: "<url> [--selector \"h1,p,a\"] [--width 1440]"
disable-model-invocation: true
---

The request is the text the user typed with this command (Claude Code appends
it below as ARGUMENTS; in Codex it is the rest of the message). It needs a
URL; ask for one if none was given.

`${CLAUDE_PLUGIN_ROOT}` is this plugin's folder. Codex runs this command as a
skill and leaves that variable empty; there, use the folder that holds
`.codex-plugin/`, three levels above this file.

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" inspect <url> [--selector "h1,p,a"] [--width 1440] [--json]
```

This is reference, not defects: it reports what the site sets and loads.
Report the numbers it returned - the face and its axes, sizes, line-height,
tracking, colours, the libraries it fetched - and say which of them are worth
taking. Do not infer a library from how an effect looks; the fetch list is
the evidence. The site's look belongs to its makers: take a measurement, not
the design.
