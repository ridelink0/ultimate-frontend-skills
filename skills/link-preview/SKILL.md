---
name: link-preview
description: Build and validate per-page rich link previews with 1200x630 PNG images, Open Graph and Twitter metadata, original visual references and source provenance. Uses deep research and image deep research before review.
---

# Link preview cards

Load `deep-research` for the current Open Graph/crawler contract and
`image-deep-research` when selecting visual references or licensed imagery.
Open references before describing them. Evaluate subject specificity, title
readability, truthful imagery and crop-safe content; do not present AI tell
heuristics as a provenance detector. Keep private page content out of public cards.

Every emitted public HTML page needs its own title, description, canonical URL,
1200x630 PNG, og:title/description/image/image:width/image:height/image:alt/url/type/
site_name and twitter:card/image/image:alt. Use absolute HTTPS image/page URLs.

`node scripts/link-preview.mjs <built-dir> <https://site.example/>` creates
original title-based PNG cards at build time and installs metadata for each page.
It uses the existing headless browser, local system fonts and no external media.
Supply real title and description tags first. The command intentionally updates
those preview tags; preserve a custom approved card by using the validator alone.
`node scripts/link-preview.mjs <built-dir> <https://site.example/> --check`
checks emitted metadata and local PNG dimensions without changing files.

Inspect generated images before shipping. After deploy verify image status,
Content-Type, crawl access, absolute URLs and actual platform preview. Platforms
cache cards; local validation does not prove a remote preview refreshed.

Sources checked 2026-11-01: [Open Graph](https://ogp.me/),
[Google canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls).
The old X large-image-card documentation URL redirects to the general API docs;
its current detailed limits were not verified. 1200x630 is Gev's delivery contract.
