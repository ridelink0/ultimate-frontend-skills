## Build

A Claude Design handoff is implemented in place, not built over: keep its
typography, spacing, composition and palette. A new site, by hand:

1. Copy `assets/core-css.md` into the site as `core.css` and
   `assets/motion-js.md` as `motion.js`, unchanged; put every choice of your
   own in a `site.css` beside them.
2. Pick the preset and the sections by register (the table below), and take
   each section's block from `assets/sections-html.md`. Wrap everything
   between the nav and the footer in `<main id="main">` (skip link, nav and
   footer outside it). In React or Astro, import `core.css` globally and keep
   the class names.

Then, in order:

1. **Rewrite every word.** Copy marked `[[like this]]` is scaffold copy:
   replace the whole piece, brackets included. Write concrete nouns; no
   "elevate/seamless/unlock/transform".
2. **Set the hero image**, then `--accent-h` in `site.css` to the hue of the
   subject's own material in it (`references/imagery.md`).
3. **Add the signature**: one element from the subject's own world. One.
4. **Check it by hand** (below). The full edition's audit is not here, so read
   the files against `references/checklist.md` and `references/tells.md`.
5. **Look at it.** If a browser or screenshot tool is available, use it at 1440
   and 390 px; otherwise say plainly that the page has not been rendered.
