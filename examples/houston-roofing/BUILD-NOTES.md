# Build notes: Houston roofing landing page (plugin test)

Directory: `C:/Users/OWNER/cinematic-web-design/examples/houston-roofing`
Date: 2026-09-14. Plugin: ultimate-frontend-skills (repo `cinematic-web-design`), Node 22.21.0.

Files shipped: `index.html`, `404.html`, `privacy.html`, `site.css`, `core.css`, `motion.js`,
`gradient.js`, `depth.js`, `exploded.js`, `sky.js` (the last three are copied by the scaffolder
and unused by this page), `netlify.toml`, empty `img/`.

Invented company: Sabine Roofing. Position: residential roof inspection, storm repair and
replacement, Houston. Service area: Harris, Fort Bend, Montgomery, Brazoria and Galveston
counties. No phone, address, hours, price, licence, years, counts, reviews or testimonials appear
anywhere; the two places a real business would have one carry a sentence saying so.

Final verdict: `verify` exit 0 (0 errors, 8 warnings, 3 notes), `audit` exit 0 with 0 warnings,
`look` exit 0 at 1440 and 390 with 0 warnings, `security` exit 0 with 3 notes, `quality` exit 0
with 0 over budget. Three build/verify rounds. Renders opened and read at every round (list below).

## Every command run, in order, with exit code

| # | Command (from repo root) | Exit | What it said |
|---|---|---|---|
| 1 | `node scripts/webdesign.mjs tools` | 0 | frontend-design live (owns direction), Blender 5.2.1 found, Python 3.13 + rembg found, no local generator |
| 2 | `node scripts/webdesign.mjs awards --pick service --n 3` | 0 | Warhol Arts, Bruno Simon portfolio, Apple Vision Pro. None is a service |
| 3 | `node scripts/webdesign.mjs sections` | 0 | 27 sections, 4 presets |
| 4 | `node scripts/webdesign.mjs assets gen "roof"` | 0 | No attached image tool, no key, no local generator; only pollinations.ai (licence UNVERIFIED, external). Not used |
| 5 | `node scripts/webdesign.mjs new examples/houston-roofing --preset ink --name "Sabine Roofing" --sections nav,hero-gradient,manifesto,services,steps,faq,contact,footer` | 0 | wrote index.html, 404.html, site.css, netlify.toml, six runtime files |
| 6 | `node scripts/webdesign.mjs audit examples/houston-roofing` (round 1) | 0 | 1 warning: title 73 chars |
| 7 | `node scripts/webdesign.mjs look examples/houston-roofing --widths 1440,390` (round 1) | 0 | 12 warnings: the three native radios at 18x18 (needs 24), repeated per pass; "no text overlapping" at every pass |
| 8 | `node scripts/webdesign.mjs verify examples/houston-roofing --widths 1440,390 --json` (round 1) | 0 | 0 errors, 44 warnings (36 of them the same three radios repeated), 3 notes |
| 9 | `node scripts/webdesign.mjs debug examples/houston-roofing --actions actions-390.json --widths 390 --motion normal` | 0 | open menu, expect Claims in panel, close, submit empty form, expect `#f-name-err`, focus email: all passed |
| 10 | `node scripts/webdesign.mjs debug examples/houston-roofing --actions actions-1440.json --widths 1440 --motion normal` | 0 | submit empty form, expect name and message errors, open third FAQ, expect "criminal offence": all passed |
| 11 | `node scripts/webdesign.mjs security examples/houston-roofing` | 0 | 3 notes: fonts served from Google on each of the three pages |
| 12 | `audit` (round 2) | 0 | 0 warnings |
| 13 | `look` index 1440,390 (round 2) | 0 | 0 warnings |
| 14 | `look examples/houston-roofing/404.html --widths 1440,390` | 0 | 0 warnings, "no text overlapping" |
| 15 | `verify --json` (round 2) | 0 | 0 errors, 8 warnings, 3 notes |
| 16 | `node scripts/webdesign.mjs quality examples/houston-roofing --widths 1440,390 --record 4000` | 0 | canvas animating under normal motion, still under reduced motion; worst frame 13 ms; 63 KB / 5 requests at 1440, 379 KB / 9 at 390; no idle libraries, no layout shift; warnings: longest main-thread task 936-991 ms, 9 type sizes at 390, 7 text colours |
| 17 | `look` index 390 `--scroll 2900,4300,5500` | 0 | 0 warnings |
| 18 | `look` index 1440 `--scroll 2300,3600` | 0 | 0 warnings |
| 19 | `debug` 390 with actions (round 2, after nav fix) | 0 | all actions passed |
| 20 | `verify --json` (round 3) | 0 | 0 errors, 8 warnings, 3 notes |
| 21 | `look` index 390 `--scroll 600,2900` (round 3) | 0 | 0 warnings |
| 22 | `look 404.html --widths 1440,390` (round 3) | 0 | 0 warnings |
| 23 | `audit` (round 3) | 0 | 0 warnings |
| 24 | `security` (round 3) | 0 | 3 notes (Google Fonts) |

Not run: `study --awards` (pipeline stage 2). The three picks in row 2 were not service sites, so
rendering them would have cost browser time on this nearly full disk for references that do not
bear on the problem. The stage 2 gate ("three references rendered and looked at") is therefore
not met. Recorded here rather than pretended.

Also not done: clearing `%TEMP%\webdesign-cdp-*` before the browser commands. There were several
hundred of those directories. Every deletion attempt (`rm -rf` in Bash, `Remove-Item` in
PowerShell) was blocked by the harness's destructive-command gate three times, even with the
required facts presented. No browser command hit ENOSPC; C: had 34 GB free at the time.

## Renders opened and read

Round 1: `look1/w1440.png`, `look1/w390.png`, `look1/w1440-y600.png`, `look1/w390-y600.png`,
`debug390/normal/w390-step2.png` (menu open), `debug390/normal/w390-step6.png` (form errors),
`debug1440/normal/w1440-step2.png` (form errors), `debug1440/normal/w1440-step6.png` (FAQ open).
Round 2: `look2/w390.png`, `look2/w390-y600.png`, `look404/w1440.png`, `look404/w390.png`,
`look3/w390-y2900.png`, `look3/w390-y4300.png`, `look3/w390-y5500.png`, `look4/w1440-y2300.png`,
`debug390b/normal/w390-step2.png`.
Round 3: `look5/w390-y600.png`, `look404b/w1440.png`, `look404b/w390.png`.

What the eye found that no check reported:

1. Round 1, 390 scrolled: the eyebrow "WHAT AN INSPECTION INCLUDES" painted on top of the h2's
   first line. `look` said "no text overlapping other text" at that exact pass.
2. Round 1, 390 top: the wordmark wrapped onto two lines because the ghost CTA stays in the bar.
3. Round 1, 390 menu open: the bar stayed transparent over the hero, so hero text showed through
   behind the wordmark and close button while the panel was open.
4. Round 1, both widths: the address field's error text ran straight into the radio legend.
5. Round 2, 404 at both widths: the "404" eyebrow sat on the h1's cap line, and at 390 the lead
   touched the h1's last line. This is the plugin's own `not-found` block as scaffolded, before
   I changed a word of it; the touch is in the chassis, not the copy.
6. Round 2: my first fix for item 1 (forcing `grid-column: 1 / -1`) changed nothing, because
   core.css line 268 already does that under 46rem. The real cause is below.

## What the plugin did well

- `new` produced a page that opened, a 404, a project CSS layer and a headers file in one
  command, and loaded only the engine the page used (`gradient.js`; three.js was not emitted).
- `hero-gradient` gave a real first screen with no photograph: the WebGL field with the roof's
  material colours in `data-gradient`, animating under normal motion and painting one frame
  under reduced motion, both confirmed by `quality`.
- The `nav` block's `<details>` phone menu works with no script, and `motion.js` adds Escape,
  close-on-link, close-on-outside and publishes `--nav-h`. Confirmed by `debug` actions.
- The `contact` block's `:user-invalid` validation shows the error paragraphs after a submit with
  no script, at both widths. Confirmed by `debug` actions and read in the PNGs.
- `look` caught the 18 px native radios at every pass and stopped reporting once they were 24 px.
- `audit` caught the 73-character title and confirmed zero placeholder residue and one italic.
- `security` reported the Google Fonts disclosure on every page and nothing else, with the
  three post-deploy curl checks printed.
- `verify --json` gave one exit code across audit, render, quality and security; the same JSON
  fed the summary in every round.
- `quality` measured the things a still cannot: canvas alive vs still, frame cost, bytes,
  idle libraries, layout shift.
- `debug --actions` made the phone menu and the form testable headlessly; a failed selector
  would have failed the run.
- `tools` read the bench correctly (frontend-design live, Blender, rembg, no generator).

## Where it fell short

Scaffolder (`new`):
- Only the desktop `<ul class="nav__links">` is rewritten to the sections that exist. The phone
  panel's list is left with the library's Work / Method / Detail, and the dead `#detail` href is
  rewritten to `#contact` while its label stays "Detail". Shipped as: a "Detail" link to the
  contact form on every phone.
- `404.html` is built from the raw nav block, so it links to `./#work`, `./#method`, `./#detail`,
  none of which exist on the index it points at.
- `index.html` wraps the skip link and the nav inside `<main id="main">`; the skip link therefore
  skips nothing. `404.html` puts the nav outside `<main>`. Two documents, two structures.
- The `not-found` block uses `class="lede"`; core.css defines `.lead`, not `.lede`. Unstyled.
- The 404 inherits the placeholder meta description from the index head verbatim.
- `plugins.md` says not to pick a preset while frontend-design is live, but `new` takes a preset
  and defaults to `bone`. The two instructions cannot both be followed.
- The contact block links `/privacy`, which the scaffolder never writes.

Chassis (`core.css`):
- `* { margin: 0 }` plus `text-box: trim-both` on both `.eyebrow` and every heading, and
  `.grid` with a `column-gap` but no `row-gap`. Any eyebrow followed by a heading in the same
  column touches it (the 404 block), and once the grid collapses under 46rem every
  eyebrow/heading pair in every library section touches (manifesto, steps, faq, contact).
- `.nav__cta` is not hidden under 46rem, so a wordmark of two words wraps at 390 beside the pill
  and the hamburger.
- The nav has no solid ground while `.nav__menu[open]`, so the hero shows through the bar.
- No radio, checkbox, fieldset or legend styling; native radios paint at 18 px and `look` flags
  them on every scaffolded form that adds one.
- The `.field` focus indicator is a hairline colour change (`ui.md` documents this and tells
  you to fix it in site.css instead of fixing core.css).
- The stuck nav flips to a cream bar on an ink page. Left as shipped.

Checks:
- `look`'s overlap test is box intersection. Two text boxes that touch edge to edge with glyphs
  crossing the line pass it. Items 1 and 5 above were both "no text overlapping".
- `verify`'s render section repeats identical findings per pass (43 warnings in round 1, three
  distinct). The JSON shape (`sections.{audit,security,render}.findings[].{severity,text}`,
  `totals`, `exitCode`) is not documented in SKILL.md or pipeline.md; my first summary printed
  nothing.
- `quality` warns "9 distinct type sizes" against a budget of 8 while the chassis's own scale plus
  one `--step--1` control label produces nine. The budget argues with the chassis.
- `quality` and `verify` warn "longest main-thread task 596-1145 ms" on every pass. It is the
  gradient shader compile plus font load in headless Chrome; nothing on the page changes it.
- `security` notes Google Fonts on every page, but the `head` block ships Google Fonts and the
  scaffolder offers no self-hosting path. The plugin flags its own default with no fix in the box.

Pipeline:
- `awards --pick service` returned an archive wall, a drivable 3D portfolio and Apple Vision Pro.
  Either the corpus has no service-register entries or the picker ignores the register. Stage 2
  is unusable for this register as it stands.
- `assets gen` was honest, which is the point, but the "photographic" route had no photograph
  to run on, so the route that the brief and the pipeline's own table name for a service page
  could not be taken.
- `references/imagery.md`'s licensed sources are hotlinks; the brief forbids hotlinking and the
  plugin has no mirror/download step, so the only lawful photo path is a manual one.

## What I had to hand-write because the plugin had no answer

- Every word of copy, the title, description, favicon SVG, and the two counties/claims sentences.
  Expected; the library is placeholders by design.
- `site.css`: `.eyebrow + :is(h1,h2,h3)` and `h1 + .lead` margins; `.grid { row-gap }` under
  46rem; `.nav__cta { display:none }` under 46rem; `.nav:has(.nav__menu[open])` ground;
  `:focus-visible` ring on fields; the whole `.choice` radio group (fieldset, legend, 44 px rows,
  24 px inputs, focus ring); `.hero__actions`; `.ridge`; the footer three-column layout;
  section-rhythm overrides for `#claims`, `#questions`, `#services`.
- The hero's two-button row and the 4:12 ridge-line SVG (the page's one signature element).
- `privacy.html`, because the shipped form links to a page that does not exist.
- Rewriting `404.html`: nav links and labels, `.lede` to `.lead`, description, second way out.
- The scratchpad `actions-390.json` and `actions-1440.json` for `debug`.

## Still wrong, honestly

- Fonts load from Google on all three pages (3 security notes). Self-hosting needs woff2 files
  the plugin does not ship and a Fontaine/Capsize pass for the metric fallback.
- 9 type sizes against a budget of 8; 7-8 text colours flagged. Both come from the chassis scale
  and the ink preset's tokens, not from this page's additions.
- ~1 s main-thread task on load from the WebGL hero compile (headless measurement).
- The route was photographic and the hero is a colour field. No licensed photograph could be
  obtained without hotlinking or an external service, so `hero-gradient` stands in, as the brief
  allowed. The roof is present as colour, not as a picture of a roof.
- The form carries `data-netlify` and posts to itself; with no host handling it, a submission
  goes nowhere. No deploy was in scope, so no backend was wired.
- Two plainly marked placeholders remain by instruction: the office phone/address/hours line in
  the contact section, and the retention/registered-details sentence on the privacy page.
- Stage 2 (`study --awards`) not run; stage 2 gate not met.
- The `%TEMP%\webdesign-cdp-*` directories were not cleared (harness gate), so several hundred
  more now exist than before.
- `depth.js`, `exploded.js`, `sky.js` sit in the directory unused because the scaffolder copies
  all six runtimes regardless of what the page loads.
