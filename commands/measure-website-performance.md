---
description: "Measure a running website's performance and motion - frame rate while scrolling, real parallax rates, scroll thrash, idle animation libraries and the rendered type scale"
argument-hint: "<site dir or URL> [--record 4000] [--expect-depth]"
disable-model-invocation: true
---

The request is the text the user typed with this command (Claude Code appends
it below as ARGUMENTS; in Codex it is the rest of the message). With no
target, measure the current directory.

`${CLAUDE_PLUGIN_ROOT}` is this plugin's folder. Codex runs this command as a
skill and leaves that variable empty; there, use the folder that holds
`.codex-plugin/`, three levels above this file.

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" quality <dir|url> [--widths 1440] [--record MS] [--travel PX] [--expect-depth]
```

Add `--expect-depth` when the page is meant to have layered parallax; a hero
whose planes all move at one rate is flat, and this is the check that says
so. `${CLAUDE_PLUGIN_ROOT}/skills/ultimate-frontend-skills/references/motion.md`
and `three.md` explain the budgets.

Report the measured numbers as measured, with the machine caveat: a busy
machine lowers frame rate, so re-run a slow result once before calling it a
defect.
