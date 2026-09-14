# Security check for a built site

Run before anything is deployed, and again after it is:

```
node scripts/webdesign.mjs security <site-directory>
```

It reads the files that would be deployed and reports, in order of severity,
what should never leave a laptop, what a form does with personal data, what
pins the scripts pulled from a CDN, what the header configuration allows, and
the small disclosures. It exits 1 on a high finding only. Read every line; do
not summarise a security report as "a few warnings".

Two classes of check exist and only one runs offline.

## What the source can tell you (the command does this)

**Never ship.** `.env*`, a `.git` directory, `*.map`, key and certificate
files, `.DS_Store`. A served `.git/` hands over every secret ever committed,
including the ones later removed - a 2026 survey found about five million web
roots exposing it. Publish a build directory, never the repository root.

**Secrets.** Prefixed formats are exact: `AKIA…` (AWS), `sk_live_`/`rk_live_`
(Stripe - a publishable `pk_` key is meant to be public and is not flagged),
`ghp_`/`github_pat_`/`gho_` (GitHub), `xox[baprs]-` (Slack), `nfp_` (Netlify),
`vcp_` (Vercel), `AIza…` (Google - public by design, must be referrer-restricted
in the console), a private-key block. The generic rule catches the rest:
`api_key|secret|token|password` assigned a quoted value of sixteen or more
characters. Anything found is already in the deploy history: **remove it and
rotate it**, in that order, today.

**Disclosures.** A local path (`C:\Users\<name>`, `/Users/<name>/`,
`/home/<name>/`) in a shipped file names a person and an operating system; it
usually arrives through a source map or a bundler embedding `__dirname`.
`console.log` left in production prints to every visitor. A debug flag left
on is a debug flag on.

**Forms.** A form with an email, phone, password or textarea field must use
`method="post"`: GET puts the submission in the URL, the browser history, the
server log and the referrer header. Its action must be https. A page that
collects personal data must link a privacy policy and say near the button
what the data is for. On Netlify, add `netlify-honeypot="bot-field"` with a
hidden `bot-field` input; Akismet runs on every submission regardless, the
honeypot is the cheap second layer. Hide the honeypot off-screen rather than
with `display:none`, which some bots learned to skip. No published Netlify
rate limit exists; if one is needed, it is a Turnstile or a function.

**Scripts from a CDN.** Every cross-origin `<script src>` needs `integrity`
and `crossorigin="anonymous"` - without `crossorigin` the browser cannot read
the response to hash it, so the integrity attribute silently does nothing.
Pin the exact version (`three@0.185.1`), never `latest`. For modules behind an
import map, the map itself takes an `"integrity"` block keyed by URL; Chrome
127+, Firefox 138+ and Safari 18.4+ enforce it. A bare dynamic
`import('https://…')` with no import map cannot be pinned by any browser
mechanism: route it through the map or use a static tag. Font CSS from a
font service is generated per user agent and cannot carry a stable hash, so
it is exempt from the integrity rule and covered by the next point instead.

**Fonts and trackers.** Loading fonts from Google's servers sends every
visitor's IP address to Google before the page paints; the Munich Regional
Court ruled in January 2022 that this needs a legal basis the page does not
have. Self-host the woff2 files, or use a same-origin mirror. Any analytics or
pixel id obliges a notice, and Google tags shown to EEA visitors need Consent
Mode v2 signals wired to a real consent banner or Google collects nothing.
Cookieless analytics (Plausible, Fathom, Simple Analytics) avoid the banner
entirely.

**Client-side patterns.** `innerHTML` or `document.write` fed anything that is
not a literal is an injection; `postMessage` to `"*"` and a `message` listener
that never checks `event.origin` are the two web-messaging holes OWASP tests
for; `eval` and `new Function` also force `'unsafe-eval'` into the policy;
`http://` in a `src`, `href` or `action` is mixed content and browsers block
the active kind outright; `target="_blank"` wants `rel="noopener noreferrer"`
(evergreen browsers imply noopener, embedded webviews do not, and noreferrer
is a separate privacy win).

**Headers.** The configuration is source too, and it is where clickjacking
and sniffing are decided. The baseline every grader scores:

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` - start as `Content-Security-Policy-Report-Only`, then enforce |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` |
| framing | `frame-ancestors 'none'` in the CSP (supersedes `X-Frame-Options: DENY`) |

Where they go: Netlify - `[[headers]]` with `for = "/*"` in `netlify.toml`, or
a `_headers` file in the publish directory (the scaffolder writes the toml
block); Vercel - the `headers` array in `vercel.json` (Vercel sets HSTS itself
and nothing else); Cloudflare Pages - `_headers` in the output directory.
Inline `on*=` handlers and inline `<script>` blocks are incompatible with a
real `script-src 'self'`; move them to files or use nonces, not
`'unsafe-inline'` for scripts. Check the finished policy with Google's CSP
Evaluator.

## What only the served site can tell you (do these by hand)

```
curl -sI https://<site>/ | grep -iE "content-security|strict-transport|x-content-type|referrer|permissions|frame"
curl -s -o /dev/null -w "%{http_code}\n" https://<site>/.git/HEAD     # must be 404
curl -s -o /dev/null -w "%{http_code}\n" https://<site>/.env          # must be 404
```

The first shows whether the configured headers actually arrive - a `_headers`
file in the wrong directory arrives as nothing. The other two are the
disclosure that matters most and cannot be seen from source. Mozilla's HTTP
Observatory grades the same header list from the live site if a second
opinion is wanted.

## When the check flags the scaffold itself

A fresh scaffold loads three.js through an import map from jsDelivr and its
fonts from Google. Both are flagged, on purpose: the first is a real gap until
the `"integrity"` block is added for the pinned build, the second is a real
disclosure that self-hosting the woff2 files removes. Neither is an error, and
neither should be silenced by editing the check.

## Reporting

Say what was found, its severity, and the fix, in that order. A secret is
reported as "remove and rotate", never as "remove". Do not describe a page as
secure because the command printed nothing: it read the source, and the
three live checks above have not run.
