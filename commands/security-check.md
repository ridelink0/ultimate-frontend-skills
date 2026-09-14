---
description: Check a built website for leaked secrets, unsafe forms, unpinned CDN scripts, missing security headers and quiet disclosures
---

Run the security check on the site directory I name (or the current one):

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" security <dir>
```

Read `${CLAUDE_PLUGIN_ROOT}/skills/ultimate-frontend-skills/references/security.md`
first if you have not this session; it says what each finding means and the
fix for each.

Then report every finding in severity order - what, where, the fix - and do
not summarise. A secret is "remove and rotate", never "remove". If the site is
already deployed, run the three curl checks the reference lists against the
live URL and report those results too. If the command printed nothing, say
that the source is clean and that the live checks have not run; do not call
the site secure.

Fix what I ask you to fix. Do not edit the check to make a finding go away.
