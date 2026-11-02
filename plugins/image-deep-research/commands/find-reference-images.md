---
description: "Find reference images for a topic on open, licensed collections (Openverse, Wikimedia Commons, Art Institute of Chicago, the Met), verify every URL, and tile them into a moodboard - image deep research"
argument-hint: "<subject, style, palette or material to find images of>"
disable-model-invocation: true
---

Find reference images with the image-deep-research skill. Read
`${CLAUDE_PLUGIN_ROOT}/skills/image-deep-research/SKILL.md` first and follow
its loop and its report.

The subject is the text the user typed with this command (Claude Code appends
it below as ARGUMENTS; in Codex it is the rest of the message). If it is
empty, ask one question: images of what.

`${CLAUDE_PLUGIN_ROOT}` is this plugin's folder. Codex runs this command as a
skill and leaves that variable empty; there, use the folder that holds
`.codex-plugin/`, three levels above this file.

Run:

`node "${CLAUDE_PLUGIN_ROOT}/skills/image-deep-research/scripts/images.mjs" "<subject>" --sheet`

Add `--commercial` when the images are for a shipped product (it keeps only
licences that allow commercial use and changes), and `--download` to save
them. Then open the moodboard sheets and read them before writing a word about
them. Search again with the better words the first round gives you.

Report the moodboard paths, and for every image you recommend: the verified
URL, creator, licence and source page. Say plainly which results failed
verification.
