# Imagery

Photography carries these pages. Read this when sourcing, grading, or building a
hero with no image at all.

## Sourcing, with exact URL formats

**Unsplash** - `images.unsplash.com` is imgix. Eight supported params: `w`, `h`,
`fit` (`crop`/`clip`/`max`), `crop` (`entropy`/`faces`/`edges`/`focalpoint`),
`auto` (`format`, `format,compress`), `q`, `fm`, `dpr`.

```
https://images.unsplash.com/photo-<id>?auto=format&fit=crop&w=1600&q=80
```

Quality: 80 hero, 60 background, 45 behind a heavy scrim. Licence: free,
commercial, no attribution required, no permission needed. Two hard gotchas:
`source.unsplash.com` was **switched off in June 2024** - do not use it; and
`images.unsplash.com` is **not canvas-safe**, so do all colour work in CSS or SVG
filters, never `getImageData()`.

**Pexels** -
`https://images.pexels.com/photos/{ID}/pexels-photo-{ID}.jpeg?auto=compress&cs=tinysrgb&w=1600`.
Free, commercial, no attribution.

**Wikimedia Commons** - the best source for archival and architectural register.

```
https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/File.jpg/1280px-File.jpg
```

The `4/46` hash is the first char and first two chars of `md5(filename)`. **Use
the cached width ladder - 250, 330, 500, 960, 1280, 1920, 3840** - off-ladder
widths trigger a cold render. `upload.wikimedia.org` sends
`Access-Control-Allow-Origin: *` so it *is* canvas-safe, but CORS does not
survive the `Special:FilePath` redirect. Commons permits hotlinking but files can
be renamed or deleted; mirror the bytes for anything you ship.

**Museum IIIF** - one URL crops, resizes, rotates and greyscales server-side:
`{server}/{id}/{region}/{size}/{rotation}/{quality}.jpg`, where `quality=gray`
gives free monochrome with no CSS filter and no repaint cost.
Art Institute of Chicago is the best of these:
`https://www.artic.edu/iiif/2/{id}/full/1686,/0/default.jpg`, CORS `*`,
60 req/min.

## One photograph into several planes

`webdesign.mjs cut <photo> [--out DIR] [--model isnet-general-use|u2net] [--alpha-matting]`

Runs rembg locally (ISNet by default, cleaner edges than u2net; `--alpha-matting`
for hair and foliage, slower). Writes the subject as a transparent PNG, the
background with the subject's hole dissolved into a blur so the cut-out can move
over it without a ghost, and the mask. The report says what share of the frame
the subject covers: **under 10% or over 90% means it found nothing usable** - a
photo that is all foreground (a field of grass, a wall of trees) has no subject
to cut, so pick another.

Composing the planes, the rules that matter:

- **Cut-outs rest on the bottom edge** (`align-self: end`, a small negative
  `margin-bottom`). A subject floating mid-frame with no ground under it reads
  as a collage, not a scene.
- **The sky lags, the subjects lead, the type sits between at page speed.**
  Positive `data-px` on anything behind the type, so it can only fall away;
  never a positive rate on something that starts below the headline.
- **One grade over all of them**: a warm floor, a cool ceiling, matched
  `brightness`/`saturate` on each plane so four photographs read as one hour of
  one evening.
- Sizes: a far subject small and dim (`width: 58%; brightness(.42)`), a near one
  large and warm (`width: 70%; brightness(.66)`), overlapping.

Pick photographs with a clean subject-to-sky edge for cutting: a house against
sky, a bridge against a valley, a figure against a wall. Verify every hotlink
with a HEAD request before it ships; the audit's `look` reports the ones that
fail to load.

## Grading in pure CSS

Put `filter` on the `<img>`, the tint on the wrapper's pseudo-element, and
**`isolation: isolate` on the wrapper** - without it the blend leaks to the page
background. This is the number one reason these recipes appear not to work.

```css
.grade { position: relative; isolation: isolate; overflow: hidden; }
.grade > img { width: 100%; height: 100%; object-fit: cover; }
.grade::after { content: ""; position: absolute; inset: 0; pointer-events: none; }
```

| Look | filter on img | tint on ::after |
|---|---|---|
| Cool film (architecture, product on stone) | `saturate(.68) contrast(1.08) brightness(1.02)` | `#0E1A2B` `soft-light` `.42` |
| Warm archival (heritage) | `sepia(.26) saturate(1.12) contrast(1.06)` | `#C9A227` `soft-light` `.20` |
| High-contrast mono | `sepia(.12) grayscale(1) contrast(1.32)` | - |
| Faded matte | `contrast(.86) saturate(.80)` | `#EFE7D8` `screen` `.10` |
| Blue hour | `brightness(.74) contrast(1.20) saturate(.78)` | `#0A1A3A` `multiply` `.38` |

Sepia *before* grayscale warms the midtones - that is what stops digital
monochrome looking like dead pixels. `brightness()` is multiplicative and
therefore **cannot lift blacks**; screen a light colour instead. Never
`hue-rotate` - it destroys skin and metal.

Blend modes: `multiply` tints shadows, `screen` lifts blacks, `soft-light` is the
safe editorial default, `color` gives true monotone with all tonality preserved,
`luminosity` puts photo structure over a flat brand colour.

`filter` creates a containing block for fixed descendants - keep it on the image,
never on the section.

## Duotone

```xml
<filter id="duo" color-interpolation-filters="sRGB">
  <feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0
                                       0.2126 0.7152 0.0722 0 0
                                       0.2126 0.7152 0.0722 0 0
                                       0      0      0      1 0"/>
  <feComponentTransfer color-interpolation-filters="sRGB">
    <feFuncR type="table" tableValues="0.047 0.788"/>   <!-- shadow/255 highlight/255 -->
    <feFuncG type="table" tableValues="0.039 0.635"/>
    <feFuncB type="table" tableValues="0.012 0.153"/>
  </feComponentTransfer>
</filter>
```

Use the Rec.709 luma weights, not a flat average, or skies go flat.
**`color-interpolation-filters="sRGB"` is mandatory** on both elements - SVG
filters default to linearRGB and the duotone comes out washed. Three or more
`tableValues` gives a tritone; `type="discrete"` gives hard bands.

CSS-only version, which also works on `<video>`: grayscale the image, then
`::before` with `screen` for highlights and `::after` with `multiply` for
shadows. Order matters - swap them and you get mud.

## Text on photography

`core.css` ships the eased 10-stop scrim. The shape is the point: **at the 50%
mark the alpha is only ~0.34, not 0.5.** A two-stop `rgba(0,0,0,.8) ->
transparent` gradient produces a visible Mach band. Write the zero-alpha stop as
your own colour at `/ 0`, never the `transparent` keyword, and tint the scrim
with the ink rather than pure black - black over a warm photo goes grey-green.

You never need more than **0.54 overlay opacity** for white text to reach AA
against any photograph.

Text shadow: the tell is a small offset with a small blur - that is a drop shadow
and reads as a slide deck. Use a zero-offset, very wide, very low-alpha ambient
halo, which is what `.on-media` does. Never exceed ~0.45 total alpha, never
offset more than 1px, never blur under 8px on the main pass. For a *paragraph*,
drop the shadow entirely and use `.on-media__block` (a local backdrop) instead.

Feather an image edge into the page:

```css
.fade-edge { mask-image: linear-gradient(to bottom, #000 62%, transparent 100%); }
```

## Responsive images

`srcset` gives the browser suggestions; `<picture>` gives it commands. AVIF
first, WebP second, JPEG on the `<img>`.

```html
<picture>
  <source media="(min-width:1024px)" type="image/avif" srcset="wide-1600.avif 1600w, wide-2560.avif 2560w" sizes="100vw">
  <source type="image/avif" srcset="tall-960.avif 960w" sizes="100vw">
  <img src="tall-960.jpg" width="960" height="1200" alt="" fetchpriority="high" decoding="sync">
</picture>
```

Generate at 640, 960, 1280, 1600, 1920, 2560. Zero-build art direction with
`object-position` alone is often enough - percentages are of the image, not the
box:

```css
.hero-img { aspect-ratio: 4/5; object-fit: cover; object-position: 62% 38%; }
@media (min-width:1024px) { .hero-img { aspect-ratio: 21/9; object-position: 50% 40%; } }
```

## A photographic hero with no image at all

Often better than a stock photo, because it is specific to the subject and weighs
nothing.

**Gradient-mesh sky.** Three rules separate "sky" from "SaaS blob": sizes over
100%, **off-canvas centres** (the sun is below the frame so you only see the
falloff), and ellipses wider than tall.

```css
.sky-dusk {
  background:
    radial-gradient(140% 90% at 50% 118%, #E8A24A 0%, #C2653C 16%, rgb(194 101 60 / 0) 46%),
    radial-gradient(120% 70% at 30% 104%, #8E4A63 0%, rgb(142 74 99 / 0) 55%),
    radial-gradient(150% 120% at 70% -20%, #16305C 0%, rgb(22 48 92 / 0) 62%),
    linear-gradient(to bottom, #0A1430 0%, #16305C 34%, #3B4C7A 58%, #8A6A70 78%, #C98B58 100%);
}
```

Keep every blob within `C 0.014-0.035` and `L 0.88-0.97` for a bone-palette mesh
- you should feel it, not see it. Use `in oklab` so the midpoints do not go grey.

**Layered SVG silhouette.** Identical viewBox on every layer,
`preserveAspectRatio="none"` so the horizon stretches, and **aerial perspective**
- each further layer sits closer to the sky colour. That one trick sells the
depth. Give each layer a different `data-px` and it becomes the parallax hero.

**Banding.** Two different bugs. A grey, muddy middle is a colour-space problem:
fix with `linear-gradient(in oklab, …)`. Contour bands are 8-bit quantisation and
**more colour stops do not help** - overlay 1-3% noise to dither the steps, or
rotate the gradient a few degrees off-axis (`175deg`, not `180deg`) to break the
band alignment. Assume any gradient over 800px with endpoints within ΔL 0.15
will band.

## Grain

`core.css` ships it. The parameters are not arbitrary:

- `type="fractalNoise"` - the default `turbulence` gives ripples, not grain.
- `baseFrequency` **0.8-0.95** with `numOctaves="4"` is 35mm. 0.55 is pushed
  400-speed film; 1.2+ is digital sensor noise and reads cheap on a warm palette.
- `stitchTiles="stitch"` or you get a visible seam every tile.
- **`feColorMatrix type="saturate" values="0"`** - raw `feTurbulence` output is
  *coloured* RGB speckle. This is the most-missed step, and skipping it is
  exactly what "reads as dirt" means.

Opacity: **0.055 `multiply` on bone, 0.13 `overlay` on ink.** Dark grounds
swallow grain at roughly 2.3x. Over a photograph, 0.03-0.06. Below 4% it is
imperceptible; above 12% it competes with the content.

`feTurbulence` is CPU-rasterised. Never apply it as a live `filter:` to a
scrolling container - rasterise once into a tile and let the compositor repeat
it, which is what the data-URI in `core.css` does.

## Technical drawings

The blueprint section is hand-written SVG. What makes it read as a real drawing:

**Two line widths, ratio 2:1** (ASME Y14.2: 0.3mm thin, 0.6mm thick). Thick =
visible object outline. Thin = hidden, centre, dimension, extension, leader,
hatch.

**Never paint any line at full black.** The alpha ladder is the single thing that
separates a technical drawing from clipart:

| Element | stroke-opacity | width |
|---|---|---|
| Object outline | 0.88 | 2 |
| Hidden | 0.50 | 1 |
| Centre / phantom | 0.45 | 1 |
| Dimension / leader | 0.65 | 1 |
| Section hatch | 0.30-0.45 | 0.75 |
| Grid minor / major | 0.05 / 0.11 | 0.5 / 0.8 |

On a dark ground add ~0.10 to each.

**The 0.5-coordinate rule.** Strokes are centred on the path, so a 1px stroke at
`y=100` splits across two device rows and blurs. A stroke is crisp when
`stroke-width x DPR` is **even** at integer coordinates and **odd** at `.5`
coordinates. So 1px and 3px go at `y = 100.5`; 2px and 4px go at `y = 100`. Nudge
only horizontal and vertical lines - never circles or diagonals.

**Dash patterns.** Odd value counts repeat the whole list (`5 5 1` becomes a
cycle of 18, not 11). With `stroke-linecap="round"` every dash grows by the
stroke width and every gap shrinks by it, so an ISO centre line is a *zero-length*
dash with pre-compensated gaps:

| Line | dasharray | cap |
|---|---|---|
| Hidden | `12 3` | butt |
| Centre | `24 3.5 0 3.5` | round |
| Phantom | `24 3.5 0 3.5 0 3.5` | round |
| Construction | `6 6` | butt |

Force a centre line to begin and end on a long dash by setting `pathLength` to a
whole multiple of the cycle (cycle 30 -> `pathLength="300"`).

**Markers.** `markerUnits` defaults to `strokeWidth`, so `markerWidth="10"` on a
5-unit line renders 50 units wide. **Use `userSpaceOnUse`** or your arrowheads
scale with line weight, which is wrong per every drafting standard.
`orient="auto-start-reverse"` lets one marker serve both ends.

**Hatching.** `patternUnits` defaults to `objectBoundingBox`, so `width="6"` means
six times the bounding box and the hatch vanishes. **Always
`patternUnits="userSpaceOnUse"`.** Keep the tile axis-aligned and rotate with
`patternTransform` - that is the only version that tiles seamlessly. Adjacent
parts in a section must use different angles (45 / -45 / 30); the same angle
across a joint is the mark of an amateur drawing. On screen, 6-unit pitch,
0.75 stroke, 0.45 opacity.

**Draw-on animation.** Use `pathLength="1"`, not `getTotalLength()` - the same
path has been measured at 181.81 in Chrome and 153.28 in Firefox.

```css
.draw { stroke-dasharray: 1; stroke-dashoffset: 1;
        animation: draw 1100ms cubic-bezier(.16,1,.3,1) both;
        animation-delay: calc(200ms + var(--i, 0) * 90ms); }
@keyframes draw { to { stroke-dashoffset: 0; } }
```

Every path takes the same two values regardless of length. Stagger 90-130ms.
A sequence that reads as "being drafted": grid 0ms, outline 200, hidden 900,
centre 1050, hatch 1250, dimensions 1500, numerals 1750 - about 2.1s total. Past
2.5s reads slow, not luxurious. Never `linear` on the outline; that is a loading
spinner. Under reduced motion, jump to the **finished** state, not the hidden one.

`pathLength` normalises all dash maths on that element, so you cannot combine a
draw-on with an ISO dash pattern on the same path - mask it instead.

Blueprint palette: Prussian blue `#003153` (the actual cyanotype pigment),
engineer blue `#1E4E7C`, technical navy `#0A192F`. A real cyanotype is white
lines on saturated blue - the drawing is the unexposed area.
