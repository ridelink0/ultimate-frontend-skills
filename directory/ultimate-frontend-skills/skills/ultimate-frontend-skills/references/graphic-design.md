# Graphic design: identity, icons, colour roles, contrast, composition

`references/typography.md` is the type; `image-tells.md` is generated
pictures. This file is the rest of what makes a page look designed rather than
assembled: a brand used as a system, one icon set, a job for every colour,
contrast that holds on dark grounds, and a composition with one place to look.
Sources are named per rule. Guidance from sites that could not be read for the
research this came from (NN/g, IBM, Atlassian, Uber, Material's site) is
absent here, not rejected.

## A brand is a system, not a logo

For any page that carries a brand, write these down before designing, and
keep to them. Spotify's published rules (developer.spotify.com/documentation/
design) are the model because they are complete and public:

- [ ] The lockup: which marks exist (Spotify: the full logo is the wordmark
      and the icon together) and when each is used.
- [ ] The minimum size (Spotify: 70 px on screen, 20 mm in print) and the
      clear space around the mark.
- [ ] The resting colour (Spotify Green) and what the mark does on a photo, on
      dark and on light.
- [ ] Positive, negative and one-colour versions, and the smallest one.
- [ ] The type, the imagery rules (Spotify: artwork is shown unmodified, with
      4 px corners small and medium and 8 px large), the motion, the voice.

A mark that fills every inch of its box, with template symmetry and no
one-colour or small version, is one image, not a system (`data/ai-tells.json`,
D1). Draw it on a construction grid.

## Icons: one set, one grid, one stroke

- One icon set per interface. Material Symbols (optical size 20-48 px; only 20
  and 24 px land on the pixel grid; weight 100-700, grade -50 to 200, fill),
  Tabler (a 24 px grid, 2 px stroke, MIT), Lucide (ISC), Phosphor (MIT).
- One grid (24) and one stroke, matched to the stem of the body text. Sizes 20
  and 24 are the crisp ones.
- Never mix sets or stroke widths on one page. The audit warns on either
  (`icons-mixed`, D3), and on a raster `<image>` inside a logo or icon SVG
  (`svg-embedded-raster`, D2).
- Sparkles, Zap, Shield, a bar chart and a check as feature icons is the set
  a generated page reaches for (W2, `web-lucide-slop-set`).

## A job for every colour

Radix's 12-step scale gives each step a role (radix-ui.com/colors, "Understanding
the scale"), and it is the clearest way to make sure no colour on a page is
there by accident:

| Steps | Role |
|---|---|
| 1-2 | app background, subtle background |
| 3-5 | component background: normal, hover, pressed |
| 6-8 | borders: subtle, interactive, strong and focus |
| 9-10 | solid fills: 9 is the highest chroma, 10 its hover |
| 11-12 | text: low contrast, high contrast |

Map the house palette onto it: the bone and ink grounds are steps 1-2, the
raised surface 3, the rules 6-7, the accent 9, `--fg-muted` 11 and `--fg` 12.
A colour that has no step has no job.

OKLCH is the space to author in: L is perceptual, and chroma above about 0.37
leaves sRGB and P3 (evilmartians.com, "OKLCH in CSS"). Tailwind v4 authors its
defaults in OKLCH, which is why the audit knows their OKLCH values too.

## Contrast

- **WCAG 2.2 AA is the rule**: 4.5:1 for body text, 3:1 for large text, and
  no rounding up (4.499:1 fails). It is the normative standard.
- **On a dark ground, also check APCA Lc 75 for body text.** APCA argues that
  WCAG 2's ratio overstates the contrast of dark colours, and light grey body
  text on near-black is where a page passes 4.5:1 and still reads poorly.
  APCA's own guidance: Lc 90 preferred for body, 75 the minimum, 60 for other
  content text, 45 for headlines, 30 the floor for placeholders and solid
  icons (git.apcacontrast.com, "APCA in a Nutshell").
- WCAG 3 has not chosen its method: the Working Draft of 2026-09-10 says the
  contrast algorithm "is yet to be determined", and does not name APCA.
- The render check prints both numbers on every contrast finding, and warns
  when body text on a dark ground passes WCAG and falls under Lc 75. Its APCA
  is apca-w3 0.1.9's, checked against that implementation's own values.

## Composition

- **One focal point per screen, off centre.** The rule of thirds (Smith, 1797)
  puts the subject on a third; it gives "more tension, energy and interest"
  than centring it. Leave space in the direction something moves or looks.
  The audit's centring warning is the checkable part of this.
- **Proximity before borders.** Group by space first (Gestalt proximity); a
  box around a group is the last resort, not the first.
- **Figure and ground** is the test for text on a photograph: if the text and
  the picture fight for which is in front, the scrim or the crop is wrong.
- **Subgrid** (Baseline widely available since September 2023) lets a card's
  insides sit on the page grid instead of on magic numbers: named lines pass
  into it, and with both axes on `subgrid` no implicit tracks are made.
- The grid itself comes from Müller-Brockmann's *Grid Systems in Graphic
  Design* and the International Typographic Style; the 1980s pushed back on it
  as dogma. Use it to decide, not to fill.

## Illustration

One drawn voice, from the subject's world. Corporate Memphis (the flat, bright,
long-limbed figures) has been a cliche since 2017 and is now used as parody
(D4). Generated lettering is never shipped: its stroke weights disagree across
the alphabet (D5).
