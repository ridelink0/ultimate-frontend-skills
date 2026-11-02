# UI sound sources and checks

[MDN Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)
describes user-gesture start/resume, loading choices and memory use.
[MDN autoplay](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)
explains why play/resume may be blocked. Treat rejection as a visible muted state.

Use [Tone.js](https://github.com/Tonejs/Tone.js) for scheduled musical events,
[Howler.js](https://github.com/goldfire/howler.js) for sample playback, and
[Web Audio examples](https://github.com/mdn/webaudio-examples) for native API
patterns. These are external runtime choices, not shipped UFS dependencies.
For samples, [Freesound](https://freesound.org/help/faq/#licenses) has per-file
licenses; read each one. The Freesound website license is not a sample license.

Public X search on 2026-11-01 did not yield a verifiable, licensed sound asset
for this release. No personal Following feed was accessed. Nothing from X is
redistributed or represented as a tested sample collection.

Design an event map: action, visible equivalent, optional sound, rate limit,
duration and user controls. Use short envelopes to avoid clicks; cap gain and
concurrency. Avoid success sounds before the server commits. Reuse one context,
disconnect ended nodes and close the context on teardown. Muting must win a
pending asynchronous enable. Reduced motion and audio preference are separate.

Test headphones and speakers at low volume; repeated errors must stay usable.
Record the actual listening check separately from unit tests of scheduling.
