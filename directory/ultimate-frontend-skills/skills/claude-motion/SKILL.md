---
name: claude-motion
description: Create editable Claude Motion explainers and verify timing, export, captions, rights, reduced motion and data accuracy. Keeps Anthropic Motion artifacts distinct from Motion for React, Remotion and website scroll animation.
---

# Claude Motion

Anthropic's Claude Motion creates editable code-based animated explainers and
MP4 exports. It is not the Motion for React library and not a video generation
model. On 2026-11-01 the official feature is beta on Team and Enterprise; verify
current account access before promising an export. Use existing artifact tools
without duplicate setup. Never pretend a local HTML animation is a native
Claude Motion artifact or claim an MP4 exists without inspecting the output.

1. Establish audience, explanation, length, aspect ratio, source facts and
   output destination. Write a short sequence with one idea per scene.
2. Keep text, charts, shapes and images editable. Link chart values to the
   supplied source; require licenses for images, fonts, recordings and music.
3. Use timing to reveal the explanation. Avoid unrelated looping ornaments,
   flashes and motion that obscures the numbers. Include captions or a static
   equivalent, playback controls and pause in interactive delivery.
4. Add sound only after explicit opt-in; load `sound-design`. For websites,
   use the main UFS motion reference and preserve useful content when the user
   requests reduced motion. A fixed MP4 needs an accessible static/transcript
   alternative rather than a CSS media query that cannot affect the file.
5. Inspect start, transitions, final hold, text clipping, audio sync, export
   dimensions, duration and decoder playback. Run the functional export check,
   then seek through boundaries and missing-asset/error cases. Record actual
   native/export evidence separately from local recipe tests.

Source: [Anthropic announcement](https://claude.com/resources/articles/dashboards-and-motion).
For code-rendered alternatives consult [Remotion skills](https://github.com/remotion-dev/skills)
and its runtime license before use; these are independent community tools.
