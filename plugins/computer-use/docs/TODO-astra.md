# To do: closer to Astra

Gev's ask (2026-09-21): make Better Computer Use as close to ChatGPT's computer
use with GPT-6 Astra as possible; consider removing the overlay and animations.
The research is `docs/research/2026-09-21-dr-computer-use-vs-astra.md`, read
from the Codex plugin bundle on this machine, not from the web, wherever the
row says VERIFIED (bundle).

## Settled by the research

- Astra draws nothing on the user's screen: no overlay, no marker, no banner,
  no animation, no cursor of its own (VERIFIED bundle, exhaustive search). It
  takes the real cursor over with no way to tell its input from the user's.
  Removing this plugin's marker, flash, banner, coexistence, appshot hotkey,
  journal or recap gains no Astra behaviour, and every one of them is already
  a setting (`CU_OVERLAY=off`, `coexist_mode`, `appshot_hotkey`). Verdict:
  keep all seven; do not copy the cursor takeover.
- Astra's read is one call that always carries a screenshot beside a tree that
  may be null (VERIFIED bundle). Done in 0.9.4: a blind tree attaches the
  picture in the same read.
- Astra's loop is strictly sequential, and `launch_app` never promises to name
  the new window (VERIFIED bundle). Both bug classes from the field test are
  closed differently here in 0.9.3, without giving up the capability.

## Open, ranked by value per hour

1. Done in 0.11.0. Deny always wins over allow: the `blocked_apps` versus
   `always_allowed_apps` ordering is written out in `server/policy.mjs`, and
   `isAlwaysAllowed` itself says no for a blocked or shell-tier app, so the
   order no longer rests on `checkAct` asking in the right sequence.
   policy-test pins it: an app on both lists is blocked, a hard-blocklisted
   app or a terminal on the allow list is still blocked or read-only.
2. Done in 0.11.0. The trust rule is in `policy.mjs` as code: `SOURCE`,
   `canSatisfy(source, tier)` and `sourceOfWords(words, screenTexts)`, which
   `decideConfirmation` consults and `consequenceCheck` in `server/index.mjs`
   calls for every click and file-dialog confirm. What the server can check
   for itself is limited: it refuses words it read off the screen this
   session; that words are typed rather than pasted is still Claude's word.
3. Done in 0.11.0. Four tiers (`CONFIRM`: hand-off, always confirm,
   pre-approval, none). `computer_grant { hwnd, preapprove, user_words }`
   pre-approves one message-type control (Send, Post, Reply all, Upload,
   Like) in one app until the session ends; it lives in `Sessions`, memory
   only, ends on close, on another conversation's id, and on revoke or Stop,
   and never reaches a background run. sessions-test covers its lifetime.
4. An out-of-band safety monitor that can pause a run after approval, not
   only halt within a `computer_run` step sequence (VERIFIED web). High.
5. A `Windows.Graphics.Capture` path for occluded windows beside the
   PrintWindow and CopyFromScreen chain (VERIFIED bundle names it). High,
   uncertain payoff.
6. Compile and run the macOS host on real hardware; Astra ships macOS today
   and `AxonHost.swift` has never been built (VERIFIED). Blocks every other
   macOS item. Needs a Mac.

## Field findings from 2026-09-21, with Astra's answer

1. Separate virtual desktop: Astra never targets one and documents no
   cross-desktop action; its only workaround is a whole VM. The skill now says
   the rule cannot be honoured on Windows (0.9.3).
2. Launch named the wrong windows: Astra never names the window at all. Fixed
   by naming only the app's own window (0.9.3).
3. Concurrent listings timed out: Astra is sequential and cannot hit it. Fixed
   by sharing one listing (0.9.3).
4. Browser task never reached the tree: Astra's read always carries a
   screenshot. Fixed by the blind-tree auto image (0.9.4).
5. A stray second desktop: Astra never creates one. Do not close it by
   switching the user's screen; the user closes it.
