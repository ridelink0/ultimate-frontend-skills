---
name: image-deep-research
description: Image deep research and visual research - use when a question is better answered by looking than by reading. Finds reference images on open, licensed collections (Openverse, Wikimedia Commons, the Art Institute of Chicago, the Met), renders real websites into screenshot contact sheets, builds a moodboard, measures a live site's palette and typefaces, and reads every picture as a picture. For design references, styles, palettes, typefaces, materials, competitors and moodboards.
argument-hint: "<topic, style, palette, typeface, competitor list, or URLs to look at>"
---

# Image deep research

Most design questions are answered by looking at twenty examples, not by
reading one article about them. This skill gets the pictures in front of you
cheaply, checks that they are real, keeps the licence beside every one, and
then makes you read them before you say anything about them.

The request is whatever the user typed with the skill. If it is empty, ask one
question: what should be looked at.

## Where the scripts are

The scripts live in `scripts/` next to this file. In Claude Code that folder
is `${CLAUDE_SKILL_DIR}/scripts`. In Codex, or anywhere that variable comes
through empty, use the `scripts` folder beside this SKILL.md. They need Node 22
or newer and nothing else; rendering needs Chrome, Edge or Chromium (set
`IDR_BROWSER` to the executable if it is somewhere unusual). The browser runs
headless and never opens a window.

## The loop

Deep research here means rounds, not one search:

1. **Write the question down** in a form a picture can answer. "What do
   luxury watch sites look like" produces mush; "what ground colour, what
   headline size, and what the first screen shows on six luxury watch sites"
   produces numbers you can build with.
2. **Gather** from the two sources below: real sites for how a thing is done
   on the web, open collections for subjects, palettes, materials and art.
3. **Read the contact sheets**, then only the two or three individual images
   worth a closer look. A sheet of eight costs one read instead of eight.
4. **Refine and go again.** The first round tells you the right words: the
   name of the style, the photographer, the typeface, the movement. Search
   again with them. Stop when a new round stops changing the answer.
5. **Report** (see the end of this file).

## Render real sites - the highest-signal source

```bash
node "${CLAUDE_SKILL_DIR}/scripts/study.mjs" <url> <url> ...
node "${CLAUDE_SKILL_DIR}/scripts/study.mjs" --list editorial
```

Each site is rendered in a headless browser at the top and one screen down
(`--scroll 0,900`, `--width 390` for a phone read), tiled into contact sheets
eight to a sheet, and measured: the ground colours by painted area, the text
colours by amount of text, and the heading and body typefaces as the browser
computed them. The measurements print per site and land in `report.json`
beside the sheets. Curated lists: `editorial`, `object`, `cinema`, `product`.

Two things it cannot see, and it says so rather than guessing: a page that
answers with a bot challenge or Access Denied, or renders next to nothing (a
preloader, an empty script shell), is reported as a wall with the reason and
kept off the sheet; and a canvas-heavy page is flagged, because its
screenshot may be a preloader frame. For those, try the `y900`
tile, a longer `--wait 8000`, or a video walkthrough of the site.

## Find images on open collections

```bash
node "${CLAUDE_SKILL_DIR}/scripts/images.mjs" "<query>" --sheet
node "${CLAUDE_SKILL_DIR}/scripts/images.mjs" "<query>" --commercial --download --sources openverse,commons
```

Searches Openverse (Creative Commons and public-domain images from Flickr,
museums and more), Wikimedia Commons, the Art Institute of Chicago (public
domain works only) and the Met (Open Access works only). No keys. Every result
URL is fetched before it is reported, and one that does not answer with an
image is marked FAIL and never put on the moodboard. `--commercial` keeps only
licences that allow commercial use and changes (it drops NC and ND). `--sheet`
tiles the verified images into a numbered moodboard; `--download` saves them.
Results, with title, creator, licence, licence URL and source page, go to
`results.json`.

Unsplash and Pexels need a free key for their APIs; with one, their CDN URLs
can be used directly. Check them the same way: an image URL is not a result
until it has answered with an image.

## Design galleries, for finding sites worth rendering

Awwwards, Godly, Land-book, SiteInspire, Minimal Gallery, Curated.design,
One Page Love. Fetch the gallery page, pull out the outbound site URLs, then
render them with `study.mjs`. A gallery's own thumbnails are small and
colour-shifted: render the real site instead.

## Inside Ultimate Frontend Skills

This skill also ships inside the Ultimate Frontend Skills plugin. When
`${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs` exists (in Codex: a
`scripts/webdesign.mjs` in the plugin folder that holds `.codex-plugin/`),
there is a corpus of award-winning sites to pick references from by
technique:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" awards "<topic>" --verbose
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" study --awards "<topic>" --n 6
```

When that file is not there, this is the standalone plugin: skip this
section and find sites through the galleries above.

## Reading what you got

Go in with the question from step 1. Worth extracting every time: the type
pairing and sizes, the ground colours, where the accent appears, section
rhythm, what the first screen does, and the one move you have not seen before.
The `report.json` numbers are what the browser computed; the sheet is what a
person sees. Use both, and say which one a claim comes from.

## Report

- The file paths of the contact sheets and the moodboard.
- Every image you recommend with its verified URL, creator, licence and
  source page. Nothing without a licence goes in a deliverable.
- Per reference, the one concrete move worth taking, with the number
  (a colour, a size, a spacing) when there is one.
- What could not be seen (walls, preloaders, failed URLs), said plainly.

## Do not

Do not describe an image you have not opened. Do not treat a gallery thumbnail
as evidence of colour. Do not conclude a site uses a library because the
effect looks like it - check the bundle. Do not ship an image whose licence
you have not read, and do not drop the attribution a CC BY licence requires.
