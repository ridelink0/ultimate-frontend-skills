# Image Deep Research

**Image deep research and visual research for Claude Code and Codex.** Find
reference images on open, licensed collections with every URL verified and
every licence kept, render real websites into screenshot contact sheets,
measure a live site's palette and typefaces, and build moodboards - then read
the pictures as pictures.

Most design questions are answered by looking at twenty examples, not by
reading one article about them. This plugin gets those twenty examples in
front of the model in one or two image reads, and holds it to what it
actually saw.

![A moodboard of eight public-domain works found for "cypress trees" at the Art Institute of Chicago and the Met, each tile labelled with its source and licence.](docs/img/moodboard-cypress-trees.jpg)

<sub>Real output of `node skills/image-deep-research/scripts/images.mjs "cypress trees" --sources aic,met --n 6 --sheet`, 2026-09-26: the first of two sheets, every URL fetched and verified before it was tiled. All eight works are CC0. Not every hit is a cypress, which is why the skill reads the sheet before it recommends anything.</sub>

```
/plugin marketplace add ridelink0/image-deep-research
/plugin install image-deep-research@image-deep-research
```

Codex and the other routes are under [Install](#install).

It also ships inside [Ultimate Frontend Skills](https://github.com/ridelink0/ultimate-frontend-skills),
which carries this skill as its image research route. If you already have
UFS installed you have this skill: do not install both, or the skill will show
up twice.

## What it does

**Open image collections, no keys.** `images.mjs` searches
[Openverse](https://openverse.org) (Creative Commons and public-domain images
from Flickr, museums and more), [Wikimedia Commons](https://commons.wikimedia.org),
the [Art Institute of Chicago](https://www.artic.edu/open-access) (public-domain
works only) and [the Met](https://www.metmuseum.org/about-the-met/policies-and-documents/open-access)
(Open Access works only). Each result keeps its title, creator, licence,
licence URL and source page. Every image URL is fetched before it is reported,
and one that does not answer with an image is marked as failed and never put
on the moodboard. `--commercial` keeps only licences that allow commercial use
and changes; `--sheet` tiles the verified images into a numbered moodboard;
`--download` saves them.

**Real websites, rendered.** `study.mjs` loads each site in headless Chrome,
Edge or Chromium, screenshots the top and one screen down, and tiles the shots
eight to a contact sheet. It measures what the browser computed: the ground
colours by element-rectangle area (overlaps can count twice), text colours by amount of text, and heading
and body typefaces with size, weight and line height. A page that answers
with a bot challenge or Access Denied, or renders next to nothing (a
preloader), is reported as a wall with the reason and kept off the sheet
rather than guessed at. Four curated lists come
with it: `editorial`, `object`, `cinema`, `product`.

**A method, not just a search.** The skill runs research in rounds: write the
question so a picture can answer it, gather, read the sheets, search again
with the better words the first round taught you, and stop when a new round
stops changing the answer. The report lists sheet paths, every recommended
image with its verified URL and licence, and one concrete move per reference.

## Install

### Claude Code

```
/plugin marketplace add ridelink0/image-deep-research
/plugin install image-deep-research@image-deep-research
```

or from a terminal:

```bash
claude plugin marketplace add ridelink0/image-deep-research
claude plugin install image-deep-research@image-deep-research
```

### Codex

```bash
codex plugin marketplace add ridelink0/image-deep-research
codex plugin add image-deep-research@image-deep-research
```

Codex reads the same `.claude-plugin/marketplace.json` and the plugin's
`.codex-plugin/plugin.json`.

### Any agent the skills CLI knows

```bash
npx skills add ridelink0/image-deep-research
```

This copies the skill folder, scripts included, into every agent it finds on
the machine. It installs the skill only, not the slash commands.

### Requirements

Node 22 or newer (the scripts use its built-in `fetch` and `WebSocket`; there
are no dependencies to install). Rendering needs Chrome, Edge or Chromium; on
Windows Edge is usually already there. Set `IDR_BROWSER` to the browser
executable if it lives somewhere unusual. On Linux it also finds the Chromium
that Playwright downloads (`$PLAYWRIGHT_BROWSERS_PATH`, `~/.cache/ms-playwright`
or `/opt/pw-browsers`), and when it runs as root, as in many containers, it
starts the browser with `--no-sandbox`, which Chrome needs there
(`IDR_NO_SANDBOX=1` asks for that flag without root). The browser always runs
headless and never opens a window. Image search alone needs no browser.

## Use

Ask a question that is better answered by looking:

> What do the first screens of luxury watch sites have in common? Show me.

> Find public-domain reference images of brutalist concrete interiors for a moodboard.

Or start it directly:

| Claude Code | Codex | What it does |
|---|---|---|
| `/image-deep-research:image-deep-research <topic>` (or `/image-deep-research`) | `$image-deep-research:image-deep-research` | The full research loop |
| `/image-deep-research:find-reference-images <subject>` | `$image-deep-research:source-command-find-reference-images` | Search the open collections and build a moodboard |
| `/image-deep-research:website-contact-sheet <urls or list>` | `$image-deep-research:source-command-website-contact-sheet` | Render sites into contact sheets with palette and type |

The scripts also run on their own:

```bash
node skills/image-deep-research/scripts/images.mjs "cypress trees" --sheet --commercial
node skills/image-deep-research/scripts/study.mjs https://stripe.com https://linear.app
node skills/image-deep-research/scripts/study.mjs --list editorial --width 390
node skills/image-deep-research/scripts/study.mjs https://example.com --width 390 --reduced-motion
```

Output goes to a temporary folder that is printed at the end (`--out <dir>`
to choose one): the sheets as JPEG, the screenshots as PNG, and
`results.json` or `report.json` with everything measured.

**Compact mode (1.1.0).** Every picture the model reads stays in the
conversation and is sent again on every later turn, so in a coding session
add `--compact` to either script. It draws one sheet of up to 16 tiles with
only a number badge on each: 1288x812 px, which Anthropic's vision pricing
(28 px patches) puts at exactly 1,334 image tokens on every Claude model,
against 2,852 for one of the eight-tile sheets on the high-resolution
models (1,064 on the others). A JPEG over 150,000 bytes at
quality 80 is taken again at 70 and then 60 (sixteen website screenshots came
out at 131-141 kB at 80; a very busy sheet can stay over). Text is one line
per result (number, source, licence, title, creator) or per site (ground,
ink, heading and body type), with no URLs; `images.mjs --compact` searches
4 per source instead of 6. The numbers on the tiles and the lines are the
same numbers, and
`images.mjs --pick 3,7 --results <out>/results.json` prints the full record of
the ones you keep (licence URL, image URL, source page) without touching the
network. On the fixtures, 16 results print in about 1,500 characters, where
the full table for 24 prints about 8,200.

```bash
node skills/image-deep-research/scripts/images.mjs "cypress trees" --compact
node skills/image-deep-research/scripts/images.mjs --pick 3,7 --results /tmp/image-deep-research/images-.../results.json
node skills/image-deep-research/scripts/study.mjs --list product --compact
```

## What it cannot do

### Evidence and safe downloads in 1.2.0

Each screenshot keeps its own computed-style probe, actual viewport, reached
scroll position, capture time and reduced-motion preference. Hidden ancestors
are excluded when choosing text, heading, images and canvases. Requested phone
width and actual layout width can differ on a page without a viewport tag;
the report records the actual width. A still image does not establish motion
quality, and element rectangles are not a pixel-level palette measurement.

An image URL check establishes HTTP status and a supported raster Content-Type;
it does not verify the licence or decode the pixels. Downloads and moodboards
also check raster file signatures, cap each image at 20 MiB, and save PNG,
JPEG, GIF or WebP bytes before the sheet browser opens them. Private and
special-use IPs, credential-bearing URLs and redirects into private networks
are blocked for collection/API requests; DNS answers are checked and pinned to
the socket. API JSON is capped at 2 MiB. Sheets use these local files, retaining
tile numbers when a later download fails. The browser separately reports
whether each local raster actually decoded.

The study browser intentionally visits the URLs the user selected, including
local development URLs. It is a fresh profile, not a network sandbox. Do not
give it untrusted internal targets. No dependencies, binary payloads or
install-time downloads were added to the plugin.

### Limits

It cannot see behind a bot wall or a login, and a WebGL site may screenshot as
its preloader; it says so instead of guessing. Unsplash and Pexels need a free
API key, so they are not searched; the skill explains how to use them if you
have one. A licence is reported as the collection states it: check the source
page before shipping an image in a product.

## Development

```bash
npm test            # units, manifests, command rules, CLI errors, and the browser half
npm run test:live   # the four collections, live (not run in CI)
```

CI runs `npm test` on Ubuntu and Windows with a real Chrome and fails if any
test is skipped, so the browser half always runs there.

### Keeping Ultimate Frontend Skills in step

UFS vendors `skills/image-deep-research/` from a tagged release of this repo
with its `scripts/sync-image-research.mjs`, which records the version and a
sha256 of every file in a lock file; a UFS test fails if the bundled copy
drifts from the lock. Change the skill here, tag a release, then sync UFS to
the tag.

## Keywords

image research, deep research, image deep research, visual research, reference
images, design references, moodboard, mood board, contact sheet, website
screenshots, competitor research, colour palette, typography, public domain
images, Creative Commons images, Openverse, Wikimedia Commons, Claude Code
plugin, Claude skill, Codex plugin.

## Credits

- Built by [Gev](https://github.com/ridelink0).
- The skill began as the `visual-research` skill in
  [Ultimate Frontend Skills](https://github.com/ridelink0/ultimate-frontend-skills);
  `scripts/browser.mjs` is vendored from its `scripts/inspect.mjs` (MIT), and
  the curated site lists follow its study lists.
- Image data from [Openverse](https://openverse.org) (WordPress Foundation),
  [Wikimedia Commons](https://commons.wikimedia.org), the
  [Art Institute of Chicago API](https://api.artic.edu/docs/) and
  [The Metropolitan Museum of Art Collection API](https://metmuseum.github.io/).
  Each image keeps its own licence and creator; this project claims none of
  them.

## License

MIT. See [LICENSE](LICENSE).
