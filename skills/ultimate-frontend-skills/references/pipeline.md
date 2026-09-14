# The pipeline

One route from a sentence to a shipped page, with a gate at every step that
says whether to go on or go back. Nine stages. Most pages skip three or four of
them, and knowing which is most of the skill - stage 3 is the one that decides.

Read this once at the start of a build. Then follow it. Do not read it again
mid-build; the stage you are in tells you what to do next.

```
  0  BRIEF        subject, register, hero            one paragraph, in your head
  1  BENCH        what is installed                  tools
  2  REFERENCES   three sites that disagree          awards --pick / study --awards
  3  ROUTE        how the object gets made           the table below
  4  ASSETS       geometry, textures, lighting       blender / assets / cut
  5  CHASSIS      the page exists and is readable    new / add
  6  COPY         every word is the real word        you, not a generator
  7  CHOREOGRAPH  motion is authored, not applied    motion.js / exploded.js / GSAP
  8  VERIFY       it renders, it holds 60fps         verify, then your own eyes
  9  SHIP         it is safe to be public            security, deploy, curl
```

---

## 0. Brief

Fix three things before you type: **the subject** (the actual thing, named
concretely), **the register** (an object, a place, a service, or an argument),
**the hero** (what the first screen shows). If the brief truly does not say
what the subject is, ask one question. Otherwise decide and go.

Write the subject down as a noun phrase you could put on a shipping label. "A
mechanical dive watch, 41mm, steel, black lacquer dial" is a subject. "A modern
landing page for a watch brand" is not, and a page built from it will look like
a page built from it.

**Gate:** you can name the object, its register, and what the first screen
shows. If not, stay here.

## 1. Bench

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" tools
```

Prints what is actually on this machine - other design plugins, Blender, Python
and rembg, a local image generator, an attached image-generation MCP server -
and one line each on what this plugin does differently because of it. Run it
once per project, not once per page.

Two results change the build:

- **`frontend-design` is installed.** It owns aesthetic direction at the start
  of new UI; this plugin supplies the chassis, the motion, the 3D and the
  verification. Defer, do not compete, and do not mention the handoff to the
  user. `references/plugins.md` has the handshake.
- **Blender is absent.** Stage 4 has no modelling route. Author the geometry in
  three.js instead - which is what most pages should do anyway - or use a
  rendered sequence from somewhere else. Do not tell the user to install
  Blender mid-build.

**Gate:** you know which routes in stage 3 are actually open to you.

## 2. References

Not for copying. For deciding. Three sites that solved a comparable problem
*differently* teach the decision; three variations of one look teach only the
look.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" awards --pick object --n 3
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" study --awards "scroll-scrubbed 3D" --n 3
```

`awards --pick` deliberately avoids picking two sites from the same studio,
the same source or the same technique. `study` then renders them at two scroll
positions into contact sheets. **Open the PNGs.** A description of a site is
not a site, and this whole stage is worthless if you only read the rows.

Search the corpus by the problem, not by the adjective:

```bash
awards "wireframe dissolve"          # by technique, in prose or the technique list
awards --technique "pinned horizontal" --since 2025
awards --kind product --stack three.js --verbose
awards --techniques                  # what the corpus knows how to search for
```

Then write down, in one line each: the move you are taking from each reference,
and the move you are deliberately not taking. `references/awards.md` has the
technique taxonomy and, more usefully, which techniques now read as a costume.

**Gate:** three references rendered and looked at, and one sentence naming what
this page will do that they do not.

## 3. Route

The decision that costs the most to get wrong, because it is the one you cannot
undo cheaply at stage 7.

| The subject is | Route | What you build | Cost |
|---|---|---|---|
| A photograph's worth of atmosphere | **Photographic** | one full-bleed photograph, cut into planes | minutes |
| A made thing the visitor should understand | **Procedural 3D** | `exploded.js` parts, or three.js authored in code | hours |
| A made thing with real manufactured geometry | **Modelled 3D** | Blender to GLB, loaded by `exploded.js` | hours, plus Blender |
| A made thing that must look expensive and never move interactively | **Rendered sequence** | Blender frames, scrubbed on a canvas | hours, heaviest payload |
| A colour field, a mood, a launch page | **WebGL field** | `gradient.js` or `sky.js` | minutes |
| An argument, an essay, a manifesto | **Type only** | the chassis, and nothing else | minutes |

Four rules that settle most cases:

1. **Procedural beats modelled for anything you can describe with primitives.**
   A watch is a ring, a dome, a disc, hands and a chain of links. `exploded.js`
   builds that from an `<ol>` in the markup, it weighs nothing, and the list is
   also the no-JS fallback. Reach for Blender when the geometry has real
   manufactured detail that primitives cannot carry - a knurled bezel edge, a
   guilloché dial, a movement bridge - not because 3D sounds like Blender.
2. **A rendered sequence is a last resort, not a shortcut.** It is the only
   route that cannot respond to the pointer, it is the heaviest thing on the
   page by an order of magnitude, and every frame you cut to save weight shows
   as a stutter. Use it when the material genuinely cannot be done in real time.
3. **Never mix two routes in one page** unless the second is the fallback for
   the first. Two different-looking 3D treatments is the seam that gives a
   generated page away.
4. **If you cannot say why it is 3D, it is not 3D.** A hero that rotates
   slowly and does nothing else is worse than a photograph of the same object,
   and it costs a hundred times more.

**Gate:** one route named, in one sentence, with the reason.

## 4. Assets

Only the route chosen in stage 3. Skip the rest of this section.

### Photographic

```bash
webdesign.mjs cut img/subject.jpg --out img      # rembg, local, no key
```

Gives `-fg.png` (subject, transparent), `-bg.jpg` (hole dissolved) and a mask.
`cut` exits 3 and says why when the subject touches a frame edge - a "cut-out"
with a razor-straight side is a collage and no grading hides it. Pick another
photograph rather than arguing with it. Sourcing, licences and the colour-grade
recipes are in `references/imagery.md`.

### Procedural 3D

No asset stage. The parts are the markup:

```html
<ol class="exploded" data-axis="x">
  <li data-shape="ring"  data-material="brushed" data-y="0.9">Bezel</li>
  <li data-shape="dome"  data-material="glass"   data-y="0.6">Crystal</li>
  ...
</ol>
```

Go straight to stage 5. `references/motion.md` has the part syntax.

### Modelled 3D

```bash
webdesign.mjs blender probe                                  # find it, or stop here
webdesign.mjs blender glb scripts/blender/part-library.py --out build/watch.glb
```

Then load it: `data-model="watch.glb"` on the `.exploded` list, and
`exploded.js` pulls the named parts apart. **Name the parts in Blender**, not
afterwards - the web runtime addresses them by object name and a mesh called
`Cube.003` is not addressable. Budgets, the bpy calls and the export flags are
in `references/blender.md`.

### Rendered sequence

```bash
webdesign.mjs blender frames build/scene.blend --out img/seq --count 90
```

Then scrub the sequence on a canvas. `references/motion.md` has the decode and
preload discipline; get it wrong and the page hitches exactly where the
choreography peaks.

### Materials and light, for every 3D route

Metal reads as metal because of what it reflects, not because of its colour.

```bash
webdesign.mjs assets search brushed          # what CC0 material sets exist
webdesign.mjs assets textures <slug> --res 2k --out img/mat
webdesign.mjs assets hdri <slug> --res 1k --out img/env
```

CC0, no key, no attribution required. `RoomEnvironment` is the zero-download
option and is good enough for a lot of pages; an HDRI is the upgrade, and it is
a real download so budget for it. `references/image-gen.md` has the maps-to-
material-slot wiring, the file-size budgets, and the licence discipline.

### Generated imagery

```bash
webdesign.mjs assets gen "<prompt>" --out img/plate.png
```

It detects what this machine can actually do and tells you; it never invents a
key. The honest limitation, stated once so you do not design around a thing
that is not true: **a generated image has its lighting baked in and cannot be
relit.** It can be a background plate, a texture, a cut-out entity or a flat
albedo you derive maps from. It cannot be an object in a lit 3D scene that
responds to the scene's light. `references/image-gen.md` has the three
workarounds and which one to use when.

**Gate:** every asset exists on disk, is under budget, and its licence is one
you can name.

## 5. Chassis

```bash
webdesign.mjs new <dir> --preset bone --name "Subject Name" \
  --sections nav,hero-split,blueprint,exploded,spec,materials,cta,footer
```

Sections by register, not by taste - the table is in `SKILL.md`. If a Claude
Design handoff exists, implement that instead and do not scaffold over it;
`references/claude-design.md` has the route and `verify --design` measures
whether you kept it.

No Node, or a framework project? Copy `assets/core.css` and `assets/motion.js`
in as-is and take blocks out of `assets/sections.html` by hand. Keep the class
names.

**Gate:** the page opens, every section is in the right order, nothing is
styled yet beyond the chassis.

## 6. Copy

**Before the spacing, before the motion.** Placeholder copy left in a page is a
bug and the audit fails on it, but that is the floor, not the point: copy is
the material the layout is made of, and you cannot set type you have not
written.

Rewrite every word. Concrete nouns. No adjective a spec sheet would not use.
No "elevate / seamless / unlock / transform". One italic accent phrase in the
whole page - one is a voice, four is a costume, and the audit fails the build
at two.

**Never invent a specific.** No customer count, uptime figure, review score,
licence number, years-in-business, testimonial or client logo that you do not
have. Cut the element or mark it plainly as a placeholder. It is the fastest
tell there is and it is dishonest as well.

**Gate:** read the page with the stylesheet off. If the copy would fit five
hundred other products verbatim, it is not copy yet.

## 7. Choreograph

Set the hero image, then set `--accent-h` in `site.css` to the hue of the
subject's own material in that image. Then the motion, in this order:

1. **The one parallax relationship** in the hero. `data-px`, or `depth.js` when
   the depth is real.
2. **The reveals.** `.r` on entry, and nothing else that moves on entry.
3. **The single orchestrated moment.** The exploded view, the wireframe
   resolving, the sequence scrub. One per page.
4. **The signature.** One element this page is remembered by, drawn from the
   subject's own world.

For a scroll-driven 3D sequence the architecture is not negotiable: **one rAF
loop reads one normalised progress number and writes the scene.** Anything else
desyncs when the visitor scrubs backward, which is the failure everybody ships.
`references/three.md` has that loop in code, the easing families that read as
authored rather than applied, and the callout projection that tracks a part
through the turn instead of popping.

Motion earns its place. Scattered effects read as generated; the audit cannot
see this and you must.

**Gate:** scrub the page down and back up at three speeds. Nothing jumps,
nothing desyncs, nothing pops.

## 8. Verify

```bash
webdesign.mjs verify <dir> --widths 1440,390
```

One verdict: source audit, a real browser pass covering rendering and the
quality budgets, the security scan, and design parity when a reference was
supplied. Exit 0 or it is not done.

Then the part no command can do for you:

```bash
webdesign.mjs look <dir> --widths 1440,390
```

**Open the PNGs.** A layer covering half the composition passes every static
check ever written. For motion and interaction, `webdesign.mjs debug <dir>`
builds an HTML review with the evidence in it, and
`webdesign.mjs quality <dir> --record 4000 --expect-depth` measures the running
page - frame rate under scroll, real parallax rates, libraries loaded and never
used, the type scale as painted.

If the page is 3D and does not hold 60fps, go back to stage 7, not stage 3. The
cost is almost always per-frame allocation, a shadow map, or an unclamped
device pixel ratio, and all three are cheap to fix. `references/three.md` has
the checklist in cost order.

**Gate:** `verify` exits 0, and you have looked at the renders yourself.

## 9. Ship

```bash
webdesign.mjs security <dir>
```

Secrets, forms posting personal data over GET or http, unpinned CDN scripts,
the header configuration, and the quiet disclosures. Exits 1 on high. A secret
is "remove and rotate", never "remove".

The command reads source. After the deploy, the three curl checks in
`references/security.md` are what tell you whether the headers arrived and
whether `/.git/HEAD` is a 404. Do not call a site secure because the command
printed nothing.

Then `references/checklist.md`, then stop.

---

## When the pipeline does not apply

- **A page that already exists**, being restyled: start at stage 2, keep its
  copy, and run stage 8 before and after so you can prove you improved it.
- **A supplied design**: stages 0, 5 (implement, do not scaffold), 6, 7, 8, 9.
  The design owns stages 2 and 3 and you do not relitigate them.
- **A component, not a page**: stages 0, 5, 6, 8. The rest is ceremony.
- **A page whose whole job is one paragraph of text**: stages 0, 5, 6, 8. Build
  it in ten minutes and do not apologise for it. Reaching for stage 4 on a page
  that does not need it is the most expensive mistake in this document.

## Rehearse it

`references/briefs/dive-watch.md` is a full brief that exercises stages 0
through 8 end to end - procedural 3D, scroll choreography, a wireframe
transition, projected callouts, a complete page and a 60fps floor. Run it once
against this pipeline before you run the pipeline against something that
matters.
