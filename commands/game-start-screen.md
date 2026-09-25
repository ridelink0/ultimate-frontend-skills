---
description: "Design or fix a browser game's start screen, menu, HUD or game website so it reads as in-world UI a person made, not an AI-generated template"
argument-hint: "<game folder or what the game is>"
disable-model-invocation: true
---

The request is the text the user typed with this command (Claude Code appends
it below as ARGUMENTS; in Codex it is the rest of the message).

`${CLAUDE_PLUGIN_ROOT}` is this plugin's folder. Codex runs this command as a
skill and leaves that variable empty; there, use the folder that holds
`.codex-plugin/`, three levels above this file.

Use the `ultimate-frontend-skills` skill and read
`${CLAUDE_PLUGIN_ROOT}/skills/ultimate-frontend-skills/references/games.md`
first - the two measured exhibits and the checkable tells. Then look at three
game references that disagree with each other:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" awards --pick game --n 3 --verbose
```

Build to what the synthesis says: the start screen is in-world UI; controls
documented exactly as the code binds them; real persisted numbers (best
score, last run) or none; names for weapons, waves and deaths. The
eyebrow-headline-tagline-two-buttons stack is the tell. Copy rules:
`references/copy-tells.md`.

Check it rendered, at the widths its input model implies:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" look <dir|url> --game
```

`--game` is 1366, 1280 and 1920 for keyboard and mouse; add phone widths only
when the game has touch controls. Open the PNGs and report the paths.
