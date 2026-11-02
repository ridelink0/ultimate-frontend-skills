---
name: remotion-video
description: Create and verify code-authored videos with Remotion, using the official Remotion skills as an explicit optional integration. Covers deterministic frames, composition registration, audio, rendering and runtime licensing.
---

# Remotion video creation

Use the project's existing Remotion version and installed official
`remotion-best-practices`, `remotion-markup` and `remotion-render` skills.
UFS registers [remotion-dev/skills](https://github.com/remotion-dev/skills)
as an explicit source install; it never downloads Remotion during plugin install.
Its skills snapshot has no root license file, so no upstream files are vendored.
Review the [runtime license](https://www.remotion.dev/docs/license) for this user
and use before installing or rendering. Do not label Remotion universally free.

1. Define audience, message, source facts, dimensions, FPS, duration and export.
2. Create a registered composition. Derive animation from frame/fps rather than
   wall-clock timers or Math.random; seed any intentional randomness.
3. Use existing UFS `references/motion-graphics.md` and `sound-design`. Keep
   narration/caption timing explicit, media licensed, fonts local or loaded
   before rendering, and meaningful static/transcript alternatives.
4. Render a still at start, transition boundaries and final hold. Inspect them.
   Render the actual output and verify duration, dimensions, decoder playback,
   clipping and audio sync. A successful install or typecheck is not a video.
5. Test missing media, long text, changed input props, repeat renders and export
   failure. Do not claim a render ran unless its output exists and was checked.

The original UFS video CLI remains available for existing scene files; this
skill adds a distinct Remotion route, not a silent runtime substitution.
