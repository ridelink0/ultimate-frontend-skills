# The Fable 5.1 launch page, torn down

Read from the shipped bundles on `anthropic.com/claude-fable-and-mythos-5-1`,
not from looking at it. Every number here came out of the code.

## The hero is not a photograph

It is a **three.js r182 WebGL scene** (`"REVISION","182"` in
`_next/static/chunks/43wzyymewd7k8.js`, 609 KB), code-split behind a dynamic
import and only fetched once the hero component mounts. Roughly 90 KB of
hand-written GLSL and scene code sits alongside it. Raw three.js - no
`postprocessing`, no fiber, no drei.

**`references/fable-showcase.md` corrects four things in this file** - the
bokeh kernel, the post order, the tree seeds and the size of the GSAP waste -
and all four corrections are folded in below. It also carries the one idea this
teardown missed entirely (shelters), and the reproduction procedure. Read it
after this one.

What is in the scene:

- a **procedurally generated tree** - a custom branch and leaf mesh generator
  seeded by a mulberry32 PRNG. The silhouette is *not* different per build:
  two desktop seeds and four portrait seeds are baked into the module and the
  page passes no override, so each load picks one of a handful of curated
  silhouettes. The lesson is the opposite of the obvious one - generate
  broadly, then allowlist the seeds that came out good. Shipping
  `Math.random()` across the whole space is how you get a bad tree in front
  of somebody.
- a **GLTF bird** (`/fx/hero/tit.glb`, a great tit) with flap / perch / fold
  clips driven by an `AnimationMixer`
- a **cloud dome** and a **shader moon**
- a full hand-rolled post chain. The real order, read off the composite
  fragment shader:
  **chromatic aberration (at texture-read time) → sky/foliage composite with
  light wrap → glow → ACES → colour trim → vignette → film grain → gamma 2.2**

  ACES comes *after* the glow, and it is hand-written GLSL rather than
  three.js's own: `renderer.toneMapping = NoToneMapping`,
  `outputColorSpace = LinearSRGBColorSpace`, and the curve lives in the shader.

- the **depth of field is a 72-tap circular bokeh**, not hexagonal. Seven
  concentric rings emitted by a build-time loop as
  `(count, radius, angularOffset)`:
  `(1,0,0) (5,.16,.7) (8,.38,.3) (10,.55,.5) (12,.72,0) (20,.87,.4) (16,1,.15)`,
  summing to 72, with `gl_FragColor = accum / 72.0`. The part that matters is
  that the whole kernel is rotated **per pixel** by
  `hash12(vUv * 517.3) * 6.28318`. That rotation is the only reason 72 taps do
  not band into visible rings, and it is the single cheapest trick in the file.

That post chain is the answer to "why does it look like that". The bokeh and
the grain are doing the work a photograph would otherwise do.

## The three dots re-light the world

The palette switcher is three `<button>`s the effect script injects at runtime:

```
["day", "Noon", "#7ea9de"]  ["night", "Night", "#1a2237"]  ["morning", "Morning", "#dcc4b3"]
```

Clicking one does **not** crossfade two images. It sets a target weight vector
`{d, n, t}`, and the render loop eases toward it every frame:

```js
k = 1 - Math.exp(-dt * 2.2)          // frame-rate independent, no tween library
```

A **barycentric blend** across those three weights then rewrites every sky
colour, light colour, leaf colour and the sun-direction vector. The sun swings
round and becomes the moon. At weight > 0.5 the DOM classes flip so the CSS
`--fx-sky` fallback matches whichever mood won.

Worth stealing whole: one weight vector, eased exponentially, driving an entire
scene's colour and lighting. It is a fraction of the code of three separate
crossfading assets and it is physically coherent.

## The scroll is plain JavaScript

GSAP 3.14.2 + ScrollTrigger and lottie-web 5.13.0 **do** ship on the page - but
only because the site header's animated wordmark lazy-loads them. On this page
there is no app-level `gsap.to` or `ScrollTrigger.create` at all. Scroll
behaviour is `window.addEventListener('scroll')` + rAF + IntersectionObserver.

The waste is specific and worse than "~117 KB". The header's `LogoWordmark`
fires an unconditional `requestIdleCallback(..., { timeout: 2000 })` - or the
first scroll, whichever lands first - and awaits four chunks: the gsap wrapper
at 764 B, gsap 3.14.2 at 70,940 B, ScrollTrigger at 43,062 B and lottie-web
5.13.0 at 305,712 B, plus 27,698 B of animation JSON. After `registerPlugin`
the module calls `gsap` zero more times. **114,766 bytes of GSAP and
ScrollTrigger are fetched on every page of that site in order to call
`registerPlugin` and nothing else.**

A library whose only call site is its own registration is exactly the shape
`webdesign.mjs quality --record` looks for. Do not copy it. Real ScrollTrigger
scrub does exist on a sibling page, `/features/claude-on-mars`:

```js
gsap.registerPlugin(ScrollTrigger)
gsap.context(() => gsap.fromTo(el,
  { opacity: 0, y: 0 },
  { opacity: 1, y: -100, ease: 'power2.out',
    scrollTrigger: { trigger, start: 'top top', end: 'bottom bottom', scrub: 0.5 } }))
// mobile offsets 180/160, desktop 100/100
```

## Everything else on the page

| Thing | How |
|---|---|
| Animated wordmark | lottie-web 5.13.0, `renderer: 'svg'`, `loop: false`, `autoplay: false`, JSON in its own 27 KB chunk |
| The one flyout panel | framer-motion, `x: '100%' -> '0%'`, `duration: 0.4`, `ease: [0.215, 0.61, 0.355, 1]` |
| Benchmark charts | `d3-scale` only - `scaleLinear().domain().rangeRound()`, `.nice()`, `.ticks(5)`. Axes, gridlines, paths, box plots and legends are all hand-written SVG |

## What to take from it

1. **A generated 3D scene beats a stock photograph** when you cannot commission
   the photograph. `gradient.js` and `exploded.js` here are the same instinct.
2. **The post chain is the look.** Depth of field, grain and a vignette over a
   clean render is what stops it reading as a game engine.
3. **Ease a weight vector, do not crossfade assets.** `1 - exp(-dt * k)` is
   frame-rate independent and needs no library.
4. **Do not ship a library you do not call.** This page downloads 114,766
   bytes of GSAP and ScrollTrigger to call `registerPlugin` and nothing else -
   `quality --record` warns on exactly that shape.
5. **Hand-write the SVG for charts.** Use a scale library for the maths and
   draw the marks yourself; every charting library has a house style and it is
   never yours.
