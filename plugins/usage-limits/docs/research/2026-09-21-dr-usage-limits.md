---
topic: How can the Claude Code plugin usage-limits (github.com/ridelink0/claude-code-usage-limits, local source C:\Users\OWNER\Downloads\claude-code-usage-limits, 1.36.0) be improved before a public release? Correctness of readings, token efficiency, competing tools, unattended-resume reliability (Windows + macOS), Codex parity, packaging/publishing hygiene, and the ten highest-value changes ranked by user value per token cost.
date: 2026-09-21
mode: thorough (orchestrated: direct codebase read of the local source + two in-repo prior research reports dated 2026-09-20, corroborated by four fresh web-research passes)
sources: local source tree (183 commits read via git log), skills/usage-limits/SKILL.md, README.md, feed.js/brief.js/relay.js/wake.js/agy-hook.js source, .claude-plugin/plugin.json, .codex-plugin/plugin.json, marketplace.json, package.json, hooks/hooks.json, .github/workflows/{test,publish}.yml, docs/research/2026-09-20-unattended-resume.md (53 sources, verify-stage 8/8 confirmed), docs/research/2026-09-20-usage-tools-and-hooks.md, plus 4 new web-research passes (code.claude.com/docs, learn.chatgpt.com/docs, openai/codex GitHub issues, docs.npmjs.com, Apple developer docs) totaling roughly 35 external primary sources
---

# usage-limits 1.36.0: what to fix before a public release

Everything below is grounded in the plugin's own local source (paths and line numbers given) or in a cited
official document. Anything a sub-agent could not confirm from a primary source is marked UNVERIFIED and
was not used to justify a recommendation on its own. Two in-repo research reports dated 2026-09-20 — written
by the same research pipeline against a slightly earlier commit — are treated as primary sources (they are
part of the checked-in repository at `docs/research/`) and are re-verified here against the current 1.36.0
code rather than repeated blindly; where a prior recommendation has since shipped, that is stated explicitly
rather than re-recommended.

## 1. Correctness of its readings against what Claude Code exposes in 2026

**What it reads, confirmed against the live code (`skills/usage-limits/scripts/feed.js:107-126`):**
`rate_limits` (the whole object, so `spend_limit` rides along free), `effort.level`, `context_window.used_percentage`,
and `fast_mode`. Each of these matches a field Anthropic's statusline JSON schema actually documents
(`code.claude.com/docs/en/statusline`, verified in the 2026-09-20 in-repo report against the doc's full
top-level field list). The plugin reads Claude Code's own cache (`cachedUsageUtilization` in `~/.claude.json`)
first and falls back to the same OAuth `/usage`-equivalent call Claude Code itself makes — it never re-derives
a number Claude Code has already computed, which is the correct posture given that endpoint's own documented
instability (`anthropics/claude-code#31021`, `#31637`: persistent HTTP 429s, backoff capped at 300s, a
`User-Agent: claude-code/<version>` header required to avoid a harsher rate bucket — the plugin's README
already documents matching defensive backoff behavior).

**What it deliberately does not do:** an earlier draft of the same doc claimed hook events (`Stop`,
`UserPromptSubmit`, `PostToolUse`) carry token/cost fields directly. A second, independent fetch of the same
official page did not show those fields, so the finding was dropped rather than repeated — correctly: no hook
event exposes token counts or cost, only the statusline JSON does. `stop.js`'s transcript-byte-diffing approach
(reading only the bytes written since the previous reply) is therefore the only correct way to cost a turn, and
it is the delta-based approach already in use.

**Fields it is not yet reading that Claude Code already sends it for free:** `prompt_cache` — the object
carrying `warm`, `hit_ratio`, `last_miss_cause.causes` (values like `tools_changed`, `system_prompt_changed`,
`ttl_expired_5m`) — is present on every statusline refresh (≥2.1.251, cause breakdown ≥2.1.260) and is
confirmed still absent from `feed.js` as of the current commit (`grep -n "prompt_cache" skills/usage-limits/scripts/feed.js` returns nothing). This is free, already-delivered data being discarded.

**Self-reported correctness bugs already on record** (from the session that commissioned the 2026-09-20 report,
i.e. measured defects, not speculation): a stale account snapshot (14–24 minutes old) caused the injected
brief to read 63%, 69%, then 76% across one session while the user's own fresh reading was 50%, then 59%;
parallel hook calls in the same three-minute window returned 14%, 30%, 20%, then 25–28%; six fanned-out
subagents each printed a near-identical ~360-word "before this fan-out" line. The 110-word standing
instruction and the fan-out repetition were both cut in the commit that produced that report; whether a
relay/defer can still arm on a stale extrapolated floor instead of a fresh reading was not re-verified in
this pass.

**Rate-limit availability caveat, worth restating precisely:** the statusline `rate_limits` block "appears only
for claude.ai Pro and Max subscribers, or behind a Claude apps gateway that sets a spend limit for you, and only
after the first API response in the session" (verbatim from the official doc, per the 2026-09-20 report). On a
Team/Enterprise seat with no gateway spend limit, the statusline carries no rate-limit numbers at all, and the
plugin's OAuth-endpoint fallback — the one with the open 429 issues above — is the only source of numbers in
that case. This is a real, documented gap in what Claude Code itself exposes, not a plugin bug.

## 2. Token efficiency of what it injects per prompt

The plugin's own discipline, stated in its README: "This plugin is not free. A mode called 'save tokens' that
still injects four hundred tokens of advice per turn is not saving anything." Verified concretely:

- `standard` mode: today's line, unchanged cadence.
- `high` mode adds a standing directive of "about 650 characters" on every prompt, making a `high` briefing
  "roughly 40% longer than `standard`" by the README's own measured claim — the plugin is explicit that
  picking `high` because the word sounds efficient and expecting a shorter line is a real user
  misunderstanding it tries to head off.
- `max` mode is the terse one: readings every 10 minutes, silent unless something decision-relevant moved.
- `off` mode: every hook returns before reading anything — no scan, no state write, no line.
- This is enforced as a test invariant, not just a claim: 712 tests include "the `max` line must never be
  longer than the `standard` line for the same reading" and "`off` must inject nothing at any percentage and
  any pressure," walked across the full 640-line stopping matrix (`README.md` Tests section; `test/mode.test.js`
  et al.).

**Where efficiency is still being left on the table:** the `prompt_cache` gap above is also a token-efficiency
finding, not just a correctness one — the fix (only mention "you just broke the cache" when
`last_miss_cause.causes` actually fired, instead of today's static list in `tactics.md` §5) adds zero tokens on
the common turn and replaces a generic warning with a measured one only when warranted. Similarly, a native
OS-level threshold notification (§3, §7 below) would cost literally zero injected tokens since it never enters
the model's context at all — it is the highest value-per-token-cost class of change available to this plugin by
construction.

## 3. What competing tools do better

This was researched in depth by the in-repo 2026-09-20 report (`docs/research/2026-09-20-usage-tools-and-hooks.md`),
re-checked here against the current commit rather than repeated wholesale. Headline comparisons, with current
status:

| Tool | Best idea | Status in usage-limits 1.36.0 |
|---|---|---|
| **ccusage** | `blocks` command reconstructs 5-hour billing windows purely from transcripts — the same fallback arithmetic usage-limits already does when Claude Code's own cache is stale | Already equivalent; not worth depending on ccusage as a library |
| **Claude-Code-Usage-Monitor** | P90-based auto-detection of an unknown plan's token ceiling from historical peak usage | **Still open.** `grep -n "p90\|percentile" skills/usage-limits/scripts/usage.js` returns nothing |
| **ccstatusline** | Visual TUI configurator (drag/reorder/live-preview) for status-line widgets, vs. usage-limits' env-var/flag configuration | **Still open**, a setup-time-only addition (zero per-turn cost) |
| **claude-hud** | Live per-tool-call activity next to the usage bars, not just session-level "working/idle" | **Partially done**: `hooks/hooks.json` now wires `SubagentStop` to `pulse.js` (confirmed in the live file) — this was the #4-ranked idea in the 2026-09-20 report ("wire SubagentStop as an actual hook") and has since shipped. Per-tool-call activity in the panel specifically (not the budget line) is still open |
| **tokscale** | Cross-agent breadth (14+ CLIs) and LLM-generated session clustering | Session clustering explicitly rejected (costs a model call per session, contrary to the plugin's own purpose); cross-agent breadth beyond Claude Code/Codex/Antigravity is a reasonable future addition only if a user runs one of those hosts |
| **ccflare** | Per-account rate-limit state across a pool of accounts | Not applicable — would require reading/holding other accounts' credentials, directly against the plugin's stated "nothing uploaded, no credentials read" design |
| **menu-bar apps (ClaudeBar, SessionWatcher, etc.)** | Native OS-level threshold notifications at 50/80/90%, independent of whether a terminal is open | **Still open** — this is the plugin's own most-repeated unhandled gap: the relay already covers "notify when the window resets," but nothing covers "notify at 80% used, right now, regardless of whether a prompt is in flight" |
| **anthropics/claude-plugins-official** | The official `receipts` plugin's epistemic discipline (never fabricate a dollar/hours-saved figure) | Already matched — usage-limits already marks rebuilt figures "~41%" rather than presenting them as exact |

## 4. Reliability of unattended resume

### Windows

Extensively researched already (`docs/research/2026-09-20-unattended-resume.md`, 53 sources, 8/8 verified
claims at high confidence). Summary re-checked against the current relay/wake code: the design is sound where
it matters (cross-directory `--resume` since v2.1.223 avoids the home-directory trust dialog;
`skipDangerousModePermissionPrompt` in settings.json pre-answers the bypass-permissions dialog;
`enableAllProjectMcpServers` pre-answers MCP approval; `DISABLE_AUTOUPDATER=1` avoids an update mid-launch).
The report's ranked blockers (arming from the user's home directory, Windows trust-key spelling, concurrent
`.claude.json` corruption from simultaneous wakes, login expiry with no unattended recovery path) each have an
exact fix documented there and are not re-derived here. The one item worth flagging as still open: whether the
relay ever arms on Claude Code's own possibly-stale local percentage rather than a confirmed-fresh reading
(§1 above) was not re-verified in this pass.

### macOS — a genuine, currently-unclosed gap

This is new ground for this pass. The plugin's own code already recognizes the core problem — `relay.js:956-960`
carries the comment: *"macOS ships `at` but launchd leaves atrun DISABLED by default, so the command succeeds,
prints a job id, and the wake never fires. Reporting ok for that is worse than not having it."* This is
independently confirmed: `atrun`'s launchd plist ships with `Disabled` set to `true` by default on modern macOS,
and enabling it requires `sudo launchctl enable system/com.apple.atrun` (or editing a SIP-protected plist) —
[ss64.com/mac/at.html](https://ss64.com/mac/at.html), corroborated by Apple Support Community threads. Apple's
own (archived) developer documentation goes further and explicitly deprecates the whole mechanism: *"Older
approaches, such as at jobs and periodic jobs are deprecated and should not be used"* —
[developer.apple.com/library/archive/.../ScheduledJobs.html](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html).

The plugin's actual fallback, confirmed in `wake.js:364-385` and `relay.js:962-969`, is a detached
`sh -c "sleep N && command"` background process — which the code itself labels with `warning: 'a reboot before
the reset will cancel this wake'`. There is no real macOS `launchd` LaunchAgent anywhere in the source (grep for
`launchctl`/`LaunchAgent`/`.plist` in `relay.js`/`wake.js` returns nothing beyond the diagnostic comment above).
So on macOS today, an unattended wake surviving a reboot, logout, or a killed shell simply does not exist — only
a same-session `sleep`.

The Apple-documented replacement is a `launchd` LaunchAgent (`~/Library/LaunchAgents/*.plist`) using
`StartCalendarInterval`, loaded via `launchctl bootstrap`/`load`. The same archived Apple doc confirms the sleep
semantics that matter for a relay: *"If you schedule a launchd job by setting the StartCalendarInterval key and
the computer is asleep when the job should have run, your job will run when the computer wakes up. However, if
the machine is off when the job should have run, the job does not execute until the next designated time
occurs."* `man launchd.plist` corroborates that missed intervals during sleep are coalesced into one firing on
wake, unlike cron. Three items remain genuinely unconfirmed by any primary Apple source found in this pass and
should not be assumed: whether a LaunchAgent can wake a fully-sleeping Mac by itself versus only firing once the
Mac wakes for another reason (Power Nap/`pmset` scheduled-wake may still be required — UNVERIFIED); whether a
LaunchAgent fires at all while the user is logged out (UNVERIFIED, only community sources found); and whether a
LaunchAgent invoking a plain shell command (as opposed to `osascript` driving Terminal.app, which the plugin's
`openWindowPosix()` already does at `wake.js:366-369`) triggers any TCC/Automation permission prompt
(UNVERIFIED).

**Concrete fix:** replace `schedulePosix()`'s `at`-then-sleeper logic on `darwin` specifically with a generated
`~/Library/LaunchAgents/com.usage-limits.wake-<id>.plist` carrying a `StartCalendarInterval` for the target
time, `RunAtLoad: false`, and a `launchctl bootstrap gui/$(id -u)` load call; unload/remove it in
`cancelSchedule()` the same way `scheduleWindows()` already unregisters a Windows scheduled task. This closes
the one dimension of "reliability on Windows and macOS" where Windows is thoroughly engineered and macOS is a
best-effort same-session sleep.

## 5. Codex parity

The plugin's own account (`docs/codex-controls.md`, `README.md`, `SKILL.md:757-764`) is candid and, per this
pass's web research, accurate: Codex has "the whole hook engine" in the binary, but on the version tested
(0.151.0-alpha.7.2) nothing fires a hook placed in any of the three documented locations, so the plugin installs
a marked block in `~/.codex/AGENTS.md` instead and re-reads the budget deliberately rather than automatically.

Fresh research narrows this further. `plugin_hooks` as a flag *name* is indeed superseded — current builds
(0.153.x–0.154.0-alpha.6.2) report it `removed`, but the actual engine now lives under a separate `hooks`
feature key reported `stable: true`, matching what the plugin observed. The official docs
([learn.chatgpt.com/docs/hooks](https://learn.chatgpt.com/docs/hooks)) confirm all twelve documented lifecycle
events and all three config locations the plugin already checked. But — and this is the part worth acting on —
those same docs state a previously-undocumented (from the plugin's side) trust gate: *"Project-local hooks only
load when the `.codex/` layer is explicitly trusted through the `/hooks` CLI interface."* Separately, three
independent, still-open `openai/codex` GitHub issues show hooks failing to fire for reasons unrelated to that
trust step: a root `plugin.json` silently disables all hooks with zero logging (`#39895`, reproducible on
0.149.0); the Codex Desktop app stopped running hooks entirely after an update (`#21639`, labeled
bug+regression, open); and project-level `.codex/hooks.json` is silently ignored inside a git worktree (`#27133`).
No release notes found (rust-v0.152.0 through rust-v0.155.0) mention a fix for any of this, so the plugin's
AGENTS.md fallback remains justified as of the newest tracked release — but the `/hooks` trust step is a cheap,
previously-untried lead worth testing before concluding the engine is unconditionally inert.

On the reporting side, usage-limits is already ahead of Codex's own built-in tooling: Codex's only interactive
usage command, `/status`, is criticized in an open feature request (`openai/codex#15281`) as showing only
"model name, current usage percentage (often inaccurate or stale), and working directory" with no 5-hour or
weekly window data at all. The `rate_limits` object that sometimes appears in `~/.codex/sessions` rollout JSONL
is reported `always null` in a separate open bug (`#14880`) — consistent with the plugin's own choice to read
local transcripts directly rather than trust that field. There is no official Codex equivalent of Claude Code's
statusline `rate_limits` object; third-party tools (`codex-cli-usage`, `codex-ratelimit`) independently arrived
at the same transcript-scanning approach usage-limits already uses.

## 6. Packaging and publishing hygiene

**What is already solid, verified directly:**
- `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `package.json`, and `vscode/package.json` versions
  are kept in lockstep by `tools/sync-version.js`, run from npm's `version` lifecycle script — confirmed current
  (all four read `1.36.0`).
- CI (`​.github/workflows/test.yml`) runs the test suite across a 3×3 matrix (ubuntu/windows/macos ×
  Node 18/20/22), checks the CLI starts post-build, and separately re-runs the packaging test against the
  newest npm to catch `npm pack --json` shape changes early.
- Publishing (`.github/workflows/publish.yml`) uses npm's own current best-practice: OIDC "trusted publishing"
  (`permissions: id-token: write`, no stored `NPM_TOKEN`) — confirmed as npm's documented recommendation
  ("When trusted publishing is available for your workflow, always prefer it over long-lived tokens" —
  [docs.npmjs.com/trusted-publishers](https://docs.npmjs.com/trusted-publishers/)), plus provenance attestations
  generated automatically for that workflow shape, plus a tag-vs-`package.json` version check and a
  skip-if-already-published guard.
- `LICENSE` is present and is a correctly formed MIT license.
- `.claude-plugin/plugin.json` correctly omits `category` (that field belongs only on a marketplace *entry*,
  per `code.claude.com/docs/en/plugin-marketplaces`, not on the plugin manifest itself — confirmed by direct
  fetch of the official schema page) while `.claude-plugin/marketplace.json` correctly supplies `name`, `owner`,
  and a `plugins` array with `name`+`source`+`category`+`tags` — this matches the documented schema exactly:
  "Only `name` is required if you include a manifest" for `plugin.json`, and marketplace entries "use the plugin
  manifest schema with all fields made optional, plus marketplace-specific fields (source, strict, category,
  tags)."
- 712 tests (`node --test`), MIT license, `"type": "commonjs"` declared explicitly in `package.json` (avoids
  ESM/CJS ambiguity) — genuinely above the median hygiene bar for a small CLI package.

**Gaps found, all verified directly against the local repo, not previously documented anywhere in the plugin's
own docs:**

1. **A stale, orphaned manifest pair at the repo root.** `plugin.json` at the repo root (not inside
   `.claude-plugin/`) currently reads version `1.34.1` — two releases behind the real `1.36.0` — with a
   different `description` field than either real manifest. Its last commit is `b1452c7 "1.34.1"`. A root-level
   `hooks.json` sits beside it, last touched at `7b50d6c "1.23.0"`, wiring Antigravity-specific event names
   (`PreInvocation`/`PreToolUse`) to `agy-hook.js`. Neither file is covered by `tools/sync-version.js` (which
   only touches `.claude-plugin/`, `.codex-plugin/`, and `vscode/`), and neither appears in the README's own
   "Layout" section, which documents `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, and
   `hooks/hooks.json` as the real files. These two root-level files are dead weight left over from before the
   per-host manifest convention existed. Before a public release, delete them (or, if some tooling still reads
   them, fold that dependency into `sync-version.js` so they cannot drift again) — a stale, wrong-version
   `plugin.json` sitting at the repo root is exactly the kind of file a naive marketplace scraper, a
   contributor's first `grep`, or an AI coding assistant reading the repo cold would find first and trust.

2. **Git commit history exposes the real name "Gerald" on 169 of 183 commits**, each with the personal email
   address `app.ridelink@gmail.com` — verified via `git log --format="%an" | sort | uniq -c`. A smaller number of
   commits use "Gev" (12) or "Ridelink" (1) with the same email; one uses "Codex <codex@openai.com>". The GitHub
   repository is confirmed publicly reachable right now (`github.com/ridelink0/claude-code-usage-limits`: MIT
   license badge visible, ~14 topic tags, commit history and files accessible — not private or 404), meaning
   this is not a future risk to head off but something already live. This directly contradicts a standing,
   repeatedly-stated instruction to never surface that name. Before treating the repository as a clean public
   artifact, either rewrite the historical author identity (the repository is a personal tool being prepared for
   release, so a history rewrite carries none of the collaboration risk it would on a shared repo with other
   contributors' clones) or, at minimum, fix it going forward and note in a `.mailmap` that the historical
   commits belong to the same pseudonymous identity as the rest.

3. **No confirmed pre-enable warning for hooks-bearing plugins.** Direct fetch of
   `code.claude.com/docs/en/plugins-reference` confirms hooks "can execute arbitrary shell commands, Node.js
   code, and external scripts," and confirms a workspace-trust dialog exists for *project-scope* plugin
   components — but does not state (and the fetching sub-agent could not find any page that states) that
   Claude Code shows an equivalent warning before a user enables a *marketplace-installed* plugin whose
   `hooks.json` will run `node` on every `UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`Stop`/`SessionEnd`. Given
   that gap in Claude Code's own UI, the honest thing for the plugin to do before a wider audience installs it
   is state this plainly itself: hooks run with the full permissions of the user running Claude Code (confirmed:
   "Handlers run in the current directory with Claude Code's environment," `code.claude.com/docs/en/hooks`), with
   no sandboxing documented, and Claude Code fails open rather than blocking a prompt on a broken hook (exit code
   2 is the only code that blocks; malformed stdout JSON or any other exit code lets the action proceed with a
   non-blocking notice). The plugin's own hook entry points (`brief.js`, `pulse.js`, `stop.js`, `sessionend.js`,
   `agy-hook.js`) were checked and all follow the correct defensive pattern already — top-level try/catch,
   explicit `process.exit(0)` on both success and failure paths, matching `agy-hook.js`'s own documented
   rationale ("no budget figure is worth stopping the user's work"). The gap is disclosure, not implementation:
   a short, explicit "what this plugin's hooks can do and why they never throw" paragraph in the README would
   close it at zero per-turn cost.

4. **npm account hardening not verifiable from the repo, but flagged as an action item.** npm's own current
   guidance pairs trusted publishing (already correctly configured) with "Require two-factor authentication and
   disallow tokens" for "maximum security posture," and states that as of August 2026, bypass-2FA tokens cannot
   perform account-identity or account-governance actions regardless. Whether the `claude-usage-limits` npm
   package has "disallow tokens" enabled cannot be checked from the local repo; it is a one-time npmjs.com
   settings change worth doing explicitly before treating the publish pipeline as fully hardened, since it costs
   nothing and closes the one publishing-hygiene item the CI workflow itself cannot enforce.

## 7. The ten highest-value changes, ranked by user value per token cost

Every item below is either genuinely zero per-turn injected-token cost (an infra, docs, or setup-time change —
the majority of what's left after 1.36.0) or clearly labeled otherwise. Ranked by value first, since cost is
tied at "zero" for most of them; where two are close, the one that plugs a confirmed rather than a rare gap
ranks higher.

1. **Read `prompt_cache` off the statusline JSON already on stdin and gate the existing cache-invalidation
   warning on an actual observed `last_miss_cause`**, instead of the current static list. Zero tokens on the
   common turn; replaces a generic warning with a measured one. (`feed.js`, confirmed still unread.)
2. **A native OS-level threshold notification at 80%/90% used**, independent of any prompt in flight, reusing
   the relay's existing notification primitive. Zero tokens (never enters model context); closes the plugin's
   own most-repeated unhandled gap — nobody is warned if they simply aren't looking at the terminal when the
   wall approaches.
3. **Scrub or fix the git commit history's exposed "Gerald" identity** (169/183 commits, real email, on a
   confirmed already-public repo) before treating this as a finished public artifact. Zero token cost; the
   single most direct violation, among everything found, of an explicit standing instruction.
4. **Delete the stale, unsynced root-level `plugin.json` (v1.34.1) and `hooks.json`**, or fold them into
   `sync-version.js` if something still needs them. Zero token cost; removes the one artifact in the repo most
   likely to mislead a contributor, a marketplace scanner, or a coding assistant reading the repo cold.
5. **Implement a real macOS `launchd` LaunchAgent (`StartCalendarInterval`) in `relay.js`/`wake.js`**, replacing
   the `at`(unreliable, `atrun` disabled by default)-then-`sleep`(doesn't survive reboot/logout) fallback. Real
   engineering cost, zero per-turn token cost; closes the literal "reliability on Windows and macOS" gap the
   plugin's own code comments already flag as known-broken.
6. **Add an explicit "what this plugin's hooks can do" disclosure to the README** (full user permissions, no
   sandbox, fail-open on non-2 exit codes — all confirmed from `code.claude.com/docs/en/hooks`), since Claude
   Code itself has no confirmed pre-enable warning for a marketplace-installed hooks-bearing plugin. Near-zero
   cost (a documentation paragraph); matters specifically because this is "before a public release."
7. **Enable "require two-factor authentication and disallow tokens" on the npm package's publishing settings**,
   completing the trusted-publishing hardening npm itself recommends as "maximum security posture." Zero cost
   (a one-time settings change); the one hygiene item CI cannot self-enforce.
8. **Test the Codex `/hooks` CLI trust step** as a possible unlock for Codex's hook engine before concluding it
   is unconditionally inert — official docs state project-local hooks only load after this explicit trust
   action, which the plugin's own prior testing does not appear to have exercised. Low cost to test; if it
   works, it replaces a periodic AGENTS.md read with real per-event hooks, closing the one dimension where Codex
   genuinely trails Claude Code.
9. **P90-based ceiling estimate for an unrecognized plan tier**, computed from local transcripts the same way
   `Claude-Code-Usage-Monitor` does, surfaced only when the plan string is genuinely unknown. Zero cost on the
   common path (known plan tiers); turns a dead "unknown" into a labeled, bounded estimate for the rare case of
   a new plan tier the pricing table hasn't seen yet.
10. **Add a `source`/provenance field (`official`/`rebuilt`/`estimate`) to `usage.js --json` output**, matching
    the confidence-tagging discipline `Claude-Code-Usage-Monitor` already applies, so a downstream script (or a
    future integration) doesn't have to re-derive which numbers to trust. Zero cost; narrower audience than the
    items above, which is why it ranks last.

**Already shipped, not re-recommended:** wiring `SubagentStop` as an actual hook (the 2026-09-20 report's #4
idea) is done — `hooks/hooks.json` fires `pulse.js` on `SubagentStop` in the current commit.

## Sources

**Local (primary, direct read of the repository at the commit noted):**
- `skills/usage-limits/scripts/feed.js`, `brief.js`, `relay.js`, `wake.js`, `agy-hook.js`, `pulse.js`, `stop.js`,
  `sessionend.js`, `usage.js`, `tools/sync-version.js` — C:\Users\OWNER\Downloads\claude-code-usage-limits
- `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.codex-plugin/plugin.json`, `package.json`,
  root `plugin.json`, root `hooks.json`, `hooks/hooks.json`, `LICENSE`, `.github/workflows/test.yml`,
  `.github/workflows/publish.yml`, `README.md`, `skills/usage-limits/SKILL.md`, `docs/codex-controls.md`
- `git log` (author identity counts, per-file history for root `plugin.json`/`hooks.json`)
- `docs/research/2026-09-20-unattended-resume.md` (53 sources, 8/8 verified, in-repo)
- `docs/research/2026-09-20-usage-tools-and-hooks.md` (in-repo)

**Web (fetched or searched by this pass's sub-agents, 2026-09-21):**
- code.claude.com/docs/en/plugins-reference, /en/plugin-marketplaces, /en/hooks (official Claude Code docs, direct fetch)
- docs.npmjs.com/trusted-publishers/, /requiring-2fa-for-package-publishing-and-settings-modification/ (official npm docs)
- learn.chatgpt.com/docs/hooks (official OpenAI Codex docs, direct fetch)
- openai/codex GitHub issues #39895, #21639, #27133, #15281, #14880 (direct fetch)
- developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html (Apple archived developer doc)
- ss64.com/mac/at.html; Apple Support Community threads (secondary, corroborating `atrun` default-disabled behavior)
- github.com/ridelink0/claude-code-usage-limits (direct fetch, confirmed public)

**Marked UNVERIFIED in this report and not used to justify a recommendation alone:** whether a macOS LaunchAgent
can wake a fully-sleeping Mac unassisted; whether a LaunchAgent fires while the user is logged out; whether a
plain-shell-command LaunchAgent triggers a TCC/Automation prompt; the exact Codex version at which the `hooks`
feature flag first went stable; the existence of an internal `GET /api/codex/usage` endpoint; whether hook
scripts execute inside Claude Code's sandboxed Bash tool specifically.
