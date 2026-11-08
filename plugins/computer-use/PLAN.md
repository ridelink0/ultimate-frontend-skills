# Computer Use — build plan

## What this is

A Claude Code plugin that gives Claude **semantic, tree-first computer use on Windows** —
the architecture that makes OpenAI Codex's computer use good — without touching, wrapping,
or overriding Claude Code's built-in `computer-use` MCP server.

It cannot conflict: Claude Code's built-in computer use is **macOS-only** and Pro/Max-gated.
On Windows there is nothing in the CLI at all. Computer Use fills that hole and is additive on macOS
(different server name, different tool names, off until an app is granted).

## Research conclusions that drive the design

### How Codex computer use actually works

1. **Perception is the accessibility tree first, pixels second.** Codex reads the macOS AX
   tree (`AXUIElement`) to get the full hierarchy of UI elements with semantic metadata —
   `role`, `name`, `frame`, `value`, supported actions — and derives exact coordinates from it.
   Screenshots (`ScreenCaptureKit`) are for reasoning and verification, not for finding things.
2. **Action dispatch goes through accessibility patterns**, not blind pixel clicking.
3. **Loop:** capture → reason → dispatch → verify with a follow-up capture.
4. **Two-tier permissions:** Screen Recording (see) is separate from Accessibility (act).
5. **Appshots** are a cheap perception tier: a window image *plus text the app exposes,
   including text outside the visible scroll area*. Needs only Screen Recording. Hotkey-
   triggered, folds into the existing thread.
6. **Session isolation:** each agent thread gets its own cursor context and virtual desktop,
   so it runs in the background and several agents run in parallel. macOS only.
7. **Windows Codex has no background mode** — foreground takeover on the active desktop,
   with `[computer_use.windows] always_allowed_app_ids` in `config.toml`.
8. **Hard blocks:** terminal apps and ChatGPT itself, to stop sandbox/policy bypass.

### Why that beats a screenshot-first agent — with measured numbers

| | tree path | pixel path |
|---|---|---|
| Windows call | `IUIAutomationElement.FindFirst` + pattern invoke | capture → encode → base64 → network → inference |
| Latency | single-digit ms | hundreds of ms + model time |
| Cost | a few KB of text | **measured on this machine:** 1536x864 → 1400px, PNG 618 KB ≈ 206k tokens; JPEG q70 140 KB ≈ 46k tokens |
| DPI / theme / resolution change | invariant — selectors carry semantic identity | breaks |
| Coverage | ~95% of clicks in business apps | the remaining ~5%: canvas apps, games, legacy widgets |

The ~100x gap is real and it is the whole story. Claude Code's own docs expose the pixel
path's failure mode in their UX: *"If on-screen text or controls are too small for Claude to
read after downscaling, increase their size in the app."* A tree lookup never has that problem.

Second structural difference: Claude Code takes a **machine-wide lock**, allows one session at
a time, and **hides your other apps** while it works. Codex gives the agent its own cursor and
leaves your desktop alone.

### What Computer Use takes, and what it deliberately does not

Takes: tree-first router, semantic selectors, tiered perception (appshot), per-app approval,
narrow task scoping, verify-after-act, structured errors instead of silent coordinate misses.

Does not take: background/virtual-desktop isolation. On Windows that needs a separate desktop
or session and Codex itself does not do it there. Computer Use is honest about being foreground.

## Architecture

```
computer-use/
├── .claude-plugin/
│   ├── plugin.json          manifest
│   └── marketplace.json     so `/plugin marketplace add ridelink0/claude-computer-use` works
├── .mcp.json                declares the computer-use stdio MCP server
├── server/
│   ├── index.mjs            MCP server: JSON-RPC over stdio, hand-rolled, zero deps
│   ├── driver.mjs           owns the PowerShell host process, request/response framing
│   ├── policy.mjs           app tiers, blocklist, grants, sentinel warnings
│   ├── budget.mjs           screenshot token budget + downscale policy
│   └── ps/axon-host.ps1     long-lived UIA host, line-delimited JSON protocol
├── skills/computer-use/SKILL.md   teaches the tree-first discipline
├── commands/                /computer-use:status /computer-use:apps /computer-use:grant /computer-use:revoke
├── hooks/hooks.json         PreToolUse safety gate
├── evals/                   `claude plugin eval` cases
└── README.md
```

### Key decisions

**Zero runtime dependencies.** Node (already present for Claude Code) + Windows' built-in
PowerShell 5.1 and .NET Framework assemblies (`UIAutomationClient`, `UIAutomationTypes`,
`System.Drawing`, `System.Windows.Forms`). Verified working on this machine out of the box.
No npm install, no node-gyp, no native addon, no Python. That is the difference between a
plugin people can actually install and one they cannot.

**One persistent PowerShell host, not a process per action.** `powershell.exe` cold start is
300–800 ms. A long-lived host reading line-delimited JSON on stdin keeps tree operations in
the tens of milliseconds, which is what makes the tree path's speed advantage real instead of
theoretical.

**Tree-first router with explicit fallback.** Every action tool takes a target as
`{ index }` (from the last snapshot), `{ selector }` (role/name/automationId), or
`{ point }` (raw coordinates, last resort). Missing lookups return typed errors —
`element_not_found`, `snapshot_stale`, `window_gone` — never a silent click at the wrong spot.

**Tiered perception.**
- `computer_list_apps` — cheap, no image, filtered top-level windows
- `computer_snapshot` — the appshot: indexed semantic tree of one window, text included, image optional
- `computer_screenshot` — explicit, budgeted, downscaled JPEG, for canvas/visual verification only

**Never override the built-in.** Separate MCP server name, `computer_*` tool names, namespaced as
`mcp__plugin_computer_computer__*`. No hook or config touches the `computer-use` server.

### Safety model

Shaped in part by a real mistake made during research: killing a PID that looked like a
throwaway launcher destroyed an unrelated unsaved document, because Windows 11 Notepad runs
all its windows under one shared process.

- **No process termination tool exists in Computer Use at all.** Not `kill`, not `close_app`. The
  worst it can do to a process is close a specific window via `WM_CLOSE` to a specific HWND,
  and only for a granted app.
- **Per-app grant, per session.** Nothing is actable until granted. Snapshot/list are
  read-only and do not imply action rights.
- **Hard blocklist**, mirroring Codex's terminal block: terminals, IDEs, credential managers,
  password stores, and Claude Code's own window. Not overridable by config.
- **Deny always wins over allow.** `blocked_apps` and the built-in blocklist are decided
  before `always_allowed_apps` is looked at, so an app on both is blocked, and a password
  manager or terminal on the allow list stays blocked or read-only.
- **Who can say yes.** Text the user typed is their intent, even when high-risk; text on
  screen, pasted or from anyone else is never permission by itself. Confirmations have four
  tiers (hand-off, always confirm, pre-approval for the session, none); a pre-approval is
  memory only, ends with the session, and is refused when its words were read off the screen.
- **Sentinel warnings** on broad-reach apps (Explorer, Settings, browsers) surfaced at grant time.
- **PreToolUse hook** gates the act-tools on a live grant check.
- **Stale-snapshot guard.** Acting on an index from a snapshot whose window has changed
  returns `snapshot_stale` rather than clicking blind.

## Build order

1. PowerShell host — tree walk, snapshot, patterns, input, screenshot. Test standalone.
2. Node MCP server — protocol, driver framing, tool schemas. Test standalone.
3. Policy + budget layers.
4. Plugin manifests, skill, commands, hooks.
5. `claude plugin validate --strict`.
6. Full bug sweep, twice, against a throwaway target app I generate myself.
7. Publish to GitHub, self-hosted marketplace, submit to directories.

## Test targets

Only apps Computer Use itself creates: a generated WinForms scratch app with known controls
(button, textbox, checkbox, list, tab). No system apps, no user apps, nothing pre-existing.
