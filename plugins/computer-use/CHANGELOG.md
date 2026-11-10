# Changelog

Every released version, newest first, on the tag of the same name. Dates are the
release commit's own. Anything marked UNVERIFIED was not exercised on real
hardware at the time it shipped.

## 0.11.0 - 2026-09-28

Items 1-3 of `docs/TODO-astra.md`: the parts of Codex's confirmation policy
this plugin matched only in spirit are now code, with tests.

- **Deny always wins over allow.** The order is written out in
  `server/policy.mjs`: `blocked_apps` and the built-in blocklist, then the
  shell tier, and only then `always_allowed_apps`. `isAlwaysAllowed` itself
  now answers no for a blocked or shell-tier app, instead of relying on
  `checkAct` asking in the right order. `tools/policy-test.mjs` loads the
  policy with both lists set and checks that an app on both is blocked, and
  that KeePass or a terminal on the allow list stays blocked or read-only.
- **The trust rule.** `SOURCE`, `canSatisfy(source, tier)` and
  `sourceOfWords(words, screenTexts)` in `policy.mjs`: what the user typed is
  intent, even when high-risk; text on screen, pasted or from a third party
  is never permission by itself. `decideConfirmation` consults it, and
  `consequenceCheck` in `server/index.mjs` now calls `decideConfirmation`
  for every click and file-dialog confirm instead of deciding inline. The
  server can check one part of the rule on its own: words offered as the
  user's that it read off the screen this session are refused. Whether words
  were typed rather than pasted is still Claude's statement, not something
  the server can see.
- **A third confirmation tier: pre-approval for the session.** Four tiers now
  (`CONFIRM`: hand-off, always confirm, pre-approval, none).
  `computer_grant { hwnd, preapprove: "Send", user_words: "..." }` lets a
  message-type control (Send, Post, Reply all, Upload, Invite, Like, Share)
  be pressed in that app without `confirmed: true` until the session ends.
  Payments, deletions, installs, access and account changes - and any label
  that names money, a coin or any amount ("Send 0.5 BTC", "Send 50"), or
  submits a form or application - are `always_confirm` and cannot be
  pre-approved. The control's own label on screen does not count as the
  user's words being read off it. The pre-approval is kept in `Sessions`,
  in memory only, never in the
  registration file or the grants file a resumed conversation restores; it
  ends on close, on a different conversation's id, on `revoke`, and on Stop,
  and a background run still stops at the control.
  `tools/sessions-test.mjs` covers the lifetime (14 new checks),
  `tools/policy-test.mjs` the tiers, the rule and who may pre-approve what
  (76 new checks, 226 in all).
- `tools/astra-test.mjs`'s always-on schema ceiling moves 3970 -> 4030 for
  the two new `computer_grant` arguments (57 tokens), with the argument
  written beside it.
- UNVERIFIED: the `computer_grant` pre-approval path and the click it lets
  through were only exercised through the pure-JS suites on Linux; no
  Windows host ran them end to end.

## 0.10.2 - 2026-09-28

An independent trust-index review (M8ven) scored 0.10.1 a C, 74/100, on two
counts: no tool's `annotations` said what its handler actually does beyond
`readOnlyHint` (6 of 23 tools had that one hint; none had the other three),
and no test named a tool by its `computer_*` name to check that.

- **Every tool now carries all four MCP annotation booleans** -
  `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` -
  reasoned per handler, not copy-pasted: `computer_click`/`computer_key`/
  `computer_drag`/`computer_run`/`computer_task`/`computer_paste`/
  `computer_file_dialog` are `destructiveHint: true` (they can lose or
  overwrite state that was not the point of the call); `computer_clipboard`
  joins them, because setting it overwrites the user's existing clipboard
  with no save/restore, unlike `computer_paste`. `computer_grant`,
  `computer_recap`, `computer_status` and `computer_turn_ended` are
  `openWorldHint: false` - they read or write this server's own session
  state, not the desktop. `tools/annotations-test.mjs` is new: it calls the
  live server's `tools/list` and asserts, by name, that every tool present is
  the one expected and that its four hints match a hand-reasoned table -
  139 assertions across 23 tools (21 off Windows) - and separately that
  `readOnlyHint` and `destructiveHint` are never both true on the same tool.
  It is wired into `tools/test-all.mjs`. Raised the always-on schema-token
  ceiling from 3425 to 3970 in `tools/astra-test.mjs` for the added booleans'
  real cost, with the same written justification that test has required of
  every prior move.
- CI: this repository had none. Added `.github/workflows/ci.yml` on
  `windows-latest`, running the suites that need no real, idle desktop
  (`policy-test`, `sessions-test`, `astra-test`, `annotations-test`,
  `fixes-test`, `build-test`) plus a syntax check of every server, tool, and
  hook file. `host-test`, `mcp-test`, `batch-test`, `web-test`,
  `verify.mjs`, and `presence-test.mjs` drive real windows or a real virtual
  desktop and stay for a human on an idle machine, same as before.
- No handler behavior changed; `tools/policy-test.mjs` (150/150, including
  every opt-in-slash-command case) and every other existing suite pass
  unchanged.

## 0.10.1 - 2026-09-28

Found by using 0.10.0 for a real job the same night - uploading two
repositories' social preview images on github.com in Opera:

- **A browser's Open dialog is found.** Opera shows its file picker from
  another process than the window that owns it, and the desktop walk the host
  used does not return such a dialog, so `computer_file_dialog` answered "no
  Open or Save dialog is showing" with the picker in front. It now also looks
  in the system's own window list for a dialog owned by that window, and
  `computer_apps` lists owned dialogs the walk leaves out. Verified on the live
  GitHub upload: the picker was listed as `Open` and filled, and both uploaded
  images came back byte-identical to the files chosen. (Microsoft Edge did not
  open a picker from an accessibility click on a local test page, so there is
  no automated check of this path.)
- **A drop shadow is not a window.** The wait for that picker reported a
  tooltip's `SysShadow` window as the new window; that class is now left out
  of listings with the rest of the shell's furniture.
- **The host gets 45 s to start, not 20.** With the CPU near 85%, a host that
  is normally ready in under a second took more than 20 s about one start in
  five, and each of those failed its first call. The terminal-window lookup
  gets 15 s for the same reason.
- web-test closes a leftover Edge instance of its own profile before it
  starts, and parks its stand-in for the user's window at the screen's right
  edge.

## 0.10.0 - 2026-09-28

Sixteen problems found on 2026-09-26 while filling in a web form in a
Chromium browser with Computer Use on the user's own desktop, each fixed and
tested, plus one opt-in grant.

- **The foreground comes back.** A real click activates its window and keys
  need theirs in front, and the pointer was put back but the foreground was
  not: a physical click on a browser on the user's second monitor left it in
  front, and their typing went there. The host now remembers the window that
  was in front before the first action that takes the foreground and hands it
  back when a single action or a whole run ends (new host op `give_back`). Not
  while a menu or dropdown the target opened is showing - a Chromium `<select>`
  list is an owned, non-activating `Chrome_WidgetWin_1` popup, measured - not
  when the user has clicked somewhere since, not in `take` or `exclusive`.
- **A disabled control is refused, not clicked for real.** Root cause of the
  "went via physical although an invokable Button existed" report: the Next
  button was disabled until the form was valid, its Invoke pattern refused
  (ElementNotEnabled), and the click silently fell through to a physical one -
  which pressed nothing and took the foreground. Now `element_disabled`
  (`physical: true` still forces a real click). Any other pattern failure that
  falls through to a real click says which pattern failed and why.
- **A click reports the state after it.** A browser updates its
  accessibility tree a beat after the page, so Toggle, SelectionItem and
  ExpandCollapse clicks reported the old state ("now Off" on check boxes that
  were On). Every click path now waits up to 0.7 s for the state the click
  should move, and says "unconfirmed" when it had not moved.
- **Names are not cut at 70 characters regardless.** `text_limit` now applies
  to names, and a paragraph, list item or cell - whose name is its content -
  gets the text allowance by default. A cut name says how long it was.
- **`max_nodes` caps what is shown, after the filters.** It used to limit the
  walk, so a find or a controls-only read of a browser never got past the
  toolbar (browser chrome comes first in tree order), and a run's closing read
  repeated the cut.
- **`find` matches the printed row too**, so `/Button "Next/` copied from a
  listing finds that row. A find that comes back empty is retried for about a
  second, and says "the tree was still changing" instead of "no match" when
  the page had not settled.
- **Landmarks and `exclude`.** Page landmarks get rows (`Group (main)`,
  `Group "Sidebar" (navigation)`), so `index` reads the main content alone,
  and the new `exclude: [i]` leaves a subtree - a long sidebar - out of reads.
- **Scrolling an element uses its container's Scroll pattern**, not the
  mouse wheel (which needs the pointer and refused with `user_busy` while the
  user moved the mouse). New `into_view: true` scrolls the element into view
  through ScrollItem. The wheel is the last resort.
- **A stale index is re-found**: when a re-render replaced an element (React,
  disabled to enabled), the one element now carrying the same name and role
  is used, and the result says so. More than one match keeps `element_stale`.
- **Runs**: `timeout_ms` is a step field for `wait_for` (a 30 s server check no
  longer dies at the 5 s default), an unknown step field is refused instead of
  ignored, and a `wait_for {change}` step keeps its whole delta in the run
  output instead of a truncated line the closing read then called "no change".
- **`wait_for {change}` compares against the latest read of the window** -
  any read, a find included - taken whole, not the last full listing with its
  `max_nodes`. A run takes a fresh "before" read ahead of an action followed by
  such a wait when the latest one predates an earlier action.
- **A resumed conversation keeps its grants**, saved per Claude Code session
  id and restored by the next server process of that session (a Stop clears
  them), and its earlier, still-running process is named as that - not as
  "1 other Claude session".
- **The session's own terminal is excluded from listings.** Claude Code's
  process owns no window; Windows Terminal draws it, so the old pid rule never
  matched. The host, run once as a helper, attaches to the session's console
  and takes the root owner of the console window, which is the terminal window.
- **A terminal read shows its screen.** Windows Terminal's text area read as
  its tab title and nothing else; its screen text (TextPattern visible ranges
  of the TermControl, trailing padding and blank rows dropped) now comes back
  as that element's text, so the reply to a command can be read.
- **Opt-in: slash commands into another Claude Code terminal.** Off unless the
  new setting `allow_claude_slash_commands` is on. Then a terminal titled
  "Claude Code" can be granted slash commands only: one `/command` line, then
  Enter within 20 s; anything else there is refused with `slash_only`. The
  README states the risk. Verified by typing `/help` and Enter into a
  throwaway Windows Terminal window, in front and behind.
- Tests: new `fixes-test` (pure logic) and `web-test` (the page above, in an
  InPrivate Microsoft Edge window, through the MCP server), both in `test-all`;
  `policy-test` gains the slash-command grant. Shared schema wording trimmed so
  the tool listing is smaller than 0.9.6's despite the new options.

## 0.9.6 - 2026-09-25

Found by reproducing the batch-test suite on a loaded machine (CPU pinned at
100%), where it had been passing 67/68 or dying outright:

- Win32 BUTTON-class controls (plain buttons and check boxes) are pressed
  through the MSAA default action (`AccessibleObjectFromWindow` +
  `accDoDefaultAction`) instead of the UI Automation proxy, which tries to
  give the control keyboard focus first and waits out its focus timeout when
  Windows refuses the host the foreground. Clicks dropped from 4.1 s to
  15-67 ms and toggles from 4.1 s to 49-170 ms; the press lands on the very
  next read every time. Disabled buttons and every other control keep the
  UIA path. Reported as `msaa_default_action` when this path is used.
- batch, host, presence and verify now wait 60 s for their target window
  before giving up, matching mcp-test, and `COMPUTER_USE_TARGET_TIMEOUT_MS`
  raises it further; batch-test's new_window wait uses the same ceiling. The
  old 15 s ceiling died under load.
- `computer_launch` no longer calls a cold start "already running and opened
  in its existing window" - a window only counts as the existing one if it
  was in the pre-launch window listing (hidden and cloaked included).
- `wait_for change` no longer reports a still window as changed under load.
  A TextPattern read that times out now marks the row `text_unread` instead
  of blank, and rows compare without their text; a read cut short before its
  time budget no longer counts its missing rows as removed, so
  `wait_for change` ignores them and `wait_for text gone:true` no longer
  answers "gone" from one.
- `desktop-test` creates and switches to a second virtual desktop, which
  breaks the rule against desktop switches; it now runs only under
  `CU_DESKTOP_TEST=1` and otherwise prints NOT RUN and exits 0. Documented in
  the README.
- README: the macOS host has never been compiled or run on a Mac, called out
  in the first lines with a link to the detail section; batch-test's count
  corrected to 69.
- Investigated and reverted: an event-driven `wait_for` (StructureChanged,
  PropertyChanged, TextChanged and focus handlers on the host) measured
  worse than the polling it would have replaced - handler registration alone
  took 5.7-7.0 s under load, and once registered, events still arrived
  120-2850 ms after the change against polling's ~0.5 s median. Kept as a
  patch, not shipped: `event-driven-waits-experiment.patch`.

## 0.9.5 - 2026-09-21

- A Stop hook reads the reply about to be handed back and, when it lists a job
  on this computer that the plugin can do - read a settings panel, close a
  window, open an app, click a thing - blocks the turn once with the rule: do
  it now and report, a completed action is not a follow-up, leave a step to
  the user only when it needs their credentials or consent or has no GUI or
  CLI path. Once per session, never twice in a row, nothing on turns that do
  not match. Two such items were handed back at the end of a long task today.
- The skill description names the cases that were missed - a settings panel
  read to confirm a path, a stray window on another virtual desktop - and the
  words a user actually types, per Anthropic guidance that skills undertrigger
  and descriptions should push. The three-line rule is in the skill body.
- close_window waits up to three seconds before calling a window still open.
  The research: docs/research/2026-09-21-dr-when-to-use-computer-use.md.

## 0.9.4 - 2026-09-21

- A blind tree is not a dead end: when a snapshot comes back blind and the
  caller did not say with_image: false, the picture of the window is attached
  in the same read, the way Astra one read always carries a screenshot beside
  a tree that may be null. A browser task in a field test had stalled exactly
  there.
- docs/TODO-astra.md: what the Astra comparison settled (keep the overlay,
  banner, coexistence, appshot, journal and recap; none has an Astra
  equivalent and all are settings) and the six open items, ranked. The full
  research is in docs/research.

## 0.9.3 - 2026-09-21

From a live field test by another session on this machine, with the verbatim
replies in hand:

- `computer_launch` names the launched app's own window, not the first window
  to appear. A Start-menu name is not a process name ("Opera Browser" runs as
  opera), so nothing matched and the reply named Explorer's desktop-switch
  preview and the user's editor as the launch while the real window turned up
  on the next listing. Every word of the name is now a candidate, Explorer's
  transient surfaces are never mistaken for the app, a session that restored
  onto another virtual desktop is found in the hidden listing, and when only
  unrelated windows appeared the reply says so instead of claiming a launch.
- Concurrent `computer_apps { installed }` calls share one Start-menu listing
  instead of each spawning a cold PowerShell; the ceiling is 25 seconds, and a
  timeout is reported as a timeout rather than as "0 installed".
- The skill says plainly that "work on a separate virtual desktop" cannot be
  done from here on Windows and what to offer instead, rather than implying
  the flow works and switching the user's screen.

## 0.9.2 - 2026-09-21

- The file name box is found by automation id 1148 first and then by what it
  is: an enabled, writable field named for the file name, so a localised,
  packaged or reskinned picker is still driveable instead of being rejected as
  "not the Windows common dialog". The focus proof compares the box that was
  actually found rather than the id alone.
- The MCP test waits 60 seconds for its throwaway target, configurable, and
  prints the wait when the machine is slow. The old 15-second ceiling failed
  the suite whenever anything else was running, which read as a defect in the
  plugin and was not; the target takes 4.3 seconds on an idle machine here.
- `test-all` tells a broken suite from one that cannot run here: the two suites
  that drive real windows are reported as needing an idle desktop when the
  plugin refuses to take focus from someone who is using the machine, rather
  than as failures.
- One token ceiling, not two. The copy in the batch test now tracks the one in
  astra-test, where the reason for every raise is written down; it moved to
  3425 for the two document tools, after both their descriptions were cut.
- This file, and the five releases between 0.6.0 and 0.9.0 that were never
  tagged now carry their tags.

## 0.9.1 - 2026-09-21

- `computer_open` resolves the file's handler through the shell association and
  runs that application's name through the same classifier `computer_launch`
  uses, so a document whose handler is an editor, an interpreter or a shell is
  refused before anything starts. Store-app associations answer with no handler
  at all; that case proceeds and the reply says Windows named none.
- The file dialog's confirm button goes through the consequence gate: a picker
  whose button reads Upload, Send, Post or Share is refused once and needs
  `confirmed: true`, exactly as a click on that button would be.
- The macOS host answers `open`, `file_dialog`, `paste` and `paste_files` with
  `unsupported_on_macos` instead of an unknown-op error. UNVERIFIED: no Mac was
  available, so the Swift host has not been compiled with this change.
- `as_text` decodes UTF-16 and UTF-8 byte-order marks, refuses a file holding
  NUL bytes, refuses a directory, and strips carriage returns the way
  `computer_type` already did.
- Marketplace entry and manifest versions agree, and a build test keeps them
  agreeing. README's tool and token numbers are the measured ones: 23 tools,
  schema about 3398 tokens on first use, names and server note about 482
  always on.

## 0.9.0 - 2026-09-20

- Three tools for documents, the things a browser extension cannot reach:
  `computer_open` opens a document or folder in its own application and waits
  for the window, `computer_file_dialog` drives the Windows Open/Save dialog by
  its own controls, and `computer_paste` gained `files` (a real file drop on the
  clipboard) and `{ file, as_text }`.
- The skill carries a hand-off table for Claude in Chrome: the extension owns
  the page and its own uploads, this plugin owns the OS picker, a pasted file, a
  document on disk and every window that is not a Chrome page.
- `docs/research/2026-09-20-chrome-and-file-dialogs.md`: the extension's tool
  surface, its documented failures, and the common-dialog automation ids with
  their sources.

## 0.8.2 - 2026-09-14

- The server reads its version from the manifest rather than a second copy.

## 0.8.1 - 2026-09-08

- The first real review of the blind-tree note and the restoring paste.

## 0.8.0 - 2026-09-08

- A blind tree says why it is blind: an Electron renderer with accessibility
  off, a canvas surface, or a cause nothing can name.
- `computer_paste` saves every clipboard format before it types and puts them
  all back afterwards, so a copied image, file or formatted cells survive.

## 0.7.0 - 2026-09-08

- The September audit fixes, and the research on what better computer use means
  measured against ChatGPT's and Anthropic's own.

## 0.6.0 - 2026-09-06

- What ChatGPT's computer use gained with Astra, on Windows and macOS: appshots
  on both Ctrl keys, popups and menus in the listing, PrintWindow capture of
  covered windows, drag, Start-menu launch, and a rewritten macOS host.

## 0.5.0 - 2026-09-05

- The journal and recap, the Stop-hook turn end, steering, the safety monitor,
  and the `background_at_turn_end` setting.

## Before 0.5.0

Released as Axon. `git log` carries the detail; the plugin was renamed to Better
Computer Use when it went to the marketplace.
