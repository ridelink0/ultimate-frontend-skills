# The Fable 5.1 launch page, torn down

Read from the shipped bundles on `anthropic.com/claude-fable-and-mythos-5-1`,
not from looking at it. Every number here came out of the code.

## The hero is not a photograph

It is a **three.js r182 WebGL scene** (`"REVISION","182"` in
`_next/static/chunks/43wzyymewd7k8.js`, 609 KB), code-split behind a dynamic
import and only fetched once the hero component mounts. Roughly 90 KB of
hand-written GLSL and scene code sits alongside it. Raw three.js - no
`postprocessing`, no fiber, no drei.

What is in the scene:

- a **procedurally generated tree** - a custom branch and leaf mesh generator
  seeded by a mulberry32 PRNG, so the silhouette is different per build
- a **GLTF bird** (`/fx/hero/tit.glb`, a great tit) with flap / perch / fold
  clips driven by an `AnimationMixer`
- a **cloud dome** and a **shader moon**
- a full hand-rolled post chain, in this order:
  **72-tap hexagonal-bokeh depth of field → ACES → chromatic aberration →
  glow → vignette → film grain → gamma 2.2**

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

So ~117 KB of GSAP is downloaded and never used here. Do not copy that. Real
ScrollTrigger scrub does exist on a sibling page, `/features/claude-on-mars`:

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
4. **Do not ship a library you do not call.** This page downloads 117 KB of
   GSAP to use none of it - the audit here warns on exactly that.
5. **Hand-write the SVG for charts.** Use a scale library for the maths and
   draw the marks yourself; every charting library has a house style and it is
   never yours.
