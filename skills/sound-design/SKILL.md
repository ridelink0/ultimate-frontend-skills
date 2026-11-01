---
name: sound-design
description: Add deliberate opt-in UI sound, Web Audio feedback, audio lifecycle cleanup, mute controls and sound provenance. Includes an original source-only feedback runtime and demo.
---

# Sound design

Read `references/sound.md`. Start with the user's task: completion, error or
navigation feedback. Sound supplements visible text and never carries the only
meaning. Default off. Add an explicit enable/mute control and persist only the
user's own preference. Create or resume AudioContext inside that control's
user gesture. Never try to bypass autoplay rules.

`assets/feedback.mjs` is an original dependency-free runtime. Its demo at
`assets/demo.html` works when served by a local static server. It downloads no
samples, makes no network requests and is silent before enable. Copy the module
and wire semantic buttons; do not attach sound to every hover or keystroke.

For recordings, preserve creator, source, license, allowed modifications and
attribution beside every asset. A public X post is discovery, not permission to
redistribute a sound. Never lift a paid preview. Check visible equivalence,
mute, hidden-tab behavior, repeated input, rejected resume and teardown twice.
