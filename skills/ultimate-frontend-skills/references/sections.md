# Composition

`assets/sections.html` has the library. Read this when you need a section that is
not in it, or when a composition is not sitting right.

## The grid

`core.css` gives you `.grid`: 12 columns with `[full-start] … [content-start] …
[content-end] … [full-end]` named lines. Children default to the content band;
`.bleed` goes edge to edge. Place things explicitly:

```css
.eyebrow  { grid-column: content-start / span 4; }
.headline { grid-column: content-start / span 7; }   /* offset, never centred */
.figure   { grid-column: span 6 / full-end; }        /* bleeds off the right */
```

**Asymmetry is the composition.** A 50/50 split reads as a template; `1.15fr /
0.85fr` reads as a decision. Indent the body copy one column further than the
headline it sits under. Let exactly one element break the measure.

`minmax(0, 1fr)`, never bare `1fr` - `1fr` is `minmax(auto, 1fr)` and one long
unbreakable string blows the track out.

Do not use the legacy `margin-inline: calc(-50vw + 50%)` full-bleed trick. It
produces a horizontal scrollbar unless you set `overflow-x: hidden` on `body`,
which then breaks `position: sticky`.

## Air

This is the highest-leverage variable in the whole aesthetic and it is
measurable.

| | Template | Premium |
|---|---|---|
| Section padding | 40px | **80-160px** |
| Between major sections | 40-60px | 80-120px minimum |
| Hero top/bottom | 48-64px | 120-200px |

`--section-y` is `clamp(5rem, 3rem + 9vw, 11rem)`. That is the floor.

**The tell is not the amount, it is the variance.** A page where every section
has identical padding reads as generated. Real editorial pacing alternates: a
dense spec table gets less, the section after a full-bleed image gets more. Vary
by content weight - `.section--tight` exists for exactly this - and the page
reads as authored.

## Sections the library does not have

### Dot leaders that actually align

The alignment problem: dots that begin after the title text will not line up down
the column. The fix is to attach the dot run to the row, not to the title, and
let the title and the number mask it. `.index` in `core.css` does this with a
flex spacer carrying a dotted bottom border, which aligns perfectly and needs no
character run.

If you want literal dots, the W3C pattern is a `::before` float with a long
period string and opaque backgrounds on the two spans. Either way:
`aria-hidden="true"` on the leader so a screen reader does not announce forty
periods, `min-width: 2ch` and `tabular-nums` on the numeral so 1 and 11 align.

### Stat trio

`.stats` / `.stat` in `core.css`. Three things make it read premium: line-height
**below 1** on the numeral, negative tracking at that size, and the caption
capped at ~26ch so it actually breaks to two lines. Use
`repeat(auto-fit, minmax(15rem, 1fr))` - a hardcoded `repeat(3, 1fr)` is a listed
tell.

### Pull quote

1px border-inline-start in `--rule`, never a coloured 5px bar. Max 30ch. `cite`
in the UI face, uppercase, 0.14em, 0.6 opacity, `font-style: normal`.

### Drop cap

```css
@supports (initial-letter: 1 1) {
  .article > p:first-of-type::first-letter { initial-letter: 3 3; margin-right: 0.12em; }
}
```
`<size> <sink>` = lines tall, lines dropped. Safari 17+, Chrome 133+, no Firefox.
Float fallback for Firefox.

### Card rail

`.cards--rail` in `core.css`. Add `scroll-padding-inline: var(--gutter)` so cards
do not glue to the edge, and `scroll-snap-stop: always` where skipping an item
would be wrong. Native scroll-snap keeps keyboard, trackpad, touch and Ctrl+F
working - do not replace it with a JS carousel.

Section snap on a full page: **`proximity`, never `mandatory`**. `mandatory`
makes it impossible to rest between sections and fights the user on any section
taller than the viewport.

### Footer

Four equal link columns is a listed tell. Make one column wider - a colophon, an
address set in the serif, a single line of real prose - and let the rest be
narrow.

## Seen in the wild

Rendered with `webdesign.mjs study` on 7 Sept 2026. What is specific, not what
is generic.

- **Publications table** (Anthropic Research): DATE / CATEGORY / TITLE columns,
  11px uppercase column heads, hairline rows, dates in tabular figures, a
  search field at the right of the heading. The editorial answer to a blog
  grid - and it scales to hundreds of rows without becoming a wall of cards.
- **Line drawings as the imagery for abstract subjects** (Anthropic Research):
  a protractor and ruler drawn on green graph paper, a ruled plate behind a
  headline. When the subject cannot be photographed - research, policy,
  software - a technical illustration in one consistent hand does the job a
  photograph does elsewhere. `references/imagery.md` has the drawing rules.
- **Run-in small-caps labels** (Hodinkee): `INTRODUCING` / `DISPATCH` /
  `BREAKING NEWS` set in 10px letterspaced caps at the start of the card
  title, same line, not a pill above it. Encodes the kind of piece without a
  badge.
- **Object on white** (Apple): the product as a cut-out on a plain ground with
  one soft contact shadow, a bold sans headline under it, then rounded-corner
  photo cards in a snap rail with the price as a 12px caption. Sixty percent of
  each screen is empty. This is the `bone` preset with the serif swapped for a
  grotesk, and it is the register for a made thing sold at a price.
- **A single identifiable hand** (Teenage Engineering): black-line comic
  illustration and a monospaced label system, nothing else. One drawn voice
  across the whole site beats any amount of stock.
- **What headless cannot see**: WebGL sites (lusion.co, igloo.inc) render only
  their preloader in a headless browser; Cloudflare walls (Aesop, Cartier) and
  cookie modals (Kinfolk, Hodinkee) cover the first screen. `study` now skips
  a render with almost no text and says `wall`; for the rest, read the
  `-y900` tile, which is usually below the modal.

## Glass

`.card--glass` in `core.css`. The numbers:

| Property | Value |
|---|---|
| `blur()` | 4-25px, 22px default |
| `saturate()` | **160% minimum** |
| fill opacity | 0.10-0.15 decorative, 0.55+ if it carries text |
| border alpha | 0.25 on light, 0.12 on dark |
| shadow | `0 22px 50px -28px rgb(0 0 0 / .6)` |

`saturate()` is the one people omit. Blur averages toward grey; saturate restores
the chroma. Omitting it is the single reason cheap glass looks like fog. The
`inset 0 1px 0 rgb(255 255 255 / .3)` highlight is what makes it read as a
physical pane catching light.

Silent breakages:
- `backdrop-filter` creates a stacking context **and a containing block for
  fixed/absolute descendants** - a glass header breaks a fixed nav inside it.
- An element with `opacity < 1`, any `mask`, `clip-path`, `filter`, or
  `mix-blend-mode` becomes a backdrop root and **kills its own blur**.
- Nested glass double-blurs: the child's backdrop is the parent's already-blurred
  output.
- Safari needs `-webkit-backdrop-filter`.

Do not use it for body text over an uncontrolled backdrop (worst-case contrast
must still be 4.5:1), for data-dense surfaces (blur haloes small glyphs), over
flat backgrounds (nothing to blur), or on more than about two surfaces at once.
For this style, glass belongs on a floating nav, a caption card over a
photograph, or one specs overlay. Not on feature cards.

## Forms

`.field` in `core.css`: no boxes, a single bottom hairline, the label in the UI
face at 11px uppercase. Focus moves the border to `--accent`.

Netlify forms need `data-netlify="true"`, a hidden `form-name` input matching the
`name`, and a honeypot: `netlify-honeypot="company"` plus a hidden labelled
field. Every visible input needs a real `<label for>`.

## The eight tells to avoid

Measured across ~1,400 pages: 22% hit four or more of these.

1. **Indigo/violet-to-pink gradients.** `#6366f1`, `#4f46e5`, `#8b5cf6`,
   `#a855f7`, and `from-blue-600 to-purple-600`. Traceable to one Tailwind UI
   decision in 2020, which its author has publicly apologised for.
2. **Untouched framework defaults.** `rounded-lg`, `shadow-md`, `max-w-7xl`,
   `gray-900`, `<div class="container mx-auto px-4">`. Not that Tailwind was
   used - that nothing was configured.
3. **One sans doing display, body and UI.** Inter or `system-ui` everywhere with
   no display face. The tell is not that Inter is bad; it is that Inter unchosen
   means nobody made a typography decision.
4. **Emoji as icons.** Structurally, not just aesthetically: emoji are colour
   bitmaps from the OS font, so they cannot inherit `currentColor`, cannot take
   stroke weight, and change per platform. They are incapable of being part of a
   design system. Stroked SVG on a 16/20/24 grid.
5. **Three equal feature cards with an icon circle on top.** Plus the full
   skeleton: hero + subhead, two CTAs, three-col features, logo wall,
   testimonial carousel, pricing table, CTA repeat, four-column footer.
6. **Centred everything.** `text-center mx-auto` on every block, so nothing
   establishes an alignment axis and nothing has tension.
7. **Uniform radius and uniform padding.** 16px radius on every component, 24px
   padding everywhere, identical card heights. Real systems tier the radius by
   role, and nested radii are never equal: inner = outer - padding.
8. **Shadows doing the job spacing should do**, plus identical section padding
   and "Empowering X with Y" copy. All one failure: hierarchy asserted by effect
   instead of rhythm.

Copy tells, which matter as much: *"In today's fast-paced world"*, *"Unleash the
power of"*, *"Revolutionize"*, *"Leverage cutting-edge"*, *"Empower your team
to"*, the *"Build faster. Ship smarter."* headline shape, the *"not just X, it's
Y"* antithesis, tricolons, *delve*, *tapestry*, *orchestrate*, and em-dash density
four to six times normal.

## Micro-details

- **Cursors.** `cursor: url("x.svg") 12 12, crosshair` - **the fallback keyword is
  mandatory**; without it the whole declaration is invalid and discarded. Hotspot
  coordinates are image pixels from the top-left. 32x32 recommended, 128x128 hard
  cap. Gate on `(pointer: fine)`, never over interactive controls, and accept that
  they override the enlarged pointer some users deliberately set.
- **Selection.** Only `color`, `background-color`, `text-decoration`,
  `text-shadow` and the `-webkit-text-*` properties are honoured -
  `background-image` is silently discarded, so gradient selections do not exist.
  Kill `text-shadow` in the selection or it fights the highlight.
- **Tabular numerals** on anything that aligns vertically or updates in place.
- **Nested radii**: inner = outer - padding, or the corners visibly disagree.
