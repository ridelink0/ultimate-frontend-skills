---
description: Open the live usage panel in a pane beside this chat
---

Run `node "${CLAUDE_PLUGIN_ROOT}/skills/usage-limits/scripts/panel.js" --open`.

It opens a narrow pane to the right of this one (Windows Terminal, tmux,
WezTerm, kitty, zellij or iTerm2) showing the current session, the current
week, and the week for the model in use when the account caps that model on
its own, as live bars in Claude's colours. If this terminal cannot be split it
prints the command to run in a second pane instead; pass that on to me.

Tell me in one line what happened and stop. Do not start other work as part
of this command.
