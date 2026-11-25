## This edition

This is the directory edition of Ultimate Frontend Skills: the doctrine, the
references, the award corpus and the copy-in chassis, as Markdown and JSON. It
ships no scripts, so the scaffolder, the audit, the render check, verify, the
award query tool, Blender, the image and video tools are not here. Never report
one of them as run. Where a reference says a step is "full edition only", do it
by hand as this file says, or tell the user it needs the full edition
(github.com/ridelink0/ultimate-frontend-skills, installed from its own
marketplace).

The copy-in files are Markdown here, one per file: `assets/core-css.md` holds
`core.css`, `assets/motion-js.md` holds `motion.js`, `assets/sections-html.md`
holds `sections.html`, and so on. Each holds the file in one fenced block;
write that block's contents, unchanged, into the site under the file's own
name. Nothing in this plugin runs on its own.

The award corpus is `data/awards-merged/part-01.json` to `part-03.json`, one
JSON array of sites per file, each with `name`, `url`, `award`, `kind`,
`techniques`, `palette`, `type`, `motion` and `why`. Search it with Grep (a
technique, a kind, a word in `why`) instead of the full edition's `awards`
tool, and pick three that disagree with each other.
