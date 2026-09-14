# The dive-watch brief

The exemplar brief, reproduced verbatim, then read, then planned against this
plugin's own runtimes and commands. Run it as a rehearsal before you run the
pipeline against something that matters.

Every number in the plan below is either computed here from a formula that is in
this repo, or read off a file in `assets/`. Where something is a judgement rather
than a measurement it says so.

## The brief

Build the product page for a mechanical dive watch - a single scrolling page whose centerpiece is a real-time 3D model of the watch that assembles, explodes, and is annotated as the visitor scrolls.

Context you should know: this is going into a video watched by a large audience, your page is shown on camera against two other frontier models, and your work will be credited to you by name. Every model gets this identical prompt, including the same product. What's being judged is taste, motion choreography, and craft.

The product: a mechanical dive watch. You name it, position it, and write its copy. Invent the brand. The components you must model and be able to separate are the case, the rotating bezel, the crystal, the dial, the hands, the automatic movement, the winding rotor, the caseback, and the strap or bracelet.

Requirements:

1. **A real-time 3D watch, built in code.** No imported model files, no hotlinked assets - the geometry is authored procedurally or in code. It needs to read as a watch: correct proportions, brushed and polished metal that respond to light differently, a crystal with depth, applied indices, lume, a legible dial. Physically-based materials, real lighting, an environment that gives the metal something to reflect.

2. **Scroll drives everything.** The page is one continuous choreographed sequence - the watch rotates, opens, explodes into its components, isolates individual parts, and reassembles, all bound to scroll position. Scrubbing backward runs it cleanly in reverse. The motion is authored and eased, not linear and mechanical. Getting the *timing* right is most of the grade here.

3. **A wireframe-to-solid transition** somewhere in the sequence, where the watch reads as engineering drawing and resolves into the finished object.

4. **Hotspot callouts on the exploded components.** As each part separates, a labeled annotation appears anchored to it, with a line of copy explaining what it does. They enter and leave with the choreography rather than popping.

5. **A complete page, not just the 3D showcase.** A hero, the scroll sequence, a technical specification table (movement, power reserve, water resistance, case dimensions, crystal, lume, strap), a section on materials and finishing, and a purchase call to action with price and configuration options. The writing matters - this should read like a brand with a point of view, not placeholder copy.

6. **Typography and layout carry the brand.** Deliberate type scale, real hierarchy, generous and confident spacing. This is a luxury object; the page should feel like one. Avoid the default AI-website look - the centered hero, the three feature cards, the gradient blob, the same three fonts.

7. **Sixty frames per second while scrolling**, on a normal laptop. A 3D scroll page that stutters is worse than one that doesn't exist. Profile it and fix it.

8. **Responsive.** It has to work and stay beautiful down to a phone. The scroll choreography adapts rather than breaking.

9. **Single self-contained `index.html`.** Any library via CDN - three.js, GSAP, Lenis, whatever you want. No build step, no server, no API keys, no hotlinked images or fonts (use system or CDN-loaded webfonts, and generate any imagery in code). You have free reign to look up what libraries exist and how to use them.

10. **QA it by using it.** Scroll the whole page top to bottom and back up several times at different speeds. Confirm the sequence scrubs cleanly in both directions, nothing desyncs or jumps, callouts anchor to the right parts, the frame rate holds, and the mobile layout is genuinely good rather than merely functional. Fix what breaks.

Work completely autonomously. Do not ask for anything until it's finished.

DONE when: the scroll sequence is choreographed and holds sixty frames per second in both directions, the watch reads as a real product rather than a 3D exercise, and the page would be credible as a real brand's site.

## Reading the brief

**1 is testing whether you know that the environment is the material.** "No
imported model files" removes the escape route and leaves you with primitives, so
the grade is whether primitives still read as a watch. Two things decide it: a
lathed profile with a real chamfer rather than a cylinder (`ring()` in
`exploded.js` walks outside-bottom, outside-top, inside-top, inside-bottom, which
is why a bezel catches a highlight on its edge), and two finishes separated under
one light. "Brushed and polished metal that respond to light differently" is not
two roughness values; it is `anisotropy` on the case flanks and bracelet against
0 on the polished chamfers. With `scene.environment = null` every metal part
renders black, because a `metalness: 1` surface has no diffuse term.

**2 is testing bidirectional scrub determinism**, which is a correctness
property, not a feel property. Three things break it and all three pass static
review: any `+=` in the render path, because that is a function of frame count
and not of progress; a hand-rolled `v += (t - v) * k` lerp, which is frame-rate
dependent and lands on a different value at 30, 60 and 144 Hz for the same
wall-clock scroll; and a discrete event fired off `progress > 0.5` inside
`onUpdate`, which double-fires because scrub smoothing lags and can cross a
threshold, be overtaken, and cross back. Every scene write has to be an absolute
assignment from one normalised number. The "authored and eased, not linear"
clause is about the *sub-range* curves, not about the master scrub, which stays
linear because the scroll position is already the easing.

**3 is testing whether the transition is a state or an event.** An engineering
drawing that resolves into an object is only interesting if the reader can stop
halfway and hold it there, which rules out a two-material crossfade with a swap
at 0.5 and rules out anything that recompiles. A uniform-driven dissolve
(`uCut` through `onBeforeCompile`, with a stable `customProgramCacheKey`) is the
version that survives being held open at an arbitrary scroll position. The cheap
honest alternative for mechanical parts is an `EdgesGeometry` crossfade, which
reads as a drawing because it discards edges between coplanar faces.

**4 is testing whether the annotations are bound to the choreography clock or to
their own timers.** A label with a CSS transition, a `setTimeout`, or an
IntersectionObserver has a second clock in the page, and the moment the reader
scrubs backward the two clocks disagree - that is what "popping" actually is. The
fix is structural: the label's opacity is a function of the same progress number
the geometry reads, occlusion and off-screen are *multipliers* on that value and
never switches, and the whole thing runs through one smoothing pass so a label
passing behind the case fades over a few frames instead of blinking. The second
half of the requirement - "anchored to it" - is testing projection: a label at a
fixed CSS percentage drifts off its part the moment the camera turns.

**5 is testing whether you can write, and whether the page exists below the
canvas.** A 3D showcase with four sections of filler under it is the common
failure, because the canvas absorbs all the effort. The specification table is
the trap inside the trap: see "Where entries lose".

**6 is testing taste, and taste is checkable.** No font off the `tells.md` list,
no indigo-to-violet call to action, a type scale with at most five steps that
uses all of them, section padding that varies with content weight instead of one
repeated value, exactly one italic accent phrase in the page. "The centered hero,
the three feature cards, the gradient blob" is a list of four specific structures
to not build, and it is worth reading as an instruction rather than as flavour.

**7 is testing per-frame allocation discipline and, more than that, resize
discipline.** The measured order of cost is not the order people assume: calling
`setSize()` and `updateProjectionMatrix()` every frame costs 3.50 ms against a
0.20 ms steady state, a 17.5x hit, and a `ResizeObserver` that fires on a mobile
URL bar collapsing walks straight into it. Material recompiles are the other
unrecoverable hitch and are invisible to a sampling profiler. Allocation is real
but smaller than folklore - 200,000 `new Vector3().normalize()` against the same
count on a hoisted vector measured 10.9 ms against 9.4 ms, so the reason to hoist
is the major GC that eventually lands as one dropped frame, not the arithmetic.
"Profile it" is also part of the requirement: an assertion that it is fast is not
a profile.

**8 is testing whether you reframe or merely rescale.** A 16:9 camera framing a
wide assembly gives a postage stamp at 9:19.5, and a 400vh pin that is 36 wheel
notches on a laptop is one flick and a confused stop on a phone. The adaptation
is fewer stages, a shorter runway, a raised FOV, the model shifted up so the
callouts get the lower third, and a DPR clamp - a phone at raw DPR 3 shades
2,962,440 pixels against 2,916,000 for a 1440x900 laptop at 1.5, on a fraction of
the throughput.

**9 is testing packaging discipline.** The scaffolder in this repo writes
`core.css`, `motion.js` and `exploded.js` as separate files, so a page built the
normal way does not satisfy this requirement until you inline it, and inlining is
the step people forget to re-verify. "Any library via CDN" is permission, not an
invitation: every specifier must be pinned to an exact version, and both import
map keys must point at the same version and the same host or you load two copies
of three and every `instanceof` fails.

**10 is testing whether you actually ran it.** Everything in this list that is
not visible in a screenshot - the reverse scrub, the desync, the label that flies
to the opposite quadrant mid-turn, the frame rate under a fast drag - is only
findable by scrubbing. "At different speeds" is doing real work in that sentence:
a slow scrub finds easing and anchoring faults, a fast one finds pin flashes,
smoothing lag and dropped frames.

## The plan that wins it

Stage numbers are `references/pipeline.md`. Commands are the real ones in
`scripts/webdesign.mjs`; run `node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs"`
with no arguments to see the full surface.

**Stage 0-1. Subject and bench.** The subject is already a shipping label: a
mechanical dive watch, its case diameter, its material, its dial. Name the brand
and write it down before anything else, because the copy is the material the
layout is made of. Then:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" tools
```

If `frontend-design` is installed it owns the aesthetic direction and this plugin
supplies the chassis, the motion, the 3D and the verification. Blender is
irrelevant here - requirement 1 forbids imported models, so the modelled-3D route
in stage 3 is closed by the brief itself.

**Stage 2. Three references that disagree.**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" awards --pick object --n 3
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" study --awards "scroll-scrubbed 3D" --n 3
```

Open the PNGs. Write one line per reference naming the move you are taking and
the move you are deliberately not taking.

**Stage 3. Route.** Procedural 3D, and the brief has already decided it. A watch
is a ring, a dome, a disc, hands and a chain of links.

**Stage 5. Chassis.** There is no `materials` section id; `services` is the
hairline-separated row list and it carries materials and finishing correctly.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" new watch --preset ink --name "<brand>" \
  --sections nav,hero-split,blueprint,exploded-3d,spec,services,cta,footer
```

`exploded-3d` ships the watch already built as an `<ol>`. Three edits before you
touch anything else:

1. **Break the `data-y` tie.** In the shipped section `Case` and `Bracelet` are
   both at `data-y="0.0"`. The sort is by axis position, so the bracelet lands
   between the caseback and the case and pulls apart through the middle of the
   stack. Distinct values, bracelet at the far end: bracelet `-0.42`, caseback
   `-0.24`, rotor `-0.02`, case `0.00`, movement `0.06`, dial `0.19`, hands
   `0.23`, crystal `0.30`, bezel `0.36`.
2. **The rotor is the one part the builder cannot make.** A winding rotor is a
   segment, and `exploded.js` exposes no arc parameter - its torus is
   `new THREE.TorusGeometry(r, tube, 24, 128)`, four arguments, no arc, and there
   is no half-disc shape. Either add a `data-arc` pass-through to the `torus` and
   `disc` branches, or author the rotor's geometry in your own scene code. Do not
   substitute a full disc and call it a rotor.
3. **Add the indices and the lume.** `data-repeat="12" data-ring="0.66"` with
   `data-material="lume"` is the whole of "applied indices, lume", and the
   builder already makes the four cardinal copies 1.6x longer, which is how a
   dial is actually drawn. This is the forty characters of markup between a watch
   and six anonymous slabs.

**Stage 6. Copy, before the spacing and before the motion.** Nine callout lines,
a hero, the specification table, materials and finishing, the call to action.
Read it with the stylesheet off; if it would fit five hundred other watches
verbatim it is not copy yet.

**Stage 7. Choreograph.** `exploded.js` gives you the geometry, the twelve
material presets, the room-environment lighting rig, the contact-shadow plane,
the projected callouts with the behind-camera guard and the overlap suppression,
and the no-JS fallback. It does **not** give you the brief's sequence. Read its
`frame()` before you plan around it: the shipped choreography is
`spread = min(1, eased / 0.55)` then `turn = max(0, (eased - 0.4) / 0.6)`, every
part moves on the same `spread`, the callouts are one opacity ramp between
`spread` 0.25 and 0.55, and there is no wireframe stage, no isolation and no
reassembly. Its smoothing is `eased += (target - eased) * 0.11`, which is the
frame-rate-dependent form. So: keep the builder, the materials, the lighting and
`toScreen()`; replace `frame()` with the timeline below, and replace the lerp
with the decay form `v += (target - v) * (1 - Math.pow(1 - k, dt * 60))`.

One pin, one `ScrollTrigger` with `pin`, `anticipatePin: 1` and
`invalidateOnRefresh: true`, one rAF loop, one progress number `p`, and every
write an absolute function of `p`. The primitive is
`sub(p, a, b) = clamp((p - a) / (b - a), 0, 1)`.

### The scroll timeline

700vh of runway on desktop. `dist` is the framing distance `exploded.js` already
computes from the exploded extent and the 28 degree FOV; the camera moves as a
multiple of it and the FOV never changes, so the framing stays comparable across
the whole sequence. `orbit.rotation.y` starts at `-0.32` rad, which is the
runtime's own opening angle.

| scroll `p` | camera | part positions | callouts | what is being tested |
|---|---|---|---|---|
| `0.000-0.060` | `orbit.y` -0.32 rad, camera at `dist`, FOV 28 and fixed for the whole run | all nine at `home`, assembled; the group carries the anticipation `-0.04 * sin(sub(p,0.00,0.08) * PI)` | all at 0 | that the first frame is a finished object, and that the anticipation is exactly 0 at both ends of its own range so it inverts perfectly |
| `0.040-0.190` | unchanged | geometry static; `uCut` 0 to 1 on `inOutCubic`, wireframe `uFade` 1 to 0 across `0.040-0.150` | all at 0 | requirement 3, and whether the dissolve is a uniform that can be held half-open rather than a swap |
| `0.120-0.300` | `orbit.y` -0.32 to +0.46 rad on `inOutQuart`; camera `dist` to `dist * 0.96` | still assembled | all at 0 | camera mass - `inOutQuart` is 8% done at t=0.3, so the camera commits slowly; a camera that starts instantly is a camera with no operator |
| `0.280-0.409` | turn continues, `linear`, +0.46 to +0.78 rad across `0.300-0.620` | bezel `0.280-0.339`, crystal `0.315-0.374`, hands `0.350-0.409`, each on `outQuint` | bezel in at 0.320, crystal 0.355, hands 0.390 | overlap: each part gets 0.059 of travel while the neighbours' ranges overlap it by 40%, so there is never a still frame |
| `0.385-0.515` | as above | dial `0.385-0.444`, movement `0.421-0.479`, rotor `0.456-0.515` | dial in at 0.425, movement 0.461, rotor 0.496 | that the label follows its part by 0.04 rather than arriving with it - the part commits, then it is named |
| `0.491-0.620` | camera reaches `dist * 0.96` | caseback `0.491-0.550`, case `0.526-0.585`, bracelet `0.562-0.620` | caseback in at 0.531, case 0.566, bracelet 0.602 | the `data-y` fix - the bracelet must leave past the caseback, not through the middle of the stack |
| `0.600-0.660` | held at `dist * 0.96`, `orbit.y` +0.78 rad | fully exploded, all nine at `apart`, nothing moving | all nine at 1 | the hold. A stage that animates for its whole range never gives the reader a static frame to read nine labels against |
| `0.640-0.760` | `dist * 0.96` to `dist * 0.54` on `inOutQuart`, look-at target lerped to the movement's world centre, `orbit.y` +0.78 to +1.15 rad | movement and rotor hold at `apart`; the other seven fade to `opacity 0.12` on `outExpo` and recede 0.18 along the axis | seven fade out `0.640-0.740`; movement and rotor stay at 1 and their copy is the longest on the page | isolation, and whether "isolates individual parts" was built as a state or as a jump cut. Fading is a multiplier on the same `p`, so it reverses |
| `0.740-0.800` | `dist * 0.54` to `dist * 0.58`, target lerped to the bezel/crystal centre, `orbit.y` +1.15 to +0.20 rad on `inOutCubic` | movement and rotor fade back to 0.12; bezel and crystal return to 1 | movement/rotor out `0.740-0.790`, bezel/crystal in `0.760-0.820` | the second isolation beat, and the crossfade between two isolations - two overlapping `smoothstep` ranges, never a swap at the midpoint |
| `0.780-0.880` | back out to `dist * 0.96`, `orbit.y` to +0.78 rad on `inOutQuart` | all nine return to `opacity 1` on `outExpo`, still at `apart` | bezel/crystal out `0.820-0.870`; nothing enters | the release. This is the band a fast scrub breaks first, because it is the only place two opposing fades share a range |
| `0.860-0.975` | `dist * 0.96` to `dist`, `orbit.y` +0.78 to -0.10 rad on `inOutQuart` | reassembly, reverse part order with the same 40% overlap: bracelet first at `0.860-0.907`, bezel last at `0.928-0.975`, each on `outQuint` | all at 0 | requirement 2 in one band. Reassembly must be the same pure function of `p`, not a second timeline played forwards |
| `0.975-1.000` | settled at `dist`, `orbit.y` -0.10 rad | assembled, anticipation term is 0 | all at 0 | that the sequence ends on a still, complete, photographable frame that the specification section can sit under |

The per-part ranges are computed, not chosen. For `n = 9` parts at 40% overlap
inside the explode window `0.280-0.620`:

```js
const overlap = 0.4;
const span = 1 / (n - (n - 1) * overlap);            // 1 / 5.8 = 0.172414
const local = (i) => [i * span * (1 - overlap), i * span * (1 - overlap) + span];
// local(0) = [0.000, 0.172]  local(4) = [0.414, 0.586]  local(8) = [0.828, 1.000]
// mapped: 0.280 + local * 0.340
```

Sequential would give each part 0.038 of the window; the overlap gives each part
0.059, a 1.5x longer move, and the sequence still ends at exactly 0.620. Below
about 0.25 overlap it reads as a queue; above about 0.55 the parts move as one
blob and the separation stops being legible.

**The four overlaps that are deliberate, and are the difference between
choreography and a playlist:**

1. The camera starts turning at 0.120 while the dissolve still has 0.07 left to
   run. The object resolves *into* a move, not before one.
2. The turn continues linearly underneath the entire explode, 0.300 to 0.620. The
   parts separate while the camera is still going, so no band is only one thing.
3. Every part range overlaps its neighbours by 40%, and each callout enters 0.04
   after its part's range opens rather than at its end.
4. The two isolations crossfade across 0.760-0.790 with both ranges live, rather
   than one ending where the other begins.

**Easings, and what each one is for.** `inOutQuart` is 8% done at t=0.3 and is
for the camera and the master rotation. `outQuint` is 83% done at t=0.3 and is
for parts separating and callouts arriving - it arrives, then settles.
`inOutCubic` is for the dissolve uniform. `linear` is for the turn under the
explode, because the scroll position is already the easing there. `back.out`
overshoots 9.8% and peaks at t=0.6: it belongs on the callout dot and nowhere
near a part, because on a machined object an overshoot is a lie about mass.

**Callout life, one expression, no timers:**

```js
const life = sub(p, c.in, c.in + 0.06) * (1 - sub(p, c.out, c.out + 0.05));
const vis  = (screen ? 1 : 0) * (c.occluded ? 0 : 1);   // multipliers, never switches
c.shown += ((life * vis) - c.shown) * (1 - Math.pow(1 - 0.18, dt * 60));
```

Then `translate3d(x, y - 14 * (1 - c.shown), 0)` and `opacity = c.shown`. The
14px rise scaled by `(1 - shown)` gives the label the same arrive-and-settle
shape as the geometry for one line. Hide with `el.hidden` only below
`c.shown < 0.004`, so nothing is ever toggled while it is visible.

Guard the projection in view space before you project - a point behind the camera
returns NDC x and y that are both inside [-1,1] and mirrored into the opposite
quadrant, and nothing in three checks it. `exploded.js` already does this in
`toScreen()`. Clamp x and y to the stage rect, or a label past the right edge
gives the whole document a horizontal scrollbar. Call `updateMatrixWorld()` on
the group before the callouts read it or every label lags the geometry by a
frame, which reads as a rubber band.

**One place `exploded.js` costs more than it needs to:** the shipped loop calls
`_b.setFromObject(p.group)` once per part per frame to find the anchor. The Box3
is hoisted so there is no allocation, but it traverses the part's subtree every
frame, and the repeated indices part is twelve groups. Compute each part's local
anchor offset once at build time and transform it by the part's matrix instead.

**Stage 8. Verify, in this order.**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" dev watch --port 4321      # while building
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" look watch --widths 1440,390
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" quality watch --record 4000
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" debug watch --motion both
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" verify watch --widths 1440,390
```

`quality` serves a directory, so point it at the folder and not the file. Its
budgets are 55 fps, 200 ms for the longest main-thread task, 500 KB of script,
2500 KB total, 8 distinct type sizes. It renders twice at each width, normal and
`prefers-reduced-motion: reduce`, and a canvas still animating under reduced
motion is reported as an error, not a warning. It also names any library that was
fetched and never used.

Two findings are near-certain on the first run and both are in `three.md`: a long
task of roughly a second, which is the PMREM bake compiling shaders on
ANGLE/D3D11 (the second identical call costs about 30 ms - it is compilation, not
blur), and the reduced-motion error. Build the PMREM behind a real loading
affordance before the hero is interactive, and under reduced motion render one
complete frame and call `setAnimationLoop(null)`.

**Stage 9 and the single file.** `security <dir>` first. Then inline: `core.css`
into a `<style>`, the module code into one `<script type="module">`, the import
map before it, every CDN specifier pinned to an exact version with both map keys
on the same version and the same host. Generate the one piece of imagery you need
- the contact shadow - in a canvas, as `exploded.js` already does with a 128x128
radial gradient. Then run `verify` again against the inlined file's directory,
because inlining is a rewrite and the pass you got before it does not transfer.

**Mobile, as a `gsap.matchMedia()` branch and not an afterthought.** Four stages
become three - drop the second isolation and give the movement the whole of
0.640-0.860. Runway 700vh becomes 300vh. FOV 28 becomes 36 with the camera moved
in and the model shifted up so the lower third is free. DPR clamps to 1.5.
Transmission on the crystal goes off entirely and becomes an opaque physical
material with high clearcoat and a fresnel rim, because transmission is a second
full opaque pass. Below about 520px the projected labels become a caption strip
under the canvas driven by the same `p`, because a projected label on a 390px
stage is not readable however well it is anchored. The sequence and the caption
strip read the same progress function, so it is authored once.

## Where entries lose

Each of these is checkable before you ship. None of them is a matter of opinion.

**Linear easing on everything.** The tell is that the object appears to move at a
constant rate and arrives without deciding to. *Detect:* grep the scene write for
the curve applied to each sub-range; if `sub()` is used raw anywhere except the
master scrub and the turn-under-explode, that write is linear. Sample your own
curve at t=0.3 - a part should be over 80% there, a camera under 15%.

**Callouts that pop.** *Detect:* search the page for `setTimeout`,
`requestIdleCallback`, `transition:` on the label class, `IntersectionObserver`
bound to a label, and `style.display`. Any one of them is a second clock. Then
scrub backward slowly through the explode band: a label that fades out at a
different `p` than it faded in is running on something other than progress.

**A watch that reads as six anonymous slabs.** *Detect:* run
`look <dir> --widths 1440,390` and open the PNG at a scroll position inside the
hold. If you cannot tell the bezel from the caseback, you have shape without
finish. The fixes are cheap and specific: a real `data-bevel` on the bezel so the
chamfer catches a highlight, twelve lume indices with the four cardinal marks
long, hands at ten past ten, the bracelet running off the frame, and anisotropy
separating brushed from polished under the same light.

**Frame drops from allocating in the rAF loop.** *Detect:*
`quality <dir> --record 4000` and read the worst frame, not the median - headless
Chromium does not lock rAF to a display so the median is the ceiling the work
leaves room for, not a rate anyone sees. Then watch the counters:
`renderer.info.programs.length` must not grow after the loading state,
`renderer.info.memory.geometries` must not grow at all, and
`renderer.info.render.calls` should be under 8. A page that starts at 60 and
sawtooths down is the GC signature; a page that hitches at one specific scroll
position is a recompile.

**An unclamped devicePixelRatio.** *Detect:* grep for `setPixelRatio`. If it is
absent, or the argument is `devicePixelRatio` with no `Math.min`, you are shading
2,962,440 pixels on a phone. `exploded.js` ships a clamp of 2; 1.5 is the first
number to lower when a page is short of frame budget. Confirm with the resize
guard too: `setSize` must be behind an `if (c.width === w && c.height === h)
return` check, because calling it every frame measured 3.50 ms against 0.20 ms.

**A mobile layout that merely functions.** *Detect:* `look --widths 390` and put
the PNG next to the 1440 one. If it is the desktop composition scaled down - same
FOV, same framing, same stage count, same runway - it functions and nothing more.
The specific failures to look for: the watch as a postage stamp in the middle of
a tall stage, labels overlapping each other or the type, a pin that takes one
flick to cross, and `100vh` anywhere (the URL bar collapsing then triggers the
resize thrash above).

**Invented specifications in the technical table.** The brief licenses a
fictional brand, so the product is fiction by construction and nobody is deceived
by that. What is dishonest is a number that presents itself as measured or
certified when nothing was measured or certified: a real standard cited by name
as though the watch passed it, a certification you did not run, a figure copied
off a real maker's page, or a rating that contradicts the object you modelled - a
deep water-resistance claim on a case you drew with no gaskets and no screw-down
crown, or a long power reserve on a movement you drew with one barrel. It is the
fastest tell there is and it is the one failure on this list that is a
truthfulness problem rather than a craft problem. *Detect:* read the table row by
row against the model and against the copy; every number must be derivable from
the geometry you built or stated plainly as the design target it is. Then grep the
page for certification and standard names and for placeholder residue -
`example.com`, `555`, `[Your`, `picsum`, `via.placeholder` - which the audit fails
the build on. The same rule covers the call to action: a price is fine on a
fictional product, an invented review score or customer count is not.

## Use it as a rehearsal

This brief exercises pipeline stages 0 through 8 end to end: a named subject,
three references that disagree, the procedural-3D route, no asset stage, the
chassis, copy before spacing, one orchestrated moment, and a 60 fps floor that is
measured rather than asserted. Nothing about it is unusual except that it refuses
every shortcut at once, which is what makes it worth running.

Run it once against the pipeline before you run the pipeline against something
that matters. It passed when
`node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" verify <dir> --widths 1440,390`
exits 0 on the inlined single file, and when you have scrubbed the sequence down
and back up at three speeds yourself and nothing jumped, desynced or popped.
