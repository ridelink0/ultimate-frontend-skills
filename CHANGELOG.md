# Changelog

Releases before 6.5.0 are recorded in their tag commits (`git log v6.4.2`) and on the GitHub releases page.

## Unreleased

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
