---
description: "Make a video from reference images and clips - study frames, scaffold a frame-exact scene, render a draft then the final MP4 (reel, launch clip, recap)"
argument-hint: "<brief> refs: a.jpg,b.mp4 [--seconds 15] [--size 1080x1920]"
disable-model-invocation: true
---

The request is the text the user typed with this command (Claude Code appends
it below as ARGUMENTS; in Codex it is the rest of the message).

`${CLAUDE_PLUGIN_ROOT}` is this plugin's folder. Codex runs this command as a
skill and leaves that variable empty; there, use the folder that holds
`.codex-plugin/`, three levels above this file.

Read `${CLAUDE_PLUGIN_ROOT}/skills/ultimate-frontend-skills/references/video.md`
and `references/video-tells.md` before writing a shot, then follow the route
in `video.md`:

1. Study every clip as frames and open them:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" video <clip> --frames 12`
2. Scaffold the scene:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" video scene <dir> --refs <a.jpg,b.mp4> [--seconds 15] [--size 1080x1920]`
3. Rewrite `scene.html` for the brief; keep `ufsFrame(t)` a pure function of
   time.
4. Draft: `video render <dir>/scene.html --draft`, then read its frames
   against `video-tells.md`.
5. Final only after the draft passes: `video render <dir>/scene.html [--audio FILE]`.

It needs ffmpeg and a Chromium browser. No generated footage: a clip nobody
shot never appears in the cut. Report the MP4 path and what was checked.
