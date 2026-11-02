# Privacy

image-deep-research collects nothing about you. It has no account, no
analytics, no telemetry and no server of its own, and nothing it does is sent
to its author.

## What leaves your machine

Only what a search or a study needs, and only when you or Claude run one of
its scripts:

- **Image searches** (`images.mjs`) send the search words you gave to the
  public APIs of [Openverse](https://openverse.org),
  [Wikimedia Commons](https://commons.wikimedia.org), the
  [Art Institute of Chicago](https://api.artic.edu/docs/) and
  [the Met](https://metmuseum.github.io/), then fetch the image URLs they
  return to check each one is a real image. Requests carry a user agent
  naming the plugin (`image-deep-research/1.0`, plus this repository's URL
  for Wikimedia and the Art Institute, as their API rules ask) and no key,
  cookie or credential.
- **Website studies** (`study.mjs`) open the sites you name in a headless
  Chrome, Edge or Chromium on your machine, the same as visiting them. The
  browser runs with a fresh profile made for that run in the system temp
  folder and deleted when it ends, so your own cookies and logins are never
  used.

Each of those services has its own privacy policy, which applies to the
requests it receives.

## What stays on your machine

Contact sheets, moodboards, downloaded images and reports are written to the
folder you point the scripts at. Moodboards cache bounded image files there
before rendering so their browser loads local images. Reports retain source
URLs, checked redirect URLs and capture timestamps. The plugin reads two environment variables,
`IDR_BROWSER` and `ATELIER_BROWSER`, only to find a browser executable, plus
the standard program-folder variables for the same purpose. It reads no
credential.

## Contact

Questions or problems: [open an issue](https://github.com/ridelink0/image-deep-research/issues).
