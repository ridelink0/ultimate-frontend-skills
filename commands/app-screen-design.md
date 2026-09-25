---
description: "Design an app screen - mobile, desktop, PWA or Expo React Native - task-first, with navigation, empty, loading and error states, checked against shipped app references"
argument-hint: "<app and screen, or the project folder>"
disable-model-invocation: true
---

The request is the text the user typed with this command (Claude Code appends
it below as ARGUMENTS; in Codex it is the rest of the message).

`${CLAUDE_PLUGIN_ROOT}` is this plugin's folder. Codex runs this command as a
skill and leaves that variable empty; there, use the folder that holds
`.codex-plugin/`, three levels above this file.

Use the `ultimate-frontend-skills` skill and read
`${CLAUDE_PLUGIN_ROOT}/skills/ultimate-frontend-skills/references/apps.md`
first. Then look at three shipped apps that disagree with each other:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" awards --pick app --n 3 --verbose
```

What changes from a website: the first screen is a task, not a hero; decide
the navigation model before the palette; design the empty, loading and error
states before the full one (`references/ui.md` has the states for each
control); platform conventions outrank the house style. When `animate-expo`
or the React Native packs are installed, they own motion.

For a web or PWA screen, render it and open the PNGs:
`node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" look <dir|url> --widths 390,1440`.
A native screen needs a device or simulator; say which one was used, or that
none was.
