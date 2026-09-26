# Field test: Doodle Voyager (2026-09-22 to 2026-09-25)

Doodle Voyager is a first-person space shooter in the style of Doodle Shooter,
built to test UFS while being a real game: three.js through an import map, no
build step, a staged `dist/` deployed to Vercel (doodle-voyager.vercel.app),
Supabase Realtime multiplayer. Source: D:/doodle-voyager.

Built with UFS 6.1.2 (the review of what UFS offers a game is section 1 of
the game's `docs/PLAN.md`), then 6.2.0 to 6.4.2 as the fixes below landed.

Mined from: the game's git log (9631968 to 66a08be), `TODO.md`,
`docs/TODO.md`, `docs/PLAN.md`, `docs/REFERENCES.md`, `docs/specs/`, the
build report of the 2026-09-25 multiplayer stage (its `ufsLessons`), Gev's
memory notes (project_doodle_voyager, feedback_game_tests_ufs_first,
feedback_test_widths_match_input) and targeted greps of the build sessions'
transcripts. Nothing here is from memory alone.

The game's plan said, on day one: "Built here because UFS does not cover it:
the game renderer, game state, input, synthesised audio, and a game test
harness." Most of what follows is that gap.

### DV-1. Checked at phone widths a keyboard-and-mouse game never runs at

**What happened.** On 2026-09-22 the start screen was render-checked at
1440 and 390 px. The game has no touch controls, so the 390 px run tested
nothing a player sees. Gev: "why are you running on mobile widths if you
didnt create touch screens for mobile?"

**What UFS said or did.** `webdesign.mjs look` defaulted to `1440,390`, a
website default, and `references/games.md` said nothing about widths.

**What it should have said or done.** Pick widths from the input model and
the target devices: a keyboard-and-mouse game gets 1366x768 (Chromebook),
1280x720 and 1920x1080; phone widths only once touch controls exist.

**The UFS fix.** 6.3.0 (dc48c12, 2026-09-24): `--game` switches `look`,
`debug` and `verify` to 1366, 1280 and 1920; an explicit `--widths` still
wins (scripts/args.mjs). `references/games.md`, section "In-game rendering:
five mistakes Doodle Voyager made", item 5.

**Regression check.** `test/args-game.test.mjs`, "--game switches the default widths to laptop and desktop sizes"
and `test/args-game.test.mjs`, "an explicit --widths still wins over --game".

### DV-2. A stylised post pass that threw the lighting away

**What happened.** The first "ballpoint on paper" look was a post pass that
drew ink edges and hatching over a paper colour and discarded the lit colour.
No surface had a light or a dark side; the whole game read flat and white.
Replaced on 2026-09-24 (d3aa89b) by Lambert-lit materials with object-space
hatching.

**What UFS said or did.** Nothing. `references/games.md` was a teardown of
start screens; it had no in-game rendering guidance at all.

**What it should have said or done.** Keep real lighting in the materials and
stylise there (patch `MeshLambertMaterial` with `onBeforeCompile`, hatch from
the light that actually arrived); the post pass only adds edges, background
and screen effects.

**The UFS fix.** 6.3.0: `references/games.md`, section "In-game rendering:
five mistakes Doodle Voyager made", item 1.

**Regression check.** Not testable automatically: a post pass that replaces
lighting and one that legitimately adds to it are the same code shape
(a full-screen pass reading the scene colour); only the rendered result
tells them apart, and that is a judgement on a screenshot.

### DV-3. Bloom encoded the gamma a second time

**What happened.** With `EffectComposer`, a composite `ShaderPass` that
ended in `pow(c, 1/2.2)`, then `UnrealBloomPass`, every dark value washed out
milky: bloom copies its input to the screen through a material three.js
sRGB-encodes. The shape is in js/render.js at d3aa89b; fc25a40 (2026-09-24)
fixed it with `renderer.outputColorSpace = THREE.LinearSRGBColorSpace`.

**What UFS said or did.** Nothing; `references/three.md` covers tone mapping
for a product hero, not a hand-encoded composite ahead of bloom.

**What it should have said or done.** Either keep the chain linear and end on
`OutputPass`, or set the output colour space to linear when encoding by hand;
and flag the combination in the audit, because it is visible in source.

**The UFS fix.** 6.3.0: `references/games.md`, section "In-game rendering:
five mistakes Doodle Voyager made", item 2. This change adds an audit rule
(scripts/audit.mjs): a hand `pow(..., 1/2.2)` plus `UnrealBloomPass` with no
`LinearSRGBColorSpace` and no `OutputPass` is a warning. Run on the game's own
files it warns on render.js at d3aa89b and is silent on fc25a40.

**Regression check.** `test/audit.test.mjs`, "a hand gamma-encode ahead of UnrealBloomPass is a warning until the output colour space or OutputPass settles it (Doodle Voyager)"

### DV-4. Colour edges outlined every hatch stroke

**What happened.** Once the hatching moved into the materials, the post
pass's colour-difference edge detection fired on every pen line and each
surface became a bright mesh.

**What UFS said or did.** Nothing: no reference said how edge detection and
in-material hatching interact.

**What it should have said or done.** Keep depth, background and material-ID
edges; restrict colour edges to materials without hatching.

**The UFS fix.** 6.3.0: `references/games.md`, section "In-game rendering:
five mistakes Doodle Voyager made", item 3.

**Regression check.** Not testable automatically: it lives in the project's
own edge shader and shows only in the rendered frame; UFS ships no game
renderer to hold it in.

### DV-5. "Neon" read as every surface glowing

**What happened.** The first neon pass put bright cyan edges and rims on
everything; it read as a wireframe, not as a neon city.

**What UFS said or did.** Nothing on what "neon" means in a scene.

**What it should have said or done.** Dark surfaces, dim silhouettes, low
fill light (a hemisphere near 0.3 inside a cabin), colour only on emitters,
and a bloom threshold that catches only those.

**The UFS fix.** 6.3.0: `references/games.md`, section "In-game rendering:
five mistakes Doodle Voyager made", item 4.

**Regression check.** Not testable automatically: it is an art-direction
judgement about which surfaces emit.

### DV-6. A closed map's canvas failed the render check

**What happened.** On 2026-09-25, `webdesign.mjs look
https://doodle-voyager.vercel.app/ --game` printed "ERROR canvas has zero
visible size" at all six width and scroll combinations. The game canvas was
fine; the zero-size one was `#m-canvas`, the map, inside
`<section id="map" hidden>`, which is `display: none` until M is pressed.

**What UFS said or did.** It reported a correct page as broken, six times.

**What it should have said or done.** A canvas in a hidden or closed layer is
a screen nobody opened: note it and do not check it.

**The UFS fix.** This change: `canvasProbe()` in scripts/inspect.mjs records
`rendered` from `checkVisibility()`, and the report prints "note canvas #id
is not rendered (in a hidden or closed layer); not checked". Every canvas
message now names the canvas. `references/visual-debug.md`, section "Gated
pages and game screens".

**Regression check.** `test/field-tests.test.mjs`, "a game title screen: text in fixed layers is measured, a closed map canvas is a note, a real clash is still an overlap"

### DV-7. "0 text elements" on a title card full of text

**What happened.** The same run reported "(0 text elements, page 1000px
tall)" for the title card: headings, the key legend, settings labels. So no
overlap and no contrast check ran on any of it.

**What UFS said or did.** The probe skipped every element with a fixed or
sticky ancestor (to spare a pinned header over scrolled content), and in a
game every menu lives in a fixed layer: `#main` is fixed and each `.overlay`
inside it is fixed and scrolls. Confirmed by running the new check against
the old inspect.mjs: "text elements: 0".

**What it should have said or done.** Measure pinned text, and compare it
only with text in the same pinned layer; judge its contrast against what the
layer paints, or sample the pixels when the layer paints nothing.

**The UFS fix.** This change: the probe keeps pinned text with its layer,
overlap compares only same-layer pairs, `bgOf` stops at the layer, and
`stats.pinnedText` counts it.

**Regression check.** `test/field-tests.test.mjs`, "a game title screen: text in fixed layers is measured, a closed map canvas is a note, a real clash is still an overlap"
and `test/field-tests.test.mjs`, "a pinned header over scrolled content is still not an overlap, and its text is sampled against what is behind it"

### DV-8. The page's own policy blocked multiplayer, and every check passed

**What happened.** net.js did
`import('https://esm.sh/@supabase/supabase-js@2')` and
`createClient(PROJECT)` with a Realtime channel. The staged policy allowed
`self` and jsDelivr in `script-src` and had no Supabase origin in
`connect-src`. The offline suite drove multiplayer through a fake bus, so
live multiplayer was dead in production with 200-odd checks green. Found on
2026-09-25 by a live two-player check (`node tools/live.mjs --url
https://doodle-voyager.vercel.app/` failed 1/6 on the script-src violation);
fixed in c76f025.

**What UFS said or did.** `webdesign.mjs security`, which the game's plan
runs before deploy, flagged unpinned CDN scripts but had no rule relating the
policy to the origins the code loads. `references/games.md` said nothing
about transports or policies.

**What it should have said or done.** Compare the policy with every URL the
code loads and fail on a refused one; and tell a game to build the policy
from the code's own constants, pin CDN modules on an allowed host, test the
staged build under its real headers, and keep one live end-to-end check
outside the offline suite.

**The UFS fix.** This change: `securityAudit()` reads every policy in
`_headers`, `vercel.json` and `netlify.toml`, collects the URLs the code
loads that it can resolve exactly (literals, same-file string constants,
templates of those; `import()`, static imports, `<script src>`, import maps,
`fetch`, `WebSocket`, `EventSource`, `sendBeacon`, Supabase `createClient` and
its Realtime `wss:`), and reports a URL every policy refuses as high. Run on
the game's own pre-fix net.js and staged policy it reports exactly the three
refusals (esm.sh, the https and the wss Supabase origins); on the current
`dist/` it reports none. `references/games.md`, section "Shipping a networked
game: five more mistakes Doodle Voyager made", item 6, and
`references/pipeline.md`, section "9. Ship".

**Regression check.** `test/security.test.mjs`, "a CSP that refuses the code's own client library and Realtime host is high; the fixed policy is clean (Doodle Voyager)"
and `test/security.test.mjs`, "CSP matching follows the spec where it matters: paths, wildcards, schemes, default-src and strict-dynamic"

### DV-9. Network ghosts drawn in the wrong space

**What happened.** The world is drawn relative to the ship and squashed with
distance (render.js `squash`); network ghosts were placed at absolute
coordinates, so a real peer sat nowhere near where it was. The check asserted
`mesh.x === ghost.x`, which enshrined the bug. Fixed on 2026-09-25 (5ef2cc9).

**What UFS said or did.** Nothing on floating-origin or ship-relative worlds.

**What it should have said or done.** Every new kind of actor goes through
the one placement function, and its test asserts against that function, not
against raw coordinates.

**The UFS fix.** This change: `references/games.md`, section "Shipping a
networked game: five more mistakes Doodle Voyager made", item 7.

**Regression check.** Not testable: the placement function is the project's
own; UFS has no game runtime in which to assert it.

### DV-10. Game checks that counted wall-clock frames

**What happened.** Checks that waited milliseconds and let the frame loop run
failed on a loaded machine: the throttle check got 33 units instead of 66,
the breach check 0.3 s of simulation instead of 0.5, and a late
`pointerlockchange` paused one of two headless players. Fixed by stepping
simulated time (2026-09-25).

**What UFS said or did.** Nothing; UFS has no guidance for a game test
harness.

**What it should have said or done.** Advance the simulation with explicit
`update(dt)` calls for anything whose assertion depends on elapsed game time;
wall-clock waits only for what needs frames.

**The UFS fix.** This change: `references/games.md`, section "Shipping a
networked game: five more mistakes Doodle Voyager made", item 8.

**Regression check.** Not testable: it is a property of the project's test
harness, which UFS does not ship.

### DV-11. Fading a label in a renderer that keeps material IDs in alpha

**What happened.** The renderer reads alpha as a material ID (edge
detection), so the new name labels over ghosts could not fade with alpha
without drawing false ID edges; they fade by dimming plus a screen-door
dither. The second look (Doodle Shooter's ballpoint on paper) went in as
shared uniforms with the HUD's CSS palette and blend mode switching with it
(006f808, 2248baa).

**What UFS said or did.** games.md item 1 (keep lighting in the materials)
held up: the paper look built that way did not go flat. It said nothing about
alpha as an ID channel or about a switchable second look.

**What it should have said or done.** Say both, so the next renderer does
not rediscover them.

**The UFS fix.** This change: `references/games.md`, section "Shipping a
networked game: five more mistakes Doodle Voyager made", item 9.

**Regression check.** Not testable: both live in the project's shaders and
compositing; there is nothing in UFS to run them against.

### DV-12. Staging deleted the deploy link, and deploys made stray projects

**What happened.** tools/stage.mjs emptied all of `dist/`, `.vercel/`
included, so the next `vercel deploy` found no link and created a new
project named `dist` instead of updating doodle-voyager. It happened twice
before 89216c8 (2026-09-25) kept the link.

**What UFS said or did.** Nothing. The ship stage of `references/pipeline.md`
covered secrets and headers, not the deploy link.

**What it should have said or done.** Keep `.vercel/` when a build folder is
cleared, read `.vercel/project.json` before a production deploy, and flag a
link to a project named like a build folder.

**The UFS fix.** This change: `webdesign.mjs security` prints the linked
Vercel project in its header and warns when the link names a project called
`dist`, `build`, `out`, `public`, `site`, `www` or `_site`.
`references/pipeline.md`, section "9. Ship", and `references/games.md`,
section "Shipping a networked game: five more mistakes Doodle Voyager made",
item 10.

**Regression check.** `test/security.test.mjs`, "a deploy link to a project named like a build folder is reported, and the real one is named (Doodle Voyager)"

### DV-13. No game test harness to start from

**What happened.** The game built its own harness (tools/test.mjs: headless
Chrome, `window.__dv` hooks, console-error failure, screenshots; later 213
checks, a staged-CSP boot and a live two-player check). Every lesson from
DV-8 to DV-10 is about that harness.

**What UFS said or did.** Its render check covers pages, not a game loop;
the plan recorded "a game test harness" as something UFS does not cover.

**What it should have said or done.** Give a game the rules its harness must
follow (real transport under the served headers, simulated time, the
placement function) and the browser pieces to build it from.

**The UFS fix.** Partly done. The rules are in `references/games.md`, section
"Shipping a networked game: five more mistakes Doodle Voyager made", items
6 to 8, and the browser pieces are importable from scripts/inspect.mjs
(`findBrowser`, `launch`, `Session`, and now `CANVAS_INIT`). A scaffolded
game harness is not built; see the note at the end.

**Regression check.** Not testable: there is no harness scaffold in UFS yet
to test. What exists (the exported browser pieces) is held by
`test/field-tests.test.mjs`, "CANVAS_INIT is exported, so a project suite can read WebGL pixels the way inspect does (HQ)".

## Still open

- A scaffolded game test harness (DV-13). It needs a design pass against the
  game's own tools/test.mjs before it is worth shipping; a thin wrapper would
  be a placeholder.
- DV-2, DV-4, DV-5, DV-9 to DV-11 stay reference-only; each says why above.
