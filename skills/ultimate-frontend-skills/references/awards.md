# The reference corpus, and what a winner actually scores

Three sites that solved the same problem differently are worth more than any
description of what good looks like. This file is how to get those three, what
to take from them, and what the people handing out the awards are actually
grading.

Every number here was measured on **2026-09-14** by fetching the page or running
the command. Re-run anything that looks stale; the commands are printed.

## The three-reference workflow

Stage 2 of `references/pipeline.md`. Four commands, in this order.

```bash
W="${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs"

node "$W" awards --pick object --n 3        # 1. name the register, get three
node "$W" awards --techniques               # 2. what the corpus can be asked for
node "$W" awards --technique "scrub"        # 3. or search by the problem
node "$W" study --awards "scrub" --n 3      # 4. render them, then open the PNGs
```

**`awards --pick <register>` does not return the three best.** It returns three
that disagree - different studio, different source, different technique - and
only falls back to a second pass if fewer than `n` survive that filter. Studying
three variations of one look teaches the look. Studying three different answers
teaches the decision. The registers are fixed in `awards.mjs`:

| `--pick` | resolves to kind | use it when the brief is |
|---|---|---|
| `object` | `3d,product` | a physical thing you can turn |
| `product` | `product,3d` | software with a UI to show |
| `place` | `brand,editorial` | a location, a property, a venue |
| `service` | `brand,editorial` | a practice selling judgement |
| `argument` | `editorial` | a thesis, a report, a manifesto |
| `portfolio` | `portfolio` | someone's own work |
| `3d` | `3d` | the technique is the brief |
| `editorial` | `editorial` | long-form type |

Anything else is treated as a free-text query, so `awards --pick "dive watch"`
works and just is not diversified by register.

Real run, verbatim:

```
$ node scripts/webdesign.mjs awards --pick object --n 3
Cartier Watches & Wonders 2025  -  Immersive Garden, with 60fps and Mooders (sound)
  https://cartier-waw-0225.dev.60fps.fr/
  2025 / sotd / brand / awwwards
  technique  six discrete three.js scenes, one alcove per emblematic watch, ...
  stack      three.js, gsap, lenis, blender
  take       treating the whole site as architecture - discrete rooms you walk
             between - rather than a stack of hero sections ...

How to Build Cinematic 3D Scroll Experiences with GSAP
  https://tympanus.net/Tutorials/Cinematic3DScroll/
  2025 / developer / experiment / codrops
  ...
Explore Primland  -  Primland
  https://explore.ownprimland.com
  2026 / showcase / brand / editorial
  ...
3 sites. Render them before you build: study https://cartier-waw-0225.dev.60fps.fr/ ...
```

Three sources, three studios, no shared technique. The command ends by printing
the next command; that is the handoff.

### The rest of the surface

```
awards [query]                      every term must appear somewhere; ranked by
                                    whether it hit the technique list or the prose
       --kind 3d|editorial|product|portfolio|ecommerce|brand|experiment
       --source awwwards|codrops|editorial|fwa|threejs
       --award sotd|sotm|soty|honourable|showcase|developer
       --technique X --stack X      substring match inside those arrays
       --year N | --since YEAR      --verified
       --limit N (default 12)       --verbose adds type/palette/motion
       --json | --urls              --urls pipes straight into study
awards --pick <register> [--n 3] [--kind X] [--technique X] [--since YEAR]
awards --techniques                 the searchable index, with counts
awards --stats                      size, sources, kinds, awards, years
awards --build                      re-merge data/awards/*.json into awards.json
```

`--kind`, `--source` and `--award` take comma lists and match exactly. `--technique`
and `--stack` are substring matches against the arrays, which is what you want,
because the technique field is prose.

`study` renders whatever it is given:

```
study <url...>                                 your own URLs
study --list editorial|object|cinema|product   curated fallback, no corpus needed
study --awards "<query>" [--n 3] [--kind X] [--technique X]
      [--scroll 0,900] [--out DIR]
```

It captures each site at 1440 wide at every `--scroll` offset, then tiles them
with ffmpeg at 640px per tile, `4x2` per sheet, into `sheet<N>.jpg`. Eight
renders become one picture. Without ffmpeg on PATH the PNGs are the result and
it says so. Real run:

```
$ node scripts/webdesign.mjs study --awards "editorial grid" --n 1 --scroll 0,900 --out <scratch>/study-check
  ref   Studio K95 - shipping four proprietary typefaces for one portfolio site,
        instead of one hero animation, is the actual craft flex worth studying here
  ok    https://k95.it/en/studio

webdesign study  1 site(s), 2 render(s) -> <scratch>\study-check
  Read these, left to right, top to bottom:
  <scratch>\study-check\sheet1.jpg
    s01/w1440.png  s01/w1440-y900.png
```

`look` is the other renderer and is not interchangeable. `study` is for many
sites you did not build; `look` is for one page you did, and it returns a report
as well as pictures - overlap, overflow, contrast, at `--widths 1440,390` and
`--scroll 0,600` by default, `--no-shot` to skip the PNGs. It exits 1 on errors
and 2 if there is no browser installed. Point `look` at a directory and it
serves it first; point it at a URL and it just loads it.

### The `wall` verdict usually means a preloader

`study` calls a site a wall and drops it from the sheet when any capture has
fewer than 12 text elements (`webdesign.mjs`, in `cmdStudy`). It waits a
hardcoded **4200 ms** before capturing and exposes no `--wait` flag. So a site
with a long intro gate gets captured mid-preloader, reads as textless, and is
thrown away as if it were bot-walled. Reproduced:

```
$ node scripts/webdesign.mjs study https://www.gionatannese.com/ --scroll 0
  wall  https://www.gionatannese.com/  (almost no text rendered - blocked, or a JS-only page)
ultimate-frontend-skills: nothing rendered

$ curl -sA "<browser UA>" https://www.gionatannese.com/ | <strip tags>
HTTP 200  plain text chars: 1579
Gionatan Nese - Multi-Disciplinary Designer ... Projects 2 About 3 ...
```

The server returns a full page. The gate is simply longer than 4.2 seconds. When
you get `wall` on a portfolio or a 3D site, re-render it with `debug --wait 12000`
or capture it by hand before concluding you were blocked. A real bot wall looks
different: it renders fast and it renders a challenge page.

That gate is also a finding in its own right. See the dated section.

### What a row holds

`data/awards.json` is an array of objects. Do not write it by hand - it is
harvested in chunks under `data/awards/` and merged by `awards --build`.

| field | type | what it is for |
|---|---|---|
| `id` | string | slug from name or URL, lowercased, max 60 chars |
| `name` | string | the site |
| `url` | string | must look like a URL or the row is dropped, not repaired |
| `studio` | string or null | used to stop `--pick` returning one studio twice |
| `year` | number | 0 if absent or implausible |
| `award` | string | `sotd`, `sotm`, `soty`, `honourable`, `showcase`, `developer`, `fwa`, `reference` |
| `source` | string | `awwwards`, `codrops`, `editorial`, `fwa`, `threejs` |
| `kind` | string | one of the seven kinds; anything else becomes `editorial` |
| `stack` | string[] | libraries, as named by the source |
| `techniques` | string[] | **sentences**, not tags - the mechanism is the point |
| `palette` | string | prose, with hexes where the source gave them |
| `type` | string | the typographic decision, in prose |
| `motion` | string | what moves and what drives it |
| `why` | string | the one transferable move. This is the payload |
| `verified` | boolean | true only if the URL was actually fetched |

`why` is the model of what a good extraction reads like - a mechanism and a
reason, never "clean modern layout":

> "letting book-cover photography do all the color work, instead of adding a
> brand palette on top, keeps a subscription-box site from looking like every
> other DTC template"

Two consequences of the schema worth knowing before you search.

**`techniques` is free prose, so every string is unique.** Measured on the
current corpus: 320 technique strings across 135 entries, 320 of them distinct.
Searching for an exact technique string will never work. Substring search is the
only way in, and `awards --techniques` is the index to read first - it counts a
fixed vocabulary of build-out-of-it terms against the prose, so it tells you
what the corpus can be asked for rather than what it happens to say.

**`--build` is deterministic and destructive in one direction.** It merges every
`*.json` under `data/awards/` in sorted filename order, keys on URL, keeps the
richer record when two harvesters found the same site, and writes the whole file.
A chunk that is missing from the directory is simply absent from the rebuild.
Run `awards --stats` for live counts rather than trusting any number written down
here; on 2026-09-14 it read 135 entries, 109 verified, sources
`awwwards 71 / codrops 37 / editorial 25 / fwa 1 / threejs 1`.

### The method

1. Name the register, not the look. `awards --pick <register> --n 3`.
2. If the brief names a technique instead, search the problem:
   `awards --technique "scrub"`, `awards --kind product --stack three.js --verbose`.
3. Render all three. **Open the PNGs.** Reading the rows is not stage 2.
4. Write one line per reference: the move you are taking, and the move you are
   deliberately not taking.
5. Build. Then `verify <dir>` - audit, render, quality and security in one verdict.

Never copy a site. Three references that disagree is the point; three that agree
is a moodboard, and a moodboard is how you get the tell.

## The sources

Status column is HTTP as of 2026-09-14, from curl with a browser user agent.

| Source | Status | Machine-readable index | What it is actually good for |
|---|---|---|---|
| `awwwards.com` | 200 | none; `robots.txt` disallows `/feed` | The scored corpus. Only SOTD/SOTM/SOTY detail pages publish numbers |
| `tympanus.net/codrops/webzibition/` | 200 | none | **2,376 hand-picked sites**, each linking straight to the live site. The best harvest target here: no detail-page hop, no bot wall, curation that matches this skill's technique class |
| `tympanus.net/codrops/` | 200 | `/feed/` and `/wp-json/wp/v2/posts` | Where the technique is explained before it reaches an award page |
| `threejs.org/examples/files.json` | 200 | **yes - a real index, 607 entries** | Runnable technique, versioned, free. Not usually called a showcase; it is the most useful one on this list |
| `webdesignawards.io` | 200 | none | The only platform found that publishes criterion **weights** rewarding what Awwwards underweights (see below) |
| `cssdesignawards.com` | 403 to curl, detail pages readable via a rendering fetch | none | Per-judge score breakdowns, which Awwwards does not publish |
| `winners.webbyawards.com` | 200 | none; listing is JS-rendered | Criteria definitions, not a harvest target |
| `onepagelove.com` | 200 | `/feed` RSS, live | Single-page structure. Taxonomies: genre, style, section, tech, platform |
| `minimal.gallery` | 200 | `/feed/` and `/wp-json/wp/v2/posts` | Restraint as a register, with tool and platform tags |
| `lapa.ninja` | 200 | `/rss.xml` | Landing pages, filterable by colour and year |
| `httpster.net` | 200 | no feed (`/feed/` 404s) | Faceted counts off its own nav - the best free read on what a large catalogue actually contains |
| `recent.design` | 200 | none | Where `godly.website` now redirects. A general design feed - branding, print, packaging - not just web |
| `siiimple.com`, `csswinner.com` | 200 | none | Volume. One line each |
| `mobbin.com`, `refero.design` | 200 | none | Product-UI reference, not web craft. Different job |
| `siteinspire.com` | **429** to curl | none | Rate-limited hard. Taxonomies are Styles, Types, Subjects, Platforms |
| `land-book.com` | **403** to everything tried | none | Not harvestable. Anything claimed about its structure is unverified |
| `thefwa.com` | 200, `/sitemap.xml` **500** | none | Client-rendered SPA; every href in source is an asset. Award tiers and criteria could not be confirmed |
| `bestwebsite.gallery` | 200, feed rebuilds daily | `/feed` RSS | **Dead.** Newest item is dated 18 November 2024. The feed's freshness is a lie the channel tells, not the items |

Awwwards URL shapes, all confirmed 200:

```
/websites/sites_of_the_day/     /websites/sites_of_the_month/
/websites/sites_of_the_year/    /websites/honorable/
/websites/nominees/             /websites/developer/
/websites/<tag>/                three-js, webgl, react, webflow, framer, gsap,
                                next-js, nuxt-js, vue-js, astro, svelte, parallax,
                                animation, typography, 3d, sound-audio, scrolling
/sites/<slug>                   the detail page, where the scores are
?page=N                         pagination on any listing
```

**Check the `<title>`, not the status code.** `/websites/webgpu/` returns 200 and
renders `<title>Awwwards Nominees</title>` - a soft 404. There is no WebGPU tag
on Awwwards as of September 2026. `/websites/three-js/` returns its own title,
so the pattern itself is fine.

Honourable Mention and Nominee detail pages publish **no score at all**. The
phrase "the gap between an HM and a SOTD" is not a published quantity anywhere.

## The technique taxonomy

The centre of this file. Cost is gzipped transfer, measured on 2026-09-14 by
fetching the exact CDN build and gzipping it in-process - not an estimate, and
not the raw size vendors quote.

| Technique | How it is actually built | Library | Cost (gz) | Right when | A costume when |
|---|---|---|---|---|---|
| **Editorial grid with breakout lines** | CSS Grid with named lines; one element deliberately spans past the text column; hairlines derived from the ink colour, not from black | none | **0** | Always. This is what separates the top scorers from the bottom of the same listing | Never. The cheapest real craft on the list, and the one nobody ships instead of a shader |
| **WebGL fluid / mesh gradient** | one full-screen triangle, one fragment shader, 3-4 simplex-noise octaves against time. No scene graph, no camera | `gradient.js` (ships here) or ogl | **0 - 39 KB** | The brand has no photography and the page needs a ground that is not flat | It sits behind text where nobody will look. A CSS `radial-gradient` reads identically at 0 KB |
| **Scroll-scrubbed 3D** | GSAP timeline driven by ScrollTrigger, `scrub: 0.8`, `pin: true`, `anticipatePin: 1`; camera or model transform on `ease: 'none'` | GSAP + ScrollTrigger + three.js | **46 + 88 KB** | The subject *is* an object and rotating it reveals something a photograph cannot | The model is a generic abstract blob. Then it is a gradient with extra steps at 134 KB |
| **Image-sequence scroll** | 60-180 pre-rendered frames, `drawImage` into a canvas against scroll progress, every frame preloaded before the section is reachable | GSAP ScrollTrigger + bare canvas | **18 KB + the frames** | The motion is real footage, or a Blender bake you cannot ship as geometry | You need 120 frames to sell a fade. Budget the frames before you commit; they dominate the page weight, always |
| **Pinned horizontal section** | `pin: true` on a sticky wrapper, `x: -(track.scrollWidth - innerWidth)` tweened against scroll distance | GSAP ScrollTrigger | **46 KB** | The content is genuinely a sequence - a timeline, a process, a filmstrip | Applied to a feature grid. Horizontal scroll destroys scanning, and there was no sequence to follow |
| **Text mask reveal** | split to lines, wrap each in `overflow: clip`, `yPercent: 110 -> 0`, stagger ~0.06, inside `document.fonts.ready` | GSAP SplitText | **28 + 4 KB** | The headline is the one dominant element on that screen | On every heading. It is also the single most common cause of content invisible at rest, when the from-state is authored in CSS instead of by JS |
| **Layout transition (card becomes page)** | measure first, mutate the DOM, `Flip.from(state)` animates the difference | GSAP Flip | **28 + 9 KB** | The card and the page genuinely show the same object | Two unrelated panels crossfading. Flip's whole value is that the element is continuous |
| **Cursor distortion** | an ogl or three plane sampling an image with a UV offset driven by a lagged pointer vector | ogl or curtainsjs | **26 - 39 KB** | It is a portfolio, and touch users get a real fallback rather than a still | Desktop-only decoration on a product page. Roughly half the traffic sees nothing and pays nothing back |
| **Custom cursor** | a fixed div lerped toward the pointer, `mix-blend-mode: difference`, scaled on hover targets | none | **~0** | The site's whole register is a gallery | It lags the native cursor by even 60 ms, or it hides the real one anywhere near a form field |
| **Physics layout** | matter-js bodies, a `Mouse` constraint, DOM nodes positioned from body transforms each tick | matter-js | **25 KB** | The metaphor is literally accumulation, collapse or weight | Letters bounce for no reason. It also destroys tab order unless a real DOM list survives underneath |
| **Marquee type** | duplicate the track, `translateX(-50%)` on a linear infinite keyframe; or couple the skew to scroll velocity | CSS, or GSAP for the velocity coupling | **0 - 46 KB** | One, as a divider, as a rule | Three of them. It is the cheapest motion on the page and it reads as exactly that |
| **Same-document view transition** | `document.startViewTransition()` around the state change, `view-transition-name` on the shared element | native | **0 KB** | Any tab swap, filter or route change inside one page. **90.2% support: Chrome 111+, Firefox 144+, Safari 27+** | You shipped a library to crossfade two DOM states |
| **Cross-document view transition** | `@view-transition { navigation: auto }` in both documents, matched `view-transition-name` | native | **0 KB** | A multi-page static site, as progressive enhancement. **84.5% support: Chrome 126+, Safari 27+, no Firefox support at all** | You treat it as universal. Firefox gets a plain navigation - which is fine, and is the reason to use it rather than ship JS |
| **JS page transition** | intercept the link, fetch the next document, swap containers, keep a persistent canvas alive across the swap | `@unseenco/taxi` 1.9.1, or `@barba/core` | **10 KB** | You must keep WebGL state or an audio graph alive across a navigation. That is the only remaining reason | A crossfade on every link. That is a 400 ms delay with a library attached, and the platform now does the visual part for free |
| **Scroll inertia (smooth scroll)** | a rAF loop that intercepts wheel and lerps `scrollTop`; must be wired into `ScrollTrigger.update` or every pin drifts | lenis 1.3.26 | **5 KB** | A deliberate brand decision, on a site with almost no forms | On by default. It breaks `scroll-behavior: smooth`, anchor jumps, find-in-page scroll position, and every native scrollbar affordance at once |
| **Shader text distortion** | render type to a texture with troika-three-text or an SDF atlas, displace the UVs in the fragment shader | troika-three-text | **56 KB + three** | The word *is* the artwork | On a nav label. The text stops being text: not selectable, not searchable, not indexed, not read aloud |
| **Video in canvas** | `<video>` as a `VideoTexture` on a plane, or `drawImage(video)` per frame for 2D work | three.js, or bare canvas | **0 - 88 KB** | You need to mask, displace or light the footage | You wanted rounded corners and a poster frame |
| **Post-processing chain** | an `EffectComposer` pass stack over the scene - bloom, DOF, grain, chromatic aberration | postprocessing 6.39.5 | **154 KB** | The look depends on the light bleeding, and you measured the frame rate after adding it | Bloom added because it looks expensive. It is 154 KB gz and a full-screen pass per effect |
| **2D WebGL at scale** | sprite batching, filters, particle counts a canvas cannot hold | pixi.js 8.20.1 | **226 KB** | Thousands of moving sprites, or real 2D filters | A few hundred particles. Canvas 2D or one ogl shader does that at a twentieth of the weight |
| **Designer-authored vector animation** | export from After Effects or Rive, play in a runtime | lottie-web 5.13.0 / `@rive-app/canvas` 2.42.1 | **75 / 98 KB** | A designer authored the motion and the file is the deliverable | A spinner, an icon hover, a checkmark. All three are CSS |
| **SVG filter grain** | `<feTurbulence type="fractalNoise">` plus `feColorMatrix`, or a tiled PNG at low opacity | none | **~0** | Over a flat ground or a gradient, to kill banding | Over everything at 8%, photographs included, where it reads as compression. `feTurbulence` is genuinely expensive to composite full-screen - prefer the tiled PNG |
| **Three-plane parallax** | foreground, subject and background as separate layers at different scroll rates, pointer adding a small counter-shift | `depth.js` (ships here) | **0** | You have a photograph you can cut, or geometry you authored in layers | Applied to a flat stock image with no cut. The layers must actually be separate or it is a translate |
| **Carousel** | scroll-snap, or a real drag implementation with momentum | embla-carousel 8.6.0, or none | **0 - 7 KB** | Drag, momentum and free-scroll actually matter to the content | You reimplemented `scroll-snap-type: x mandatory` in JavaScript |

### What 45 current Awwwards winners are actually built with

Tag counts from the `Technologies & Tools` block on the 45 most recent Sites of
the Day, scraped 2026-09-14. Out of 45: **GSAP 26, 3D 23, WebGL 20, Animation 19,
Storytelling 15, Three.js 14, Typography 11.** The only framework or builder tags
anywhere near the top are Webflow 9 and Next.js 7. React, Vue, Nuxt, Astro and
Svelte all sit below 5 of 45.

**The winning stack is one animation library plus one renderer.** Not a
framework. GSAP is on 58% of them, and reaching for it is what the field does -
`references/stack.md` is right that hand-rolling a scroll engine to avoid it
produces the low-effort version.

### Three corrections to `references/stack.md`

Measured by fetching each build and gzipping it, 2026-09-14. That file's estimates
are wrong in the expensive direction twice and the cheap direction once:

| Build | stack.md says | measured gz |
|---|---|---|
| `three@0.186.0/build/three.module.min.js` | ~160 KB gz | **88 KB** |
| `pixi.js@8.20.1/dist/pixi.min.mjs` | ~120 KB gz | **226 KB** |
| `postprocessing@6.39.5/build/index.js` | ~40 KB gz | **154 KB** |

Also: the `+esm` specifiers stack.md prints are dependency-inlined bundles, and
that is what you pay. `animejs@4.5.0/+esm` is **42 KB gz**, not ~10.
`ogl@1.0.11/+esm` is **39 KB gz**, not ~10.

The rest of the measured table, for budgeting:

```
gsap 3.15.0 core          28 KB     lenis 1.3.26              5 KB
  + ScrollTrigger         18 KB     locomotive-scroll 5.0.1   9 KB
  + SplitText              4 KB     matter-js 0.20.0         25 KB
  + Flip                   9 KB     lottie-web 5.13.0        75 KB
three 0.186.0 (WebGL)     88 KB     @rive-app/canvas 2.42.1  98 KB
three 0.186.0 (WebGPU)   200 KB     troika-three-text        56 KB
postprocessing 6.39.5    154 KB     curtainsjs 8.1.6         26 KB
pixi.js 8.20.1           226 KB     @barba/core 2.10.3       10 KB
animejs 4.5.0 (+esm)      42 KB     embla-carousel 8.6.0      7 KB
ogl 1.0.11 (+esm)         39 KB     split-type 0.3.4          4 KB
```

**The WebGPU build costs 200 KB gz against 88 for WebGL - 2.3x.** That is the
single most important cost fact of 2026, because everything fashionable is
pushing toward it. See the dated section for when that is worth paying.

## What jurors actually score

Awwwards prints its evaluation system on every winner's detail page:

```
Design 40%   Usability 30%   Creativity 20%   Content 10%
```

It is a literal weighted mean, not a vibe. Verified on all 45 recent Sites of
the Day: **the 40/30/20/10 weights reproduce the published overall on every
single row, to the printed decimal, with zero exceptions.** White Desert, SOTD
11 Sept 2026: 7.28 / 7.27 / 7.21 / 7.74, weighted 7.309, published **7.31**.

There is a second, separate award with its own six criteria - the **DEV AWARD**:
Semantics / SEO, Animations / Transitions, Accessibility, WPO, Responsive Design,
Markup / Meta-data.

### The measured distribution

Scraped 2026-09-14 by walking the Sites of the Day listing and opening every
winner. n = 45.

```
SOTD overall       n=45   min 7.17   mean 7.36   max 7.73

  Design 40%       n=45   min 7.10   mean 7.40   max 7.81
  Usability 30%    n=45   min 6.90   mean 7.19   max 7.48
  Creativity 20%   n=45   min 7.10   mean 7.54   max 8.16
  Content 10%      n=45   min 6.98   mean 7.38   max 7.90

DEV AWARD overall  n=41   min 7.07   mean 7.42   max 7.93
  Accessibility    n=45   min 6.20   mean 6.80   max 7.60
  Animations       n=45   min 7.20   mean 7.96   max 9.20

which dimension was the winner's own weakest:
  Usability 32    Design 6    Content 4    Creativity 3
```

Four things fall out of this, and they are the most useful facts in the file.

**1. A day winner is a 7.36, and the whole band is 0.56 wide.** Every Site of the
Day sits between 7.17 and 7.73. You are not chasing an 8.5 - on this platform an
8.5 does not happen. Year-tier is where the ceiling is: Igloo Inc at 7.92, Lando
Norris at 8.18. **7.4 wins a day. Roughly 7.9 to 8.2 wins a year.**

**2. Usability is the lowest of the four on 32 of 45 winners, and it carries
30%.** It is the ceiling on the entire platform. Moving usability from 7.0 to 8.0
adds 0.30 to the overall. The same move on creativity adds 0.20; on content, 0.10.
The cheapest point available to a cinematic page is the one every cinematic page
throws away.

**3. Creativity is the only dimension with real spread, and it is what separates
a day from a year.** Range 7.10-8.16 across day winners; the year-tier sites sit
at 8.31 and 8.71. Design barely moves at all (7.10-7.81). Design gets you
admitted. Creativity gets you remembered. Usability decides whether you clear
the bar.

**4. On the dev award, accessibility is the floor: mean 6.80, and across 45
winners it never once exceeded 7.60.** Animations is the ceiling: mean 7.96, max
9.20. These pages are graded at about 8.0 on motion and 6.8 on access. A page
that keeps the motion *and* fixes the accessibility outscores all 45 of them on
the dev criteria. That is an unguarded gap, not a trade-off.

### The honest gap between a good page and a winning one

On the same White Desert page, on the same day, the jury scored 7.31 and the
community aggregate row scored **9.31** - 9.4 / 9.3 / 9.4 / 8.8. A two-point gap
on one site.

Anything optimised for the screenshot scores 9.3. The jury scores 7.3. The
difference is everything a screenshot cannot show: whether the thing is usable,
whether it loads, whether the keyboard works, whether the content is worth the
scroll. **Building for the 9.3 is how you ship a page that looks like a winner
and is not one.**

### The other rubrics, for contrast

**webdesignawards.io** publishes weights, and they price what Awwwards does not:

| criterion | weight |
|---|---|
| Performance & Technical Implementation | 20% |
| Innovation & Future Readiness | 20% |
| User Experience & Strategy | 15% |
| Visual Design & Branding | 15% |
| Content & Storytelling | 10% |
| Accessibility & Inclusivity | 10% |
| Responsiveness & Multi-device Support | 10% |

Visual design is 15% there against 40% on Awwwards. Accessibility is a named
10% line that Awwwards folds into a separate optional award.

**CSS Design Awards** runs a different scale entirely, and this is the scale that
"6.5 versus 8.5" actually describes. From its FAQ: two judging systems; Website
of the Day is "determined by the scores from the judging panel" and sites "must
receive average score above 8.0"; sites above 6 that do not win receive **Special
Kudos**. Verified on a real winner - bunq Labs, WOTD 7 Sept 2026, Final Judge's
Score **8.29**, with the individual judges published (8.63, 8.63, 8.47, 8.0, 8.0,
8.0) and a separate public vote (UI 8.25 / UX 8.18 / Innovation 8.43, 20 votes).

Do not carry an Awwwards number onto a CSSDA page or the reverse. A 7.4 wins on
one and fails the threshold on the other.

**Webby** publishes seven criteria for websites - Content, Structure and
Navigation, Visual Design, Functionality, Interactivity, Innovation, Overall
Experience - and **no weights at all**. What it prices that neither of the others
does is repeat visits and content depth: Overall Experience is defined by whether
people come back, bookmark, sign up and recommend.

## What now reads as dated

`references/tells.md` owns the general catalogue: the cream-and-serif reflex, the
italic accent word at more than one per page, indigo CTAs, the section waterfall,
invented specifics, `transition: all`, content invisible at rest. All of it still
holds and none of it is restated here. This section is only what the 2026
measurements added.

**Dated, with the evidence:**

- **Godly as a source.** `godly.website` returns `301 -> http://recent.design/?ref=godly`.
  Any doc still saying "Godly, for landing pages" is describing a site that no
  longer exists in that form, and recent.design is a general design feed with
  branding, print and packaging in the nav.
- **Best Website Gallery as a current source.** The feed rebuilds daily; the
  newest item in it is dated 18 November 2024.
- **Barba or Taxi as the default page-transition answer.** Same-document view
  transitions are at 90.2% support across all three engines. Shipping 10 KB of
  JS to crossfade two pages is the tell now, not the technique. Keep the library
  only for persisting a canvas or an audio graph across a navigation.
- **Locomotive Scroll as the smooth-scroll default.** v5.0.1, last published
  2026-01-15. lenis shipped 1.3.26 on 2026-08-05, at 5 KB gz against 9.
- **split-type alongside GSAP.** Last release 2023-10-22. SplitText has been free
  since April 2025 and is 4 KB gz. Loading both is dead weight.
- **hover-effect (2023-02-15) and zdog (2022-01-22).** Frozen. Fine to use;
  not fine to present as current.
- **Brutalism as a live movement.** Httpster's own facet counts, read off its
  nav: Photographic 1412, Typographic 1193, Minimal 847, Dark 259, **Brutalist 5**.
  Five, in a catalogue of thousands. Whatever the discourse says, it is a
  rounding error in the corpus.
- **"The Awwwards look" as a goal.** The community scores that look 9.31 and the
  jury scores the same site 7.31.

**Newly a tell, specific to 2026:**

- **The loading-percentage intro gate.** This skill's own `study` command cannot
  get past one in 4.2 seconds and discards the site as unrenderable, on a server
  that returns a complete 1,579-character page to curl. If a headless browser
  times out inside your intro, a bounced visitor will not wait either. It is the
  technique and the tell in one artefact, and it costs usability - the dimension
  that already caps 32 of 45 winners.
- **The WebGPU build shipped for a WebGL effect.** The frontier is genuinely
  there: `threejs.org/examples/files.json` now indexes **230 WebGPU examples
  against 220 WebGL** (plus 48 `webgl / advanced`, 26 postprocessing, 4
  `webgl / tsl`; 607 total), and Codrops' recent run is largely WebGPU and TSL.
  But Awwwards has no WebGPU tag - `/websites/webgpu/` soft-404s to Nominees.
  The frontier and the award surface have not met. Paying 113 KB gz extra for a
  tag that does not exist is this year's costume. Pay it when you need compute
  shaders or a node material you cannot express in GLSL, and not for the name.
- **Accessibility treated as an acceptable loss.** Mean 6.80 across 45 winners,
  ceiling 7.60. It reads as normal because everybody does it. It is the cheapest
  unclaimed score on the platform, and it is the one item on this list that is a
  defect rather than a fashion.
- **Pure-CSS scroll-driven animation as a shipping answer.** MDN flags
  `animation-timeline` as "Limited availability - does not work in some of the
  most widely-used browsers", and caniuse-db 1.0.30001810 carries no feature key
  for it at all, which is its own answer. Drive scroll work with ScrollTrigger
  and keep the CSS version as progressive enhancement.

**Not a tell, despite the reflex to call it one:** GSAP. It is on 58% of current
winners.

## The line to carry into the build

A day winner is a 7.36 and its weakest dimension is usability at 7.19. You are
not chasing an 8.5. You are chasing a 7.4 with the usability point that the other
forty-four gave away.
