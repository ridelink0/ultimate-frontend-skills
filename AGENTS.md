# ultimate-frontend-skills

This repo is a plugin for Claude Code and Codex. It teaches a coding agent one
art direction for websites and ships the code that produces it.

## If you are building a website

Read `skills/ultimate-frontend-skills/SKILL.md` and follow it. That is the whole entry point.
It is written for agents that do not load skills automatically, so it stands on
its own.

The two rules that matter most, restated here in case you read no further:

1. **Nothing about the design goes in your reply.** No palette, no type scale, no
   rationale. Build the files, then say what you made in one or two sentences
   with the paths.
2. **No emoji anywhere** - not in the page, the copy, the commit, or the reply.
   Icons are inline SVG.

## If you are working ON this repo

Layout:

```
.claude-plugin/plugin.json      Claude Code manifest
.claude-plugin/marketplace.json Claude Code catalogue (Codex reads this too)
.codex-plugin/plugin.json       Codex manifest
skills/ultimate-frontend-skills/SKILL.md         the doctrine
skills/ultimate-frontend-skills/assets/          core.css, motion.js, sections.html
skills/ultimate-frontend-skills/references/      loaded on demand; pipeline.md is the entry
skills/ultimate-frontend-skills/data/awards.json merged corpus; data/awards/*.json are its chunks
skills/image-deep-research/      VENDORED from github.com/ridelink0/image-deep-research - never edit here
image-deep-research.lock.json    upstream version, commit and sha256 of every vendored file
skills/visual-research/SKILL.md  the old name, kept as a typed alias that loads image-deep-research
scripts/webdesign.mjs           new / sections / add / audit / look / study / awards /
                                blender / assets / tools / serve / parity / verify
scripts/awards.mjs              the reference corpus: query, pick three that disagree, rebuild
scripts/blender.mjs             Blender headless: probe / run / glb / bake / frames
scripts/blender/*.py            the bpy templates it drives
scripts/assets.mjs              CC0 PBR textures, HDRI lighting, image generation with detection
scripts/tools.mjs               what else is installed on this bench, and what changes because of it
scripts/inspect.mjs             headless-browser render check, over CDP
scripts/parity.mjs              built page vs its Claude Design artboards, same probes both sides
scripts/design.mjs              which Claude Design route exists here - reports, never enrols
scripts/cut.py                  photograph -> parallax planes via rembg
scripts/install.mjs             registers with both CLIs
scripts/sync-image-research.mjs the only way skills/image-deep-research changes: --tag vX.Y.Z | --from <dir> | --check
commands/*.md                   one slash command per capability, /ultimate-frontend-skills:<name>
                                (the README "Slash commands" table lists them all):
                                app-screen-design
                                atelier
                                audit-website
                                awards
                                blender-3d-model
                                debug-website
                                design-handoff
                                design-parity-check
                                frontend-skill-packs
                                frontend-tools-bench
                                game-start-screen
                                generate-website-image
                                inspect-website-styles
                                measure-website-performance
                                pbr-textures-hdri
                                photo-parallax-layers
                                preview-website
                                render-check-website
                                scaffold-website
                                security-check
                                verify-website
                                video-from-references
                                webdesign
                                atelier is the compatibility alias for the old name
hooks/                          UserPromptSubmit nudge
```

Constraints:

- **Zero dependencies.** Node 18+, built-ins only. There is a `package.json`,
  but it carries metadata, `bin` entries and script aliases only - do not add a
  dependency block to it. `type: module` is set, which is why every runnable
  file here is `.mjs` or `.cjs` rather than `.js`.
- `skills/image-deep-research/` is vendored from its own repository,
  github.com/ridelink0/image-deep-research. Change it there, tag a release,
  then run `node scripts/sync-image-research.mjs --tag vX.Y.Z`. A hand edit here
  fails test/image-research.test.mjs against `image-deep-research.lock.json`.
  Do not also install the standalone plugin on a machine with UFS: the skill
  would be listed twice.
- `core.css` and `motion.js` are copied verbatim into user projects. A change
  there lands in every site built afterwards, so treat them as public API.
- `inspect.mjs` talks to Chrome/Edge/Chromium over the DevTools protocol using
  Node 22's built-in `WebSocket` and `fetch`. Do not add puppeteer.
- Every change to `assets/` or `scripts/` must keep
  `node scripts/webdesign.mjs audit` passing on a fresh scaffold:
  ```
  node scripts/webdesign.mjs new /tmp/t --name "T" && node scripts/webdesign.mjs audit /tmp/t
  ```
  A fresh scaffold is *expected* to fail on scaffold copy (and to warn about
  the placeholder images it cannot find) - that is the audit doing its job.
  Everything else must be clean.
- The corpus is data. `data/awards.json` is generated by `awards --build` from
  `data/awards/*.json`; edit a chunk and rebuild rather than hand-editing the
  merged file. A fabricated URL in there would poison every `study` run that
  followed, so entries carry a `verified` flag and the merge drops rows without
  a usable URL.
- `blender.mjs` and `assets.mjs` reach outside the machine. Neither may invent a
  key, and `tools.mjs` reports the presence of a credential, never its value.
- A command file needs `description` and `argument-hint` frontmatter and must
  not use `$ARGUMENTS`, `$1`-style placeholders, `{{ }}`, a shell-run backtick
  or a word starting with the at sign. Codex turns each command into a
  `source-command-<name>` skill at install and silently skips any file that
  breaks those rules or renders past 4,000 bytes; Claude Code appends the
  typed text as ARGUMENTS on its own. `test/commands.test.mjs` holds both
  sides to it, and to the README table.
- Keep `SKILL.md` short. Depth belongs in `references/`, which is only read when
  needed. Frontmatter is loaded into every session; the body is not.
