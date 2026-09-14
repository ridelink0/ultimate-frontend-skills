---
name: ultimate-frontend-skills
description: Use whenever a website, landing page, marketing site, portfolio, microsite, homepage, or any public-facing web page is being built, redesigned, restyled, or made to "look better" - including plain HTML/CSS pages, Next/React/Astro sites, and single-file pages. Supplies the house style (editorial serif typography, warm-neutral and near-black grounds, cinematic imagery, layered scroll parallax, exploded technical views) plus a copy-in CSS chassis, a motion runtime, a section library, a scaffolder, and an audit.
---

# Ultimate Frontend Skills

The studio's house style, and the code that produces it. This is a pinned art
direction for projects without an existing design. A supplied or selected Claude Design project takes precedence.

## Rule zero

**Nothing about the design goes in your reply.** No palette, no type scale, no
tokens, no section list, no "I chose a warm bone ground because...", no design
vocabulary at all. Build the files. Then say what you made in one or two plain
sentences and give the paths. If they want the reasoning, they will ask for it.

Never use emoji - not in the page, the copy, the commit, or the reply. Icons are
inline SVG.

For Claude Design work, first read `references/claude-design.md`, then run
`node "${CLAUDE_PLUGIN_ROOT}/scripts/design.mjs" detect` rather than assuming a route.
On a current Claude Code build Claude Design arrives as the built-in `design` canvas
skill and the native `DesignSync` tool, neither of which is an MCP server; the HTTP MCP
server is for hosts that need it (Codex among them). `detect` only reports - never
register, consent or log in on the user's behalf, and never report a remote Design
operation as successful without its actual result.

Keep a supplied design's direction intact; otherwise proceed with the local house style
without a separate approval pass.

For website debugging or final verification, read references/visual-debug.md. Run the rendered debug command and actually open its PNGs before declaring the visual check complete.

## Fix three things before you type

Hold these in your head, not on the screen: **the subject** (the actual thing,
named concretely), **the register** (is this an object, a place, a service, or
an argument), **the hero** (what the first screen shows). If the brief truly does
not say what the subject is, ask one question. Otherwise decide and go.

## Build

If a Claude Design handoff exists, implement it in the current project and use the checks
below; do not scaffold over it. The scaffold is for a new site without a supplied design.

Preserving a supplied design is now measurable, not just instructed:
`node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" verify <dir> --design <seeded canvas>.html`
compares the built page against the artboards through the same probes - type sizes,
palette, vertical rhythm, content geometry - and raises an ERROR when the type scale and
the palette are both absent from the design, which is what overwriting one looks like.
Hand it a seeded canvas page or a plain HTML rendering of the design; a bare `.dc.html`
is not a renderable page and parity refuses it.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" new <dir> \
  --preset bone --name "Subject Name" \
  --sections nav,hero-photo,manifesto,services,stats,faq,contact,footer
```

That writes `index.html`, `core.css`, `motion.js`, `site.css`, `netlify.toml`.
Then, in order:

1. **Rewrite every word.** Placeholder copy left in a page is a bug, and the
   audit fails on it. Write the real thing: concrete nouns, no adjectives a spec
   sheet would not use, no "elevate/seamless/unlock/transform".
2. **Set the hero image**, then set `--accent-h` in `site.css` to the hue of the
   subject's own material in that image (see `references/imagery.md`).
3. **Add the signature** - one element this page is remembered by, drawn from the
   subject's own world. One. Everything else stays quiet.
4. **Audit the source**:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" audit <dir>` - must exit 0.
5. **Then render it and look**:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" look <dir>`
   This is not optional. It opens the page in a real headless browser at 1440
   and 390, reports text overlapping text, content past the viewport, contrast
   against the actual painted background, collapsed elements and broken images -
   none of which the source can tell you - and writes a PNG at each width.
   **Read the PNGs.** A layer covering half the composition passes every static
   check ever written. The only way to know a page looks right is to look at it.

Other commands: `sections` lists the library, `add <id> --to <file>` inserts one,
`serve <dir>` previews at localhost.

**No Node, or a framework project?** Copy `assets/core.css` and `assets/motion.js`
in as-is and take blocks out of `assets/sections.html` by hand. Everything works
as plain files; the script only saves typing. In React/Astro, import `core.css`
globally and translate the section markup to components - keep the class names.

## The rules that do the work

1. **One serif family, two optical sizes.** `opsz 72 wght 320` for display and
   `opsz 16 wght 400` for body of the *same* family beats any pairing. Default is
   Newsreader. Avoid Instrument Serif and Playfair Display - both now read as
   machine-made. See `references/typography.md` before choosing anything else.
2. **Display line-height under 1.0, tracking at or under -0.024em.** These two
   numbers separate editorial from blog more than the typeface does.
3. **`max-width: 16ch` on the hero headline.** Forcing it onto three lines is what
   creates the negative space. A one-line hero cannot look expensive.
4. **Never `#fff`, never `#000`, never a zero-chroma grey.** Every neutral sits in
   hue 60-95. One accent, visible on at most three elements in the whole page.
5. **Leave real air, and vary it.** A template pads every section to 40px; this
   one starts at 80 and runs to 160. But the tell is not the amount, it is the
   sameness - a page where every section has identical padding reads as
   generated. Give a dense table less and the section after a full-bleed image
   more. `--section-y` is the floor and `.section--tight` exists for this.
6. **Grain is always on.** `<div class="grain">` before `</body>`. If you can see
   it, it is too strong.
7. **Depth comes from layers, not effects.** One parallax relationship in the
   hero and, where the subject is a made thing, one exploded view. Both are the
   same mechanism: stack elements in one grid cell, give each a different
   `data-px`, let scroll pull them apart. No 3D engine, no library.
8. **Motion earns its place.** Reveal on enter (`.r`), the one parallax, nav
   shrink, and the page's single orchestrated moment. Nothing else unless the
   subject asks for it - scattered effects read as generated.
9. **One italic accent phrase per page.** `Descent is gravity. *Ascent* is
   arithmetic.` is the house voice and also the most imitated headline device
   on the web right now. One is a voice. Four is a costume, and the audit fails
   the build at two.
10. **Never invent a specific.** No made-up customer count, uptime figure,
   review score, licence number, years-in-business, testimonial or client logo.
   If the real number is not available, cut the element or mark it plainly as a
   placeholder. This is the fastest tell there is, and it is dishonest as well.
11. **Copy is design material.** Write the words before you fine-tune the
   spacing. If the copy would fit five hundred other products verbatim, it is
   not copy yet.
12. **Quality floor, unannounced.** One `<h1>`, visible keyboard focus, `alt` on
   every image, `width`/`height` on every image, content visible with JS off,
   reduced motion respected, readable at 360px.
13. **Use the library.** A hand-rolled gradient, scroll engine or exploded
   view is the low-effort version of all three, and it looks it. `gradient.js`,
   `depth.js` and `exploded.js` ship here; GSAP, three.js and anime.js v4 are
   one script tag away. `references/stack.md` says which, for what.
14. **Spend boldness once.** Chanel's rule: before shipping, remove one thing.

**The preset is a choice, not a default.** Warm off-white plus a serif is now
itself a recognised machine-made look. What separates this from that is
everything around it - real optical sizes, the asymmetric grid, varied section
rhythm, hairlines derived from the ink, an accent taken from the photograph. If
the subject suits night or photography, use `ink` or `cinema` instead. Shipping
`bone` because it is first in the list is how you build the thing you were
avoiding. `references/tells.md` has the full catalogue and the current data.

## What is in the box

`assets/core.css` is the chassis: tokens, reset, type scale, 12-column grid with
breakout lines, nav, buttons, hero, dot-leader index, stats, glass cards, frames,
callouts, layered/exploded stack, spec table, steps, accordion, form, marquee,
grain, vignette, reveals, progress. **Never edit it inside a project** - put
project choices in `site.css`, which loads after.

`assets/motion.js` is dependency-free and degrades to a fully visible page:
`.r` reveals, `data-px` parallax, `data-tilt` pointer parallax, `data-count`
counters, `data-magnetic` buttons, `data-split` per-word headline reveal, nav
shrink, scroll progress. It respects `prefers-reduced-motion` and uses one rAF
loop for every scroll effect.

Presets (token overrides only): `fable` the launch-page look - pair it with
`hero-fable` for the WebGL sky, staggered serif title and dot-leader contents;
`bone` warm paper, `ink` near-black throughout,
`cinema` photography carries the page.

Sections: `nav`, `hero-photo`, `hero-split`, `hero-layered`, `index`,
`manifesto`, `blueprint`, `exploded`, `stats`, `cards-rail`, `services`, `steps`,
`quote`, `spec`, `gallery`, `faq`, `contact`, `cta`, `footer`.

Choose by register, not by taste:

| Register | Hero | Middle | Close |
|---|---|---|---|
| An object | `hero-split` | `blueprint`, `exploded`, `spec` | `cta` |
| A place | `hero-layered` | `stats`, `cards-rail`, `gallery` | `cta` |
| A service | `hero-photo` | `services`, `steps`, `stats`, `faq` | `contact` |
| An argument | `hero-photo` + `index` | `manifesto`, `quote` | `footer` |

## The page is a photograph

The reference sites are photographic: a night sky, a stone bridge, a rendered
watch. Not one of them is a drawing. **Default to photography.** Flat SVG
silhouettes read as low-effort next to a photograph, however carefully they are
shaded, so hand-drawn SVG is for line-art (the blueprint), small occluders, and
nothing else.

**One photographic moment per page.** The reference pages use a single
photograph, full-bleed, and put the craft into the type on top of it; every
other section is a plain ground. Two photographs butted against each other is
a seam, and a stock photo behind body copy is texture fighting the words. If a
second section needs a picture, frame it as a figure, do not bleed it.

**Never composite a cut-out that `cut` refused.** It exits 3 and says why -
subject fills the frame, or its box touches an edge, so the "cut-out" is the
original rectangle and will show a hard straight side. A house floating in a
sky with a razor edge under it is a collage, and no amount of grading hides
it. Pick a photo with sky or wall around the subject, or use the photograph
whole.

Then cut the photograph into planes. That is the whole trick of the bridge
video - one scene, several depths:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" cut img/house.jpg --out img
# -> house-fg.png (subject, transparent), house-bg.jpg (hole dissolved), house-mask.png
```

`cut` runs rembg, local AI background removal - no service, no key
(`python -m pip install "rembg[cpu]"` once). A sky photograph as the back plane,
one or two cut-out subjects resting on the bottom edge at different rates, a
colour grade between them so several photographs read as one evening, and the
type as ordinary content at page speed. `references/imagery.md` has the
sourcing, the verified-licence sources, and the grade recipes.

## The launch page, measured

Rendered from the reference itself at 1440px, so these are numbers, not
impressions:

- A **solid cream header bar, 68px**, wordmark left, nav right, one dark pill
  button. The photograph starts *under* it, not behind it.
- Hero **~87vh**, one photograph: sky, a moon top-right, warm cloud at the
  edges, and **soft-blurred branches in the corners** - the nearest plane is
  out of focus. Depth of field is what makes a cut-out read as a camera and
  not a collage: `filter: blur(3px)` on the nearest plane, sharp in the middle
  distance, slightly hazed at the back.
- Eyebrow **13px, uppercase, +0.16em**, centred. Display **~76px serif, two
  lines, the second pushed right ~150px**. Dot-leader contents **15px**,
  `[n]` numerals left, labels right, five rows. All white with a soft shadow.
- Three small dots bottom-left switch the photograph (day / night / warm).
  "Made with ..." credit bottom-right, 12px.
- Then a **warm off-white article**: a serif lede at **~28px on a 640px
  column**, body serif **18px / 1.55**, bold run-in labels (`**Price.**`),
  and a thin vertical progress rail of tick marks at the far left.

## Depth without a 3D engine

The exploded view and the layered hero are the same trick: stack elements in one
grid cell (`.layers` / `.exploded`), give each a different `data-px`, and they
separate as the page scrolls. Foreground silhouettes can be hand-written SVG, so
a convincing layered hero needs no image asset at all.

Five things decide whether a layered hero reads as depth or as one flat shape.
Get any of them wrong and it is the second one:

1. **Bands, not full-height planes.** Every layer except the sky gets an explicit
   `height` (say 30% / 24% / 22%) and `align-self: end`. A foreground drawn at
   full height covers the entire composition and nothing behind it is ever seen.
2. **Lift each band clear of the one in front** with `margin-bottom`, or the near
   plane simply hides the middle one. The offsets *are* the composition.
3. **Aerial perspective.** Each further plane sits closer to the sky's own colour
   and loses contrast. This, not size, is what reads as distance.
4. **Two faces per object.** A lit slope and a slope in shadow. A single flat
   fill reads as a sticker; the fold is what makes it a thing.
5. **Put the bright band of the sky where it will still be visible** - above the
   silhouettes, not behind them.

At equal `z-index`, DOM order decides who occludes whom. The giant wordmark goes
*before* the near silhouette in the markup, so the subject crops it. That
occlusion is the whole effect.

Rates that work, back to front: sky `-18`, far ridge `-34`, mid silhouette
`-58`, wordmark `+104` (positive, so it swims against the rest), near plane
`-14`. Depth comes from the differences between them, not from any one value.

**When the subject is a made thing being taken apart, use real 3D.** Flat SVG
diamonds cannot do the one thing that sells an exploded view - the layers
moving against each other while the camera holds still. `exploded.js` builds
the object from parts named in the markup - a ring, a dome, a disc, hands, a
chain of links - each with a physical material (steel, brushed, gold, lacquer,
ceramic, glass, lume), or loads a real GLB and pulls its named parts apart;
`RoomEnvironment` lighting, scroll driving separation and a slow turn, HTML
callouts projected onto the real world positions, and the numbered list as the
fallback. Describe the actual object: a watch is a bezel ring, a crystal dome,
a lacquer dial with twelve lume markers, a brushed movement, a steel case and
a bracelet chain, taken apart sideways (`data-axis="x"`) the way a watch is
photographed. Six anonymous slabs are the low-effort version. `references/motion.md`
has the part syntax and the projection math.

Reach for three.js beyond that only when the subject is genuinely a 3D object
the visitor must turn - `references/motion.md` has that path and the annotation-callout
projection math.

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

## Reach for tools before hand-rolling

The tools are friends, not competitors. Hand-drawn SVG where a photograph
exists, a bespoke scroll engine where GSAP exists, a guessed layout where a
render exists - each of those is the low-effort version.

| Need | Reach for |
|---|---|
| Anything beyond the three engines above | `references/stack.md` - the table of which library for which job, with verified specifiers and CDN URLs |
| To see what a site you are imitating actually does | `webdesign.mjs look <url>` - real render, two scroll positions, PNGs. Study the reference as an image, not as a description of one |
| Visual research on a style, a palette, a font in the wild | `webdesign.mjs study --list editorial\|object\|cinema\|product` renders a curated batch into contact sheets; the `imagesearch` skill, if installed, for anything it does not cover |
| Photographs | Unsplash, Pexels, Wikimedia, museum IIIF - `references/imagery.md` has the URL formats and licences. Verify every hotlink with a HEAD request |
| Depth from one photograph | `webdesign.mjs cut` (rembg, local) |
| Pinning, scrubbing, sequenced choreography | GSAP 3.15 + ScrollTrigger from cdnjs, free for everything now. `gsap.matchMedia()` for the reduced-motion and narrow-screen branches |
| A real 3D object the visitor must turn | three.js from jsDelivr, or `<model-viewer>` for hotspots with near-zero code |
| Whole-page inertia as a brand decision | Lenis 1.3.26+, never ScrollSmoother alongside CSS scroll timelines |
| A design that exists in Figma | the Figma MCP tools, when attached: `get_design_context`, `get_screenshot` |
| To know whether it looks right | `webdesign.mjs look`, then your own eyes on the PNGs. Nothing else counts |

## References

Read one only when you need it. Each is self-contained.

| File | When |
|---|---|
| `references/fable.md` | The launch page torn down from its shipped bundles: the WebGL hero, the barycentric palette blend, the post chain, what it wastes |
| `references/stack.md` | Which library for which job; GSAP, three.js and anime.js v4 recipes |
| `references/typography.md` | Faces, the fluid scale, tracking and line-height tables, the OKLCH palette, deriving the accent, hairline alphas |
| `references/motion.md` | Scroll-driven CSS, layered parallax, the exploded view, three.js and annotation callouts, canvas sequences, GSAP and Lenis, the motion scale |
| `references/imagery.md` | Sourcing and licensing, CSS colour grading, duotone, scrims, gradient-mesh skies with no photograph, film grain, SVG technical drawing |
| `references/sections.md` | The grid, spacing numbers, dot leaders, glass, forms, and section archetypes the library does not have |
| `references/tells.md` | What gives a generated page away, and what to do instead |
| `references/checklist.md` | The pre-ship pass, and what the audit cannot see |

The audit enforces mechanically most of what is in `tells.md`, so you do not
have to carry it in your head - build, then run it.

## Before you call it done

Run the audit; it must exit 0. Then walk `references/checklist.md`. Then look at
the page at 360px and at 1600px - if you can drive a browser, do, and actually
look at it. Then write your two sentences and stop.

## Security, before it ships

Run `node scripts/webdesign.mjs security <dir>` on the build directory before
any deploy, and read `references/security.md` for what each finding means.
It reads the source for what should never leave a laptop (keys, `.env`, a
served `.git`, source maps), forms that send personal data over GET or to
http, CDN scripts with nothing pinning them, the header configuration, and
the quiet disclosures - a developer's username in a shipped path, fonts that
hand every visitor's address to a third party. It exits 1 on high only.

Two rules. A secret is "remove and rotate", never "remove". And the command
reads source: after the deploy, the three curl checks in the reference are
what tell you whether the headers arrived and whether `/.git/HEAD` is a 404.
Do not call a site secure because the command printed nothing.

## One command for all of it

`node scripts/webdesign.mjs verify <dir|url> [--design REF] [--json]` runs the
audit, one browser pass covering both rendering and the quality budgets, the
security scan, and - when a design reference is supplied - the parity check
against it, then reports one verdict: a summary line, findings grouped by
severity (`error`, `warning`, `low`, `note`), and one exit code - 1 exactly
when audit, render/quality or security would already have exited 1 on their
own. Use it as the single before-you-call-it-done check instead of running
the four commands above separately and reconciling their output by hand;
`--json` gives the same result as data for anything that wants to act on it.
A URL target has no source files, so its audit and security sections come
back marked `skipped` rather than a guess, and a design reference that cannot
be read or rendered comes back `skipped` too rather than as a parity verdict
from a check that never ran.
