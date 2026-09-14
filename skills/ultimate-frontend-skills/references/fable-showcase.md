# The September 2026 showcase

`fable.md` is the teardown of the launch page. This file is what to do about it:
what is actually provable, what is not, and the ordered procedure for getting
the same result out of any model on this bench.

Everything numbered here was read off a shipped bundle, a font binary, a glTF
chunk, or a runtime in `assets/`. Where something could not be verified it says
so in the same sentence as the claim.

## What shipped, and what the claim actually is

One page: `anthropic.com/claude-fable-and-mythos-5-1`, dated September 2026,
with a credit line in the hero. The credit is not provenance, not a watermark
and not a runtime signal. It is two CMS strings joined:

```js
let N = ["Made with", o, r].filter(Boolean).join(" ")   // o = "Fable", r = "5.1"
```

server-rendered into `<span class="...credit">Made with Fable 5.1</span>`.

**The announcement makes no front-end claim.** Measured on this bench: the page
is 450,512 bytes of HTML, over which `front-end`, `frontend`, `three.js`,
`Blender` and `WebGL` each return zero hits. Stripping tags leaves 37,455
characters of article text, in which "design" appears 20 times (a raw
case-sensitive grep over the HTML returns 47, the rest being markup and
navigation). Seventeen of the twenty are protein or molecular design, or
"designed to/for". The three that are not: one testimonial using it for
software architecture ("a novel and extensible design", MongoDB), a footnote
naming a binder `design_7`, and the "Claude Design" product link in the page
footer. None of the twenty refers to front-end or visual design as a model
capability. None of the 22 partner testimonials mentions UI, CSS, a web page or
3D - each of those four returns zero across the whole article text. The
platform docs carry no design capability either: the features overview
organises the API into
five areas (model capabilities, tools, tool infrastructure, context management,
files and assets), the docs intro lists two key capabilities (text and code
generation, vision), and the Fable 5.1 model page carries a specification table
rather than a capability list. No eval on the page measures front-end or
visual-design work.

So the page is not evidence that one model is better at front-end. The page is
the only front-end artefact shipped with the model, and it is worth reading for
that reason alone. What it demonstrates is a **process**, and the process is the
part that transfers.

| Claim | Status |
|---|---|
| three.js r182, raw, no postprocessing/fiber/drei | verified in the bundle |
| The hero is a real-time scene, not a photograph or a video | verified |
| The wordmark in the `<h1>` is a font ligature, not an image | verified: the `<h1>` holds the literal text `:Claude:`, and its span carries `font-feature-settings: "liga" on, "dlig" on` |
| 0.99 MB of procedural scene vs 10.26 MB of generated PNGs for the same brief | both measured |
| The page was authored against reference footage with measured colour targets | strongly evidenced by surviving source comments |
| Blender was in the loop for the bird | **UNVERIFIED** - see below |
| Any model is better at front-end than any other | **not claimed anywhere, by anyone** |

### The bird, and why "Blender" is not in this file as a fact

`tit.glb` is 212,028 bytes: glTF 2.0, `KHR_mesh_quantization`, one mesh in two
primitives at 4,253 + 870 vertices, a 7-joint skin named `TitRig`, three clips
(`Flap`, `Fold`, `Perch`), two materials, zero embedded images. That is the
entire animated character.

`asset.generator` reads **`glTF-Transform v4.4.2`**, which rewrites the file and
overwrites whatever exporter string was there. The joint names `wing.L` /
`wing.R` and the `GreatTit` + `TitRig` object-and-armature pairing match Blender
convention. A convention match is not proof, no Anthropic source mentions
Blender, and `grep -c Blender` over the page returns 0. Report it that way.

## Four corrections to `fable.md`

Read `fable.md` first; then fix these four before you act on it.

1. **The bokeh kernel is not hexagonal.** It is seven concentric circular rings
   emitted by a build-time JS loop - `(1,0,0) (5,.16,.7) (8,.38,.3) (10,.55,.5)
   (12,.72,0) (20,.87,.4) (16,1,.15)` as `(count, radius, angularOffset)`,
   summing to 72 taps, with `gl_FragColor = accum / 72.0`. The whole kernel is
   rotated **per pixel** by `hash12(vUv*517.3)*6.28318`, which is the only
   reason 72 taps do not band into visible rings.
2. **The post order in `fable.md` is wrong.** Real order, read off the composite
   fragment shader: chromatic aberration (applied at texture-read time) ->
   sky/foliage composite with light wrap -> glow -> ACES -> colour trim ->
   vignette -> film grain -> gamma 2.2. ACES is after the glow, and it is
   hand-written GLSL: `renderer.toneMapping = NoToneMapping`,
   `outputColorSpace = LinearSRGBColorSpace`, and the curve in the shader.
3. **The tree seed is not random across the space.** Two hand-picked desktop
   seeds and four portrait seeds are baked into the module as two literal
   arrays, and the page passes no seed override, so each load takes
   `Math.random()` *within* the curated list - one of two silhouettes on
   desktop, one of four in portrait. The lesson is *generate, then allowlist
   the seeds that came out good*, not `Math.random()` across the whole space.
4. **The GSAP waste is specific and worse than described.** The header's
   `LogoWordmark` fires an unconditional `requestIdleCallback(..., {timeout:
   2000})` (or first scroll) and `await Promise.all([...])` of four chunks:
   gsap wrapper 764 B, gsap 3.14.2 70,940 B, ScrollTrigger 43,062 B, lottie-web
   5.13.0 305,712 B, plus 27,698 B of animation JSON. After `registerPlugin` the
   module calls `gsap` zero more times. **114,766 bytes of GSAP and ScrollTrigger
   are fetched on every page of that site to call `registerPlugin` and nothing
   else.** That exact shape - a library whose only call site is its own
   registration - is what `webdesign.mjs quality --record` looks for.

## The one idea worth stealing whole: shelters

`fable.md` misses this entirely and it is the best thing on the page.

React measures three DOM elements - the `<h1>`, the contents `<nav>`, the date
`<p>` - pads each by a different amount (32/18, 40/22, 56/30 px), normalises to
0..1 of the hero box, and passes the three rectangles into the scene:

```js
createFableHero(el, { assets, seed, classes, shelters: i() })
// re-measured on ResizeObserver and again on document.fonts.ready
```

They land in the cloud dome's uniforms as `uShelterA/B/C` (`vec4`) plus
`uShelterReach: 0.2` and a `uShelterShift` (`vec2`), and become a rounded
lozenge SDF that **raises the cloud density threshold where the text is**. The
deck thins and parts behind the headline. No scrim, no gradient overlay, no
text-shadow hack.

Three things the shipped comments say were tried and failed, which is what makes
this a recipe rather than an anecdote:

- Fading the cloud colour instead of its threshold "washed the crowns grey".
  Raise the threshold; let whatever survives keep its full colour.
- A clearing fixed to the screen rather than to the sky read as "clouds morphing
  with the mouse" once the camera swayed. `uShelterShift` is recomputed every
  frame from the camera's own projection minus the unswayed projection, halved.
- "One short ramp that raised the threshold by a whole unit killed the deck
  within its first few percent: the edge was a uniform soft line tracing the
  boxes' lozenge - a hole cut in the sky." Long, uneven ramp, and let the noise
  field's own relief draw the edge.

`assets/sky.js` here reproduces the mood vector and the DPR cap. It does **not**
have shelters - `grep -ci shelter assets/sky.js` returns 0. If you add them,
measure the type after `document.fonts.ready`, judge the clearing in the scene's
frame, and keep a hard floor over the words that the density field cannot reach.

## The bake-off: what could not be verified

A video in which three frontier models each build this same dive-watch page,
shown on camera and credited by name, **could not be found from any source.**
Do not write it up, cite it, or describe its entries.

What was searched: the launch page itself (its only two media items are a
protein-binder `.webm` and a Venus volcano `.mp4`; a regex for `watch` over the
450 KB of HTML returns 22 hits, all of them the substring inside `swatch`);
`anthropic.com/sitemap.xml`, 531 URLs; `claude.com/sitemap.xml`, 3,167 URLs,
zero `watch` matches; and six targeted web searches.

**The brief is real and is in this repo.** `references/briefs/dive-watch.md` is
the exemplar brief, reproduced verbatim, and it is a genuinely good test whoever
wrote it. The entries, the ranking, and what separated them are not evidence
this file has, so they are not in it.

The closest public artefact is OpenAI's, and it is worth knowing precisely
because it is the other route to the same brief:
`developers.openai.com/showcase/watchmaker-landing-page`, credited on the page
only to "Katia Gil Guzman, OpenAI" (the "Codex + GPT-5.5 + GPT Image 2"
attribution is secondary reporting and UNVERIFIED). The live page is
`openai-landing-page-examples.vercel.app/haute-horlogerie`: 6,810 B of HTML,
11,070 B of CSS, 4,364 B of JS, **zero libraries** - grep returns 0 for `three`,
`THREE`, `WebGL`, `canvas`, `gsap`, `ScrollTrigger`, `framer` and `lenis`. The
3D is six stacked transparent PNGs driven by a hand-written `layerMotion` array
with `easeOutCubic`, `lerp`, an rAF `ticking` flag, and a
`prefers-reduced-motion` short-circuit that jumps the eased value to 1.

| Route | Payload | What it can do |
|---|---|---|
| Generated PNG stack (`haute-horlogerie`, 7 PNGs) | **10,760,854 B** | one camera, one light, forever |
| Procedural scene (Fable hero, everything) | **1,042,455 B** | re-lights, turns, responds to the pointer |

`hero-tilted.png` alone is 2,554,767 B. The procedural figure is the whole hero
and reconciles exactly: 609,129 (three.js r182) + 89,886 (the scene and its
GLSL) + 212,028 (`tit.glb`) + 131,412 (five webp textures - two bark, three
bird) = 1,042,455. Same brief; the procedural route costs one tenth and does
more. That is the argument for stage 3 of the pipeline, with numbers.

## The judging criteria, in checkable terms

The brief names three: taste, motion choreography, craft. On their own they are
unfalsifiable. Here is each one as something you can run or look at.

| Stated as | Checkable as |
|---|---|
| **Taste** | No font on the `tells.md` list. No indigo/violet CTA. Body text over 4.5:1. Type scale has at most five steps and uses all of them. Section padding varies with content weight rather than one `py-24`. Exactly one italic accent phrase in the page (`webdesign.mjs audit` fails at two). Copy contains no number you cannot source. |
| **Motion choreography** | Scrub down and back up at three speeds: nothing jumps, nothing desyncs, callouts anchor to the right part at every position. Every scrubbed transform is `linear`; every entrance decelerates. One orchestrated moment, not four. Stagger total under ~600 ms. `prefers-reduced-motion` renders one static, complete frame rather than nothing. |
| **Craft** | `webdesign.mjs quality <dir> --record 4000` reports no frame-rate finding under scroll (the tool's budget is 55 fps; the brief asks for 60). `verify` exits 0 at 1440 and 390. Zero libraries loaded and never called. No per-frame allocation in the rAF loop. The page works with JS off - the parts list is still a list. Labels never give the document a horizontal scrollbar. |

## Getting this with Opus or Sonnet

The reproducible part is the procedure, not the model ID. Run it in this order.
Steps 3, 4 and 6 are where pages are won.

### 0. Decide the route before you write any code

Stage 3 of `pipeline.md`. A dive watch is a ring, a dome, a disc, hands and a
chain of links - it is **procedural 3D**, not modelled 3D, and reaching for
Blender because "3D" sounds like Blender is the expensive mistake. Reach for a
model only when the geometry carries manufactured detail primitives cannot:
knurling on a bezel edge, guilloché on a dial, a movement bridge.

### 1. Libraries, pinned, and nothing else

Verified with `curl` on this bench today. Uncompressed transfer bytes.

| Specifier | URL | Bytes |
|---|---|---|
| `three@0.185.1` | `https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js` | 650,153 |
| `RoomEnvironment` | `https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/environments/RoomEnvironment.js` | 4,960 |
| `gsap@3.15.0` | `https://cdnjs.cloudflare.com/ajax/libs/gsap/3.15.0/gsap.min.js` | 72,927 |
| `ScrollTrigger` | `https://cdnjs.cloudflare.com/ajax/libs/gsap/3.15.0/ScrollTrigger.min.js` | 44,575 |
| `lenis@1.3.26` | `https://cdn.jsdelivr.net/npm/lenis@1.3.26/dist/lenis.min.js` | 18,722 |

`three.module.js` on jsDelivr imports `./three.core.js` relatively, so the
importmap in `stack.md` resolves both. Map `three` and `three/addons/` at the
**same** version or you get two copies and every `instanceof` fails.

GSAP is optional here and `exploded.js` does not need it. Add it when you want a
real pin, a snap, or several tweens sharing one timeline - not to move one
number.

### 2. Geometry: the parts are the markup

`assets/exploded.js` reads one `<li>` per part and builds it, so the semantic
list is also the no-JS fallback and nothing is duplicated. `sections.html`
already ships the nine-part watch as `@section exploded-3d`. Take it and edit
the numbers rather than writing a scene.

What the builder actually does, worth knowing before you fight it:

- `ring` and `dome` are **lathed profiles**, not boolean subtractions.
  `ring(r, r2, h, bevel)` walks outside-bottom, outside-top (chamfered if
  `data-bevel`), inside-top, inside-bottom through `LatheGeometry(pts, 128)`.
  That is why a bezel has a real chamfer highlight and a cylinder does not.
- `dome` solves the sphere the cap is cut from - `R = (r*r + h*h) / (2*h)` - so
  a crystal's curvature is correct for its own diameter instead of guessed.
- `data-repeat="12" data-ring="0.66"` places copies round a circle and makes the
  four cardinal copies 1.6x longer, which is how a dial is actually drawn.
- `hands` is posed at ten past ten, the position every dial is photographed at,
  because it frames the maker's name.
- `chain` runs links off the frame in both directions on purpose, the way a
  bracelet leaves a product shot.

A dial with twelve lume markers, a bevelled ceramic bezel and a brushed bracelet
reads as a watch. Six grey slabs read as a diagram. That difference is about
forty characters of markup.

### 3. Materials: metal reads as metal because of what it reflects

`exploded.js` ships twelve presets as `MeshPhysicalMaterial` configs. The four
that carry a watch:

```js
steel:   { color: 0xd9dce1, metalness: 1, roughness: 0.26 }
brushed: { color: 0xb8bcc3, metalness: 1, roughness: 0.5  }
lacquer: { color: 0x0b0c0e, metalness: 0, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08 }
glass:   { color: 0xffffff, metalness: 0, roughness: 0.03, transmission: 0.55, thickness: 0.3,
           ior: 1.5, transparent: true, opacity: 0.6, clearcoat: 1, clearcoatRoughness: 0.02,
           envMapIntensity: 1.6 }
```

Two upgrades available in 0.185.1, both verified present in the build:

- **`material.anisotropy` (0..1) plus `anisotropyRotation`.** This is the actual
  difference between brushed and polished: a brushed surface stretches its
  highlight along the grain. Setting `roughness: 0.5` alone gives you dull
  steel, not brushed steel. Set anisotropy on the case flanks and bracelet,
  leave it at 0 on the polished chamfers, and the two finishes separate under
  the same light - which is requirement 1 of the brief, checked visually.
- **`dispersion`** on the crystal, at a very small value. Free chromatic
  fringing at the crystal's edge, no post chain.

Colour the way the reference page did it: **solve backwards through the tone
curve.** Pick the value you want on screen off a real reference frame, then work
out what the shader or material has to output for ACES to land there, and write
the target in the comment. The shipped GLSL carries lines like "peach crowns ~
(232,190,170)" and "the day sky lands exactly on #648BBA". That is why it does
not look like a demo. Guessing hex values in linear space and hoping is why most
scenes do.

### 4. The lighting rig

```js
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping      = THREE.NeutralToneMapping;   // preserves brand colour
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
scene.environment = new THREE.PMREMGenerator(renderer)
  .fromScene(new RoomEnvironment(), 0.04).texture;      // studio IBL, 4,960 bytes
```

`exploded.js` adds three lights on top of the environment, and the values are
worth copying because they are the ones that make a polished ring read:

```js
key = DirectionalLight(0xfff1dc, 2.2) at (-3,  4,  2.5)   // warm, high, camera-left
rim = DirectionalLight(0xbfd0ff, 1.1) at ( 3,  2, -3  )   // cool, behind, separates the silhouette
      AmbientLight(0x5b6a86, 0.35)                        // fills the undercuts
```

The environment is doing most of the work. A polished bezel has a highlight
because there is a bright rectangle of room geometry for it to reflect; with
`scene.environment = null` and the same three lights it goes flat and plastic.
If you want a specific highlight shape, put a plane in the scene that the metal
can see - do not chase it with another light.

`ACESFilmicToneMapping` (what `exploded.js` sets) crushes saturated brand colour
toward white; `NeutralToneMapping` does not. Pick deliberately. Do not ship
both on one page.

Shadows: no shadow map. `exploded.js` draws a radial-gradient canvas texture on
a plane under the assembly and fades it as the parts separate
(`opacity = 1 - spread * 0.45`). A shadow map on a marketing scene costs a full
extra render pass to produce something a 128x128 canvas already sells.

### 5. Scroll-scrub architecture

Non-negotiable shape: **one rAF loop reads one normalised progress number and
writes the scene.** Anything else desyncs when the visitor scrubs backward,
which is the failure almost everybody ships. `exploded.js` is that loop, in
about forty lines:

```js
const track = root.closest('[data-explode-track]') || root.parentElement;
let target = 0, eased = 0, running = false, last = 0;
const EASE_K = num(root.dataset.ease, 7);  // per second, not per frame
const read = () => {                       // listener: measure only, never write
  const r = track.getBoundingClientRect();
  const total = r.height - innerHeight;
  target = total <= 0
    ? Math.min(1, Math.max(0, 1 - (r.top + r.height) / (innerHeight + r.height)))
    : Math.min(1, Math.max(0, -r.top / total));
  if (!running) { running = true; last = 0; requestAnimationFrame(frame); }
};
addEventListener('scroll', read, { passive: true });

function frame(now) {                      // loop: write only, one place
  const t = typeof now === 'number' ? now : (last || 0);
  const dt = last ? Math.min(0.1, (t - last) / 1000) : 1 / 60;
  last = t;
  eased += (target - eased) * (1 - Math.exp(-dt * EASE_K));
  ...
  if (Math.abs(target - eased) > 0.0004) requestAnimationFrame(frame);
  else running = false;                    // settle, then stop burning frames
}
renderer.compileAsync(scene, camera).then(read).catch(read);
```

Five things in there that are not obvious:

1. The listener measures and the loop writes. Never alternate
   `getBoundingClientRect()` and a style write in one pass.
2. The loop **stops** when it has settled, and the scroll listener restarts it.
   A rAF loop that runs forever on a static page is the most common reason a
   3D page drains a laptop battery.
3. `compileAsync` before the first read, so the first visible frame is not a
   shader compile stall exactly when the visitor starts scrolling.
4. `root.classList.add('is-live')` - which hides the fallback list - happens
   only *after* a frame has actually rendered. Claim it up front and a shader
   failure leaves an empty box where the content was.
5. The easing constant is per **second**, not per frame. `dt` is clamped to
   0.1 s so a tab-switch stall cannot teleport the scene on the next frame.

If you use GSAP instead, `scrub: 1` is the premium feel (`motion.md` has the
same number), 0.5 is tight, `true` is 1:1 and reads mechanical, 2 and above
reads like lag. Add `invalidateOnRefresh: true` whenever start/end depend on
live DOM, and `anticipatePin: 1` to kill the flash on a fast scroll into a pin.

### 6. Timing curves

| Job | Curve | Why |
|---|---|---|
| Scroll-scrubbed anything | `linear` | the scroll position is the easing; anything else double-eases and feels rubbery |
| Following a target across frames | `x += (t - x) * k`, or `THREE.MathUtils.damp(x, t, lambda, dt)` | `damp` is literally `lerp(x, y, 1 - Math.exp(-lambda*dt))` - the same expression the reference hero uses at lambda 2.2, and frame-rate independent, which the raw lerp is not |
| Entrances | `cubic-bezier(0.16, 1, 0.3, 1)` | decelerate; never `ease-in-out` on an entrance |
| A snap-back | `cubic-bezier(0.34, 1.56, 0.64, 1)` | overshoot belongs here and nowhere else |
| Two states crossfading in a scene | `THREE.MathUtils.smoothstep(t, a, b)` per state, with the ranges overlapping | a hard swap at 0.5 pops; overlapping smoothsteps dissolve |

`exploded.js` eases per second rather than per frame: `1 - Math.exp(-dt *
EASE_K)` with `EASE_K` of 7, which reproduces the familiar `* 0.11` per-frame
feel at 60 Hz exactly (`1 - exp(-7/60) = 0.1109`) without arriving nearly three
times faster on a 144 Hz laptop than on a 50 Hz external display. Its `dt` is
clamped to 0.1 s so a tab-switch stall cannot teleport the scene. Write the
per-frame form instead and the choreography becomes a different piece of work
depending on the monitor.

The reference hero snaps when it is within 0.001 of target rather than chasing
forever. Do the same, or your loop never sleeps.

### 7. The frame budget, which is set deliberately and is not 60 fps

The reference hero gates its own render loop:

```js
if (!ag || e - on < ("cross" === ts || "out" === ts || "in" === ts ? 4 : 30)) return
```

A minimum 30 ms between rendered frames - about 33 fps - dropping to 4 ms only
while the bird is entering, crossing or leaving. A slow, heavy, film-grained
scene does not need 60 fps, and refusing to render at 60 is how a 1.02 MB hero
with 72-tap depth of field stays affordable on a laptop.

That is a choice for an ambient hero. **It is the wrong choice for a
scroll-scrubbed product page**, where the brief's 60 fps floor is measured while
the visitor is dragging the sequence and any dropped frame reads as a stutter in
the choreography. Budget the other way instead:

- DPR capped at 1.5, not 2 (`sky.js` and the reference both do this;
  `exploded.js` caps at 2, which is the one number to lower first if a page is
  short of frame budget).
- An absolute internal-height cap so a 4K monitor does not quadruple the cost.
  The reference clamps to 1150 px.
- Every blur radius expressed as a fraction of frame height, so the look is
  identical at any resolution.
- Four idle gates in one place: `IntersectionObserver`, `visibilitychange`,
  `blur`/`focus`, and an accumulated scroll-distance counter that parks the
  scene once the reader is past it and wakes it near the top again.

### 8. Failure modes, in the order they bite

1. **Per-frame allocation.** `new THREE.Vector3()` inside the loop. `exploded.js`
   hoists `_v`, `_c`, `_w`, `_b` once and reuses them. This is the single most
   common cause of a page that starts at 60 and sawtooths down.
2. **`Vector3.project()` behind the camera returns mirrored garbage.** Reject in
   view space first: `if (_c.z > -camera.near) return null`. Symptom is a label
   that flies to the opposite side mid-turn.
3. **A projected label off the stage edge gives the whole document a horizontal
   scrollbar.** Clamp x and y to the stage rect before writing the transform.
4. **Two parts project to the same point mid-turn** and the labels stack
   illegibly. `exploded.js` keeps a `placed` array and hides the later one.
5. **Transparent materials need `depthWrite = false`**, or the crystal punches a
   hole in whatever is behind it. Set `side = DoubleSide` on anything with
   transmission.
6. **A wireframe built from the display geometry is enormous.** A
   `LatheGeometry(pts, 128)` has 128 radial segments; `WireframeGeometry` on it
   emits every one. Use `EdgesGeometry(geometry, thresholdAngle)` - a real
   constructor in 0.185.1, threshold in degrees between adjoining face normals -
   so you get the silhouette and the chamfer break, not a tin of noodles.
7. **Ties in `data-y` decide the explode order silently.** Parts are sorted by
   axis position, so two parts sharing a value are ordered arbitrarily and one
   can pull apart *through* the middle of the stack. The shipped `exploded-3d`
   section avoids this - its nine parts carry nine distinct values, `0.36` down
   to `-0.30` - and that is the property to preserve when you edit the numbers.
   Give every part its own axis position.
8. **Claiming `is-live` before a frame renders.** Covered above, and it is the
   failure that passes every static check while showing the visitor nothing.

## Frontier craft vs generated output

Neither column is about the model. Both are about whether someone iterated
against a render with a number in mind.

| Reads as frontier craft | Reads as generated |
|---|---|
| Colour solved backwards through the tone curve to a stated target (`#648BBA`) | Hex values guessed in linear space and left where they landed |
| Generated procedurally, then the good seeds allowlisted | `Math.random()` over the whole seed space, different every load |
| Motion budget chosen and enforced - 30 ms normally, 4 ms for the one beat | Everything runs at 60 fps and the scene is trimmed until it fits |
| One orchestrated moment the page is remembered by | Four effects, each applied to a different section |
| The artwork moves out of the way of the type (shelters) | A scrim, a gradient overlay, or a `text-shadow` over the type |
| Labels anchored to real projected world points, tracking through the turn | Labels at fixed CSS percentages that drift off their parts |
| The brand mark as a `dlig` in the font - selectable text, no request, scales and recolours with the type | An `<img>` inside the `<h1>` |
| A 5-second CSS failsafe that un-hides the text if `document.fonts.ready` never fires | Content hidden by default, visible only if the JS runs |
| A capability gate that removes the canvas and hands over to a CSS gradient painted the same colour | A blank box, or a spinner that never resolves |
| The blur radius as a fraction of frame height | Pixel constants that look right on one monitor |
| Two finishes on the same metal, separated by anisotropy under one light | One `metalness: 1, roughness: 0.3` on every part |
| A dot leader made of 160 literal full stops in an `aria-hidden` span | A JS width measurement that re-runs on resize |
| Payload measured and stated | "Optimised for performance" |

The last row is the whole file. Every number above came out of a file on disk or
a transfer this bench actually made. Anything you cannot produce that way is
either omitted or labelled, and a reference that fabricates one specifier is
worse than no reference.

## Where to go next

| You need | Read |
|---|---|
| The teardown itself, with the four corrections above applied | `references/fable.md` |
| Which library for which job, with verified specifiers | `references/stack.md` |
| Part syntax, callout projection, the motion scale, canvas sequences | `references/motion.md` |
| What gives a generated page away, mechanically | `references/tells.md` |
| The whole route from a sentence to a shipped page | `references/pipeline.md` |
| A brief that exercises all of it end to end | `references/briefs/dive-watch.md` |
