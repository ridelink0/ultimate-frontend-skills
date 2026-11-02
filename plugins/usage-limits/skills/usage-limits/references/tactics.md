# Spending less per turn

Everything here works by shrinking one of three quantities: the tokens you
resend, the tokens you generate, or the number of times you do either.

## The part people get wrong

A conversation is stateless. Every turn resends the entire conversation so
far. Nothing is stored server-side between requests, so a file you read on
turn 5 is re-sent on turns 6 through 60.

That resend is cheap per token but not free. Cached prefix tokens bill at a
tenth of the input rate, fresh input at the full rate, cache writes at 1.25x
(five-minute) or 2x (one-hour), and output at five times the input rate. On
Opus rates, a 100k-token context costs roughly five cents a turn just to be
re-read, before the model generates anything.

Two consequences follow, and they drive most of the list below:

- **Context length is a recurring tax, not a one-off cost.** Dumping a large
  file into context on turn 5 is not one expensive turn, it is a surcharge on
  every turn after it.
- **Output is the expensive direction.** Reasoning tokens are output tokens.
  A turn that thinks for 4,000 tokens and edits one line costs more than a
  turn that reads 20,000 tokens of cached context.

## Levers, largest first

### 1. Drop the effort level

Effort controls how much the model reasons, and reasoning is output. Going
from `xhigh` to `low` cuts the expensive half of the turn several times over.
This is the biggest saving available that does not change what gets built.

```
node scripts/lowpower.js on          # writes effortLevel, remembers the old one
/effort low                          # same change, applied to the running session
```

Keep high effort for the decisions that are hard to undo: schema changes,
migrations, anything touching auth. Mechanical work does not need it.

### 2. Move mechanical work to a cheaper model

Per million tokens, input and output:

| Model | Input | Output |
| --- | --- | --- |
| Opus 5 | $5 | $25 |
| Sonnet 5 | $2 | $10 |
| Haiku 4.5 | $1 | $5 |

Renaming symbols, writing boilerplate tests, formatting, mechanical
translation between two known formats: none of that needs the top model.
Switch at a task boundary rather than mid-task, because a model switch
invalidates the prompt cache and the rebuild can cost more than the saving on
a short remaining task.

The switch needs no boundary at all when the work is delegated: a subagent
can be dispatched on a cheaper model at low effort mid-session, and that is
the one model change the agent can make without anyone's hand on `/model`.
It pays the cold start from lever 7, so it is for self-contained bulky work,
not quick questions. `node scripts/usage.js --recommend` prices whether the
budget calls for it.

### 3. Read less, and read it once

- Line ranges instead of whole files. Grep with a result limit instead of
  opening candidates one by one.
- Pipe noisy commands through `head`, `tail`, or `grep`. A full `npm test`
  dump or an untrimmed `git log` lands in context and stays there.
- Never re-read a file to confirm an edit applied. The edit already failed
  loudly if it did not.
- Prefer `git diff --stat` before `git diff`. Usually the stat is the answer.

### 4. Cut the tool surface

Every connected MCP server's tool definitions sit in the system prompt of
every single request. A handful of large servers can add tens of thousands of
tokens to the prefix, on every turn, whether or not you use them. Disconnect
the ones this project does not need with `/mcp` or `claude mcp`.

`DISABLE_BUNDLED_SKILLS=1` trims the bundled skill catalogue for the same
reason, if none of them are in use.

### 5. Protect the cache prefix

Cache reads are ten times cheaper than fresh input, and the cache matches on
an exact prefix. Any byte that changes early invalidates everything after it.
What actually invalidates it mid-session:

- **switching models** - each model has its own cache, so the next request
  re-reads the whole conversation even though the content is identical
- **changing the effort level** - on most models each effort level has its own
  cache too. This one matters here because dropping effort is the saving this
  plugin recommends most often. It is still worth doing, but it is not free
  mid-session: on a large context the one-off rebuild can cost more than a few
  cheaper turns save. Choose effort at the START of a session where you can
- **turning on fast mode** - it adds a request header that is part of the cache key
- **connecting or disconnecting an MCP server, but only when its tools sit in
  the prefix.** With tool search - the default on supported models - a server
  connecting, disconnecting or changing its tool list only appends, and the
  cached prefix survives
- **enabling or disabling a plugin that provides MCP servers**, by the same
  rule. A plugin ships skills, commands, agents and hooks by appending them,
  and those never invalidate anything
- **adding or removing a bare tool-name deny rule** (`Bash`, `WebFetch`), which
  takes the tool out of the system prompt. Scoped rules like `Bash(rm *)` do not
- **compacting**, by design, and **upgrading Claude Code**

What does NOT invalidate it, despite being widely believed to:

- **editing `CLAUDE.md` mid-session.** It is read once at session start and held
  in memory. The edit does not invalidate the cache - and it also does not
  apply, until `/clear`, `/compact` or a restart
- editing files in the repository, changing permission mode, changing output
  style, invoking a skill or command, and `/recap`

None of the invalidating ones are forbidden. Just do them at a session boundary
instead of in the middle of a long run.

**`/rewind` rather than `/compact`** when abandoning a path: it truncates back to
a prefix that is already cached, where compaction builds a new one and pays a
summarisation call to do it.

**Cache scope is one machine and one directory.** Parallel sessions in the same
directory read each other cache; different directories do not - and that
includes two worktrees of the same repository, which is a real and unobvious
cost of isolating agents that way.

### 6. Batch tool calls

Independent calls belong in one message. Three greps in one turn cost one
context resend. Three greps in three turns cost three, plus three rounds of
reasoning and narration.

### 7. Skip subagents when the context already exists

A subagent starts with an empty context and re-derives what the main session
already knows. That is worth paying for genuine fan-out across more material
than one context can hold. It is not worth paying to answer a question the
main session could answer directly.

### 8. Stop failing loops early

The single most expensive pattern is retrying a fix that does not work.
Three blind attempts cost more than one turn spent reading the actual error.
If the second attempt fails for a new reason, stop and re-read.

### 9. End sessions at task boundaries

Compaction reads the whole conversation and writes a summary, which is a
full-price pass over everything. It is worth it compared to dragging a bloated
context through another twenty turns, but a fresh session started from a short
handoff note is cheaper than either.

Write the handoff, exit, start clean.

### 10. Specify the work properly the first time

Underspecifying is the most expensive habit in the list, and it looks like
saving. A vague instruction that produces the wrong thing costs the build, the
review, the revert, and the rebuild. Two hundred tokens of precise
instructions routinely save several thousand.

## Environment knobs

| Variable | Effect |
| --- | --- |
| `MAX_THINKING_TOKENS` | Hard ceiling on reasoning per turn. |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | Hard ceiling on response length. Too low truncates mid-answer. |
| `DISABLE_BUNDLED_SKILLS` | Drops the bundled skill catalogue from the prompt. |
| `DISABLE_NONESSENTIAL_TRAFFIC` | Suppresses background requests. Small effect. |

Ceilings are blunt. Effort level gets you most of the same saving while
letting the model still finish its sentence.

## What does not save money

**Clearing between related tasks.** A fresh session pays a fresh cache write
and re-reads the same files. Clear at real boundaries, not every few turns.

**Terse prompts.** See lever 10. The tokens saved on the instruction come back
multiplied in rework.

**Turning thinking off entirely.** On Opus 5 this has known failure modes: the
model can write a tool call into its visible text instead of actually calling
the tool, which fails silently and pollutes later turns. Lower the effort level
instead. It is cheaper *and* it still works.

**Asking for shorter answers when the cost is elsewhere.** If the spend is in
tool results, prose length is rounding error. Check where it actually went
before optimising the visible part.

## Rough arithmetic

Illustrative, not measured. A 60-turn session with about 80k tokens of cached
context, on Opus rates:

| | Per turn | Over 60 turns |
| --- | --- | --- |
| Re-reading cached context | $0.04 | $2.40 |
| Output at high effort, ~2,500 tokens | $0.063 | $3.75 |
| Output at low effort, ~700 tokens | $0.018 | $1.05 |

Same work, same context, roughly 44 percent cheaper. Halving the context on
top of that takes another $1.20 off. Neither change removes a single feature
from what gets built.
