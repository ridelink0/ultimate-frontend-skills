# The stack

Reach for the library. Hand-rolling a scroll engine, a gradient, or an
exploded view produces the low-effort version of all three. Everything here is
free, CDN-loadable, and needs no build step.

## What to use for what

| The job | Reach for | Weight |
|---|---|---|
| Reveals, nav state, simple parallax | `motion.js` (ships here) | 0 |
| Animated colour field / hero gradient | `gradient.js` (ships here, raw WebGL2) | 0 |
| Three-plane parallax, pointer depth, depth-map 3D | `depth.js` (ships here) | 0 |
| Pinning, scrubbing, horizontal scroll, snap, sequencing | **GSAP + ScrollTrigger** | ~47 KB gz |
| Line/word/char text reveals | **GSAP SplitText** (free since 2025) or **split-type** | ~3 KB |
| Layout transitions (a card becoming a page) | **GSAP Flip** | ~8 KB |
| SVG morph / draw-on | **GSAP MorphSVG / DrawSVG** | ~5 KB |
| Timeline choreography without GSAP | **anime.js v4** | ~10 KB gz |
| A real 3D object, exploded view, product turn | **three.js** | ~160 KB gz |
| Bloom / DOF / film grain over a 3D scene | **postprocessing** | ~40 KB gz |
| Tiny WebGL (one shader, no scene graph) | **ogl** | ~10 KB gz |
| 2D WebGL: particles, displacement, filters at scale | **pixi.js** | ~120 KB gz |
| Page-wide scroll inertia, as a brand decision | **lenis** | ~5 KB gz |
| Designer-authored vector animation | **lottie-web** or **@rive-app/canvas** | 60 / 90 KB |
| Physics (falling, springs, collisions) | **matter-js** | ~25 KB gz |
| Generative/creative sketch work | **p5** | ~350 KB, lazy-load only |
| 3D text in a three.js scene | **troika-three-text** | ~40 KB gz |
| Noise for any of the above | **simplex-noise** | ~1 KB |
| WebGL displacement on a DOM image (hover/scroll morph) | **curtainsjs** or **hover-effect** | 30 / 4 KB gz |
| A carousel that is not a JS reimplementation of scroll-snap | **embla-carousel** | ~6 KB gz |
| Page transitions on a multi-page static site | **@unseenco/taxi** or **@barba/core** | 5 / 9 KB gz |
| Tiny WAAPI-based animation, no timeline | **motion** (the standalone one) | ~5 KB gz |
| Matrix/vector maths for hand-written WebGL | **gl-matrix** | ~9 KB gz |
| Text splitting without GSAP | **splitting** | ~3 KB gz |
| Flat-shaded pseudo-3D from a few primitives | **zdog** | ~10 KB gz |

## Exact specifiers, verified

```
three@0.185.1        anime.js@4.5.0       gsap@3.15.0        lenis@1.3.26
ogl@1.0.11           pixi.js@8.20.1       postprocessing@6.39.4
lottie-web@5.13.0    @rive-app/canvas@2.42.0                 matter-js@0.20.0
split-type@0.3.4     p5@2.3.2             simplex-noise@4.0.3
troika-three-text@0.52.5                  meshline@3.3.1
curtainsjs@8.1.6     embla-carousel@8.6.0 @unseenco/taxi@1.9.1  @barba/core@2.10.3
motion@13.2.0        gl-matrix@3.4.4      splitting@1.1.0       hover-effect@1.2.1
zdog@1.1.3
```

```html
<!-- GSAP: PascalCase filenames, core first, then registerPlugin -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.15.0/gsap.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.15.0/ScrollTrigger.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.15.0/SplitText.min.js"></script>
<script>gsap.registerPlugin(ScrollTrigger, SplitText)</script>

<!-- three.js: the importmap MUST map both, at the SAME version, or you get
     two copies of three and every instanceof check fails -->
<script type="importmap">
{"imports":{
  "three": "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/"
}}</script>

<!-- anime.js v4 is ESM-only and the API is NOTHING like v3 -->
<script type="module">
  import { animate, createTimeline, stagger, utils } from
    'https://cdn.jsdelivr.net/npm/animejs@4.5.0/+esm'
</script>

<script src="https://cdn.jsdelivr.net/npm/lenis@1.3.26/dist/lenis.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/2.3.2/p5.min.js"></script>
```

## anime.js v4, because every tutorial online is v3

v4 is a rewrite. `anime({targets, ...})` no longer exists. Named imports only.

```js
import { animate, createTimeline, stagger, svg, utils, onScroll } from 'animejs'

animate('.card', {
  y: [40, 0], opacity: [0, 1],
  duration: 900, ease: 'outExpo',
  delay: stagger(60),
  autoplay: onScroll({ enter: 'bottom-=15%', sync: 0.4 }),  // scrub with the scroll
})

const tl = createTimeline({ defaults: { ease: 'outQuint' } })
  .add('.a', { opacity: [0, 1] }, 0)
  .add('.b', { x: [-30, 0] }, '<+=120')

animate(svg.createDrawable('.line'), { draw: ['0 0', '0 1'], duration: 1600 })
```

Names that changed: `easing` -> `ease`, `easeOutExpo` -> `outExpo`,
`translateY` -> `y`, `anime.stagger` -> `stagger`, `anime.timeline` ->
`createTimeline`, `complete` -> `onComplete`. `onScroll` replaces the whole
ScrollObserver dance and is the reason v4 is worth using over GSAP for
scroll-linked work on a small page.

## GSAP, the parts worth knowing

All former Club plugins are free since April 2025 - SplitText, MorphSVG,
DrawSVG, Flip, Inertia, ScrollSmoother, the lot. The only restriction is
building a competing animation tool.

```js
gsap.registerPlugin(ScrollTrigger, SplitText, Flip)

// pinned scrub: the exploded-view / storytelling workhorse
gsap.timeline({ scrollTrigger: {
  trigger: '#sec', start: 'top top', end: '+=180%',
  pin: true, scrub: 0.8, anticipatePin: 1, invalidateOnRefresh: true,
}}).to('.part', { y: (i) => (i - 2.5) * 120, ease: 'none' }, 0)

// line reveals, after fonts settle or the lines break at fallback metrics
document.fonts.ready.then(() => {
  const s = new SplitText('h1', { type: 'lines', linesClass: 'line' })
  gsap.set('.line', { overflow: 'clip' })
  gsap.from(s.lines, { yPercent: 110, duration: 0.9, ease: 'expo.out', stagger: 0.06 })
})

// branch on breakpoint and reduced motion; auto-reverts when a query stops matching
gsap.matchMedia().add({
  desk: '(min-width: 900px)', calm: '(prefers-reduced-motion: reduce)',
}, (ctx) => { if (ctx.conditions.calm) return; /* build here */ })
```

`scrub: 0.8` is the premium feel. `true` is 1:1 and reads mechanical; above 2
reads like lag.

## three.js for a page, not a game

```js
renderer.outputColorSpace  = THREE.SRGBColorSpace
renderer.toneMapping       = THREE.NeutralToneMapping   // preserves brand colour
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
scene.environment = new THREE.PMREMGenerator(renderer)
  .fromScene(new RoomEnvironment(), 0.04).texture       // studio light, zero network
```

Normalise every model on load (centre it, scale the longest axis to ~1.6) so
the scroll maths is model-independent. Project HTML labels onto 3D points with
`Vector3.project()` - and reject `z > -camera.near` in view space FIRST, or
points behind the camera come back as mirrored garbage.

Budget: a marketing scene is 1-3 draw calls of geometry, no shadow maps
(use a baked contact shadow plane), `powerPreference: 'high-performance'`, and
`renderer.setAnimationLoop` only while the section is on screen.

## Image displacement, the effect that reads as expensive

A photograph that liquefies into the next one on hover or scroll is a WebGL
displacement between two textures driven by a greyscale noise map. `curtainsjs`
binds a shader to an actual `<img>` in the DOM, so the image stays real content
with real alt text and real SEO, and the shader only takes over the paint.

```js
import { Curtains, Plane } from 'curtainsjs'
const curtains = new Curtains({ container: 'canvas', pixelRatio: Math.min(devicePixelRatio, 1.5) })
new Plane(curtains, document.querySelector('.morph'), {
  vertexShader, fragmentShader,          // sample tex2 offset by displacement * uProgress
  uniforms: { progress: { name: 'uProgress', type: '1f', value: 0 } },
})
```

Keep the displacement under ~0.06 of the frame or it stops reading as a
material and starts reading as a glitch filter.

## The rule

Load nothing you do not use. `motion.js`, `gradient.js` and `depth.js` cover
most pages at zero bytes. Add GSAP the moment you need a pin or a scrub, three.js
the moment the subject is a real object, and nothing else unless the page asks
for it. Six libraries on a landing page is its own tell.
