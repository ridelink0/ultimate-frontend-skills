# What gives a generated page away

`webdesign.mjs audit` mechanically checks the ones that can be checked, so you do
not have to hold this in your head. Read this file when the audit flags
something you want to understand, when you are working outside the chassis, or
when you are judging a page you did not build.

Two measured facts to calibrate against. Of ~1,590 Show HN landing pages, **22%
carried four or more of these patterns and 32% carried two or three**. Of English
web pages published since ChatGPT, **over a third** show AI-authorship markers.
This is not a rare failure mode; it is the default output.

## The seven highest-weighted

Public scanners weight these above everything else. In descending order:

1. **The default font stack.** Inter, Geist, Space Grotesk, DM Sans, Poppins,
   Roboto, Playfair Display, Montserrat - and now **Instrument Serif, Fraunces,
   Syne and Cal Sans**, which were the 2025 escape route and have become the new
   default. One family doing display, body and UI is the underlying tell.
2. **Indigo/violet CTAs.** `#6366f1`, `#4f46e5`, `#8b5cf6`, `#7c3aed`,
   `#a855f7`, and the Tailwind blues `#2563eb`, `#3b82f6`. Traceable to a single
   Tailwind UI decision in 2020 that its author has publicly apologised for.
3. **A reflexive cream ground.** This one matters here, because it is what this
   skill uses. Warm off-white plus a serif is now itself a recognised look - the
   "tasteful AI startup" wash. See the section below.
4. **Washed-out grey body text.** `#888`, `#9ca3af`, `#a0aec0` - under 4.5:1 and
   usually not checked.
5. **Gradient text** via `background-clip: text` on the H1 or a big number.
6. **A coloured accent stripe on cards**, top or left, applied to features,
   alerts, pricing and testimonials all at once.
7. **The eyebrow pill above the headline** - "Now in beta", "AI-powered",
   "New" - especially above *every* section heading.

Then: gradient-letter avatars on testimonials, aurora/mesh blob backdrops,
crushed display tracking, the icon tile above every feature card.

## About cream, and about the italic

Two things this skill does are on the list. Both are deliberate, and both have a
condition attached.

**The bone ground.** Warm off-white with a serif is the current reflex. What
separates this from that reflex is everything the reflex does not do: real
optical sizes rather than one weight, an asymmetric grid rather than a centred
column, section padding that varies with content weight, hairlines derived from
the ink, an accent taken from the photograph, and depth built from layers. If you
ship bone plus a serif and nothing else, you have built the tell. The `ink` and
`cinema` presets exist so bone is a choice rather than a default - use them.

**The italic accent word.** `Descent is gravity. *Ascent* is arithmetic.` is
straight out of the reference sites and it is also the single most imitated
headline device of 2026. **One per page.** The audit fails the build at two. One
is a voice; four is a costume.

## Layout and structure

- **The section waterfall**: hero, logo wall, features, bento, how-it-works,
  stats, testimonials, pricing, FAQ, CTA, four-column footer - in that order,
  every time. Structure is the highest-weighted dimension in every rubric.
- **Three identical icon-topped cards** in a `lg:grid-cols-3`. Related: equal
  visual weight across every feature, so nothing is the hero feature.
- **Bento grids** used as decoration rather than because the content genuinely
  has different sizes.
- **Centred everything.** One detector scores "more than 60% of text centred" as
  a rule in its own right.
- **Uniform `py-24` section padding** regardless of content weight, and
  `max-w-7xl mx-auto px-4` on every container.
- **Monotonous spacing** - the same gap between related and unrelated things.
- **Cards nested inside cards**: rounded container, inner glass panel, inner icon
  tile.
- **A shell**: no About page, no changelog, no blog with a back catalogue, no
  named humans, and every page shipped in one moment with no history.

## Invented specifics

These are the fastest tell of all, and the most damaging, because they are
dishonest as well as recognisable.

- Round invented stats: "10,000+ teams", "99.9% uptime", "4.9 stars", "$2M+
  saved", with no source and no date.
- A greyscale logo wall of companies that are not customers.
- Testimonials with invented names, gradient-letter avatars, job titles like
  "Head of Growth", and quotes that all run exactly two lines.
- Placeholder residue: `via.placeholder.com`, `picsum.photos`, `example.com`
  emails, `+1 (555) 123-4567`, `123 Main Street`, `[Your Company]`.
- A copyright year that does not match.

**Never invent a number, a certification, a licence, a review, or a customer.**
If the real figure is not available, cut the element or mark it plainly as a
placeholder. The audit fails the build on the residue patterns.

## Code-level

- `transition: all 0.3s ease` on everything.
- The Framer Motion default: `initial={{opacity:0, y:20}}` + `whileInView` +
  `duration: 0.5` + `stagger: 0.1`, with no `prefers-reduced-motion` guard.
- **Content invisible at rest** - reveal code that leaves a blank page if JS
  fails. This is the most consequential one on the list.
- Div soup: no `<main>`, `<section>`, `<nav>`, `<footer>`, `<ul>`.
- `<div onclick>` instead of `<button>`. No tab order, no keyboard handler.
- Missing `alt`, or alt text that describes the file ("image of hero-bg.png").
- Icon SVGs with neither `aria-hidden` nor an accessible name.
- Comments that restate the code, uniform comment density (human comment density
  is bursty), `// TODO: implement` with no context, `console.log('DEBUG:')` left
  in, empty catch blocks, triple null checks, `=== true`.
- Builder fingerprints in source: `gpteng.co`, `lovable-uploads`,
  `lovable-tagger`, `@base44/sdk`, "Built with v0", `.bolt.host`, `.replit.app`.
  These detect *builders*, not AI - Claude Code and Cursor leave none. Absence
  proves nothing.

One measured anchor: a single AI-generated 29-line sidebar was found to contain
ten distinct accessibility failures. AI-generated code carries roughly **1.7x
more total issues** and **1.57x more security findings** than human-written.

## Copy

The vocabulary lists date fast. The **structural** tells do not:

- **Low sentence-length variance.** Burstiness below 0.4 flags. Human prose
  swings between four-word and forty-word sentences.
- **Paragraph rectangles** - every paragraph the same three or four sentences.
- **Every section with the same number of bullets, each the same length.**
- **The rule of three everywhere.** "Fast. Simple. Secure." More than one
  polished triplet per 200 words is templated.
- **Negative parallelism** in all its forms: "not just X, it's Y", "not only but
  also", "not X but Y". Now roughly **three times** its 2023 rate on the open
  web. The same frame three times on one page is a signature.
- **Question headings** on every section, and the colon-in-headline habit.
- **Sections that end by summarising themselves.**
- **Vague authority**: "Industry reports suggest", "Experts argue", uncited.
- **Empty openers**: "In today's fast-paced world", "In a world where",
  "Picture this". Two per 500 words is a strong signal.
- **Corporate verb inflation**: utilize, leverage, facilitate, streamline,
  empower, supercharge, unlock, elevate, transform, revolutionize.
- **Em dashes above ~20 per 1,000 words.** Measured: GPT-4.1 at 10.6 vs a 3.2
  human baseline; em dashes appear twice as often on the web as in 2023. Their
  absence proves nothing - people strip them now.

The vocabulary that flags *right now* is **emphasizing, enhance, highlighting,
showcasing, align with, fostering, bolstered, enduring, vibrant, pivotal,
underscore**. The delve/tapestry/meticulous cluster is the 2023-24 fingerprint
and is no longer current - do not fight the last war.

**The two tests that beat any word list.** Delete test: if more than a third of
sentences can be removed with no loss, it is filler. Substitution test: if the
copy would fit 500 other products verbatim, it is not copy.

## The inverse - what to do instead

This half is more useful than the avoid list.

**Type.** Two families with a real job split. A scale with genuine jumps
(1.25-1.414), not five sizes inside 8px. Per-size line-height. Tabular figures in
tables, oldstyle in prose. `text-wrap: balance` on headings, `pretty` on
paragraphs.

**Layout.** An asymmetric grid, and an alignment axis you could put a ruler on
down the whole page. Optical overrides - a round glyph nudged 1-2px past the
metric edge so it *looks* aligned. Section rhythm that varies by importance. One
dominant element per screen. One deliberate break in the grid.

**Colour.** Semantic token names (`--rule`, `--fg-muted`), not `--purple-500`. A
neutral ramp with a temperature, held. Off-black and off-white. Depth by one
mechanism only - borders or shadows, not both on the same element.

**Imagery.** Real photography of real places, with visible imperfection. Product
screenshots with real data and real edge cases in them. Custom illustration in
one identifiable hand. A designed OG image and a real favicon. **One signature
element** you could describe in a sentence and that exists nowhere else.

**Motion.** Motion tied to state change, not to entering the viewport. Distinct
durations per interaction class. Content visible at rest. `:hover`,
`:focus-visible`, `:active` and `:disabled` all designed.

**Copy.** A committal headline naming the actual thing. One identifiable voice
with opinions. Real numbers with provenance and a date. The domain's actual
jargon. Wildly varied sentence length. **Concrete limits stated** - "this will
not work if...", "we do not do..." - because generated copy never limits itself.
Content volume that is legitimately uneven: one feature gets 400 words and
another gets 40.

## The one-line version

No purple, no reflexive cream, no gradient text, no glow, no blob, no pill badge,
no icon-tile card, no accent stripe, no nested cards. Two type families with a
real scale. Asymmetric grid, one dominant element, section padding that varies.
Real numbers with dates; never an invented customer or statistic. Semantic HTML,
content visible at rest, no `transition: all`. One italic phrase. Copy that could
not describe any other product.
