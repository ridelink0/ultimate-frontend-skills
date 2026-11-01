---
description: Report how much usage limit is left and how many turns of work it buys
---

Run the usage report and read it back to me.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/usage-limits/scripts/usage.js"`.
   Under Codex, add `--host codex`, and add `--refresh` as well if the report
   says the snapshot is old.
2. Tell me which window is binding, how many turns of headroom is left, and
   whether that window resets before the budget runs out. If it reports a
   runway in minutes, lead with that rather than the turn count: a count that
   looks generous can be minutes away when several sessions are sharing the
   budget.
3. If I have already said what I want built, size it against the turns left
   and say whether it fits. If it does not fit, say what to cut rather than
   starting and hoping.

Report the numbers and stop. Do not start other work as part of this command.
