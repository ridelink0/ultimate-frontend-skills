# Real-time 3D

For the page where the subject is an actual object and the reader is meant to
turn it, open it, or watch it assemble. Everything here is measured on
three@0.186.0. GPU timings are ANGLE (NVIDIA GeForce RTX 3060, Direct3D11) in
headless Chromium via `EXT_disjoint_timer_query_webgl2`, median of 24 queries,
disjoint frames discarded.

## 1. Should this be 3D at all

Six questions. Two "no" answers and you are building a slower version of a page
that already worked.

1. **Does the reader need to see a relationship a photograph cannot hold still?**
   An exploded view, a cutaway, a mechanism turning. If the answer is "it looks
   cool rotating", a rendered turntable is 90 KB of WebP instead of 300 KB of
   runtime and it never drops a frame.
2. **Do you have the geometry?** Not a photo, not a render - a GLB with clean
   normals and separable parts. Modelling it is usually more work than the page.
3. **Is there an environment?** A `metalness: 1` surface has no diffuse term.
   Every pixel it shows is a reflection. With no environment, metal renders
   black. See §3.
4. **Can the reader do something a video cannot?** Turn it themselves, hold the
   dissolve half-open, pick a part. If the whole interaction is "scroll and it
   plays", that is a video.
5. **Does it survive reduced motion and a dead GPU?** You owe both a real path,
   not a blank canvas. See §9.
6. **Is one hero worth 88 KB gz plus a model plus a 1-second lighting bake?**
   Sometimes. Not usually.

| Want | Build | Cost |
|---|---|---|
| The object turns as you scroll | canvas image sequence | 60-90 WebP frames, 40-80 KB each |
| Parts separate on scroll, one fixed camera | image sequence, still | same |
| Reader turns it themselves, any angle | three.js | 88 KB gz + model |
| Camera moves through the object | three.js | same |
| Parts separate AND the reader can stop anywhere and inspect | three.js | same |
| The material is the point (metal, glass, lacquer) | three.js | same |

The image sequence is not a consolation prize. `motion.md` has the spec, it
holds at 60 fps on a five-year-old phone, and at 25-50px of scroll per frame it
is indistinguishable from a scrubbed render for a fixed camera. Reach for three
when the camera or the reader moves.

## 2. The import map that works

Verified on this machine: rendered in headless Chromium through the repo's own
harness, zero console errors, `gl.getError() === 0`, one draw call.

```html
<!doctype html><meta charset="utf-8">
<!-- The importmap MUST come before any module script. BOTH keys must be the
     SAME version or you load two copies of three and every instanceof fails.
     The addons key needs the trailing slash on the key AND the value. -->
<script type="importmap">
{"imports":{
  "three":         "https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.min.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/",
  "three/webgpu":  "https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js",
  "three/tsl":     "https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.tsl.js"
}}</script>
<script type="module">
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
</script>
```

Drop the `webgpu` and `tsl` keys unless you use them - an unused import-map
entry costs nothing, but it invites someone to reach for §3's warning.

Import maps are Baseline: Chrome 89, Firefox 108, Safari 16.4. No shim.

**Payload, measured with `Accept-Encoding: gzip` - real transfer bytes:**

| file | gz |
|---|---|
| `three@0.186.0/build/three.module.min.js` | **88.3 KB** |
| `three@0.186.0/build/three.module.js` (unminified) | 128.4 KB |
| `three@0.186.0/build/three.webgpu.min.js` | 201.0 KB |
| `gsap/3.15.0/gsap.min.js` + `ScrollTrigger.min.js` | 27.6 + 17.6 = 45.2 KB |
| `lenis@1.3.26/dist/lenis.min.js` | 5.3 KB |

`stack.md`'s "three.js ~160 KB gz" is wrong. Minified and gzipped it is 88 KB.

### Rules for the specifier

1. **`three@r186` is not a valid npm specifier.** It is `three@0.186.0`.
2. **cdnjs has the core but not the addons.** `three.js/0.186.0/three.module.min.js`
   is 200; `three.js/0.186.0/examples/jsm/environments/RoomEnvironment.js` is
   **404**. Any real product page needs `GLTFLoader` and `RoomEnvironment`, so
   use jsDelivr for both map entries.
3. **Do not mix hosts.** cdnjs's `three.module.min.js` relative-imports
   `./three.core.min.js` as a sibling; jsDelivr's does not. Half of each is two
   copies of three.
4. **`RGBELoader` is a deprecated stub at r186** - the whole file extends
   `HDRLoader` and warns. Import `three/addons/loaders/HDRLoader.js`.
   `RGBMLoader` was removed in r180.

Addon paths verified 200 on jsDelivr at 0.186.0:
`environments/RoomEnvironment.js`, `controls/OrbitControls.js`,
`loaders/GLTFLoader.js`, `loaders/HDRLoader.js`, `renderers/CSS2DRenderer.js`,
`libs/meshopt_decoder.module.js`, `utils/BufferGeometryUtils.js`.

### Migration notes that change how a page looks

Verbatim consequences from the three.js migration guide, for this page type:

| bump | what changed | why you care |
|---|---|---|
| r180→181 | indirect specular improved; PBR materials conserve energy; PMREM reflections improved | rough materials (roughness > 0.5) are **brighter** than before |
| r181→182 | `PCFSoftShadowMap` deprecated on `WebGLRenderer` | "Use `PCFShadowMap` which is now soft as well" |
| r182→183 | **`RoomEnvironment`'s scene position changed** | a page art-directed on r182 or earlier will not match on r186 |
| r183→184 | background/environment map rotation aligned to object rotation; `FileLoader.load()` returns nothing | a rotated env map lands differently |
| r185→186 | `Object3D` has `dispose()`; `Source` → `TextureSource`; `BufferGeometryUtils.toTrianglesDrawMode()` mutates in place | call `super.dispose()` in custom subclasses |

`PostProcessing` was renamed `RenderPipeline` at r183.

### WebGPU: measured, and still no

`three/webgpu` works. In headless Chromium here, `navigator.gpu` is true, and
`new WebGPURenderer(); await r.init()` gives `backend.isWebGPUBackend === true`;
with `{ forceWebGL: true }` it gives a `WebGLBackend` and renders a frame clean.
The async story is settled - `renderAsync`/`computeAsync`/`clearAsync` are
deprecated since r181, you `await renderer.init()` and call the sync methods,
and `waitForGPU()` is gone.

Do not use it for a product page, for three reasons that are numbers:

1. **201 KB gz against 88 KB gz.** 113 KB more on a page whose point is arriving.
2. **The node-material path is a second API surface.** Every `onBeforeCompile`
   recipe - the dissolve in §7 - has to be rewritten in TSL.
3. **Nothing here is compute-bound.** One object, 1-3 draw calls, a fragment
   shader measuring 0.1-0.4 ms at 1024². WebGPU wins draw-call throughput,
   compute, and storage buffers. You have none of those problems.

Use it when the scene is thousands of instances driven by a compute pass, or
when you want TSL as an authoring tool. Otherwise `WebGLRenderer` at r186.

## 3. Lighting, and materials that read as metal

**The environment is the material.** This is the single highest-leverage fact on
the page. A metal surface shows you reflections and nothing else.

### The cheapest convincing studio: PMREM from RoomEnvironment

Zero network bytes, generated on the GPU from a procedural box room.

```js
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();   // frees the generator, NOT the texture
```

Measured output: **768 × 1024**, `mapping === THREE.CubeUVReflectionMapping`.

**The first call costs 1.1-1.6 s. The second identical call costs 30.6 ms.**
(Three measurements on this machine: 1556.6 ms, 1510 ms, 1088 ms first call;
30.6 and 34.1 ms on repeat.) The gap is shader compilation, not the blur -
`sigma: 0` costs 11.8 ms once the programs are warm, `sigma: 0.12` costs 8.3 ms.
On ANGLE/D3D11, which is what every Windows Chrome user has, the
GLSL → HLSL → D3D bytecode path is that slow.

1. **Never build the PMREM lazily.** 1.5 s of blocked main thread on first
   scroll. Build it behind a real loading affordance, before the hero is
   interactive. The quality probe in §10 catches this as a long task.
2. `sigma` is nearly free. `0.04` softens the box seams so the reflection reads
   as a softbox rather than a corner.
3. Generate once, reuse the texture on every material.
4. `RoomEnvironment` moved at r183. Old references will not match.

An HDRI via `HDRLoader` buys a specific, recognisable reflection - a real
window, a real horizon - and a 1-4 MB download. `RoomEnvironment` buys
"expensive studio product shot" for nothing. Adding one or two emissive planes
*into* the room scene before `fromScene` gets you most of the HDRI look at none
of the bytes.

```js
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping      = THREE.NeutralToneMapping;   // Khronos PBR Neutral
```

Tone mapping constants at r186: `NoToneMapping` 0, `Linear` 1, `Reinhard` 2,
`Cineon` 3, `ACESFilmic` 4, `Custom` 5, `AgX` 6, `Neutral` 7. `Neutral`
preserves brand hue and is the right default for product. `AgX` is the filmic
one and desaturates highlights - correct for a scene, wrong for a red logo.

### What each layer costs

One sphere (96×64) filling most of a 1024² frame.

| material | GPU ms | × Physical bare |
|---|---|---|
| `MeshBasicMaterial` | 0.028 | 0.28 |
| `MeshStandardMaterial` metal | 0.092 | 0.91 |
| `MeshPhysicalMaterial` bare metal | 0.101 | 1.00 |
| + `sheen: 1` | 0.109 | 1.08 |
| + `anisotropy: 1` | 0.128 | 1.27 |
| + `clearcoat: 1` | 0.132 | 1.31 |
| + `iridescence: 1` | 0.194 | 1.92 |
| all four at once | 0.250 | 2.48 |
| `transmission: 1` + thickness + ior | 0.302 | 2.99 |
| transmission + `dispersion: 3` | 0.401 | 3.97 |

Physical over Standard costs 10%. Every layer after that is a real multiplier,
and transmission is a 3x. At 1024² with one object none of it threatens 60 fps.
At 2560×1440 with DPR 2 you shade 14x the pixels and 0.4 ms becomes ~5.6 ms,
which is why §8 and §9 are about pixels rather than triangles.

### The recipes

**Brushed steel - anisotropy.** The stretched highlight is the whole effect.

```js
new THREE.MeshPhysicalMaterial({
  color: 0xb8bcc2, metalness: 1, roughness: 0.28,
  anisotropy: 1.0,
  anisotropyRotation: Math.PI / 2,     // radians CCW from the tangent; default 0
  // anisotropyMap: R,G = direction in [-1,1] tangent/bitangent, B = strength
})
```

Roughness below ~0.15 makes anisotropy invisible - there is no lobe left to
stretch. 0.25-0.35 is the band where it reads. On an imported mesh check
`geometry.attributes.tangent` exists or call
`BufferGeometryUtils.computeTangents`; on a cylinder the default tangent basis
is already the circumferential brush you want.

**Clearcoat - lacquer, anodised aluminium, a painted casing.**

```js
new THREE.MeshPhysicalMaterial({
  color: 0x1b1d22, metalness: 0.9, roughness: 0.45,
  clearcoat: 1.0, clearcoatRoughness: 0.06,   // default clearcoatRoughness is 0.0
  // clearcoatNormalMap: orange-peel normal at ~0.15 scale is what sells "sprayed"
})
```

The tell: base `roughness` high, `clearcoatRoughness` low. Rough metal under a
glassy coat is a lacquered object. Equal roughnesses is just a brighter metal.

**Iridescence - thin film, anodised titanium, oil slick.**

```js
new THREE.MeshPhysicalMaterial({
  metalness: 1, roughness: 0.2,
  iridescence: 1.0,
  iridescenceIOR: 1.3,                    // default 1.3
  iridescenceThicknessRange: [100, 400],  // default, nanometres
})
```

The thickness range is where the colour lives. `[100, 400]` nm sweeps roughly
one interference order. `[200, 280]` gives a single stable hue shift rather than
a rainbow. Past ~600 nm it reads as a bug.

**Crystal - transmission.**

```js
new THREE.MeshPhysicalMaterial({
  metalness: 0, roughness: 0.02,
  transmission: 1.0,
  thickness: 0.8,                 // default 0 - with 0 there is NO refraction
  ior: 1.62,                      // default 1.5. glass 1.5, sapphire 1.77, diamond 2.42
  dispersion: 3,                  // 0 = none; splits R/G/B by ior, the "fire"
  attenuationColor: new THREE.Color(0xcfe8ff),
  attenuationDistance: 0.5,       // default Infinity - leave it and the glass is colourless
  transparent: false,             // deliberately: transmission composites itself
})
```

`thickness: 0` is the most common mistake in this whole file. It silently
produces a clear, flat, refraction-free surface and people conclude transmission
is broken.

**Transmission costs a second scene pass.** Measured with
`renderer.info.autoReset = false`, same scene, one opaque cube:

```
opaque only                 calls: 1   triangles: 12
+ one transmissive mesh     calls: 3   triangles: 524
```

The renderer redraws all opaque geometry into an internal target so the
transmissive surface has something to refract.
`renderer.transmissionResolutionScale` sizes that target:

| scale | GPU ms |
|---|---|
| 1.0 (default) | 0.300 |
| 0.5 | 0.234 |
| 0.25 | 0.219 |

-22% at 0.5 in a trivial scene, and the saving grows with how much opaque
geometry there is to redraw. Refraction is already a blur, so 0.5 is invisible.
Set it.

**Verified defaults at r186:** `ior: 1.5`, `thickness: 0`,
`attenuationDistance: Infinity`, `clearcoatRoughness: 0.0`,
`iridescenceIOR: 1.3`, `iridescenceThicknessRange: [100, 400]`,
`sheenRoughness: 1.0`, `anisotropyRotation: 0`, `specularIntensity: 1.0`.

### The recompile trap

The most important performance fact in this file, and it is invisible to any
profiler that samples at 1 Hz.

Every layered feature has a setter shaped like this in `MeshPhysicalMaterial.js`:

```js
set anisotropy( value ) {
  if ( this._anisotropy > 0 !== value > 0 ) {
    this.version ++;              // <- FULL SHADER RECOMPILE
  }
  this._anisotropy = value;
}
```

Identical setters exist for `clearcoat`, `dispersion`, `iridescence`,
`retroreflectivity`, `sheen` and `transmission`, because `WebGLPrograms.js`
reads all seven as booleans (`material.clearcoat > 0`). Measured with
`renderer.info.programs.length`, rendering between each write:

```
base metal                              8 programs
anisotropy 0   -> 0.6                   9     <- recompile
anisotropy 0.6 -> 0.9                   9     <- no recompile
clearcoat  0   -> 1                    10     <- recompile
iridescence 0  -> 1                    11     <- recompile
sheen 0        -> 0.4                  12     <- recompile
anisotropy 0.9 -> 0                    13     <- recompile
```

**Never scrub one of those seven through zero from a scroll handler.** On
ANGLE/D3D11 a single link is tens to hundreds of milliseconds - a visible,
unrecoverable hitch at the exact moment the reader is scrolling. Two fixes:

- Keep the feature on at a floor value (`clearcoat: 0.001` when "off") so only
  the uniform changes and the define never flips; or
- Build every variant up front, `renderer.compile(scene, camera)` during the
  loading state, then swap `mesh.material`.

UNVERIFIED: whether `compile()` / `compileAsync()` fully pre-warms a variant so
a later swap is hitch-free. Both exist at r186 and the mechanism is documented,
but a pre-compiled swap was not measured against a cold one here.

`retroreflectivity` is new in r186 (absent from 0.185.1). It reflects the
specular lobe back toward the light - retroreflective tape, a road sign, a cat's
eye. Do not reach for it unless the product is actually retroreflective, and
note it is one more zero-crossing define.

## 4. The scroll architecture

### What is actually invertible

Measured with real wheel gestures over CDP at 1440×900, a 400vh stage with a
sticky pin, ScrollTrigger `scrub: 0.8`, scrolled to the bottom and back:

```
ScrollTrigger progress min = 0   max = 1     (exactly, both ends)

top       aY=200  bY=200  stProgress=0  scrollY=0
mid-down  aY=0    bY=0    stProgress=1  scrollY=2700
bottom    aY=0    bY=0    stProgress=1  scrollY=2700
mid-up    aY=200  bY=200  stProgress=0  scrollY=0
back-top  aY=200  bY=200  stProgress=0  scrollY=0
```

**GSAP ScrollTrigger scrub is exactly invertible.** `.from()` and `.fromTo()`
inside a scrubbed timeline return to their recorded start values on the way
back. The bidirectional failure people report is not in ScrollTrigger. It is in
one of these three, in order of how often it is the cause.

**1. A hand-rolled lerp is frame-rate dependent.** `v += (target - v) * 0.12`
per rAF, value after a fixed wall-clock time:

| refresh | naive @0.25 s | naive @1 s | with decay @0.25 s |
|---|---|---|---|
| 30 Hz | 0.6404 | 0.9784 | 0.8707 |
| 60 Hz | 0.8530 | 0.9995 | 0.8530 |
| 120 Hz | 0.9784 | 1.0000 | 0.8530 |
| 144 Hz | 0.9900 | 1.0000 | 0.8530 |

The same page feels like a different page on a 144 Hz laptop and a throttled
phone, and on a variable-refresh display the feel changes *during* the scroll.
The fix is exponential decay against real `dt`:

```js
// k is the factor you tuned at 60fps; dt is seconds since the last frame
v += (target - v) * (1 - Math.pow(1 - k, dt * 60));
```

Within 2% across a 5x refresh range. The 30 Hz row is high because one coarse
step overshoots the curve, which is correct behaviour.

**2. Any `+=` in the render function.** `mesh.rotation.y += 0.01` is a function
of frame *count*, not of progress. Scroll down slowly and back up fast and the
object ends somewhere else. Every scroll-driven write must be an absolute
assignment from progress: `mesh.rotation.y = p * Math.PI * 2`. A `+=` anywhere
in the scroll path is a non-invertible page and it passes every static review.

**3. `scrub` smoothing is a lag, so progress thresholds double-fire.** With
`scrub: 0.8` the rendered progress trails the scroll position, and can cross a
threshold, be overtaken, and cross back. Never drive a discrete event - a label
appearing, a class toggle, a sound - off `progress > 0.5` inside `onUpdate`.
Use `onEnter`/`onLeave`/`onEnterBack`/`onLeaveBack`, or hysteresis (enter at
0.52, leave at 0.48).

### Which engine

| approach | bidirectional | cost | verdict |
|---|---|---|---|
| GSAP ScrollTrigger `scrub: 0.8` | exact, verified | 45.2 KB gz | **use this** |
| hand-rolled progress + lerp | only with the `dt` form | 0 KB | fine if you write the decay; you will reimplement pin, refresh and matchMedia badly |
| CSS scroll-driven animations | exact - the scroll position *is* the timeline | 0 KB | for the DOM layers around the canvas, not for the canvas |

CSS scroll timelines cannot drive a WebGL uniform; that needs JS reading a
number. On a 3D page they are for the DOM furniture - progress bar, headline
wipes, callout fades - while one rAF drives the scene. Mixing them is correct
and cheap. Support per MDN: Chrome 115, Safari 26, Firefox not shipped. Always
`@supports`-gate, as `motion.md` says.

### Lenis, if the page has inertia as a brand decision

`lenis@1.3.26`, 5.3 KB gz. Load `dist/lenis.css` too (513 B) - it carries the
`html.lenis` rules. The wiring, from Lenis's own README:

```js
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((time) => { lenis.raf(time * 1000); });
gsap.ticker.lagSmoothing(0);
```

With that wiring do **not** also set `autoRaf: true` - you would run two loops.
Lenis writes the real `scrollTop`, so CSS scroll timelines, `position: sticky`,
find-in-page and keyboard scrolling keep working; ScrollSmoother transforms the
content and desyncs all of that. Lenis does not move focus on anchor arrival -
set `tabindex="-1"` and `focus({ preventScroll: true })` yourself.
`allowNestedScroll` walks the DOM tree on every scroll event; leave it off.

### The pattern, in full

One rAF. One progress number. Every write is a pure function of that number.

```js
import * as THREE from 'three';

/* ---- 1. ONE source of truth. ScrollTrigger only writes the number. ---- */
let target = 0;                    // raw scroll progress, 0..1
let shown  = 0;                    // what the scene is currently showing
let visible = false;

gsap.registerPlugin(ScrollTrigger);
ScrollTrigger.create({
  trigger: '#stage', start: 'top top', end: '+=400%',
  pin: '#pin', anticipatePin: 1, invalidateOnRefresh: true,
  onUpdate: (self) => { target = self.progress; },
  onToggle: (self) => { visible = self.isActive; },
});

/* ---- 2. ONE loop. Frame-rate-independent smoothing, absolute writes. ---- */
const K = 0.12;                    // tuned at 60fps; the decay form keeps it honest
let last = performance.now();

renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.05);   // clamp: a tab-switch returns a huge dt
  last = now;
  if (!visible) return;                             // never render an off-screen canvas

  shown += (target - shown) * (1 - Math.pow(1 - K, dt * 60));

  resizeToDisplay(renderer, camera);                // see §8: guarded, not every frame
  writeScene(shown);
  renderer.render(scene, camera);
  layoutCallouts(shown, dt);
});

/* ---- 3. The scene write is a PURE FUNCTION of p. No +=, no state. ---- */
const _home = new THREE.Vector3();                  // hoisted, never allocated in the loop

function writeScene(p) {
  const a = sub(p, 0.00, 0.35), b = sub(p, 0.25, 0.65), c = sub(p, 0.55, 1.00);

  group.rotation.y  = easeInOutQuart(a) * Math.PI * 1.5;    // absolute
  camera.position.z = 4.2 - easeOutExpo(b) * 1.6;
  camera.updateProjectionMatrix();

  for (let i = 0; i < parts.length; i++) {
    const t = easeOutQuint(sub(p, 0.25 + i * 0.06, 0.65 + i * 0.06));
    parts[i].position.copy(parts[i].userData.home)
            .addScaledVector(parts[i].userData.dir, t * spread);
  }
  dissolve.uCut.value = easeInOutCubic(c);                  // uniform only, no recompile
  group.updateMatrixWorld();                                // BEFORE the callouts read it
}

/* Remap p into a sub-range, clamped. This is the whole choreography primitive. */
const sub = (p, a, b) => Math.min(1, Math.max(0, (p - a) / (b - a)));
```

`invalidateOnRefresh: true` whenever `start`/`end` depend on live layout.
`anticipatePin: 1` kills the flash on a fast scroll into the pin.

## 5. Choreography

### Easing, sampled

Output value at input t. Recomputed here from the cubic-bezier definitions
(Newton-Raphson, 12 iterations), not copied.

| easing | 0.1 | 0.2 | 0.3 | 0.4 | 0.5 | 0.6 | 0.7 | 0.8 | 0.9 | done by 0.3 | peak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `cubic-bezier(0.16,1,0.3,1)` expo.out | 0.49 | 0.75 | 0.88 | 0.94 | 0.97 | 0.99 | 1.00 | 1.00 | 1.00 | **88%** | 1.000 |
| `cubic-bezier(0.22,1,0.36,1)` quint.out | 0.40 | 0.67 | 0.83 | 0.92 | 0.96 | 0.98 | 0.99 | 1.00 | 1.00 | 83% | 1.000 |
| `cubic-bezier(0.25,1,0.5,1)` quart.out | 0.35 | 0.60 | 0.76 | 0.87 | 0.93 | 0.97 | 0.99 | 1.00 | 1.00 | 76% | 1.000 |
| `cubic-bezier(0,0.55,0.45,1)` circ.out | 0.43 | 0.60 | 0.71 | 0.80 | 0.87 | 0.92 | 0.95 | 0.98 | 1.00 | 71% | 1.000 |
| `cubic-bezier(0.34,1.56,0.64,1)` back.out | 0.40 | 0.70 | 0.91 | 1.03 | 1.09 | 1.10 | 1.08 | 1.04 | 1.01 | 91% | **1.098** |
| `cubic-bezier(0.65,0,0.35,1)` inOutCubic | 0.01 | 0.04 | 0.11 | 0.25 | 0.50 | 0.75 | 0.89 | 0.96 | 0.99 | 11% | 1.000 |
| `cubic-bezier(0.76,0,0.24,1)` inOutQuart | 0.01 | 0.03 | 0.08 | 0.20 | 0.50 | 0.80 | 0.92 | 0.97 | 0.99 | 8% | 1.000 |
| `linear` | 0.10 | 0.20 | 0.30 | 0.40 | 0.50 | 0.60 | 0.70 | 0.80 | 0.90 | 30% | 1.000 |

The "done by 0.3" column is the whole argument. A curve 88% finished in the
first third *arrives* - the eye registers a destination and the rest is
settling. That reads as intent. `linear` reads as a machine. An in-out on a part
reads as a slideshow transition, because it spends 11% of its travel in the
first 30% and the object appears to hesitate before committing.

| what moves | easing | why |
|---|---|---|
| camera, master group rotation | `inOutQuart` / `inOutCubic` | the camera has mass; a camera that starts instantly is a camera with no operator |
| parts separating, callouts arriving, opacity | `outExpo` / `outQuint` | arrive, then settle |
| a turntable locked to scroll, a dissolve the reader can hold open | `linear` | the scroll position is already the easing; double-easing is the rubbery feel |
| the callout dot, a UI chip | `back.out` | **overshoots 9.8%, peaks at t≈0.6.** On a 3 kg machined object that is a lie about mass. Never on the part. |

### Overlap

Six parts across progress 0…1, computed:

```
sequential : 0-0.167  0.167-0.333  0.333-0.5  0.5-0.667  0.667-0.833  0.833-1
overlapped : 0-0.25   0.15-0.4     0.3-0.55   0.45-0.7   0.6-0.85     0.75-1
per-part span: sequential 0.167   overlapped 0.250   both end at exactly 1.0
```

A 40% overlap gives each part **1.5x more progress to move through** while the
sequence still finishes at 1.0. That is the entire reason overlap reads as
choreography: nothing is rushed, and there is always a second part in motion, so
the eye is never handed a still frame mid-sequence.

```js
const overlap = 0.4;                                   // 0.35-0.45 is the useful band
const span = 1 / (n - (n - 1) * overlap);
const range = (i) => [i * span * (1 - overlap), i * span * (1 - overlap) + span];
```

Below ~0.25 it reads as a queue. Above ~0.55 the parts move as one blob and the
separation stops being legible.

### Holds and anticipation

**Holds.** A stage that animates for its whole range never gives the reader a
static frame to read the callout against. Build the hold into the sub-range, not
into the easing: make `b - a` 70-80% of the stage's slice and let the remaining
20-30% dwell at 1.0. Never more than four stages - a fifth is past the point
where anyone keeps scrolling to find out.

**Anticipation.** In a scrubbed system anticipation cannot be a pre-move in
time, because the reader controls time and can stop on it. It has to be spatial
and small: settle 2-3° *into* the direction it is about to leave over the first
8% of the stage, then go.

```js
const anticip = -0.04 * Math.sin(sub(p, 0.00, 0.08) * Math.PI);
group.position.y = anticip + easeOutExpo(sub(p, 0.08, 0.6)) * lift;
```

Verified: a `sin` over a clamped sub-range is exactly 0 at both ends
(p=0 → 0.00000, p=0.04 → -0.04000, p=0.08 → -0.00000, p=1 → -0.00000), so it
inverts perfectly on the way back up.

For the scene, express everything in progress, never in milliseconds - the
reader sets the clock. `motion.md`'s duration scale still governs the DOM layers.

## 6. Wireframe to solid

| source geometry | triangles | `WireframeGeometry` | `EdgesGeometry(g, 1°)` | `EdgesGeometry(g, 30°)` |
|---|---|---|---|---|
| `BoxGeometry(1,1,1,4,4,4)` | 192 | 288 | **48** | 48 |
| `CylinderGeometry(1,1,2,48)` | 192 | 291 | 144 | **96** |
| `TorusKnotGeometry(0.8,0.26,200,32)` | 12,800 | - | 14,383 | - |

**`EdgesGeometry` is the one that reads as a technical drawing**, because it
discards edges between coplanar faces. On the subdivided box it returns 48
segments instead of 288 - exactly the 12 real cube edges, each split into 4 by
the subdivision. Six times less line, and it is the *right* line: no
triangulation diagonals, no tessellation grid. `thresholdAngle` is in degrees;
`1` keeps every real crease, `30` also drops the soft seams on a cylinder.

On an organic mesh `EdgesGeometry` is worse than useless - the torus knot gives
back 14,383 segments from 12,800 triangles, which is every edge it had.

```js
// mechanical parts: the technical-drawing look, and it is cheap
const edges = new THREE.LineSegments(
  new THREE.EdgesGeometry(part.geometry, 30),
  new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 })
);
part.add(edges);
// scrub: edges.material.opacity = 1 - p;  part.material.opacity = p;
```

`LineBasicMaterial` ignores `linewidth` on every desktop GL implementation -
ANGLE clamps to 1px - so the lines are always hairlines and get thinner on a
high-DPR screen. For anything but a hairline you need `Line2`/`LineMaterial`
from addons or `meshline`, which costs geometry.

**Barycentric wireframe** gives controllable width, anti-aliasing and a
per-fragment fade in one shader, and it costs vertices. Measured on the torus
knot:

```
indexed vertices        6,633
non-indexed vertices   38,400        <- 5.79x
barycentric attribute  460,800 bytes (vec3 float32 per vertex)
```

That 5.79x is the trade: each vertex needs a different barycentric value per
triangle it belongs to, so the index buffer must go. On a heavy product model
that is the difference between a 1 MB and a 6 MB scene.
(`IcosahedronGeometry` and the other polyhedra are *already* non-indexed, so
`toNonIndexed()` on them inflates nothing. `TorusKnotGeometry`, `BoxGeometry`
and `SphereGeometry` are indexed. UNVERIFIED: whether GLTF geometry always is -
and the 5.79x is specific to that torus knot; a different mesh gives a different
ratio.)

```js
const ni = src.index ? src.toNonIndexed() : src;
const n = ni.attributes.position.count;
const bary = new Float32Array(n * 3);
for (let i = 0; i < n; i += 3) bary.set([1,0,0, 0,1,0, 0,0,1], i * 3);
ni.setAttribute('aBary', new THREE.BufferAttribute(bary, 3));

const wire = new THREE.ShaderMaterial({
  transparent: true,
  uniforms: { uWidth: { value: 1.1 }, uColor: { value: new THREE.Color(0xffd27a) },
              uFade: { value: 1 } },
  vertexShader: `
    attribute vec3 aBary; varying vec3 vB;
    void main(){ vB = aBary; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    varying vec3 vB; uniform float uWidth; uniform vec3 uColor; uniform float uFade;
    void main(){
      vec3 d = fwidth(vB);                      // screen-space derivative: constant px width
      vec3 a = smoothstep(vec3(0.0), d * uWidth, vB);
      float e = 1.0 - min(min(a.x, a.y), a.z);
      if (e < 0.01) discard;
      gl_FragColor = vec4(uColor, e * uFade);
    }`,
});
```

`fwidth` needs no extension on WebGL2 - it is core GLSL ES 3.00. `uWidth` is in
pixels and stays constant at any zoom, which is the whole reason to pay the
5.79x.

### The dissolve, which is the transition worth building

Driven by a uniform, so it does not recompile. Verified: 21 renders scrubbing
`uCut` from 0 to 1 produced **zero** new programs.

```js
const uniforms = { uCut: { value: 0 }, uEdge: { value: 0.06 },
                   uGlow: { value: new THREE.Color(0xffd27a) } };

const solid = new THREE.MeshPhysicalMaterial({ color: 0xb8bcc2, metalness: 1, roughness: 0.22 });
solid.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>',       '#include <common>\nvarying vec3 vLocal;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      varying vec3 vLocal;
      uniform float uCut; uniform float uEdge; uniform vec3 uGlow;
      float hash(vec3 p){ p = fract(p*0.3183099+vec3(0.71,0.113,0.419)); p*=17.0;
                          return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float vnoise(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),
                       mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                       mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }`)
    .replace('#include <clipping_planes_fragment>', `
      float n = vnoise(vLocal * 6.0);
      if (n - uCut < 0.0) discard;
      #include <clipping_planes_fragment>`)
    .replace('#include <dithering_fragment>', `#include <dithering_fragment>
      float edge = 1.0 - smoothstep(0.0, uEdge, n - uCut);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, uGlow, edge);`);
};
// MANDATORY. Without a stable custom key three cannot tell two onBeforeCompile
// materials apart and will hand you a wrong cached program.
solid.customProgramCacheKey = () => 'dissolve-v1';
```

Then `uniforms.uCut.value = easeInOutCubic(p)` from the loop. Draw the
barycentric wireframe over the same geometry and fade `uFade` against `uCut` -
the wireframe burns away exactly where the solid appears.

Two caveats: `discard` disables early-Z for the whole draw, so a dissolving
material costs more than its row in §3 suggests; and
`#include <dithering_fragment>` is the last chunk in the physical fragment
shader, which is why appending after it is the right insertion point for a
post-lighting tint.

**Choose:** `EdgesGeometry` crossfade for mechanical objects - cheapest, reads as
a drawing, 6x less line. Shader dissolve for the actual transition - no
recompile, no geometry cost, and the only one of the four that can be held
half-open at an arbitrary scroll position and still look deliberate. Barycentric
only when you need a controllable anti-aliased line on an organic form and can
afford 5.79x the vertices. A plain two-material crossfade is the version that
reads as a default.

## 7. HTML callouts on 3D points

### The projection, and the guard

Same camera (z=4, near 0.1), same point, guarded and unguarded:

```
point (0.5, 0.5, 0) in front   -> guarded: { x: 518.9, y: 181.1, ndcz: 0.952 }   correct
point (0.5, 0.5, 6) BEHIND     -> guarded: null                                  rejected
                                  unguarded .project(): { x: -0.595, y: -0.793, z: 1.102 }
```

The unguarded NDC x and y are both inside [-1,1]. It looks like a perfectly
valid on-screen point, mirrored into the opposite quadrant. The only tell is
`z > 1`, and nothing in three checks it for you.

```js
const _c = new THREE.Vector3(), _v = new THREE.Vector3();   // hoisted once

function toScreen(worldPos, camera, canvas) {
  _c.copy(worldPos).applyMatrix4(camera.matrixWorldInverse);
  if (_c.z > -camera.near) return null;          // behind the camera: reject FIRST
  _v.copy(worldPos).project(camera);             // NDC, y up-positive
  const r = canvas.getBoundingClientRect();      // CSS px, NOT canvas.width
  return { x: (_v.x * 0.5 + 0.5) * r.width,
           y: (-_v.y * 0.5 + 0.5) * r.height, z: _v.z };
}
```

Call `updateMatrixWorld()` before reading `matrixWorld`, or the labels lag the
geometry by one frame - which on a scrubbed page looks like the label is
attached with a rubber band.

### CSS2DRenderer, and why not

What it does per frame per object, read from the r186 source: sets a vector from
`matrixWorld`, applies the view-projection, tests `z ∈ [-1,1]`, toggles
`element.style.display`, and writes a 2D `transform: translate(...)` - not
`translate3d`, so no layer promotion. With `sortObjects` on (the default) it
also flattens the scene, depth-sorts every `CSS2DObject` and writes
`style.zIndex` on each one, every frame.

It handles behind-camera correctly, and `CSS2DObject.center` (default 0.5, 0.5)
is a useful non-obvious way to anchor a label by its left edge
(`center.set(0, 0.5)`). But it uses a separate DOM overlay you must size and
position over the canvas yourself, the per-frame sort is pure overhead for
callouts that never cross, and it has no opinion about enter/exit choreography,
leader lines or occlusion - all three of which you need, so you end up writing
the transform yourself anyway.

**Use manual `project()`.** CSS2DRenderer earns its place when you have dozens
of labels whose stacking order genuinely changes as a camera orbits.

### Occlusion, and its real cost

Verified correct on a 1,536-triangle sphere at 900×600: near surface false, far
surface true, off to the side false, hidden side true.

```js
const _ray = new THREE.Raycaster(), _dir = new THREE.Vector3();
function occluded(worldPoint, camera, blockers) {
  _dir.copy(worldPoint).sub(camera.position);
  const dist = _dir.length();
  _ray.set(camera.position, _dir.normalize());
  _ray.near = 0;
  _ray.far  = dist - 0.01;             // stop just short of the anchor itself
  return _ray.intersectObjects(blockers, true).length > 0;
}
```

**1,000 raycasts against that 1,536-triangle sphere took 235.2 ms - 0.235 ms per
call.** Eight callouts raycast every frame is 1.9 ms, more than 11% of a 60 fps
budget, on the CPU, before anything has rendered. On a 100k-triangle product
model it is far worse. Three fixes, in order:

1. **Throttle.** Occlusion changes slowly relative to 60 Hz. Test one label per
   frame round-robin: eight labels is 0.235 ms/frame and each refreshes at
   7.5 Hz, which is invisible.
2. **Raycast a proxy.** Add an invisible low-poly hull or a single box as the
   blocker and pass only that. A 12-triangle box is two orders of magnitude
   cheaper.
3. **Skip the ray for convex products.** `worldNormal.dot(cameraDir) > 0` means
   the anchor faces away. One dot product, correct for any convex form. Fall
   back to a ray only where the product has a real overhang.

`three-mesh-bvh@0.9.15` is the library answer for raycasting a heavy mesh every
frame. UNVERIFIED: not loaded or benchmarked here. Throttling is cheaper than
adding a library.

### Making them enter and leave with the choreography

Popping has two causes: binary `display` toggling, and a label whose life is
controlled by geometry rather than by progress. Both go away if opacity is a
function of the same progress number the scene reads, and occlusion only
*multiplies* it.

```js
function layoutCallouts(p, dt) {
  for (const c of callouts) {
    const s = toScreen(c.anchor.getWorldPosition(_w), camera, canvas);

    // authored: each callout owns a slice of progress, the same sub() as the parts
    const life = sub(p, c.in, c.in + 0.10) * (1 - sub(p, c.out, c.out + 0.10));
    // measured: occlusion and off-screen are multipliers, never switches
    const vis  = (s ? 1 : 0) * (c.occluded ? 0 : 1);

    c.shown += ((life * vis) - c.shown) * (1 - Math.pow(1 - 0.18, dt * 60));

    if (c.shown < 0.004) { c.el.hidden = true; continue; }   // only now is it free
    c.el.hidden = false;
    c.el.style.transform =
      `translate3d(${s.x.toFixed(1)}px, ${(s.y - 14 * (1 - c.shown)).toFixed(1)}px, 0)`;
    c.el.style.opacity = c.shown.toFixed(3);
  }
}
```

The 14px rise scaled by `(1 - shown)` gives the label the same arrive-and-settle
shape as the geometry for one line of code. And the occlusion multiplier runs
through the same lerp, so a label passing behind the product fades over ~6 frames
instead of blinking - the difference between "it knows where the object is" and
"there is a bug".

Write `transform: translate3d(...)`, never `left`/`top`: a transform-only change
skips layout and paint when nothing else reads geometry, and `left`/`top`
cannot. (A 12-label micro-benchmark here was invalid - it forced layout every
iteration - so this rests on the mechanism, not on a number.)

## 8. 60 fps, in cost order

**1. Resize thrash - 17.5x, the biggest single measured hit.** Same scene, same
frame content:

```
setSize() + updateProjectionMatrix() every frame:  3.50 ms/frame
steady state, no resize:                           0.20 ms/frame
```

Every `setSize` reallocates the drawing buffer. A `ResizeObserver` that fires on
the mobile URL bar collapsing turns a 0.2 ms frame into a 3.5 ms frame, and on a
phone whose steady frame is already 8 ms that is straight past the budget.

```js
function resizeToDisplay(renderer, camera) {
  const c = renderer.domElement;
  const dpr = Math.min(devicePixelRatio, 2);
  const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
  if (c.width === w && c.height === h) return false;      // <- the whole optimisation
  renderer.setSize(c.clientWidth, c.clientHeight, false); // false: CSS owns the box
  camera.aspect = c.clientWidth / c.clientHeight;
  camera.updateProjectionMatrix();
  return true;
}
```

`setSize(w, h, updateStyle)` semantics, verified: `false` leaves `style`
untouched and lets CSS decide the element box; `true` writes inline
`800px × 500px` and fights your layout. `setPixelRatio(2)` then
`setSize(800, 500, false)` gives a 1600×1000 backing store. Always `false`.

**2. Material recompiles.** §3. On ANGLE/D3D11 this is the other unrecoverable
hitch, and it is invisible to a 1 Hz profiler. Watch
`renderer.info.programs.length`: if it grows after the loading state, something
in the scroll path is flipping a shader define.

**3. Shadow maps - exactly 2x triangle throughput.** One directional light,
one 12,800-triangle knot and a floor:

```
shadowMap.enabled = false     calls: 2   triangles: 12,802
shadowMap.enabled = true      calls: 3   triangles: 25,602
```

The default `light.shadow.mapSize` is 512 × 512, which looks like a 2008 game.
Making it acceptable means 2048² and 4x the shadow-pass fill. For a product page
on a plain ground, a baked contact-shadow plane - one transparent texture, two
triangles - looks better and is free. `PCFSoftShadowMap` is deprecated on
`WebGLRenderer` since r182; use `PCFShadowMap`, which is now soft.

**4. Draw calls, not triangles.** 200 boxes, identical geometry and material:

| approach | draw calls | triangles |
|---|---|---|
| 200 separate `Mesh` | **200** | 2,400 |
| one `InstancedMesh(geo, mat, 200)` | **1** | 2,400 |
| `mergeGeometries()` into one `Mesh` | **1** | 2,400 |

Identical triangles, 200:1 on calls. A marketing scene should be 1-8 draw calls.
The 12,800-triangle knot renders in one call at 0.1 ms - you can afford 200k
triangles long before you can afford 200 objects. `InstancedMesh` when the parts
move independently (`instanceMatrix.setUsage(THREE.DynamicDrawUsage)` and
`needsUpdate = true` if you write it per frame); `mergeGeometries` when they
never move relative to each other.

**5. Transmission.** §3. A second full opaque pass. Set
`transmissionResolutionScale = 0.5`.

**6. Per-frame allocation - 1.16x, smaller than the folklore.** 200,000
`new THREE.Vector3().normalize()` against 200,000 `.set().normalize()` on one
hoisted vector: 10.9 ms against 9.4 ms. V8's young-generation allocation is
nearly free and at a realistic 50-200 allocations per frame the throughput
difference is unmeasurable. **The real cost is the major GC the garbage
eventually triggers, which lands as one dropped frame at an unpredictable
moment.** So still hoist your scratch `Vector3`/`Quaternion`/`Matrix4` - but
because it removes a class of stutter, not because the arithmetic is slow. Do
not contort code to avoid one allocation; do avoid allocating in a loop that
runs per-part per-frame.

**Counters that need no timer, and catch the bugs that matter:**

```js
renderer.info.autoReset = false;  // then renderer.info.reset() to measure one frame exactly
renderer.info.render.calls        // under 8
renderer.info.render.triangles
renderer.info.programs.length     // must NOT grow during scroll
renderer.info.memory.geometries   // must NOT grow; dispose()
renderer.info.memory.textures
```

**Wall-clock `performance.now()` around `renderer.render()` is worthless.** WebGL
commands are queued to the GPU process and `gl.finish()` does not synchronise
them from JS - measuring that way gave 0.1-0.3 ms for every material, identical
for `MeshBasicMaterial` and a dispersive transmissive one. Use
`EXT_disjoint_timer_query_webgl2`, take the median, and discard frames where
`GPU_DISJOINT_EXT` is set. Every GPU-ms number in this file came from that.

## 9. Mobile, and the fallback

### DPR clamping is the whole game

| device | CSS px | raw DPR | pixels at raw | at 1.5 | at 1.0 |
|---|---|---|---|---|---|
| typical phone | 390 × 844 | 3 | 2,962,440 | 740,610 | 329,160 |
| typical laptop | 1440 × 900 | 2 | 5,184,000 | 2,916,000 | 1,296,000 |

A phone at raw DPR 3 shades 2.96 M pixels - 2.3x a 1440×900 laptop at DPR 1.5 -
on a GPU with a fraction of the throughput and a thermal budget measured in
seconds. Clamping to 1.5 cuts it 4x. That line is worth more than every other
mobile optimisation combined.

```js
const isPhone = matchMedia('(max-width: 768px), (pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(devicePixelRatio, isPhone ? 1.5 : 2));
```

Better: adapt live. Keep a rolling median of frame time and step DPR down one
notch (1.5 → 1.25 → 1.0) when it exceeds 20 ms for 30 consecutive frames. Step
down only, never oscillate - a DPR change is a `setSize`, which costs 3.5 ms.

### Adapt the choreography, do not just shrink it

1. **Fewer stages.** Four on desktop becomes two or three. A phone reader's
   scroll is a flick, not a wheel; a 400vh pin that takes 36 wheel notches takes
   one flick and a confused stop.
2. **Shorter runway.** Cut to 250-300% per stage.
3. **Reframe, do not rescale.** A 16:9 camera framing a wide assembly gives a
   postage stamp at 9:19.5. Raise the FOV, move the camera in, shift the model
   up so the callouts get the lower third. This is one `matchMedia` branch, and
   skipping it is the most common way a good desktop 3D page becomes an unusable
   phone page.

Branch with `gsap.matchMedia()`, which auto-reverts when a query stops matching,
including when the reader flips the OS reduced-motion switch mid-session.
`ScrollTrigger.matchMedia()` is deprecated.

### The rest of the mobile list

- **Transmission on a phone: don't.** 3x a bare physical material *and* a full
  second opaque pass. Swap the crystal for an opaque `MeshPhysicalMaterial` with
  high clearcoat and a fake fresnel rim, or set
  `transmissionResolutionScale = 0.25`.
- **Never build the PMREM on scroll.** Its first call is over a second here and
  worse on a phone.
- **`100svh`, never `100vh`.** The URL bar collapsing changes `vh` and triggers
  exactly the resize thrash above.
- **`renderer.setAnimationLoop(null)`** when the section leaves the viewport.
  A canvas rendering off-screen is pure battery.
- **`powerPreference: 'high-performance'`** on desktop only; on mobile it means
  nothing and on some devices costs you the low-power GPU.

UNVERIFIED: no phone, Apple GPU, Adreno or Mali was measured for this file. The
DPR arithmetic above is exact; the performance conclusions are inference from
desktop fragment costs plus pixel-count ratios.

### When to ship the sequence instead

Probe *before* committing to the 3D path, so nobody watches a 3D page fail -
they see the image sequence from the first frame.

- `navigator.connection?.saveData`, or `effectiveType` is `2g`/`slow-2g`.
- `prefers-reduced-motion: reduce` - ship a single still, not a sequence, and
  make sure the canvas draws one frame and **stops** (see §10).
- `getContext('webgl2')` returns null, or `WEBGL_debug_renderer_info` reports a
  software renderer.
- Startup probe: create the context, render 20 frames, and if the median exceeds
  ~22 ms at your chosen DPR, do not start.

`motion.md`'s canvas-image-sequence numbers are the fallback spec: 60-90 frames
at 1600px, 40-80 KB/frame WebP q70-80, 25-50px of scroll per frame, decoded
bitmap bytes `w × h × 4` (90 frames at 1600×900 is 518 MB, and iOS Safari
silently draws transparent canvases past ~384 MB), preload every 8th frame at
`fetchPriority: 'high'` and backfill at `'low'`, draw the nearest loaded frame
rather than a blank one, smaller folder for phones. One change for a 3D page:
the sequence and the scene should share the *same* progress function, so the
fallback has the same choreography and you author it once.

## 10. Measuring it

The repo already measures a running page. The command is:

```
node scripts/webdesign.mjs quality <dir|url> [--widths 1440] [--record MS] [--travel PX] [--json]
```

(`measure` is an alias for `quality`.) It renders the page twice at each width -
normal motion and `prefers-reduced-motion: reduce`, because reduced motion is a
requirement and not a variant - and reports:

| what it measures | how, and what it catches on a 3D page |
|---|---|
| frame rate | median and worst rAF interval over `--record` ms (default 1600). Budget 55 fps. |
| canvas liveness | downsamples every `<canvas>` to 16×16 at five points through the window and compares. Catches a canvas that repaints 60 times a second and paints the same thing - and a canvas that is **still animating under reduced motion**, which it reports as an error. |
| long tasks | a `PerformanceObserver` installed before the document runs. Budget 200 ms. This is what catches the PMREM bake. |
| idle libraries | asks the network log whether `three@` was fetched (three is an ES module behind an import map, so `window.THREE` does not exist), then whether any canvas actually has a webgl context. Loading three and not using it is reported by name. |
| transfer | total KB, script KB, the six heaviest requests. Budgets 500 KB script, 2500 KB total. |
| layout shift | CLS plus the elements that moved. |
| parallax rates | scrolls `--travel` px (default 700) and measures where each declared plane really went. `--expect-depth` makes a flat stack an error. |
| type | distinct computed sizes (budget 8) and measure in characters (45-80). |

Run it against the page you just built. Real output, from the proof page written
for this file - a deliberately minimal three@0.186.0 scene:

```
  1440px, normal motion
  ok    1 canvas is animating
  ok    frames cost 4 ms each (no vsync headless, so read the worst frame: 4 ms)
  warn  longest main-thread task 1065 ms
           the page cannot respond during it
  ok    392 KB over 4 requests, no idle libraries, no shift

  1440px, reduced motion
  ERROR 1 canvas still animating under prefers-reduced-motion
           draw one frame and stop
  warn  longest main-thread task 1114 ms
           the page cannot respond during it
  ok    392 KB over 4 requests, no idle libraries, no shift

  1 over budget, 2 worth looking at. Budgets: 55 fps, 500 KB of script, 8 type sizes.
```

Both findings are the two defects every 3D page ships with. The 1065 ms task is
the PMREM bake from §3, landing on the main thread exactly where §3 says it
will. The reduced-motion error is the scene ignoring the OS switch: under
`prefers-reduced-motion: reduce` a 3D hero renders one frame, calls
`setAnimationLoop(null)`, and stops.

Three notes on running it:

1. **It serves a directory.** Point it at the folder, not the `.html` - a file
   path is used as the server root and the request for `/` returns
   `ERR_HTTP_RESPONSE_CODE_FAILURE`.
2. **Headless Chromium does not lock rAF to a display**, so the fps number is
   the ceiling the work leaves room for, not the rate anyone sees. Read the
   worst frame.
3. **It is not a substitute for looking.** `node scripts/webdesign.mjs look <dir>
   --widths 1440,390` renders the page and reports console errors and exceptions
   (that is how the import map in §2 was proven), and `debug` builds the HTML
   review. The numbers catch the failures a screenshot cannot show; the
   screenshot is still the judgement.

For the GPU-side numbers in this file - per-material cost, recompile counts,
draw calls - there is no CLI. They come from `renderer.info` read in the page
and `EXT_disjoint_timer_query_webgl2` around `renderer.render()`, driven through
`scripts/inspect.mjs`, whose `findBrowser()`, `launch()` and `Session` are
importable and zero-dependency.
