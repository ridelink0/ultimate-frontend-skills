# Where the numbers come from

Everything is read from local files, with one exception: the panel, and the
hooks when the reading on disk is older than a few minutes, take the same
reading Claude Code takes for `/usage`, which sends the login token to
Anthropic's usage endpoint and nowhere else (the last section of this file).
Nothing else is sent anywhere, and `USAGE_LIMITS_FETCH=off` stops that too.

## Sources

### The limits

`~/.claude.json`, key `cachedUsageUtilization`. Claude Code refreshes this
during normal use, so it is usually a few minutes old at most. The shape:

```json
{
  "fetchedAtMs": 1787522765060,
  "utilization": {
    "five_hour":  { "utilization": 2,  "resets_at": "2026-08-24T02:59:59Z" },
    "seven_day":  { "utilization": 75, "resets_at": "2026-08-23T22:59:59Z" },
    "extra_usage": { "is_enabled": false }
  }
}
```

`utilization` is a whole-number percentage. `resets_at` is when that window
rolls over. Some plans also carry `seven_day_opus` and `seven_day_sonnet`;
the report includes them when they are present.

If the key is missing, run `/usage` once inside Claude Code. That is what
populates it.

The same object carries a `limits` array: one entry per limit the account
enforces, each with `kind` (`session`, `weekly_all`, `weekly_scoped`),
`percent`, `severity`, `resets_at`, `is_active`, and for the scoped weeklies
which model they cover. The report reads it too. A scoped weekly becomes a
window of its own, labelled `weekly (Fable)` and priced from that model's
calls alone; `is_active` breaks ties in the binding choice; and a bucket that
quotes `limit_dollars` is priced from that directly instead of being calibrated.

A per-model weekly caps one model family and nothing else, so it can only stop
work that uses that family. Which families are in use is taken from the model
in `settings.json` (and `ANTHROPIC_MODEL`), plus every model this session has
actually run, subagents included. Another session's models are not counted:
what another window is burning is not this one's constraint. A setting that
names a strategy rather than a model resolves to every model it runs, so
`opusplan` counts as both Opus and Sonnet.

A window for a family that is not in use is still listed everywhere it was
listed before - it is real, and switching to that model would make it bite -
but it is never chosen as the binding window, never raised as a warning, never
a reason a forecast says the job does not fit, and never what puts `LOW` on the
status line. It is marked `not in use` in the report and "(not this session's
model)" in the before-prompt line.

Nothing is suppressed unless both sides are recognised. If the model in use
cannot be worked out, or the weekly is scoped to a model this table has never
heard of, the window is treated as live. Hiding a limit that can stop the work
is the one failure worse than over-reporting one.

The one-line `--status` readout is the exception worth knowing about: it reads
no transcripts by design, so the only thing it can know about the running
model is the setting. It therefore shows every per-model weekly and simply
does not let an idle one raise `LOW`. The status line proper (`feed.js`) is
told the model by Claude Code itself and needs no such caution.

## Model headroom

How much room is left is half the question; what that room buys is the other
half, and the answer differs by model. The snapshot cannot say: it has no model
dimension at all. Every transcript line carries its model, so each family is
joined to the window its spend lands in - its own weekly where the account
gives it one, the shared weekly otherwise - and priced from its own turns.

Rows that share a window are alternatives, not additions. They describe the
same remaining room spent on different models.

No turn count is projected for a model that has never taken a turn of its own.
A family that has only ever run as a subagent has errands to price, not turns:
114 Sonnet calls on one machine averaged under two cents because they were
one-shot lookups, and dividing the remaining budget by that promised twenty-two
thousand Sonnet turns. The row still reports what delegating to that model has
cost, because that is measured; it does not project from it.

What a turn of each model cost is kept in `usage-limits-models.json` in the
config directory, one entry per family so it cannot grow, stamped with the plan
and read back through the same guard as the window calibration. It exists so a
session that opens on a model it has not run this week still knows what that
model costs. It is deliberately not written into `usage-limits-calibration.json`:
that file means one thing, the plan's blended price of a point, and three
callers read it on that basis.

There is no per-turn log. Every model figure comes from the transcripts, which
already hold it; an append-only ledger would grow without bound and record
nothing new.

Nothing here claims the meter weights a dollar of one model differently from a
dollar of another. No published or observed source shows that, and the two
prices per point this plugin learns - one for a shared weekly, one for a scoped
one - are percentages of two differently sized allowances, which says nothing
about weighting either way.

The plan name comes from `oauthAccount.organizationType` in the same file.
Current effort and model come from `settings.json` in the config directory.

`CLAUDE_CONFIG_DIR` is honoured if set.

Every surface writes here: the terminal CLI, the VS Code and JetBrains
extensions, and the desktop app all share one config directory, and their
sessions are counted together. Entries carry an `entrypoint` field (`cli`,
`claude-vscode`) if you want to tell them apart, but the report does not
filter on it.

### The pace

`~/.claude/projects/<project>/<session>.jsonl`. One JSON object per line.
Assistant turns carry a usage record:

```json
{
  "type": "assistant",
  "timestamp": "2026-08-23T22:04:56.858Z",
  "requestId": "req_011...",
  "effort": "xhigh",
  "message": {
    "id": "msg_01...",
    "model": "claude-opus-5",
    "usage": {
      "input_tokens": 2,
      "cache_creation_input_tokens": 8049,
      "cache_read_input_tokens": 24780,
      "output_tokens": 2144,
      "cache_creation": { "ephemeral_1h_input_tokens": 8049 }
    }
  }
}
```

Subagents write their own transcripts under
`<project>/<session id>/subagents/agent-*.jsonl`, with `isSidechain: true` and
the parent's `sessionId`. They are read too: their calls count in the money and
the tokens, and are kept apart from the turns, because a turn is one main-thread
call. Lines from a model called `<synthetic>` are interrupts and client-side
errors, not calls, and are skipped.

Files whose modification time predates the window are skipped. Turns are keyed
by `message.id` plus `requestId` and counted once, because resuming or forking
a session copies earlier turns into a new file.

## The arithmetic

Each turn is priced at published API rates. Cache traffic is a multiple of the
input rate: 1.25x for a five-minute write, 2x for a one-hour write, 0.1x for a
read.

```
turn        = (input + 0.1*cache_read + 1.25*write5m + 2*write1h) * input_rate
            + output * output_rate

spent       = sum of turns inside the window
per_percent = spent / utilization
left        = per_percent * (100 - utilization)
turns_left  = (100 - utilization) / (recent_cost_per_turn / per_percent)
headroom    = (100 - utilization) / (recent_dollars_per_hour / per_percent)
```

The window opens at `resets_at` minus its span: five hours, or seven days.
Recent pace is measured over the last hour, or since the window opened if that
is more recent.

The self-calibration is the point. Nobody outside Anthropic knows what a
subscription limit is worth in tokens, and it differs by plan. But if 75
percent of the week corresponds to a measurable amount of local traffic, the
remaining 25 percent is worth a quarter of that. The absolute dollar figures
are an internal unit for that ratio. On a subscription plan you are not billed
them, and they should not be read as a bill.

## Where it is soft

**Whole percent granularity.** The meter reports integers, so 2 percent is
really somewhere in 1.5 to 2.5. At low readings the projection can be off by
a quarter or more in either direction. The report flags this below 5 percent.
Above about 20 percent it tightens up considerably.

**Two files can claim to be the account state.** The meter lives in
`~/.claude.json`, but a Claude Code migration also writes a small
`~/.claude/.claude.json` holding machine ids and no meter at all. Whichever
one actually carries `cachedUsageUtilization` is the one read. Choosing on
existence alone found the stub, concluded there was no Claude snapshot, and
sent host detection off to Codex, which reported that agent's meter inside a
Claude session.

**One machine only.** Transcripts are local. Usage from another machine, from
claude.ai, or from a cloud session counts against the same limit but leaves no
local record. The percentages stay correct; the calibration reads low, which
makes the remaining headroom look smaller than it is.

**Deleted transcripts.** Same effect. Old session files get cleaned up, and
anything cleaned up inside the seven-day window is invisible to the pace
calculation.

**List prices are a proxy.** The rate table is first-party API pricing. How a
subscription plan actually meters usage is not published, and the weighting
almost certainly is not exactly this. It is close enough for ratios, which is
all it is used for. No published or community source shows the meter weighting
models differently from their dollar prices, so calibrating dollars against
your own meter remains the best method anyone outside Anthropic has.

**The snapshot is slow by design.** The percentages come from Claude Code's
own cache of the account meter, which refreshes on its own schedule - roughly
hourly in practice, because the endpoint behind it rate-limits aggressive
polling. Between refreshes every figure here is the last real reading plus
arithmetic. That is why an old snapshot is reported as an estimate with its age
attached rather than dressed up as a current percentage, and why `/usage` is
the one way to force a fresh reading. It is only called a floor when the
correction has been refused and the raw snapshot is all that is shown.

**A reset time can be in the past.** The cache refreshes when Claude Code
talks to the API, so an idle spell leaves it behind. A window whose `resets_at`
has passed has already turned over, and its cached percentage describes a
window that no longer exists. Those are marked stale, excluded from the
binding choice, and never used for projections, because treating one as
current would report an empty budget at the exact moment the budget came back.

**Time of day is not modelled, and does not need to be.** Anthropic used to
shrink the Claude Code five-hour limit during peak hours, so the same work cost
more of it in the afternoon. That ended on 6 May 2026, when the five-hour
limits were doubled and, in Anthropic's words, they removed "the peak hours
limit reduction on Claude Code for Pro and Max accounts". So there is no
peak-hour penalty to model today.

If one ever returns, nothing here needs changing. Every figure is calibrated
from what your own traffic actually did to the meter, so if a point of budget
starts costing more at four in the afternoon, the measured dollars-per-point
moves with it and the headroom follows. That is the advantage of measuring
rather than assuming: the tool does not need to know why a point got dearer.

**One turn is not a pace.** The turn cost behind "turns of headroom" is the
median of a sample, not the mean, and never from fewer than five turns. A
compaction or a large file read can cost ten times an ordinary turn, and one of
those landing in a thin sample once put a window that was 13 percent full at
nine turns remaining. Thin samples widen to the whole window, and then to
everything on record.

**Pace is not a promise.** Turns left assumes the next turns look like the last
hour's. A debugging spiral or a large file read breaks that assumption
immediately. Re-run the report if the shape of the work changes.

## Keeping it accurate

The rate table in `scripts/usage.js` is a plain object at the top of the file.
When new models ship, add a row.

A bracketed suffix on a model id (`claude-sonnet-5[1m]`) is stripped before
the lookup: it marks a context-window variant of the same model, not a new
one. Cache reads price at a tenth of the input rate unless a row carries a
`cacheRead` figure of its own - Fable and Mythos 5.1 price reads outright at
$0.25 per million (0.025x input) and Opus 5.5 at $0.20 (0.05x its $4 input),
all under the tenth rule, and reads are the dominant input in exactly the long
sessions where the difference matters.

Until someone does, a model this table has not seen is priced at the average of
the family its name contains: an unreleased `claude-opus-5-2` is charged at the
mean of every Opus rate on record. Averaging assumes nothing about which
direction prices moved, which is why it beats pinning to whichever release
happened to be newest when the table was written.

A name with no recognisable family falls back to Opus rates. That is a
deliberate choice rather than a neutral one: over-estimating cost understates
your headroom, and being told you have less room than you do is the safe way to
be wrong about a budget.

Rows priced this way are marked with an asterisk in the report, so an assumed
rate never quietly passes for a published one.

## The live reading, and which reading wins

Claude Code takes its own `/usage` figures with one GET to
`https://api.anthropic.com/api/oauth/usage`, sending the login token it holds
as a bearer token with the `anthropic-beta: oauth-2025-04-20` header and a
five second timeout. `scripts/live.js` makes exactly that call, reads the
token from `.credentials.json` inside the config directory (or the
`Claude Code-credentials` keychain entry on macOS), and writes the answer to
`usage-limits-live.json` with the account it belongs to. The token is used for
that one request and nothing else: never written, never printed, never
refreshed. If it has expired the endpoint says 401, the panel says "sign in to
Claude Code again", and Claude Code fixes it on its own next call.

`collect()` then has two snapshots of the same account, Claude Code's
`cachedUsageUtilization` and the live file, and takes whichever is newer. The
choice is `preferLive()`: the live file loses when it is older, when it names a
different account, or when its timestamp is more than a minute in the future.
`snapshotSource` in the report says which one was used. Everything downstream -
the budget line, the pulse, the status line, the forecast, the recommendation -
goes through `collect()`, so they all see the newer reading.

The status line has a third source that is fresher than either: Claude Code
hands it `rate_limits` built from the `anthropic-ratelimit-unified-*` headers
on its own API responses, for the session and the shared week. `feed.js`
records those per session in `usage-limits-feed.json`, along with the model
and effort in use, and `view.js` takes the newest of headers, live reading and
cache for each window. The per-model weeks are only in the endpoint's answer,
so they come from the live file or the cache.

Which per-model week to show is decided by the model in use, never by the
account's `is_active` flag: that flag marks the limit currently binding, not
whether the model is running. The status line's `model.id` is certain, the
`model` setting is the fallback, and with neither nothing is hidden.

Whether Claude is working comes from the hooks: the prompt hook marks the
session working (and whether the prompt said `ultracode`), every tool call
keeps it so, and the Stop and SessionEnd hooks mark it idle. Marks live in
`usage-limits-activity.json`, one per session, and a session silent for fifteen
minutes counts as idle whatever it last said, because a crash never sends
Stop.

The sessions list joins those marks with the status line feed (model, effort,
directory), the Stop hook's tally (project, cost, turns) and the prompt hook's
cache (when it last prompted), one row per session id, in
`activity.combine()`. A session is listed if any of them saw it in the last
fifteen minutes and is working only if its own mark says so and is fresh, so
the header, the list and the `+N working` on the status line always agree.
