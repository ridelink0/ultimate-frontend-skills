# The Fable 5.1 launch page, torn down

Read from the shipped bundles on `anthropic.com/claude-fable-and-mythos-5-1`,
not from looking at it. Every number here came out of the code.

## The hero is not a photograph

It is a **three.js r182 WebGL scene**: `_next/static/chunks/43wzyymewd7k8.js` is
609,129 bytes and carries `"REVISION",0,"182"` in its export table. It is
code-split behind a dynamic import and only fetched once the hero component
mounts, as a pair with `14c8frmb4u5hu.js` - 89,886 bytes of hand-written GLSL
and scene code, which is where every shader quoted below lives. Raw three.js -
no `postprocessing`, no fiber, no drei.

**Measured on 2026-09-15 with `webdesign.mjs inspect <url> --selector "h1,.eyebrow,nav a,p"`**,
which reads computed styles over the DevTools protocol, so these replace the
screenshot estimates further down wherever the two disagree:

| Element | Computed | Box at 1440 |
|---|---|---|
| Hero `h1` | **67.84px / 74.62px**, weight 400, letter-spacing -0.16px, `anthropicSerif`, `rgb(250,249,245)` | 624 x 149 at x 408, y 365 - a centred 624px column, not full width |
| Eyebrow `.text-prehead-tracked` | 14px / 14px, weight 500, letter-spacing **+1.68px**, uppercase, `anthropicSans` | 624 x 14 at x 408, y 327 |
| Index rows | 15px / 26px, weight 400, -0.16px, `anthropicSerif` | **405px wide at x 517** - narrower than the title column, centred on it |
| Header nav links | 15px / 21px, weight 400, -0.0375px, `anthropicSans`, `rgb(15,15,14)` | 21px tall at y 24 |
| Side contents links | 16px / 20px, `anthropicSerif`, `rgb(0,0,238)` | 44px wide at x 0 - the rail is off-canvas at load |

The "~76px" display size below was read off a screenshot; the browser says
67.84. The tracking on the eyebrow is +1.68px on 14px, which is +0.12em, not
the +0.16em estimated. Run `inspect` before trusting any number in a teardown,
including this one.

## Read off a screenshot at 1440, then corrected

The first readings, from a screenshot rather than the browser; where the
table above disagrees, the table wins.

- A **solid cream header bar, 68px**, wordmark left, nav right, one dark pill
  button. The scene starts *under* it, not behind it.
- Hero **~87vh**: sky, a moon top-right, warm cloud at the edges, and
  **soft-blurred branches in the corners** - the nearest plane is out of
  focus. Depth of field is what makes a cut-out read as a camera and not a
  collage: `filter: blur(3px)` on the nearest plane, sharp in the middle
  distance, slightly hazed at the back.
- Eyebrow uppercase, centred: read as 13px +0.16em, measured as 14px +1.68px
  (+0.12em). Display serif, two lines, the second pushed right ~150px in the
  screenshot: read as ~76px, measured as 67.84px in a centred 624px column.
  Dot-leader contents **15px**, `[n]` numerals left, labels right, five rows.
  All white with a soft shadow.
- Three small dots bottom-left re-light the scene (day / night / morning; the
  next section - it is not a photograph swap). "Made with ..." credit
  bottom-right, 12px.
- Then a **warm off-white article**: a serif lede at **~28px on a 640px
  column**, body serif **18px / 1.55**, bold run-in labels (`**Price.**`),
  and a thin vertical progress rail of tick marks at the far left.

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
