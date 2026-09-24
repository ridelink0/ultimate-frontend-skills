# Video: references in, a finished MP4 out

A video here is a web page rendered one frame at a time. The page exposes
`window.ufsFrame(t)`, the whole film as a pure function of time; the renderer
seeks it to every frame in a headless browser, screenshots the viewport and
pipes the PNGs into ffmpeg (H.264, yuv420p, CRF 16, `+faststart`). Nothing is
recorded in real time, so a slow machine gives a slow render, never a dropped
frame, and the same scene renders the same file twice.

Everything the house style knows about type, colour, grain and restraint
applies. Read `video-tells.md` before writing a single shot; it is to video
what `tells.md` is to pages.

## The route

1. **Budget first.** Run the usage-limits check if it is installed. Rendering
   costs no tokens; writing and re-writing the scene does. On a tight budget
   the order is fixed: study, write once, one draft, look, one final. Never
   iterate by re-rendering finals.
2. **Study every reference.** Stills are looked at. Clips are read as frames:
   `video <clip> --frames 12`, then open every frame in timestamp order. Name
   what makes the reference look the way it does (lens, grade, pace, type)
   before borrowing any of it.
3. **Scaffold.**
   `video scene <dir> --refs a.jpg,b.mp4 --seconds 15 --size 1080x1920 --title "..."`
   copies stills in as plates, links clips by file URL (footage is often
   gigabytes), writes study frames for each clip, `video.json` (defaults for
   the render) and `scene.html`, a working cut that already follows
   `video-tells.md`.
4. **Write the film.** Rewrite `scene.html` for the brief: the copy, the shot
   order, the lengths, the one move each shot makes. Keep `ufsFrame` pure -
   no `Date.now`, `performance.now`, `Math.random`, timers or autoplay. Any
   randomness is a function of `t` or the frame index. Clips are seeked, not
   played; the scaffold's seek code is the pattern.
5. **Draft.** `video render <dir>/scene.html --draft` - half resolution, fast
   encode, `draft.mp4`.
6. **Watch it.** `video <dir>/draft.mp4 --frames 12` and open every frame.
   Check it against `video-tells.md` line by line. A contact sheet is one
   command: `ffmpeg -i draft.mp4 -vf "select='not(mod(n,15))',scale=320:-2,tile=4x3" -frames:v 1 sheet.png`.
7. **Final.** `video render <dir>/scene.html [--audio track.m4a]` -> `video.mp4`.
   With audio the encode ends at the shorter of the two.

## What renders

- Anything that paints in Chrome: DOM, CSS, SVG, canvas 2D, WebGL (the
  engines in `assets/`, three.js), `<img>`, and `<video>` seeked per frame.
- A page with no `ufsFrame` still renders: every CSS/Web Animation and a GSAP
  global timeline are paused and seeked to `t` instead. Anything driven by its
  own `requestAnimationFrame` clock will not be frame-exact - convert it to a
  function of `t`.
- Sizes: 1080x1920 for TikTok, Reels and Shorts; 1920x1080 wide; 1080x1080
  square; 1000x1500 for a Pin. Sides are rounded down to even numbers.

## Limits, stated plainly

- No audio mixing beyond laying one track under the picture.
- No generated footage. A clip nobody shot does not appear in the cut; if the
  brief needs one, say so and use a still, type, or a made thing in three.js.
- Fonts load from the network in the scene; render with a connection, or
  self-host the woff2 beside the scene.
