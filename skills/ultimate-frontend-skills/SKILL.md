---
name: ultimate-frontend-skills
description: Use whenever a website, landing page, marketing site, portfolio, microsite, homepage, any public-facing web page, an app screen (mobile, desktop, PWA, Expo), or a game's site, start screen, menu or HUD is being built, redesigned, restyled, or made to "look better" - including plain HTML/CSS pages, Next/React/Astro sites, React Native screens, canvas and three.js games, and single-file pages. Supplies the house style (editorial serif typography, warm-neutral and near-black grounds, cinematic imagery, layered scroll parallax, exploded technical views) plus a copy-in CSS chassis, a motion runtime, a section library, a scaffolder, and an audit.
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

For Claude Design work, first read `references/claude-design.md` - it carries
the routes and what was and was not exercised - then run
`node "${CLAUDE_PLUGIN_ROOT}/scripts/design.mjs" detect` rather than assuming a
route. `detect` only reports: never register, consent or log in on the user's
behalf, and never report a remote Design operation as successful without its
actual result.

Keep a supplied design's direction intact; otherwise proceed with the local house style
without a separate approval pass.

For website debugging or final verification, read references/visual-debug.md. Run the rendered debug command and actually open its PNGs before declaring the visual check complete.

## The route, before anything else

`references/pipeline.md` is the whole build in nine stages, with a gate at each
one. Read it at the start of a build and then follow it; it decides the thing
that is expensive to get wrong, which is **how the subject gets made** -
photographed, authored procedurally in three.js, modelled in Blender, rendered
to a sequence, or not made at all because the page is type.

Two commands belong at the top of every build, before the first line of markup:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" tools
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" awards --pick object --n 3
```

The first says what is on this machine - and `packs` says which of the packs
this plugin defers to are absent, and `packs --install` gets them (see
`references/skill-packs.md`). The second picks three award-winning
references that disagree with each other, so the decisions get made against
something real rather than from memory. `study --awards "<technique>"` renders
them; open the PNGs.

**If `frontend-design` is installed, it owns the aesthetic direction** at the
start of new UI and this plugin supplies the chassis, the motion, the 3D and the
verification. If it is not installed, the house style below stands in. Either
way the seam is silent - never tell the user to go and install something
mid-build. `references/plugins.md` has the handshake and the rest of the bench.

## Three surfaces: a website, an app, a game

The pipeline was written for websites. Two more surfaces now share the same
route, the same chassis and the same audit, each with its own reference and
its own slice of the corpus:

| Surface | Read | What changes |
|---|---|---|
| A website, landing page, microsite | this file, `references/pipeline.md` | nothing - the route as written |
| An app (mobile, desktop, PWA, Expo) | `references/apps.md` | the first screen is a task, not a hero; the navigation model is decided before the palette; empty, loading and error states are designed before the full one; platform conventions outrank the house style; `animate-expo` and the React Native packs own motion when installed. 35 shipped apps: `awards --pick app --n 3` |
| A game's site and its start screen | `references/games.md` | the start screen is in-world UI, not a marketing template: controls documented exactly, real persisted numbers, names for weapons, waves and deaths. The eyebrow-headline-tagline-two-buttons stack is the tell. `awards --pick game --n 3` |

Copy on all three: `references/copy-tells.md`. Generated pictures on all
three: `references/image-tells.md` first, then `references/image-gen.md` for
the pipeline.

What separates a made thing from a generated one - seven points measured on
the two game exhibits, and the app equivalent - is the short form that opens
the Synthesis in `references/games.md` and closes `references/apps.md`.

## Fix three things before you type

Hold these in your head, not on the screen: **the subject** (the actual thing,
named concretely), **the register** (is this an object, a place, a service, or
an argument), **the hero** (what the first screen shows). If the brief truly does
not say what the subject is, ask one question. Otherwise decide and go.

## Build

If a Claude Design handoff exists, implement it in the current project and use the checks
below; do not scaffold over it. The scaffold is for a new site without a supplied design.

Preserving a supplied design is measurable:
`node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" verify <dir> --design <seeded canvas>.html`
compares the page against the artboards (type sizes, palette, rhythm, geometry)
and raises an ERROR when type scale and palette are both absent from the
design - what overwriting one looks like. Hand it a seeded canvas page or a
plain HTML rendering; a bare `.dc.html` is refused.

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
in as-is and take blocks out of `assets/sections.html` by hand. Wrap everything
after the nav in `<main id="main">` yourself - the scaffolder does that, the
section file cannot, and without it the skip link points at nothing and the page
has no main landmark. Everything works
as plain files; the script only saves typing. In React/Astro, import `core.css`
globally and translate the section markup to components - keep the class names.

## The rules that do the work

1. **One serif family, two optical sizes.** `opsz 72 wght 320` for display and
   `opsz 16 wght 400` for body of the *same* family beats any pairing. Default is
   Newsreader; `references/typography.md` names the faces that now read as
   machine-made. Read it before choosing anything else.
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
   hero and, where the subject is a made thing, one exploded view. Photographic
   depth is `depth.js` planes cut from one photograph; a made thing taken apart
   is `exploded.js`, which is three.js. Never hand-rolled SVG silhouettes.
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
13. **A component has more states than the one you are looking at.** Hover,
   focus-visible, active, disabled, loading, error, empty. Design the empty and
   the loading state before the full one. `references/ui.md` has the catalogue
   and `references/craft.md` has the rules; between them they are what stops a
   beautiful page falling over the first time something goes wrong.
14. **Use the library.** A hand-rolled gradient, scroll engine or exploded
   view is the low-effort version of all three, and it looks it. `gradient.js`,
   `depth.js` and `exploded.js` ship here; GSAP, three.js and anime.js v4 are
   one script tag away. `references/stack.md` says which, for what.
15. **Spend boldness once.** Chanel's rule: before shipping, remove one thing.

**The preset is a choice, not a default.** Warm off-white plus a serif is now
itself a recognised machine-made look. What separates this from that is
everything around it - real optical sizes, the asymmetric grid, varied section
rhythm, hairlines derived from the ink, an accent taken from the photograph. If
the subject suits night or photography, use `ink` or `cinema` instead. Shipping
`bone` because it is first in the list is how you build the thing you were
avoiding. `references/tells.md` has the full catalogue and the current data.

## What is in the box

`assets/core.css` is the chassis - tokens, reset, type scale, grid, every
section's components, grain, reveals. **Never edit it inside a project** - put
project choices in `site.css`, which loads after. `assets/motion.js` is
dependency-free, one rAF loop, respects `prefers-reduced-motion`, degrades to
a fully visible page: `.r`, `data-px`, `data-tilt`, `data-count`,
`data-magnetic`, `data-split`, nav shrink, scroll progress.

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

The reference sites are photographic; not one is a drawing. **Default to
photography.** Flat SVG silhouettes read as low-effort next to a photograph,
so hand-drawn SVG is for line art (the blueprint), small occluders, and
nothing else. **One photographic moment per page**, full-bleed, the craft in
the type on top; a second picture is framed as a figure, never bled. **Never
composite a cut-out that `cut` refused** - it exits 3 and says why, and a
subject with a razor edge under it is a collage. Then cut the photograph into
planes:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" cut img/house.jpg --out img
# -> house-fg.png (subject, transparent), house-bg.jpg (hole dissolved), house-mask.png
```

`cut` runs rembg locally, no service, no key (`python -m pip install "rembg[cpu]"`
once). The composition - sky as the back plane, cut-outs at different rates,
one grade across them - and the sourcing, licences and grade recipes are in
`references/imagery.md`.

## The launch page, measured

`references/fable.md` carries the launch page as numbers read from the
browser with `inspect`, and the screenshot readings they corrected.

## Layered heroes, and the exploded view

A layered hero stacks photographic planes in one grid cell (`.layers`), a
different `data-px` each. Five things decide whether it reads as depth: bands
not full-height planes, each lifted clear of the one in front, aerial
perspective, two faces per object, the sky's bright band left visible; DOM
order decides occlusion. Rates and reasons: "Layered parallax" in
`references/motion.md`.

**A made thing being taken apart is real 3D.** `exploded.js` builds it from
parts named in the markup, each with a physical material, or pulls a GLB's
named parts apart, the numbered list as fallback. Describe the actual object;
six anonymous slabs are the low-effort version. Part syntax, projection math
and the turnable-object path: `references/motion.md`.

## The engines that ship here

Three runtimes beyond `motion.js`, all zero-dependency, all copied in by the
scaffolder: `gradient.js` (animated WebGL mesh gradient,
`<canvas class="gradient" data-gradient="...">`), `depth.js` (three-plane
parallax against scroll and pointer, blur and haze from the same signed
`data-depth`, single-photo 3D from a depth map), `sky.js` (the launch-page
WebGL sky re-lit by three palette dots; `hero-fable` uses it) and
`exploded.js` (any made thing taken apart, in three.js). Use them before
anything heavier; `references/stack.md` describes each and names the library
for every job beyond them.

## Reach for tools before hand-rolling

Hand-drawn SVG where a photograph exists, a bespoke scroll engine where GSAP
exists, a guessed layout where a render exists - each is the low-effort
version. The tool for each need is the "Tools, by need" table in
`references/stack.md`: `look <url>` to see what a site does, `inspect <url>
--selector "h1,p,a"` for what it sets, `awards --pick <register>` then
`study --awards "<technique>"`, `study --list editorial|object|cinema|product`,
`assets textures|hdri|gen`, `blender glb` then `data-model`, `cut`, `tools`,
GSAP for pinning and scrubbing, three.js or `<model-viewer>` for an object the
visitor must turn, Lenis for whole-page inertia, the Figma MCP tools when
attached, and `look` again to know whether it looks right.

## References

Read one only when you need it. Each is self-contained.

| File | When |
|---|---|
| `references/pipeline.md` | **First.** Nine stages, the gates, the route decision at stage 3 |
| `references/awards.md` | The corpus, the technique taxonomy, what jurors score, what reads as dated |
| `references/skill-packs.md` | Third-party packs: which owns what when installed, the component-versus-page line |
| `references/ui.md` | The component catalogue: control, states, accessible pattern, the mistake a junior ships |
| `references/craft.md` | What a senior does unasked: states as a system, accessibility, responsive, performance, content, tokens |
| `references/plugins.md` | The rest of the bench: the `frontend-design` handshake, detection, Claude Design, handoffs |
| `references/three.md` | Real-time 3D on a scroll page: import map, materials, light, the one-rAF scrub, callouts, 60fps |
| `references/blender.md` | When Blender is and is not the answer; headless bpy, named parts, GLB, baking, sequences |
| `references/image-gen.md` | Generated imagery, CC0 PBR sets, HDRI lighting, the limits of a relit generated image |
| `references/briefs/dive-watch.md` | The exemplar brief and worked timeline; run it as a rehearsal |
| `references/fable-showcase.md` | The Fable 5.1 launch page measured from its bundles, what could not be evidenced, the recipe |
| `references/fable.md` | The launch page torn down: the WebGL hero, the barycentric blend, the post chain, what it wastes |
| `references/stack.md` | Which library for which job; the engines that ship here; the tools by need; GSAP, three.js, anime.js v4 |
| `references/typography.md` | Faces, the fluid scale, tracking and line-height, the OKLCH palette, the accent, hairlines |
| `references/motion.md` | Scroll-driven CSS, layered parallax, the exploded view, three.js and callouts, sequences, GSAP, Lenis |
| `references/imagery.md` | Sourcing and licensing, grading, duotone, scrims, gradient skies, grain, technical drawing |
| `references/sections.md` | The grid, spacing, dot leaders, glass, forms, archetypes the library lacks |
| `references/tells.md` | What gives a generated page away, and what to do instead |
| `references/games.md` | Game sites and start screens: two exhibits measured, thirteen more, the checkable tells |
| `references/apps.md` | Apps: shipped references with first screen, type, palette, navigation, motion, empty states, copy; the app tells |
| `references/copy-tells.md` | Copy that reads as generated in 2026 - vocabulary, sentence shapes, microcopy - and what human copy does |
| `references/image-tells.md` | What gives a generated picture away, the prompt template, the post-processing order, when to photograph |
| `references/checklist.md` | The pre-ship pass, and what the audit cannot see |

The audit enforces mechanically most of what is in `tells.md`, so you do not
have to carry it in your head - build, then run it.

## Before you call it done

Run the audit; it must exit 0. Then walk `references/checklist.md`. Then look at
the page at 360px and at 1600px - if you can drive a browser, do, and actually
look at it. Then write your two sentences and stop.

## Security, before it ships

Run `node scripts/webdesign.mjs security <dir>` on the build directory before
any deploy; `references/security.md` says what each finding means. It reads
source for what must never leave a laptop (keys, `.env`, a served `.git`,
source maps), forms sending personal data over GET or http, unpinned CDN
scripts, the header configuration and the quiet disclosures, and exits 1 on
high only. Two rules: a secret is "remove and rotate", never "remove"; and
after the deploy the three curl checks in the reference are what tell you the
headers arrived and `/.git/HEAD` is a 404 - never call a site secure because
the command printed nothing.

## One command for all of it

`node scripts/webdesign.mjs verify <dir|url> [--design REF] [--json]` runs the
audit, one browser pass covering rendering and the quality budgets, the
security scan and, with a design reference, the parity check, then reports
one verdict: findings by severity (`error`, `warning`, `low`, `note`) and one
exit code, 1 exactly when audit, render/quality or security would have exited
1 alone. Use it as the single before-you-call-it-done check; `--json` gives
the same result as data. A URL target has no source, so its audit and
security sections come back `skipped`, as does a design reference that cannot
be read or rendered - never a verdict from a check that never ran.
