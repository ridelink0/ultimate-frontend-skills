---
description: Check a built website for leaked secrets, unsafe forms, unpinned CDN scripts, missing security headers and quiet disclosures
argument-hint: "<built site dir>"
---

Run the security check on the site directory I name (or the current one):

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" security <dir>
```

`${CLAUDE_PLUGIN_ROOT}` is this plugin's folder. Codex runs this command as a
skill and leaves that variable empty; there, use the folder that holds
`.codex-plugin/`, three levels above this file.

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
