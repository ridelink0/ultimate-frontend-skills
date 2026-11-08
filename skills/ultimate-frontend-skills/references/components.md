# Components by category, and where free code for them comes from

Sixteen categories people ask for by name. For each: where UFS already
answers it, what this file adds where nothing did, and which free, licensed
library has a working version to read. Read the row you need.

## The sourcing rule

- Never fetch, paste, port or paraphrase code from a paid component site
  (21st.dev's paid tier and anything behind a login or a paywall). Use the
  upstream free library below and keep its licence.
- Reading a free component to learn how it moves is fine. Shipping it in a
  user's project is fine under the terms in the table. Copying any of it into
  this repo (`assets/`, `scripts/`) is not: `core.css` and `motion.js` are
  written here, not vendored.
- MIT: keep the copyright and permission notice with any substantial portion
  you copy. Apache-2.0: keep the LICENSE and any NOTICE, and mark what you
  changed. GPL-2.0: read for the pattern only; do not copy code into a site
  that is not itself GPL.
- React Bits is MIT plus the Commons Clause. A component may be used inside an
  application, website or product. It may not be sold, sublicensed or
  redistributed on its own, in a bundle or as a port. So a site may use one;
  UFS never vendors, ports or re-publishes one.

Licences below were read from `api.github.com/repos/<repo>/license` on
2026-11-08. Component names were read from each repo's default-branch tree the
same day. Re-check the licence before copying; licences change.

| Library | Repo | Licence | What it is good for |
|---|---|---|---|
| shadcn/ui | github.com/shadcn-ui/ui | MIT | Accessible primitives; blocks `login-01`..`05`, `signup-01`..`05`, `sidebar-01`..`16`, `dashboard-01` |
| Magic UI | github.com/magicuidesign/magicui | MIT | Motion pieces: text, buttons, backgrounds, marquee, bento grid |
| Origin UI (now coss.com ui) | github.com/cosscom/ui | MIT | Plain form controls, inputs, selects, steppers |
| assistant-ui | github.com/assistant-ui/assistant-ui | MIT | AI chat primitives |
| Vercel chatbot | github.com/vercel/chatbot | Apache-2.0 | A whole AI chat app: streaming, history, attachments |
| Paper shaders | github.com/paper-design/shaders | Apache-2.0 | Zero-dependency WebGL backgrounds |
| Uiverse galaxy | github.com/uiverse-io/galaxy | MIT | Plain HTML/CSS buttons, toggles, loaders, cards |
| Heroicons | github.com/tailwindlabs/heroicons | MIT | Inline SVG icons |
| React Bits | github.com/DavidHDev/react-bits | MIT + Commons Clause | Use in a site only (see the rule above) |
| Discourse | github.com/discourse/discourse | GPL-2.0 | Forum patterns to read, not code to copy |

## The categories

### Heroes

Already in UFS: SKILL.md (the hero is the subject's own material),
`motion.md` (the layered hero, parallax, the exploded view), `tells.md` (the
eyebrow-headline-two-buttons stack). Free code to read: Magic UI
`hero-video-dialog`, `safari`, `iphone` (device frames). A hero has one job and
one action; the motion budget goes here, so the sections under it stay quiet.

### AI chat

Not covered before. Read assistant-ui's primitives (`thread`, `message`,
`messagePart`, `composer`, `attachment`, `branchPicker`, `actionBar`,
`suggestion`, `threadList`, `reasoning`, `chainOfThought`, `error`) for the
parts, and the Vercel chatbot for a whole app.

What a working chat has that a mock-up does not:

- The thread is a `role="log"` region; new assistant text is announced once
  per finished message, not once per streamed token.
- While a reply streams, Send becomes Stop, and Stop works.
- The view stays pinned to the bottom only while the reader is at the bottom.
  Scrolling up breaks the pin; a "Jump to latest" button brings it back.
- The composer is a `textarea` that grows to a limit, sends on Enter, takes a
  newline on Shift+Enter, and is not cleared when a send fails.
- Errors sit on the failed message with a retry, not in a toast.
- Code blocks have a copy button; long messages do not move the composer.
- Four states: empty (suggestions, not a greeting), streaming, error, and a
  history list that loads on its own.

### Shaders and backgrounds

Already in UFS: `three.md`, `stack.md` (which library), `awards.md` (WebGL
gradients in the corpus). Free code to read: Paper shaders (`mesh-gradient`,
`grain-gradient`, `dithering`, `halftone-dots`, `liquid-metal`, `god-rays`,
`metaballs`, `voronoi`, `warp`, `waves`, `water`, `perlin-noise`,
`paper-texture`, `fluted-glass` and more); Magic UI CSS and canvas backgrounds
(`dot-pattern`, `grid-pattern`, `animated-grid-pattern`, `flickering-grid`,
`retro-grid`, `striped-pattern`, `noise-texture`, `light-rays`, `meteors`,
`particles`, `warp-background`).

Rules every one of these breaks by default:

- One WebGL context per page. Two shaders share a canvas or one becomes CSS.
- Cap device pixel ratio at 2 and stop the frame loop when the canvas is off
  screen (IntersectionObserver) or the tab is hidden.
- `prefers-reduced-motion: reduce` gets a still frame, not a slower loop.
- The first paint is a CSS gradient in the same colours, so the page is never
  blank while the shader compiles or on a device that refuses WebGL.
- Text over it passes contrast at the shader's brightest frame, not its mean.

### Buttons

Already in UFS: `ui.md` ("Decision one: button or link"), `craft.md` (loading
buttons, target sizes). Free code to read: Magic UI `shimmer-button`,
`shiny-button`, `rainbow-button`, `ripple-button`, `pulsating-button`,
`interactive-hover-button`, `animated-subscribe-button`; Uiverse galaxy for
plain CSS. Effects stay on hover and focus, never on a loop the reader cannot
stop, and the focus ring survives the effect.

### Testimonials

Already in UFS: `ui.md` ("Testimonials and social proof"), `sections.md`
("Pull quote"), `copy-tells.md`. Free code to read: Magic UI `marquee`,
`tweet-card`, `client-tweet-card`, `avatar-circles`. A marquee of quotes pauses
on hover and focus and under reduced motion, and every quote is reachable
without waiting for it to scroll past.

### Forums

Not covered before. Read Discourse for the patterns (do not copy its code; it
is GPL-2.0). What a forum page needs:

- A topic list as a real list or table: title, replies, last activity as a
  `time` element with an absolute date in its `datetime` and title.
- Replies in reading order. Nesting stops at two levels; deeper replies
  quote what they answer instead of indenting further.
- Each post is an `article` with its author, time and a permalink.
- Unread position is kept, and the page opens there.
- Long threads paginate by URL (`ui.md`, "Pagination, load more, infinite
  scroll"), so a link to post 340 still works.
- The reply box is the composer from AI chat above, minus streaming.

### Text

Already in UFS: `typography.md`, `motion.md`, `motion-graphics.md`. Free code
to read: Magic UI `text-animate`, `text-reveal`, `typing-animation`,
`word-rotate`, `morphing-text`, `hyper-text`, `number-ticker`,
`animated-gradient-text`, `aurora-text`, `sparkles-text`, `kinetic-text`,
`spinning-text`, `line-shadow-text`, `highlighter`, `scroll-based-velocity`.

Split text is read letter by letter by a screen reader unless the parent
carries the whole string in `aria-label` and the pieces are `aria-hidden`. One
animated line per screen; body copy does not move. A word rotator keeps its
width fixed so the line does not reflow each change.

### Galleries

Not covered as a component before. Free code to read: Magic UI `lens`,
`pixel-image`, `blur-fade`, `progressive-blur`.

- A grid of real links or buttons, each image with `width`, `height`,
  `srcset`, `sizes` and `loading="lazy"` below the fold.
- The lightbox is a `dialog` (`ui.md`, "Decision two: modal or a page"):
  arrow keys move, Escape closes, focus returns to the thumbnail it opened from.
- Each image has its own URL (hash or path) so one can be shared.
- Captions and credits come from `imagery.md`'s sourcing record.

### Features

Already in UFS: `sections.md` ("Stat trio", "Card rail", the grid),
`tells.md` (the three-card icon row). Free code to read: Magic UI `bento-grid`,
`animated-beam`, `orbiting-circles`, `file-tree`, `code-comparison`,
`terminal`. A bento grid earns its uneven cells only when the content is
uneven; equal content goes in an equal grid.

### CTAs

Already in UFS: `ui.md` ("Sections that sell"), `copy-tells.md`. One primary
action per screen, a verb the reader would say, and the same label in the nav
and the closing section.

### Cards

Already in UFS: `ui.md` ("Cards and lists"), `sections.md` ("Card rail",
"Glass"). Free code to read: Magic UI `magic-card`, `neon-gradient-card`,
`border-beam`, `shine-border`, `glare-hover`; Uiverse galaxy cards. One link
per card, stretched over it; a pointer-tracking glow does nothing on touch, so
the card must read as a card without it.

### Sign in

Only in passing before. Free code to read: shadcn/ui blocks `login-01`..`05`
and `signup-01`..`05`; Origin UI inputs.

- `autocomplete="username"` (or `email`) and `current-password`; on sign up
  `new-password`. Never block paste.
- A show-password toggle that is a real button with a name.
- Passkeys offered first where the backend has them: `autocomplete="username
  webauthn"` on the username field enables conditional mediation.
- One error for a wrong email or password; it does not say which.
- Third-party sign-in buttons follow each provider's brand rules, with the
  provider's own mark as inline SVG.
- The form also works with JavaScript off, or says plainly that it does not.

### Nav and navigation

Already in UFS: `ui.md` ("Navigation": primary, in-page, mega menu, mobile,
breadcrumb, pagination). Free code to read: shadcn/ui `sidebar-01`..`16` for
app navigation; Magic UI `dock`, `scroll-progress`.

### Dashboards

Already in UFS: `ui.md` ("Dashboards"); charts go to the `dataviz` skill
(`plugins.md`). Free code to read: shadcn/ui `dashboard-01`, the sidebar
blocks; Magic UI `animated-circular-progress-bar`, `number-ticker`,
`animated-list`. Numbers that tick up on load are counted once and stop; a
number that keeps moving is unreadable.

### Pricing

Already in UFS: `ui.md` ("Pricing and comparison"), `copy-tells.md`. Prices
are text, not images; the billing toggle keeps its state in the URL; a
comparison table is a real `table` with row and column headers.
