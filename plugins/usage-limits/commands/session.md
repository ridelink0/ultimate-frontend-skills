---
description: Report what this session has cost so far in prompts, turns, tokens and money
---

Run `node "${CLAUDE_PLUGIN_ROOT}/skills/usage-limits/scripts/usage.js" --session last`
and read it back to me in one or two plain lines: prompts, turns (and subagent
turns if any), tokens with the split, the cost, and how large the context is now.

`last` is the most recently active session on this machine, which is normally
this one. If more than one window is open and the project named does not look
like this one, run `--sessions` and pick the right id.

Report the numbers and stop. Do not start other work as part of this command.
