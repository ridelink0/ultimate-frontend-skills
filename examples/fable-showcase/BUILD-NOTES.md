# BUILD-NOTES - Fable Showcase recreation, plugin test

Date: 14 September 2026. Target: https://www.anthropic.com/claude-fable-and-mythos-5-1.
Plugin: Ultimate Frontend Skills (local folder cinematic-web-design), run as
`node scripts/webdesign.mjs ...` from C:/Users/OWNER/cinematic-web-design.
Output: C:/Users/OWNER/cinematic-web-design/examples/fable-showcase/

Files that make the page: `index.html`, `site.css`, plus the plugin's copied-in
`core.css`, `motion.js`, `sky.js` (and `gradient.js`, `depth.js`, `exploded.js`,
which the scaffolder copies whether or not the page uses them). `404.html` and
`netlify.toml` are the scaffolder's; nothing was deployed. Everything under
`compare/` is evidence: renders of the original and of this page, the debug
captures, verify JSON, and the side-by-side.

Rounds: 2 (build + look, fix + verify). `verify` exit 0 on round 2.

## Every command run, in order, with its exit code

| # | Command | Exit | What it said |
|---|---|---|---|
| 1 | `tools` | 0 | frontend-design live (owns direction), Blender 5.2.1, Python 3.13.7, rembg installed, no local ComfyUI |
| 2 | `awards --pick argument --n 3` | 0 | Warhol Arts, Bruno Simon Portfolio, Apple Vision Pro |
| 3 | `sections` | 0 | 27 sections, 4 presets; `hero-fable` and `fable` present |
| 4 | `new examples/fable-showcase --preset fable --name "Fable Showcase" --sections nav,hero-fable,footer` | 0 | wrote index.html, 404.html, core.css, site.css, 5 engines, netlify.toml; import map + sky.js added automatically |
| 5 | `look https://www.anthropic.com/claude-fable-and-mythos-5-1 --widths 1440 --out compare/original` | 0 | 15 errors / 37 warnings on the ORIGINAL (footnote overlaps at y=14414-14462, collapsed skip-links, hero list contrast 2.4-2.7:1, 18-19px dot targets) |
| 6 | `audit examples/fable-showcase` | 0 | 0 errors, 2 warnings (my title 82 chars; the scaffolder's own 404 description 55 chars) |
| 7 | `look examples/fable-showcase --widths 1440,390 --out compare/mine-r1` | 0 | 0 errors, 26 warnings, all hero-text contrast against the sky |
| 8 | `security examples/fable-showcase` | 0 | 1 warning (import map has no integrity block), 3 notes (Google Fonts x2, CSP vs inline) |
| 9 | `quality examples/fable-showcase --widths 1440 --record 4000` | 0 | 0 over budget; frames 4 ms (worst 8 ms), 462 KB / 7 requests, no idle libraries, no shift, largest type 76px; warns: static branch canvas, 401/711 ms longest task, 9 type sizes under reduced motion |
| 10 | `debug ... --actions compare/actions.json --widths 1440 --motion normal --wait 1800 --out compare/debug-r1` | 0 | 1 interaction error: `.sky__dot[aria-label="Night"][aria-pressed="true"]` not found after clicking Night (step 1); Morning and Noon passed |
| 11 | `debug ... --actions compare/actions-night.json --wait 4500 --out compare/debug-night` | 0 | same interaction error, Night as step 1 |
| 12 | `verify examples/fable-showcase --widths 1440,390 --json` (first) | **1** | audit found 4 errors - all in `compare/debug-r1/review.html`, the debug tool's own gallery |
| 13 | `look examples/fable-showcase --widths 1440,390 --out compare/mine-r2` | 0 | 0 errors, 27 warnings (contrast only) |
| 14 | `verify examples/fable-showcase --widths 1440,390 --json` (after removing the two review.html files) | **0** | audit 0 errors / 1 warn; security 0 / 1; render 0 / 46 (contrast, static canvas, 406 ms task) |
| 15 | `debug ... --actions compare/actions-order.json --wait 3000 --out compare/debug-order` (Morning, Night, Noon) | 0 | no interaction errors; all three `aria-pressed` expectations passed |
| 16 | `python -c` PIL compose -> `compare/side-by-side-1440.png` | 0 | 2920x1000 |

Not run: `study --awards` (the three picks were not rendered - C: space and
budget; the real reference for this build is the live URL, which was rendered
by `look` instead), `debug --motion both` (only `normal` was captured; the
reduced-motion canvas check came from `quality` and `verify`).

PNGs actually opened and read: `compare/original/w1440.png`,
`compare/mine-r1/w1440.png`, `mine-r1/w1440-y600.png`, `mine-r1/w390.png`,
`compare/debug-r1/normal/w1440-step1.png` (Night click), `-step3.png`
(Morning), `-step5.png` (Noon), `compare/debug-night/normal/w1440-step1.png`,
`compare/mine-r2/w1440.png`, `mine-r2/w390.png`,
`compare/debug-order/normal/w1440-step3.png` (Night, confirmed),
`compare/side-by-side-1440.png`.

## The three sky states, as captured

- **Noon** (`debug-r1 step5`, `mine-r2/w1440.png`): blue zenith falling to a
  pale grey-lavender horizon, thin cloud wisps top-right, a small bright
  crescent top-right, twig silhouettes in both lower corners, first dot ringed.
- **Night** (`debug-order step3`): the whole scene goes to near-black navy; the
  branches become dark-on-dark silhouettes; the contents list stays white and
  readable; second dot ringed. Stars were not visible in the capture because
  the capture is scrolled ~450px into the hero (see debug note below).
- **Morning** (`debug-r1 step3`): the whole scene re-lights peach-orange from
  a low sun, branches warm-brown, third dot ringed. Under this mood the second
  title line measured 1.02:1 against the bright horizon at 76px - a real
  finding, fixed by widening the halo in `site.css`.

The re-lighting is one eased weight vector (`1 - exp(-dt * 2.2)`) in `sky.js`;
it is not a crossfade and the transitions pass through a real dusk.

## Where this page differs from the original (side-by-side at 1440)

`compare/side-by-side-1440.png`: original left, this page right.

Matches: 68px solid cream header with wordmark left, links right, one dark
pill; hero starting under the bar; 13px uppercase eyebrow; 76px two-line serif
title with the second line pushed ~150px right; five `[n]` dot-leader rows at
15px centred under the title; three dots bottom-left; 12px credit bottom-right;
warm off-white article; 28px lede on 640px; 18px/1.55 body with bold run-in
labels; a tick-mark rail at the far left with a travelling mark.

Differs, and why:

1. **Sky colour and cloud.** The original is a saturated blue with large
   peach-and-cream cloud masses stacked at the left and right edges. `sky.js`
   gives a desaturated blue that fades to a grey-lavender horizon with thin
   wisps. The engine's cloud density is kept to the edges as described, but
   the amount is a fraction of the reference's.
2. **Moon.** Original: a large, soft half-moon top-right, about 180px. Engine:
   a small hard crescent, about 90px, in the same place.
3. **Near plane.** Original: one out-of-focus dark branch in the lower right,
   the left edge carried by cloud. Engine: two large twig silhouettes with
   seed heads in BOTH lower corners, reaching into the middle of the frame and
   under the contents list. It reads as winter twigs, not a leafy branch.
4. **Hero height.** Both are 87vh; the original's viewport capture shows the
   hero running to the bottom edge at 1000px, this one ends at 935px because
   the 68px bar is outside the 87vh. Same number, different sum.
5. **Dot leader.** Original: literal bold full stops. Chassis: a 1px dotted
   hairline (`.index__dots`), thickened to 1.5px here. The plugin's own
   `fable-showcase.md` names the literal-dots version as the craft version.
6. **No shelters.** The original parts its clouds behind the type. The engine
   has none (documented in `fable-showcase.md`); the plugin's `.hero__scrim`
   at .55 greyed the lower sky instead, and was cut to .18 in `site.css`.
7. **Title.** Original is a two-line product name. This one is a two-line
   sentence naming itself a recreation, at the same size and offset.

## What the plugin did well

- One `new` command produced a working WebGL hero: import map pinned to
  three@0.186.0, `sky.js` loaded only because the page contains `data-sky`,
  CSS gradient fallback, reduced-motion still frame, real `<button>` dots with
  `aria-pressed`. The re-lighting works in all three states and the buttons
  are keyboard-operable without any code from me.
- The measured numbers in `SKILL.md` and `fable.md` were right. Setting the
  page to them produced a hero whose geometry lines up with the original's
  capture without further tuning.
- `look` on the live URL is a genuinely useful reference-capture tool, and it
  produced a fair audit of the original (its own footnote overlaps and
  sub-24px dot targets).
- `debug` with an actions file caught a real defect a static check cannot:
  the second title line at 1.02:1 under the Morning mood.
- `quality` measured the running page and confirmed no idle library, no shift,
  462 KB total, 76px largest type - the numbers `fable-showcase.md` says to
  report were available from the tool.
- `audit` raised nothing false on the copy; 0 errors on both rounds.
- `verify` did what it says: one exit code, and it was 1 for a real reason
  (see below) before it was 0.

## Where the plugin fell short

- **No article section.** The SKILL and both Fable references describe the
  article (28px lede on 640px, 18px/1.55 body, run-in bold labels, tick-mark
  rail) but the section library has nothing that produces it. `manifesto` is
  a two-column grid. The whole article layer of this page is hand-written.
- **The engine's sky is not the reference's sky.** Points 1-3 above. The
  engine reproduces the mechanism (mood vector, edges-only cloud, moon, near
  plane, DPR cap) but not the picture: paler, hazier, small crescent, and a
  two-corner twig silhouette that the reference does not have. There is no
  parameter on `data-sky` for cloud amount, moon size, or branch placement;
  changing any of them means editing the engine.
- **The preset's own scrim fights its own engine.** `core.css` sets
  `.hero:has([data-sky]) .hero__scrim { opacity: .55 }`; the reference has no
  scrim at all. The plugin's default greys the horizon it just painted.
- **`hero-fable` ships three placeholder rows** with inline `style=` margins
  and links to `#method/#work/#contact` that do not exist on a fable page. The
  scaffolder rewrote them all to `#top`. Expected for placeholder copy, but
  the section named after this page should ship five rows.
- **`fable` preset label is stale**: "one photograph under a solid cream
  header" - the matching section uses a WebGL sky, not a photograph.
- **`verify` crawls tool output.** It audited `compare/debug-r1/review.html`
  (the debug tool's own gallery) and exited 1 with 4 errors that had nothing
  to do with the page. Nothing in `verify`, `audit` or `debug` excludes a
  sibling tool's output, and `debug --out` inside the site directory is the
  natural place to put it. I deleted the galleries to get to 0.
- **`debug` swallows the first click after load.** Night failed as step 1 in
  two runs (waits 1800 and 4500 ms) and passed as step 3. Whether the first
  CDP click lands before the module's listeners attach or is consumed by
  focus is unresolved; it is reproducible and it will make any first-action
  test look like a page bug.
- **`debug` captures actions scrolled into the page** (~450px down), so a
  hero interaction capture never shows the top of the hero - the Night stars
  and the moon are out of frame in every dot capture.
- **The scaffold fails its own checks.** `audit` warns on the scaffolder's own
  `404.html` description (55 chars, "aim 80-160"). `security` warns on the
  scaffolder's own import map (no integrity block) and notes the scaffolder's
  own Google Fonts link. A plugin whose fresh scaffold trips its own audit and
  security scan is asking every user to fix the same three things.
- **`quality` disagrees with `sky.js`.** It warns "1 canvas painted once and
  never changed" on the engine's own static 2D branch canvas, every run.
- **`quality` counts type sizes differently between passes**: 8 under normal
  motion, 9 under reduced motion, same page.
- **`tools` hands direction to frontend-design** and there is no way to say
  "the brief pins the target; direction is not open". I did not invoke
  frontend-design; the reference photograph was the direction.
- **`awards --pick argument`** returned an art archive, a drivable 3D
  portfolio and Apple Vision Pro. None resembles a launch article; the pick
  did not inform this build.
- **`look` contrast sampling** reports 1.02:1 for hero list rows at scroll
  600 - the rows are under the sticky cream bar, i.e. hidden, not
  low-contrast. 46 of the verify warnings are this family.
- **The scaffolder copies all five engines** into every project regardless of
  use (`gradient.js`, `depth.js`, `exploded.js` are dead files here).

## What I had to hand-write because the plugin had no answer

- The whole article: `<article class="article">`, the 640px column, `.lede`
  at 28px, `.article__section` with `[n]` numerals, `p` at 18px/1.55,
  `.runin` bold labels. ~40 lines of `site.css` and the markup.
- The tick-mark progress rail (`.rail`, `.rail__mark`): CSS-only, marker on a
  `scroll()` timeline, fades in past the hero, hidden under 56rem, static
  under reduced motion. `core.css` only has a horizontal top `.progress` bar.
- The "Made with" credit (`.hero__credit`), bottom right, 12px; moved above
  the dots at phone width.
- Pinning the header to exactly 68px (`.nav { padding-block: 0; height: 68px }`
  and neutralising `.is-stuck`'s blur/padding change).
- Hero type overrides to hit the measured numbers: eyebrow 13px / +0.16em, h1
  `clamp(2.5rem, 1.5rem + 3.6vw, 4.75rem)` (75.8px at 1440) at line-height
  1.0 with no 16ch cap, `.display__b` at `clamp(0, 10.4vw, 150px)`, index at
  15px / 26rem, numerals in the text face at full opacity.
- Scrim reduction (.55 to .18) and a wider halo on the h1 for the Morning
  state.
- Phone-width overrides for the title, stagger, list and credit.
- Five index rows with real anchors, the nav links, the phone panel links,
  all copy, title, description, OG.
- The three debug action files, the PIL side-by-side, and the removal of the
  debug galleries so `verify` could pass.

## Still wrong, honestly

- The sky does not look like the original's sky (points 1-3). It looks like
  the engine's sky. Fixing that means editing `sky.js`, which this test did
  not do.
- Hero list text is 1.4-2.9:1 against the sky at 15px. The original's is
  2.4-2.7:1 by the same tool. Neither passes 4.5:1.
- The CDN import map has no `integrity` block; fonts hotlink to Google. Both
  are the scaffold's defaults, left as shipped so the finding stands.
- `404.html` is untouched scaffold output and carries the 55-char description
  warning.
- The first-click failure in `debug` is not diagnosed to a cause.
- No `study` render of the three award picks; no reduced-motion `debug` pass.
