# Complex workflow sites

## Build order

1. Identify user role, primary job, source of truth, success condition and
   permission boundary. Ask about missing facts that change behavior, not a long
   questionnaire about decoration.
2. Map entry, action, loading, success, error, retry and cancellation. Implement
   one complete path against the real data before polishing it. Use clearly
   labeled mock data only for examples and record the missing backend.
3. Choose three real references that solve the same task differently; inspect
   them with image deep research. Keep source links and observations. Write
   brief-specific acceptance assertions. A novelty score or a banned-font list
   is not proof that the result serves its user.
4. Build semantic components and state ownership. Use one motion owner per
   element. Stale async results must not replace newer user choices; repeated
   submits must not duplicate consequential operations.
5. Verify the core flow with keyboard and pointer, then errors, denial,
   cancellation, empty results and narrow layouts. Only then refine motion.
6. Run UFS audit, browser/quality checks and security checks. Review production
   headers and emitted route metadata after deployment. Local checks do not
   establish deployed behavior or legal clearance.

## Component coverage

| Component | Build from | Observable gate |
|---|---|---|
| Heroes | brief-specific subject and verified reference | main message and primary action readable without effects |
| AI chat | semantic log, composer, cancel and retry | stream stops, failure recoverable, no false sent state |
| Shaders | existing gradient/sky runtime or three.js | context loss and reduced-motion content remain useful |
| Buttons | native button and visible state | pending blocks duplicate action; keyboard activates once |
| Testimonials | consented source quotes | quote, identity and relationship evidenced; no invented ratings |
| Forums | real authorization and moderation flow | report/block, pagination and unauthorized writes tested |
| Text | concrete supplied facts and heading hierarchy | zoom/reflow, long words and correct reading order |
| Galleries | licensed media with dimensions | keyboard selection, failed image and loading tested |
| Features | real capabilities and limitations | each claim maps to a working behavior |
| CTAs | one named operation | final destination and result verified |
| Cards | semantic links or buttons | no nested interactive controls or ambiguous targets |
| Sign in | actual provider and safe return path | cancel, denied account, expired session and logout tested |
| Nav / navigation | landmarks and current route | keyboard, mobile open/close, focus return and deep link |
| Dashboards | source query, unit and freshness | zero differs from unknown; filters preserve definitions |
| Backgrounds | optional decorative layer | content legible without canvas or loaded image |
| Pricing | source-backed terms and totals | currency, interval, taxes, limits and cancellation explicit |

Use existing `assets/sections.html` for page sections; use `ui-pro-max`'s
original mock library for workflow state examples. Do not scrape paid 21st.dev
components, previews or private registries. Independently licensed open source
must keep its license and provenance; public availability alone is insufficient.

## Performance across devices

Measure representative slow hardware and a throttled browser separately. Do not
claim a laptop headless run represents a low-end phone. Preserve text, actions
and information on every tier; adapt optional render resolution, particle count,
postprocessing and update frequency. Use frame-time percentiles rather than a
single FPS average. Pause offscreen/hidden effects, cap DPR, resize drawing buffers
only when needed and dispose GPU resources on navigation. Avoid multiple render
loops per canvas. Measure before/after with the same page, trace and workload.

[three.js responsive design](https://threejs.org/manual/pages/responsive.html)
and [resource disposal](https://threejs.org/manual/pages/how-to-dispose-of-objects.html)
are primary references. `node scripts/scene-budget.mjs measurements.json`
checks a measured scene record and explains missing evidence; its budgets are
project defaults, not universal hardware guarantees.

Scroll motion: prefer native scrolling, measure nested scrollers and the actual
scroll container, avoid wheel hijacking, and keep focus changes from scrolling
people into hidden scenes. Reduced motion keeps substantive content and all
actions. Provide a pause mechanism for applicable auto-starting motion lasting
more than five seconds alongside other content. See
[W3C pause/stop/hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide)
and [interaction animation](https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions).

## SEO, rights and sharing

Validate actual emitted routes: unique title/description, one canonical per
indexable route, indexability, real sitemap URLs, correct response status,
relevant structured data and an actual social preview image. Noindex on a
preview is not access control. Verify deployed headers, not just config files.
[Google JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
and [sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
explain the crawler contracts; submitting a sitemap does not guarantee indexing.

Maintain a rights ledger for text, code, fonts, media and testimonials. Confirm
claims, consent and paid relationships before publishing. Check applicable
privacy/consumer requirements for the audience with qualified review when
needed; this checklist is not a legal certification.
[FTC endorsements and reviews](https://www.ftc.gov/business-guidance/advertising-marketing/endorsements-influencers-reviews)
is the US source for marketing review obligations, not a worldwide rule.

Image generation is opt-in. Name provider, submitted data and expected cost;
keep API keys on the server. Use existing `generate-website-image` only when
authorized and keep actual output provenance. Never silently switch providers.
Use the existing Claude Design handoff and `design.mjs detect` rather than
repeating installation or changing account settings.
