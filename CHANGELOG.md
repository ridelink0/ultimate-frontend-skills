# Changelog

Releases before 6.5.0 are recorded in their tag commits (`git log v6.4.2`) and on the GitHub releases page.

## 6.8.1 - 2026-09-28

From Doodle Voyager's to-do list: a game is checked at the sizes it is played at even when nobody remembers `--game`.

- `look`, `debug` and `verify` on a local page with a canvas and keyboard controls (WASD, the arrows, Space, pointer lock) default to 1366, 1280 and 1920 instead of 1440 and 390; a page that also listens for touch gets 390 back. The keys are looked for in the page, its local scripts and the relative modules those import (Doodle Voyager's are in `js/game.js`, which `js/main.js` imports). Vendored libraries are not read, so a three.js page with OrbitControls stays a page. `--widths` and `--game` still win (`scripts/args.mjs`, `test/args-game.test.mjs`).
- `references/games.md`, "In-game rendering", item 5 names the target resolutions (1366x768, 1280x720, 1920x1080) and says a phone width comes only with touch controls.

## 6.8.0 - 2026-09-28

Built from the 2026-09-28 research plan (16 items). The audit now names the AI tells that research sourced, and the chassis was changed until it ships none of them, so a page that passed 6.7.0 can now warn on its reveals, counters, loops or hover lift, and fail on a loop with no pause control.

### The audit and the chassis
- `scripts/tells.mjs` runs the checks proposed in `data/ai-tells.json` (the research's tells, each with its source): one reveal on most sections, the card hover lift, a progress bar on a short page, an uncited count-up, overshoot on a dialog, `scale(0)` and ease-in entrances, too many durations and easings, the cursor glow, a loop with no pause (an ERROR, WCAG 2.2.2), the shadcn default variables, the lucide feature set, scaffold furniture, the emerald success green, the section waterfall, a raster in a logo SVG, mixed icon sets, and three game checks (`event.key` for WASD, an AudioContext never resumed, a loop that ignores `visibilitychange`). Each finding carries its check id and the data's "instead". The palette check knows Tailwind v4's own oklch values.
- `core.css` and `motion.js`: reveals in four verbs (`.r`, `.r--mask`, `.r--settle`, `.r--none`) used by content, one group per section, with sections left still; `.card:hover` changes its rule instead of lifting; literal durations are the `--dur` tokens; a `[data-pause]` button holds every CSS animation and `gradient.js`, the marquee holds under the pointer and focus, and hero-gradient ships the button; a `data-count` counts up only beside a source, and the stats section has a Source line. `core.css` also ships a cross-document view transition inside `prefers-reduced-motion: no-preference` and `--ease-spring`, a damped spring sampled into `linear()`.
- Both examples carry the new engines and no longer lift cards; houston-roofing's gradient hero gets the pause button.

### References
- New: `motion-graphics.md` (company pieces: stages, copy length, type on screen, the tools to reach for instead), `editing.md` (the order a cut is decided in, J and L cuts, loudness and caption targets, the edit tools), `graphic-design.md` (a brand as a system, one icon set, Radix's 12 steps as colour roles, WCAG 2.2 plus APCA Lc 75 on dark grounds, composition).
- `motion.md`: what the chassis reveals and leaves still, page transitions, springs and the Web Animations API, and the motion scale scoped to page choreography with Carbon's, Atlassian's and NN/g's UI numbers. `stack.md`: dotLottie or Rive (canvas, webgl2, canvas-lite) or CSS, and Rive's price. `apps.md`: motion in an app (Material 3's spring split, Reanimated 4, Apple's HIG Motion, SwiftUI's spring defaults). `games.md`: feel, accessibility, input and platform, engines, portals. `ui.md`: CSS animation triggers as not yet. `awards.md`: what 2026's case studies were built with. `typography.md`: the GRAD axis.
- Every AI tell from the research is a row in the reference for its domain (tells, motion, video-tells, games, image-tells), generated from `data/ai-tells.json`; a test keeps the two in step.
- Every reference over 40 KB opens with a contents list of its headings (`scripts/contents.mjs`). The research proposed splitting those files; that would have broken every "`references/<file>.md`, section" citation, so they stay whole.
- `SKILL.md` is 12 KB (it was 24 KB): the verify and security prose moved to `references/checklist.md`, and the description now triggers on motion graphics, company videos and footage editing.

### Tools
- `video lint <dir>`: copy density (over 2.7 words a second warns) and captions checked against Netflix's reading rules (`scripts/captions.mjs`, which also splits timed words into cues and writes SRT).
- `webdesign.mjs edit probe|scenes|transcribe|captions|cut|deliver`: ffprobe with EBU R128 loudness; scene cuts by PySceneDetect or ffmpeg `scdet`; whisper.cpp transcription; captions from a transcript; auto-editor's silence cut; two-pass loudness to a delivery target, measured again after. A missing program is named and the command exits 2. Checked against auto-editor 29.3.1, PySceneDetect 0.7.1 and whisper.cpp b5130.
- `webdesign.mjs games portal-check <build dir>`: the CrazyGames size and file limits, requests to other hosts and unguarded localStorage.
- The render check prints APCA Lc beside the WCAG ratio (apca-w3 0.1.9, checked on six pairs) and warns on body text on a dark ground that passes WCAG and falls under Lc 75.

### Data
- The awards corpus: each row has tags (whole vocabulary terms), the picker compares tags instead of whole sentences, `--technique` matches a tag, an award row with no year is dropped at build (the 18 undated rows are references and stay undated), eight new rows and four stack patches from the research.
- Pins read against npm on 2026-09-28: three 0.186.1, motion 13.4.4, @rive-app/canvas 2.43.1, pixi.js 8.21.0, p5 2.3.4, plus @rive-app/webgl2 and @lottiefiles/dotlottie-web; @unseenco/taxi stays at 1.9.1 (2.0.0 is a major). `test/pins.test.mjs` holds the three.js pin everywhere and, with `UFS_NETWORK=1`, reads the registry.

### Tests
- `npm run test:fast` runs every file with the browser switched off (`UFS_NO_BROWSER=1`), and CI runs it before the full suite. `UFS_TEST_TIMEOUT_MS` raises every browser test's timeout on a loaded machine.

### Not done from the plan
- The Remotion agent skills were not installed and the ecc chrome-devtools MCP was not re-pointed: both change what Claude Code loads, which is Gev's call. The commands are `npx skills add remotion-dev/skills` and `npm i -g chrome-devtools-mcp` with the MCP entry pointed at that binary.
- HyperFrames was not benchmarked against `video render`.
- The game-feel numbers (shake, hitstop, coyote time), the FWA and Awwwards annual winners, and the platforms' own caption and safe-area specs stay unverified: their pages rendered no content or are talks, not pages.

## 6.7.0 - 2026-09-28

A page that passed the 6.6.0 audit can fail this one: on demo content 6.6.0 left unmarked, on a local file the page asks for that does not exist, or on a counter whose number was not rewritten. The render check now fails body-size text under 3:1, which it used to warn about.

### A correction to 6.6.0
- The 6.6.0 note said every instruction, stand-in and demo specific in `assets/sections.html` was marked. It was not: the exploded-3d part list, the stats numerals, the hero eyebrow date, the index section's contents (headings taken from the launch page the showcase recreates) and the blueprint caption were unmarked, and a page that rewrote exactly what the audit named kept all of them and passed.

### Scaffold and audit
- The rest of the demo is marked: the watch's parts, the bridge's numerals, the `Viewpoint` card label, the exploded callouts and the drawing's caption and dimension. The launch-page contents and the eyebrow date are replaced by marked stand-ins, and the part `Case` is now `Middle case`, so no marked piece is part of another.
- The audit errors on a local `src`, `href` or `poster` that points at no file (a root-absolute path is read from the site root; a path with no extension may be `name.html` or `name/index.html`), and on a `data-count` that does not match the number its text shows: `motion.js` counts up to the attribute and writes it over the text.
- `motion.js` no longer treats an exploded-3d part's `data-count` (a chain's link count) as a counter; it wrote "5" over the part's name. The two examples carry the fix.
- The scaffolded 404 uses root-absolute URLs for its stylesheets, scripts and links. A host serves it at whatever address was missing, and at `/menu/today` its relative URLs resolved under `/menu/`: no styles, and a way home that was another 404. It assumes the site is served from the root of its domain. Both example 404s are corrected.
- The preview server (`serve`, `look`, `verify`) answers a missing address with the site's `404.html` and status 404, as the static hosts do.
- After `new`, the scaffolder prints the audit command with the plugin's full path, quoted for the shell, so it runs when pasted; it was `node webdesign.mjs audit`, which failed outside the plugin. Its file list now names every file it wrote, `sky.js`, `404.html` and `img/` included.
- `test/scaffold-copy.test.mjs` obeys the audit on a scaffold of every section under every hero (rewrite what it names, add what it says is missing, fix the counters it names) and fails on any library text left on the page that is not interface copy.

### Render check and verify
- The header's colour rule in `core.css` nested `:has()` inside `:has()`, which browsers reject, so it was dropped and the default bone preset shipped its nav at 1.06:1. The header now takes the page ink, and light type only over an opening hero (`#top`) that sets its type on media or is dark-toned. A hero with type on media is a dark field until its media paints, so hero-photo reads before a photo is added.
- Contrast: body-size text under 3:1 is an ERROR. Sampled contrast says what was behind the text (`photo`, `canvas`, `gradient` or `page`), from the elements actually painted there; it said "photo" for a bone page.
- A display heading (`h1`, `h2`, `.t-hero`, `.t-mega`) broken inside a word, with no hyphen, is a warning naming the word and the width.
- verify reports one finding per defect and lists the widths and motion modes it was seen at; a missing image was sixteen errors. The render check drops "image failed to load" when an HTTP 4xx already named that file.
- The body measure budget depends on the width: 30 to 80 characters under 700px, 45 to 80 above, and the finding names the width.

### Browser launcher
- The browser gets TEMP, TMP and TMPDIR inside its own temporary profile. Edge had left an `Importer_0_4` folder and `cv_debug.log` in the inherited TEMP on every page with a network request. A full suite with TEMP pointed at an empty folder left 65 such folders before this; the leak test now fails on any name left in its temp directory.
- One 45 s launch deadline on the clock (`LAUNCH_DEADLINE_MS`), the value the bundled image-deep-research uses; it was about 15 s and failed under load.
- A launcher ending in `.mjs` runs under Node, and `test/fixtures/stub-browser.mjs` stands in for a browser: one that hands off to a child and exits 0 (HQ-2, now tested, including that closing it ends the child), one that answers after 17 s, and one that never answers.

### Records, docs and install
- HQ-12 cited run 36216733416 as green on both runners; it failed on Ubuntu and was cancelled on Windows. It now cites 36222752391 on 4d26192. `docs/field-tests/ci-runs.json` records every cited run as `gh` returned it, and a test checks each citation's sha and stated result against it.
- `docs/field-tests/doodle-voyager.md` maps each of Gev's seventeen items to where it went, item 10 included, and DV-13 is closed without a harness scaffold, with the reason.
- The README no longer says a bare word finds a command: with many plugins installed, another plugin's command can rank first. The full `/ultimate-frontend-skills:` prefix lists them all.
- `assets.mjs` reads its User-Agent version from `package.json` (it said 5.0.0). `docs/HANDOFF-v5.md` is removed, and a link two renames old in `docs/audit-2026-09-07/README.md` is fixed. Tests fail on a broken relative link in the shipped markdown and on an off-version plugin version in a shipped file.
- `webdesign.mjs tools` says when Codex loads a copy of this plugin's skills from `~/.agents/skills` beside the plugin enabled there.
- `graphify-out/` is ignored.
- The bundled image-deep-research is 1.0.1: its browser gets `--disable-component-update` and a private TEMP.

## 6.6.0 - 2026-09-26

A page scaffolded by 6.5.1 and audited by 6.6.0 can now fail on scaffold copy the old audit did not know about: that is the point of the release, not a regression.

### Scaffolder landmarks
- `webdesign.mjs new` puts the skip link and the primary nav before `<main id="main">` and the footer after it, wherever `--sections` lists them. Before, all three sat inside `<main>`: the skip link's target started before the skip link, so the next Tab went back to it, and a screen reader found no navigation or contentinfo landmark outside the content.
- The 404's skip link stays `#main`. The rewrite that points the 404's other links back at the index had turned it into `./#main`, which sent a keyboard user to the home page. The shipped `examples/fable-showcase` pages had both defects and are corrected.
- `test/scaffold-landmarks.test.mjs` checks the order in every preset and with a reordered `--sections`. In a real browser it presses Tab, Enter, Tab on the index and the 404, and reads the landmarks from the accessibility tree.

### Scaffold copy
- The audit takes its list of scaffold copy from the section library: every instruction, stand-in and demo specific in `assets/sections.html` is marked `[[like this]]`, and the scaffolder strips the marks. It used to know 19 phrases, so a page that rewrote exactly those passed with its `<title>`, meta description, `og:description`, `alt` text and a dozen more instructions still on it. The 19 phrases stay as a net for a piece that was only half rewritten.
- Each piece left is named, with where it sits (`<title>`, meta description, `og:description`, `alt`, text). A piece of three words or fewer counts only as a whole text node, attribute or sentence, so "what happens next" inside real prose is not a hit.
- The 404 carries the index's meta description and `og:description`; left unwritten, it now fails on them instead of warning about their length. The shipped `examples/fable-showcase/404.html` had both and is corrected.
- `test/scaffold-copy.test.mjs` scaffolds every section and, for each marked piece, rewrites every other one and requires the audit to name it. It also reruns the judge's trial (only the old 19 phrases rewritten) and requires exit 1 naming the title, meta description and alt text.

## 6.5.1 - 2026-09-26

6.5.0 was tagged on a commit whose Windows CI job failed. 6.5.1 is the same feature set on a commit that is green on Windows and Ubuntu, plus the fixes below.

### Install hygiene
- `webdesign.mjs tools` lists every copy of this plugin's skills outside the plugin, says whether it is current or stale (compared file by file), and says when Claude Code loads it beside the plugin's own copy.
- A bare skill install (`npx skills add`) ships no scripts. SKILL.md now says what to do then: run them from a clone, or say they are not installed and never report a check as run. The README says what the skills route leaves out, and the "registers the plugin" line follows the installer it belongs to.

### Gev's play review of Doodle Voyager (2026-09-25)
- `docs/field-tests/doodle-voyager.md` DV-14 to DV-30: fifteen lessons from the owner playing the live game, in his own words, plus the profile leak and the lesson behind all of them (nobody played it before the owner did). Each ships as a numbered rule in `references/games.md` ("Playing it"), with a sixteen-question play pass at the end of that file and a games block in `references/checklist.md`.
- The hand-drawn look: light whitens the texture, with hatching toward the edges, and never adds brightness (`references/three.md` section 12). The render check warns when more than 15% of a WebGL canvas is clipped to pure white.
- Screen effects a player feels in their body get their own control with a real zero (`references/motion.md`). The audit warns when a script drives camera shake or motion blur and never reads `prefers-reduced-motion` with `matchMedia()`.
- The audit warns when a project mixes sound through an `AudioContext` and a `<video>` or `<audio>` element that is not muted plays outside that mix.

### Browser launcher and temp folders
- A machine whose WebGL is dead (a VM, CI, a remote desktop) is relaunched on SwiftShader, and the report says when WebGL ran in software; a machine with a working GPU is not touched. Recorded as HQ-12, with the practice for checkers and pages in `references/visual-debug.md`, "A machine with no GPU".
- `closeBrowser()` waits for the browser to be gone and deletes its `webdesign-cdp-*` profile with retries, and anything it cannot catch in time is removed at exit; each process's first launch sweeps stale profiles. `runVerify()` takes `out`, and no test leaves a `webdesign-review-*` folder in the temp directory. Every launch passes `--disable-component-update`, so Edge's updater no longer leaves `msedge_url_fetcher_*` folders in the temp directory.

## 6.5.0 - 2026-09-25

### Slash commands
- One slash command per capability, so each thing UFS does can be started directly and found by the words people type: scaffold-website, audit-website, render-check-website, verify-website, measure-website-performance, preview-website, inspect-website-styles, design-parity-check, photo-parallax-layers, blender-3d-model, pbr-textures-hdri, generate-website-image, video-from-references, game-start-screen, app-screen-design, frontend-tools-bench and frontend-skill-packs. They are user-invoked only, so their descriptions stay out of every session's context.
- No command body uses `$ARGUMENTS` any more. Codex silently skipped every command that did when it migrated them to skills; Claude Code still appends the typed text on its own. Every command carries an argument-hint and says where the plugin root is when `CLAUDE_PLUGIN_ROOT` is empty (Codex).
- `test/commands.test.mjs` holds both hosts to the rules: every command parses, routes to a skill or script that exists, runs only real subcommands, survives the Codex command migration, and is listed in README and AGENTS.md.

### Image deep research
- The image research skill now lives in its own repository, github.com/ridelink0/image-deep-research, and is bundled here at v1.0.0. `scripts/sync-image-research.mjs` copies it from a tag and writes `image-deep-research.lock.json`; a test fails when the bundled copy drifts from the lock.
- `/ultimate-frontend-skills:image-deep-research` is the bundled skill itself. `visual-research` stays as an alias that loads it. Do not also install the standalone image-deep-research plugin next to UFS: the skill would be listed twice.

### CSS currency (checked 2026-09-25)
- `.stagger` reveal lists derive their step from `sibling-index()` (Baseline newly available since 2026-08-18) behind `@supports`, with the `.r-2` to `.r-5` classes kept as the fallback.
- The references record the verified status of grid-lanes, corner-shape, `if()`, container scroll-state queries and P3 colour, each with the fallback to emit. `test/modern-css.test.mjs` holds the tables and measures the stagger offsets in a real browser.

### Field tests: Doodle Voyager and HQ
- `docs/field-tests/` holds dated records of projects built with UFS: 13 lessons from Doodle Voyager and 11 from HQ, each with what happened, what UFS said, what it should have said, the fix and the regression check. `test/field-tests.test.mjs` fails when a record is incomplete or names a test or heading that does not exist.
- Render check: text inside fixed or sticky layers is measured (a game title screen used to report 0 text elements); a canvas in a closed overlay is a note, not an error; date, time and select controls narrower than what they show are reported as "control cut short"; a new `type` action and a per-step `wait` get through a key screen without writing the typed text to the report. `CANVAS_INIT` is exported.
- Security check: a Content-Security-Policy that refuses a URL the code itself loads is a high finding; deployable .md and .log files are a low finding; `.vercelignore` is honoured; a deploy link to a project named like a build folder (dist, build, out) is a warning.
- Audit: warns on a shader that gamma-encodes by hand ahead of UnrealBloomPass with no linear output colour space or OutputPass.
- References: games.md (shipping a networked game), apps.md (dashboards), three.md (field notes from a PBR lab), visual-debug.md (gated pages and game screens) and pipeline.md (the ship stage).
