# Typography

`core.css` ships Newsreader + Instrument Sans + IBM Plex Mono and a computed
fluid scale. Read this when you are choosing a different face, or when the type
is not landing.

## Faces

The whole system is **one serif family at two optical sizes**. Same family at
`opsz 72 wght 320` for display and `opsz 16 wght 400` for body beats any pairing,
because real optical sizes are what let a 120px display and a 17px paragraph look
like the same voice instead of two fonts.

### Default

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,200..800;1,6..72,200..800&display=swap">
```

**Newsreader** (Production Type): `ital 0-1`, `opsz 6-72`, `wght 200-800`, real
italic, one variable file. Stands in for Tiempos, Galaxie Copernicus, Lyon. The
least-used-per-unit-quality serif on Google Fonts.

### Alternatives, by what the subject needs

| Family | Axes | Stands in for | Use it when |
|---|---|---|---|
| **Fraunces** | `ital`, `opsz 9-144`, `wght 100-900`, `SOFT 0-100`, `WONK 0-1` | GT Sectra, Recoleta | You want a face with a point of view. Display only above `opsz 100`. `SOFT 0, WONK 1, wght 300-400`. `SOFT` above ~30 looks like a children's book. |
| **Bodoni Moda** | `ital`, `opsz 6-96`, `wght 400-900` | Canela Deck, Ogg, Didot | Full Didone drama. Display only - hairlines break below 28px. Halve the negative tracking; its sidebearings are already tight. |
| **Literata** | `ital`, `opsz 7-72`, `wght 200-900` | Freight Text, Chronicle | Warmest long-read face available. Slightly bookish. |
| **Source Serif 4** | `ital`, `opsz 8-60`, `wght 200-900` | Publico Text | Excellent body face; display is corporate. |
| **Libre Caslon Display** | static 400 | Big Caslon, Canela | Genuinely handsome at 80px+. Hierarchy must come from size and colour, not weight. Pair with Libre Caslon Text. |
| **Playfair** (the 2023 family, NOT Playfair Display) | `ital`, `opsz 5-1200`, `wdth 87.5-112.5`, `wght 300-900` | Didot at real optical sizes | `opsz 1200 wdth 87.5 wght 400` is a different animal from Playfair Display. |
| **EB Garamond** | `ital`, `wght 400-800` | Sabon, Adobe Garamond | Reads *period*, not contemporary. Set 8-12% larger than the rest of the scale. |

Google's css2 axis order rule: **lowercase axes alphabetically, then uppercase
alphabetically**. `ital,opsz,wght,SOFT,WONK`. Any other order returns HTTP 400.

### Do not use

- **Instrument Serif.** Beautiful, free, and currently the single strongest
  "machine made this" signal - especially the italic-accent-word-mid-headline
  move, which is the catalogued vibe-coded reflex. It is also single-weight
  static: no optical sizes, no weight hierarchy. If a brief demands it, earn it:
  140px+, `-0.035em`, and never paired with Inter.
- **Playfair Display.** The wedding-template default. Its contrast collapses
  under 18px and its display tracking is loose out of the box.
- **Cormorant / Cormorant Garamond** below 64px - stems too light, x-height too
  small, reads flimsy.
- **Lora, Merriweather, PT Serif, Noto Serif, Georgia, Abril Fatface, Prata,
  Marcellus, Italiana, Cinzel, Gilda Display** - CMS and wedding-invitation
  defaults with no luxury register.
- **Space Grotesk + Instrument Serif + Inter/Geist** together. That is the
  documented generated-site trio. Break at least one leg of it.

### Sans and mono

Rank for this style: **Switzer > Instrument Sans > Archivo > Inter**. Inter and
Geist are the two most-generated sans faces on the web; using one is not wrong,
it is just not a choice.

- **Instrument Sans** (Google): `ital`, `wdth 75-100`, `wght 400-700`. The
  `wdth` axis gives a real condensed. This is the default in `core.css`.
- **Switzer** (Fontshare): the closest free match to Söhne / Suisse Int'l.
  `https://api.fontshare.com/v2/css?f[]=switzer@400,500&display=swap`. **Licence
  constraint: you may not self-host it** - the ITF Free Font License requires
  loading via their API. If the project must self-host, fall back to Google/OFL.
- **IBM Plex Mono** for numerals, indices and codes. Its italic is a real
  italic, not an oblique.

The art-directed move: mono for numerals and codes (`01 / 07`, `48°51'N`), sans
for word labels. Mixing both registers is what makes a microsite look designed.

### Loading

```css
html { font-synthesis: none; font-kerning: normal; font-optical-sizing: auto; }
```

`font-synthesis: none` makes a missing italic fail loudly instead of shearing the
roman. Use `font-kerning`, not `text-rendering: optimizeLegibility`.

`core.css` ships a metric-matched `@font-face` fallback ("Newsreader Fallback")
that kills the swap shift. If you change the display face, regenerate the
`size-adjust` / `ascent-override` numbers with Fontaine or Capsize.

## Scale

`core.css` has `--step--2` through `--step-7`, computed to land exactly on the
min at 360px and the max at 1600px, with a second flatter phase above 1600. To
generate another step:

```
v = 100 * (max - min) / (maxVw - minVw)          # the vw coefficient
r = (minVw*max - maxVw*min) / (minVw - maxVw)    # the rem offset, in px
font-size: clamp(min/16 rem, [v]vw + [r/16]rem, max/16 rem)
```

**Accessibility constraint: max must be <= 2.5x min**, or fluid type fails
WCAG 1.4.4 at 200% zoom. Always pair `rem + vw`; a pure `vw` term ignores the
user's root font size.

Do not run the fluid range to 2560. A hero interpolating linearly from 360 to
2560 is either too small on a laptop or absurd on a 27 inch.

## The numbers that separate editorial from blog

**Line-height by step.** Display sets *below* 1.

| Role | line-height |
|---|---|
| mega | 0.88 |
| hero | 0.92 |
| h1 | 0.96 |
| h2 | 1.02 |
| h3 | 1.08 |
| lead | 1.42 |
| body | 1.62 (1.55 on a narrow measure, 1.65+ on a wide one) |
| label | 1.1 |

Unitless everywhere, so `em`-sized children inherit correctly.

**Tracking.** Negative for display, positive for micro, always in `em`.

| Step | letter-spacing |
|---|---|
| mega | -0.035em |
| hero | -0.030em |
| h1 | -0.024em |
| h2 | -0.018em |
| h3 | -0.012em |
| body | 0 |
| caption | +0.004em |
| uppercase label | +0.18em (0.14 minimum, 0.22 for one or two words) |

Adjustments: **halve the negative values on a Didone**; an italic run wants
~0.008em less negative tracking than the roman around it; **add +0.004em to
everything on a near-black ground**, because light-on-dark bleeds optically.

The templated tell is a single global `-0.02em` on every heading.

**Measure.**

```css
.prose { max-width: 62ch; }         /* body */
.prose--tight { max-width: 52ch; }
.lead { max-width: 38ch; }
h1 { max-width: 16ch; }             /* forces three lines - this IS the move */
h2 { max-width: 22ch; }
```

A one-line hero cannot look expensive. `ch` shrinks under `oldstyle-nums`, so
set the measure on a container that does not carry them, or use `em`.

## Optical size

`font-optical-sizing: auto` maps `opsz` to the computed size in points, which is
right for text and wrong for display: at a 104px hero, Newsreader would sit at
`opsz 78` while its axis caps at 72. Override explicitly. Note that
`font-variation-settings` **overrides** `font-weight` and `font-style`, so once
you use it you must restate `wght` there too - which is why the `.it` rule in
`core.css` restates both.

Display weight is **300-400, never 600+**. Presence comes from size and negative
space.

## Wrapping and optical alignment

```css
h1, h2, h3, blockquote, figcaption, .lead { text-wrap: balance; }
p, li, dd { text-wrap: pretty; }
```

`balance` silently no-ops past 6 lines in Chromium and 10 in Firefox - it is a
heading tool, never a paragraph tool. `pretty` handles orphans, not widows, and
Firefox falls back harmlessly.

`text-box: trim-both cap alphabetic` (Baseline Aug 2026) removes half-leading so
a display line sits exactly on a rule. Purely additive. `core.css` sets it on
every heading and on `.eyebrow`.

Hanging punctuation is Safari-only. For a pull quote, negative-indent instead and
let Safari upgrade:

```css
.pullquote { text-indent: -0.42em; }   /* Newsreader; Bodoni -0.36, Fraunces -0.48 */
@supports (hanging-punctuation: first) { .pullquote { text-indent: 0; hanging-punctuation: first; } }
```

Left-edge optical alignment when a display line starts on a round or diagonal
letter: `margin-left: -0.02em` for `O C G Q S`, `-0.045em` for `A V W`,
`-0.03em` for `T Y`.

Hyphenate narrow measures (`hyphens: auto; hyphenate-limit-chars: 8 4 4`), never
display.

## The rhetorical italic

```html
<h1>Descent is gravity. <em class="it">Ascent</em> is arithmetic.</h1>
```

One italic phrase per page, on a verb or an abstract noun, never on a product
name. The italic file must actually be loaded - the `1,` branch of the css2 URL.

## Numerals

Split them by context. Almost no generated site does.

```css
.prose { font-variant-numeric: oldstyle-nums proportional-nums; }
.num, .data, table, .stat__n, time { font-variant-numeric: lining-nums tabular-nums; }
.mono { font-variant-numeric: tabular-nums slashed-zero; }
```

Oldstyle figures sit inside lowercase texture - the editorial choice for dates
and years in running text, wrong in a table. Prefer `font-variant-numeric` over
`font-feature-settings`, which overrides `font-variant` regardless of source
order and wipes inherited features entirely.

## Colour

Every neutral lives in **hue 60-95** in OKLCH. Mixing a cool grey into a warm
bone makes both read as dirty; if you need a cool note, shift the *accent*, not
the neutral. Keep chroma >= 0.008 on every neutral - a pure `C 0` grey next to
warm bone looks green by simultaneous contrast.

Measured contrast in the `core.css` palette:

| Pair | Ratio | Use |
|---|---|---|
| `--ink-800` on `--bone-100` | 12.4:1 | body |
| `--stone-600` on `--bone-100` | 5.15:1 | secondary text, 11px eyebrows |
| `--stone-500` on `--bone-100` | 3.17:1 | **rules and decoration only, never text** |
| `--bone-300` on `--ink-950` | 13.3:1 | body on dark |
| `--bone-100` on `--ink-950` | 18:1 | too hot for running copy |

Beyond ~12:1 the extra contrast buys no legibility and starts producing halation
on serif hairlines. `#000` is also a dead pixel on OLED, so scroll motion smears
against it.

### Deriving the accent from a photograph

1. Average a 64x64 crop of the subject's own material - leather, brass, patina,
   stone. Not the sky, not the shadow.
2. Convert to OKLCH and **keep only the hue**.
3. Set `--accent-h` to it. `core.css` supplies L and C: `oklch(58% 0.072 h)`.
   Chroma above ~0.10 reads as a brand colour and destroys the editorial
   register; below 0.04 it reads as a mistake.

Use the accent on **at most three elements** in the whole page. Editorial luxury
is a two-colour system whose accent is almost never visible.

## Hairlines

The alpha is asymmetric, and this is the craft point. A hairline on bone needs
~14% ink; the visually equivalent line on near-black needs ~16% bone. Mirroring
the same number produces dividers that vanish in dark sections. `core.css` uses
`--rule` / `--rule-soft` derived from `--fg` with `color-mix`, so every rule,
divider and focus ring shares the page's hue.

True 0.5px hairlines: never ship bare `0.5px` - engines that do not support
fractional border-width round it to 0. Progressive-enhance behind
`@media (min-resolution: 2dppx)`, or use
`box-shadow: 0 0 0 0.5px …` which costs no layout and follows `border-radius`.
`border-width: thin` is not a hairline; it computes to 1px everywhere.
