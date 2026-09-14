# Ultimate Frontend Skills 5.0.0 - what is done, what is next

Written 2026-09-13 when the 5-hour window ran out mid-build. A session picking
this up should read this file first and then just do the "Next" list. Nothing
here needs a decision from Gev; it was all agreed in the goal for this session.

## Done and pushed (github.com/ridelink0/ultimate-frontend-skills)

- Renamed: plugin id `ultimate-frontend-skills`, skill dir moved, UWS -> UFS
  everywhere, 5.0.0 in all three manifests, GitHub repo renamed. Old names redirect.
- `scripts/awards.mjs` - the reference corpus engine. Query, `--pick` three that
  disagree, `--build` merges `data/awards/*.json`, drops rows without a usable URL.
- `scripts/webdesign.mjs` - new subcommands `awards`, `blender`, `assets`, `tools`,
  and `study --awards "<query>"`. `scripts/args.mjs` allowlist extended for them.
- `references/pipeline.md` - the nine-stage route, gate at each stage.
- SKILL.md, README.md, AGENTS.md, docs/merge.md wired to all of it.
- `data/awards.json` - 61 entries, 53 URL-verified, from 2 of 12 harvest chunks.

## Landed since (2026-09-14, second session)

- `package.json` + bin entries (`ultimate-frontend-skills`, `ufs`); GitHub topics
  and description set. npm publish still needs an authenticated account - `npm whoami`
  returned 401, so it was prepared, not published. That is the one distribution
  channel still open.
- usage-limits 1.24.0 in C:/Users/OWNER/Downloads/claude-code-usage-limits:
  `scripts/net.js` (reachability + TLS-interception detection + failure
  classification), relay arms at the END of a reply rather than mid-reply
  (`armOn: completion`, backstop 95), an offline preflight that holds rather than
  spends the relay, bounded rearming, run logs, a visible resumed window, and
  `relay doctor`. 775/775 tests pass. ANOTHER CLAUDE SESSION shares that tree and
  owns wake.js/defer.js - do not edit it without checking with them.

Suite on e217fb3 (the tree as pushed, 2026-09-14 pm): 81 pass, 0 fail, 0
cancelled. A later run under heavy load was 80/81, and this time the TAP was
kept: test 33 failed with `fixture raised []` - the shift-on-load fixture
raised NOTHING, expected 1. That is a MISSED DEFECT under load, not the extra
timing warning raisesAllowingTiming tolerates, and it must not be tolerated:
the test is right to fail. Cause to fix: the test waits a fixed 900 ms for
the post-load shift, and a loaded browser had not shifted yet. Make the
inspector wait for the layout-shift entry (or the fixture's own signal)
rather than a fixed delay. Passes alone; the 81/81 runs stand.

Pass-2 tooling 2026-09-14 pm: madge/validate/publint/knip/html-validate all
clean. The audit flagged 'duplicate id(s): main' on both pages - a false
positive from an HTML COMMENT containing the literal text id="main"; the
comment is reworded. OPEN: check whether the audit's duplicate-id scan (audit.mjs near line 279,
on `h`) sees comment-stripped text - line 61 strips comments in a chain, yet
the ids inside a comment were counted. Either the strip is on another variable
or the chain is not what feeds the id scan. Small fix once read; not made under
the cap.

computer-use: the local checkout is C:/Users/OWNER/Downloads/axon (NOT a
clone - one existed and I missed it). Pass 1 on origin: plugin validate
passed, madge clean, 8 of 10 tools/*-test.mjs exit 0; astra-test.mjs and
batch-test.mjs exit 1, causes NOT investigated. owner-4d runs pass 2 and holds
the AxonHost.cs read in their relay note.

## Still open as of 2026-09-14 afternoon (the 9:55 relay never ran - argv cap)

- test 47 in test/fixtures.test.mjs PASSES when run alone (verified 2026-09-14
  afternoon) and fails only under load, where the CONTROL page gets flagged with
  '300 layouts per scroll event'. So it is not a false positive on a quiet
  machine, but the mechanism is different from 31/33 and the fix is not a test
  tolerance: measure.mjs's layoutsPerScroll divides a layout count by a
  scroll-event count, and under load the browser coalesces scroll events so the
  denominator collapses and the ratio inflates. Make the measurement robust
  (count scroll FRAMES or cap the denominator at the gesture's event budget),
  then the test holds under load without touching it.
- UI gaps from the ui.md/craft.md analysis. DONE: mobile nav, 404.html in the
  scaffold, <main> landmark note, explicit input types. DONE 2026-09-14 pm: status colour ramp (--danger/--success in core.css,
  computed values from ui.md, no warning colour by design) and --accent-fill.
  Form validation wiring DONE (:user-invalid + aria-describedby + .field__error,
  focus-visible ring restored). STILL OPEN: loading/skeleton/empty/error state
  patterns, data-table accessibility past the two-column spec table, an error
  summary for long forms. Full list in the workflow
  result at ...tasks/w499yppa4.output while it exists.
- stack.md: pins fixed 2026-09-14 (all eleven now match npm). The KB figures
  were NOT re-measured; awards.md's corrections table has the measured ones.
- npm publish blocked: `npm whoami` is 401. Needs Gev. computer-use and
  video-watch also lack package.json/.codex-plugin.
- Relay notes must stay under 8,191 characters or use usage-limits >= 1.30.0.
- Skill packs (emilkowalski/skills and the ecosystem) integrated by handshake:
  references/skill-packs.md, tools.mjs detection incl. .agents/skills. DONE.
- `look <file>` now works (it rooted the server at the file before). DONE.
- Verification tooling pass 2026-09-14: madge, publint, plugin validate
  --strict, knip all clean; html-validate clean apart from no-inline-style on
  per-element placement values, which stand. gitleaks is NOT on PATH here.

## Next, in value order

1. **The seven references SKILL.md already points at do not exist yet.** Writing
   them is the top priority - the skill currently names missing files:
   - `references/fable-showcase.md` - the Sept 2026 Anthropic Fable 5.1 / Mythos 5.1
     launch page (anthropic.com/claude-fable-and-mythos-5-1, "Made with Fable 5.1")
     and the dive-watch bake-off where three frontier models built the same page from
     one prompt. Research it properly, then write the reproduction recipe for Opus and
     Sonnet. Extend `references/fable.md`, do not repeat it.
   - `references/briefs/dive-watch.md` - the verbatim brief (it is in this session's
     transcript and in the goal), plus a scroll-timeline table and where entries lose.
   - `references/blender.md` + `scripts/blender.mjs` + `scripts/blender/*.py` -
     Blender 4.3 IS installed on this machine. Verify every command by running it.
     probe/run/glb/bake/frames. Decision table first: most pages should not use Blender.
   - `references/image-gen.md` + `scripts/assets.mjs` - Poly Haven and ambientCG CC0
     PBR + HDRI (verify the real API URL shapes by calling them), plus image generation
     that detects an attached MCP / a key / a local generator and never invents one.
   - `references/three.md` - the one-rAF scrub architecture, PBR metal, wireframe-to-
     solid, projected callouts, the 60fps checklist. Verify CDN specifiers.
   - `references/plugins.md` + `scripts/tools.mjs` - the bench. `frontend-design` is
     installed at ~/.claude/plugins/cache/claude-plugins-official/frontend-design/ and
     owns aesthetic direction when present; this plugin supplies chassis/motion/3D/
     verification. Read the REAL installed_plugins.json v2 schema. Never print a secret.
     Also study github.com/MickeyAlton33/web-designer-plugin and credit what was adopted.
   - `references/awards.md` - how to use the corpus, the technique taxonomy, what
     jurors score, what now reads as dated. Must not contradict `references/tells.md`.
2. **Finish the corpus.** 10 of 12 chunks never landed. Target hundreds of entries
   across Awwwards SOTD/SOTM/SOTY, FWA, three.js, Codrops, Godly, Land-book,
   siteInspire, One Page Love, Httpster, Minimal Gallery, Lapa Ninja, CSSDA, and the
   studio sites. Write `data/awards/chunk-NN.json`, then `awards --build`.
   A fabricated URL poisons every study run - set `verified` honestly.
3. **Re-run the tests on a quiet machine.** Last run was 75 pass / 3 fail /
   3 cancelled, and all six were browser tests timing out at 30s or reporting
   "300 layouts per scroll event" while 18 agents were running. Confirm they are
   contention artifacts: `node --test test/*.test.mjs`. If any are real, fix them.
   Then `node scripts/webdesign.mjs new /tmp/t --name T && ... audit /tmp/t`.
4. **The usage-limits plugin change Gev asked for**: the relay should fire when the
   work is FINISHED, not pre-emptively when the window is about to be hit. Today it
   arms ahead of the limit. Make the completion of the work the trigger, with the
   80% reading as context rather than the cause. Plugin lives at
   ~/.claude/plugins/cache/usage-limits/usage-limits/1.21.0 (junction, edits are live -
   clear the brief cache and run the hook to prove it).
5. Bug-check twice, then push, then update the memory files.

## House rules that still hold

No emoji anywhere. Never invent a specific. Plain prose, no marketing language.
Verify before asserting - run the command, fetch the page. The user is Gev.

## When the resumed run finishes, or runs out again

Gev's instruction for the pick-up, verbatim in effect: finish, then turn it off;
if it is not finished, arm it again for the next five-hour window.

- **Finished** (the Next list is done, tests pass, pushed): cancel the relay -
  `node "$USAGE_LIMITS/scripts/relay.js" cancel` - and say so in one line. Do not
  leave a scheduled task behind that will wake into nothing.
- **Not finished**: update this file (move what landed into Done, leave the rest
  in Next), commit and push it, then re-arm for the next reset -
  `relay.js arm --session <this session id> "<the same continuation text>"`.
  The relay is already set to arm at 80 per cent, wake 15 minutes after the reset,
  delivery `resume`, `--permission-mode bypassPermissions`, `--model opus`.
- Either way, push before the window closes. A commit on GitHub is the only part
  of this that survives everything.

`$USAGE_LIMITS` above is
`C:/Users/OWNER/.claude/plugins/cache/usage-limits/usage-limits/1.21.0/skills/usage-limits`.
