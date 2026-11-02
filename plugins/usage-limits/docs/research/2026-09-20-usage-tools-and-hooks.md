# Findings from the session that commissioned this research (2026-09-20)

Observed live in one Claude Code session on Fable 5.1 with six Sonnet research
subagents running, and worth more than any idea below because each is a
measured defect in what the plugin already does.

1. The local estimate runs hot. With the account snapshot 14 to 24 minutes old,
   the brief said 63%, then 69%, then 76%; Gev's own reading at the 63% moment
   was 50%; the next fresh snapshot came back at 59%. The extrapolation from
   local transcript history priced roughly 1.1M subagent tokens, all Sonnet, at
   the session's own Fable rate. Price each subagent transcript at the model
   named inside it, and say "floor" only when the floor is actually below the
   likely reading.
2. A relay or defer armed on that floor arms early. Arm only on a fresh account
   reading, never on the extrapolated figure, and say which one it used.
3. Readings jitter between sources. Within three minutes the same window read
   14%, 30%, 20%, then 25, 26, 27, 28 across parallel hook calls. When two
   sources disagree by more than five points, name both rather than averaging.
4. The fan-out line repeated. Six parallel Agent calls produced six near
   identical "Before this fan-out" lines (about 360 words for one fact). Fixed
   in this commit: one line per reading per session, repeated only when the
   number moves by more than a point or two minutes pass.
5. The standard brief carried about 110 words of standing instruction on every
   prompt (opener rules, the binding-window warning, the closing rule). Cut to
   about half in this commit with the same instructions; the remaining saving
   is to say the full form once per session and a short form after.
6. The mode line said "Running opus/xhigh (settings)" on the first prompt of a
   Fable session and "fable/xhigh" on the second. The first brief reads the
   settings file before the live model is known; say "settings" only until the
   session model is seen, then drop the parenthetical.
7. The statusline JSON's prompt_cache object arrives on every refresh and is
   unused (see the ranked ideas below). It is the cheapest new signal there is.

# Usage/cost tooling landscape vs. usage-limits — September 2026

Primary sources only. Anything not independently confirmed is marked UNVERIFIED.
Plugin source read at `C:\Users\OWNER\Downloads\claude-code-usage-limits` (README.md,
`skills/usage-limits/SKILL.md`, `skills/usage-limits/references/tactics.md`, `git log`).

---

## 0. What usage-limits already does (baseline, so the gap analysis below doesn't repeat it)

- Before-prompt budget line (`UserPromptSubmit` hook, `brief.js`): binding window, % used, turns-of-headroom,
  reset time, other windows, session tally so far. Mid-turn `pulse.js` re-costs every 2 min. `stop.js` /
  `sessionend.js` print what the reply and session cost, to the user only (not into context).
- Reads Claude Code's own cache (`cachedUsageUtilization` in `~/.claude.json`) first; falls back to the same
  OAuth usage GET Claude Code makes for `/usage`, kept in `usage-limits-live.json`; never re-derives what
  Claude Code already computed.
- Pace/turn-cost measured from local `~/.claude/projects/**/*.jsonl` transcripts (own + subagents), cached 60s.
- Plan tier detection (`claude_pro`/`claude_max`/`default_claude_max_5x`/`_20x`/`claude_team`/`claude_enterprise`),
  per-model weekly windows, credits on/off handling, forecast (`--forecast N`), recommend (`--recommend`),
  `lowpower.js` (writes `effortLevel`/`model` in settings.json for new sessions).
- Four budget modes (`max`/`high`/`standard`/`off`) with a measured token-cost-per-mode ledger; `--cap` ceiling
  that refuses fan-out (`Agent`/`Task`/`Workflow`) past a set percentage; floor/ceiling/pin/decline/undo/history.
- Panel (`panel.js --open`, tmux/WT/WezTerm/kitty/zellij/iTerm2 split pane) and status line (`statusline.js`),
  both drawn in Claude Code's own colours, chained ahead of any pre-existing status line.
- Relay: schedules a one-shot OS task (Windows ScheduledTasks, `StartWhenAvailable`+`WakeToRun`) to resume or
  notify after a limit reset, carrying a written continuation note; Computer-Use-gated "are you at the
  keyboard" check; Codex equivalents (`codex queue --thread`, `codex exec resume`).
- Voice: local stylometric profile (counters + ≤2 kept lines, no model call) so the relay's resumption prompt
  reads like the user.
- Codex support (reads `~/.codex/sessions` rollouts directly, no child process); a Codex-only AGENTS.md-block
  fallback because Codex's plugin system carries no working hook engine as of `codex-cli 0.151.0-alpha.7.2`
  (repo's own finding, not third-party).
- Antigravity/Gemini CLI install (`install-antigravity.js`) using `PreInvocation`/`PreToolUse`; explicitly
  reports Antigravity's remaining quota as unreadable rather than inventing a number (1.23.0 changelog).
- VS Code extension (own `vscode/` dir) mirroring the panel/status line/sessions list in the sidebar.
- Deliberately does NOT ship the "caveman"/terse-output skill after measuring it against Claude Code's built-in
  Concise output style and a JetBrains A/B test (documented in the README's own 1.23.0 section).

---

## 1. The competitive landscape

### 1.1 ccusage — github.com/ccusage/ccusage (moved from ryoppippi/ccusage; old URL 301s)

- **License**: MIT (confirmed via `apps/ccusage/LICENSE` — root repo shows `NOASSERTION` on the GitHub API only
  because it's a monorepo and GitHub's detector doesn't walk into `apps/ccusage/`).
- **Stars**: 18,656 (GitHub API, live).
- **Reads**: local JSONL session logs from Claude Code (and, per its own README, Codex, OpenCode, and others) —
  no network call, no OAuth token.
- **Shows**: `daily`/`monthly`/`session` cost-and-token reports, a `blocks` view that reconstructs the 5-hour
  billing windows from transcripts, `statusline` integration mode, JSON output, model breakdown, `--no-cost`.
- **Best idea**: the `blocks` command is the closest thing on the market to usage-limits' own window arithmetic
  — it's a retrospective reconstruction of 5-hour billing windows purely from transcripts, which is exactly the
  fallback usage-limits uses when Claude Code's own cache is stale (its "rebuilt figure" logic). ccusage is the
  de facto standard data layer: `ccusage/mcp` exposes it as an MCP server, and viberank's submission CLI reads
  ccusage's own JSON as its input format.
- **Integrate?** Not the reader (usage-limits already reads the same JSONL directly and doesn't want a
  dependency), but the CLI's `--no-cost` flag and its "blocks" terminology are worth aligning on for
  shell-out interop — e.g. accepting `ccusage`'s JSON as an alternate input to `usage.js --json` costs nothing
  in the injected line and helps anyone piping between the two tools. Low value, near-zero token cost.

### 1.2 Claude-Code-Usage-Monitor / `claude-monitor` — github.com/Maciek-roboblog/Claude-Code-Usage-Monitor

- **License**: MIT. **Stars**: 8,715 (GitHub API).
- **Reads**: local JSONL transcripts primarily; optionally captures the official `rate_limits` block Claude
  Code's own statusline hook receives; has an experimental path onto the OAuth usage API (same endpoint
  usage-limits uses, and the same one that returns persistent 429s per open issues — see §3).
- **Shows**: a Rich-terminal live dashboard: progress bars, burn-rate analytics, daily/monthly/session views,
  and — its most distinctive feature — **P90-based limit auto-detection**: for a "custom" plan with no known
  token ceiling, it infers the ceiling from the 90th percentile of your own historical peak usage rather than
  asking you to type in a number.
- **Best idea, and the one worth taking**: **P90 auto-detection of an unknown plan's ceiling.** usage-limits
  currently requires a readable plan string (`claude_pro`, `claude_max`, etc.) from Claude Code's own cache;
  when that's absent or on a plan the pricing table has never seen, the report already refuses to invent a
  number rather than guess (documented in its own "How accurate is it" section). A P90-over-recent-windows
  fallback — computed from the same local transcripts usage-limits already scans for pace — would let it give
  a *bounded estimate* instead of "unknown" on a brand-new plan tier, with the estimate clearly labelled as
  inferred. This is a script-side change only (a new function in `usage.js`), not a new line in the budget
  brief, so it costs nothing per-turn.
- Also worth noting: it labels every number with a provenance tag (`official` / `local_estimate` /
  `experimental`) so downstream consumers know which to trust — the same discipline usage-limits already
  applies with "About 41%" vs. an exact reading, just made into a queryable field. Cheap idea, already close
  to done in spirit; formalizing a `source` field on `usage.js --json` output would help third-party tools
  (like a future viberank submission) trust the number without re-deriving it.

### 1.3 ccstatusline — github.com/sirmalloc/ccstatusline

- **License**: MIT. **Stars**: 12,960 (GitHub API).
- **Reads**: the statusline JSON on stdin (model, cwd, cost, context_window, git via its own shell-outs);
  does not scan transcripts or call any usage API itself.
- **Shows**: 70+ configurable widgets (model, git branch/PR/conflicts, token speed, weekly model usage, block
  timer, compaction counter, cache hit rate, custom shell-command widgets) through an interactive React/Ink
  TUI editor with live preview, multiple saved status-line profiles, and "Powerline flex mode" (right-aligned
  or width-absorbing segments in a Powerline layout).
- **Best idea**: the **visual TUI configurator** with drag/reorder/live-preview. usage-limits' status line is
  configured by env vars and CLI flags (`USAGE_LIMITS_ASCII`, `--no-chain`, etc.) — functional but not
  discoverable.
- **Integrate?** A `statusline.js --configure` interactive mode (Node's built-in `readline`, no new
  dependency) that walks through the existing env vars visually would raise discoverability without adding
  a single token to the injected budget line — it's a setup-time tool, never runs during a turn. Medium value,
  zero token cost. Not worth cloning the 70-widget system itself; usage-limits' status line has one job
  (windows, not git/PR/context — those are Claude Code's own footer badges already, per the statusline doc).

### 1.4 claude-hud — github.com/jarrodwatts/claude-hud (28,073 stars; MIT) — note several same-named forks/clones exist (hcross, roy-tong, barkleesanders, alwinpaul1's "enhanced" fork, GaoSSR's Rust "best-claude-hud"); jarrodwatts/claude-hud is the highest-starred original.

- **Reads**: the statusline JSON plus the session transcript (for tool/subagent activity), via Claude Code's
  native statusline API — not a hook, not a separate terminal pane.
- **Shows**: context-usage bar, live **tool-call and subagent activity** ("watch Claude read/edit/search files
  as it happens"), todo-list completion progress, session duration, git info — all as a *live operational*
  view rather than a cumulative-cost view.
- **Best idea**: **live subagent/tool activity in the same surface as the usage bars.** usage-limits' panel
  already tracks "working/idle" per session via hook-set activity marks (`activity.js`), but only at the
  session level, not per-tool-call. Showing *which tool is running right now* next to the budget numbers is
  the single most useful thing claude-hud does that usage-limits doesn't.
- **Integrate?** This is genuinely worth taking, but carefully: it must be a **panel/status-line-only**
  addition (both already run outside the model's context — the panel is a separate process, and the status
  line costs "about a tenth of a second" per the README and is read by a human, not injected). It must
  **never** become a line in the before-prompt budget brief, since per-tool-call detail is the opposite of
  what a token-efficient budget line should carry. Concretely: extend the existing `PostToolUse`/`PreToolUse`
  activity-marking hooks (already firing for the "working" dot) to also drop the current `tool_name` into
  the same activity file `activity.js` already writes, and have `panel.js`/the VS Code sidebar render it next
  to the spinner. Cost: a few bytes per hook invocation to an already-open file, zero added tokens to the
  model's context. High value to a person watching the panel; irrelevant to "pace Claude's own decisions,"
  which is usage-limits' actual differentiator — so rank this as a panel nice-to-have, not a core budget-line
  change.

### 1.5 CCometixLine — github.com/Haleclipse/CCometixLine (3,459 stars; **no LICENSE file found** — `api.github.com/repos/Haleclipse/CCometixLine/license` returns 404, so it is public-source but not under any stated open license)

- Rust statusline tool, same stdin-JSON model as ccstatusline; git integration, "usage tracking," interactive
  TUI config, and — notably — a **context-warning disabler / verbose-mode enabler via binary patching** of
  Claude Code itself. That patching behaviour is a red flag for a token-efficient, minimal-footprint plugin
  like usage-limits to ever adopt or depend on; not recommended for integration. No further action.

### 1.6 ccflare — github.com/snipeship/ccflare (1,047 stars; MIT) and the "better-ccflare" forks

- A **proxy/load balancer**, not a usage reporter: it multiplexes requests across several Claude accounts'
  OAuth credentials, keeping full request history, per-account rate-limit state, and a web dashboard.
  Different problem entirely from usage-limits (which paces *one* account's spend inside Claude's own
  context) — it's closer to what a fleet operator running many seats would want.
- **Best idea relevant here**: **per-account rate-limit state tracked across a pool**, which is the
  multi-account analogue of usage-limits' existing "two Claudes sharing one window" split-detection
  (`Sharing 2 sessions... splitting this budget 75%/25%`). Not worth building a proxy for, but the *concept*
  — attributing a shared limit's drain across more than one identity — is already implemented in usage-limits
  for sessions on one machine; ccflare's dashboard is the same idea generalized to accounts, which is out of
  scope for a plugin that intentionally has "nothing uploaded" and reads no credentials.
- **Integrate?** No. Different product category (proxy vs. in-context advisor); adopting a proxy would
  contradict the "nothing is uploaded... token never written to disk" design principle already in the README.

### 1.7 tokscale — github.com/junhoyeo/tokscale (5,494 stars; MIT) (note: `IvGolovach/tokscale`, `Stars1233/...`, `Thegreatsura/...`, `ben-vargas/ai-tokscale` are all 0-star forks of the same project)

- **Reads**: local usage logs across *many* agent CLIs at once (OpenCode, Claude Code, Codex, Gemini CLI,
  Cursor, Amp, Factory Droid, Kimi, and others) — the broadest cross-tool reader found in this survey.
- **Shows**: 10 interactive views (Overview/Usage/Models/Daily/Hourly/Monthly/Sessions/Projects/Stats/Agents),
  a global public leaderboard, a 2D/3D "contribution graph" (GitHub-style), and — its most distinctive
  feature — **LLM-generated session summarization**: it uses a model to title and categorize each session,
  then clusters related sessions into "high-level tasks" so token spend maps to *what was built*, not just
  *when*.
- **Best idea**: the session-clustering-into-tasks idea is genuinely novel versus everything else in this
  survey, but it costs a model call per session to generate, which is precisely the kind of spend
  usage-limits exists to prevent. **Do not integrate as designed.** A cheaper, no-model-call version — tagging
  sessions by their working-directory/project the way usage-limits' own "Projects in the weekly window" table
  already does — is the version worth keeping, and usage-limits already has it.
- Cross-agent breadth (14+ CLIs) is the one thing worth flagging as a gap: usage-limits supports Claude Code
  and Codex; tokscale (and viberank, below) support more. Given the "token-efficient" design constraint, adding
  a third host's arithmetic is a script-side cost (one more reader module), not a context-line cost, so it's
  a reasonable future addition *if* a user actually runs one of those hosts — not worth doing speculatively.

### 1.8 viberank — github.com/sculptdotfun/viberank (117 stars; MIT) — viberank.app

- A public leaderboard: `npx viberank-cli` reads local **ccusage** output (not raw transcripts itself) and
  submits it, ranking users by lifetime cost/tokens across Claude Code, Codex, and Gemini CLI. GitHub OAuth
  for a verified badge.
- **Best/only idea relevant to usage-limits**: none worth adopting. It's an opt-in public upload of exactly
  the kind of data usage-limits' design explicitly refuses to send anywhere ("Nothing is uploaded"). Mentioned
  here only because the task asked about it; no integration recommended, and it would contradict an existing,
  stated design principle to add upload capability.

### 1.9 macOS/menu-bar apps (as a class): ClaudeUsageBar (free, OSS, no GitHub license badge confirmed),
SessionWatcher ($6.99, proprietary), Usagebar (proprietary), ClaudeBar (github.com/tddworks/ClaudeBar,
1,496 stars, **no license file** — `"license": null` on the API), Claude-Usage-Tracker
(hamed-elfayome, Swift/SwiftUI), claude-limits (figueiredouc, MIT, 1 star), Claude-Monitor (RISCfuture),
"ClaUse Bar" (App Store).

- All read the same two sources usage-limits does: Claude Code's own cached percentages and/or the same OAuth
  usage endpoint, then render native OS chrome (menu-bar icon, notifications at 50/80/90%).
- **Best idea across the class**: native OS-level notifications at threshold crossings, independent of
  whether a terminal is even open. usage-limits' relay already covers "notify when the window resets and work
  is pending"; a **native notification at 80/90% used**, on Windows via `BurntToast`/`msg`-style toast (already
  has a notification primitive for the relay's own "one-shot wake" flow) rather than only the in-context
  budget line, would help the case the README itself flags as unhandled: someone not looking at the terminal
  when the wall is 10 minutes out. This is genuinely orthogonal to the in-context line (it fires independent
  of any prompt) and costs zero tokens since it's OS-level, not model-context. Worth doing.
- ClaudeBar and ClaudeUsageBar's differentiator (tracking *multiple* agent products — Codex, Antigravity,
  Gemini — from one menu-bar icon) is already matched by usage-limits' Codex/Antigravity/Gemini support, just
  without the persistent OS icon.

### 1.10 ECC plugin (`~/.claude/plugins/cache/ecc/ecc/2.2.1`) — cost-tracking and token-budget-advisor skills

- **`cost-tracking`**: reads `~/.claude/metrics/costs.jsonl`, written by ECC's own `stop:cost-tracker` hook —
  a **cumulative-snapshot-per-session** log (each row is a running total; you must take the latest row per
  `session_id`, never sum every row — the skill's own "Anti-Patterns" section warns about this explicitly).
  Fields: `timestamp`, `session_id`, `transcript_path`, `model`, `input_tokens`/`output_tokens`,
  `cache_write_tokens`/`cache_read_tokens`, `estimated_cost_usd`. This is a *different* data source than
  usage-limits (a hook-maintained JSONL vs. transcript-scanning), and it depends on ECC's own hook being
  installed and enabled — not something usage-limits should read (it isn't present without ECC), but the
  **cumulative-row discipline** is a reminder worth double-checking usage-limits' own `tally.js` against
  (it already reads "only the bytes of the transcript written since the previous reply," which is the
  delta-based equivalent done correctly). No action needed; confirms the existing design is sound.
- **`token-budget-advisor`**: an entirely different mechanism — it intercepts *before Claude answers* and
  offers the user a 25/50/75/100% "response depth" choice, estimated with a **heuristic, no-tokenizer**
  formula (`words × 1.3` for prose, `chars / 4` for code) and a complexity-based output multiplier table.
  Explicitly heuristic (~85–90% accuracy, ±15%, stated in its own SKILL.md). **Not recommended for
  integration**: usage-limits' own design principle is "a mode never lowers the quality of the work... change
  the ORDER of the work, never the amount," which is the opposite of asking the user to pre-select a
  truncated answer depth. Also adds a per-prompt menu, which is a token cost at the exact chokepoint (before
  every answer) usage-limits is engineered to keep to one line.
- **`ecc-tools-cost-audit`** and **`context-budget`**: the latter is worth a mention even though it's a
  different problem (auditing *system-prompt* bloat from agents/skills/MCP tool schemas, not usage-window
  budget) — it's the only thing surveyed that measures the token cost of the *tool ecosystem itself*
  (~500 tokens per MCP tool schema, "a 30-tool server costs more than all your skills combined"). This is
  directly relevant to usage-limits' own stated constraint ("it injects text into Claude's context before
  every prompt... any idea that adds words to that line must earn them") — see integration idea #1 below.

### 1.11 anthropics/claude-plugins-official (Apache-2.0; 36,552 stars) — no dedicated cost/budget plugin

- Confirmed by listing `plugins/`: 39 plugins, none named or described as cost/usage/budget tracking. The two
  closest are:
  - **`receipts`** — generates a personal "impact report" from local transcripts (files touched, commits, PRs,
    per-project share of usage) and **deliberately omits dollar figures and "hours saved"**, stating in its
    own README: *"Each of those would be a guess dressed up as a measurement, and one bad number discredits
    the rest of the page."* This is the same epistemic discipline usage-limits already applies (marking
    rebuilt figures "~41%", refusing to cap an impossible reading at 100%, etc.) — confirms the standard
    Anthropic itself holds is the one usage-limits already meets. No gap to close.
  - **`session-report`** — the one that actually does cost/efficiency work: an `analyze-sessions.mjs` script
    over `~/.claude/projects/**/*.jsonl` producing a static local HTML report (via a `<script id="report-data"
    type="application/json">` template) covering **cache hit rate, "cache-break clustering," expensive
    individual prompts (>2% of total tokens), and per-project/per-subagent-type breakdowns**, with cache-hit
    below 85% flagged as anomalous. This is a retrospective analysis artifact (an HTML file), never injected
    into context — the opposite delivery mechanism from usage-limits, and a reasonable one to point users at
    for a "why was last week expensive" deep-dive that a before-prompt line shouldn't try to answer. Not worth
    reimplementing; worth *mentioning* to a user who wants forensic detail usage-limits' one-line brief won't
    give them.
  - No plugin here does anything close to "put the budget in the model's own context before it decides what
    to do" — that positioning appears genuinely unclaimed by the official directory as of today.

### 1.12 Fast mode — official docs (code.claude.com/docs/en/fast-mode, platform.claude.com/docs/en/build-with-claude/fast-mode)

- **What it is**: a same-model, faster-inference configuration for Opus only (not a different model). Toggled
  with `/fast` or `"fastMode": true` in settings.
- **Models**: Opus 5 and Opus 4.8 only. Not Sonnet, Haiku, or Opus 4.7 (deprecated 25 Jun 2026, removed 24 Jul
  2026). Opus 4.6 silently ignores `speed:"fast"` and bills standard.
- **Billing**: flat $10/MTok input, $50/MTok output, across the *full* context window (i.e., not just >200k
  tokens) — a straight multiplier over Opus's standard $5/$25 rate table cited in usage-limits'
  `tactics.md`. Fast mode spend is drawn from **usage credits**, not the plan's included subscription
  allowance — the doc states this explicitly: *"Fast mode usage draws directly from usage credits, even if
  you have remaining usage on your plan."* **This means fast mode does NOT consume the 5-hour/weekly rate-limit
  windows usage-limits tracks at all** — it's billed separately, has its own dedicated rate-limit pool shared
  across all fast-mode-capable Opus models, and only shows up as spend on the Usage credits page (or
  Console/Cost API with `Speed: Research Preview` grouping), never in `rate_limits.five_hour`/`seven_day`.
- **Cache impact**: confirmed twice (Console-side considerations list, and usage-limits' own `tactics.md`
  independently lists it) — switching fast↔standard invalidates the prompt cache; the request carries the
  `fast-mode-2026-02-01` beta header (API side) which is part of the cache key. The *first* turn after
  enabling fast mode inside an existing long conversation pays full fast-mode-priced input for the entire
  context, so the doc's own advice is to enable it "at the start of a session," which is the same "choose
  effort at the start of a session" advice `tactics.md` already gives for effort-level switches — same
  underlying mechanism (cache-key change), same mitigation.
- **Detection, exact field**: the Claude Code statusline JSON carries a **top-level boolean `fast_mode`**
  (confirmed verbatim in the official statusline doc's full JSON schema:
  `"fast_mode": false,` at the top level, next to `effort` and `thinking`). **usage-limits already reads
  this** — `skills/usage-limits/scripts/feed.js` line 126: `fastMode: input.fast_mode === true`. No hook
  receives `fast_mode` (confirmed absent from every hook's common/event-specific field list in §2) — the
  statusline is the only place a script sees it live, which is exactly where usage-limits already looks.
  Nothing to add here; this is a confirmation that the existing implementation is already using the correct,
  and only, official signal.
- **Rate limits**: separate dedicated pool; response headers `anthropic-fast-input-tokens-limit`,
  `-remaining`, `-reset`, `anthropic-fast-output-tokens-limit`, `-remaining`, `-reset` (platform docs, quoted
  verbatim). Response body carries `usage.speed: "fast"|"standard"` so a script with API-level access (not
  Claude Code's own hooks, which don't surface this) could tell after the fact which speed actually ran.

---

## 2. Official docs: hooks, exact fields (code.claude.com/docs/en/hooks)

**All 32 hook event names, verbatim, cross-checked against a second independent doc mirror
(github.com/pleaseai/claude-code-docs) which agreed on every name:**

`SessionStart`, `Setup`, `UserPromptSubmit`, `UserPromptExpansion`, `PreToolUse`, `PermissionRequest`,
`PermissionDenied`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `Notification`, `MessageDisplay`,
`SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted`, `Stop`, `StopFailure`, `TeammateIdle`,
`InstructionsLoaded`, `ConfigChange`, `CwdChanged`, `DirectoryAdded`, `FileChanged`, `WorktreeCreate`,
`WorktreeRemove`, `PreCompact`, `PostCompact`, `PreModelSwitch`, `PostModelSwitch`, `Elicitation`,
`ElicitationResult`, plus `SessionEnd` (33 total; confirmed in both fetches). usage-limits hooks into
`UserPromptSubmit`, (mid-turn pulse, likely `PostToolUse` or a timer — not confirmed which), `Stop`,
`SessionEnd`; it does **not** currently use `PreCompact`, `PreModelSwitch`/`PostModelSwitch`, or
`SubagentStop` directly for its own hook wiring (subagent transcripts are read by scanning the file tree, not
via a `SubagentStop` hook) — see integration idea #4.

**Common fields present on every hook (CONFIRMED, verbatim, cross-checked on both mirrors):**
`session_id`, `prompt_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `permission_mode`, `hook_event_name`,
`agent_id` (subagent only), `agent_type` (subagent only), `effort` (object, `effort.level`).

**Event-specific fields, CONFIRMED on both sources:**
- `UserPromptSubmit`: `user_prompt`.
- `PreToolUse`: `tool_name`, `tool_input`, `tool_use_id`.
- `PostToolUse`: `tool_name`, `tool_input`, `tool_use_id`, `tool_result`.
- `Stop`: `last_assistant_message`, `stop_reason` (values include `end_turn`, `max_tokens`, `stop_sequence`).
- `SessionEnd`: `end_reason` (values include `clear`, `resume`, `logout`, `prompt_input_exit`, `other`).
- `SessionStart`: `start_reason`.

**UNVERIFIED / likely fabricated — do not build on these:** a first-pass fetch of the same official page
claimed `UserPromptSubmit` also carries `prompt_tokens`, `PostToolUse` also carries `tool_result_tokens`, and
`Stop` also carries `input_tokens`/`output_tokens`/`cache_creation_input_tokens`/`cache_read_input_tokens`.
A second, independent fetch of a mirror of the same doc **did not show these fields** in the same events'
schemas or field lists. This matters directly for usage-limits: if `Stop` really carried per-turn token
counts, `stop.js` could skip re-scanning transcript bytes entirely. It appears it cannot — **no hook event
exposes token counts or cost directly; only the statusline JSON does** (see §3). Flagging this explicitly
because the task asked for exact field names and this is exactly the kind of claim that needed a second
source before repeating it. Recommendation: keep the current transcript-byte-diffing approach in `stop.js`;
do not attempt to read cost off the `Stop` hook's stdin.

---

## 3. Official docs: statusline JSON (code.claude.com/docs/en/statusline)

This is the single richest data source found in this whole survey, and usage-limits is already the
statusline for most users who install it — meaning every field below is *already being handed to it for
free*, on every statusline refresh, with no transcript scan and no network call.

**Update triggers** (verbatim from the doc): a new assistant message arrives; `/compact` finishes; permission
mode changes; vim mode toggles; the `command` setting changes; a `refreshInterval` timer elapses;
**"a rate-limit window in the data your script last received reaches its `resets_at` time"**; **"a warm
prompt cache in the data your script last received reaches its `expires_at` time."** Those last two are a
free, event-driven "the window just reset" / "the cache just went cold" signal that costs nothing to listen
for — Claude Code itself schedules the re-run.

**Full top-level field list, verbatim field names:**
`cwd`, `session_id`, `session_name`, `prompt_id`, `transcript_path`, `model.id`, `model.display_name`,
`workspace.current_dir`, `workspace.project_dir`, `workspace.added_dirs`, `workspace.git_worktree`,
`workspace.repo.host`/`.owner`/`.name`, `version`, `output_style.name`,
`cost.total_cost_usd`, `cost.total_duration_ms`, `cost.total_api_duration_ms`,
`cost.total_lines_added`, `cost.total_lines_removed`,
`context_window.total_input_tokens`, `context_window.total_output_tokens`,
`context_window.context_window_size`, `context_window.used_percentage`,
`context_window.remaining_percentage`, `context_window.current_usage.{input_tokens,output_tokens,
cache_creation_input_tokens,cache_read_input_tokens}`,
`exceeds_200k_tokens`, **`fast_mode`** (boolean), `effort.level`, `thinking.enabled`,
**`rate_limits.five_hour.{used_percentage,resets_at}`**, **`rate_limits.seven_day.{used_percentage,
resets_at}`**, **`rate_limits.spend_limit.{used_percentage,resets_at}`** (behind a Claude apps gateway;
`used_percentage` can exceed 100; requires Claude Code ≥2.1.251),
**`prompt_cache.{warm,caching_observed,ttl,expires_at,requests,misses,expected_rebuilds,hit_ratio,
cache_write_tokens,miss_recache_tokens,last_miss_at,last_miss_cause,miss_causes,recache_tokens_if_cold}`**
(requires ≥2.1.251; `last_miss_cause.causes` values include `tools_changed`, `system_prompt_changed`,
`ttl_expired_5m`, `likely_server_side`; requires ≥2.1.260 for the cause breakdown),
`vim.mode`, `agent.name`, `pr.number`/`.url`/`.review_state`/`.kind`,
`worktree.name`/`.path`/`.branch`/`.original_cwd`/`.original_branch`.

**What usage-limits already reads from this** (confirmed by grepping `feed.js`): `rate_limits` (whole
object, so `spend_limit` comes along for free), `effort.level`, `context_window.used_percentage`,
`fast_mode`. **What it does NOT currently read: `prompt_cache`.** That's the gap — see integration idea #1.

**`used_percentage` formula, stated exactly**: `(input_tokens + cache_creation_input_tokens +
cache_read_input_tokens) / context_window_size` — output tokens are excluded. Worth knowing because it means
"context window used%" and "how much this turn will cost" are not the same number; a long-output turn on a
small context can still show low `used_percentage` while being expensive.

**`rate_limits` availability caveat, stated exactly**: "appears only for claude.ai Pro and Max subscribers, or
behind a Claude apps gateway that sets a spend limit for you, and only after the first API response in the
session." This means on Team/Enterprise seats without a gateway spend limit, the statusline itself carries no
rate-limit numbers at all — usage-limits' fallback to the OAuth `/usage`-equivalent read is the only way it
gets numbers in that case, and that endpoint is the one with the open 429-rate-limiting issues (see next
paragraph), not a hook or statusline problem.

**Rate Limits API (platform.claude.com/docs/en/manage-claude/rate-limits-api) — a different, org-level thing,
noted so it isn't confused with the above.** `/v1/organizations/rate_limits` and the workspace variant return
*configured* limits (`requests_per_minute`, `input_tokens_per_minute`, `output_tokens_per_minute`,
`enqueued_batch_requests`, grouped by `model_group`/`batch`/`token_count`/`files`/`skills`/`web_search`), not
a subscriber's live consumption — it needs an Admin API key with `org:admin` scope. Not usable by a
Pro/Max individual account, and not what a personal usage tracker should try to call. Confirmed present only
to close off a possible false lead in the research brief.

**The OAuth usage endpoint itself (`/api/oauth/usage`) has open, unresolved GitHub issues** (anthropics/
claude-code#31021, #31637) reporting it returns persistent HTTP 429 with a backoff that caps at 300s and
never recovers within a session, and that a `User-Agent: claude-code/<version>` header is required to avoid
landing in an even more aggressively-limited bucket. usage-limits' README already documents its own backoff
behavior for exactly this failure mode ("offline that is one quick failure and then a widening backoff"),
so this is a confirmation the existing defensive design is warranted, not a new finding to act on — but it's
worth knowing the header requirement is load-bearing if the request code is ever touched.

---

## 4. Ranked integration ideas — value to a "let Claude pace itself" user × token cost to ship

Ranked by (value ÷ cost of the words it would add to the before-every-prompt line), since that line is the
one place in this plugin where every word is repeated on every turn.

| # | Idea | What it touches | Tokens added to the injected line | Value |
|---|------|------------------|-----------------------------------|-------|
| 1 | **Read `prompt_cache` off the statusline JSON it already receives** and fold `hit_ratio`/`last_miss_cause` into the *existing* cache-invalidation guidance already in `tactics.md` §5 — e.g. only mention "you just broke the cache" when `last_miss_cause.causes` actually fired, instead of the current static list of "what invalidates it." | `feed.js` (add ~4 lines reading fields already on stdin), maybe one clause in `brief.js` gated on an actual observed miss | **Zero** most turns (only prints when a miss was just observed); a single short clause when it does | High — turns a generic warning into a measured one, using data Claude Code is already handing over for free |
| 2 | **Native OS threshold notification** (80%/90%) independent of any prompt, borrowing the relay's existing notification primitive | new small script, wired off the same reading `pulse.js` already takes | **Zero** (notification, not context) | High — closes the "nobody's looking at the terminal" gap every menu-bar app exists to solve, at no per-turn cost |
| 3 | **P90 ceiling estimate for an unreadable/unknown plan tier** (from Claude-Code-Usage-Monitor), computed in `usage.js` from local transcripts, only surfacing when the plan string is genuinely unrecognized | `usage.js` fallback path | **Zero** on a known plan (the common case); on an unknown plan, replaces an existing "unknown" line with an equally short "≈" one | Medium-high — turns a dead end into a usable, clearly-labelled estimate, and only for the rare case |
| 4 | **Wire `SubagentStop` as an actual hook** instead of discovering subagent transcripts by file-tree scan, to mark them in `activity.js` the instant they finish rather than on the next poll | `hooks/hooks.json` + `activity.js` | Zero (hook JSON never enters model context) | Medium — tightens the panel's "N sessions working" and the mid-turn correction's timeliness for fan-outs, which the README already flags as the one gap ("eight of them once spent half a window in five minutes") |
| 5 | **claude-hud-style per-tool-call activity in the panel/status line only** (never the budget line) | `activity.js` write, `panel.js`/`view.js` render | Zero | Medium — nice-to-have for the person watching, explicitly not for Claude's own pacing |
| 6 | **`statusline.js --configure` interactive setup** (ccstatusline's visual-editor idea, scoped to usage-limits' existing env vars) | new setup-time script only | Zero (never runs mid-session) | Medium — discoverability, not runtime behavior |
| 7 | **Formalize a `source`/provenance field** (`official`/`rebuilt`/`estimate`) on `usage.js --json`, matching Claude-Code-Usage-Monitor's confidence tagging, so external tools consuming usage-limits' JSON don't have to re-derive trust the way the prose report already conveys it | `usage.js --json` output shape | Zero (JSON flag, not the injected line) | Low-medium — mostly helps interop/scripting, not the core user |
| 8 | **Accept ccusage's JSON as an alternate input** for anyone who already has it cached, to avoid a second transcript scan when both tools are installed | `usage.js` input path | Zero | Low — narrow audience (users running both tools) |
| 9 | **Point users at `session-report`'s HTML output for forensic "why was last week expensive"** questions, rather than trying to answer that in the one-line brief | documentation only (a line in the skill's "When to skip this skill" section, or a one-time suggestion when a session's cache-miss rate is unusually high) | A few words, only when genuinely warranted, and only once | Low-medium — right tool for a different question; keeps the existing tool from overreaching into a report it's not designed to produce |
| 10 | **Cross-account split (ccflare's idea) generalized from "sessions" to "identities"** | Out of scope | N/A | Low — would require reading/holding credentials for other accounts, directly against the "nothing is uploaded, no credentials read" design principle; not recommended even though the underlying concept (attributing a shared limit across more than one spender) is sound and already implemented for same-machine sessions |

**Top three by value-for-tokens, restated plainly**: (1) use the `prompt_cache` fields Claude Code is
already sending to the statusline script for nothing, since that's literally free data currently being
discarded; (2) an OS-level notification path that never touches the model's context at all; (3) hook
`SubagentStop` properly instead of polling, tightening exactly the fan-out blind spot the README already
names as a real incident. All three cost zero additional words in the per-prompt budget line, which is the
binding constraint the plugin holds itself to.

---

## 5. Notes on method / things marked UNVERIFIED above

- Hook JSON field claims for `Stop`/`UserPromptSubmit`/`PostToolUse` token/cost fields were checked against
  two independent renderings of the same official doc and disagreed; the token-field claims were dropped as
  unconfirmed rather than reported as fact (see §2).
- Star/license counts are live reads from `api.github.com` at time of writing (2026-09-20), not cached
  estimates; forks of the same project (tokscale, CCometixLine, viberank, claude-hud) were checked
  individually and the highest-starred canonical repo is the one cited.
- Menu-bar apps (SessionWatcher, Usagebar, "ClaUse Bar") are paid/closed products without a public repo to
  verify licensing or exact data source against; described from their own marketing copy only, flagged as such
  rather than stated as confirmed fact.
- Fast mode's billing-vs-rate-limit separation, the `fast_mode` statusline field, and the cache-invalidation
  behavior were each independently corroborated across code.claude.com and platform.claude.com, which agreed
  on all points checked.
