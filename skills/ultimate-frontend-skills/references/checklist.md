# Before you ship

Run `webdesign.mjs audit <dir>` first - it catches the mechanical failures. This
list is what the audit cannot see.

## Content

- [ ] Every word is about the real subject. No placeholder survives, and nothing
      reads like it could sit on a competitor's page unchanged.
- [ ] The headline makes a claim, not a category. "Roofs that survive a Gulf
      hurricane" beats "Quality roofing solutions".
- [ ] The paragraph under the headline adds a fact rather than restating it.
- [ ] Numbers are real numbers. If you do not have one, cut the stat rather than
      inventing it.
- [ ] No "unleash", "elevate", "seamless", "empower", "revolutionize",
      "cutting-edge", "in today's fast-paced world", "not just X, it's Y".
- [ ] Every claim a business could be held to is one the business actually made.
      Never invent a licence number, a certification, an award, a review, or a
      years-in-business figure - use a clearly-marked placeholder and say so.

## Type

- [ ] The display face is not Instrument Serif or Playfair Display.
- [ ] One serif family carries the page; the sans appears only in labels, nav and
      buttons.
- [ ] The hero is three lines, not one. `max-width: 16ch` is doing its job.
- [ ] Display line-height is below 1.0 and tracking is negative.
- [ ] Exactly one italic phrase on the page, on a verb or an abstract noun.
- [ ] Uppercase labels are tracked +0.14em or more; nothing lowercase is tracked.

## Colour

- [ ] No `#fff`, no `#000`, no zero-chroma grey anywhere.
- [ ] The accent appears on at most three elements.
- [ ] `--accent-h` came from the hero image, not from taste.
- [ ] Body text on the dark sections is `--bone-300`, not `--bone-100`.

## Composition

- [ ] At least one section is deliberately asymmetric.
- [ ] Section padding varies with content weight - not every section identical.
- [ ] Nothing is centred that did not earn it.
- [ ] There is one signature element, and only one.
- [ ] Radii are tiered by role, and no nested pair is equal.

## Motion

- [ ] With JavaScript disabled, the whole page is visible and readable.
- [ ] With `prefers-reduced-motion: reduce`, nothing translates or parallaxes and
      nothing is hidden. Test it: DevTools > Rendering > Emulate CSS media.
- [ ] Every scrubbed animation uses `linear` and a fill mode.
- [ ] `animation-timeline` is declared *after* the `animation` shorthand.
- [ ] No animation moves layout - transform and opacity only.

## The floor

- [ ] Exactly one `<h1>`; heading levels do not skip.
- [ ] Every image has `alt`, `width` and `height`. The hero has
      `fetchpriority="high"`; everything below it has `loading="lazy"`.
- [ ] Keyboard: tab through the whole page. Every focus stop is visible, and the
      skip link works.
- [ ] Every form control has a real label.
- [ ] Readable at 360px wide, and at 200% browser zoom.
- [ ] No horizontal scrollbar at any width.
- [ ] `look` reports no overlap and no overflow at 1440 and 390.
- [ ] `<title>`, meta description, favicon and Open Graph tags are all set and
      specific.
- [ ] Anchors clear the fixed header (`--nav-h` is being published by
      `motion.js`, or you set `scroll-margin-top` yourself).

## Then look at it

`node scripts/webdesign.mjs look <dir>` renders the page at 1440 and 390 in a real
browser, reports what only a rendered page can show - text over text, content
past the viewport, contrast against the actually-painted background, collapsed
elements, broken images - and writes a PNG at each width. **Read the PNGs.**

Nothing static catches a layer covering half the composition, a headline sitting
on a wordmark, or a colour that turned to mud once painted. All of those pass a
source audit cleanly. Looking is the check.

Open it. Not the code - the page. At 360px and at 1600px. If you can drive a
browser, drive it and take a screenshot.

Ask the two questions that matter:

1. If you removed the photograph, would anything be left? If not, the type and
   layout are not carrying their weight.
2. Chanel's rule: what is the one thing you would remove? Remove it.

## Then say almost nothing

Two plain sentences and the file paths. No palette, no type scale, no rationale,
no design vocabulary. Build it, hand it over, stop.
