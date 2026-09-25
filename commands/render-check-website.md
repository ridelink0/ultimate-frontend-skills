---
description: "Render check a website in a real headless browser - screenshots at desktop and mobile widths, text overlap, overflow, contrast, broken images and console errors"
argument-hint: "<site dir, html file or URL> [--widths 1440,390] [--game]"
disable-model-invocation: true
---

The request is the text the user typed with this command (Claude Code appends
it below as ARGUMENTS; in Codex it is the rest of the message). With no
target, check the current directory.

`${CLAUDE_PLUGIN_ROOT}` is this plugin's folder. Codex runs this command as a
skill and leaves that variable empty; there, use the folder that holds
`.codex-plugin/`, three levels above this file.

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" look <dir|file|url> [--widths 1440,390] [--scroll 0,600]
```

For a keyboard-and-mouse game add `--game` (1366, 1280 and 1920 wide); use
phone widths only when the game has touch controls.

Then **open every PNG it writes** and look. Report each overlap, overflow,
contrast failure, broken image and console error with where it is, fix the
ones asked for, and render again. A clean JSON report is not a visual pass;
only the screenshots are.
