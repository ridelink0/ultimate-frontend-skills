# Generated imagery, materials and light

Everything that is not a photograph: measured PBR material sets, environment
lighting, and images a model made up. Photography sourcing, CSS grading,
duotone, scrims and grain are in `references/imagery.md` - this file does not
repeat them.

The short version: a surface that has to be lit wants a **measured** material,
which is free and CC0 and takes one command. An image a model generated has its
lighting painted into the pixels and cannot be lit at all. Most of the mistakes
here come from asking a generator for the first thing.

## What you need, and where it comes from

| You need | Go to | Key | Command |
|---|---|---|---|
| A photograph | Unsplash, Pexels, Wikimedia, museum IIIF | no | `references/imagery.md` |
| A surface that must respond to light | **Poly Haven**, then ambientCG | no | `assets textures <slug> --res 1k` |
| Light for a 3D scene, cheapest possible | `RoomEnvironment` - 4960 bytes of JS, no image, no network | no | see below |
| Light with a specific mood or a visible sky | Poly Haven HDRI | no | `assets hdri <slug> --res 1k` |
| A 3D model to start from | Poly Haven models (CC0 glTF/blend) | no | `assets search <query>` |
| A cut-out subject on transparency | a photograph plus rembg, locally | no | `webdesign.mjs cut <photo>` |
| A depth map for parallax | Depth Anything V2 **Small** | no | see the licence trap below |
| An illustration or plate that does not exist as a photograph | generation, ranked below | it depends | `assets gen "<prompt>"` |
| An object in a lit 3D scene | never a generated image. Geometry plus a measured material | no | `references/three.md` |

`assets` is `node scripts/assets.mjs`, also reachable as `webdesign.mjs assets`.

## The two CC0 libraries

Both are genuine CC0 1.0, both are key-free, and neither wants attribution on
the assets. Counts measured on 2026-09-14.

| | Poly Haven | ambientCG |
|---|---|---|
| Catalogue | 860 textures, 995 HDRIs, 521 models | 2010 materials, 427 HDRIs |
| API | `api.polyhaven.com`, JSON, `ACAO: *` | `ambientcg.com/api/v2/full_json`, JSON |
| Delivery | **one file per map**, hotlinkable, `ACAO: *` | **zip only**, one per resolution and filetype (`1K-JPG` ... `16K-PNG`) |
| Integrity | md5 per file in the manifest | none published |
| Packed ARM map | yes | no |
| Real-world tile size | millimetres, in `/info` | centimetres, often 0 |
| Licence page | polyhaven.com/license | docs.ambientcg.com/license |

Poly Haven is the default. ambientCG is the second look when Poly Haven has
nothing for the surface - its catalogue is more than twice the size and it has
materials Poly Haven does not.

```
GET https://api.polyhaven.com/types                     -> ["hdris","textures","models"]
GET https://api.polyhaven.com/assets?type=textures       -> { id: metadata, ... }
GET https://api.polyhaven.com/info/{id}                  -> one asset, 404 if absent
GET https://api.polyhaven.com/files/{id}                 -> THE DOWNLOAD MANIFEST
```

`/files/{id}` is shaped `map -> resolution -> format -> {size, url, md5}`, with
resolutions `1k 2k 4k 8k` and formats `jpg png exr`. The URLs are regular enough
to look derivable. **Do not derive them.** Assets are missing maps, and the
manifest is the only statement of what is actually there. Across a stratified
sample of 100 of the 860 textures: every one carried `arm` and `nor_gl`, 99
carried `Displacement` (`fabric_pattern_07` does not), and only 5 carried
`Metal` - it exists on metals and almost nowhere else. The md5 in the manifest
matches the bytes you get, so use it: `assets textures` verifies every file and
prints `md5 ok`.

ambientCG's search is a plain query parameter and its downloads are inside
`downloadFolders.default.downloadFiletypeCategories.zip.downloads[]`, each
`{fullDownloadPath, fileName, size, attribute}` with `attribute` like `1K-JPG`.
There is no per-map URL at all, so `assets textures` downloads the archive and
unpacks it with `zlib` rather than leaving you a zip.

### The Poly Haven API clause almost nobody reads

The assets are CC0 with no attribution, ever. The **live API** is a separate
thing with its own terms, sent as a `Terms-Of-Service:` response header:

- **2.4** - every call must carry a `Referer` or user-agent naming your software.
  A default `fetch` user-agent is out of compliance. `assets.mjs` sends
  `ultimate-frontend-skills/<version> (+repo url)`.
- **2.5** - if you surface Poly Haven content through the live API, say so
  visibly. This lands on the **tool**, not on the site you build. The website
  ships downloaded CC0 files and owes nothing; the credit belongs in the CLI's
  own output, which is where it is.

### Sources not to use

- **ShareTextures** calls itself CC0 in its marketing, its titles and its
  metadata. Its actual licence page, `sharetextures.com/p/license`, says "Custom
  CC0 (Creative Commons Zero) license with specific restrictions", and the
  restrictions include **no automated downloads, hotlinking, or embedding direct
  downloads in third-party apps**, and no redistribution. An agent fetching it is
  explicitly prohibited. This is the trap case: the homepage is never the licence.
- **cgbookcase** - UNVERIFIED. The site is up but `/license`, `/about` and `/faq`
  all 404 and nothing on it states a licence. The only CC0 strings on the
  homepage are outbound links to CC0 Textures, not a claim about its own assets.
  Do not treat it as CC0.
- **3dtextures.me** is real CC0 - stated at `3dtextures.me/about/`, not at a
  `/license` path - but it is a WordPress blog with no API and per-post zips.
  Fine for a human, not worth automating.
- `cc0textures.com` 301s to ambientCG and `hdrihaven.com` 302s to Poly Haven.
  They are the same two libraries under old names, not extra sources.

## Wiring a material into three.js

The two libraries disagree about every map name, and three.js agrees with
neither. `assets textures` normalises the filenames on the way in, so the slug
plus a slot suffix is what lands on disk.

| Poly Haven | ambientCG | written as | three.js slot | colorSpace |
|---|---|---|---|---|
| `Diffuse` | `Color` | `<slug>_color.jpg` | `map` | `SRGBColorSpace` |
| `nor_gl` | `NormalGL` | `<slug>_normal.jpg` | `normalMap` | leave default |
| `nor_dx` | `NormalDX` | not downloaded | - | - |
| `arm` | - | `<slug>_arm.jpg` | `aoMap` + `roughnessMap` + `metalnessMap` | leave default |
| `Rough` | `Roughness` | `<slug>_rough.jpg` | `roughnessMap` | leave default |
| `AO` | `AmbientOcclusion` | `<slug>_ao.jpg` | `aoMap` | leave default |
| `Metal` | `Metalness` | `<slug>_metal.jpg` | `metalnessMap` | leave default |
| `Displacement` | `Displacement` | `<slug>_disp.jpg` | `displacementMap` | leave default |

**Only the colour map is sRGB.** Every other map is data - a direction, a
number - and tagging it sRGB applies a transfer curve to a measurement. It looks
subtly wrong and it is very hard to diagnose.

```js
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const SPAN = 4;          // metres across the surface you are covering
const TILE = 1.8;        // wood_floor_deck is 1800 x 1800 mm in the real world
const REPEAT = SPAN / TILE;

const load = (file, srgb = false) => {
  const t = loader.load(file);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(REPEAT, REPEAT);        // repeat does NOT propagate between maps
  return t;
};

const arm = load('img/mat/wood_floor_deck_arm.jpg');   // AO in .r, rough in .g, metal in .b
const material = new THREE.MeshStandardMaterial({
  map:       load('img/mat/wood_floor_deck_color.jpg', true),
  normalMap: load('img/mat/wood_floor_deck_normal.jpg'),
  aoMap: arm, roughnessMap: arm, metalnessMap: arm,
  roughness: 1, metalness: 1,
});
```

`assets textures` prints this material, filled in for the asset you fetched,
including the real tile size from the manifest, plus the two footnotes below it.

**ARM is three downloads collapsed into one.** three.js reads `aoMap` from red,
`roughnessMap` from green and `metalnessMap` from blue, in the shader chunks
themselves, so one image feeds all three slots. Measured on `wood_floor_deck` at
1k: AO plus roughness as separate files is 1.21 MB and gives you no metalness;
the ARM map is 703 KB and gives you all three. Poly Haven ships one for every
texture in a 100-asset sample; ambientCG never does.

**`nor_gl`, never `nor_dx`.** three.js, glTF and OpenGL all want green-up.
DirectX convention is green-down and using it silently inverts lighting on one
axis, which reads as "the light is coming from the wrong side" and almost nobody
spots it as a texture problem.

### Eight things that go wrong, concretely

1. **`RGBELoader`.** It has been a 268-byte deprecation shim since r180 - it
   extends `HDRLoader`, warns, and does nothing else. Use `HDRLoader`, which is
   the real 12 KB implementation. Every tutorial online still says RGBELoader.
2. **Forgetting `colorSpace = SRGBColorSpace` on the colour map.** Everything
   looks washed out, and the usual "fix" is cranking the lights, which makes it
   worse.
3. **Setting sRGB on the normal, roughness or AO map.** See above.
4. **Grabbing `nor_dx`.**
5. **Adding a `uv2` attribute for `aoMap`.** Obsolete. The renderer reads
   `material.aoMap.channel`, which defaults to `0` - the ordinary `uv`. Copying
   `geometry.setAttribute('uv2', geometry.attributes.uv)` out of an old tutorial
   is harmless and pointless.
6. **Setting `repeat` on `map` only.** Every texture object carries its own
   transform. Set it on all of them, or one map tiles and the rest stretch.
7. **`roughness: 1, metalness: 1` with no metalness map.** The scalars
   *multiply* the maps, so 1 is the only value that leaves a map alone - but a 1
   with no `metalnessMap` present makes a plank of wood a mirror. With no
   metalness map, metalness is 0.
8. **`displacementMap` on an unsubdivided plane.** It moves vertices that exist.
   `PlaneGeometry(w, h)` has four. Subdivide to 256x256 or, on the web, drop it
   and let the normal and AO carry the relief.

Tiling by eye is the other quiet one. The manifest publishes the real-world tile
size in millimetres - a 1.8 m deck board across a 4 m floor is `repeat` 2.22, not
a number you guessed.

## Environment lighting

An equirectangular HDR cannot be assigned to `scene.environment` and work. PBR
needs a prefiltered roughness mip chain, which is what `PMREMGenerator` builds.

**`RoomEnvironment` is the default and it costs almost nothing.** It is 4960
bytes of geometry and emissive materials - no image, no network, no CORS - and
PMREM turns it into a clean neutral studio IBL.

```js
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

scene.environment = new THREE.PMREMGenerator(renderer)
  .fromScene(new RoomEnvironment(), 0.04).texture;
```

`RoomEnvironment` is an addon, not a `THREE.*` export - without that import the
line is a `ReferenceError`.

Reach for a real HDRI only when the environment is meant to be *seen*, or when
the scene needs a specific time of day. For "make the metal look like metal",
`RoomEnvironment` is already right.

```js
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();      // pay the shader cost before first use
new HDRLoader().load('img/env/blocky_photo_studio_1k.hdr', (hdr) => {
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  hdr.dispose();
  pmrem.dispose();
});
```

"1k" for an HDRI means **1024 x 512** equirectangular, not a square.

## Budgets, measured

`wood_floor_deck`, jpg, straight from Poly Haven. The trio is colour + `nor_gl` +
ARM, which is the smallest genuinely complete material.

| Resolution | colour | normal | ARM | trio total |
|---|---|---|---|---|
| 1k | 904 KB | 650 KB | 703 KB | **2.20 MB** |
| 2k | 3.63 MB | 2.98 MB | 3.04 MB | **9.64 MB** |
| 4k | 13.99 MB | 12.79 MB | 12.46 MB | **39.25 MB** |
| 8k | 47.77 MB | 45.54 MB | 42.96 MB | **136.27 MB** |

These are archival-quality JPEGs and none of those numbers is a web asset.
**Re-encode.** Measured here with libwebp at q82: the `wood_floor_deck` 1k trio
goes from 2.20 MB to 338 KB, a 6.7x cut. The normal map survives it - angular
deviation against the source averages 1.8 degrees on `wood_floor_deck`'s
`nor_gl` and 1.0 degrees on `concrete_wall_008`'s, with 99th percentiles of 6.8
and 5.1 degrees. That is invisible in a lit render, but it is not lossless:
lossy WebP is always YUV420, so the X and Y in the red and green channels get
chroma-subsampled. If a normal map ever has to be exact, encode that one
lossless. Go to 2k only for a hero surface the visitor will be nose-to-nose
with.

HDRI, `blocky_photo_studio`:

| Resolution | .hdr | .exr |
|---|---|---|
| 1k | 1.52 MB | 1.17 MB |
| 2k | 5.96 MB | 4.36 MB |
| 4k | 23.37 MB | 16.54 MB |
| 8k | 90.53 MB | 63.20 MB |

.exr is 23-30% smaller but needs the 86 KB `EXRLoader` against `HDRLoader`'s
12 KB, and RGBE is fine for lighting. **1k .hdr is the ceiling for a runtime
fetch. Never ship 4k+ to a browser; 23 MB for lighting is indefensible.**

**UltraHDR is the real answer if you can run a build step.** `UltraHDRLoader`
(19696 bytes at three 0.185.1) reads a JPEG carrying an SDR base image plus a
gain map and yields a `HalfFloatType` texture. The files shipped in the three.js
repo: `spruit_sunrise_2k.hdr.jpg` is **470493 bytes** and
`spruit_sunrise_4k.hdr.jpg` is **1786249 bytes** - a 4K environment for 1.79 MB
against 23.37 MB for a 4k `.hdr`. Poly Haven does not serve UltraHDR (`hdr` and
`exr` only), so the pipeline is: fetch the `.hdr` at build time, convert, ship
the `.jpg`. The conversion tool named in UltraHDRLoader's own source is
https://gainmap-creator.monogrid.com/.

Poly Haven's `tonemapped` sibling file is a full-resolution LDR JPEG - 28.5 MB
for `blocky_photo_studio`. It is not UltraHDR and it is useless as an IBL.

## Generating an image

Ranked. `assets gen "<prompt>"` walks this ladder against the machine it is
running on and prints where you actually are. It never invents a key and never
posts to an endpoint it has no credential for.

| Rank | Route | Key | What you get |
|---|---|---|---|
| 1 | An image-generation tool already in **your own tool list** | user's | the provider they chose and pay for |
| 2 | A provider whose key is already in the environment | yes | use that provider's own SDK or MCP server |
| 3 | A local generator answering on 127.0.0.1 | no | whatever is installed |
| 4 | pollinations.ai | no | 768px JPEG, one model |
| 5 | No image | - | frequently the right answer |

**Rank 1 is not a formality.** A CLI cannot see the agent's tool list, and a
plugin that ignores an attached image tool to curl a public endpoint produces a
worse image and looks broken. Check for a tool matching `*generate_image*`,
`*image_generation*` or `*text_to_image*` before anything else. If it has a
required argument you cannot supply, resolve it through that server's own
discovery tool rather than guessing, and assume submit-then-poll unless the
schema says otherwise. An attached MCP tool is a stated preference; a hardcoded
HTTP call is a guess.

**pollinations.ai**, the only key-free HTTP route left standing, measured here:

```
GET https://image.pollinations.ai/prompt/{urlencoded}?width=768&height=768&nologo=true
```

It returns `image/jpeg` whatever extension you ask for. It **silently
downscales** - request 1024x1024 and a 768x768 file comes back, no error. The
`model` parameter is ignored unauthenticated: `/models` returns exactly
`["sana"]`, so every blog telling you to pass `model=flux` for free is stale.
Latency swung between 2.9 s and 44 s for the same 768px request on this machine.
JPEG means no alpha, so a generated "object" is not usable as a foreground plane
until `webdesign.mjs cut` has taken the background off. Its output licence is
**UNVERIFIED**: `pollinations.ai/terms` exists but renders only under
JavaScript, so its position on generated output was not read, and the MIT licence
in its repository covers the code, not the images. Keep it off paying client
work.

Every key-gated free tier was probed anonymously and refuses: Cloudflare Workers
AI 404 (the account id is in the path), Hugging Face 401 on
`router.huggingface.co` (the old `api-inference.huggingface.co` no longer
resolves at all), Together 401, Google AI Studio 403, Replicate 401. Cloudflare
publishes a free allocation of **10,000 Neurons per day** with
`@cf/black-forest-labs/flux-1-schnell` at **4.80 neurons per 512x512 tile**,
which is the only current free-tier number verified from a primary source here.
The others are UNVERIFIED and must not be quoted.

Local weights, single-file sizes from the HuggingFace API, in the decimal GB the
HuggingFace UI itself shows:

| Model | Licence | Gated | One file |
|---|---|---|---|
| FLUX.1-schnell | apache-2.0 | yes (`auto`) | 23.78 GB |
| SDXL-Turbo fp16 | `other` - `sai-nc-community` | no | 6.94 GB |
| Depth-Anything-V2-**Small** | apache-2.0 | no | 0.10 GB |
| Depth-Anything-V2-Base / Large | **cc-by-nc-4.0** | no | 1.34 GB (Large) |

**SDXL-Turbo output is not free for commercial work** - its card sends you to
`stability.ai/membership` for commercial use. FLUX.1-schnell is genuinely
Apache-2.0 but gated behind an account and 24 GB. Neither is a reasonable default
for building a website; they are something a user opts into, not something to
install mid-build.

## The relighting problem

A generated image has its lighting **baked into its pixels**. Ask for a bronze
statue and you get a statue already lit from a direction the model chose, with
its highlights, shadows and occlusion painted in. Put that in a scene with its
own HDRI and two lighting solutions fight: the painted highlight sits still while
the real specular moves across it. No post-process fixes this, because the
information - what the surface looks like under different light - was never
captured.

Three workarounds, in order of honesty.

1. **Prompt for flat light.** "Flat even studio lighting, no cast shadows, no
   strong directional highlight, neutral grey background" gets you something
   closer to an albedo. Highest leverage, costs nothing, do it every time.
2. **Match the scene to the image, not the image to the scene.** If the plate is
   lit from upper-left, pick and orient an HDRI lit from upper-left. It is
   cheating and it reads correctly.
3. **Use it as a flat plane or a parallax layer.** If it never has to respond to
   moving light, baked lighting is an asset rather than a problem. This is what
   `depth.js` and the cut-out planes already do.

And the rule underneath all three: **anything that must be lit gets a measured
material.** There are 860 textures on Poly Haven and 2010 on ambientCG, free, in
one command.

### Deriving normals from a flat albedo does not work

The standard advice is to take luminance as height, Sobel it, and call the result
a normal map. Measured against ground truth - Poly Haven ships a real
photogrammetry `nor_gl` for `concrete_wall_008`, so the derived map can be
compared to the true one as mean angular error. Method, so it can be re-run:
Rec.709 luminance of the 1k `Diffuse` as height, a 3x3 Sobel divided by 6,
normal = normalize(-gx * strength, +/- gy * strength, 1), compared against the
decoded `nor_gl`. The sign on gy is the whole GL-versus-DX question again, so
both are reported. "Detail" is the 0.6% of pixels where the true normal is more
than 10 degrees off flat.

| Method | all px, GL | all px, DX | >10 deg, GL | >10 deg, DX |
|---|---|---|---|---|
| Flat map - do nothing | 1.06 | 1.06 | 15.17 | 15.17 |
| Derived, strength 2 | 1.88 | 2.11 | **12.74** | 16.46 |
| Derived, strength 5 | 4.13 | 4.43 | **13.04** | 20.37 |
| Derived, strength 8 | 6.47 | 6.79 | 16.05 | 25.05 |
| Derived, strength 15 | 11.69 | 12.02 | 24.73 | 35.02 |
| Derived, strength 30 | 21.20 | 21.54 | 38.93 | 49.64 |

**Over the map as a whole, at every strength and under either sign convention,
the derived normal is further from the truth than doing nothing**, and the error
grows monotonically. That is the number that governs how the surface reads,
because 99.4% of the wall is close to flat and the derived map puts invented
relief across all of it.

The detail column is the honest qualifier. Get the green sign right and a *weak*
derived map - strength 2 to 5 - is a couple of degrees closer than flat on the
pixels that genuinely have relief. Get it wrong, or push the strength past 8, and
it is worse on both counts. So the most a derived normal can buy is a small
improvement on 0.6% of the pixels, bought by degrading the other 99.4%, and only
if the convention happens to match.

The mechanism is the point: **albedo-derived normals recover pigment, not
geometry**. A stain on flat concrete becomes a dent. A painted line becomes a
groove. The method cannot tell "darker because it faces away from the light" from
"darker because it is a different colour", and on real materials most darkness is
the second thing.

So call it what it is: a **stylistic** effect that adds plausible surface noise.
It looks fine where darkness genuinely correlates with depth - rough stone, bark,
woven fabric - and wrong on anything printed, painted or stained. Derive only
when the surface is generated and has no measured counterpart. Materialize,
AwesomeBump, NormalMap-Online and twenty lines of numpy all implement the same
luminance-gradient method and all inherit the same limitation. The tool is not
the problem; the premise is.

Roughness-from-inverted-luminance and AO-from-darkened-luminance are the same
fallacy one step further. They at least fail gracefully, because the eye is far
less sensitive to wrong roughness than to wrong normals.

**Depth is different.** Relative depth ordering *is* recoverable from a single
image in a way that surface micro-normals are not, so Depth Anything V2 for
parallax and layering is sound - that is what `data-depthmap` in `depth.js`
consumes. Use the **Small** variant: it is Apache-2.0 at 99 MB, where Base and
Large are CC-BY-NC-4.0 and cannot go near paying client work.

## Licence discipline

1. **Read the licence page, not the marketing copy.** ShareTextures says CC0 in
   its slogan, its titles and its schema.org metadata, and forbids exactly what
   an agent would do. The homepage is never the source of truth.
2. **Asset licence and API terms are different obligations on different
   artifacts.** Poly Haven's assets are CC0 with no attribution ever; its live
   API wants a naming user-agent and a visible credit in the software. The credit
   goes in the tool, not in the client's footer.
3. **Check model licences per variant, not per family.** Depth Anything V2 Small
   is Apache-2.0 and Base and Large are CC-BY-NC-4.0. "Open weights" is not
   "free to use commercially".
4. **Know who owns generated output.** The provider's terms govern it. An
   unverified output licence - pollinations - does not go on a client site.
5. **Prefer CC0 for anything that ships.** Poly Haven and ambientCG are both
   CC0 1.0 from their own licence pages. That is the whole reason to prefer them
   over sources that are merely free.
6. **Record provenance.** `assets textures` and `assets hdri` write a
   `<slug>.provenance.json` next to the files with the source, the author, the
   licence, the URLs and the md5s, because the person answering "where did this
   texture come from" in eighteen months is not the agent that downloaded it.
7. **Redistribution is a per-source question, and the CC0 two say yes.** Poly
   Haven's licence page says "You can redistribute them"; 3dtextures.me says the
   same. ShareTextures forbids it without written permission. What is not
   permitted anywhere is scraping a whole catalogue: Poly Haven ToS 2.6 rules out
   anything that degrades the API for other users, and a bulk mirror is exactly
   that. Take the assets a page needs, not the library.
