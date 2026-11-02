# Gev original Remotion evaluation

Verified on Windows with Remotion4.0.539, React19.2.0 and an existing Microsoft
Edge executable. Optional packages were installed with `npm install --ignore-scripts`
only in `D:/plugin-work-1101/remotion-evaluation/project`; no runtime dependency,
native binary, video or generated image was added to the UFS distribution.

The original composition is
`skills/remotion-video/assets/example/Root.mjs`. It renders a source-review
workflow with frame-derived state. It uses no external media, audio, generated
facts, model calls, credentials or paid APIs. The source is UFS MIT code;
Remotion's own runtime license remains separate.

## Functional verification

- Installed the pinned optional package set successfully:181 packages.
- Timeline tests passed for start, step boundaries, final hold, frame-rate
  equivalence, negative frames and invalid inputs.
- Bundled the actual composition and rendered five PNG stills at frames0,33,66,
  102 and119. Opened every still and checked content/state transitions and clipping.
- Rendered `output-2/workflow-review.mp4`,74893bytes, SHA256
  `c76233d63c7d61b3f23b840ef8d7ada62a12befa8ed5700f04cd981cc20aaaaa`.
- ffprobe reports one H.264 stream,1280x720,30fps,120frames,4.000000seconds.
  No audio track is expected.
- `ffmpeg -v error -i <video> -f null -` decoded the complete MP4 with exit0.

The local output directory is
`D:/plugin-work-1101/remotion-evaluation/output-2`. It contains stills,
`render-receipt.json` and `ffprobe.json`; generated binaries remain outside git.

## Failure found and boundary

The first render failed to connect to Edge under an incomplete disposable
Windows profile. The browser reported missing local application data and a
default data-directory restriction. A retry with existing isolated application
data directories and an actual writable run-specific temp directory rendered
successfully. The source runner now creates its own temp directory under the
output folder and never downloads a browser.

This is a local evaluation render, not deployment, production permission,
cross-platform certification or a Remotion model-quality benchmark. The
[current FAQ](https://www.remotion.dev/docs/license/faq) permits noncommercial
evaluation; the installed4.0.539 `LICENSE.md` contains the same eligibility.
The current [terms page](https://www.remotion.dev/docs/terms) explicitly describes
upcoming5.0 terms; version4 applicability is linked through the
[version4 terms](https://www.remotion.pro/terms-4-0). No purchase, registration,
license acceptance flow or commercial service was executed.
