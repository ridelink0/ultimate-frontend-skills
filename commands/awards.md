---
description: Pick award-winning reference sites to build against, and render them
argument-hint: "[query] or --pick object|place|service|argument"
allowed-tools: Bash, Read, Glob
---

Query the reference corpus that ships with Ultimate Frontend Skills - Awwwards
Site of the Day, Month and Year, FWA, three.js and Codrops demos, Godly,
Land-book, siteInspire, One Page Love and the studio sites that set the
standard - and render the picks so they can be looked at rather than read about.

Arguments: `$ARGUMENTS`

Run, in this order:

1. If the arguments name a register (`object`, `place`, `service`, `argument`,
   `3d`, `editorial`, `portfolio`) or are empty, pick three that disagree with
   each other:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" awards --pick <register> --n 3 --verbose
   ```

   Otherwise treat the arguments as a query:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" awards "$ARGUMENTS" --verbose
   ```

   If nothing matches, run `awards --techniques` and search again with a
   technique the corpus actually knows.

2. Render the picks and look at them:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" study --awards "$ARGUMENTS" --n 3
   ```

   Then **open the PNGs it writes.** A row in a table is not a reference. This
   step is the whole point of the command and skipping it wastes it.

3. Report back in plain prose: the three sites, and for each one the single
   specific move worth taking - the mechanism, not the mood. "The product
   rotates on a pinned section while the spec table scrubs in from the right,
   and the type never moves" is useful; "beautiful animations" is not. Then one
   line on what the page being built will do that none of the three do.

Do not describe the design system, the palette or the type scale in your reply -
rule zero in the skill still holds. Do not copy a reference; the corpus exists
to make a decision against, not to be reproduced.

`references/awards.md` has the technique taxonomy, what jurors actually score,
and which moves now read as dated.
