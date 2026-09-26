# Changelog

Releases before 6.5.0 are recorded in their tag commits (`git log v6.4.2`) and on the GitHub releases page.

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
