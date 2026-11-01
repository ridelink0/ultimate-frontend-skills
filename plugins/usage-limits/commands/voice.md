---
description: Show, set or delete what the plugin has learned about how you write
---

The plugin watches the prompts you type and keeps a small profile of how you
write - message length, punctuation, capitals, openings, contractions. No model
call is involved and nothing leaves the machine: it is counters, plus at most
two short lines of your own text kept as examples.

It exists so that text written on your behalf sounds like you. The one place
that happens today is the relay: when a project is carried across a usage
reset, the prompt that restarts it is written by the plugin, not by you.

Run `node "${CLAUDE_PLUGIN_ROOT}/skills/usage-limits/scripts/voice.js" $ARGUMENTS`
and read the answer back verbatim - especially the kept lines, which are the
only raw text stored.

- (no arguments) - what it knows, how many prompts it has seen, and where the
  file is.
- `card` - the exact text that gets injected when the plugin writes as you.
- `set "<instruction>"` - tell the agent how you want to be talked to. This is
  the other half: it goes in front of every prompt, it wins over anything
  learned, and it is the thing to use for "be blunt", "no preamble", "explain
  like I already know the codebase".
- `clear` - drop that instruction and go back to the learned traits alone.
- `off` / `on` - stop or resume learning. `off` keeps what it has.
- `forget` - delete the profile entirely.

It says nothing until it has seen a dozen prompts, and calls itself provisional
until fifty; short-text style measurements below that are noise, and it should
not pretend otherwise.

Report the answer and stop. Do not start other work as part of this command.
