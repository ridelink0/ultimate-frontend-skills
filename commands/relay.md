---
description: Carry the current project across the usage reset - arm, check or cancel the automatic pick-up
---

The relay books a one-shot wake a few minutes after the usage window resets and
hands your continuation back then, instead of the work ending when the budget
does. It is off until you turn it on, and it only ever arms while the session
has an unfinished todo list or an approved plan to carry.

Run `node "${CLAUDE_PLUGIN_ROOT}/skills/usage-limits/scripts/relay.js" $ARGUMENTS`
(add `--host codex` under Codex) and read the answer back.

With no arguments that prints the status: whether it is on, where it arms, what
is armed right now, when it wakes, and what the last relay did.

The rest:

- `on` / `off` - the master switch.
- `at 75` - the percentage of the binding window at which a wake is booked.
  Arming costs nothing and does not change the work, so this is deliberately
  well below the wall.
- `grace 5` - minutes after the reset before the wake fires. The reset time is
  when the window opens; a request one second later has been refused before.
- `mode notify` - raise a notification with the continuation ready to open.
  This is the default and it starts nothing by itself.
- `mode resume` - at the wake, run the CLI itself in a window you can see,
  with Remote Control on, so it is also on claude.ai/code and the phone. What
  it runs is `fresh`'s choice (below). Native user permissions apply. The
  plugin never grants folder trust or chooses an approval mode. Interactive
  runs can ask the user; headless runs deny unanswerable approvals. `show off` makes it a headless `claude -p`
  run instead, the prompt on stdin, with no window and no Remote Control.
- `fresh off` / `fresh on` - which conversation `mode resume` continues in.
  Off, the default: the **same** conversation, `claude --resume <id>`, named
  `usage-limits relay <project>` on Remote Control, and its first prompt points
  at the hand-off file. On: a **new** conversation, `claude` in the project
  directory with the whole hand-off as its first prompt, inline, named
  `usage-limits relay <project> (new session)`, with native user permissions
  and the selected model - for a session that has grown long, so the next window starts
  clean instead of carrying all of it. The old conversation is left as it was.
  On Windows the inline hand-off needs the native `claude.exe`; with only the
  npm `claude.cmd` shim the first prompt points at the file instead, and so it
  does anywhere for a hand-off too long for one argument (30,000 characters on
  Windows, 120,000 bytes elsewhere). Both
  modes keep one terminal: if the old session is open and working again at the
  wake, the wake stands down; if it is open but quiet for three minutes, the
  wake opens its one window anyway. Under `mode notify` neither applies, and
  under Codex the thread is resumed either way.
- `model <id>` - the `--model` a resumed run starts with; `model` alone goes
  back to the default. It is separate from `/model` in the session, so a wake
  pinned to an older model stays on it until this is changed.
- `voice on|off` - carry how you write in the hand-off, so the resumed session
  answers in your voice without being reminded. On by default.
- `bugcheck on|always|off` - the hand-off asks for two bug passes before anything
  is called done; `always` asks on every prompt as well. On by default.
- `thinking off|resume|always` - `resume` puts the word ultrathink into the
  prompt the relay delivers. `always` sets `alwaysThinkingEnabled` in your
  settings, backs the file up first, and applies to new sessions.
- `arm [--session <id>] ["<text>"]` - arm by hand, against the binding
  window's reset, without waiting for the hook to see a todo list. This is the
  way under Codex, which writes no plan tool into its rollouts for the hook to
  read, and for any project that lives in your head rather than a list. Any
  text given is stored as the continuation.
- `note "<text>"` (or `note --file <path>`) - store the continuation. This is
  the text that gets delivered, so write it to be acted on: what is done, what
  is next in order, which files are mid-change, what to verify first.
- `cloud [--session <id>] [--go] ["<text>"]` - the same hand-off, into a
  cloud session now instead of this one after the reset. It prints the exact
  `claude --cloud '...'` command with the hand-off inline (a cloud session
  cannot read a file here), and warns about uncommitted changes and unpushed
  commits, because the cloud session clones from GitHub. On Windows, if the
  `claude` there is a `.cmd`/`.bat` shim, it also warns that cmd.exe cuts the
  hand-off at its first line break, even from PowerShell, and to run it with
  the native `claude.exe`. `--go` starts it,
  detached, and names the log file its output goes to. It runs on the account's
  cloud-session credit when there is one, so starting it is the user's call.
- `cancel` - drop the wake and remove the scheduled task.
- `log` - the last twenty lines of what the relay actually did.

If the user asks for something the relay cannot do, say so rather than
approximating it. In particular it cannot type into a terminal or an editor:
Computer Use refuses to send input to a shell on purpose, and the relay uses it
only to tell whether somebody is at the keyboard.

Report the answer and stop. Do not start other work as part of this command.
