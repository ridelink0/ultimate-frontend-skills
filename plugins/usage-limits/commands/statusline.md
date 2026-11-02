---
description: Put the usage bars under the prompt (on), take them out (off), or say which it is (status)
---

Run `node "${CLAUDE_PLUGIN_ROOT}/skills/usage-limits/scripts/statusline.js" $ARGUMENTS`.
With no argument it reports the current state.

It edits the `statusLine` entry in `settings.json` in the Claude config
directory (`~/.claude`, or `CLAUDE_CONFIG_DIR`) through a
temporary file, keeps a backup, and `off` restores exactly what was there. A
status line that was already set is kept and printed above ours. The change
applies to new Claude Code sessions, not this one.

Read the output back to me in one or two lines and stop. Do not start other
work as part of this command.
