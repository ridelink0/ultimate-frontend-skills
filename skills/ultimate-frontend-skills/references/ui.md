# The component catalogue

Which element to build a thing from, what states it has, what the accessible name
has to be, and what a junior ships that a senior rejects. Read the row you need
mid-build. Do not read this file end to end.

Scope, so nothing is written twice:

| For | Read |
|---|---|
| How to build a state (the full matrix, focus management, live regions, loading buttons, target sizes) | `references/craft.md`. This file says which states a component *has*; craft.md says how to build one |
| Grid, section air, glass, dot leaders, the house form treatment | `references/sections.md` |
| Any chart, stat tile, KPI row or dashboard block | Hand to the `dataviz` skill - `references/plugins.md` |
| Durations and easing for any transition named here | `references/motion.md`. There is one motion scale; do not invent a second |
| What the finished page must not look like | `references/tells.md` |

`core.css` is never edited inside a project. Every snippet here belongs in
`site.css`, which loads after it.

## What the chassis already ships

Build against these before writing anything. The right-hand column is the only
place a component is described that does not exist yet.

| Need | Already in `core.css` | If it is not there |
|---|---|---|
| Primary button | `.btn` (rest, `:hover`, `:active`) | no `:disabled`, no pending - `site.css` |
| Secondary button | `.btn--ghost` (rest, `:hover`) | |
| Tertiary / inline action | `.link` - background-size underline sweep on `:hover` **and** `:focus-visible` | |
| Body link | `.prose a` has a considered default underline | |
| Focus indicator | the global `:focus-visible` ring with a ground-coloured halo, plus a `forced-colors: active` branch | see the `.field` note in Forms |
| Form field | `.field` - boxless, one bottom hairline, 11px uppercase UI label | no error, help, required or disabled treatment |
| Accordion / FAQ | `.faq` on native `<details name="faq">` | |
| Two-column specification list | `.spec` (`<th scope="row">`, tabular figures) | a real data table is new CSS |
| Numbered process | `.steps` | |
| Contents list with dot leaders | `.index` inside `<nav aria-label="Contents">` | |
| Figures | `.stats` / `.stat` | |
| Card, card grid, card rail | `.card`, `.cards`, `.cards--rail` (native scroll-snap), `.card--glass` | |
| Image with caption | `.frame` + `figcaption`, `.callout` | |
| Header | `.nav`, `.nav__brand`, `.nav__links`, `.nav.is-stuck` | **no mobile navigation at all** - see below |
| Skip link | `.sr-skip`, targeting `#main` | no block in `sections.html` emits `<main>`; add it |
| Screen-reader-only text | `.visually-hidden` | |
| Anchor offset under the sticky header | `:where([id]) { scroll-margin-top: calc(var(--nav-h, 4.5rem) + 1rem) }` (core.css:168) | nothing assigns `--nav-h`; set it in `site.css` to the real header height or the offset is keyed to a guess |

Confirmed absent, and therefore what this file is actually for: disabled and
pending treatments, status colours, error and help text, checkbox, radio, switch,
fieldset, data table, sortable header, table overflow wrapper, dialog, drawer,
popover, tooltip, dropdown, toast, tabs, pagination, breadcrumb, mobile nav,
skeleton, spinner, empty state, search field, filter chips, pricing table,
comparison table, file upload, date input, stepper, `role="status"` styling,
`@container`, `@media print`.

---

## Decision one: button or link

This is the most-broken distinction on the web and the rule is one line.
**`<a href>` goes somewhere. `<button>` does something here.**

ARIA 1.2 settles the ambiguous cases in its own words, under the `link` role:
"If pressing the link triggers an action but does not change browser focus or
page location, authors are advised to consider using the `button` role instead of
the `link` role."

| Thing | Element | Why |
|---|---|---|
| Navigate, same page or new | `<a href>` | It has a URL, opens in a new tab, enters history |
| Jump to a section on this page | `<a href="#id">` | A fragment is a location change |
| Open a modal, a menu, an accordion | `<button type="button">` | No URL, no history entry |
| Submit a form | `<button type="submit">` | A bare `<button>` in a form already *is* `type="submit"` |
| Run JS inside a form | `<button type="button">` | Without it, the default submits and reloads the page |
| Download a file | `<a href download>` | It is a resource |
| Log out | `<button>` inside a POST form if it changes state; `<a>` only if it is a plain GET URL | Never a GET link for a destructive action |
| A card that is entirely clickable | One `<a>` on the title with an `::after` overlay | Not a wrapping `<a>`, not `<div onclick>` |
| Pagination page numbers | `<a href>` | They are URLs and must work with JS off |
| Tab in a tablist | `<button>` | It changes no location |

**Hierarchy.** Three levels is the ceiling on a page, and the chassis ships all
three: `.btn`, `.btn--ghost`, `.link`. A fourth level means two of the others are
doing the same job. One primary per *view*, not one per section; a section that
needs its own call to action gets a ghost.

**States.** Every button answers `:hover`, `:focus-visible`, `:active`, and
disabled; anything that talks to a server also answers pending. The chassis ships
the first three. Build the last two from the matrix in `craft.md`.

**Disabled, decided.** Prefer `aria-disabled="true"` plus a guard in the handler
whenever the user might reasonably want to know *why* the control is off - a
submit button waiting on an empty field, for instance. The `disabled` attribute
removes the control from the tab order, so a keyboard user tabs past the reason
and never finds it. Use `disabled` only when the reason is obvious from an
adjacent focusable control. ARIA requires a visual change either way.

**Pending.** Reserve the indicator's space at rest so the button does not change
width, keep the label, set `aria-busy="true"` on the button, and put the outcome
in a `role="status"` region. `craft.md` has the component written out.

**Junior mistakes, ranked.**

1. `<div onclick>` - no role, no keyboard, no focus.
2. `<a href="#">` as a button. The audit errors on this.
3. `<a role="button">` with no Space-key handler. Links fire on Enter only;
   buttons fire on both.
4. A bare `<button>` in a `<form>` that reloads the page, because nobody wrote
   `type="button"`.
5. An icon-only button with no accessible name.
6. Three primary buttons on one screen.
7. `pointer-events: none` as the disabled style - still focusable, still
   activatable by keyboard.
8. "Learn more" as the link text twelve times. **2.4.4 Link Purpose (In
   Context), Level A**: the purpose must come from the link text alone or from
   its programmatically determined context.

---

## Decision two: modal or a page

Most modals are pages that lost an argument. Work down this ladder and stop at
the first yes.

1. **Can it be a page?** It has content worth a URL, it is longer than a screen,
   or somebody will want to link to it. Then it is a page.
2. **Can it be inline?** A form that appears in place, an expanding row, a
   disclosure. Cheaper and unbreakable.
3. **Is it a blocking decision with two outcomes?** Delete confirmations,
   unsaved-changes prompts, one short single-purpose form. Then it is a modal.
4. **Is it a persistent secondary surface the user moves between?** Filters, a
   cart, a details panel. Then it is a drawer, and drawers are non-modal by
   nature. A modal drawer is just a wide modal.
5. **Is it a small transient overlay anchored to a control?** Popover.

A modal on page load is none of these.

**Use the native element.** `showModal()` gives you inert-behind, Escape, the top
layer (no `z-index` war, and no clipping by an ancestor's `overflow` or
`transform`), `::backdrop`, and focus return on close.

```html
<dialog id="confirm" aria-labelledby="confirm-t">
  <h2 id="confirm-t">Delete the Marlow entry?</h2>
  <p>This removes it from the archive. It cannot be undone.</p>
  <form method="dialog">
    <button value="cancel" autofocus>Keep it</button>
    <button value="delete" class="btn">Delete</button>
  </form>
</dialog>
```

`autofocus` goes on the least destructive action. `method="dialog"` submits
without navigating and sets `returnValue`. Per MDN, `tabindex` must not be used
on the `<dialog>` element, and a dialog rendered with the `open` attribute
instead of `showModal()` is non-modal.

**Three things the platform does not give you.**

1. **Scroll lock.** `showModal()` makes the rest of the document inert but does
   **not** stop the page behind from scrolling. WHATWG HTML issue #7732,
   "Consider preventing page scroll when modal dialog is visible", is still open
   (last updated 2025-10-08). Set `overflow: hidden` on `<html>` while open,
   reference-counted if modals can nest, and `scrollbar-gutter: stable` on
   `html` so the lock does not shift the layout.
2. **Light dismiss.** `closedby="any"` is not shippable - Chrome 134, Firefox
   141, no Safari. Compare `event.target === dialog` in a click handler instead;
   that fires when the click lands on the backdrop, because the backdrop is
   painted by the dialog box itself.
3. **Animation.** `@starting-style` plus `transition-behavior: allow-discrete` on
   `display` and on `overlay`. `overlay` is Chrome-only and degrades to an
   instant removal, which is acceptable.

**When it is an `alertdialog`.** The APG: an alert dialog "interrupts the user's
workflow to communicate an important message and acquire a response". Use
`role="alertdialog"` with `aria-describedby` on the message. A destructive
confirmation qualifies. A newsletter prompt does not.

**Mark it `aria-modal="true"` only when both APG conditions hold**: application
code prevents all users interacting with content outside it, and visual styling
obscures that content.

**States.** Closed, opening, open, closing - and separately, content scrolling
inside against page scrolling behind, which is the one everybody gets wrong.

**Junior mistakes.**

1. A `<div class="modal">` with a hand-rolled focus trap that misses iframes,
   `contenteditable`, `<audio controls>` and anything made focusable by
   `tabindex`.
2. `aria-modal="true"` with the background still operable.
3. Focus left on `<body>` after opening, or dumped on `<body>` on close instead
   of returned to the invoker.
4. `aria-hidden="true"` on a container that contains the dialog.
5. Escape closing a modal with unsaved input and no confirmation.
6. No `max-block-size`, so on a short viewport the buttons are below the fold.
7. `tabindex="-1"` plus `.focus()` on the dialog *and* an `autofocus` inside, so
   it announces twice.

---

## The one colour the system is missing

The palette has a single accent and no status ramp, and half the components below
need an error colour. Derive it inside the system - one lightness and chroma pair
per ground, hue as the only variable - rather than pulling a framework red.

Computed from the OKLCh token values in `core.css` by converting to linear sRGB
and applying the WCAG relative-luminance formula. These are computed, not
measured in a browser. **Where they overlap the measured table in
`typography.md`, that table is authoritative.** These are additions to it.

| Role | On `--bone-100` | Ratio | On `--ink-950` | Ratio |
|---|---|---|---|---|
| danger | `oklch(48% 0.14 28)` | 6.10:1 | `oklch(72% 0.13 28)` | 7.47:1 |
| success | `oklch(52% 0.13 150)` | 4.51:1 | `oklch(72% 0.13 150)` | 8.31:1 |

Three constraints travel with those values.

1. **There is no warning colour.** At C 0.14 the amber family falls outside sRGB
   and the browser clips it, silently changing the colour. Hue 75 is also too
   close to `--accent-h: 62` to read as a different signal. A warning is an icon
   and a word on the ordinary ground.
2. **1.4.1 Use of Color (Level A) governs all of it.** Status never travels by
   colour alone. The icon and the text carry it; the colour reinforces.
3. **A status colour is not the accent.** The accent rule - one hue, at most
   three elements - governs decoration. A status colour is functional and only
   present while its state is live.

Accent contrast figures not documented elsewhere, same method:

| Pair | Ratio | Consequence |
|---|---|---|
| `--accent` on `--bone-100` | 3.79:1 | Clears 3:1 for non-text (1.4.11) and large text. **Fails 4.5:1 for body text.** |
| `--accent` on `--ink-950` | 4.48:1 | Fractionally under. Not body-text safe on dark either. |
| `--on-accent` on `--accent` | 4.00:1 | **An accent-filled `.btn` fails 4.5:1 for its own label.** |
| `--bone-50` on `--accent-strong` | 7.28:1 | This is the accent-filled button that works. |
| `--accent-strong` on `--bone-100` | 6.91:1 | Accent-coloured body text, if ever needed. |
| `--ink-800` on `--accent-weak` | 11.88:1 | `--accent-weak` is a safe tint ground for a selected row. |

The shipped `.btn` uses `--fg` on `--bg` and is fine. It breaks the moment
somebody writes `background: var(--accent)`.

---

## Navigation

### Primary

**Decision.** Five to seven top-level destinations in the UI face. Above seven
the site has an information-architecture problem that a mega menu hides rather
than solves.

**States.** Rest, hover, focus-visible, current (`aria-current="page"`), stuck
(`.nav.is-stuck`), and the sixth one people forget: the `:has()` rule in
`core.css` that flips the nav ink over a flat hero. Check that against a dark
hero photograph.

**Pattern.** `<nav aria-label="Primary">` - not "Primary Navigation". The APG is
explicit: "Do not use the landmark role as part of the label", because a
navigation landmark labelled "Site Navigation" announces as "Site Navigation
Navigation". Style the current item with `[aria-current="page"]` rather than a
separate `.is-active` class, so the state and the style cannot drift apart.

**Junior mistake.** Colour as the only current-item signal (1.4.1). No
`aria-current` at all. A sticky header tall enough that a focused link tabbed to
from below ends up behind it - **2.4.11 Focus Not Obscured (Minimum), AA**: the
component is not entirely hidden due to author-created content.

### Secondary and in-page

**Decision.** A second level is either a sidebar (documentation, faceted
catalogue) or an in-page contents list. The house answer to in-page is `.index`
inside `<nav aria-label="Contents">`, worth using at four or more named sections.
Do not build a floating scroll-spy rail on an editorial page; it is a
documentation affordance and reads as one.

**Pattern.** Every additional `<nav>` gets its own unique label. The leader spans
are `aria-hidden="true"`; numerals get `tabular-nums` and `min-width: 2ch`
(`sections.md`). If you scroll-spy, update on an `IntersectionObserver` and do
not announce it - a value that changes continuously is decoration.

**Junior mistake.** Two unlabelled `<nav>` elements, so a screen reader lists
"navigation, navigation". And `aria-current="page"` on a fragment link to a
section of the page you are already on; the token there is `true` or `location`.

### Mega menu

**Decision.** Right only when a top-level item has more than about eight children
*and* those children need grouping under headings, a product image, or a promoted
item. Below that, a plain dropdown. On an editorial site the honest answer is
usually no mega menu: put the taxonomy on a real index page and link to it.

**Pattern - disclosure, never `role="menu"`.** The APG's own disclosure
navigation example says why: "This implementation of site navigation does not use
the `menu` role because it does not provide the complex functionality that
assistive technologies expect in a widget that has the `menu` role."

```html
<li>
  <a href="/work">Work</a>
  <button type="button" aria-expanded="false" aria-controls="m-work">
    <span class="visually-hidden">Show Work submenu</span>
    <svg aria-hidden="true" width="16" height="16">…</svg>
  </button>
  <ul id="m-work" hidden>…</ul>
</li>
```

`aria-expanded` goes on the button, never on the panel. Escape closes and returns
focus to the button. A click outside closes. Tab moves through the panel's links
in DOM order and out the other side - **do not trap focus in a navigation
panel**. If the trigger is also a destination, split it as above.

**States.** Closed, open, open-with-a-child-focused, closing. On touch the first
tap opens and never navigates.

*UNVERIFIED: hover-intent timings. Roughly 100-150ms before opening and 300-400ms
of grace before closing stops a diagonal mouse path thrashing the panel. These
are conventional values, not measured or specified.*

**Junior mistake.** `role="menu"` / `role="menuitem"` on site navigation, which
promises arrow keys, type-ahead, Home/End and focus wrapping that the code does
not implement - the APG's "No ARIA is better than Bad ARIA" case exactly.
Opening on `:hover` only. `aria-expanded` on the panel.

### Mobile navigation

**core.css:292 is `@media (max-width: 46rem) { .nav__links { display: none } }`
and there is no replacement anywhere in the chassis.** Below 736px a scaffolded
page has a brand, a ghost CTA and no navigation. This is the largest component
gap in the library. `craft.md` has the disclosure markup and CSS to paste into
`site.css`; what follows is the decision above it.

The hamburger's cost is structural, not fashionable: an unlabelled glyph hides
the whole shape of the site behind one tap and a memory. Ranked alternatives:

1. **No menu.** Three or four short items fit on one line at 360px at
   `--step--2`. A one-line nav beats a panel every time.
2. **A visible "Menu" word button.** Same panel; the glyph alone is what costs.
3. **A bottom bar** for app-shaped sites with three to five destinations. Not for
   editorial sites.
4. **Priority-plus**: show what fits, collapse the rest behind "More". Good for a
   long flat taxonomy.
5. **Hamburger with a visible label under it.** The fallback, not the default.

**Pick one behaviour and be consistent.** If the panel covers the page it is
modal: use `<dialog>` with `showModal()` and get inert, Escape, top layer and
focus return, then add the scroll lock. If it pushes content down it is a
disclosure: no trap, no inert. A panel that covers the page but does not trap
focus lets Tab walk invisibly through the content underneath, and that is the
single most common mobile-nav defect.

**Junior mistake.** `<div onclick>` with an SVG and no name; the icon missing
`aria-hidden` so it announces as "image"; the bars animated into an X with
`transition: all`; the body left scrollable behind a covering panel.

### Breadcrumb

**Decision.** Only when the site is genuinely hierarchical and deep. On a flat
marketing site it is decoration, and a single-level breadcrumb is worse than
none. Never as a substitute for the back button.

**Pattern.** APG keyboard interaction: "Not applicable."

```html
<nav aria-label="Breadcrumb">
  <ol>
    <li><a href="/">Home</a></li>
    <li><a href="/work">Work</a></li>
    <li><a href="/work/marlow" aria-current="page">Marlow</a></li>
  </ol>
</nav>
```

Separators are CSS `::before` content or an `aria-hidden="true"` span, never a
character typed into the text node.

**Junior mistake.** A `<div>` of links split by a typed slash, no `<nav>`, no
`aria-current`. Truncating the middle with an ellipsis that is not a button.

### Pagination, load more, infinite scroll

| Pattern | Use when | Cost |
|---|---|---|
| Pagination | The user needs to find a known item, cite a position, or come back to it | An extra click per page |
| Load more | A browsing feed where depth is optional | The footer keeps moving away |
| Infinite scroll | A stream with no end and no footer worth reaching | The footer becomes unreachable, back-navigation loses position, and it is the worst of the three by keyboard |

The rule: **anything with a footer worth reaching, or an item worth linking to,
gets pagination.** Load-more is the honest middle, and it is what most "infinite"
implementations should have been.

**Pattern.** `<nav aria-label="Pagination">` around an `<ol>` of real links with
real `href`s, `aria-current="page"` on the current one, previous and next named
for what they do ("Previous page"), not a chevron glyph. If you must do infinite
scroll, use the APG feed pattern - `role="feed"`, each `<article>` with
`aria-labelledby` and `aria-posinset` / `aria-setsize` (`-1` when the total is
unknown), `aria-busy="true"` on the feed during a multi-part update and back to
`false` when it settles - and keep a real paginated URL scheme underneath it.

*UNVERIFIED: every quantitative claim you have read about infinite scroll against
pagination - engagement, discovery, conversion. The argument above is structural
and does not need a number.*

---

## Forms

`.field` is the house treatment and it stays: boxless, one bottom hairline, an
11px uppercase UI label in the sans, focus moving the border to `--accent`. New
guidance extends it. Do not introduce boxed inputs, filled inputs or a floating
label as the house default.

**One note before you build.** `core.css:501` is:

```css
.field :is(input, textarea, select):focus {
  outline: none; border-bottom-color: var(--accent); }
```

That is `:focus`, not `:focus:not(:focus-visible)`, and at that specificity it
beats the global `:focus-visible` rule. A keyboard user's only indicator on a
form field is a 1px hairline changing colour. Put the ring back for `:focus-visible`
in `site.css` and thicken the hairline; against **2.4.7 Focus Visible (AA)** and
**1.4.11 Non-text Contrast (AA)** a hairline colour change on its own is thin.

### Which control

| Data | Control | Note |
|---|---|---|
| 2 mutually exclusive options | Radio group, both visible | Never a select for two |
| 3-6 exclusive options | Radio group, or a select if space is genuinely short | |
| 7+ exclusive, known list | `<select>` | Native. See below |
| 7+ with search | `<input list>` + `<datalist>`, or a real APG combobox | `datalist` works everywhere current but its popup is unstylable |
| Any number, multi-select | Checkboxes | A multi-select `<select>` is a usability defect on touch |
| On/off, applies immediately | `role="switch"` | |
| On/off, applies on submit | Checkbox | The distinction is *when it takes effect*, not how it looks |
| One line of text | `<input type=text>` with the right `inputmode` | |
| Many lines | `<textarea rows>` | `field-sizing: content` as enhancement |
| Email / tel / url | `type=email`, `type=tel`, `type=url` | `type=tel` does no validation; add a `pattern` only if you actually know the format |
| Money, quantity | `type=text inputmode=decimal` | `type=number` has spinners, silently drops non-numeric input, and changes value on a stray scroll |
| Date | see Date and time | |

`inputmode` takes `none`, `text`, `decimal`, `numeric`, `tel`, `search`, `email`,
`url`. It hints at the on-screen keyboard and validates nothing.

### Labels, placeholders, help, required

- **Every visible control gets a real `<label for>`.** The audit errors on a
  missing one. Never `aria-label` on an input that already has a visible label -
  it overrides and hides the visible text.
- **Placeholders are for a format example only**, and only where the format is
  non-obvious. Never the label: it disappears on focus, fails **3.3.2 Labels or
  Instructions (A)**, and sits at the bottom of the APG's naming precedence.
- **Help text is a `<p class="caption" id="f-x-help">` wired with
  `aria-describedby`**, present before the user types, not after they fail. If a
  password has rules, show them up front and tick them live in a `role="status"`.
- **Mark what is required**, not what is optional - unless most fields are
  optional, then invert it - and state which convention you are using in text at
  the top of the form. An asterisk with no key means nothing. Use the `required`
  attribute (which gives `aria-required` free) plus a visible marker that is not
  colour alone.

### Validation timing

1. Never validate on `input` while a field is first being filled. Flagging
   "invalid email" at the third keystroke is hostile.
2. Validate on `blur` only if the field has been changed, and then only to show
   an error, never to clear one silently.
3. Once a field has shown an error, downgrade to live: re-validate on `input` so
   the error clears the moment it is fixed.
4. On submit, validate everything, move focus to the first invalid field, and
   announce the count.
5. `:user-invalid` / `:user-valid` do steps 1 and 2 in pure CSS and are Baseline
   widely available (high 2026-05-02; Chrome 119, Firefox 88, Safari 16.5).
   `:invalid` alone styles an empty required field as an error on page load,
   which is the classic defect.

### Errors

Inline, at the field, in text - **3.3.1 Error Identification (A)** - with a
suggestion where one is known - **3.3.3 Error Suggestion (AA)**. Long forms also
get a summary at the top, each item a link to its field.

ARIA 1.2 makes the pairing a MUST: "Authors MUST use `aria-invalid` in
conjunction with `aria-errormessage`." Keep the help text in `aria-describedby`
and the error in `aria-errormessage`; do not put the error in both.
`aria-errormessage` may sit on a valid field only if the element it references is
hidden. `craft.md` has the field markup and the `--state-error` CSS; the derived
value is in the status ramp above.

### Autofill

`autocomplete` is not optional. **1.3.5 Identify Input Purpose** is Level AA.
The tokens that matter: `name`, `given-name`, `family-name`, `nickname`,
`organization`, `organization-title`, `email`, `tel` (plus `tel-country-code`,
`tel-national`, `tel-extension`), `street-address`, `address-line1`-`3`,
`address-level1`-`4`, `postal-code`, `country`, `country-name`, `username`,
`current-password`, `new-password`, `one-time-code`, `cc-name`, `cc-number`,
`cc-exp`, `cc-csc`, `cc-type`, `bday`, `url`, `language`. Prefix addresses with
`shipping ` or `billing `. The HTML Standard's `off` means the data is
"particularly sensitive" or will never be reused - not "I dislike the yellow
box".

### Multi-step

Split only when the form genuinely exceeds about ten fields or serves more than
one audience. Then: one idea per step, a visible step indicator, every step's
data preserved on Back, and nothing re-asked - **3.3.7 Redundant Entry is Level
A**, a conformance requirement rather than advice. The indicator is an `<ol>`
with `aria-current="step"` on the active item. Moving between steps moves focus
to the new step's heading (`tabindex="-1"` then `.focus()`); the heading is
announced by the focus move, so do not also write to a live region.

### Select

`appearance: base-select` is Baseline limited - Chrome 135, Firefox behind a
flag, Safari 27, which shipped on 2026-09-14 and therefore has effectively no
installed base. It is not shippable. There are exactly two honest options:

1. Style the closed control and leave the open list to the OS. `.field select`
   already does this. Accept it.
2. Build a full APG combobox - `role="combobox"`, `aria-expanded`,
   `aria-controls`, `aria-activedescendant` into a `role="listbox"`,
   `aria-autocomplete` of `none` / `list` / `both` - and own every keyboard
   interaction.

A `<div>` with a chevron and a click handler is neither.

### File upload

**Decision.** Native `<input type="file">` first. Drag-and-drop is an addition,
never the only route. Multi-file only if the server accepts multi-file.

**States.** Empty, hover, dragover, selected (names, sizes, a remove button
each), uploading (per-file progress), succeeded, failed with a reason and a
retry.

**Pattern.** Keep the real input in the DOM and in the tab order and style
`::file-selector-button` (Chrome 89, Firefox 82, Safari 14.1). If you must
replace the control entirely, use `.visually-hidden` from `core.css` - never
`display: none`, which removes it from the tab order - and wrap it in a `<label>`
so the label click opens the picker and the name attaches. State the accepted
types and the size limit in text before the control, not in an error after. The
selection is a `<ul>`; each remove button's name includes the filename. Progress
is `<progress>` with a text percentage beside it; the outcome goes to a
`role="status"`.

**Junior mistake.** `display: none` on the input. A drop zone with no button,
which is keyboard-inaccessible. No stated limit until the server rejects it.
Deleting the selection on a failed upload. Trusting `accept` as validation.

### Date and time

**Decision.** `<input type="date">` is almost always right: OS picker, OS locale,
OS accessibility, correct mobile keyboard, all free. Three cases justify
something else - a date range where two linked calendars genuinely help, a
booking calendar that must show availability in the grid, and a partial date
(month and year, or a birth year), where three labelled text inputs beat any
picker.

**Pattern.** A real `<label>`, plus the expected format as help text wired with
`aria-describedby`; the native control does not announce its format consistently.
`min` / `max` for range, `autocomplete="bday"` where it applies.
`input.showPicker()` (Chrome 99, Firefox 101, Safari 17.4 for date) opens the
picker from your own button but needs a user gesture, and iOS Safari does not
support several types - feature-detect and leave the native affordance as the
fallback.

**Styling reality.** There are no standardised styling hooks for the native date
picker. `::picker()` is currently defined for `select` only. Style the field, not
the picker. *UNVERIFIED: `::-webkit-calendar-picker-indicator` is not in MDN's
browser-compat data. Treat it as non-standard with no support figures.*

If you build one it is the APG **grid** pattern: arrow keys move by day, Page
Up/Down by month, Home/End within the week, one tab stop for the whole grid, a
live region announcing the focused date in full, `aria-selected` on the chosen
day and `aria-disabled` on unavailable ones. That is a week of work against a
free control.

**Time.** `type="time"` for a clock time, `type="datetime-local"` for both. State
the time zone in text - the control does not carry one. Durations are two number
fields with units, never a time input.

**Junior mistake.** A text input with an `MM/DD/YYYY` placeholder and a regex,
shipped where people write DD/MM. A JS calendar with no keyboard support. Hiding
the native input behind a custom button, which removes typing - typing a date is
faster than eleven clicks. A range whose end can precede its start with nothing
said.

### Search, filters, faceted search

**Decision.** A site under about thirty pages does not need search; it needs a
better index page. The publications table in `sections.md` is the editorial
alternative and scales further than people expect. Add search when the content is
a genuine corpus.

**Pattern.** The `<search>` element (Baseline widely available, high 2026-04-13;
Chrome 118, Firefox 118, Safari 17) wrapping the form; `<input type="search"
name="q">` with a real label (`.visually-hidden` is fine - the magnifier does not
name it); `enterkeyhint="search"`. A single `role="status"` announcing the count
("24 results for ferry timetables") satisfies **4.1.3 Status Messages (AA)** for
the whole interaction. Debounce it, or four ticked checkboxes announce four
times.

| Filter situation | Control |
|---|---|
| 2-6 independent options, all visible | Checkbox group in a `<fieldset>` with a `<legend>` |
| 7+ options in one facet | Checkbox group inside a collapsed `<details>`, count in the summary |
| Mutually exclusive views | Radio group, or tabs if each view is genuinely a different page of content |
| Sort order | A labelled `<select>` or a toggle set - never both |
| A range | Two number inputs before a slider; a slider alone cannot be typed into |

**Faceted search.** Show applied filters as a removable set above the results,
each a `<button>` whose name includes the facet - "Remove filter: Colour,
oxblood", not a cross glyph. Show counts per facet value and `aria-disabled` the
zero-count ones rather than hiding them, so the shape of the data stays visible.
Apply on change for cheap queries, behind an explicit Apply for expensive ones,
and never both in one panel. **Every applied filter set goes in the URL**, or the
result cannot be shared or bookmarked.

**Junior mistake.** A filter that reloads and dumps focus at the top of the
document. `aria-pressed` toggle buttons where checkboxes carry the semantics
free. Filters absent from the URL. Announcing every keystroke in an `assertive`
region.

---

## Content

### Cards and lists

**Decision.** A card is right when each item has a picture, a title and one or
two facts, and the items are genuinely comparable. A list is right when they are
not. Three cards with an icon, a heading and forty words is the most-listed
layout tell in `tells.md`; if the content is three abstract capabilities it is
prose with subheads.

Use `.cards` (auto-fit) and `.card`. `repeat(3, 1fr)` is a warned tell; use
`repeat(auto-fit, minmax(…, 1fr))`. **Card internals size with container
queries**, not viewport media queries - a card knows how wide it is, not how wide
the viewport is. Container queries are Baseline widely available (high
2025-08-14; Chrome 105, Firefox 110, Safari 16).

**States.** Rest, hover (`.card:hover` ships a lift and a border change),
focus-within, selected if selectable, unavailable.

**Pattern.** The whole-card-clickable problem has one good answer: a real `<a>`
on the title, `position: relative` on the card, and `::after { position:
absolute; inset: 0 }` on that anchor. Raise any text you want selectable with
`position: relative; z-index: 1`. Never nest a second link or button inside the
overlay - if the card needs two actions it is not a link, and the actions are
their own controls. A list of cards is a `<ul>` of `<li>`, which gives the count
free.

**Junior mistake.** Wrapping the whole card in `<a>`, so the accessible name is
every word in the card read as one link. `<div onclick>` with a nested "Read
more". Identical "Read more" text on twelve cards (2.4.4). Both a border and a
shadow on one card - depth is one mechanism only. Equal visual weight on every
card, so nothing is the primary item.

### Tables and dense data

**Decision.** A real `<table>` when the content is tabular, meaning the cells
share a meaning across a row **and** down a column. A feature list with an icon
and a paragraph is not a table; a one-column table is a list. The APG: "authors
are strongly encouraged to use a native HTML `table` element whenever possible."
Use `role="grid"` only when the cells are interactive and you are implementing
arrow-key navigation with a single tab stop - the APG's own distinction is that
in a grid only one focusable element is in the page tab sequence, where in a
table they all are.

`.spec` is a two-column specification list, not a data table. A data table is new
CSS in `site.css`.

**Structure.** `<caption>` is the table's accessible name and a real editorial
opportunity - it can carry the unit and the date. `<thead>`, `<th scope="col">`,
`<th scope="row">`. `scope` is the whole accessible story for a regular table;
`headers`/`id` only for irregular ones.

**Responsive, ranked.**

1. **Horizontal scroll in its own container.** `<div class="table-wrap"
   tabindex="0" role="region" aria-label="Fare table">` with `overflow-x: auto`.
   The `tabindex="0"` is what makes it keyboard-scrollable; without it, column
   six is mouse-only. This is the house answer.
2. **Drop secondary columns at narrow widths** - behind a disclosure, not into
   the void.
3. **Sticky first column** (`position: sticky; inset-inline-start: 0`) so the row
   label survives the scroll.
4. **Card per row below a breakpoint.** Short tables only, and only when each row
   is genuinely an object. It destroys column comparison, which is the reason a
   table exists.

Never the `::before { content: attr(data-label) }` stacked-label trick past about
six rows: it repeats every header on every row and is unreadable aloud.

**Density.** Row height from line-height, not padding, so it scales with the
type. `tabular-nums` on every numeric column (`.num` / `.data` already). Numbers
right- or decimal-aligned, text left. Units in the header, not in every cell.
Zebra striping only above about fifteen rows and as a 3-4% tint of the ground,
never a grey; row hover is the better affordance for most tables and the two
together are noise.

**Sorting.** Only where comparison is the point. `aria-sort` goes on the `<th>`
and takes `ascending`, `descending`, `other`, `none`, and exactly one header
carries a value other than `none` at a time. The header content becomes a
`<button>` so it is operable; the indicator is an inline SVG with
`aria-hidden="true"`. Announce the new order in a `role="status"` - the visual
order changed and nothing else said so.

**Selection.** A checkbox column whose header checkbox is named "Select all rows
on this page", never "Select all", which lies about pagination. The
indeterminate state is a DOM property (`el.indeterminate = true`), not an
attribute; a native checkbox maps it for you. Selection count and bulk actions go
in a bar above the table, announced with `role="status"`.

**Junior mistake.** A `<div>` grid with `role="table"` and no `role="row"` or
`role="cell"` children, which breaks the table outright. `aria-sort` left on two
headers. A sortable `<th>` with an onclick and no button. Horizontal scroll with
no `tabindex`. Dropping the `<caption>`, so the table has no name.

### Tabs, accordion, disclosure

| Situation | Control |
|---|---|
| Mutually exclusive views of one subject, all short, the user compares them | Tabs |
| Independent sections, any number of which may be open | Accordion |
| One thing hidden and shown | Disclosure |
| Content the user must read | None. Put it on the page |
| Content a search engine must index or find-in-page must reach | `<details>`, never a JS panel with `display: none` |

That last row is the strongest argument in the group: `<details>` opens on
find-in-page in Chrome 97, Firefox 148 and Safari 26.2 (partial). A JS accordion
does not.

More than about five tabs is a scroller and probably wants to be a page. An
accordion with every panel closed hides the whole page behind clicks; open the
first, as the shipped `faq` block does.

**Tabs.** `role="tablist"` / `role="tab"` / `role="tabpanel"`; `aria-selected` on
the tab; `aria-controls` from tab to panel and `aria-labelledby` from panel to
tab; roving tabindex so only the selected tab is in the Tab sequence
(`tabindex="-1"` on the rest); `tabindex="0"` on the panel so its content is
reachable; arrow keys move and wrap; `aria-orientation="vertical"` for a vertical
list. Automatic activation only when the panels are instant - the APG's wording
is "when panels preload without latency" - otherwise manual, on Space or Enter.

**Accordion.** `<h3><button aria-expanded aria-controls>…</button></h3>`, and per
the APG "The `button` element is the only element inside the heading element."
All headers are in the Tab sequence; there is no arrow-key requirement.
`aria-disabled="true"` on the button of an open panel that cannot be collapsed.
`role="region"` on the panel is optional and carries a landmark-proliferation
caveat - twelve panels is twelve landmarks.

**The house FAQ.** `.faq` on `<details name="faq">` gives exclusive-accordion
behaviour natively (Baseline newly available 2024-09-03; Chrome 120, Firefox 130,
Safari 17.2) and the browser maintains `aria-expanded` on the `<summary>`. **Do
not add ARIA to it.** Its one limit: animating the height needs
`interpolate-size: allow-keywords`, which is Chrome-only, so the `+`-to-`x`
rotation the chassis ships is the right amount of motion and a height transition
is a Chrome-only effect. `::details-content` (Chrome 131, Firefox 143, Safari
18.4) is the styling hook if you need one.

**States.** Collapsed, expanded, focused - and for tabs, selected-but-not-focused
under manual activation, which needs a visibly different treatment from
selected-and-focused or a keyboard user cannot tell what Enter will do.

**Junior mistake.** Tabs built from `<div>`s with click handlers and no roles.
`aria-expanded` on the panel. `aria-selected` on an accordion header (it is
`aria-expanded`). A heading wrapping the button and other content. Panels hidden
with `visibility: hidden; height: 0`, so they stay in the tab order. Tabs whose
panels each hold a page of content - that is a navigation problem in a tab
costume.

---

## Overlays and messages

### Drawer, popover, tooltip

**Drawer.** Modal drawer: `<dialog>` positioned to an edge, with everything in
Decision two. Non-modal drawer: a plain `<aside>` with a disclosure button, no
focus trap, nothing `inert`.

**Popover.** The `popover` attribute is Baseline newly available (2025-01-27;
Chrome 116, Firefox 125, Safari 17). It gives the top layer, light dismiss and
Escape with no JS:

```html
<button popovertarget="panel">Options</button>
<div id="panel" popover>…</div>
```

`:popover-open` is the styling hook. Anchor it with anchor positioning behind
`@supports (anchor-name: --a)` and a centred fallback - and use only the logical
keywords (`span-block-start`, `span-inline-end`, `flip-block`, `flip-inline`),
which are the interoperable subset. The physical `position-area` keywords are
newer than most installed browsers (Chrome 144, Firefox 148), and
`anchors-valid` / `anchors-visible` are in Firefox and Safari but not Chrome.

**Tooltip.** The APG tooltip pattern still carries the line "This design pattern
is work in progress; it does not yet have task force consensus", and "Tooltip
widgets do not receive focus." Everything a tooltip touches is governed by
**1.4.13 Content on Hover or Focus (AA)**, which has three conditions:
dismissible without moving the pointer or focus, hoverable (the pointer can move
onto the content without it vanishing), and persistent until dismissed or no
longer valid. A tooltip longer than a line fails hoverable and persistent in
practice; a hover surface that contains focusable content should be a non-modal
dialog instead. If the text matters, it is help text on the page, not a tooltip.

### Toasts, banners, inline alerts

| Message | Placement | Role |
|---|---|---|
| Result of what the user just did, non-blocking | In place next to the control; a toast only if that is impossible | `role="status"` |
| A field is wrong | Inline at the field | `aria-invalid` + `aria-errormessage` |
| The whole form failed | Summary at the top, focus moved to it | Focus plus a heading, or `role="alert"` |
| Site-wide condition | Banner at the top, in flow, not fixed | `role="status"` or a plain labelled region |
| Destructive confirmation | `alertdialog` | Not a toast |

**The rule about toasts: a toast is only correct for information the user can
afford to miss.** ARIA 1.2 is the source - "Since alerts are not required to
receive focus, authors SHOULD NOT require users to close an alert. If an author
desires focus to move to a message when it is conveyed, the author SHOULD use
`alertdialog` instead of `alert`."

`role="status"` carries implicit `aria-live="polite"` and is atomic;
`role="alert"` is the assertive counterpart and is for something genuinely
urgent. One region per purpose, reused.

**A toast that contains a button must not auto-dismiss.** A control inside a live
region is announced but not reachable without a focus move, and the usual
workaround is a keyboard shortcut nobody knows about. An undoable action gets an
inline undo next to the thing, or a dialog.

**Auto-dismiss is a time limit.** **2.2.1 Timing Adjustable (A)** requires turn
off, adjust or extend. Pausing on hover and on focus, plus a manual dismiss, is
the usual way to meet it. *UNVERIFIED: the conventional five-second floor. The
WCAG requirement is verified; the number is not.*

**Junior mistake.** `role="alert"` on everything, so every save interrupts. A
toast with an action and a four-second timer. Eight stacked toasts with no cap. A
toast in the corner covering the primary action. Colour-only severity (1.4.1).

---

## The four states everyone ships as one

Empty, zero-results, loading and error are four different problems with four
different designs. `craft.md` has the copy rules; this is the decision and the
wiring.

| State | What it must contain |
|---|---|
| **Empty (nothing yet)** | What this area is for and the one action that fills it. The highest-value copy on the page, always written last and badly |
| **Zero results (a filter excluded everything)** | The query echoed back, which filters are applied, and a way to remove them one at a time. Never the same design as empty - the user's problem is different |
| **Loading** | A finished-looking layout at rest, then an indicator |
| **Error** | What failed, whether it was them or us, and a retry. Never a status code alone |

**Skeletons.** Right when the final layout is known and stable. Wrong when the
shape is unknown, because they lie; wrong on a long wait, because they read as
broken; wrong on a first-time empty area, because they promise content that does
not exist. A labelled spinner is more honest for an unknown shape. *UNVERIFIED:
the conventional thresholds - nothing under about 300ms, no skeleton past about
three seconds. The timing rule that is verified is Nielsen's, in `craft.md`.*

**Wiring.** The container gets `aria-busy="true"` while loading and `false` when
it settles. Skeleton shapes are `aria-hidden="true"` - they are decoration. One
`role="status"` announces "Loading" and then the result. Do not announce every
skeleton block.

**Motion.** Content visible at rest applies here without exception: the
reduced-motion fallback for a shimmer is a *static* skeleton, not a hidden one.
The global 1ms brake in `core.css` flattens the animation already; what to check
is that the flattened frame is a readable block and not a mid-keyframe flash.

**Junior mistake.** Skeletons that do not match the real layout, so the content
jumps - `quality` reports that as layout shift with a named source. `aria-busy`
set and never cleared. A spinner with no accessible text. The same illustration
for empty and zero-results. "Something went wrong."

---

## Sections that sell

### Pricing and comparison

**Decision.** A pricing table is a comparison table with money in it, and both
are right only when the reader has already decided to buy and is choosing between
options. If they have not decided, a table is a wall. Two tiers is a choice,
three is a table, five is a configurator.

**Composition.** `repeat(3, 1fr)` is the warned tell and the pricing grid is
where it always appears - use `repeat(auto-fit, minmax(16rem, 1fr))`. Make the
recommended column wider or set it on a raised ground. **Do not put an accent
stripe on it**; that is a listed tell. Distinguish it with the ground, the type
size, or a run-in small-caps label inside the tier name (the device in
`sections.md`).

**Honesty, not negotiable.** No invented price, no invented "most popular", no
invented saving percentage, no struck-through original, no countdown that resets,
no "trusted by 10,000 teams". If the real price is not known, the section does
not ship: leave the brief's placeholder and let the audit fail it.

**Pattern.** Past about four compared rows, a real `<table>` with `<th
scope="col">` per tier and `<th scope="row">` per feature beats three `<div>`
cards, because it gives row and column announcement free. Tick and cross marks
are inline SVG with a real accessible name ("Included" / "Not included") - never
`aria-hidden` on a mark that carries the only meaning in the cell. A dash for
"not applicable" is a different fact from a cross for "not included", and the
difference belongs in the text. Prices in tabular figures; currency and billing
period in the header, not repeated per cell. A monthly/annual toggle is a radio
group or a labelled `role="switch"`, it announces its change (4.1.3), and both
prices are stated somewhere rather than only the selected one.

**Junior mistake.** `repeat(3, 1fr)`. Unnamed tick marks, so every row announces
as "graphic, graphic, graphic". A toggle that silently changes every price. Tier
names with no `scope`. Features so vague the comparison is meaningless. A
"Contact us" tier at "Custom" with no range, which is the one thing the reader
came for.

### Testimonials and social proof

The rule that decides this section is: **never invent a specific.** That removes
most of what people mean by social proof, and what is left is better.

| Signal | Requirement |
|---|---|
| A quote | A real named person, their role and organisation, ideally a date and a link to the source |
| A case study | A real outcome with a real number, dated, method stated |
| A client list | Organisations that are actually clients, with permission, set as text |
| A count | Real, current and dated: "412 orders shipped in 2025" beats "thousands of happy customers" |
| A review score | Only with the platform, the count and a link |
| A byline | The named human who did the work is itself proof; a site with no named humans is a listed tell |

What does not ship: gradient-letter avatars, invented names and titles, quotes
that all run exactly two lines, star ratings with no source, the greyscale logo
wall.

**Design.** One long quote beats five short ones - the `quote` block, display
serif at `--step-2` or above with the attribution in the UI face. If there is
only one real testimonial it is a pull quote in the flow of the page, not a
"Testimonials" section with one card in it. A real photograph of the person if
you have one and permission; otherwise no avatar. An absent avatar is honest; a
generated one is not.

**Pattern.** `<figure>` + `<blockquote>` + `<figcaption>`, with the attribution
in the `figcaption`, outside the `blockquote` - quoting the attribution inside it
says the person recited their own job title. A rotating testimonial carousel
inherits every requirement of the APG carousel pattern: `aria-roledescription=
"carousel"`, `role="group"` with `aria-roledescription="slide"` per slide, a
stop/start button whose label matches the action, rotation stopping on hover and
on focus entering and not restarting unless asked. `.cards--rail` avoids all of
it and is the house answer.

**Junior mistake.** Fabricating any of it. An auto-rotating carousel with no
pause. A five-star row as an image with no text equivalent. `<blockquote>` used
for visual indentation on text nobody said.

---

## Dashboards

**Hand every chart, stat tile, KPI row and dashboard block to the `dataviz`
skill** (`references/plugins.md`). What belongs here is the shell around them.

**Decision.** A dashboard is right when someone returns to it repeatedly to
answer the same questions. If they visit once it is a report, and it should be
prose with figures in it. The number of tiles is decided by the number of
questions, not by the grid.

**Density.** One screen with no scroll is a myth that produces 9px type. Let it
scroll and make the top band answer the first question completely. Group by
question, not by data source. Every number needs a unit, a period and a
comparison; a number with no comparison is not information.

**States.** Loading per tile, never per page - a whole-page spinner makes nine
round trips look like one failure. Then loaded, stale (a visible last-updated
time), zero-data, per-tile error with a per-tile retry, filtered.

**Pattern.** Each tile is a `<section>` with an `<h3>`, and the heading order is
the reading order. Every chart has a text alternative that states the finding,
not "chart of sales"; a `<table>` behind a disclosure is the best text
alternative there is. Filters that change every tile announce once in a
`role="status"`, not once per tile. Auto-refresh is a time limit (2.2.1): it
needs a pause and must never move focus.

**Junior mistake.** A KPI with no period. Colour-only status on a tile (1.4.1). A
whole-page skeleton. Auto-refresh that steals focus or resets a filter.
`<canvas>` charts with no text alternative. A dashboard that is really one
number, which should have been a sentence.

---

## Onboarding and progressive disclosure

**Decision.** A product tour is almost always the wrong answer to a design
problem - it is an apology for an interface nobody can read. Ranked
alternatives: make the empty state teach; label the thing properly; put the one
non-obvious affordance behind an inline hint that appears once. A tour earns its
place only for a genuinely novel interaction model, and then it is skippable at
every step and re-runnable from a help menu.

**Progressive disclosure.** Show what most people need and put the rest one
deliberate action away, with the action named for what is behind it. "Advanced"
is not a name. "Shipping options" is.

**Pattern.** A tour step is a non-modal dialog anchored to its target, or a modal
if it blocks. Either way: focus moves to the step, the step says which of how
many, Escape exits the whole tour, and the target is scrolled into view and given
a visible outline that is not the focus ring.

**Junior mistake.** A tour with no skip. A hover card as a teaching device -
hover does not exist on touch, and `interestfor` is Chrome-only. Coach marks
covering the thing they describe. A tooltip used as documentation, which fails
1.4.13 the moment it is longer than a line.

---

## Newly native in 2026: what you can delete

Support verified against the webstatus.dev API and MDN browser-compat-data on
14 September 2026. Current stable that day: Chrome 154, Firefox 155, Safari 27
(released the same day, so treat any Safari-27 feature as having no installed
base).

| Use this | Instead of | Baseline | Chrome / Firefox / Safari |
|---|---|---|---|
| `<dialog>` + `showModal()` | A modal library, a focus trap, a z-index stack | **widely** (high 2024-09-14) | 37 / 98 / 15.4 |
| `::backdrop` | A hand-built scrim div | **widely** (high 2024-09-14) | 37 / 47 / 15.4 |
| `:modal` | A body class toggled in JS | **widely** (high 2025-03-02) | 105 / 103 / 15.6 |
| `popover` attribute + `:popover-open` | A dropdown library, light-dismiss handlers, Escape handling | **newly** (2025-01-27) | 116 / 125 / 17 |
| `inert` | Manually saving and restoring every `tabindex` behind an overlay | **widely** (high 2025-10-11) | 102 / 112 / 15.5 |
| `<details>` / `<summary>` | A JS disclosure - and this one is also findable by find-in-page | **widely** (high 2022-07-15) | 12 / 49 / 6 |
| `<details name>` | An exclusive-accordion script | **newly** (2024-09-03) | 120 / 130 / 17.2 |
| `:user-invalid` / `:user-valid` | A "touched" / "dirty" flag in JS | **widely** (high 2026-05-02) | 119 / 88 / 16.5 |
| Container queries | Viewport media queries pretending to know a component's width | **widely** (high 2025-08-14) | 105 / 110 / 16 |
| `<search>` | `<div role="search">` | **widely** (high 2026-04-13) | 118 / 118 / 17 |
| `@starting-style` + `transition-behavior: allow-discrete` | A two-frame `requestAnimationFrame` dance to animate in from `display: none` | **newly** (2024-08-06) | 117 / 129 / 17.5 |
| `scrollbar-gutter: stable` | Measuring the scrollbar and padding the body during a scroll lock | - | 94 / 97 / 18.2 |
| `light-dark()` | Two full token blocks | **newly** (2024-05-13) | 123 / 120 / 17.5 |
| Native scroll-snap (`.cards--rail`) | A carousel library | - | shipped everywhere current |
| `::file-selector-button` | Hiding the file input behind a fake button | - | 89 / 82 / 14.1 |
| `content-visibility` | Hand-rolled list virtualisation on a long static page | **newly** (2025-09-15) | 108 / 130 / 26 |

Behind `@supports`, as enhancement only:

| Feature | Baseline | Chrome / Firefox / Safari | Verdict |
|---|---|---|---|
| Anchor positioning core (`anchor-name`, `position-try`) | limited as a group | 125 / 147 / 26 | Use behind `@supports (anchor-name: --a)`, logical keywords only. Physical `position-area` keywords are Chrome 144 / Firefox 148 |
| Same-document view transitions | **newly** (2025-10-14) | 111 / 144 / 18 | Feature-check `document.startViewTransition` |
| `::details-content` | **newly** (2025-09-16) | 131 / 143 / 18.4 | Styling hook only |
| `field-sizing: content` | **newly** (2026-06-16) | 123 / 152 / 26.2 | Textarea autogrow, degrades to a fixed `rows` |
| Invoker commands (`command` / `commandfor`) | **newly** (2025-12-12) | 135 / 144 / 26.2 | Keep the JS listener |
| Scroll-driven CSS animation | **limited** | 115 / no / 26 | Progressive enhancement. Drive real scroll work with ScrollTrigger - `references/awards.md` |

Not yet, whatever a blog post says:

| Feature | State | Why not |
|---|---|---|
| `<dialog closedby>` | limited: 134 / 141 / no | Safari has it in Technology Preview only. Keep the backdrop-click handler |
| Customizable `<select>` (`appearance: base-select`, `<selectedcontent>`) | limited: 135 / flag / 27 | One engine plus a browser released today |
| `interpolate-size: allow-keywords` | Chrome 129, not in Firefox or Safari | Animating `<details>` height is a Chrome-only effect |
| `::scroll-marker` / CSS carousels | limited: 135 / no / no | Chrome-only |
| Interest invokers (`interestfor`) | limited: 142 / no / no | Chrome-only, and hover does not exist on touch |
| `popover="hint"` | limited: 151 / 153 / no | |
| `hidden="until-found"` | limited: 102 / 148 / no | Enhancement only |
| `<input type=checkbox switch>` | limited: Safari 17.4 only | Build the APG switch |
| `prefers-reduced-transparency` | limited: 119 / no / no | |

**Three things are still yours, and no element gives them to you:** the scroll
lock behind a modal (WHATWG HTML #7732 is still open), a visible focus indicator
that meets 1.4.11, and an accessible name on every icon-only control.

---

## UNVERIFIED, collected

Everything flagged above, in one place, so none of it leaks into a page as fact.

- **A live region must exist in the DOM before its content is written.** This is
  the standard mitigation and every implementation does it, but it is
  assistive-technology behaviour, not text in ARIA 1.2's `aria-live` definition.
  `craft.md` states it as a rule; treat it as observed behaviour.
- **Every quantitative claim about hamburger menus, infinite scroll against
  pagination, form length and completion rates.** None verified, none cited.
- **Hover-intent timings** (100-150ms to open, 300-400ms of grace to close).
  Conventional starting points.
- **Skeleton thresholds** (nothing under ~300ms, no skeleton past ~3s).
  Conventional.
- **A five-second toast floor.** Conventional. The WCAG 2.2.1 requirement behind
  it is verified.
- **`::-webkit-calendar-picker-indicator`.** Not in MDN browser-compat-data.
  Non-standard, no support figures.
- **Field availability of any Safari 27 feature.** Safari 27 is marked current
  with a release date of 2026-09-14.
- **Whether any scaffolder template sets `--nav-h`.** `core.css:168` defaults it
  to `4.5rem`; nothing in `core.css` or `sections.html` assigns it.

Verified against, on 14 September 2026: the ARIA Authoring Practices Guide
patterns and practices, WAI-ARIA 1.2, WCAG 2.2 and its Understanding documents,
the HTML Standard (interactive elements, popover, form control infrastructure),
WHATWG HTML issue 7732, the webstatus.dev features API, MDN browser-compat-data,
chromiumdash and product-details.mozilla.org.
