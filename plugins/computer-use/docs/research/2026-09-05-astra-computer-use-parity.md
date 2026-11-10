# What GPT-6 Astra's computer use added, and how it maps onto this plugin

Date: 2026-09-05. Two research passes: (1) the public record of the GPT-6 Astra
launch (Sep 3 2026) and the Responses API changes that shipped with it; (2) the
primary source on this PC - the Codex bundled plugins updated on Sep 4 to build
26.901.41123 (`computer-use`, the new `unified-computer-use`, and `browser`),
diffed against the 26.825.51511 build studied on Sep 2. Everything below that
is not marked "public" was read from those files.

## Pass 1 - the public record

| Astra-era claim | Source | What it actually is |
|---|---|---|
| "Computer use ... including in the background while you work" | openai.com/index/gpt-6-astra, 9to5mac | The Codex app's own-cursor background mode (macOS SkyLight focus-without-raise; on Windows it takes the foreground). This plugin already does the Windows version through posted input and pattern actions. |
| "Nearly 2x faster at computer use", 72.6% OSWorld 2.0 at 47% less time per task | openai.com, DataCamp, Vellum | Model plus infrastructure. The plugin's lever is fewer round trips (`computer_run`), already shipped in 0.4.0. |
| "Async tool calling: the model continues work while a tool runs and absorbs the result when it returns" | developers.openai.com/api/docs/guides/async-tool-calling | `async: true` on a function tool; the result is matched by `call_id` later; a synchronous `wait` tool is the pattern for "I need it now". Claude Code has no async tool primitive, but `computer_run {background:true}` + `computer_task {wait_ms}` is that pattern. Missing until 0.5.0: absorbing the result without polling. |
| "Mid-turn steering: inject new context without cancelling the running tool" | developers.openai.com/api/docs/guides/steering | WebSocket `response.steer`; finishes the current item, then integrates. In Claude Code the user's queued message is the steer; the desktop-side equivalent is appending steps to a running background run. |
| "Keeps notes across context windows ... earlier context windows remain searchable" (Codex) | openai.com, 9to5mac, Substack guide | The model writes notes instead of relying on a lossy compaction summary, and can search earlier windows. For a tool that holds state the model loses at compaction (handles, indices, grants, what was done), the fix is a journal the server keeps and hands back. |
| "Additional safety monitoring ... the conversation may be paused or stopped as a precaution for review" | Fortune, CellCog | A monitor for misinterpreted instructions. The on-screen analogue is instruction-like text in a window: page data that reads as a request. |
| "You can stop actions at any time", Stop hook `turn_ended` | Codex plugin.json (`hooks.Stop -> node_repl turn_ended`), guidance.md "Interrupted Turns" | The host is told when the turn ends and stops issuing input. Claude Code has the same hook shape (`type: "mcp_tool"` on `Stop`), so the plugin can be told directly. |

Public sources used: https://openai.com/index/gpt-6-astra/ (403 to fetchers; read via
https://community.openai.com/t/introducing-gpt-6-astra-the-most-intelligent-and-aligned-model-in-the-world/1394703 and
https://9to5mac.com/2026/09/04/openai-releasing-major-upgrade-to-chatgpt-and-codex-with-gpt-6-astra-details-here/),
https://fortune.com/2026/09/03/openai-debuts-gpt-6-astra-computer-use-greg-brockman-says-start-of-agi/,
https://www.datacamp.com/blog/gpt-6-astra, https://www.vellum.ai/blog/gpt-6-astra-benchmarks-explained,
https://developers.openai.com/api/docs/guides/async-tool-calling, https://developers.openai.com/api/docs/guides/steering,
https://developers.openai.com/api/docs/guides/tools-computer-use, https://learn.chatgpt.com/docs/computer-use,
https://learn.chatgpt.com/use-cases/use-your-computer-with-codex, https://www.startuphub.ai/ai-news/technology/2026/gpt-6-astra-api-brings-computer-use-to-developers,
https://analystuttam.substack.com/p/gpt-6-astra-complete-guide-use-cases-computer-use, https://www.theneurondaily.com/p/gpt-6-astra-can-stay-on-the-job-and-use-your-computer,
https://www.macstories.net/notes/openais-new-codex-app-has-the-best-computer-use-feature-ive-ever-tested/,
https://code.claude.com/docs/en/computer-use, https://code.claude.com/docs/en/hooks, https://code.claude.com/docs/en/plugins-reference.

## Pass 2 - the Sep 4 Codex plugins on this PC (26.901.41123 vs 26.825.51511)

Paths: `C:\Users\OWNER\.codex\plugins\cache\openai-bundled\{computer-use,unified-computer-use,browser}\26.901.41123`.

New or changed in `computer-use` 26.901:

- `hooks.Stop -> node_repl.turn_ended {session_id, turn_id}` in plugin.json, and a
  guidance section "Interrupted Turns: if Computer Use reports that the turn ended
  or that the user stopped Computer Use, stop issuing app input."
- A "Recovery" section: lightweight call times out -> wait 2 s, retry once, then
  reset the session, rerun Initialize, retry once, then report the helper may have
  failed; desktop locked -> stop and ask the user to unlock (never drive
  `LockApp.exe`); lost window binding -> rehydrate with `get_window({id, app})`,
  never construct handles; never reuse indices, screenshot ids or coordinates after
  a state change.
- `get_window` (rehydrate a binding), `set_value`, `drag`, `perform_secondary_action`,
  `click_count`, `mouse_button`, `activate_window` as an explicit escape hatch,
  `launch_app` by explicit `.exe` path; `list_apps` rows carry `isRunning`,
  `lastUsedDate`, `useCount`.
- Bounded screenshots "for the window and related transient UI", each with
  `zIndex`, `originX/Y`, and an id that must match the target window; captured
  with Windows.Graphics.Capture so occluded windows still render.
- Structured extras beside the tree: `focused_element`, `selected_text`,
  `selected_elements`, `document_text`.
- Safety denies added or sharpened: no Windows key in any spelling (`Meta`,
  `Windows`, `Win`, `Cmd`, `Command`, `Super`, `OS`); no age verification; no
  authentication dialogs; no password managers; no Windows Security; no
  ChatGPT/Codex UI; never act on security or privacy permission requests;
  "distinguish reading information from transmitting information".
- Confirmations policy unchanged in structure (hand-off / always confirm /
  pre-approval works / always allowed) - the same four modes as 26.825.
- "Prefer Browser Use plugin for browser automation."

New plugin `unified-computer-use`: one MCP server (`cua_repl`) exposing `js` and
`js_reset`, with `cua.getState()` as the single inventory of apps, browsers and
tabs, `cua.getApp(name)`, `cua.getTab(...)`, `cua.createBrowserTab(...)`. Server
instructions are one line; the tool description carries the entry points; the
per-surface guidance is loaded as resources. The launcher (`scripts/launch.mjs`)
chooses a banner by enabled surfaces and overrides tool descriptions through
`NODE_REPL_TOOL_OVERRIDES`. `output_token_limit: 25000` on `js`.

New plugin `browser`: interruption wording ("do not quote the raw runtime
error ... summarize it naturally"), a safety doc that centres on
reading-vs-transmitting, an accessibility API that diffs by default, a
`botDetection` reporter, a secure `browserAuth` handoff (the model never sees
credentials), a `management` capability with an audit trail, and a `visibility`
capability ("keep browser work in the background unless the user asks to see it").

## What was already here before 0.5.0

Sequences in one call (`computer_run`), background runs (`computer_task`),
stable indices and delta reads, posted input into windows behind the user's,
coexistence by the kernel's injected-input flag, the four-tier policy, the
consequence gate, the Claude-palette banner with Stop, multi-session leases,
per-window screenshots with the blocked-tier check, `set_value` (as
`computer_type {replace:true}`), right/middle/double click, secondary actions
through patterns, launch by name or path, key-chord denies for the Windows key.

## The plan for 0.5.0 (checked twice against the two passes)

Ordered by value, so a cut-off lands the important part first.

1. **Notes across context windows.** `server/journal.mjs`: an append-only JSONL
   journal per session in the shared data dir, one line per call (what, where,
   outcome), plus free-text notes. `computer_recap {last, find, note}` returns the
   live state (grants, windows worked in, running tasks, notes, last N actions;
   `find` searches the whole journal). A `SessionStart` hook with matcher
   `compact|resume` prints the same recap into context, so the notes come back by
   themselves after a compaction - which is exactly what Codex's feature does.
2. **Turn ended.** `hooks/hooks.json`: `Stop` and `StopFailure` call
   `computer_turn_ended` on this server (Claude Code's `mcp_tool` hook, the same
   shape Codex uses). Running background runs stop after their current step
   (setting `background_at_turn_end: finish` lets them run on); the next result
   says so. `StopFailure` is the loss-of-internet case: the API failed, the turn
   is over, nothing on the desktop keeps going unattended.
3. **Async absorption.** A finished background run is announced at the top of the
   next tool result, once, so the model does not have to poll.
4. **Steering.** `computer_task {id, steps}` appends validated steps to a running
   background run without cancelling it.
5. **Safety monitor.** `render.probeWarning`: rows whose text reads like
   instructions get one WARNING line; inside a run, a read that trips it halts the
   run ("paused for review") so the user is told before anything else happens.
6. **Policy parity with 26.901.** Hand-off tier (age verification, CAPTCHA,
   safety-interstitial and paywall bypass: refused, not confirmable); the
   confirmation list gains account creation, saved passwords and cards, API keys,
   extensions, "run anyway", sharing and permission changes, social reactions;
   blocked tier gains the lock screen, Claude/ChatGPT/Codex desktop apps,
   authenticators and wallets; sensitive tier gains remote-desktop clients;
   `desktop_locked` refusal.
7. **Orphan guard.** A background run nobody has checked on for 10 minutes stops.
8. **Look like Claude.** The banner already uses Anthropic's palette; it now
   carries a live status ("typing in Notepad") the way Codex's preview shows
   activity. Host op `banner`.
9. Skill and README: recovery rules (timeouts, lock screen, lost handles),
   interruption wording, Claude in Chrome preference for web work, the new codes.
10. Tests: a new logic suite for all of the above, run with the existing eight.

Deliberately not adopted, and why: screenshot-by-default (the tree is the cheaper
and safer default); `zIndex` transient-UI screenshots (a window-scoped capture
plus `New window:` notes covers dialogs); a unified browser surface (Claude in
Chrome is the browser path in Claude Code, and the tree already reads web pages);
wallpaper-derived cursor colour (the plugin's colours are Claude's on purpose).

## Second check of the plan

- Every hook target exists as a tool on this server; hook server name is the
  scoped `plugin:computer-use:computer-use` form from the plugins reference.
- The turn-ended call must never start the host: a session that never used
  Computer Use would otherwise compile and show a banner on its first Stop.
- The journal is written in the same shared data dir as session registrations,
  so the recap hook can find it after a compaction with only `session_id` and
  `cwd` to go on. Files of dead sessions are pruned after seven days.
- Nothing in the journal may come from a blocked window (reads of those are
  refused before any text exists) and typed text is cut to 40 characters, so a
  journal line never carries a password the model typed.
- `confirmed:true` is still refused in a background run, and appended steps go
  through the same validation, so steering cannot smuggle a confirmation in.
- Result texts stay byte-stable except for the one-off notices, which sit in tool
  results, not in the schema or instructions, so the prompt cache is untouched.

## Second pass (2026-09-06): what ChatGPT's own computer use gained

The first pass answered "what changed in Codex and the API". Gerald's question
was about ChatGPT's computer use - the thing a user of the ChatGPT desktop app
sees. That list, from https://learn.chatgpt.com/docs/whats-new,
https://learn.chatgpt.com/docs/appshots, https://learn.chatgpt.com/docs/computer-use,
https://learn.chatgpt.com/use-cases/use-your-computer-with-codex,
https://learn.chatgpt.com/docs/remote, the ChatGPT release notes
(https://help.openai.com/en/articles/6825453-chatgpt-release-notes, Sep 3 entry),
the Sep 4 Windows plugin on this PC, and `~/.codex/computer-use/config.json`
(the Windows overlay: "ChatGPT is using your computer", "Esc to cancel", accent
#339cff):

| ChatGPT feature | What it is | 0.6.0 |
|---|---|---|
| Appshots (macOS) | Both Command keys send the front window - screenshot plus available text, including text outside the visible scroll area - into the chat. Needs Screen Recording and Accessibility. | Both Ctrl keys (Presence.cs sees the physical keys); host emits an `appshot` event; server reads the window (tree with off-screen text, plus a picture) into `<data>/appshots`; `UserPromptSubmit` hook prints the text with the next prompt; `computer_appshot` shows the picture or captures now. |
| Locked use (macOS) | Keeps approved work going after the Mac locks, including via Remote. | Not possible on Windows (secure desktop); refused as `desktop_locked`, documented. |
| Remote (mobile) | Start/continue work on a connected Mac or PC from the phone; review progress; approve actions; QR pairing. | Claude Code Remote Control already does this for a session; the skill tells Claude what changes when nobody is at the keyboard. |
| Review pauses | "Tasks may be paused in ChatGPT and you may be asked to review the action before continuing." | 0.5.0's safety monitor (WARNING line, run halts for review) plus the hand-off tier. |
| Windows host: occluded capture | Windows.Graphics.Capture screenshots "that work even when windows are occluded". | PrintWindow with PW_RENDERFULLCONTENT when the window is not the topmost thing at its rectangle; blank result falls back to the screen grab and the caption says so. |
| Windows host: transient UI | Bounded screenshots "for the window and related transient UI" (menus, popups). | Popup pass in list_apps: `#32768`, `Xaml_WindowedPopupClass`, `ComboLBox`, `Chrome_WidgetWin_2` listed as `[menu]`/`[dropdown list]`/`[popup]` with their owner; readable and clickable by index; reported as `New window:`. |
| Windows host: drag | `drag` for drawing, handwriting, canvas, 3D viewports. | `computer_drag` + `drag` step; host op on both platforms. |
| Windows host: installed apps | `list_apps` returns installed apps with `lastUsedDate`/`useCount`; `launch_app` by id or path. | `computer_apps { installed }` from Get-StartApps; `computer_launch` resolves Start-menu names through `shell:AppsFolder`. |
| Always-allowed apps, Esc to cancel, "X is using your computer" | Settings > Computer Use; the on-screen banner. | Already here (always_allowed_apps, banner with Stop, Esc). |

macOS host, two review passes (uncompiled here; the file says so): stable
window handles via a registry keyed on the AX element (the app's window array
reorders with z-order, so `pid*1000+index` named a different window after the
user raised one); Escape sets a stop while acting or while a run is marked
busy; right/middle/double clicks and point clicks; key chords go to the named
window's app or refuse (`window_not_focused`) unless `take`; `drag`,
`clipboard`, `describe`, `busy`, `banner` ops; screenshots by CGWindowID so a
covered window captures itself; typed newline and tab are keys; snapshot rows
carry `id`, `selected`, `expanded`, `toggle`; a 4 s walk budget; `wait_for`
matches `automation_id`; emit is locked across the two threads; policy knows
macOS process names and strips `.app`.
