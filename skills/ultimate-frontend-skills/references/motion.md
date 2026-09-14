# Motion

`core.css` and `motion.js` already ship reveals, parallax, counters, magnetic
buttons, per-word headline reveal, nav shrink and scroll progress. Read this when
you need something they do not cover.

## Seven things that silently break scroll motion

1. **The `animation` shorthand resets `animation-timeline` to `auto`.** Declare
   `animation-timeline` *after* the shorthand, always.
2. **Scrubbed animations must use `linear`.** The scroll position is the easing;
   anything else double-eases and feels rubbery.
3. **Always set a fill mode** (`both`). Without it the element renders in its
   author styles until the range starts, so a fade-in flashes visible first.
4. **`animation-delay` does nothing on a scroll timeline.** Stagger by moving
   `animation-range` with a per-item custom property.
5. **Never hide content unconditionally.** Default state = visible; motion goes
   inside `@supports` and `@media (prefers-reduced-motion: no-preference)`.
6. **`Vector3.project()` returns mirrored garbage behind the camera.** Reject in
   view space first.
7. **cdnjs does not host three.js addons.** Use jsDelivr, and `three@r185` is not
   a valid npm specifier - it is `three@0.185.1`.

## Choosing the tool

| Need | Use | Cost |
|---|---|---|
| Reveals, fades, parallax, progress, nav state | CSS `animation-timeline` behind `@supports`, or IntersectionObserver | 0 KB |
| Scrubbed timelines, pinning, horizontal scroll, snap, choreography | GSAP + ScrollTrigger | ~47 KB gz |
| Page-wide inertia as a deliberate brand decision | Lenis | +5.3 KB gz |

Most editorial pages need nothing beyond what ships in `motion.js`. Reach past it
only when the subject genuinely asks.

## Scroll-driven CSS

Support (late 2026): Chrome/Edge 115+, Safari 26+, Samsung 23+; Firefox still
behind a flag. ~87% global. Always `@supports`-gate.

```css
animation-timeline: scroll( [root|nearest|self] [block|inline|x|y] )  /* container progress */
animation-timeline: view(   [axis] [inset] )                          /* this element crossing */
```

Ranges for `animation-range`: `cover` (first pixel in to last pixel out, the
default), `contain` (fully inside; **inverts when the element is taller than the
viewport**, which is what makes pinning work), `entry`, `exit`,
`entry-crossing`, `exit-crossing`. Mix freely: `entry 25% cover 50%`.

Named timelines are visible to the declaring element and its descendants only.
To reach a sibling, hoist with `timeline-scope` on a common ancestor.

Numbers that read as premium: travel 20-32px, finish by `cover 30-40%` (finishing
at 100% is still animating while the reader is already reading).

### Horizontal scroll section

```css
#pin { height: 500vh; view-timeline-name: --pin; view-timeline-axis: block; }
.pin-sticky { position: sticky; top: 0; height: 100svh; overflow-x: hidden; }
.pin-strip {
  width: 250vmax; height: 100svh; will-change: transform;
  animation: pan linear forwards;
  animation-timeline: --pin;
  animation-range: contain 0% contain 100%;
}
@keyframes pan { to { transform: translateX(calc(-100% + 100vw)); } }
```

Runway: `height ~= (strip_width / viewport_width) * 100vh + 100vh`.

### Sticky pin with crossfade

Parent height = `(stages + 1) x 100svh`. Stack the panels in one grid cell and
give each its own slice of `contain`. Keep a dwell in the keyframes
(`0%,10%` / `25%,75%` / `90%,100%`) so there is a static moment to read. Never
more than four stages.

### Scroll progress

```css
.progress { transform-origin: 0 50%; animation: grow linear; animation-timeline: scroll(); }
```

### Text-mask reveal

```css
@property --stop { syntax: '<percentage>'; initial-value: 0%; inherits: false; }
h2.wipe {
  background: linear-gradient(90deg, var(--fg) 0 var(--stop),
              color-mix(in oklab, var(--fg) 18%, transparent) var(--stop));
  background-clip: text; color: transparent;
  animation: wipe linear both; animation-timeline: view(); animation-range: entry 20% cover 45%;
}
@keyframes wipe { to { --stop: 100%; } }
```

`@property` is what makes a percentage or a `clip-path` interpolable per value.

## Layered parallax - the effect the reference sites are built on

Five planes, each at a different rate. The giant headline sits *behind* the
subject and the subject's silhouette breaks the letterforms. That overlap is the
whole trick.

| z | layer | rate |
|---|---|---|
| 4 | nav, scroll cue | static |
| 3 | foreground props, grain | 1.20 (moves against scroll) |
| 2 | cut-out subject | 1.00 |
| 1 | the wordmark | 0.80 (moves with scroll) |
| 0 | sky / photo | 0.55 |

`core.css` gives you `.layers` (one grid cell, all children stacked) and
`.layer--bg/mid/fg`. `motion.js` reads `data-px="-70"` as pixels of travel per
viewport of scroll: negative moves with the scroll, positive against.

Rules: `isolation: isolate` on the section so the stack does not leak; overscan
any translating layer by at least its travel (`inset: -15% 0`); put a
`drop-shadow(0 30px 60px rgb(0 0 0 / .45))` on the subject so it separates.

**The geometry matters more than the rates.** Every plane except the sky is a
*band*: an explicit `height` plus `align-self: end`, and a `margin-bottom` that
lifts it clear of the plane in front. Skip that and the foreground - drawn at
100% height by default - covers the whole hero, every other layer is invisible,
and the page still passes every static check. Sizes that work for a five-plane
hero: haze `height: 30%; margin-bottom: 25%`, mid silhouette
`height: 24%; margin-bottom: 17%`, near plane `height: 22%`.

Two more: put the bright band of the sky gradient *above* where the silhouettes
start, or it is hidden behind the thing it is meant to backlight. And at equal
`z-index` DOM order decides occlusion, so the wordmark is written *before* the
near silhouette - being cropped by the subject is the effect.

Verify it by rendering, never by reading the CSS:
`node scripts/webdesign.mjs look <dir>` and read the PNGs.

**The foreground layer does not need an image.** A hand-written SVG silhouette -
a roofline, an arch, a treeline, a skyline - is sharper, weighs nothing, and
takes `currentColor`. Use it by default; reach for a cut-out PNG only for a
photographic subject.

Cut-outs, when you do need one: AVIF with alpha (20-40% smaller than WebP),
inside a `<picture>` with a WebP source and a PNG `<img>` fallback. Budget 120 KB
at 1400px. Matte quality beats resolution.

**Never `background-attachment: fixed`.** Ignored on iOS, and it repaints every
frame on desktop.

### True 3D parallax, if you want it

`perspective` + `translateZ` runs entirely on the compositor.

> **scale = (perspective - distance) / perspective**

| perspective | translateZ | scale | apparent speed |
|---|---|---|---|
| 1px | -1px | 2 | 0.50 |
| 1px | -2px | 3 | 0.33 |
| 1px | +0.5px | 0.5 | 2.00 |

`transform-origin: 0 0` is mandatory or layers drift sideways as they scale. The
scroll container must be a real element with `overflow-y: scroll`. On iOS,
`-webkit-overflow-scrolling: touch` flattens the 3D context. Prefer the
transform/`data-px` version unless you specifically need this.

### Pointer parallax

`data-tilt="12"` in `motion.js`. Depths that look right: background 0.25,
headline 0.5, subject 0.8, foreground 1.2, and **negate the sign between the
subject and the type** so they counter-move. That sells depth far more than
magnitude. Gate on `(hover: hover) and (pointer: fine)`.

## Depth without a 3D engine

The exploded view is the same mechanism as the layered hero: stack the components
in `.exploded`, give each `.part` a different `data-px`, and they separate as the
page scrolls. Annotate with `.callout` (dot, hairline leader, label).

If the parts are an SVG, position callouts with percentages against a container
whose `aspect-ratio` **equals the viewBox ratio**, plus
`preserveAspectRatio="xMidYMid meet"`. Then `left: (x / viewBoxW) * 100%` tracks
the artwork at every size with no JS, forever. Draw leader lines inside the SVG
so they stay hairline-crisp; keep only the dot and the type in HTML.

For a CSS/JS explode of SVG parts, `transform-box: fill-box` is mandatory before
`transform-origin: center` - the default `view-box` resolves against the whole
canvas.

## When you genuinely need three.js

Only when the visitor must turn a real object. jsDelivr, matched versions in the
importmap, or you get two copies of three and `instanceof` failures:

```html
<script type="importmap">
{"imports":{
  "three": "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/"
}}</script>
```

Set `renderer.toneMapping = THREE.NeutralToneMapping` (preserves brand colour),
`setPixelRatio(Math.min(devicePixelRatio, 2))`, and light with
`PMREMGenerator.fromScene(new RoomEnvironment(), 0.04)` - a studio IBL at zero
network cost. Normalise the model (centre it, scale the longest axis to ~1.6) so
the scroll maths is model-independent.

Exploded offsets: radial from the centroid at **0.3-0.8 x boundingSphere.radius**,
or axial at 0.15-0.30 x the assembly extent per gap. Past 1.0x radius it stops
reading as one object. Convert the direction into the part's **parent** space.

Annotation callouts, the projection:

```js
function toScreen(worldPos, camera, canvas) {
  _c.copy(worldPos).applyMatrix4(camera.matrixWorldInverse);
  if (_c.z > -camera.near) return null;      // behind the camera: reject FIRST
  _v.copy(worldPos).project(camera);          // NDC, y is up-positive
  const r = canvas.getBoundingClientRect();   // CSS px, not canvas.width
  return { x: (_v.x * 0.5 + 0.5) * r.width,
           y: (-_v.y * 0.5 + 0.5) * r.height, z: _v.z };
}
```

Call `root.updateMatrixWorld()` before reading `matrixWorld` or labels lag a
frame. Write `transform: translate3d(...)`, never `left`/`top`.

`<model-viewer>` 4.3.1 from jsDelivr is the cheap option: hotspots via
`slot="hotspot-*"` + `data-position`/`data-normal`, and
`queryHotspot(name).canvasPosition` lets you draw your own leader lines. It has
no exploded view and costs ~1 MB gz.

### Parts and materials in exploded.js

The engine reads one `<li>` per part. Bottom of the list is the bottom of the
stack; `data-y` places a part on the axis in scene units (the default slab is
2.5 wide), and without it parts stack on the one below.

| attribute | meaning |
|---|---|
| `data-shape` | `slab` (default), `box`, `disc`/`cylinder`, `ring`, `dome`, `torus`, `sphere`, `cone`, `hands`, `chain` |
| `data-r`, `data-r2`, `data-h` | radius, inner radius (ring), extent along the axis |
| `data-w`, `data-d` | width and depth for box, slab and chain links |
| `data-bevel` | chamfer on a ring's top edge |
| `data-tube` | tube radius of a torus |
| `data-count`, `data-gap`, `data-start` | chain: links per side, gap between, distance from the axis |
| `data-repeat`, `data-ring` | copies round a circle at that radius (markers, screws); the four cardinal copies are longer |
| `data-material` | `steel`, `brushed`, `gold`, `titanium`, `lacquer`, `ceramic`, `glass`, `matte`, `rubber`, `lume`, `wood`, `paper` |
| `data-color`, `data-rough`, `data-metal` | overrides on top of the preset |
| `data-rot`, `data-tilt`, `data-off` | rotate about the axis, tilt, offset `x,y,z` |

On the root: `data-axis="x"` takes the thing apart sideways, `data-spread`
is the gap per part when fully apart, `data-turn` the slow rotation in
radians, `data-fit` gives more air round the framing, `data-model="x.glb"`
loads a model and each `<li data-part="Bezel">` names a mesh in it.

A real model beats primitives whenever one exists. Primitives beat nothing:
a dial with twelve lume markers, a bevelled ceramic bezel and a brushed
bracelet reads as a watch; six grey slabs read as a diagram.

## Canvas image sequences

60-90 frames, not 148. 1600px wide, 40-80 KB/frame, WebP q70-80. **25-50px of
scroll per frame.** Decoded bitmap bytes = `w x h x 4`: 90 frames at 1600x900 is
518 MB, and iOS Safari silently draws transparent canvases past ~384 MB. Never
hold the whole sequence as `ImageBitmap`. Preload every 8th frame at
`fetchPriority: 'high'`, start when those land, backfill at `'low'`, and draw the
nearest loaded frame rather than a blank one. Ship a smaller folder for phones
and a single still under `prefers-reduced-motion` or `saveData`.

`<video>` scrubbing is still not viable as the primary technique.

## Libraries, if you add them

**GSAP 3.15.0 is completely free**, every former Club plugin included, since
April 2025. `https://cdnjs.cloudflare.com/ajax/libs/gsap/3.15.0/gsap.min.js`
then `ScrollTrigger.min.js` (PascalCase filenames), then
`gsap.registerPlugin(ScrollTrigger)`. `scrub: 1` is the premium feel; 0.5 tight,
2+ soupy. `invalidateOnRefresh: true` whenever start/end depend on live DOM.
`anticipatePin: 1` kills the flash on a fast scroll into a pin.
`ScrollTrigger.matchMedia()` is deprecated - use `gsap.matchMedia()`, which
auto-reverts when a query stops matching, including when the user flips the OS
reduced-motion switch.

**Lenis 1.3.26**, jsDelivr only (not on cdnjs), `lenis.min.js` is the browser
build. Tune with `lerp` (0.06 filmic, 0.10 default, 0.16 tight) - the README's
`duration: 1.2` switches engines and is wrong for 1.3.x. Pin >= 1.3.26 or you get
no reduced-motion support. Lenis writes the real `scrollTop`, so CSS scroll
timelines, `position: sticky`, find-in-page and keyboard scrolling all keep
working. **ScrollSmoother does not** - it transforms the content and desyncs
every scroll timeline. If the page uses CSS scroll-driven animation, use Lenis.

Lenis does not move focus on anchor links. That is the real accessibility
failure; set `tabindex="-1"` and `focus({ preventScroll: true })` on arrival.

## The motion scale

| Tier | ms | Use |
|---|---|---|
| Micro | 120-200 | hover, press, focus |
| Element | 300-450 | tooltip, dropdown, toast |
| Entrance | 500-700 | card, image, heading reveal |
| Section | 700-900 | hero, staged sequence |
| Page | 900-1200 | curtain, route transition |

Easings: `cubic-bezier(0.16, 1, 0.3, 1)` expo-out is the default for entrances
(`--ease` in `core.css` is the near-identical quint-out `0.22, 1, 0.36, 1`).
`cubic-bezier(0.34, 1.56, 0.64, 1)` for a magnetic snap-back. `linear` for
anything scrubbed. Entrances decelerate, exits accelerate; never `ease-in-out` on
an entrance.

Stagger: characters 12-25ms, words 30-50, lines 60-90, cards 80-120. Keep the
total span under ~600ms. Past 12 items, switch to a group fade.

## Performance

Only `transform` and `opacity` skip layout and paint. Read all, then write all -
never alternate `getBoundingClientRect()` and a style write inside a loop. Every
scroll and pointer listener is `{ passive: true }` and rAF-batched;
`motion.js` runs one rAF loop for every scroll effect.

`will-change: transform` belongs on long-lived scrubbed layers (parallax, a
horizontal strip) and nowhere else; budget under ~20 promoted layers.
`content-visibility: auto` + `contain-intrinsic-size: auto 800px` on
below-the-fold sections, never on the hero.

Images: `width`/`height` always, `fetchpriority="high"` + `decoding="sync"` +
no lazy on the LCP hero, `loading="lazy"` + `decoding="async"` below it. Use
`100svh`, not `100vh`, so the mobile address bar does not resize the hero
mid-scroll.

## Reduced motion

Reduce, do not remove. Kill parallax, scrubbed transforms, large entrances,
autoplay loops, pins that hijack scroll length, and smooth-scroll inertia. Keep
opacity fades, short colour transitions, focus rings, and the scroll progress bar
(it is a position indicator, not motion).

Write the static state as the default and add motion inside
`@media (prefers-reduced-motion: no-preference)`. The `!important` reset block in
`core.css` is a safety net, not the mechanism - and it uses `1ms`, not `0`,
because a zero duration suppresses `transitionend`.
