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
skills/ultimate-frontend-skills/references/      loaded on demand
scripts/webdesign.mjs             new / sections / add / audit / look / serve / parity / verify
scripts/inspect.mjs             headless-browser render check, over CDP
scripts/parity.mjs              built page vs its Claude Design artboards, same probes both sides
scripts/design.mjs              which Claude Design route exists here - reports, never enrols
scripts/cut.py                  photograph -> parallax planes via rembg
scripts/install.mjs             registers with both CLIs
commands/webdesign.md           the /ultimate-frontend-skills:webdesign slash command
commands/debug-website.md       /ultimate-frontend-skills:debug-website
commands/design-handoff.md      /ultimate-frontend-skills:design-handoff
commands/atelier.md             the compatibility alias for the old name
hooks/                          UserPromptSubmit nudge
```

Constraints:

- **Zero dependencies.** Node 18+, built-ins only. Do not add a package.json
  dependency block.
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
- Keep `SKILL.md` short. Depth belongs in `references/`, which is only read when
  needed. Frontmatter is loaded into every session; the body is not.
