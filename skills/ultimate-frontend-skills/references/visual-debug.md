# Review the rendered website

Run from the installed plugin directory with Node 22+ and Chrome, Edge or Chromium:
    
    node scripts/webdesign.mjs debug <site-directory-or-url> --out <review-directory>
    node scripts/webdesign.mjs debug <site> --actions actions.json --widths 1440,390 --motion both
    node scripts/webdesign.mjs video <local-video> --frames 8 --out <frames-directory>

Debug captures desktop/mobile at top, middle and bottom, then each interaction,
both with normal and reduced motion. It writes PNGs, review.html and review.json.
The local preview uses an isolated loopback port and closes when capture ends.
Video extraction additionally requires FFmpeg and ffprobe on PATH.

An actions file is a JSON array:

    [
      {"type":"click","selector":"button.menu-toggle"},
      {"type":"expect-visible","selector":"nav.mobile-menu"},
      {"type":"expect-text","selector":"nav.mobile-menu","text":"Contact"},
      {"type":"focus","selector":"a.contact"}
    ]

Supported actions: click, hover, focus, expect-visible, expect-text. Selectors
must come from the actual page. Use test data and test environments for actions
that submit or change data. Each action is replayed for every viewport and motion
mode. A failed action is an error, even when a later screenshot looks fine.

## Required AI review

1. Run the source audit and project tests. Run debug on the actual built website.
2. Open the PNGs using the host's image-viewing tool: Claude Code Read for local
   images, Codex view_image or an available browser screenshot tool. An HTML
   gallery is also provided for human review. Reading JSON alone is insufficient.
3. Inspect every affected viewport, scroll and interaction state. Check text
   clipping, occlusion, sticky headers, menus, focal point, image crops, spacing,
   fallback content, focus state and motion continuity. Compare reference frames
   in timestamp order. For sky scenes inspect lighting; for product scenes inspect
   rotation and separation; for landscapes inspect foreground/background movement.
4. Fix defects and repeat. Record the screenshot filenames actually opened,
   states exercised, findings fixed and any untested states. If the host cannot
   view images, report visual review as blocked; do not mark it passed.
5. A clean automated report means no detected errors in those sampled states.
   It does not establish design quality, reference fidelity, accessibility
   conformance, full keyboard coverage or animation smoothness.

Console exceptions and HTTP/network failures are captured after interactions too.
Canvas size and uniform-pixel checks supply clues, not a verdict: WebGL buffers can
read blank after compositing, and solid-color canvases can be intentional. Inspect
the screenshot and fallback. Reduced motion must retain readable content.
Cross-origin frames, native dialogs, drag gestures and typing are not automated by
this command; cover them with the host browser tools when applicable.

Keep captures local unless publication is requested and their content is suitable
for sharing. Do not commit authenticated pages, personal data or reference videos.

## Measuring the running page

`webdesign.mjs quality <dir|url>` (or `debug --measure`) measures what a
screenshot cannot show. Run it before saying a page is finished, and read it
alongside the pictures rather than instead of them.

| Flag | What it does |
| --- | --- |
| `--widths 1440,390` | which viewports to measure |
| `--record MS` | how long to watch frames for (default 1600) |
| `--travel PX` | how far to scroll when measuring parallax (default 700) |
| `--expect-depth` | the page is supposed to have planes; say so if it has none |
| `--json` | the raw numbers as well as the verdicts |

What each finding means, and what to do about it:

- **"canvas painted once and never changed"** under normal motion. If it is
  meant to be alive, it is not. Check the render loop is running and that the
  element is on screen; an off-screen canvas is paused on purpose.
- **"canvas still animating under prefers-reduced-motion"**. This is an error,
  not a preference. Draw one frame and stop.
- **"N declared planes all move at the same rate"**. The parallax is in the
  markup and not on the screen. The engine is not attached, or the transform is
  being overwritten.
- **"loaded and never used"**. Delete the script tag, or use the library.
- **"N distinct type sizes"**. Sizes that differ by one or two pixels are not
  steps in a scale; collapse them.
- **"largest type on the page is Npx"**. The house style opens at display
  scale. A hero that tops out at 32px is not a hero.
- **"frames cost N ms each (no vsync headless)"**. Read the worst frame, not
  the rate: headless is uncapped, so the rate flatters. Nothing important is
  judged on frame rate for exactly that reason - see the jank finding below,
  which counts work instead.
- **"scrolling forces N layouts per scroll event"**. Measured across one real
  driven scroll, not a teleport. A scroll handler that reads a geometry
  property (`getBoundingClientRect`, `offsetTop`, `scrollHeight`) and then
  writes a style in the same pass forces a synchronous layout per element per
  event. The detail line names the file and the invoker the browser itself
  attributed it to, and the forced-layout milliseconds. Fix by reading
  everything first and writing afterwards, or by moving the write into a
  custom property the compositor can handle.
- **"N long animation frames during the scroll"**. A warning, never an error on
  its own: on a loaded machine any page can produce one. It only means
  something next to the layout count above.
- **"layout shift X (budget 0.1)"**. The detail line now names the elements
  that actually moved and how far, taken from the browser's own layout-shift
  sources. The element named is where the reserved space is missing.
- **"N looping animations still running under prefers-reduced-motion"**. Only
  ever reported from the pass that NAVIGATED with the media emulated, so a
  page that reads `matchMedia` once at boot is never falsely accused. Wrap the
  animation in `@media (prefers-reduced-motion: reduce)`, or check the media
  before starting it.
- **"clicking X threw"** / **"X moved out from under the pointer"** /
  **"no visible focus indicator on X"**. Every interactive element on the page
  is clicked and tabbed to (capped at 16, links that navigate are skipped).
  The focus check compares outline, box-shadow, border, background, colour,
  filter and transform between focused and unfocused, so `outline:none` with a
  box-shadow ring is correctly silent. Only a shift whose source rect contained
  the click point is reported - a panel opening below is not a defect.
- **"request never resolved after Nms"**. A same-origin script, stylesheet,
  font or image that produced neither a response nor a failure. It is invisible
  to every other check because there is no 404 and no error to see.

A page that passes every budget can still be wrong. The budgets catch the
failures that a still frame hides; the still frames catch everything else.
