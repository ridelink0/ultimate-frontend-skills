# Field test: Doodle Voyager (2026-09-22 to 2026-09-25)

Doodle Voyager is a first-person space shooter in the style of Doodle Shooter,
built to test UFS while being a real game: three.js through an import map, no
build step, a staged `dist/` deployed to Vercel (doodle-voyager.vercel.app),
Supabase Realtime multiplayer. Source: D:/doodle-voyager.

Built with UFS 6.1.2 (the review of what UFS offers a game is section 1 of
the game's `docs/PLAN.md`), then 6.2.0 to 6.5.0 as the fixes below landed.

Mined from: the game's git log (9631968 to 66a08be), `TODO.md`,
`docs/TODO.md`, `docs/PLAN.md`, `docs/REFERENCES.md`, `docs/specs/`, the
build report of the 2026-09-25 multiplayer stage (its `ufsLessons`), Gev's
memory notes (project_doodle_voyager, feedback_game_tests_ufs_first,
feedback_test_widths_match_input) and targeted greps of the build sessions'
transcripts. DV-14 to DV-28 are Gev's own play review of the live build
(memory note project_doodle_voyager_fixes_0925, dictated 2026-09-25 about
20:10-20:30 CDT), quoted verbatim. Four of its claims were read back from the
game's own source at 66a08be, read-only: the motion-blur strength in
`js/render.js`, the shake setting in `js/game.js`, the missing `matchMedia`
read of reduced motion, and the ship-screen `<video>` outside the music mix in
`js/media.js`. The rest are what Gev saw on screen, and the record says so
rather than guessing at causes. Nothing here is from memory alone.

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

Run on the live game after the fix (`look https://doodle-voyager.vercel.app/
--game`, 2026-09-25): 61 text elements at every width, the map canvas a note,
no overlaps, and one finding the old probe could never have made: the LAUNCH
button's text computes to cyan rgb(77, 238, 255) on its yellow rgb(255, 194,
60), 1.15:1. That is the game's to fix; whether a blend mode or shadow
rescues it on screen was not checked here.

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

## Gev's play review, 2026-09-25

On the evening of 2026-09-25 Gev played the live build (a8172df + 89216c8,
with the visual-style commits 8b3f380 and 2248baa partly in) and came back with
seventeen things wrong with it, dictated while looking at the M87* black hole.
His words are in `C:/Users/OWNER/.claude/projects/C--Users-OWNER/memory/project_doodle_voyager_fixes_0925.md`
and are quoted below rather than paraphrased. Item 15 was praise and item 11 and
12 were about priority, so fifteen of them are lessons; item 16b is why this
section exists:

> "Put everything that im saying that you did wrong to be recorderd and see how
> you can improve UFS off that and teach other claudes from other people"

The game itself was paused when these were written, so every lesson here is an
UFS lesson, taken from what Gev saw on screen and from the settings and render
code that produced it. None of them was caught by anything: the offline suite
was 213 green, `webdesign.mjs look --game` was clean, the audit was clean, and
the security check was clean. That is the shape of this whole section - fifteen
real defects, zero signal from any automated check - and the fix for that is the
play pass at the end of `references/games.md`.

### DV-14. Light made the surface white instead of making the texture white

**What happened.** The "doodle" look (Doodle Shooter's ballpoint on paper,
commits 8b3f380 and 2248baa) lit surfaces by making them brighter, and with
bloom on top the M87* screenshot Gev was looking at was a blown-out white ball:
no hatching, no shading, no paper. Gev, verbatim: "when i mean doodle shoot
textures I meant that lighiting makes the texture white (not the ligting the
texture) and as you can see with the black hole you did it correctly, it shows
shading at the end which is what I want for everything". The accretion disc,
which shades toward its edges, was the one surface that read right.

**What UFS said or did.** `references/games.md`, in-game rendering item 1, said
to keep lighting in the materials and stylise there, and even that "Doodle
Shooter's look is a texture on lit surfaces, not a replacement for lighting".
That is where to stylise, not what light is allowed to do once you are there.
Nothing said that light selects the drawn value and must never exceed the paper,
and nothing in `references/three.md` covered a drawn or hatched material at all.
`webdesign.mjs look` read the canvas for a flat fill and for its size, and had no
opinion about a surface clipped to pure white.

**What it should have said or done.** State the rule in one line - light drives
the albedo toward paper white and drives hatch coverage down; it never adds
brightness - with the paper white kept below pure white so the shading survives
and bloom has nothing to grab, the light quantised to three to five bands before
hatching, and object-space hatch coordinates so strokes do not swim. And it
should be able to see the failure: a lit surface at 255 on every channel has
lost its texture, and that is measurable from the pixels.

**The UFS fix.** This change. `references/three.md`, section "12. The hand-drawn
look: the light whitens the texture", carries the recipe, the pixel check and the
one-sentence test ("more light means less ink, never more brightness").
`references/games.md`, section "Playing it: what Gev's review caught that every
check passed", item 11, carries the rule. In `scripts/inspect.mjs`, `canvasProbe`
now reports `clipped`, the share of the sampled frame at opaque pure white, and
`formatReport` warns when more than 15% of a WebGL canvas is clipped. It is a
warning, not an error, and it fires only on WebGL canvases: a 2D canvas drawing
a white card is not this bug, and a white-out is a legitimate frame in a flash.

**Regression check.** `test/field-tests.test.mjs`, "a WebGL canvas clipped to pure white is a warning; paper white with shading is not (Doodle Voyager)"
- the fixture draws one canvas whose lit side is 255,255,255 and one whose lit
side is paper white (244) with a shaded quarter; the first warns, the second is
silent, and neither is a flat fill. Run against the pre-fix probe, `clipped` is
`undefined` and no warning exists.

### DV-15. Enemies built from the friendly ship kit do not read as enemies

**What happened.** The enemies inside the ships were made from the same hull
parts as the friendly ships, so at the distance a player first meets one it
reads as traffic. Gev: "they look like normal ships"; the enemy ship "is
supposed to be big, red, all of that", and the ones inside "do not look like
Doodle Shooter enemies".

**What UFS said or did.** Nothing. `references/games.md` was a study of start
screens and, after 2026-09-24, of in-game rendering technique; it had nothing on
whether an actor reads as what it is. The render check measures text and
canvases, not recognisability.

**What it should have said or done.** Silhouette first, then scale, then colour,
and the test is the distance the player actually meets the thing at: grab a frame
at engagement range, downscale it to a thumbnail, and if friend and enemy are not
distinguishable in the thumbnail, neither is distinguishable in play.

**The UFS fix.** This change: `references/games.md`, section "Playing it: what
Gev's review caught that every check passed", item 12, and the second question of
the play pass in the same file.

**Regression check.** `test/field-tests.test.mjs`, "every lesson from Gev's play review is a numbered item in the shipped games reference"
holds the shipped rule. The judgement itself is made by looking at a frame; no
UFS check can make it.

### DV-16. Enemies clipped through the walls of the room they were in

**What happened.** The interior enemies passed through the walls, which ends the
only tactic a room offers and reads as a broken game rather than a hard one.
Gev: "the enemies inside clip through walls".

**What UFS said or did.** Nothing. UFS has no guidance on collision, and its
checks look at what a page draws, never at what a simulation permits.

**What it should have said or done.** Anything that hunts the player is swept
against the collision geometry of the space it is in, and the check is
level-shaped: put the actor outside a wall, aim it at the player, step the
simulation, and assert it never crosses.

**The UFS fix.** This change: `references/games.md`, section "Playing it: what
Gev's review caught that every check passed", item 13, and the third question of
the play pass.

**Regression check.** `test/field-tests.test.mjs`, "every lesson from Gev's play review is a numbered item in the shipped games reference"
holds the shipped rule. The check it asks for lives in the project's own harness,
against the project's own geometry; UFS ships no game runtime to hold it.

### DV-17. A traversal tool with one destination made the game unplayable

**What happened.** The jetpack flew to the ship and nowhere else, so boarding a
small ship was both the only thing it could do and the hardest thing in the
game. Gev: "its hard to get inside the small ships when the jetpack is going to
the ship, no where else making this game WAY too hard".

**What UFS said or did.** Nothing. Difficulty and movement design were outside
everything UFS had written.

**What it should have said or done.** A movement verb takes a direction from the
player or it is a cutscene: free aim first, snap-to-target as an assist on top,
never the reverse. A traversal tool with exactly one destination is a scripted
move wearing the costume of a mechanic.

**The UFS fix.** This change: `references/games.md`, section "Playing it: what
Gev's review caught that every check passed", item 14, and the fourth question of
the play pass.

**Regression check.** `test/field-tests.test.mjs`, "every lesson from Gev's play review is a numbered item in the shipped games reference"
holds the shipped rule. Whether a mechanic is playable is measured by playing it.

### DV-18. Motion blur had no control of its own, and it shook the screen

**What happened.** Gev: "MOTION BLUR: no intensity control, and it shakes the
screen." The blur's strength was a field of the quality preset and nothing else
(js/render.js: `blur: 0` on low, `0.75` on medium, `1.0` on full, fed to
`this.motion.uniforms.strength`), and screen shake was a boolean in the settings
(`shake: true` in `defaultSettings()`). To turn the blur down Gev had to drop the
render quality, and the shake he could only switch off. The blur reprojects every
pixel along its screen-space motion, so a camera that micro-jitters smears every
frame a little, which reads as shaking rather than as speed.

**What UFS said or did.** `references/motion.md` had "Reduced motion", which is
about scroll-driven web motion, and the audit requires a
`prefers-reduced-motion` block in some stylesheet
(`scripts/audit.mjs`: "no prefers-reduced-motion block in any stylesheet"). A
canvas game passes that with a stylesheet it barely uses while its camera
effects ignore the preference entirely. Nothing said an effect a player feels in
their body needs its own control.

**What it should have said or done.** Separate comfort from quality: a quality
preset is about frame rate, and motion blur, shake, FOV kick, aberration,
vignette pulse and flashing each get a named 0-100% control that reaches a real
zero, all of them defaulting to zero when `prefers-reduced-motion` matches,
re-read on that media query's `change` event because CSS cannot reach a canvas
loop. And a reprojection blur clamps its vector length and ignores motion below
a floor, so a still or jittering camera blurs nothing.

**The UFS fix.** This change: `references/motion.md`, section "Screen effects a
player feels in their body"; `references/games.md`, section "Playing it: what
Gev's review caught that every check passed", item 15; and a line in
`references/checklist.md`, section "If it is a game". And one part of it is
checkable from the source: `scripts/audit.mjs` now warns when a script drives
camera shake or motion blur and no script reads `prefers-reduced-motion`
through `matchMedia()`. The game's reduced-motion rules were a block in
`style.css` that stops the title and message animations, and CSS text that
`js/media.js` injects for a video card. The old audit counted the stylesheet
block and was satisfied; no canvas loop reads either. Run on the game's own
source at 66a08be (read-only), the new rule warns; the audit before it said
nothing.

**Regression check.** `test/audit.test.mjs`, "camera shake or motion blur with no matchMedia read of reduced motion is a warning (Doodle Voyager)"
holds the part a source scan can decide, and `test/field-tests.test.mjs`, "every lesson from Gev's play review is a numbered item in the shipped games reference"
holds the shipped rule. Whether each effect has its own slider stays a played
check: a strength that comes from a quality preset and one that comes from its
own slider are the same code shape, and a rule that guessed between them would
fire on correct code.

### DV-19. Windows too small to see out of

**What happened.** The ship's windows were small panes, so standing at one
showed almost nothing and there was no reason to be there. Gev: "the ship
windows are way too small; make the window take the whole side of the room".

**What UFS said or did.** Nothing. UFS sizes type and controls; it had nothing
about sizing an opening by the job it does.

**What it should have said or done.** Size an opening by its purpose. If the
point of the window is to watch the world, the window is the wall.

**The UFS fix.** This change: `references/games.md`, section "Playing it: what
Gev's review caught that every check passed", item 16, and the sixth question of
the play pass.

**Regression check.** `test/field-tests.test.mjs`, "every lesson from Gev's play review is a numbered item in the shipped games reference"
holds the shipped rule. What a window is for is not something a check can know.

### DV-20. A hazard that killed in a loop, with no way out

**What happened.** Flying close to the black hole killed the player, respawned
them inside the kill radius, and killed them again. Gev: going too close "does a
loop of killing you". The render was the one thing he said was right about it.

**What UFS said or did.** Nothing. No reference covered failure states, respawn
or recovery.

**What it should have said or done.** Every hazard that can kill on contact
needs a respawn outside it, a grace period, or both; and the test is the nasty
one - die inside the hazard and assert the next state is playable.

**The UFS fix.** This change: `references/games.md`, section "Playing it: what
Gev's review caught that every check passed", item 17; the seventh question of
the play pass; and a line in `references/checklist.md`, section "If it is a
game".

**Regression check.** `test/field-tests.test.mjs`, "every lesson from Gev's play review is a numbered item in the shipped games reference"
holds the shipped rule. The assertion it asks for belongs in the project's own
harness, which UFS does not ship.

### DV-21. Advertisements were asked for, built, and never seen in play

**What happened.** Gev asked for advertisements on the planets. They were in the
code and he never saw one: "There are no ads like I asked".

**What UFS said or did.** Nothing on the gap between a feature existing and a
feature being reachable. Every check UFS ran looked at code or at a rendered
page, and the ads were in code and not in any rendered frame anyone looked at.

**What it should have said or done.** A feature that never renders in a session
is not shipped. For anything placed in a world, absence is the default and has
to be disproved: reach the place it lives, photograph it, and list what you
could not reach.

**The UFS fix.** This change: `references/games.md`, section "Playing it: what
Gev's review caught that every check passed", item 18; the eighth and last
questions of the play pass; and a line in `references/checklist.md`, section "If
it is a game".

**Regression check.** `test/field-tests.test.mjs`, "every lesson from Gev's play review is a numbered item in the shipped games reference"
holds the shipped rule. Reachability in a world is not decidable from the source.

### DV-22. Objects that look loose but cannot be picked up

**What happened.** Gev: "I cant pick up boxes for fun." The crates read as loose
props, so he tried, and nothing happened.

**What UFS said or did.** Nothing. Affordance was covered for buttons and links
on a page, never for a prop in a world.

**What it should have said or done.** This is the affordance rule in three
dimensions: a thing shaped like a button is a button. Props that read as loose
objects get the interaction their shape promises, or they are built so they do
not read as loose.

**The UFS fix.** This change: `references/games.md`, section "Playing it: what
Gev's review caught that every check passed", item 19, and the ninth question of
the play pass.

**Regression check.** `test/field-tests.test.mjs`, "every lesson from Gev's play review is a numbered item in the shipped games reference"
holds the shipped rule. What a shape promises is a judgement made by trying it.

### DV-23. Multiplayer you cannot visit, with players that do not read as players

**What happened.** Peers appeared in the world, but their ships could not be
boarded and the people themselves did not read as people. Gev: be able "to go to
other people's ships"; the people "look like Doodle Shooter enemies but BLUE".

**What UFS said or did.** `references/games.md` item 7 (from the day before)
covered placing a network actor correctly in a ship-relative world, which is
where it is drawn, not whether the player can reach it or recognise it.

**What it should have said or done.** Two rules. Every place the local player
can be is a place a remote player can be visited in. And a remote player's
colour is a team colour that nothing else in the palette may borrow, so a player
is never mistaken for scenery or for an enemy.

**The UFS fix.** This change: `references/games.md`, section "Playing it: what
Gev's review caught that every check passed", item 20, and the tenth question of
the play pass.

**Regression check.** `test/field-tests.test.mjs`, "every lesson from Gev's play review is a numbered item in the shipped games reference"
holds the shipped rule. Whether a peer reads as a player is judged from a frame,
and whether you can reach them from playing with two clients.

### DV-24. Ships too slow, with no acceleration control

**What happened.** Gev: ships "way faster with acceleration control"; the
fastest ships should go "from seeing the Milky Way from a distance to inside its
edge in seconds". The throttle set a speed; nothing gave the player control of
how it changed, and the top speeds made the scale of the world feel wrong.

**What UFS said or did.** Nothing on vehicle feel or on tuning speed against
the scale of a world.

**What it should have said or done.** Speed is an axis the player controls, not
a constant you tuned: an acceleration input, a top speed that differs per hull,
and a sense of scale that survives the top of the range. A single speed number
is a placeholder.

**The UFS fix.** This change: `references/games.md`, section "Playing it: what
Gev's review caught that every check passed", item 21, and the eleventh question
of the play pass.

**Regression check.** `test/field-tests.test.mjs`, "every lesson from Gev's play review is a numbered item in the shipped games reference"
holds the shipped rule. How fast is fast enough is felt, not measured.

### DV-25. No free roam: every journey had to be plotted

**What happened.** Travel meant plotting a course to a destination; there was no
way simply to fly. Gev: "you should also be able to free roam, not just having
to plot a course all the time".

**What UFS said or did.** Nothing: no reference said anything about how a
player is allowed to move through a world, only about how the world is drawn.

**What it should have said or done.** Autopilot is a convenience laid over free
movement, never the only way to move. If the only way to get anywhere is to pick
a destination from a list, the world is a menu.

**The UFS fix.** This change: `references/games.md`, section "Playing it: what
Gev's review caught that every check passed", item 22, and the twelfth question
of the play pass.

**Regression check.** `test/field-tests.test.mjs`, "every lesson from Gev's play review is a numbered item in the shipped games reference"
holds the shipped rule. Whether a world can be roamed is a design fact, not a
source fact.

### DV-26. One death screen for every cause

**What happened.** Every death - the black hole, a hull breach, an enemy - ended
on the same screen. Gev: "When you die it should actually show multiple screens
for multiple scnearos".

**What UFS said or did.** Nothing. UFS covers empty, loading and error states
for apps (`references/apps.md`); a death screen is the game's error state and
nothing said so.

**What it should have said or done.** A death screen is the game's one chance to
say what killed you and what to do differently: one per cause, naming the cause.

**The UFS fix.** This change: `references/games.md`, section "Playing it: what
Gev's review caught that every check passed", item 23, and the thirteenth
question of the play pass.

**Regression check.** `test/field-tests.test.mjs`, "every lesson from Gev's play review is a numbered item in the shipped games reference"
holds the shipped rule. Counting death screens needs a session, not a source
scan.

### DV-27. A second music source fighting the soundtrack

**What happened.** Gev: "I hear other music on the game that isnt even apart of
music and is battling the other music." Two things that are music to a player's
ear were audible at the same time. The game's source, read back without running
it, has one candidate: `js/audio.js` builds the music bus with a duck gain, and
`js/media.js` plays the ship screens' tapes through a `<video>` element at
volume 0.8 that is never fed into that graph (no `createMediaElementSource`),
so nothing can duck it under the soundtrack. Whether that is what Gev heard is
UNVERIFIED: the game was paused when this was recorded and nothing in it was
run or changed to check.

**What UFS said or did.** Nothing at all: UFS ships no audio reference. There is
no `references/audio.md`, and nothing in the other references says how a
project's sound sources relate to each other.

**What it should have said or done.** Everything audible goes through one named
bus with one mixer; anything that can sound at the same time as the music either
shares its bus or ducks it; and the list of sources that can be audible at once
is short enough to write down and check by listening.

**The UFS fix.** This change: `references/games.md`, section "Playing it: what
Gev's review caught that every check passed", item 24; the fourteenth question
of the play pass; and a line in `references/checklist.md`, section "If it is a
game". The structural half is checkable: `scripts/audit.mjs` now warns when a
project mixes through an `AudioContext` and also has a `<video>` or `<audio>`
element that is not muted and not routed in with `createMediaElementSource()`.
On the game's source at 66a08be (read-only) it warns; the audit before it did
not.

**Regression check.** `test/audit.test.mjs`, "a sounding media element outside the AudioContext mix is a warning; a muted or routed one is not (Doodle Voyager)"
holds the source-level half, and `test/field-tests.test.mjs`, "every lesson from Gev's play review is a numbered item in the shipped games reference"
holds the shipped rule. What is actually audible at once is still a runtime
fact, and the honest check for it is to listen.

### DV-28. Two names for the same verb: cruise and autopilot

**What happened.** The ship had both a cruise mode and an autopilot, which are
one idea with two names. Gev: "Remove the cruise it dosent make sense,
autopiolot does, just make it so the player themselves can move at cruise
speed."

**What UFS said or did.** `references/copy-tells.md` covers copy that reads as
generated; nothing covered two controls that name the same action, which is a
copy failure with a mechanic attached.

**What it should have said or done.** When two controls describe the same action,
cut one and fold its behaviour into the other; the survivor is the one the
player already understands.

**The UFS fix.** This change: `references/games.md`, section "Playing it: what
Gev's review caught that every check passed", item 25, and the fifteenth
question of the play pass.

**Regression check.** `test/field-tests.test.mjs`, "every lesson from Gev's play review is a numbered item in the shipped games reference"
holds the shipped rule. Whether two labels mean the same thing is a reading, not
a check.

### DV-29. The render check left a browser profile in %TEMP% on every run

**What happened.** On 2026-09-25, 1,647 folders named `webdesign-cdp-*` were
swept out of Gev's `%TEMP%` on a machine with about 25 GB free on C:, together
with 21 `dv-cdp-*` from the game's own harness, which had copied the pattern.
By the next evening 572 had already come back. Every `launch()` in
`scripts/inspect.mjs` made a throwaway user-data-dir and deleted it with
`setTimeout(() => rmSync(udd), 400)` after `proc.kill()`: on Windows the browser
still has the profile's files open 400 ms after a kill, `rmSync` threw into an
empty `catch`, and a CLI that exited first never ran the timer at all.
`scripts/video.mjs` never deleted its profile, and one of the new field tests
killed its browser without deleting anything.

**What UFS said or did.** It leaked, silently, on every run of the suite and
every `look`, `debug`, `verify`, `parity` and `video render`. Nothing reported
it and no test looked. The bundled `image-deep-research` skill had already
solved the same problem properly in its own `shutdown()` (wait for the browser
to stop answering, retry the delete, then end the processes carrying this run's
profile), and that fix had never been carried back into UFS's own launcher.

**What it should have said or done.** Cleanup is part of the run and has to be
awaited: ask the browser to close, wait for the process to be gone, delete with
retries, and escalate to ending only the processes that carry this run's own
profile path. Anything left by a crash or a Ctrl-C is swept by later runs.

**The UFS fix.** This change. `scripts/inspect.mjs` exports `closeBrowser`
(kill, wait for exit, `removeProfile` with a 3 s budget, then the
profile-matched process end and a 5 s budget), `removeProfile`, `sweepProfiles`
(each process's first `launch` clears up to 24 profiles older than an hour, off
the critical path) and `PROFILE_PREFIX`. Every caller now awaits it: `inspect`,
`inspectStyles`, `launchRendering`'s discarded attempts, `scripts/parity.mjs`,
`scripts/video.mjs` (which deleted nothing before) and the two tests that launch
their own browser.

**Regression check.** `test/browser.test.mjs`, "a finished run of the render check leaves no temporary browser profile behind"
and `test/browser.test.mjs`, "closeBrowser ends the browser, deletes its profile, and reports that it is gone"
and `test/browser.test.mjs`, "the launch sweep clears stale profiles only: fresh ones, other folders and the cap are respected"
and `test/browser.test.mjs`, "removeProfile deletes a profile folder and treats an absent one as done"
and `test/browser.test.mjs`, "a profile that outlasted every wait is deleted as the run ends"
and `test/browser.test.mjs`, "no test asks for a review folder in the temp directory it never deletes"
and `test/browser.test.mjs`, "every launch turns off the component updater that leaves msedge_* folders in the temp directory".
That last one is the leak one folder further out still: a fresh profile starts
Edge's component updater, which writes empty `msedge_url_fetcher_*` and
`msedge_chrome_Unpacker_*` folders into `%TEMP%` itself, where no profile
delete reaches them. A full suite run on 2026-09-25 left 21 of them, and 1,526
were on the machine. Four launches left 3 and 2 without
`--disable-component-update` and none with it (measured twice each way), so
every launch now carries it.
The last of those is the same leak one folder along: `debugSite()` with no
`out` makes a `webdesign-review-*` folder for its screenshots, right for a user
who is told to open them and wrong for a test that never deletes it, and
`runVerify()` goes through it too. Four test calls did that on every suite run;
on 2026-09-25 there were 74 such folders in Gev's `%TEMP%`, every one of them a
test fixture (20 verify-merge, 17 visual-photo-contrast, 17
visual-clipped-overlap, 20 from the verify-url server). `runVerify()` now
passes `out` through, every test names a folder inside the fixture directory
it already removes, and the check reads each call to its closing bracket so a
call split over lines is still caught. The first of those drives the real `look` CLI in a child process and counts
%TEMP% once it has exited, because that is the promise: a finished run leaves
nothing. A browser can recreate its own profile folder after the delete that
reported success (an empty one, on the Ubuntu runner), so closeBrowser waits
for anything holding the profile to be gone, deletes, looks again three times,
and takes away at exit what it could not catch in time. Run in-process against
the pre-fix cleanup, the same check failed with "inspect left 1 profile(s) in
C:\\Users\\OWNER\\AppData\\Local\\Temp: webdesign-cdp-fRp5B8". The check then
failed on CI on both runners, for a reason of its own: CI runs the test files
in parallel, and the shared temp directory held the live profiles of browsers
other files had open (the holder it named was a running Chrome whose parent
was still alive). The CLI now gets a temp directory of its own, so only its
own profiles are counted; with `closeBrowser` made to skip the delete, the
check still fails ("the run left 1 profile(s) in its temp directory").

### DV-30. Nobody played it before the owner did

**What happened.** Fifteen defects, found in one twenty-minute session by the
person who asked for the game, on a build whose offline suite was 213 green and
whose UFS checks were all clean. Not one of them was a bug a test could catch;
every one was the game failing to be a game. Gev, item 16b: "Put everything
that im saying that you did wrong to be recorderd and see how you can improve
UFS off that and teach other claudes from other people".

**What UFS said or did.** UFS had a pre-ship checklist for pages
(`references/checklist.md`) and the field-test method for recording an owner's
review after the fact (`docs/field-tests/README.md`). It had nothing that said a
game is judged by playing it, and no list of questions someone holding the
controls should answer before the owner does.

**What it should have said or done.** Treat a green suite as the floor and a
played session as the verdict, with the questions written down so the pass is
repeatable and so each one names the defect class it came from. And the lessons
have to arrive in the SHIPPED references, not only in the record, or they teach
nobody: that is the whole of item 16b.

**The UFS fix.** This change: `references/games.md`, section "Before you call a
game done: the play pass", sixteen questions, one per lesson above plus the
honesty question; `references/checklist.md`, section "If it is a game"; and a
row in `skills/ultimate-frontend-skills/SKILL.md`'s surface table for the game
itself, which routes to the play pass, to `references/three.md` section 12 and
to `references/motion.md`'s screen-effects section.

**Regression check.** `test/field-tests.test.mjs`, "every lesson from Gev's play review is a numbered item in the shipped games reference"
- it fails if a lesson from this review is recorded without a numbered item in
the shipped reference, if the play-pass section goes missing, or if it drops
below one question per lesson. That is the check that holds "teach other claudes
from other people".

## Still open

- A scaffolded game test harness (DV-13). It needs a design pass against the
  game's own tools/test.mjs before it is worth shipping; a thin wrapper would
  be a placeholder.
- DV-2, DV-4, DV-5, DV-9 to DV-11 stay reference-only; each says why above.
- DV-15 to DV-28 are shipped as rules and as the play pass, and each says
  above what a UFS check can and cannot decide. DV-14 (a lit surface clipped
  to pure white) is measured from the pixels; DV-18 (screen effects that never
  read reduced motion) and DV-27 (a sounding media element outside the music
  mix) are caught from the source; the rest need someone playing.
- The game fixes themselves are the game's work, not UFS's, and the game was
  paused when this review was recorded. Nothing in D:/doodle-voyager was
  changed by it.
