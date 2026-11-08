# Why Claude drove one action per call, and what 0.4.0 changed

Research behind the 0.4.0 release. The question was Gerald's: Codex composes a
sequence of desktop actions in one cell, Claude spent one MCP round trip per
click. Findings are from a five-agent sweep on 2026-09-04 over the Claude API
docs, Claude Code's documented and reverse-engineered tool mechanics, the Codex
plugin and runtime installed on this PC, and this repo's own transcripts.

Confidence is marked per claim. Claude Code is closed source, so several of the
mechanics below rest on binary forensics and third-party reproduction rather
than official documentation; those are marked as such and should be re-checked
when Claude Code's behaviour changes.

## 1. Claude was not the problem; the tool surface was

Measured across this machine's Claude Code transcripts: nearly every session
that used the plugin shows `run=0` and dozens of single `computer_click` /
`computer_type` / `computer_key` calls. A representative navigation from
session `d64f4161` at 22:50 is four separate calls - `ctrl+l`, type the URL,
`enter`, then a snapshot - which is four model turns. The only session with a
non-zero run count is the one that built `computer_run`.

## 2. Several tool calls in one message can never be the answer

**Claude Code partitions one assistant message into batches by per-call
concurrency safety.** Consecutive safe calls run in parallel (bounded pool,
default 10 via `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY`); any unsafe call runs
alone and serially, in emission order. Unknown tools default to serial.
*Verified* against the env-vars documentation and a reverse-engineering
write-up of `partitionToolCalls()`.

**For MCP tools the safety decision is the `readOnlyHint` annotation alone**:
`isConcurrencySafe()` returns `annotations?.readOnlyHint ?? false`. A tool
without it is never parallelised. *Likely* - from binary forensics on Claude
Code v2.1.75 and the `greynewell/mcp-serialization-repro` study on v2.1.39, not
from official docs. Built-ins differ: they classify per input.

**A serial batch does not stop at the first failure.** Every call in the
message still runs and returns its own result; only Bash ever cascaded, and
that was removed in 2.1.161. *Verified.* This is the decisive point: if Claude
emitted click, type and key as three blocks and the click failed, the type and
the key would still execute against whatever state the window was actually in.

**The model side will not close the gap either.** Claude Code's own prompt
tells Claude to batch only independent calls and to run dependent ones
sequentially. Nothing in the harness makes it put click-then-type in one
message, and field measurements show mostly one tool_use per response even with
`readOnlyHint: true`. *Verified.*

## 3. Anthropic's own answer is a server-side batch tool

Anthropic's first-party MCP servers solve sequencing with an explicit batch
tool, not with multi-tool_use messages: `browser_batch` in Claude in Chrome and
`computer_batch` in the built-in computer-use server, both sequential,
stop-on-first-error, one round trip. *Verified.*

On the raw Claude API the equivalent is the `computer_toolset_20260801` batch
action, whose contract is worth matching because Claude is trained on it:

- Run blocks in order and stop at the first failure.
- The failed block returns `is_error: true` with a description.
- Every later block returns `is_error: true` with exactly
  `Not executed: an earlier computer action in this turn failed.`
  (the browser toolset drops the word "computer").
- The human check must run before each block, because a batch can complete a
  multistep action within one turn.

*Verified* against the computer-use tool reference. Programmatic tool calling
(code execution plus `allowed_callers`) exists only on the raw API, explicitly
excludes MCP-connector tools and the computer-use toolset, and has no
equivalent in Claude Code. So a Codex-style "write a program" tool was not an
option here.

## 4. Why `computer_run` was invisible

It shipped in 0.3.0 with the right shape and went almost unused. Three causes,
all of them outside the tool itself:

- **Deferred schemas.** With tool search on by default, the 16 tools reach the
  model as names only; a schema arrives via `ToolSearch`, which returns up to
  five best matches ranked over names and descriptions. A search for "click" or
  "type" returns the single-action tools. `computer_run` is outside the top five
  for the words a model actually searches. *Verified* for the mechanism,
  *likely* for the ranking quirks (undocumented, from open issues).
- **No server instructions.** Claude Code injects an MCP server's `instructions`
  string at session start, before any tool search, under a "MCP Server
  Instructions" heading, and keeps it in the cached prefix every turn. Each
  server's block is truncated at 2 KB. This plugin sent none, so it had no
  always-present text at all. *Verified.*
- **The skill taught the wrong default.** `SKILL.md` step 4 of the loop was
  "act by index" with single calls, and runs appeared later as an optional
  optimisation for when you "already know the next three or four actions".

## 5. What 0.4.0 does about it

Discovery:

- A 608-character `instructions` string on the initialize reply, teaching the
  loop and the sequence rule. Byte-stable, so it does not break prefix caching.
- `computer_run`'s description leads with the batch and carries the keywords a
  model searches for; the four single-action tools point back at it.
- `readOnlyHint` on `computer_apps`, `computer_snapshot`, `computer_screenshot`
  and `computer_status` only. Acting tools are left unmarked on purpose: they
  must stay serial, and a sequence of them belongs in a run.
- `SKILL.md` makes the run step 4 of the loop, adds a one-call `ToolSearch
  select:` line, and names single calls as the exception.

Expressiveness, so a foreseeable sequence always fits in one call:

- All steps validated before the first runs.
- Per-step `hwnd` / `title` / `window: "new"`, so a run follows the dialog it
  opened instead of ending at it.
- `optional: true` and `repeat: N`.
- Anthropic's halt wording for steps never reached; Stop terminal regardless of
  `stop_on_error` or `optional`.

Safety: `confirmed: true` refused in a background run, so no single call can
complete a send, payment or deletion with nobody watching.

## 6. Deliberately not done

- **Per-tool `alwaysLoad`.** Would put `computer_run`'s schema in every session
  from turn one and make startup wait up to five seconds, whether or not the
  session touches a computer. The instructions string buys the same discovery
  for no standing cost. Reconsider only if transcripts still show Claude
  failing to find the run tool.
- **A per-step Stop poll.** The host keeps Escape armed for the length of a run
  and any acting step consumes the latch, so a run of clicks already honours
  Stop. A run of only sleeps and snapshots would not notice until its next
  acting step. Fixing that properly is a host change, not a Node one.

## 7. Gaps in this research

- The `isConcurrencySafe` mapping is not officially documented and was not
  confirmed for plugin-bundled servers specifically.
- No official statement that a serial batch continues past a failure; inferred
  from changelog wording about the Bash-only cascade being removed.
- ToolSearch's ranking algorithm is undocumented throughout.
- The design panel that was to score three competing approaches never ran (the
  model's weekly limit), so the shipped design was judged against two
  independent code maps rather than an adversarial review.
- No real-window test suite has been run against 0.4.0. Verification was 31
  logic checks over the run engine with a stubbed caller, plus 15 over the live
  handshake and tool list.
