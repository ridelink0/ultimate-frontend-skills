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
| A real 3D object, exploded view, product turn | **three.js** | 191-370 KB gz (`three.md` §2) |
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

## The engines that ship here

Three runtimes beyond `motion.js`, all zero-dependency, all copied in by the
scaffolder. Use them before reaching for anything heavier.

- **`gradient.js`** - an animated WebGL mesh gradient. Layered simplex noise
  with domain warping, mixed in linear space, dithered against banding.
  `<canvas class="gradient" data-gradient="#0b1226,#2c3a56,#a5735a,#e8ac66">`.
  This is the colour field the reference pages have and a CSS radial stack
  never gets to. Falls back to a static CSS mesh, renders one frame under
  reduced motion, and stops entirely when off screen.
- **`depth.js`** - real three-plane parallax. Signed `data-depth` on each plane
  sets its rate against *both* scroll and pointer, and drives blur and haze
  from the same number, so a far plane is automatically hazier and a near one
  softer. Negative is behind and lags, positive is in front and leads. Also
  does single-photo 3D from a depth map (`data-photo` + `data-depthmap`,
  generate with Depth Anything V2).
- **`sky.js`** - the launch-page hero itself: a WebGL sky you re-light with
  three palette dots. Not a crossfade - one weight vector, eased with
  `1 - exp(-dt * 2.2)`, barycentrically blends every sky and light colour and
  the sun direction, so the world re-lights the way the reference does. In
  the frame: cloud kept to the edges and lit from the sun's side, a crescent
  moon top-right that is faint by day and the light by night, stars after
  dark, and an out-of-focus branch in each lower corner with a little pointer
  parallax - depth of field is what makes it read as a camera.
  `data-mood="Night"` starts it in a mood. `hero-fable` uses it. Real buttons,
  keyboard-operable, CSS fallback.
- **`exploded.js`** - any made thing taken apart, in three.js. Reads its
  parts from a `<ol>` in the markup, so the semantic list is also the no-JS
  fallback. Each `<li>` is a shape (`ring`, `disc`, `dome`, `box`, `torus`,
  `cone`, `sphere`, `hands`, `chain`, or the default `slab`), a size, a
  material preset and `data-y`, its place on the axis; `data-repeat="12"`
  puts copies round a circle for markers and screws; `data-model="thing.glb"`
  loads a real model instead and pulls its named parts apart. `data-axis="x"`
  takes it apart sideways. Physical materials lit by a room environment, a
  contact shadow, a vignette, and callouts projected onto each part's real
  position that track it through the turn.

## Exact specifiers, verified

```
three@0.186.0        anime.js@4.5.0       gsap@3.15.0        lenis@1.3.26
ogl@1.0.11           pixi.js@8.20.1       postprocessing@6.39.5
lottie-web@5.13.0    @rive-app/canvas@2.42.1                 matter-js@0.20.0
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
  "three": "https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/"
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

## Tools, by need

The tools are friends, not competitors. Hand-drawn SVG where a photograph
exists, a bespoke scroll engine where GSAP exists, a guessed layout where a
render exists - each of those is the low-effort version.

| Need | Reach for |
|---|---|
| The order to do all of this in | `references/pipeline.md` - nine stages, a gate at each |
| Anything beyond the engines above | `references/stack.md` - the table of which library for which job, with verified specifiers and CDN URLs |
| To see what a site you are imitating actually does | `webdesign.mjs look <url>` - real render, two scroll positions, PNGs. Study the reference as an image, not as a description of one |
| What a site you are imitating actually SETS - its computed type, the fonts it loaded, its colours, what it fetched | `webdesign.mjs inspect <url> --selector "h1,p,a"` - the Elements panel over the DevTools protocol. Numbers read from the browser beat numbers read from a picture; a teardown starts here |
| Three references that disagree with each other | `webdesign.mjs awards --pick <register>`, then `study --awards "<technique>"` to render them. `awards --techniques` lists what the corpus can be searched by |
| Visual research on a style, a palette, a font in the wild | `webdesign.mjs study --list editorial\|object\|cinema\|product` renders a curated batch into contact sheets; the `image-deep-research` skill for anything it does not cover (open, licensed image search with verified URLs, moodboards) |
| Photographs | Unsplash, Pexels, Wikimedia, museum IIIF - `references/imagery.md` has the URL formats and licences. Verify every hotlink with a HEAD request |
| Detailed PBR textures and real environment lighting, free | `webdesign.mjs assets textures <slug>` and `assets hdri <slug>` - CC0, no key. `references/image-gen.md` wires the maps into the material |
| A generated image, when no photograph exists | `webdesign.mjs assets gen "<prompt>"` - it detects what this machine can do and never invents a key. Remember a generated image cannot be relit |
| Geometry primitives cannot carry - knurling, guilloché, a movement bridge | `webdesign.mjs blender glb <script.py> --out <file>`, then `data-model` on the exploded list. `references/blender.md`; skip it when primitives would do |
| To know what else is installed and what changes because of it | `webdesign.mjs tools` - and `references/plugins.md` for the handoffs |
| Depth from one photograph | `webdesign.mjs cut` (rembg, local) |
| Pinning, scrubbing, sequenced choreography | GSAP 3.15 + ScrollTrigger from cdnjs, free for everything now. `gsap.matchMedia()` for the reduced-motion and narrow-screen branches |
| A real 3D object the visitor must turn | three.js from jsDelivr, or `<model-viewer>` for hotspots with near-zero code |
| Whole-page inertia as a brand decision | Lenis 1.3.26+, never ScrollSmoother alongside CSS scroll timelines |
| A design that exists in Figma | the Figma MCP tools, when attached: `get_design_context`, `get_screenshot` |
| To know whether it looks right | `webdesign.mjs look`, then your own eyes on the PNGs. Nothing else counts |

## The rule

Load nothing you do not use. `motion.js`, `gradient.js` and `depth.js` cover
most pages at zero bytes. Add GSAP the moment you need a pin or a scrub, three.js
the moment the subject is a real object, and nothing else unless the page asks
for it. Six libraries on a landing page is its own tell.
