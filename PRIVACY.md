# Privacy

Ultimate Frontend Skills collects nothing about you. It has no account, no
analytics, no telemetry and no server of its own, and nothing it does is sent
to its author.

## The prompt hook

`hooks/nudge.mjs` reads each prompt on your machine to decide whether it is
about building or restyling a page, and if so prints one line pointing Claude
at the skill. The prompt is not stored or sent anywhere.

## What leaves your machine

Only when you or Claude run one of these commands, and only what that command
needs:

- **Textures and lighting** (`assets.mjs`): search and download requests to
  the public APIs of [Poly Haven](https://polyhaven.com) and
  [ambientCG](https://ambientcg.com), with a user agent naming this plugin and
  its GitHub page, as Poly Haven's terms ask.
- **Key-free image generation** (`assets gen --model pollinations`, only when
  asked for): the prompt text you give is sent to
  [pollinations.ai](https://pollinations.ai) in the request URL, and the image
  it returns is saved where you point it.
- **Reference sites** (`awards.mjs`, `study`, `inspect.mjs`): the pages in the
  reference corpus, or the sites you name, are loaded the same as visiting
  them. Pages are rendered in a headless Chrome, Edge or Chromium on your
  machine with a fresh profile made for that run and deleted when it ends, so
  your own cookies and logins are never used.
- **Image research** (the bundled image-deep-research skill): the search words
  you give go to the open collections listed in its own
  [privacy note](https://github.com/ridelink0/image-deep-research/blob/main/PRIVACY.md).

Each of those services has its own privacy policy, which applies to the
requests it receives.

## What stays on your machine

Pages, screenshots, contact sheets, downloaded textures and reports are written
to the folder you work in. `tools.mjs` and `assets gen` report whether an image
or design service is configured on the machine by the name of its setting,
never its value, and send nothing.

## Contact

Questions or problems: [open an issue](https://github.com/ridelink0/ultimate-frontend-skills/issues).
