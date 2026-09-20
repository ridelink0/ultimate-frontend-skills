# Generated imagery that does not read as generated

Compiled 2026-09-20. This file is deliberately scoped away from
`skills/ultimate-frontend-skills/references/image-gen.md`, which was read in
full before writing this document. That file already owns: CC0 material/HDRI
sourcing (Poly Haven, ambientCG), wiring PBR maps into three.js, environment
lighting (`RoomEnvironment` vs. real HDRIs), the generation-provider ranking
(`assets gen`), local model licensing, and "the relighting problem" (why a
generated image's baked-in lighting fights a lit 3D scene, and the three
workarounds: prompt for flat light, match the scene's HDRI to the plate's
light direction, or use it as a flat/parallax plane only). None of that is
repeated here. This file covers the part that source doesn't: what specifically
makes a generated *photograph-style or illustration-style* image look
generated, and the concrete prompting/post-processing/sourcing fixes -
including for flat illustration and icon sets, which `image-gen.md` does not
address at all.

Every claim below is sourced. Where a claim comes from a single blog or
community write-up rather than a primary technical source, that is stated
explicitly and should be treated as directional, not authoritative.

---

## Part 1 - The tells, and why each one happens

### 1. Waxy/plastic skin and HDR over-glow
**What it looks like**: skin with no pore texture, an airbrushed uniformity,
often combined with a blown-out, glowing highlight that reads as "beauty
render" rather than a camera exposure.
**Why it happens**: diffusion models are trained on a corpus skewed toward
retouched portrait and beauty photography, and the model's default output
regresses toward that mean unless explicitly steered away from it.
**How to check it**: zoom 200-400% and compare skin pores, hair-strand
separation, and fabric weave against a real photo at the same zoom - real
sensors show broadband noise and fiber-level detail that "waxy" renders
smooth away (source: Scanly, "AI-Generated vs Real Photos," 2026;
Truth-Check, "AI Image Detection Methods 2026").

### 2. Perfect symmetry and dead-center subject placement
**What it looks like**: a face or product sitting exactly on the vertical
centerline, both halves near-mirror images of each other.
**Why it happens**: centered composition and left-right facial symmetry are
statistically the most common framing in the training distribution (studio
portraiture, product-catalog photography, stock photo conventions), so it is
the path of least resistance for the model absent a compositional
instruction.
**Detection detail**: check whether left-eye and right-eye reflections
(catchlights) are genuinely identical - in a real photo, two eyes at even a
slightly different angle to a light source pick up different-shaped
reflections; suspiciously identical catch-lights are a specific, checkable
tell (source: Scanly, 2026).

### 3. Tilt-shift/shallow depth-of-field applied indiscriminately
**What it looks like**: everything not in the exact subject plane is thrown
into soft bokeh, applied uniformly regardless of whether the scene or the
copy needs it.
**Why it happens**: shallow DOF is heavily associated in training data with
"professional" photography, so models over-apply it as a quality signal even
when a documentary or environmental shot would call for deeper focus.
**Fix**: name an aperture explicitly (see Part 2) rather than leaving depth
of field to the model's default, and ask for autofocus hunting/imperfect
focus when the brief calls for a candid rather than a studio look.

### 4. Impossible or garbled text
**What it looks like**: signage, labels, or book spines with letterforms that
almost read but dissolve into non-glyphs on close inspection.
**Why it happens**: diffusion models compose images from learned visual
patterns, not from a symbolic text-rendering system; text is treated as
texture, not as characters, so there is no mechanism enforcing that letterforms
resolve to a real alphabet (this is a structural limitation of the
architecture, not a training-data gap that more data fixes).
**Practical implication**: never generate an image where legible text is
load-bearing (a sign, a book cover, a product label the copy references) -
composite real typography in afterward instead, or crop to exclude it.

### 5. Hands and jewelry
**What it looks like**: extra or fused fingers, jewelry that merges into the
skin it's resting on, mismatched earrings.
**Why it happens**: hands have far more pose/occlusion variability than any
other body part and a comparatively weak 3D-structural representation inside
the model - the network pattern-matches each hand pose as a new visual case
rather than as one structure viewed from different angles ("the
compositionality gap"), and it does not reliably distinguish the boundary
between a held/worn object and the body part touching it, which is why rings,
watches, and earrings fuse or duplicate.
**State as of 2025-2026**: newer generators (SDXL-based models, DALL-E 3,
Midjourney v6+) are meaningfully better on simple hand poses, but complex
poses (interlaced fingers, hands holding small objects, hands in
mid-gesture) remain unreliable across all current generators - this is
reported as a persistent structural limitation, not a solved problem
(source: wirestock.io, "Why Does AI Struggle With Hands"; sozee.ai,
"Prompt Engineering AI Hands"; imagera.ai, "How to Fix AI Hands," all 2026).
**Fix**: crop hands out of frame, keep hands relaxed/open and away from
jewelry or held objects in the prompt, or composite a real photographed hand
for any shot where hands must be prominent and correct.

### 6. Over-saturated teal-and-orange grading
**What it looks like**: skin pushed toward orange, shadows and backgrounds
pushed toward teal/cyan, applied even to scenes with no dramatic reason for
it.
**Why it happens**: this is a documented, named training-data bias. Orange
and teal is the most common Hollywood color-grade convention because it makes
skin tones pop against a blue/teal background; that convention is so
overrepresented in film-still and marketing-photo training data that models
default to it even when not asked for a "cinematic" look (source: Datalab/
Flitto, "This orange and teal color bias shouts that your image was
AI-generated," 2026).
**Failure mode specifically for diverse skin tones**: the orange push is
reported to oversaturate deeper skin tones into a caricatured look while
losing shadow detail - a compounding realism and representation problem, not
just an aesthetic one (same source).
**Fix**: explicitly name a *different* grade (see the color-grade template in
Part 2), or grade to your own site palette in post rather than accepting the
model's default.

### 7. Hyper-detail with no grain
**What it looks like**: every surface rendered at uniform, maximum
crispness - pores, fabric weave, and background texture all equally
in-focus and equally "clean," with no photographic noise floor anywhere in
the frame.
**Why it happens**: upscaling and "quality" conditioning in most generators
optimizes for perceived sharpness/detail score, which is a different target
than what a real camera sensor actually produces (sensor noise scales with
exposure, ISO, and sensor size, and is *never* zero); the result is a texture
that reads as rendered rather than captured, because real detail-vs-noise
covaries with light in ways uniform hyper-detail does not.
**Fix**: this is one of the two or three highest-leverage post-processing
fixes available (see Part 3, grain).

### 8. Identical lighting across every asset in a set
**What it looks like**: a "team" of six generated headshots, or a product
line of eight generated renders, where every single image has light coming
from the exact same angle with the exact same falloff - which reads as
suspicious *consistency* rather than suspicious inconsistency.
**Why it happens**: this is actually the inverse problem from most tells -
real photo sets shot at different times/locations have *natural* lighting
variance, so when a generation pipeline reuses one prompt template across a
"set," the unnaturally perfect consistency itself becomes the tell.
**Resolution**: Part 3 covers *how* to deliberately hold lighting constant
when you want a genuinely matched product set (this is a real, legitimate
need) - the fix for the tell is to still vary the *micro* details (a slightly
different head angle, a slightly different specular highlight position) even
while holding the macro light rig constant, and to grade the whole set
together afterward rather than trusting per-image consistency from the raw
generations.

### 9. "Stock photo of a diverse team" convergence
**What it looks like**: the diverse-team-high-fiving-in-a-glass-conference-room
trope, the woman-laughing-alone-with-a-salad trope, the
businessman-staring-pensively-at-a-laptop-in-a-coffee-shop trope - now
reproduced by generators instead of licensed from an agency.
**Why it happens**: a documented research finding (covered by Science/AAAS,
"When creating images, AI keeps remixing the same 12 stock photo cliches,"
2026) is that **no matter how diverse or specific the prompt, image models
repeatedly converge on the same roughly-twelve generic, often Eurocentric
motifs** - researchers call this "visual elevator music." The compounding
risk named in that coverage: as more AI systems are used to *judge* other AI
creative output (AI graders reinforcing AI generators), the convergence
narrows further over time rather than diversifying.
**Practical note**: this tell is not fixable by better prompting alone,
because the paper's finding is that prompt specificity did not break the
convergence - it is a corpus-level bias in what "a diverse team" looks like
across the model's training data. The only reliable fixes are (a) using a
real photograph of a real specific team, or (b) if generating, deliberately
composing against every one of the twelve default tropes (unusual location,
unusual framing, unusual number of people, no boardroom, no laptop) rather
than trying to prompt around it with adjectives.

### 10. Isometric 3D "blob" illustration
**What it looks like**: rounded, candy-colored 3D shapes floating in an
isometric 30-degree grid, doing some vague activity (a person at a laptop
next to a giant coffee cup and a floating chart) - the default illustration
style AI page-builders reach for.
**Why it happens**: this style has become the safe default of both stock
illustration marketplaces (unDraw, Storyset-style packs) *and* the AI
isometric-art generators built to mimic them; it's a genre now, and genres
are exactly what generation models reproduce most confidently, which is why
it's simultaneously "huge in web design right now" (per one 2026 design-tools
roundup) and a well-known AI/generic-template tell.
**Fix**: covered in Part 4 (illustration and icon sets), which is not
addressed in `image-gen.md` at all.

### 11. Glossy 3D icon sets
**What it looks like**: a row of feature icons rendered as glossy,
softly-lit 3D objects (a clay-render lock, a glass-render chart, a
metallic-render gear), all sharing a candy/pastel material palette.
**Why it happens**: multiple current AI icon-generator products (surveyed
here: Mew Design, IconikAI, Pixelle, Recraft) explicitly market "soft clay,
translucent glass, glossy plastic, metallic" as selectable style presets,
and their stated best practice for looking "professional rather than
collected" is **rendering every icon with the same lighting setup and camera
angle** - which is good advice for internal consistency, but produces a
visual signature (uniform glossy highlight position, uniform soft shadow)
that is now recognizable across unrelated products because they all used the
same generator preset.
**Fix**: covered in Part 4.

---

## Part 2 - Prompting technique: get a photograph, not a "generated image of a photograph"

### The core move
The single highest-leverage change, repeated across every community guide
surveyed, is **naming a camera and lens**, not describing a mood. A vague
adjective ("professional," "beautiful," "high quality") pushes toward the
generic training-data mean; a specific piece of equipment pushes toward the
specific, narrower slice of the training data that equipment's real output
actually looks like.

### Prompt template, parts named
```
[SUBJECT, specific] + [ACTION/POSE, specific] + [ENVIRONMENT] +
[LIGHT SOURCE, named and directional] + [CAMERA BODY] + [LENS + FOCAL LENGTH]
+ [APERTURE] + [FILM STOCK or SENSOR NOTE] + [IMPERFECTION/GRAIN CUE] +
[COMPOSITION NOTE, off-center + negative space] + [RAW/STYLE PARAMETER]
```
Worked example (editorial portrait for a hero section with copy over the left
third):
```
a mechanic in her 40s mid-laugh, wiping her hands on a shop rag,
standing at a workbench in a cluttered garage, single overcast window
light from camera-left, shot on a Fujifilm X100V, 35mm lens, f/2,
Kodak Portra 400 color rendering, slight motion blur in the near hand,
subject placed in the right third of frame with the left two-thirds
open sky/wall for text, --style raw
```
Why each part earns its place:
- **Camera body + lens + focal length + aperture**: the single biggest
  photorealism upgrade named across every guide surveyed (foundationinc.co,
  gotouseai.com, hackernoon.com, all 2025-2026); typical recommendations are
  85-100mm at f/1.2-f/2.8 for a shallow-DOF portrait, 24-35mm at f/8-f/16 for
  a landscape/environmental shot where everything should stay legible.
- **Film stock**: naming a real stock (e.g., "Kodak Portra 400," "CineStill
  800T") pulls in that stock's actual grain structure and color response as a
  learned association, which is a cheaper and more consistent way to get
  "analogue" character than adding grain only in post.
- **Imperfection cue**: explicitly asking for motion blur, off-axis focus, or
  "candid, unposed" fights the model's default toward a static, symmetrical,
  fully-sharp studio setup.
- **Off-center + negative space**: state *both* where the subject sits and
  what the empty area is made of - "a lone figure standing in the lower right
  corner, surrounded by flat grey sky taking up three-quarters of the frame"
  is reported to work far more reliably than the bare instruction "use
  negative space" (source: PromptAtlas, "Mastering Negative Space Techniques
  in AI Image Prompts," 2026). This is the direct fix for tell #2
  (dead-center symmetry) and is also how you make room for the headline your
  layout actually needs, rather than cropping a centered subject after the
  fact and losing resolution/composition.
- **--style raw (Midjourney) or the equivalent "disable auto-beautify" flag
  on other tools**: per Midjourney's own documentation, Raw mode turns off
  the model's automatic aesthetic/stylization pass; the practical effect
  reported across guides is that simple prompts render more like an
  unretouched photo, and detailed technical prompts (camera/lens/light) are
  respected more literally instead of being overridden by house style
  (source: docs.midjourney.com "Prompt Basics" and "Parameter List," plus
  independent 2026 coverage in prompt-architects.com confirming `--raw`/
  `--style raw` is still the documented parameter as of Midjourney v7/8.x).

### Generating a matched set (product line, team, icon family) under one light rig
This is the legitimate version of tell #8, and the technique is to be
*explicit and mechanical* about what stays fixed, then vary only content:
- Fix in the prompt template and repeat verbatim across every generation:
  light source, direction, and color temperature; background material and
  color; camera angle and lens; overall contrast ratio.
- Vary only: the subject/product description and any category-specific
  detail.
- A concrete "lighting lock" block reported to work (source: nightjar.so,
  "6 Prompt Patterns for Realistic AI Product Photos," 2026, condensed here):
  *"overcast late-afternoon daylight through one large window camera-left;
  broad soft key at 45 degrees; low neutral fill from camera-right; gentle
  negative fill behind the subject; consistent shadow direction toward lower
  right; muted warm highlights and cool-neutral shadows; no added rim light,
  no time-of-day change."*
- Where the tool supports it, hold technical parameters constant across the
  batch (seed strategy, guidance/CFG scale, resolution) and record them next
  to the assets, the same way `assets textures`/`assets hdri` in this repo's
  own tooling write a `<slug>.provenance.json` - for the same reason: whoever
  has to explain the set's origin later needs the recipe, not just the
  output.
- Save the first accepted frame as a visual anchor and check every later
  frame against it for shadow direction, practical-light position, and color
  drift before accepting the set as matched.

---

## Part 3 - Post-processing: fixing what the prompt didn't

Post-processing is necessary because, per the sources surveyed, **grain and
blur fix the texture tell, not the anatomy or motion tell** - if a generated
image has warped hands or an impossible object, no amount of grading will
save it (source: pixova.io/renderio.dev synthesis, 2026). Post-processing is
for closing the gap on an image that is otherwise structurally sound.

1. **Film grain.** Apply as a Soft Light (or Overlay) layer, roughly 15-30%
   opacity depending on the target look - guides converge on lighter grain
   (~15-20%) for a "clean digital" target and heavier (~30-40%) for a
   "phone snapshot" target. Do **not** add grain on top of a generator's own
   noise pattern (some models already emit a fixed noise texture at full
   resolution) - stacking produces a visibly unnatural double-grain texture;
   check at 100% zoom before deciding whether to add any.
2. **Halation.** A soft, warm glow bleeding from bright highlights, associated
   with real film stocks (this is what "CineStill 800T" specifically
   contributes when named in a prompt) - added in post via a blurred,
   screen-blended highlight-only layer. Skip it for a "phone camera" target
   (phone sensors don't halate the way film does); include it for a "shot on
   film" target.
3. **Slight chromatic aberration.** A 1-2px red/cyan fringe at high-contrast
   edges, mimicking real lens dispersion - cheap to add, and one of the
   specific cues named across multiple sources as reducing the "surface
   tells" of a generated image (source: reelmind.ai, pixova.io, 2026).
4. **Color-grade to the site's actual palette.** Never ship the model's
   default grade (which, per tell #6, defaults toward orange-teal); grade
   deliberately to the same palette tokens the rest of the page uses, the
   same way a photograph licensed from Unsplash would be graded before use.
5. **Downscale then sharpen.** Generate above target resolution, downscale
   (which discards some of the uniform hyper-detail described in tell #7),
   then apply a light unsharp mask - this is reported as a cheap way to
   reintroduce a plausible detail/noise relationship instead of the flat,
   uniformly-crisp default.
6. **Crop off the exact center.** Even a well-prompted, off-center
   composition benefits from a final crop pass that removes any residual
   "designed to be centered" framing - crop to the rule-of-thirds position
   your layout actually needs rather than trusting the raw generation's
   framing.
7. **Order of operations**, per the clearest guide surveyed (renderio.dev/
   pixova.io, 2026): clean up compression/upscaling artifacts first (e.g. with
   a dedicated upscaler), *then* grade, *then* add grain/halation/chromatic
   aberration/blur last - adding texture before cleanup just gets the cleanup
   pass amplified or smeared.
8. **Do not over-process.** Every source surveyed makes the same point in
   different words: if every filter is cranked to maximum, the image reads as
   "filtered" rather than "photographed" - subtlety is specifically what
   makes the technique work, not the presence of the technique.

---

## Part 4 - Illustration and icon sets that don't look like the default

`image-gen.md` does not cover flat illustration or icon-set generation at
all; this section fills that gap specifically for app and website UI work.

### Why the default isometric-blob/glossy-3D style happens
Both are now well-established *genres* inside the training data itself -
stock-illustration marketplaces standardized the blob style over the last
several years, and AI icon-generator products (Mew Design, IconikAI, Pixelle,
Recraft, per their own marketing pages, 2026) explicitly ship "soft clay,"
"glossy plastic," and "isometric" as one-click presets. Reaching for the
generator's default preset reproduces the exact genre everyone else's
generator default also reproduces - the sameness is the direct, structural
result of everyone drawing from the same small set of named presets.

### What actually changes the outcome
1. **Line weight as a deliberate, named constraint.** Specify an exact stroke
   width relationship (e.g., "consistent 2px stroke, no fill, rounded caps")
   rather than "flat illustration style" - a named, specific constraint
   produces a distinguishable system; a vague style adjective produces the
   genre average.
2. **A genuinely limited palette, stated as hex or named colors, not "a
   colorful illustration."** Two to three colors plus one neutral, specified
   explicitly, forces every generated piece into the same system - "colorful"
   invites the model's default candy-pastel blob palette.
3. **Real reference, not a style adjective.** Point the model (via an image
   prompt/reference, where the tool supports it) at an actual illustrator's
   work you have a license to reference, or at real objects/architecture
   relevant to the product, instead of describing a vibe in words - reference
   images anchor the output to something specific; adjectives anchor it to
   the genre average.
4. **Reject the isometric grid by default.** If isometric projection isn't
   load-bearing for the content (e.g., not an actual architectural or
   technical diagram), a flat, non-isometric, front-on illustration
   immediately removes the single most recognizable AI-illustration
   convention.
5. **For icon sets specifically**: the "same lighting setup and camera angle
   across every icon" advice from the icon-generator vendors themselves
   (Section 11 above) is correct for internal consistency but is exactly what
   makes generated icon sets mutually recognizable across unrelated products
   - the fix is to *also* commit to an unusual, specific material or
   rendering choice (not the vendor preset) so the consistency reads as your
   system's choice, not the generator's default.
6. **Hand off to a real illustrator/designer when the illustration is a brand
   asset, not a placeholder.** A generated icon set is defensible for an
   internal tool's empty-state graphic; a product's primary brand
   illustration system (the thing that appears on every empty state, every
   onboarding screen, every marketing page) is exactly the asset category
   where the AI-tell cost of getting it wrong is highest and where a real
   designer's system - one considered, reusable icon grid, one considered
   palette, one hand's line quality - still reliably outperforms generation,
   per the same craft logic `image-gen.md` applies to lit 3D surfaces
   ("a surface that has to be lit wants a measured material" - the
   illustration equivalent is "a system that has to stay coherent across
   fifty screens wants a designed one").

---

## Part 5 - Decision table: need -> generate or not -> how

| Need | Generate? | How |
|---|---|---|
| A hero photo of a real, identifiable place or a real named person | **No** | License a real photograph, or commission one; a generated likeness of a real person/place raises both a realism-tell risk and a legal risk (see Part 6). |
| An editorial photo of an unnamed person/scene where the brief needs a specific mood/angle no stock library has | **Generate, carefully** | Full prompt template (Part 2): named camera/lens/aperture/film stock, explicit imperfection cue, explicit off-center composition, `--style raw`; then grade/grain/crop in post (Part 3). |
| A "diverse team" or generic lifestyle scene for a corporate/marketing page | **No, or generate against the cliche list, never toward it** | Per tell #9, prompting harder does not fix this - use a real photo of your actual team/customers, or if generating, deliberately avoid all twelve documented default tropes rather than trying to prompt around them. |
| A product-line or team-headshot set that must look consistently lit | **Generate, with a locked light rig** | The "lighting lock" prompt block (Part 2), same camera/light/background repeated verbatim, vary only the subject; grade the whole set together afterward. |
| A textured surface that will sit inside a lit 3D scene | **No - use image-gen.md's material pipeline instead** | Poly Haven / ambientCG measured PBR materials; a generated image has its lighting baked in and cannot be relit (`image-gen.md`, "The relighting problem"). |
| A flat illustration or icon system that appears on many screens/brand touchpoints | **No for the brand system; maybe for one-off internal use** | Commission a real illustrator/designer for anything brand-facing (Part 4, point 6); if generating for an internal or placeholder need only, use named line-weight/palette/reference constraints, never the vendor default preset. |
| Text that must be legible in the final image (a sign, a label, a book cover referenced by the copy) | **No** | Composite real typography afterward; do not rely on a generator to render legible glyphs (tell #4 is architectural, not a prompting gap). |
| A hands-prominent shot (handshake, holding a product, wearing rings) | **Avoid, or crop tightly, or composite a real photographed hand** | Hands remain unreliable across all current generators for complex poses (Part 1, tell #5); this is the single highest-risk subject for a visible tell. |
| Any image that will carry an AI-generated human likeness in a commercial ad | **Only with disclosure** | See Part 6 - multiple 2026 jurisdictions now require it. |

---

## Part 6 - Legal and disclosure notes

- **Copyright (US)**: the U.S. Copyright Office's Part 2 report on
  Copyrightability (published January 29, 2025, at copyright.gov/ai/) holds
  that **prompts alone do not provide sufficient human control to make a user
  of an AI system the author of the output** - a purely AI-generated image is
  not eligible for copyright registration on that basis. Where a human adds
  perceptible, independently-copyrightable creative contribution on top of
  the AI output (selecting, arranging, or substantially modifying it), that
  contribution may be protectable case-by-case; the raw generated pixels
  underneath are not. Practical implication: do not treat a generated hero
  image as an exclusively-owned asset the way a commissioned photograph would
  be - a competitor could plausibly generate a very similar image from a
  similar prompt with no infringement on your part or theirs.
- **Disclosure - United States, FTC**: the FTC requires disclosure when AI
  involvement in content would materially affect how a consumer interprets
  it, and requires a **"double disclosure"** for AI-involved sponsored
  content (both the sponsorship and the AI involvement); civil penalties run
  up to roughly $53,088 per violation as of 2026 (source: humanadsai.com,
  thestacc.com FTC-disclosure guides, 2026 - **these are secondary summaries
  of FTC policy, not the FTC's own text; verify against ftc.gov before
  relying on the specific figure**).
- **Disclosure - New York State**: General Business Law Section 396-b, in
  effect since June 9, 2026, requires conspicuous disclosure when a
  commercial advertisement distributed in New York features a synthetic
  performer; a product image including an AI-generated person is reported to
  fall within scope. First-violation penalty reported at $1,000, rising to
  $5,000 for subsequent violations (source: solidaitech.com/thestacc.com
  2026 guides - **UNVERIFIED against the statute text itself in this research
  pass; confirm the exact scope before relying on it for a real ad
  campaign**).
- **Disclosure - California**: as of August 2, 2026, California requires
  generative-AI providers to embed invisible, machine-readable "latent"
  disclosure directly into AI-generated images (plus offer a visible
  disclosure option) - this obligation sits on the *provider* (the generation
  tool), not solely on whoever publishes the image, per caimera.ai's 2026
  summary (**UNVERIFIED against the bill text in this pass**).
- **Disclosure - EU**: as of August 2, 2026, the EU AI Act's transparency
  obligations for synthetic/deepfake-style content apply across the bloc
  (per schneller.legal's 2026 summary; **UNVERIFIED against the Regulation
  text in this pass**).
- **When a real photograph or CC0 asset is the right call regardless of any
  of the above**: whenever the subject is a specific real person, a specific
  real place, or specific real product dimensions/branding a customer will
  compare against reality; whenever the image must contain legible text;
  whenever hands, jewelry, or fine manual detail are the actual subject, not
  incidental; and whenever the brief is "a diverse team/customer base" and a
  real one is available to photograph - in every one of these cases the
  realism risk, and in several of them the emerging legal-disclosure risk,
  outweighs the convenience of generation. `image-gen.md`'s own hierarchy
  applies unchanged underneath all of this: Unsplash/Pexels/Wikimedia/museum
  IIIF for a real photograph, Poly Haven/ambientCG for anything that must be
  lit, generation only for "an illustration or plate that does not exist as a
  photograph," and "no image" is explicitly listed there as "frequently the
  right answer."

---

## Sources

- Truth-Check, "AI Image Detection Methods 2026: Tools & Limits" - https://www.truth-check.com/blog/comment-detecter-photo-ia-2026?lang=en
- Scanly, "AI-Generated vs Real Photos — How to Tell the Difference in 2026" - https://scanly.co/blog/ai-generated-vs-real-photos
- ZSky AI, "Remove AI Image Artifacts: 5 Free Fixes" - https://zsky.ai/blog/how-to-remove-ai-artifacts
- ZSky AI, "9 Common AI Image Artifacts: Spot & Fix" - https://zsky.ai/blog/ai-image-artifacts-guide
- ZSky AI, "How to Fix Wrong Colors in AI Images: 6 Proven Fixes" - https://zsky.ai/blog/ai-image-wrong-colors-fix
- arXiv, "AI-Generated Image Detectors Overrely on Global Artifacts: Evidence from Inpainting Exchange" - https://arxiv.org/pdf/2602.00192
- wirestock.io, "Why Does AI Struggle With Hands?" - https://wirestock.io/gen-ai-resources/why-does-ai-struggle-with-hands
- sozee.ai, "Prompt Engineering AI Hands: Complete Guide & Tips" - https://sozee.ai/resources/prompt-engineering-ai-hands/
- imagera.ai, "How to Fix AI Hands: 3 Methods for Extra Fingers (2026)" - https://imagera.ai/blog/how-to-fix-ai-generated-hands
- Datalab/Flitto, "This color scheme shouts that your image was AI-generated" - https://datalab.flitto.com/en/company/blog/this-orange-and-teal-color-bias-shouts-that-your-image-was-ai-generated/
- Foundation Inc., "55+ Midjourney Prompts for Realistic Photos" - https://foundationinc.co/lab/midjourney-ai-prompts
- GoToUseAI, "Midjourney Photography Prompts: The Complete Guide to Photorealistic Images" - https://gotouseai.com/midjourney/midjourney-photography-prompts
- HackerNoon, "A Structured Approach to Midjourney Photography Prompts" - https://hackernoon.com/a-structured-approach-to-midjourney-photography-prompts
- Midjourney official docs, "Prompt Basics" - https://docs.midjourney.com/hc/en-us/articles/32023408776205-Prompt-Basics
- Midjourney official docs, "Parameter List" - https://docs.midjourney.com/hc/en-us/articles/32859204029709-Parameter-List
- Midjourney official docs, "Raw" (style) - https://docs.midjourney.com/docs/style
- Prompt Architects, "Does --style raw Still Work in Midjourney? (2026 Answer)" - https://prompt-architects.com/blog/91-midjourney-style-raw-2026
- Pixova, "How to Make AI Images Look Less Like AI — Techniques That Actually Work in 2026" - https://www.pixova.io/blog/how-to-make-ai-images-look-less-like-ai
- RenderIO, "Make AI Video Look Natural for Social Media" - https://renderio.dev/blogs/make-ai-video-look-natural/
- PromptZone, "Why AI Images Share a Look and How Fine-Tunes Fix It" - https://www.promptzone.com/sebastian_suzuki/why-ai-images-share-a-look-and-how-fine-tunes-fix-it-2g3c
- PromptAtlas, "Mastering Negative Space Techniques in AI Image Prompts" - https://www.getpromptatlas.com/keywords/negative-space-techniques
- Morphic, "Negative space: using emptiness in film and AI composition" - https://morphic.com/ai-glossary/Negative-Space
- Nightjar, "6 Prompt Patterns for Realistic AI Product Photos" - https://nightjar.so/blog/prompt-patterns-realistic-ai-product-photos
- Rewarx, "Make AI Generate Identical Images | Expert Guide" - https://www.rewarx.com/blogs/how-to-make-ai-generate-identical-images-from-same-prompt
- Science/AAAS, "When creating images, AI keeps remixing the same 12 stock photo cliches" - https://www.science.org/content/article/when-creating-images-ai-keeps-remixing-same-12-stock-photo-cliches
- Mew Design, AI 3D icon generator (style presets) - https://mew.design/create/ai-3d-icon-generator
- IconikAI, "App Icon Trends 2026: Gradients, 3D + Free AI Tool" - https://www.iconikai.com/blog/app-icon-design-trends-2026
- Pixelle, AI 3D icon generator - https://pixelle.io/3d-icons
- U.S. Copyright Office, "Copyright and Artificial Intelligence" (Part 2, Copyrightability, Jan 29 2025) - https://www.copyright.gov/ai/
- Harvard Journal of Sports and Entertainment Law, "U.S. Copyright Office Grants Registration to AI-Generated Artwork" - https://journals.law.harvard.edu/jsel/2025/03/u-s-copyright-office-grants-registration-to-ai-generated-artwork/
- HumanAdsAI, "FTC AI Content Disclosure Rules: What Brands Must Know in 2026" - https://humanadsai.com/blog/ftc-ai-generated-content-disclosure
- The Stacc, "FTC AI Disclosure Rules 2026: Complete Marketer Guide" - https://thestacc.com/blog/ftc-ai-disclosure-rules-2026/
- SolidAITech, "AI Picture Generator Law: The 2026 Disclosure Trap" - https://www.solidaitech.com/2026/09/ai-picture-generator-law-ftc-fine.html
- Caimera, "AI Image Disclosure Laws in 2026: A Brand's Compliance Guide" - https://www.caimera.ai/blogs/ai-image-disclosure-laws
- Schneller Legal, "AI Disclosure Requirements from August 2026" - https://schneller.legal/en/deepfakes-and-the-new-disclosure-requirement-what-users-legal-entities-and-individuals-of-ai-systems-need-to-know-from-august-2026/
- Disclosa, "Do you need to disclose AI-generated image in the United States? (2026)" - https://disclosa.com/guides/image/us-federal
- Oakgen.ai, "Free Stock Photo Sites That Don't Look Cheap: 2026 Guide" (Unsplash/Pexels/Pixabay AI-exclusion policies) - https://oakgen.ai/blog/free-stock-photo-alternatives-2026
- `C:\Users\OWNER\cinematic-web-design\skills\ultimate-frontend-skills\references\image-gen.md` (read in full before writing this document; covers CC0 materials/HDRIs, three.js wiring, generation-provider ranking, and the relighting problem - not duplicated here).
