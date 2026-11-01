# usage-limits

Work-fit reports say `fits` only when the complete estimate is covered by all
applicable measured windows. Missing or conflicting measurements, competing
sessions, or an estimate that exceeds the window produce `it may not fit`.
The model is told to assess verification work too and avoid repeated budget
narration. The panel and VS Code view show latest-response Input and Output
with separate cache counters; unknown fields display `?` rather than zero.
Account-scoped readings, refresh backoff and UI caches are invalidated on an
account switch, and late answers from an old login are discarded.

[![npm](https://img.shields.io/npm/v/claude-usage-limits)](https://www.npmjs.com/package/claude-usage-limits)

Most usage tools for Claude Code show **you** the numbers. This one shows them
to **Claude**, before every prompt, and changes what it does about them.

Claude Code already knows how much of your 5-hour and weekly limit is gone. It
caches those numbers locally and will show them if you ask. What it does not do
is notice that the job in front of it is larger than the budget behind it. So
it starts anyway, and stops halfway through an edit.

This puts the budget in front of Claude before your prompt lands, so the reply
opens with the answer instead:

> The weekly window has about 22 turns left. That covers the parser change and
> its tests, but not the migration or the docs pass, so I will do the first two
> and leave the rest for after the reset at 09:00.

Nobody read a chart to get that. The numbers reached the model, not you.

![The usage report: the 5-hour window is binding with about 44 turns left, and at the current pace it runs out 38 minutes before the reset.](docs/img/usage-report.png)

<sub>Real output of `npx claude-usage-limits` on the author's machine, 2026-09-26: the Claude Code windows and the closing verdict, with the Codex and per-model sections left out. The plugin puts the same reading into Claude's context, as the budget line, before every prompt.</sub>

Install it as a Claude Code plugin:

```
/plugin marketplace add ridelink0/claude-code-usage-limits
/plugin install usage-limits@usage-limits
```

Or see the report without installing anything: `npx claude-usage-limits`.
Codex, the plain-skill route and keeping it updated are under
[Install](#install).

## What it runs on your machine, and what it never does

Installing this plugin registers six Claude Code hooks, which means Node runs on
your machine at six moments: `UserPromptSubmit` (the budget line), `PreToolUse`
(the fan-out line, and the refusal when a cap is set), `PostToolUse` and
`SubagentStop` (keeping the reading fresh), and `Stop` and `SessionEnd` (the
session tally). Nothing runs on a timer except a relay wake you armed yourself.

What it reads: your Claude Code transcripts under the config directory, to price
what has been spent; the account snapshot the host already fetched; and your
settings files. What it writes: its own files beside those, every one prefixed
`usage-limits-`, plus the launcher and scheduled task a relay needs while one
is armed.

**It does read your login.** The live reading is the same call Claude Code
makes for `/usage`, and making it needs the same OAuth token, so this plugin
reads it from `.credentials.json` (or, on macOS, the `Claude Code-credentials`
keychain item) and sends it as a bearer token to
`https://api.anthropic.com/api/oauth/usage`. That token is never written to a
file, never logged, and never sent anywhere else: the destination is checked
against an allowlist first - Anthropic over https, or loopback for the tests -
because a project settings file can put anything in a hook's environment and
the override that points at a different endpoint must not become a way to walk
off with your login. Without a live reading the plugin still works, from the
snapshot and your transcripts.

Apart from that one call to Anthropic, nothing leaves the machine: no
telemetry, no upload, no record of your usage kept anywhere else. Everything it
knows sits in files you can open, and `node bin/cli.js mode off` stops it
injecting anything at all.

## Do not want any of this?

    node bin/cli.js mode off              nothing injected, ever - including at the wall
    node bin/cli.js mode off --guard 95   silent, except one short line at 95% used
    node bin/cli.js statusline off        take the bars out from under the prompt

`off` means off: no budget line, no end-of-reply cost, no panel animation. Most
people who want quiet actually want the second form - silence until it matters.
Both apply to new prompts immediately and survive restarts. `mode standard`
turns it back on.

## How this differs from a usage dashboard

There are a lot of good tools that read the same local files this does and draw
you a picture: status lines, menu bar apps, terminal dashboards. They are worth
having, and this is not trying to replace them. The difference is who the
output is for.

| A usage dashboard | This |
| --- | --- |
| Renders numbers for a person to read | Puts numbers in the model's context |
| You notice, then you interrupt | Claude notices, and adjusts on its own |
| Tells you 78 percent is gone | Tells you 22 turns are left, and whether what you asked for fits in them |
| Runs beside Claude Code | Runs inside it, as a skill and a hook |
| Shows what already happened | Says what to do now, and what to drop |

A percentage is a fact about the past. The useful question is whether the thing
you just asked for is going to finish, and answering that needs the request and
the budget in the same place. That place is the model's context, which is where
this puts them.

So: if you want to watch your usage, install a status line. This ships one
too, and a live panel that sits beside the chat, both drawn in Claude Code's
own colours from Claude Code's own numbers. If you want the thing spending the
budget to know it is spending the budget, that is what this is for.

## What it prints

```
Claude Code usage

  Plan       Claude Pro
  Snapshot   3m old
  Settings   model=opus  effort=xhigh
  Overage    off, work stops at the limit

  Window           Used   Resets in      Left  Turns left
  5-hour            62%      1h 40m    $46.00         ~88   <- binding
  weekly            75%       2d 4h      $124        ~240

  Recent pace   15 turns in the last hour, $0.164 per turn, effort xhigh
  Measured      1,284 turns of local transcript

The 5-hour limit is the binding one. At the current pace it runs out in about
1h 12m, which is 28m short of the reset. Size the work to fit, or slow the burn.
```

`Turns left` is the column that matters. It divides the remaining headroom by
what a turn has actually been costing over the last hour, on your account, at
your effort level, so it moves when your working style does. Fifteen turns of
headroom means something you can plan against; 75 percent does not.

It also breaks the window down by model, with the token split behind it:

```
  Models in the 5-hour window
    Model                   Turns    Tokens   Output   Share
    claude-opus-5             159     27.0M     212k    100%
    Tokens  input 318, cache write 631k, cache read 26.2M, output 212k
```

When more than one project has run inside the window it breaks that down too,
so you can see which working directory actually spent the week:

```
  Projects in the weekly window
    Project                 Turns    Tokens   Share
    ...ideLink-Stuff-app      930     45.2M     78%
    C--Users-OWNER            240     12.1M     22%
```

That split is usually the surprise. Almost all of it is cache reads, billed at
a tenth of the input rate but paid again on every turn, which is why context
length matters more than any single expensive message.

The percentages and reset times come from Claude Code's own cache. The pace
comes from your local session transcripts. Neither requires a network call.

## Install

Nothing to install, if you just want the numbers:

```
npx claude-usage-limits
npx claude-usage-limits --status
npx claude-usage-limits lowpower on
```

That runs the same code as the plugin, from
[claude-usage-limits](https://www.npmjs.com/package/claude-usage-limits) on
npm. Node 18 or newer.

To have Claude read the numbers and plan against them, install it properly.

As a plugin:

```
/plugin marketplace add ridelink0/claude-code-usage-limits
/plugin install usage-limits@usage-limits
```

As a plain skill, if you would rather not use the plugin system:

```
git clone https://github.com/ridelink0/claude-code-usage-limits
cp -r claude-code-usage-limits/skills/usage-limits ~/.claude/skills/usage-limits
```

On Windows, in PowerShell:

```
git clone https://github.com/ridelink0/claude-code-usage-limits
Copy-Item -Recurse claude-code-usage-limits\skills\usage-limits "$env:USERPROFILE\.claude\skills\usage-limits"
```

One difference between the two: the hook that puts the budget line in front of
every prompt is declared in the plugin manifest, so it only runs on a plugin
install. If you took the plain skill and want that behaviour, add it yourself
in `~/.claude/settings.json`, pointing at wherever you put the skill:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/skills/usage-limits/scripts/brief.js\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

Either way, ask something like "how much usage do I have left" or "can we
finish this before the limit hits" and Claude will load it. Installed as a
plugin it also gives you `/usage-limits:check`, which prints the report and
sizes whatever you just asked for against it.

The scripts also run on their own, with or without any of the above:

```
node skills/usage-limits/scripts/usage.js
node skills/usage-limits/scripts/usage.js --json
```

### Keeping it up to date

Claude Code can update this for you, but **it will not by default**. Auto-update
is a per-*marketplace* switch, and it defaults to on only for claude.ai-hosted
marketplaces and a hard-coded list of official Anthropic ones. Every
third-party GitHub marketplace, this one included, defaults to off.

Turn it on once, either through `/plugin` → Marketplaces → usage-limits, or by
adding one key to `~/.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "usage-limits": {
      "source": { "source": "github", "repo": "ridelink0/claude-code-usage-limits" },
      "autoUpdate": true
    }
  }
}
```

Claude Code then refreshes the marketplace and updates the plugin in the
background shortly after a session starts (with a random delay of up to ten
minutes, so a running session keeps the version it launched with), and offers
`/reload-plugins` when something changed. To update on the spot instead:

```
claude plugin update usage-limits
```

Note that the whole pass is skipped when Claude Code's own auto-updater is
disabled, unless `FORCE_AUTOUPDATE_PLUGINS` is set.

**Cloud and web sessions** never see `~/.claude`, so nothing installed on a
laptop reaches them. Commit the same block to a repository's
`.claude/settings.json`, alongside `enabledPlugins`, and any session opened on
that repository installs the plugin at session start — always at the newest
commit. This repository carries exactly that file if you want one to copy.

The other two channels update themselves the ordinary way: the VS Code
extension through the Marketplace, and the npm package on the next `npx
claude-usage-limits` (a global install pins, so `npm i -g claude-usage-limits@latest`
to move it).

## When another Claude is working too

Two Claude Code windows share one limit, so headroom measured in turns is
optimistic while another session is also spending. It watches for that:

```
  Sharing       2 sessions have spent in the last 15m, splitting this budget 75% / 25%
                The turns above are the whole window, not your slice of it.
```

and the before-prompt line says how many of those turns are actually yours:

```
about 38 turns of headroom (2 sessions active, roughly 10 of them yours)
```

The split comes from measured spend rather than an assumption that everyone is
working equally hard, because they usually are not. A session that has gone
quiet for a quarter of an hour is not counted as competing.

Every session's spend also feeds the reading itself, not just the split. The
percentage is corrected using all spend recorded since the snapshot was taken,
whichever window produced it, so another Claude burning budget in the next
terminal moves your number too.

## Which limit it watches

Two windows run at once and the 5-hour one is usually what actually stops you,
so it gets picked whenever it is tighter, and it wins a tie against the weekly
window because the shorter window is the one hit first in practice.

It is not forced, though. When the weekly window is genuinely the wall, at 99
percent with minutes left, that is what gets reported. Forcing the 5-hour there
would hide the limit about to stop the work, which is the same failure as
ignoring it.

A window with no recent spend to measure is ranked by how full it is rather
than being skipped, so a 5-hour window sitting at 95 percent is never passed
over just because nothing has gone through it in the last few minutes.

Binding is about what stops you soonest, though, not what stopping costs, and
those are different: a 5-hour window returns in hours, the weekly one in days.
So a window above 85 percent gets called out even when something shorter binds,
with its own reset time, because spending the weekly window to save a few turns
of the 5-hour one is a bad trade.

## When you keep typing

Every message sent while work is already running starts another turn, and each
turn re-sends the whole conversation. Three follow-ups during one task can cost
more than the task did.

So when several additions arrive mid-task and the binding window is tight,
Claude says so once and keeps working:

> I have got all three. While the weekly window is this tight, sending them
> together costs a good deal less than one at a time, so I will fold these in
> and carry on.

It asks once, never repeatedly, and only when the budget is actually tight.
Asking someone to hold their thoughts when there is room to spare is rude for
no gain.

The important exclusion: it never discourages a correction, a stop, or a bug
report. Those are the messages that save the most work, and a rule that trains
people out of interrupting to say "that is wrong" costs far more than the turns
it saves. Only additive scope is worth batching.

## Credits, and what happens at the wall

The report says which of two things happens when the plan allowance runs out,
because they need opposite handling.

If paid credits are off, work stops dead and there is no buying through it,
so the report says so and plans around it. If they are on, the limit is a cost
boundary instead of a wall. It deliberately does not warn you about that
crossover, because Claude Code already announces it and asks before drawing on
credits, and a second warning saying the same thing is just noise.

When the binding window will run out before it resets, the report stops
describing and starts instructing:

```
The 5-hour limit is the binding one. At the current pace it runs out in about
20m, which is 3h 40m short of the reset. Size the work to fit, or slow the burn.
  Work stops when it does. Nothing carries on into paid credits.
  Land what exists, write the handoff, and resume after 03:00.
```

The clock time matters more than the countdown. "Resume after 03:00" is a
plan; "4h 12m" is a number you still have to do arithmetic on.

**The cloud-session credit is a third case.** Claude Code can offer a dollar
credit for cloud sessions (claude.ai/code), on top of the plan, and names it at
the wall itself: "While you wait, start a new cloud session with a $250
credit". It is not usage credits - the account this was built on has those off
at the org level and has this - and a cloud session on it was seen still
working with its 5-hour window "rejected". When the account carries the offer
the report says so on a `Cloud credit` line, with the amount read from the
offer, and at the wall adds the way on:

```
  Work stops when it does. Nothing carries on into paid credits.
  To carry on now instead of waiting, start a cloud session on the $250
  cloud-session credit: relay cloud hands it this work as claude --cloud.
  Land what exists, write the handoff, and resume after 03:00.
```

`relay cloud` builds the hand-off the wake would deliver and prints the
`claude --cloud` command with it inline; the cloud session clones from GitHub,
so it warns about anything not pushed. On Windows it also warns when the
`claude` on PATH is a `.cmd` shim, because cmd.exe cuts the hand-off at its
first line break even when the command is pasted into PowerShell. Inside a cloud session the report does
not ask for `/usage` - the container keeps no snapshot - and says what the
session has cost so far at list prices instead. What is left of the credit is
not readable anywhere, so it is never claimed.

The skill also requires Claude to say up front when a job will not fit in what
is left, name what it is doing now, what it is leaving, and when the rest can
happen, rather than starting and stopping halfway through an edit.

## /low-priority, and Claude Code's own features at the wall

Claude Code has grown its own machinery for the moment the 5-hour limit is hit.
Some of it a hook can read and some of it cannot, and the whole of this
section is about keeping that line straight — a plugin that guesses at the half
it cannot see is worse at this than one that says nothing.

**`/low-priority`** is a hidden toggle the CLI offers when the session (5-hour)
limit is reached. It keeps the session working at reduced priority and spends
your **weekly** limit, plus a separate weekly lower-priority allowance. Replies
can pause while it waits for spare capacity. It appears in no changelog and in
no documentation — there are zero mentions across all 405 versions of the
bundled changelog back to 0.2.21 — and it is declared `isHidden: true`, so the
only way anyone learns of it is the offer line at the wall.

What the plugin can read is whether **your account is provisioned** for it, from
one field in the same `~/.claude.json` it already parses for the meter:
`cachedGrowthBookFeatures.tengu_toasty_breeze`. That costs no extra I/O, and it
is re-read on every prompt rather than remembered, because the grant can be
withdrawn mid-week.

What the plugin **cannot** read is whether it is on right now. That state lives
in the CLI's process memory and is written to no file — not `~/.claude.json`,
not `~/.claude/state`, and no hook payload or status-line field carries it. So
there are three states and never a fourth:

| state | how it is known |
| --- | --- |
| **absent** | the account is not provisioned, and the plugin never mentions the command |
| **offered** | provisioned, so the brief says it exists at the wall — as a possibility |
| **acknowledged** | **you** said you switched it on: `mode --low-priority on` |

Two further gates sit in front of the offer that nothing here will ever see: the
experiment arm arrives in a response header, and the CLI withholds the offer
during a cooloff and once the weekly allowance is spent. So the brief says "if
the wall offers it", never "you can run it". And it never says the plugin or the
model can switch it on: Claude cannot type a slash command, and the command is
declared `supportsNonInteractive: false`, so it is unusable in a headless or
relayed run either.

At the wall with weekly headroom, the line looks like this:

```
If the wall offers it, /low-priority can carry this session past the 5-hour
limit at lower priority instead of stopping: it spends the weekly limit, which
is at 45% and so has room, and replies may pause while it waits for spare
capacity - the wait and its ceiling are set by the server per request. It is a
toggle only the user can type, and type again to stop: you cannot run a slash
command, and nothing here can switch it on.
```

**The recommendation has a number behind it.** It is offered only while the
weekly is at or below **80 per cent** and the 5-hour window is the binding wall.
Above that the brief actively says not to, and cites the figure: low-priority
spends the weekly *and* draws on a weekly allowance whose size is exposed to no
hook and no file, and one user has reported it burning through almost a week of
usage in a couple of hours (anthropics/claude-code#92544). No wait time is ever printed, because the retry and the ceiling
come from `lowPriorityRetryAfterSeconds` and `lowPriorityMaxWaitSeconds` on each
response — any fixed "20 seconds, 20 minutes" would be invented.

Once you acknowledge it, three things change. The brief brakes on the **weekly**
window instead of the 5-hour one, because that is the only brake left. It stops
telling you to wind down at the 5-hour wall. And the relay **will not book a
wake for the 5-hour reset** — this session carries straight past it, so a wake
would fire into a session that never stopped. A weekly wall still arms. The
acknowledgement lapses by itself when the 5-hour window it was made against
resets.

A deferral is different from a wake, and is treated differently. `defer` is a
time **you** named, so it is always scheduled — but if you defer to `reset` while
low-priority is acknowledged, the confirmation says that this session carries
past the 5-hour reset and waiting for it buys nothing. The mid-turn pulse follows
the brief onto the weekly too, out of the same function, so the two can never
report different windows.

**The graceful wrap-up note.** Claude Code can inject its own "finish up"
instruction at the wall. The mechanism is real, and the gate is
`tengu_lantern_wick_mode` — the bundle's own normalizer keeps only `"wrap-up"`
and `"next-steps"` and maps everything else to `"off"`. When it is on, this
plugin stands down and says who is speaking, because two agents telling the
model to wind down in different words is worse than one. When it is off, the
plugin's own instruction stands. It is read, not assumed, so the right thing
happens whichever way the flag is set. (The near-limit variant is a separate
flag, `tengu_vellum_anchor`.)

**`autoContinueAtUsageLimit`.** Since 2.1.234 Claude Code waits out the reset
and continues the same open session by itself, and the setting is **on by
default**. In place, with the context intact, that is better than any scheduled
wake. So when a resume relay is armed and this is on, the brief says so: the
wake is the route for a session that will be **closed** at the reset, and both
firing for the same reset would start the work twice and spend the weekly twice.

**`/limit-reset`** is one command behind two different server flags, and the
brief words each in its own copy's terms. `tengu_nifty_lemur` is the
once-a-week reset of the 5-hour session limit ("uses weekly limit · 1/week",
"your weekly limit still applies"); `tengu_cedar_ember` is a counted grant with
a use-by date that "refills your limits". The account this was built on carries
`tengu_nifty_lemur` enabled and no `tengu_cedar_ember`. When the budget is tight
and the 5-hour window is the wall, the brief names the weekly reset, says the
work it unlocks still counts toward the weekly, and says only the user can type
it; at a weekly wall it says nothing, because resetting the 5-hour limit cannot
help there. It never reports whether this week's reset is used or how many
grants are left — both come from a live endpoint and appear in no file a hook
can read. A flag counts only when it is a plain object with `enabled: true`,
the way the CLI reads it.

**Grace is not weekly spend.** The allowance the wall gives you is metered in
its own per-window meters (`anthropic-ratelimit-unified-grace-5h-utilization`
and `-grace-7d-utilization`, with a `rateLimitGraceZone` naming which window it
belongs to), not billed to the 7-day window. Its size arrives in response
headers and appears in no hook payload, no status-line field and no file, so the
plugin says nothing about how much of it is left rather than estimating.

## The relay: carrying a project across the reset

The handoff has always had the same flaw. It gets written, and then it sits in
a closed terminal until somebody comes back and reads it. Everything the
session knew — the files it had open, the half-made decision, the reason the
second approach was abandoned — expires with the window.

The relay closes that gap. Once the binding window passes a threshold you set,
**and** the session has an unfinished todo list or an approved plan to carry,
it books a one-shot wake for a few minutes after the reset. Arming costs
nothing and changes nothing about the work in progress; that is the point,
because nobody should slow down to prepare for a wall. Then, at the wake, it
re-checks the meter and hands your continuation back.

```
/usage-limits:relay on
/usage-limits:relay mode resume
/usage-limits:relay permission acceptEdits
```

With `mode resume` the wake resumes the same conversation (`claude --resume`).
`relay fresh on` makes it start a new one instead: `claude` in the project
with the whole hand-off as its first prompt, Remote Control on as
`usage-limits relay <project> (new session)`, and the relay's permission mode -
so a session that has grown long hands its work on rather than carrying all of
it into the next window. It is off by default, `/usage-limits:defer` fires
through the same wake, and in both modes the wake stands down if the old
session is still open and working again.

What changes while it is armed is what Claude is told at the wall. Instead of
"write the handoff and stop", the budget line says the relay has it, that being
cut off now costs the wait rather than the work, and that the continuation is a
prompt to be acted on rather than a summary for a person to read.

**A session that started before an update keeps the old code.** A plugin
update applies when Claude Code restarts, so two sessions can run two versions
at once; on 2026-09-20 a session still on 1.34.1 saw the single relay slot that
version had, took it for occupied, scheduled its own wake by hand, and that
wake failed the way 1.34.1's always did, while the session on 1.36.0 resumed
fine. Nothing can upgrade a running session, so since 1.38.0 the budget line
says so once: the installed version, the running one, and that a relay or cap
set in that session follows the older rules until it restarts.

**Startup permissions stay with the user.** Arming and waking never grant
folder trust, accept bypass warnings, or select a permission mode. `relay
preflight [cwd]` is read-only and reports any trust prompt the user must answer
in Claude Code. Legacy relay permission modes are ignored. Interactive runs
retain native prompts; headless runs deny approvals nobody can answer. Existing
user settings are left untouched. The relay used to hold one slot, so a second
session arming on the same night was refused or displaced the first. Each session now has its own record and its own scheduled
task; status lists them all, relay cancel takes down this session's, and
relay cancel --all takes down every one.

**1.37.0 fixed the arm that failed twice on 2026-09-20.** `relay arm` reported
`Value for '/TR' option cannot be more than 261 character(s)` - schtasks refusing
the task action, which carried node's path, the plugin cache path, the session
id and the config directory: 326 characters. That was only the fallback. The
primary ScheduledTasks route had already been killed at a fixed eight-second
ceiling while PowerShell was still loading the module (32 seconds on that
machine), and a timeout has no stderr, so nothing reported it. The task now
runs a small launcher in the config directory (`relay-task-<id>.cmd`) so the
action has one fixed length whatever the plugin path; the PowerShell route
gets a minute from the command line and the hook's own deadline from a hook;
and a failure names both routes side by side. `relay doctor` also reports
whether a login is there to resume under. When that login expires is not
checked: `claude auth status` does not report it and the relay does not read
`.credentials.json`, so renew `/login` before a relay that fires hours later.

Smaller changes in the same release: the budget line names both account
readings when Claude Code's cache and the plugin's live reading differ by more
than five points (`5-hour 20% (the live reading; Claude Code's cache says
14%)`) rather than showing one number that jumps; its standing instruction is
said in full once per session and as twelve words after that
(`USAGE_LIMITS_BRIEF_FULL=1` keeps the full form); one clause is added on the
prompt right after a prompt-cache miss the user caused - a changed tool list
or system prompt, read from the status line's `prompt_cache` - and nothing
otherwise; the mid-turn pulse's tight sentence is throttled to the same ten
minutes as its fan-out advice; a subagent message written as several content
blocks is priced by its last block, which carries the real output count
(measured on 179 agent transcripts: 1,991 of 2,504 such messages ran like
1, 1, 202); and the headless resume runs with `DISABLE_AUTOUPDATER=1`.

| | |
| --- | --- |
| **Off by default** | Scheduling an agent to run while nobody is watching is a decision you make on purpose, not one a plugin makes for you. |
| **Only with work to carry** | It reads the session's own todo list and approved plan out of the transcript. An idle chat is not a project and never arms. |
| **`notify` by default** | It raises a notification with the continuation ready to open, and starts nothing. `mode resume` is the opt-in that runs the CLI itself. |
| **It re-checks the meter** | The reset time is a prediction; the meter is the fact. If the window has not actually turned over it books another wake rather than spending the first minute of a fresh window on a refusal. |
| **It survives sleep** | Registered through the ScheduledTasks module with `StartWhenAvailable` and `WakeToRun`, so a machine asleep at the moment fires on wake instead of missing it silently. |
| **It cleans up after itself** | The task carries an expiry, and the wake unregisters it once the outcome is recorded. |
| **Codex too** | `codex queue --thread` puts the continuation into a live session; `codex exec resume` revives a dead one. |

Two honest limits:

- **It cannot type into your terminal.** If Computer Use is installed the relay
  uses it to tell whether you are at the keyboard — and if you are, it leaves a
  notification instead of starting a second agent in the directory you are
  working in. It does not send keystrokes to a shell or an editor, because that
  plugin refuses to on purpose and routing around a safety rule because it is
  inconvenient is how safety rules stop meaning anything.
- **Claude Code's own `autoContinueAtUsageLimit` is better where it applies.**
  It waits inside the open session, so the process never dies and no context is
  reconstructed. It is documented not to offer the wait for `-p` runs or
  background sessions, and it cannot help a terminal that has been closed or a
  machine that slept — and it sends a fixed prompt of its own rather than the
  plan your session actually wrote. That is the gap this fills.

`/usage-limits:relay` on its own reports where it stands: whether it is on,
what is armed, when it wakes, what is available on this machine, and what the
last relay actually did.

## Voice: so the prompt it writes sounds like you

The prompt that restarts your work is written by the plugin, not by you. A
prompt that reads like a form letter gets a reply that reads like a form
letter, so the plugin keeps a small profile of how you write and uses it there.

It is counters — message length, how often you start lowercase, whether you end
with a full stop, dropped apostrophes, capitals for emphasis, how you open —
plus at most two short lines of your own text kept as examples. No model call
is involved, nothing leaves the machine, and it says nothing at all until it
has seen a dozen prompts, because style measured on less than that is noise.

```
/usage-limits:voice                       what it knows, including the kept lines
/usage-limits:voice set "blunt, no preamble"
/usage-limits:voice forget                deletes it outright
```

`set` is the other half, and the more useful one: it is not what the plugin
learned about you, it is you saying how you want to be talked to. It goes in
front of every prompt and it wins over anything learned.

One deliberate omission: misspellings. They are the most individual thing in
anyone's writing and the worst thing to put in a prompt — told that somebody
makes mistakes, a model makes mistakes everywhere. Only patterns that are
choices are recorded, and the card says outright not to introduce errors.

## Releasing

```
npm version patch
git push --follow-tags
```

Pushing the tag runs the tests and publishes to npm. That goes through npm's
trusted publishing over OIDC, so there is no publish token stored in the repo
or in CI. `npm version` also syncs the version in the plugin manifest, so the
marketplace and the npm package never disagree about which release is current.

## Right next to the chat

```
npx claude-usage-limits panel --open
```

That opens a narrow pane to the right of the one Claude Code is running in
(Windows Terminal, tmux, WezTerm, kitty, zellij and iTerm2 are all understood)
and draws the limits in it, live:

```
✻ Claude usage
Fable 5.1 · xhigh · working

Current session
███████░░░░░░░░░░░░░░░░░░░░░ 24%
resets in 4h 12m at 6:40 PM

Current week (all models)
█░░░░░░░░░░░░░░░░░░░░░░░░░░░ 4%
resets in 1d 5h at Sun 7:00 PM

Current week (Fable)
█░░░░░░░░░░░░░░░░░░░░░░░░░░░ 3%
resets in 1d 5h at Sun 7:00 PM

Sessions · 1 working, 1 idle
✳ Fable 5.1  usage-limits  working
· Opus 5  ridelink  idle 4m ago

live, updated 12s ago
q quit · r refresh
```

Four things about it are deliberate.

**It is drawn the way Claude Code draws things.** The colours are Claude
Code's own theme, read out of the CLI rather than approximated: the bar is the
one `/usage` paints, the title is the Claude orange, the spinner is Claude's
spinner with Claude's frames. A bar turns yellow at 80 percent and red at 90,
each window judged on its own. While Claude is working the title shimmers and
the spinner turns; while it waits, they stop. Under ultracode both go rainbow,
which is what Claude Code does with its max effort tag.

**The numbers are the ones Claude Code uses.** Every reading is the same GET
that `/usage` makes, with the login Claude Code already holds, plus the
rate-limit headers on Claude's own API responses whenever the status line
below is installed. Whichever is newer wins, and the footer says how old it
is. The week for one model (the Fable line above) only appears while that
model is the one running, because it cannot stop work on any other; when the
model cannot be told at all, nothing is hidden on a guess. The
reading is kept in `usage-limits-live.json`, and the report, the hooks and the
status line all prefer it whenever it is newer than Claude Code's own cache,
which can sit hours behind.

**It keeps drawing when things go wrong.** Offline, it shows the last reading
and says how old it is, and tries again at a widening interval. Signed out, it
says so in red and keeps checking, because Claude Code refreshes the login on
its own next call. Told to slow down by the endpoint, it waits exactly as long
as it was told. Too narrow a pane loses the breathing room, then the footer,
never the bars. Nothing in it refreshes or rotates the token, and the token is
never written anywhere by this plugin.

**It knows about the other Claudes.** Two windows share one limit, so the
panel lists every session this machine has heard from in the last quarter of
an hour: what it runs, where, and whether it is working right now, each with
its own spinner. The hooks are what say so (a prompt marks a session working,
every tool call keeps it so, the Stop hook marks it idle), so the list is live
without anyone polling anything. The status line adds `+1 working` when
another session is spending.

Under the bars it says when the binding window runs out at the pace of the
last hour, measured from every session's spend, whenever that comes before
the reset: `at this pace the 5-hour window runs out in 25m, about 12 turns`,
yellow inside half an hour and red inside ten minutes. The pane rings the
terminal bell once when a window turns yellow and once more when it turns red.

`panel` alone runs it in the current pane, `--once` prints one frame, `--json`
prints the fields, `--no-fetch` (or `USAGE_LIMITS_FETCH=off`) keeps it
entirely offline on the reading already on disk, and `--poll N` sets the
seconds between readings (30 while Claude works and 120 while it waits
otherwise). Installed as a plugin, `/usage-limits:panel` opens it from inside
the chat.

Not on the desktop app or claude.ai, which show the limits themselves. This is
for the terminal and the VS Code extension, where the only way to see them is
to ask with `/usage`.

## Status line

The same bars, one line under the prompt:

```
✻ Fable 5.1 · xhigh  session ████░░░░░░ 42%  week █░░░░░░░░░ 7%  fable █░░░░░░░░░ 3%  +1 working
```

```
npx claude-usage-limits statusline on
npx claude-usage-limits statusline off
```

`on` points Claude Code's `statusLine` setting at a small launcher in the
config directory that finds wherever the plugin is currently installed, so a
plugin update does not leave the status line pointing at a folder that has
gone. A status line that was already there is kept and printed above ours;
`--no-chain` replaces it instead, and `off` restores exactly what was there,
including nothing. `--refresh N` re-runs it every N seconds as well as on every
change, which keeps the spinner turning between responses at the cost of a
Node process every N seconds. The change applies to new sessions.

The line is also where the panel learns what Claude is doing. Claude Code
hands the status line the model in use, the effort level, and the rate limits
from its own response headers, and the line records them for the panel, which
never sees that JSON. It reads no transcripts and makes no network calls, so it
costs about a tenth of a second on every redraw. It shrinks to fit narrow
windows, honours `NO_COLOR` and Claude Code's `prefersReducedMotion`, and
prints nothing rather than an error if anything goes wrong.

The older one-line form is still there as `usage.js --status`, which prints
`5h 62% 1h 40m  wk 75% 2d 4h` and prefixes `LOW` past 90 percent.

## It tells you where you stand, every time

Installed as a plugin, a hook measures the budget before each prompt and puts
one line into Claude's context:

```
[usage-limits] binding window is 5-hour 47% used, about 75 turns of headroom,
resets in 3h 52m. Other windows: weekly 16%. This session: 229 turns, 14.2M tokens, $64.16.
```

It names the window that will stop the work first and hangs the figures off
that one. Two windows run at once and they are rarely in the same place, so
"weekly 16%" sitting next to "75 turns" would read as far more room than
exists.

Claude opens with it. When there is room that is a single line and it moves on:

> The 5-hour window is the binding one: 47% used, about 75 turns of headroom.
> This fits easily.

When there is not, the line becomes a plan rather than a status:

> The weekly window has about 22 turns left. That covers the parser change and
> its tests, but not the migration or the docs pass, so I will do the first two
> and leave the rest for after the reset at 09:00.

The wording changes with the pressure, not only the numbers. The trigger worth
explaining is pace: two days into a week you should be near 29 percent spent, so
60 percent means you will not last the week, and that is worth hearing at 60
rather than at 85.

The percentages behind the line are kept fresh too. If the reading on disk is
older than three minutes when a prompt goes in, the hook first takes the same
reading Claude Code takes for `/usage`, and the mid-turn pulse does the same
every two minutes through a long turn. That is what stops a burst of parallel
agents from emptying a window between two readings: eight of them once spent
half a window in five minutes while the line, seventeen minutes old, still
said 42 percent. Offline that is one quick failure and then a widening
backoff, never a wait on every prompt.

One limit worth knowing: the hook fires when a prompt is submitted, so a
message sent while Claude is already working does not refresh it. Claude Code
delivers those into the running turn without re-running hooks, which no plugin
can intercept. The skill handles it by telling Claude the figures age during a
turn, and to re-read them before claiming a job fits rather than trusting a
number from several tool calls ago.

It has to be cheap, because it runs on every prompt. The percentages come from
one small file. The transcript scan behind "turns of headroom" is cached for a
minute, so it costs about 400ms cold and 120ms warm.

| Variable | Default | Effect |
| --- | --- | --- |
| `USAGE_LIMITS_BRIEF` | on | Set to `off` to turn the before-prompt line off entirely. |
| `USAGE_LIMITS_BRIEF_FULL` | off | Set to `1` to say the line's standing instruction in full on every prompt. By default it is said in full once per session and as twelve words after that. |
| `USAGE_LIMITS_NEAR` | 90 | Percent used at which the budget counts as tight. Nothing below it is discouraged. |
| `USAGE_LIMITS_FEW_TURNS` | 10 | Turns of headroom at or below which the budget counts as tight. |
| `USAGE_LIMITS_RUNWAY` | 10 | Minutes of runway at the current pace below which the budget counts as tight. |
| `USAGE_LIMITS_CACHE` | 60 | Seconds the measured half stays good for. |
| `USAGE_LIMITS_FLOOR`, `USAGE_LIMITS_AHEAD` | 40, 15 | Only feed the reported pace figure; they no longer change the wording. |
| `USAGE_LIMITS_PULSE` | on | `off` silences the mid-turn line; `always` prints it even when there is room. |
| `USAGE_LIMITS_PULSE_SECONDS` | 120 | How often the mid-turn line can fire. |
| `USAGE_LIMITS_TALLY` | on | Set to `off` to turn off the after-reply tally, the closing line and the session history. |
| `USAGE_LIMITS_FETCH` | on | `off` keeps the panel and the hooks off the network; they show the reading already on disk. |
| `USAGE_LIMITS_REFRESH` | 180 | Seconds a reading may age before the before-prompt hook takes a fresh one. The mid-turn pulse uses its own interval. |
| `USAGE_LIMITS_POLL` | 30 / 120 | Seconds between the panel's readings, working / idle. Never under 15. |
| `USAGE_LIMITS_MOTION` | on | `off` stops the spinner, the shimmer and the rainbow. Claude Code's `prefersReducedMotion` setting does the same. |
| `USAGE_LIMITS_STATUSLINE` | on | `off` blanks the status line while still recording the feed the panel reads. |
| `USAGE_LIMITS_CLOCK` | from settings | `12h` or `24h` for reset times; otherwise follows Claude Code's `timeFormat`. |
| `USAGE_LIMITS_COLOUR` | detected | `256` or `none` to override colour detection. `NO_COLOR` and `FORCE_COLOR` are honoured. |
| `USAGE_LIMITS_ASCII` | off | `1` draws the bars and the spinner with plain characters. |
| `USAGE_LIMITS_BELL` | on | `off` silences the panel's terminal bell when a window turns yellow or red (`--no-bell` does the same). |

## What a session cost

The other half of the question. After every reply, a `Stop` hook shows you one
line with what that reply cost and what the session has cost so far, tokens
first because that is what people ask:

```
[usage-limits] this reply: 6 turns, 210k tokens, $0.95. This session: 9 prompts,
48 turns, 3.1M tokens (2.9M cache read, 61k output), about $12.40, roughly 31
points of the 5-hour window. Context is now about 130k tokens.
```

It goes to you, not into the context, so it costs the model nothing. It reads
only the bytes of the transcript written since the previous reply, including
any subagent transcripts under the session's own folder, so it takes a few
milliseconds however long the session has run. When the session closes, a
`SessionEnd` hook prints the closing line:

```
[usage-limits] session closed after 1h 42m: 9 prompts, 48 turns, 3.1M tokens, about $12.40.
```

Claude is also asked to end finished work with the total in its own words, one
plain line, and to skip it on partial progress. The before-prompt line carries
the session's tokens, what the last reply cost, and how large the context has
become, with one clause of advice once it passes 150k tokens, because the
context is re-sent on every call and past a point it is the cost of the session.

The history is kept in `usage-limits-sessions.json` beside the other caches:

```
node skills/usage-limits/scripts/usage.js --sessions
node skills/usage-limits/scripts/usage.js --session last
```

```
  Id        When        Project                 Prompts    Turns   Tokens     Cost
  4940f126  9m ago      C--Users-OWNER                1       16     2.8M   $11.36  open
  380e664a  9m ago      C--Users-OWNER               10   112+35    51.0M   $93.11  open
```

`--session last` (or an id, or a unique prefix of one) shows one session in
full: the token split, the model mix, the subagent calls and the context size.
Installed as a plugin, `/usage-limits:session` reads the same thing back.
Turns are main-thread calls; `+N` is what subagents made on top. Set
`USAGE_LIMITS_TALLY=off` to turn all of this off.

If you installed the plain skill rather than the plugin, add the two hooks
beside the first one in `settings.json`: `Stop` running `scripts/stop.js` and
`SessionEnd` running `scripts/sessionend.js`.


## What would this job cost

```
node skills/usage-limits/scripts/usage.js --forecast 15
```

```
Forecast for 15 turns

  Window                 Would cost    Leaves   Verdict
  5-hour               7.4% to 8.4%       45%   fits
  weekly               0.8% to 0.9%       83%   fits

  Priced from 64 recent turns: $0.296 typical, $0.333 at the expensive end.

  There is room for this. No need to work around the limit.
```

It prices turns at what turns have really cost on your account, and gives a
range rather than one number, because a turn that reads three files costs many
times one that answers from context. The upper end is the honest one for a long
run, since turns get dearer as the context grows.


## Which effort and model should this run at

```
node skills/usage-limits/scripts/usage.js --recommend        # against the headroom
node skills/usage-limits/scripts/usage.js --recommend 15     # against a 15 turn job
```

```
Recommendation for 15 turns

  Posture   tight - a 15 turn job fits, but only just (5-hour window, 12% left, resets in 1h 40m)
  Effort    xhigh -> medium; one notch covers the mechanical stretches; keep judgement calls at full effort
            this session: /effort medium   (only the user can run it)
            new sessions: node scripts/lowpower.js on --effort medium
  Model     keep opus for the judgement; the saving is in where the mechanical bulk runs
            dispatch self-contained mechanical work to a subagent on sonnet at low effort, and keep the judgement here
```

It weighs the binding window, the measured cost of a turn, and how much of the
output is actually reasoning, then names a posture - roomy, tight, critical, or
reset-first - and the exact commands. When there is room it says to keep
everything as it is, out loud, because turning effort down when the budget is
not tight buys nothing and costs quality. When reasoning is only a sliver of
the output it says so too, and leaves effort alone: the reasoning share is the
ceiling on what lowering effort can save. `--json` returns the decision as an
object.

The three levers it recommends across belong to different hands. The running
session's effort and model are the user's alone (`/effort`, `/model`, applied
immediately); new sessions belong to `lowpower.js`, which writes `settings.json`
for the next launch; and delegated work belongs to the agent itself, which can
dispatch a subagent on any model at any effort, mid-session, with no one asked.
No script or hook can change the model or effort of a session already running -
`settings.json` is read at launch and hook output has no model field - which is
why the recommendation separates "this session" from "new sessions" instead of
pretending one command covers both.


## Plans

It reads which plan you are on and adjusts what it tells you, because the
advice differs even though the arithmetic does not:

| Plan | Read from | What changes |
| --- | --- | --- |
| Pro | `claude_pro` | Smallest budget. The 5-hour window usually binds first. |
| Max 5x | `claude_max` plus `default_claude_max_5x` | Room for Opus on most work. The weekly window is the one that bites. |
| Max 20x | `claude_max` plus `default_claude_max_20x` | Rarely binds. No reason to slow down unless the weekly is already high. |
| Team, Enterprise | `claude_team`, `claude_enterprise` | Seats are pooled and overage is an org setting. |

The window maths never needs to know the plan. It calibrates against what your
own account reports, so it is right on any tier, including ones that did not
exist when this was written. The plan only decides which line of advice you
get at the bottom of the report.

## Codex

It reads Codex's limits too, from the same repo and the same commands.

Codex writes its session rollouts to `~/.codex/sessions`, one JSON object per
line, and every model request appends a record carrying both the account meter
and what that request cost in tokens. That is the same pair of things this tool
needs from Claude Code, so the window arithmetic, the turn estimates, the
forecast and the concurrent-session counting all work unchanged. Nothing is
uploaded and no credentials are read.

```
npx claude-usage-limits --host codex
npx claude-usage-limits --host codex --refresh
npx claude-usage-limits codex-hook on
```

The host is detected, so `--host` is only needed on a machine with both
installed. `--refresh` asks Codex itself for a live reading rather than the
newest one it happened to write; it starts a short-lived `codex app-server` and
takes about a second, and it is the Codex equivalent of `/usage`.

As a plugin, Codex installs it from this repo directly:

```
codex plugin marketplace add https://github.com/ridelink0/claude-code-usage-limits
codex plugin add usage-limits@usage-limits
```

The panel works under Codex too, GPT-6 Astra included:

```
npx claude-usage-limits panel --open --host codex
```

It reads Codex's own meter the way `/status` does, through a short-lived
`codex app-server`, and draws the same bars under the title `Codex usage`,
with the model named the way Codex names it. Codex has no status line and no
hooks, so there is no spinner for a working session and no Sessions list; the
numbers are the point.

### One thing is different, and it is worth being straight about

Under Claude Code the budget line arrives on its own, because a plugin can ship
hooks. Under Codex it does not, and not for want of trying:

- Codex has the whole hook engine. The binary carries `UserPromptSubmit`,
  `SessionStart`, `PreToolUse` and the rest, and `codex features list` reports
  `hooks` as stable and enabled.
- A plugin cannot ship one: `plugin_hooks` is reported as `removed`.
- And on `codex-cli 0.151.0-alpha.7.2` nothing fires it. Tested with a hook
  whose only job was to write a file, from `~/.codex/hooks.json`, from a
  `[hooks]` table in `config.toml`, and from `~/.codex/hooks/`, in both
  `codex exec` and the desktop app. The engine is present and inert.

So `codex-hook on` installs two things. A marked block in `~/.codex/AGENTS.md`,
which Codex reads at the top of every session and which is what actually works
today; and the hooks themselves, ready for the build that runs them. `status`
reports both, `off` removes both, and neither touches anything else in those
files.

The practical difference is that under Codex the budget is read deliberately
rather than being handed to you before every prompt: once at the start of a
piece of work, again every ten or so tool-heavy turns and before the last long
step, and when the turns left are fewer than the steps still ahead the block
tells Codex to stop at a clean boundary, write WORK-PLAN.md and commit rather
than run into the limit. That last rule exists because a Codex session on
7 September 2026 read "about 32 turns left", carried on through forty minutes
of publishing, and was cut off with the handoff unwritten.

Two smaller differences. There is no money column: Codex meters a share of an
allowance and never quotes a price, so the percentages stand alone. And
`lowpower` is Claude Code only, because it writes Claude's `settings.json`.

## VS Code

The Claude Code extension for VS Code shows the limits only when you ask with
`/usage`, and it does not render a custom status line. So there is an
extension of its own in [vscode/](vscode/): the same bars as one full-height
view in the right sidebar, beside the chat, opened for you when VS Code
starts, with the Sessions list and the same animations in CSS. Nothing at the
bottom unless you turn `claudeUsageLimits.statusBar` on. It carries the plugin's scripts inside it, so it has no dependencies and
reads the same files and takes the same reading as the terminal panel.

```
cd vscode && npm run package
code --install-extension claude-usage-limits-<version>.vsix
```

The `.vsix` is attached to each GitHub release. It is not on the Marketplace
yet; that needs a publisher account, and the steps are in
[vscode/README.md](vscode/README.md).

## Where it works

Every surface of Claude Code on a machine shares one config directory, so
this reads all of them and does not care which one you are in:

| Surface | Works | Notes |
| --- | --- | --- |
| Terminal (`claude`) | yes | |
| VS Code extension | yes | The VS Code extension above puts the bars under the chat and in the status bar. |
| JetBrains extension | yes | |
| Desktop app | yes | The budget line and the hooks. The panel, the status line and the VS Code extension are for the terminal and VS Code; the app shows the limits itself. |
| Headless (`claude -p`) | yes | Scripts run fine, but there are no slash commands, so `lowpower.js` is the only way to change effort. |
| Cloud and web sessions | partly | Those run on a remote machine with their own config directory. Percentages are per-account and stay correct; the pace is measured from whatever transcripts are local to wherever you run the script. |

Sessions from different surfaces land in the same `~/.claude/projects` tree
and are counted together. On this machine the transcripts carry both `cli` and
`claude-vscode` entrypoints, and the report totals both.

Windows, macOS, and Linux all work. `CLAUDE_CONFIG_DIR` is honoured if you have
moved the config directory.

## Budget modes

This plugin is not free. It puts a line into the model's context before every
prompt, refreshes readings after tool calls, and keeps a status line alive. A
mode called "save tokens" that still injects four hundred tokens of advice per
turn is not saving anything - it is charging you for the advice about saving.

So a mode changes two things, not one: what the plugin tells the agent to do,
and what it costs to say it.

```
claude-usage-limits mode                  which one, where it came from
claude-usage-limits mode max              set it
claude-usage-limits mode off --guard 95   off, except one line near the wall
claude-usage-limits mode auto             pick from pressure, always reported
claude-usage-limits mode --list           all four, and the aliases
claude-usage-limits mode --ledger         measured cost per turn, per mode
```

| mode | what it does | what it costs |
| --- | --- | --- |
| `max` | fewest tokens that can still finish the job | one terse line, readings every 10 minutes, silent while nothing a decision depends on has moved |
| `high` | full capability, re-costed every two minutes mid-turn | the normal line, **plus a standing directive on every prompt** (about 650 characters, so a `high` briefing runs roughly 40% longer than `standard`), plus a short re-cost the first time a cheaper tier would do the same job - re-measured every two minutes, said only when the answer changes |
| `standard` | what the plugin has always done | today's line, today's cadences, unchanged |
| `off` | nothing at all | every hook returns before reading anything: no scan, no state write, no line, no end-of-reply tally |

`high` is the mode that spends a little more to waste a lot less: it carries a
standing directive and re-measures mid-turn, so its own line is longer than
`standard`'s. `max` is the one that costs less to say. Picking `high` because
the word sounds efficient and expecting a shorter line is the one
misunderstanding worth heading off.

Aliases, because people ask for these in their own words: `ultra`,
`ultra-efficient`, `maxtoken`, `maxefficient` for `max`; `smart`,
`high-efficient` for `high`; `efficient`, `token-efficient`, `default`, `on`
for `standard`; `none`, `quiet`, `silent`, `ignore` for `off`.

**`normal` is deliberately not an alias.** To some people it means "the plugin
working as usual" (`standard`); to others it means "the plugin stays out of the
way" (`off`). Those are opposite instructions, so guessing is wrong half the
time. Ask for `normal` and you get a question back, not a setting.

`off` means off, including at 100 per cent used. That is what it says and it is
honoured literally - which is also the failure this plugin exists to prevent,
so setting it prints the consequence once and offers `--guard 95`: one short
line when the window is nearly spent, and nothing else, ever. The default guard
is none. Discoverable, not imposed.

The one thing a mode never does is lower the quality of the work. When things
are tight you change the ORDER of the work, never the amount or the quality.
The savings come from ceremony - speculative reads, re-reads, preamble,
subagents nobody needed, workflows that cost more context than they save - and
the directives say that outright, because a model reading "use fewer tokens"
will otherwise quietly decide to skip the hard part. There is a test for it,
and another one that checks the `max` line is never longer than the `standard`
line for the same reading.

### Two planes, and which one is whose

There are two separate things people mean by "change the model":

- **The user plane** is your `settings.json` (`model`, `effortLevel`), the
  `/effort` and `/model` pickers, and `lowpower.js`. It is you saying what you
  want for yourself. The plugin reads it, shows it, and **never writes it on
  its own initiative.** Claude may recommend a change, and make one if you ask;
  it may not make one unasked. There is a test that exercises every mode, every
  alias, `auto`, the bounds and the guard, and then checks `settings.json` is
  byte-identical.
- **The agent plane** is the tier actually running the turn, and the tier of
  everything the turn spawns. That is what costs money, and that is what the
  modes govern.

`claude-usage-limits mode --baseline` shows both side by side. The budget line
now says the tier as well, and where the reading came from, because the number
that decides what a turn costs was the one number the line never printed. It
names the version, not only the family (`opus 5.5/xhigh`, not `opus/xhigh`),
read from the newest assistant message in the session's transcript: a settings
alias such as `opus` cannot say which Opus answered.

When the model running is an older release of a family that has a newer one at
a lower price - Opus 5 or 4.8 against Opus 5.5 ($4/$20, cache reads $0.20
against $0.50), Fable 5 against Fable 5.1 (reads $0.25 against $1) - the brief
says so once per session, with the prices and how many turns the one-off cache
rebuild takes to repay. In Claude Code it offers `/model <id>`, which switches
the session and saves the model as the default for new sessions; elsewhere it
offers the host's own model setting and names no slash command. A relay whose
own `model` is pinned to the older release is named too, since a wake starts
with that `--model` whatever the session switched to. Releases on
either side of the 4.7 tokenizer change are not compared, because a price per
token is not like for like across it. `mode --no-advice` mutes this with the
rest of the advice.

What Claude can genuinely move, stated without embroidery: the model on an
`Agent` call, and the model and effort inside a `Workflow` script. Its own
model and effort it cannot change mid-session - no hook output field exists for
it, on either host - so the plugin names the exact command and leaves it with
you. It does not pretend otherwise.

You can bound what it may suggest:

```
claude-usage-limits mode --floor sonnet/medium   # never point below this
claude-usage-limits mode --ceiling opus/xhigh    # nor above it
claude-usage-limits mode --pin                   # report only, suggest nothing
claude-usage-limits mode --decline               # no, and stop suggesting that
```

And when you say "put it back", there is something to put it back to:

```
claude-usage-limits mode --history   what changed, when, at whose instruction
claude-usage-limits mode undo        reverse the last change, naming it first
```

`undo` reverses what the plugin owns. For a change to your own settings it
names the entry and the command that undoes it and leaves the file alone -
which is the same rule as everywhere else, and the reason the byte-identical
test can never go green by accident.

## Working cheaply on purpose

Half the problem is measurement. The other half is that a high effort setting
keeps spending at the same rate whether or not there is room left.

```
node skills/usage-limits/scripts/lowpower.js status
node skills/usage-limits/scripts/lowpower.js on                 # effortLevel -> low
node skills/usage-limits/scripts/lowpower.js on --effort medium --model sonnet
node skills/usage-limits/scripts/lowpower.js off                # puts back what was there
```

It edits `effortLevel` in `settings.json` through a temporary file, saves the
previous values alongside, and keeps a `.usage-limits-backup` copy of the original.
Keys it does not manage are left untouched. Running `on` twice does not
overwrite the saved originals.

The file change applies to new sessions. For a session already running,
`/effort low` does the same thing immediately.

`--effort max` is refused: `settings.json` does not accept `max`, so saving it
would store a value the next session silently ignores. `max` lives in
`/effort` and `CLAUDE_CODE_EFFORT_LEVEL` only.

That covers the setting. The larger saving is behavioural, and the skill file
spells it out: batch tool calls, read line ranges instead of whole files, skip
subagents when the context already exists, stop retrying a fix that is not
working. Effort level does not control any of that, which is why those rules
apply even at `xhigh` or `max`. The reasoning behind each one is in
[tactics.md](skills/usage-limits/references/tactics.md).

## Requirements

Node 18 or newer, and a Claude Code recent enough to write
`cachedUsageUtilization` into `~/.claude.json`. If the report says it found no
snapshot, run `/usage` once inside Claude Code and it will be there.

Nothing is uploaded. The report and the status line read only files already on
the machine. The panel, and the hooks when the reading on disk is older than a
few minutes, take the same reading Claude Code takes for `/usage`: they read
the login token Claude Code keeps and send it to Anthropic's usage endpoint,
nowhere else. The token is never written to disk by this plugin, never
printed, and never refreshed or rotated. `USAGE_LIMITS_FETCH=off` keeps all of
it offline, on the reading Claude Code itself last cached.

## How accurate is it

Good enough to plan with, not a bill. The honest caveats:

- The meter reports whole percent, so a reading of 2 percent is really
  somewhere between 1.5 and 2.5. Low readings project badly, and the report
  says so when it is in that range.
- Transcripts are local. Usage from another machine or from claude.ai counts
  against the same limit but leaves no local record, which makes the estimate
  read low.
- The dollar figures are an internal unit used to convert your token mix into
  a percentage of the limit. On a subscription plan you are not billed them.
- Turns left assumes the next turns look like the last hour's. A debugging
  spiral breaks that assumption immediately.
- A model released after this table was written is priced at its family's
  average rate, and the report marks those rows with an asterisk rather than
  passing the guess off as a published price.
- Time of day is not modelled. Anthropic used to shrink the five-hour limit
  during peak hours, but removed that on 6 May 2026 for Pro and Max while
  doubling the limits. If demand-based limits ever return, the numbers here
  follow automatically, because they are calibrated from what your traffic did
  to the meter rather than from an assumption about the clock.
- Subagent transcripts, written under the session's own folder, are read too.
  Their calls count in the money and the tokens and are reported apart from
  the turns, because a turn is one main-thread call.
- The account's own list of limits is read as well as the per-window buckets,
  so a per-model weekly such as `weekly (Fable)` shows up as a window of its
  own, priced from that model's calls alone.
- A per-model weekly only counts against you while you are running that model.
  One at 88 per cent is not your wall if you are working on Opus: nothing you
  do moves it. Those windows are still listed, marked `not in use`, but they
  are never picked as the binding window, never raised as a warning, never a
  reason a forecast says the job does not fit, and never what puts `LOW` on the
  status line. Start using that model and they come straight back. Nothing is
  suppressed unless both sides are recognised: an unknown model in the setting,
  or a weekly scoped to a model this table has never heard of, is treated as
  live, because hiding a limit that can stop the work is worse than showing one
  that cannot.
- The report also says what the room left buys in turns of each model, priced
  from that model's own measured cost per turn, against the window its spend
  lands in. Rows sharing a window are alternatives rather than additions. A
  model that has only ever run as a subagent gets no projected turn count at
  all - its errands are not turns - though what delegating to it has cost is
  still reported. What each model cost is remembered in
  `usage-limits-models.json`, one entry per family, so a session that opens on
  a model it has not run this week still knows its price.
- The turn cost behind "turns of headroom" is a median over at least five
  turns, so one compaction cannot define your pace.
- What a point of a window costs is learned once from the best sample seen and
  remembered, rather than re-derived each time from whatever slice is to hand.
  A thin baseline prices a point badly and every correction built on it
  inherits the error, which is how a window truly at 70 percent once came out
  at 82.
- The cache only refreshes when Claude Code talks to the API, so after a gap it
  can be hours old and its 5-hour window long since rolled over. Dropping that
  window would hide the limit that actually stops short work, so it gets rebuilt
  from your transcripts instead: whatever was spent inside the window the stale
  reading describes equalled its percentage, and that price per point still
  values the window running now. Rebuilt figures are written `~41%` in the
  report and "about 41%" in the before-prompt line, and they say how old the
  snapshot is so you can run `/usage` and replace the estimate with a reading.
- A rebuilt figure only counts what this machine did. If you also worked on
  another device it reads low, which is the dangerous direction, so treat it as
  a floor until you refresh.
- If a rebuild comes out above a full window, it is refused rather than capped.
  Local transcripts only see this machine, so a window mostly spent elsewhere
  makes a point look far too cheap and any live spend divides to hundreds of
  percent. Capping that at 100 would tell someone sitting at half their budget
  that it was gone. The window is reported as unknown instead, with a nudge to
  run `/usage`.

[how-it-works.md](skills/usage-limits/references/how-it-works.md) has the field
names, the formulas, and the rest of it.

## Layout

```
.claude-plugin/plugin.json        plugin manifest, Claude Code
.claude-plugin/marketplace.json   lets the repo serve itself
.codex-plugin/plugin.json         plugin manifest, Codex
agents/openai.yaml                how Codex lists the plugin
skills/usage-limits/SKILL.md      what the agent reads
skills/usage-limits/agents/       how Codex lists the skill
skills/usage-limits/scripts/      usage.js, brief.js, pulse.js, stop.js,
                                  sessionend.js, tally.js, codex.js, host.js,
                                  lowpower.js, install-codex-hook.js,
                                  recommend.js, panel.js, feed.js,
                                  statusline.js, live.js, view.js, bars.js,
                                  activity.js, reading.js, drift.js,
                                  mode.js, voice.js, relay.js, wake.js,
                                  lowpri.js
skills/usage-limits/references/   the longer notes
hooks/hooks.json                  runs brief.js before each prompt, pulse.js
                                  during long turns, stop.js after each reply
                                  and sessionend.js when the session closes
commands/check.md                 the /usage-limits:check command
commands/session.md               the /usage-limits:session command
commands/panel.md                 the /usage-limits:panel command
commands/statusline.md            the /usage-limits:statusline command
commands/usage-mode.md            the /usage-mode command
bin/cli.js                        the npx entry point
tools/sync-version.js             keeps the manifest version in step
tools/test-tempdirs.js            temp directories the suite deletes on exit
vscode/                           the VS Code extension; build.js copies the
                                  scripts into vscode/lib and makes the vsix
test/                             node --test, no dependencies
```

## Tests

```
node --test
```

901 tests over the pricing, the window arithmetic, plan and credit detection,
the status line, the before-prompt line, the mid-turn pulse, the after-reply tally and the session history, job forecasting,
per-project attribution, the Codex reader and its installer, the CLI,
packaging, the settings save/restore, and what Claude Code's own wall-time
features are readable as (/low-priority, the wrap-up note, autoContinueAtUsageLimit).

The budget modes are checked as rules rather than examples: the whole stopping
matrix is walked in every mode (640 lines), `off` must inject nothing at any
percentage and any pressure, the `max` line must never be longer than the
`standard` line for the same reading, no line may tell the agent to do the work
worse, and every mode path, alias, bound and guard is exercised before
`settings.json` is compared byte for byte.

## The wall is not the end of the budget

A full window is not always a reason to stop, and the plugin now says which.

A **per-model weekly** counts turns by that model only. It is not your budget,
it is that model's: lowering effort frees nothing, and switching model retires
the window outright while every other window carries on. A **shared window**
follows the account wherever the model goes, so a switch buys nothing and
effort is the lever instead.

Once the binding window is half gone the budget line names the lever that
applies, which window would bind after the switch and how full it is, and the
command:

```
This window is scoped to one model, so it is not the account's budget:
switching model retires it. After a switch the binding window would be weekly
at 77 per cent. Use /model opus.
```

At the wall it goes further and says outright that you are not out of budget
and must not stop as though you were. It refuses to claim an escape it cannot
evidence: trading an 89 for an 87 is a lateral move, not a way out, and with no
other readable window there is nothing behind the claim, so it says nothing.

This exists because of a real session. The Fable weekly hit 89 per cent, the
line said the budget was nearly gone, and the work stopped - with the 5-hour
window at 46 and every other model untouched. One command would have carried it
on.

## Release notes

What changed in each version is in the [GitHub Releases](https://github.com/ridelink0/claude-code-usage-limits/releases).
The long notes for 1.23.0, the release that started intervening rather than
only reporting, are in [docs/1.23.0.md](docs/1.23.0.md).

## Status

It works and I use it daily.

What I am not doing is fielding feature requests or support questions. If you
want it to behave differently, fork it and change it, which is what the MIT
licence is there for. Do not wait on me to add something for you.

## License

MIT. See [LICENSE](LICENSE).
