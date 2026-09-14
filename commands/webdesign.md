---
description: Build a website in the studio house style, or audit one that already exists
---

Use the `ultimate-frontend-skills` skill for everything below. Follow its rule zero: build the
files and keep design reasoning out of your reply.

The user's brief is: $ARGUMENTS

If the brief names a directory that already contains HTML, treat this as an audit
and upgrade: run
`node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" audit <dir>`, fix every error
and every warning worth fixing, then walk `references/checklist.md`.

If a Claude Design project or handoff is supplied, follow the skill's Claude Design
reference and implement that design before auditing it. Preserve it - typography,
spacing, composition, palette - instead of rebuilding it in the house style, and
prove you did:
`node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" verify <dir> --design <seeded canvas>.html`
must not report the design ERROR. The scaffolding sequence below applies only when
there is no supplied design.

Otherwise build a new site:

1. Decide the subject, the register (an object, a place, a service, or an
   argument) and the hero. Ask at most one question, and only if the subject is
   genuinely unknown.
2. Pick the preset and the sections from the register table in the skill, then
   scaffold:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" new <dir> --preset <bone|ink|cinema> --name "<Name>" --sections <ids>`
3. Rewrite every word. Set the hero image and `--accent-h`. Add one signature
   element drawn from the subject's own world.
4. `node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" audit <dir>` must exit 0.
5. Render it and look:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" look <dir>` - it must report
   no overlap and no overflow, and you must read the PNGs it writes.

Then report in two sentences with the file paths, and nothing else.
