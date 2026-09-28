# Motion graphics: explainers, launch films, brand reels

`references/video.md` is how UFS renders a video (a page, a pure function of
time, rendered frame by frame). This file is how a company motion piece is
made well: the stages, how long the copy may be, how long type stays on
screen, and where the look comes from. Read `video-tells.md` beside it.

Sources are named per rule. Where the evidence is one studio's guide it says
so; numbers nobody could source (logo-sting length, reading time per word of
kinetic type, a launch film's structure) are left out rather than guessed.

## The stages, as UFS runs them

1. **Brief and script.** What the viewer should know or do at the end, in one
   sentence, then the narration or on-screen copy, counted (below) before
   anything moves.
2. **Style frames.** Two or three stills that fix the look: type, colour,
   texture, the one move. In UFS they are a `video scene` rendered as stills
   (`video render --draft`, then `video <draft.mp4> --frames 6`).
3. **Animatic.** The whole film at draft quality with the timing final and the
   motion rough: `video render <scene.html> --draft`. Timing is decided here,
   not after the final.
4. **Final.** `video render <scene.html>` with the sound laid under.

`video lint <dir>` checks a scene before a render: copy density and captions.

## How long the copy may be

A studio guide (Yum Yum Videos, "explainer video script") sizes narration at
about 150-160 spoken words a minute: "A 90-second script with 400 words is not
a 90-second script." Count the words before animating; reading them faster
rarely fixes it.

| Runtime | Words (at about 150 a minute) |
|---|---|
| 30 s | 75-80 |
| 60 s | 150-160 |
| 90 s | 225-240 |
| 2 min | 300-320 |

`video lint` warns above 2.7 words a second (about 160 a minute), counting the
scene's visible text and a `script.txt` or `vo.txt` narration beside it
(check id `video-script-density`, `data/ai-tells.json` V1).

The same guide's 90-second explainer runs Problem (0-15 s), Solution
(15-30 s), How it works (30-65 s), Proof (65-80 s), Call to action
(80-90 s). It is one studio's template, a starting point, not a rule.

Length and attention: Wistia's figures over more than 13 million videos put
average engagement at 52% for videos under a minute, 50% for product videos
and 46% for testimonials (wistia.com, "optimal video length").

## How long type stays on screen

No rule written for motion graphics was found. The best-documented one is for
subtitles, and it is about the same thing, text a viewer reads while the
picture moves: Netflix's English Timed Text Style Guide allows at most 42
characters a line, two lines, 20 characters a second for adults, and an event
on screen between 5/6 of a second and 7 seconds. UFS uses it for on-screen
copy as well as captions; `scripts/captions.mjs` holds the rules and `video
lint` checks any `.srt` or `.vtt` in the scene folder against them.

## Motion vocabulary

- **Productive and expressive** (IBM Carbon): productive motion is quick and
  functional, expressive motion marks the moments the viewer should notice.
  A film is mostly productive with a few expressive beats, not the reverse.
- **Hierarchy by duration** (Microsoft Fluent 2, fluent2.microsoft.design/
  motion): larger elements take longer, the important element gets the more
  prominent move and the longer duration, and choreography comes from
  staggering in order of importance. "Aim for a fast and smooth motion without
  making people wait."
- `references/motion.md`, "The motion scale", has the numbers.

## Where the look comes from

The type and texture come from the subject's world, not from a template.
Kyle Cooper's title sequence for *Se7en* (1995) is the standard example:
hand-etched scratchboard type with Helvetica, tabletop photography assembled
on an optical printer, because Fincher wanted it "drawn by hand, because it
was from the mind of the killer" (artofthetitle.com). Studios whose work is
worth studying for this, each from its own case-study page: BUCK (Notion AI's
character on a Rive state machine; Headspace's shape characters), Giant Ant
(Duolingo "Misunderstood": low-framerate 2D characters in tactile 3D rooms).
The catalogue, with every link, is `data/motion-studios-and-films.json`.

## When UFS's renderer is not the tool

| Deliverable | Reach for | Why, and the catch |
|---|---|---|
| One film, the house style, frame-exact | `video render` (this plugin) | No licence, reuses the chassis and the engines |
| Many variants from data (recaps, product clips at volume) | Remotion (v4.0.529, 2026-09-25) | `spring()`, `interpolate()`, `<TransitionSeries>`; renders locally, on Lambda or Cloud Run. **Licence:** free for individuals and companies of up to 3 people; 4 or more need a Company License (remotion.pro/license) |
| An HTML-to-video pipeline built for agents | HyperFrames (HeyGen, Apache-2.0) | The same model as `video render`; worth a benchmark on one scene before switching |
| Maths or technical explainers | Manim Community (v0.21.0, 2026-08-10) | Typst rendering, a faster Cairo renderer |
| Motion that responds (a character, states, live data) | Rive or dotLottie, not an MP4 | See `references/stack.md` |
| Joining rendered shots | ffmpeg `xfade` | Not an authoring tool |

Do not adopt Theatre.js for new work: development moved to a private
repository ahead of 1.0, and the public one was last pushed on 2024-08-14.
Motion Canvas's last release was v3.17.2 (2024-12-14).
