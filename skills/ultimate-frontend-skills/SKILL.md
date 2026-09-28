---
name: ultimate-frontend-skills
description: Use whenever a website, landing page, marketing site, portfolio, microsite, homepage, any public-facing web page, an app screen (mobile, desktop, PWA, Expo), or a game's site, start screen, menu or HUD is being built, redesigned, restyled, or made to "look better" - including plain HTML/CSS pages, Next/React/Astro sites, React Native screens, canvas and three.js games, and single-file pages. Also for motion graphics and company videos (an explainer, a launch film, a brand reel) and for editing footage (cuts, captions, loudness, delivery). Supplies the house style (editorial serif typography, warm-neutral and near-black grounds, cinematic imagery, layered scroll parallax, exploded technical views) plus a copy-in CSS chassis, a motion runtime, a section library, a scaffolder, an audit, a video renderer and editing tools.
---

# Ultimate Frontend Skills

The studio's house style, and the code that produces it: a pinned art
direction for projects without an existing design. A supplied or selected
Claude Design project takes precedence.

## Where the scripts are

Every `node "${CLAUDE_PLUGIN_ROOT}/scripts/..."` command here runs from the
plugin root. Installed as a Claude Code plugin, that is set. Codex
leaves it empty; there, use the folder that holds `.codex-plugin/`, two levels
above this file. Installed as a bare skill (`npx skills add`, or a copy under
`~/.claude/skills` or `~/.agents/skills`), only this folder is on the machine
and `${CLAUDE_PLUGIN_ROOT}` is empty or literal. Then:

1. Look for a clone of github.com/ridelink0/ultimate-frontend-skills (a folder
   holding `scripts/webdesign.mjs` beside a `.claude-plugin/plugin.json` named
   `ultimate-frontend-skills`) and use it as the root.
2. If there is none, the scaffolder, the audit, the render check and verify are
   not on this machine. Say so once, build from the references and `assets/`,
   and never report an audit, a render check or a verify as run. The full
   install is `git clone https://github.com/ridelink0/ultimate-frontend-skills`
   then `node ultimate-frontend-skills/scripts/install.mjs`.

## Rule zero

**Nothing about the design goes in your reply.** No palette, type scale,
tokens, section list or design vocabulary. Build the files, then say what you
made in one or two plain sentences and give the paths.

Never use emoji, anywhere. Icons are inline SVG.

Claude Design work: read `references/claude-design.md`, then run
`node "${CLAUDE_PLUGIN_ROOT}/scripts/design.mjs" detect`; never register,
consent or log in for the user, and never report a remote Design operation as
done without its result. Keep a supplied design's direction intact; otherwise
use the house style without an approval pass. For debugging or final
verification read `references/visual-debug.md`, run the render check and open
its PNGs.

## The route

`references/pipeline.md` is the build in nine stages with a gate at each. Read
it at the start and follow it; stage 3 decides **how the subject gets made**
(photographed, three.js, Blender, a sequence, or type only). First, on every
build:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" tools
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" awards --pick object --n 3
```

`tools` says what is on this machine and which deferred packs are absent
(`references/skill-packs.md`); `awards --pick` gives three award-winning
references that disagree, and `study --awards "<technique>"` renders them.
**If `frontend-design` is installed, it owns the aesthetic direction** and this
plugin supplies the chassis, motion, 3D and verification; never tell the user
to install something mid-build (`references/plugins.md`).

## Surfaces

| Surface | Read |
|---|---|
| A website | this file, then `references/pipeline.md` |
| An app (mobile, desktop, PWA, Expo) | `references/apps.md`: the first screen is a task; navigation before palette; empty, loading and error states first; platform conventions outrank the house style |
| A game's site or start screen | `references/games.md`: in-world UI, exact controls, real numbers; the eyebrow-headline-two-buttons stack is the tell |
| The game itself | `references/games.md`, then `references/three.md`: green checks are the floor; run the play pass with the controls in your hands |
| A video from references | `references/video.md`, `video-tells.md`; `motion-graphics.md` for an explainer or launch film; then `video scene`, `video lint`, `video render` |
| Footage someone shot | `references/editing.md`, then `edit probe/scenes/transcribe/captions/cut/deliver` |

Copy on all of them: `references/copy-tells.md`. Generated pictures:
`references/image-tells.md`, then `image-gen.md`. Identity, icons, colour roles
and contrast: `references/graphic-design.md`.

## Fix three things before you type

Hold, not print: **the subject** (named concretely), **the register** (an
object, a place, a service, or an argument), **the hero** (what the first
screen shows). If the brief does not say what the subject is, ask one
question; otherwise decide and go.

## Build

A Claude Design handoff is implemented in place, not scaffolded over;
`verify <dir> --design <seeded canvas>.html` measures whether it was kept. A
new site:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" new <dir> \
  --preset bone --name "Subject Name" \
  --sections nav,hero-photo,manifesto,services,stats,faq,contact,footer
```

It prints every file it wrote and the audit command to run. Then, in order:

1. **Rewrite every word.** Scaffold copy left on a page fails the audit. Write
   concrete nouns; no "elevate/seamless/unlock/transform".
2. **Set the hero image**, then `--accent-h` in `site.css` to the hue of the
   subject's own material in it (`references/imagery.md`).
3. **Add the signature**: one element from the subject's own world. One.
4. **Audit**: `webdesign.mjs audit <dir>` must exit 0.
5. **Render it and look**: `webdesign.mjs look <dir>` (1440 and 390, a real
   browser: overlaps, overflow, contrast on the painted ground, broken images).
   **Read the PNGs.** The only way to know a page looks right is to look.

`sections` lists the library, `add <id> --to <file>` inserts one, `serve <dir>`
previews. **No Node, or a framework?** Copy `assets/core.css` and
`assets/motion.js` as they are, take blocks from `assets/sections.html`, and wrap
everything between the nav and the footer in `<main id="main">` yourself (skip
link, nav and footer outside it). Copy marked `[[like this]]` is scaffold copy:
replace the whole piece, brackets included. In React or Astro, import
`core.css` globally and keep the class names.

## The rules that do the work

1. **One serif family, two optical sizes** (`opsz 72 wght 320` display,
   `opsz 16 wght 400` body; default Newsreader). `references/typography.md`
   names the faces that now read as machine-made.
2. **Display line-height under 1.0, tracking at or under -0.024em.**
3. **`max-width: 16ch` on the hero headline**: three lines make the space.
4. **Never `#fff`, `#000` or a zero-chroma grey.** Neutrals in hue 60-95; one
   accent on at most three elements.
5. **Real air, varied.** 80 to 160 px, never the same on every section.
6. **Grain always on**, too faint to see.
7. **Depth from layers, not effects**: one parallax relationship, and for a
   made thing one exploded view (`depth.js`, `exploded.js`); never hand-rolled
   SVG silhouettes.
8. **Motion earns its place.** Reveal by content (`.r--mask` a headline,
   `.r--settle` an image, body copy still; `references/motion.md`), the one
   parallax, nav shrink, one orchestrated moment. A loop gets a pause button.
9. **One italic accent phrase per page**; the audit fails at two.
10. **Never invent a specific**: no made-up counts, scores, testimonials or
    logos. Cut the element or mark it plainly as a placeholder.
11. **Copy is design material.** If it fits five hundred other products, it is
    not copy yet.
12. **Quality floor, unannounced**: one `<h1>`, visible focus, `alt` and
    `width`/`height` on every image, content visible without JS, reduced motion
    respected, readable at 360 px.
13. **Every state**: hover, focus-visible, active, disabled, loading, error,
    empty (`references/ui.md`, `references/craft.md`).
14. **Use the library**: `gradient.js`, `depth.js`, `sky.js`, `exploded.js` ship
    here; GSAP, three.js and anime.js are one script tag away
    (`references/stack.md`, including the tools by need).
15. **Spend boldness once.** Before shipping, remove one thing.

**The preset is a choice.** Warm off-white plus a serif is itself a recognised
machine-made look; what separates this is optical sizes, the asymmetric grid,
varied rhythm, ink-derived hairlines, an accent from the photograph. Use `ink`
or `cinema` when the subject suits night or photography (`references/tells.md`).

## What is in the box

`assets/core.css` is the chassis (tokens, type, grid, components, grain,
reveals, page transitions); **never edit it in a project**, put choices in
`site.css`. `assets/motion.js`: `.r` reveals, `data-px`, `data-tilt`,
`data-count` (counts up only beside a cited source), `data-magnetic`,
`data-split`, nav shrink, `[data-pause]`. Presets: `fable` (with `hero-fable`),
`bone`, `ink`, `cinema`. Choose sections by register:

| Register | Hero | Middle | Close |
|---|---|---|---|
| An object | `hero-split` | `blueprint`, `exploded`, `spec` | `cta` |
| A place | `hero-layered` | `stats`, `cards-rail`, `gallery` | `cta` |
| A service | `hero-photo` | `services`, `steps`, `stats`, `faq` | `contact` |
| An argument | `hero-photo` + `index` | `manifesto`, `quote` | `footer` |

**Default to photography**: one full-bleed photographic moment, a second
picture framed as a figure; `cut` makes planes from a photograph and exits 3
when it refuses a cut-out (never composite that one). `references/imagery.md`
has sourcing, licences and grades; `references/motion.md` the layered hero and
the exploded view; `references/fable.md` the launch page measured.

## References

Read one only when you need it.

| File | When |
|---|---|
| `references/pipeline.md` | **First.** Nine stages and their gates |
| `references/awards.md` | The corpus, techniques, what jurors score, 2026 case studies |
| `references/skill-packs.md`, `references/plugins.md` | Other packs and plugins, who owns what |
| `references/ui.md`, `references/craft.md` | Components and their states; what a senior does unasked |
| `references/three.md`, `references/blender.md` | Real-time 3D; when Blender is the answer |
| `references/image-gen.md`, `references/imagery.md` | Generated and photographic imagery |
| `references/stack.md` | Which library for which job, pinned versions, the tools by need |
| `references/typography.md`, `references/graphic-design.md` | Type; identity, icons, colour roles, contrast |
| `references/motion.md` | Reveals, page transitions, springs, parallax, the exploded view |
| `references/sections.md` | The grid, spacing, archetypes the library lacks |
| `references/tells.md`, `references/copy-tells.md`, `references/image-tells.md` | What gives generated work away |
| `references/games.md`, `references/apps.md` | Games and apps |
| `references/video.md`, `references/video-tells.md`, `references/motion-graphics.md`, `references/editing.md` | Video: rendering, tells, company pieces, editing footage |
| `references/fable.md`, `references/fable-showcase.md`, `references/briefs/dive-watch.md` | The launch page measured; the exemplar brief |
| `references/checklist.md`, `references/security.md` | Before it ships |

## Before you call it done

`webdesign.mjs verify <dir|url>` runs the audit, the render and quality pass,
the security scan and, with `--design`, the parity check, and gives one
verdict (`references/checklist.md`, "One command for all of it"). Run
`webdesign.mjs security <dir>` before any deploy: a secret is "remove and
rotate", and after the deploy the curl checks in `references/security.md` are
what prove the headers arrived. Then walk `references/checklist.md`, look at the
page at 360 and 1600 px, write your two sentences and stop.
