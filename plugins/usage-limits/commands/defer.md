---
description: Put this work off until a time you name, and start nothing now
---

Do not start the work in this message. Schedule it, confirm in one line, and stop.

Run, from the plugin's skill directory:

```
node skills/usage-limits/scripts/defer.js "$ARGUMENTS" --work "<the work, one item per line>"
```

Where `$ARGUMENTS` is the time the user gave. Accepted forms:

- `9:50pm`, `21:50`, `9pm`, `09:05` - a clock time. A time already past today
  means tomorrow.
- `in 90m`, `in 2h`, `in 45 minutes`
- `reset` - when the binding usage window resets, plus a few minutes for the
  meter to turn over

Pass the work itself in `--work`: the list of things the user asked for, one per
line, written so a session with none of this conversation's context can act on
it. That text is saved to disk and handed to the run when it fires. If the user
gave no list, summarise the pending work from this session instead.

Then print the single line the script returns and **write nothing else**. Do not
start any of the work, do not read files "to prepare", do not draft a plan in
the reply. The whole point of the command is that this turn is cheap and
nothing happens yet.

Other forms:

- `node skills/usage-limits/scripts/defer.js status` - what is deferred and when
  it fires
- `node skills/usage-limits/scripts/defer.js cancel` - call it off

## What actually happens

The work is saved as a continuation and a real scheduled task is registered
(Windows Task Scheduler, or `at`/launchd elsewhere). At the named time the same
wake script the usage relay uses runs, and what it does depends on the relay's
settings (`/usage-limits:relay`). The one-line reply names which of these it
will be:

- `relay mode notify` - the default. It raises a notification with the plan
  ready to pick up and **starts nothing**. With `relay fresh on` the
  notification names the hand-off file to give a new session.
- `relay mode resume` with `relay fresh off` (the default) - it
  resumes **this same conversation** (`claude --resume <session id>`) in a
  window, with Remote Control on, and the first prompt points it at the
  hand-off file. This needs the session id this command ran under; a deferral
  made where none is known has nothing to resume, and the reply says so.
- `relay mode resume` with `relay fresh on` - it starts a **new conversation**:
  `claude` in the original directory, with the whole hand-off (this work, and
  the relay's thinking, voice and bug-check lines) as its first prompt, Remote
  Control on under the name `usage-limits relay <project> (new session)`, and
  the relay's `permission` mode and `model`. It needs no session id. On Windows
  the hand-off goes inline only through the native `claude.exe`; with only the
  npm `claude.cmd` shim, the first prompt points at the hand-off file instead,
  because cmd.exe cuts an argument at its first line break. It does the same
  anywhere when the hand-off is too long for one argument (30,000 characters on
  Windows, 120,000 bytes elsewhere).
- `relay show off` - either kind runs headless (`claude -p`, the prompt on
  stdin) with no window and no Remote Control; its output is kept in
  `relay log --run`.

Either way one terminal: if the original session is still open and working
again when the time comes, the wake stands down and opens nothing. If the
launch fails - a machine whose network is not up yet is the common one - it
retries rather than giving up. Under Codex the thread is resumed whatever
`fresh` says.

If the time is unreadable or ambiguous, the script refuses and says so. It never
picks a reading: a deferral that fires at the wrong hour while nobody is awake
is worse than one that was never set.
