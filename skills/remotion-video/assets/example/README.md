# Original Remotion reference

This is original UFS source under the repository MIT license. It uses no external
images, fonts, recordings, model calls or paid APIs. Remotion itself has separate
runtime terms: see [license FAQ](https://www.remotion.dev/docs/license/faq),
[pricing](https://www.remotion.dev/docs/license/pricing), and the license shipped
with the exact version installed. This example is for local evaluation. Do not
assume it grants commercial production permission to every organization.

Copy this folder outside the plugin before installing optional dependencies.
Run `npm install --ignore-scripts`, `npm test`, then set
`REMOTION_BROWSER_EXECUTABLE` to an existing Chrome/Edge/Chromium executable and
run `npm run render -- <output-dir>`. Packages are pinned; plugin installation
does not install them. The render explicitly refuses an absent browser instead
of silently downloading one. It creates five PNG stills and a four-second,
1280x720,30fps H.264 MP4 without audio.

Inspect every still, decode the MP4, and verify stream metadata with ffprobe.
The timeline test is not proof of a successful render. Source-level timeline
state is deterministic; encoded bytes can differ across browser/codec versions.
