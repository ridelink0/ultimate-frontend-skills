# What a senior does without being asked

Six things that separate a page that looks finished from a page that is
finished. None of them are visible in a screenshot, which is why they get
skipped.

Read this when the composition is settled and the page has to survive contact
with a keyboard, a phone, a slow connection and a real user. It does not repeat
the files that already own their subjects:

- `tells.md` owns what gives a generated page away, and the inverse list.
- `typography.md` owns the type scale, the measured contrast table and the
  faces.
- `sections.md` owns composition, glass, the grid and the form treatment.
- `motion.md` owns the motion scale, the scroll work and the reduced-motion
  reset.
- `checklist.md` owns the pre-ship pass.
- `visual-debug.md` owns what the rendered checks can and cannot see.

Where this file and those overlap, this one links and moves on.

Everything here is a design decision. An engineer cannot add interaction states,
a reflow strategy or an LCP element to a finished layout without redesigning it.

---

## 1. Interaction states as a system

The junior ships hover. The senior ships the whole matrix and knows which four
are the floor.

`core.css` ships rest, hover, focus-visible and active on `.btn`, `.btn--ghost`,
`.link`, `.card` and `.sky__dot`. It ships no disabled treatment, no loading
treatment, no error or success colour and no selected state, because a one-page
editorial site rarely needs them. The moment the page grows a form that talks to
a server, you are building them, and they go in `site.css`.

### The matrix

Every interactive element answers every row that applies to it, or it is not
designed. "Signal" is the non-colour carrier. Colour alone fails **1.4.1 Use of
Color (Level A)**: "Color is not used as the only visual means of conveying
information, indicating an action, prompting a response, or distinguishing a
visual element."

| State | Selector or attribute | Non-colour signal | Duration |
|---|---|---|---|
| rest | none | the design | none |
| hover | `:hover` inside `@media (hover: hover)` | underline sweep, lift, rule thickens | 120-200ms |
| focus | `:focus-visible` | ring with offset, always | instant |
| active | `:active` | 1px translate, or scale 0.99 | 80-120ms |
| disabled | `:disabled` or `[aria-disabled="true"]` | cursor, lighter weight, no hover response | none |
| loading | `[aria-busy="true"]` | indicator in a reserved slot, label intact | see the timing rule |
| error | `:user-invalid` or `[aria-invalid="true"]` | message text plus a border change | 200ms in, none out |
| success | a `role="status"` message | a sentence, not a tick | 300-450ms |
| selected | `aria-current`, `aria-pressed`, `aria-selected` | weight, rule, position | 200ms |
| indeterminate | `:indeterminate` | a dash glyph, not an empty box | none |
| dragging | your own attribute | cursor, elevation, a gap where it was | 120ms |

The durations are the micro and element bands from `motion.md`. Do not invent a
second scale.

### The rules

1. **Design disabled and loading before rest.** They decide the geometry. A
   button 104px wide at rest and 118px wide with a spinner shifts the layout
   every time somebody clicks it, which is a layout shift caused by a design
   decision (section 4). Reserve the indicator's space at rest and never swap the
   label for the indicator.
2. **Never `outline: none` without `:focus-visible`.** The audit already errors
   on this; the part worth knowing is why the two pseudo-classes differ. Browsers
   use heuristics to show a focus indicator only when it is likely to help, so a
   button clicked with a mouse usually shows no ring while a text field does.
   `:focus` always matches. `:focus-visible` matches when the user needs telling
   where focus is. The honest pattern is the one in `core.css`: style
   `:focus-visible`, and clear the UA ring only under `:focus:not(:focus-visible)`.
   `:focus-visible` is Baseline widely available since March 2022.
3. **The focus ring is a contrast requirement.** **1.4.11 Non-text Contrast (AA)**
   puts visual information needed to identify components and their states at 3:1
   against adjacent colours. A 1px hairline in `--stone-500` (3.17:1, rules and
   decoration only per `typography.md`) is borderline on bone and fails on
   anything lighter. **2.4.13 Focus Appearance (AAA)** gives the geometry of a
   good one: an area at least as large as a 2 CSS pixel thick perimeter of the
   component, and at least 3:1 between the focused and unfocused versions of
   those same pixels. Ship the AAA geometry even when you are only claiming AA.
   It costs one line.
4. **Disabled is the one state exempt from contrast, and that is the trap.**
   1.4.3 exempts text that is part of an inactive component and 1.4.11 exempts
   inactive components, so a dimmed disabled button conforms. It is still
   unreadable, and if you kept it focusable with `aria-disabled` you have made a
   focusable thing nobody can read. Keep disabled legible whether or not the
   criterion makes you.
5. **Prefer `aria-disabled` to `disabled` on anything a user will reach for.**
   `disabled` removes the control from the tab order, suppresses its events and
   stops its value submitting. `aria-disabled` announces "disabled" and changes
   nothing else, so you suppress the action yourself. Use it for a submit button
   whose action is temporarily unavailable, a non-collapsible accordion header, a
   temporarily inactive menu item. A submit button that vanishes from the tab
   order the moment the form is incomplete is the classic junior bug: the
   keyboard user tabs straight past it and never learns why nothing happened.
6. **Error fires on `:user-invalid`, never `:invalid`.** `:invalid` matches an
   empty required field at load, so the page opens covered in red before anyone
   has typed. `:user-invalid` matches only after interaction or an attempted
   submit. Baseline widely available since November 2023. `:user-valid` is the
   counterpart; use it sparingly, because a tick on every filled field is noise.
7. **Loading is a timing decision before it is a spinner decision.** Nielsen's
   three limits are the numbers to hold: 0.1s feels instantaneous and needs no
   feedback; 1.0s is the limit of uninterrupted flow and still needs no special
   feedback; 10s is the limit of attention, past which the user is owed a
   percent-done indicator and an estimate. So: under 100ms show nothing;
   100ms to 1s show the pressed state only; 1s to 10s show an honest indicator
   with the label intact; over 10s show progress and say what happens next. Set
   `aria-busy="true"` on the region while it updates and back to `false` when it
   settles, or assistive technology announces the half-built state.
8. **Announce a state change once, in one channel.** Either move focus or write
   to a live region. Never both, never neither. **4.1.3 Status Messages (AA)**
   covers the announce case and explicitly excludes anything that is a change of
   context, because a dialog that takes focus is already a change of context.
9. **Selected has three attributes and they are not interchangeable.**
   `aria-current` for the current item in a set (`page`, `step`, `location`,
   `date`, `time`, `true`, `false`); `aria-pressed` for a toggle button (`true`,
   `false`, `mixed`); `aria-selected` for tabs, options, rows and grid cells. Do
   not substitute `aria-current` for `aria-selected` in those roles. And do not
   change the label when the state changes: a button labelled "Pause" keeps
   saying "Pause" at `aria-pressed="true"`, so the screen reader says "Pause
   toggle button pressed". A control whose label flips between Play and Pause is
   a plain button with no `aria-pressed` at all.
10. **Dragging needs a click path.** **2.5.7 Dragging Movements (AA)**: all
    functionality that uses a dragging movement can be achieved by a single
    pointer without dragging, unless dragging is essential or is provided by the
    user agent and not modified by the author. Sliders need a clickable track,
    reorderable lists need move-up and move-down controls, a drag-scrolled rail
    needs arrow buttons.

### Hover is conditional

`@media (hover: hover)` is Baseline widely available since December 2018.
`hover: none` means the primary input cannot hover at all, or cannot conveniently
hover because the device emulates it with a long press. Anything that exists only
on hover does not exist on a phone and does not exist for a keyboard.

**Hover may only intensify something already visible.** That is the same
principle as content visible at rest in `tells.md`, applied to state instead of
to scroll.

### The loading button, written out

Goes in `site.css`. The indicator occupies its slot at rest, so nothing moves.

```html
<button class="btn" type="submit" aria-busy="false">
  <span>Send the brief</span>
  <span class="btn__ind" aria-hidden="true"></span>
</button>
<p class="form__status" role="status"></p>
```

```css
.btn { display: inline-grid; grid-auto-flow: column; align-items: center;
       gap: var(--s-2); }
.btn__ind { inline-size: 0.85em; aspect-ratio: 1; border-radius: 50%;
            border: 1px solid transparent; }
.btn[aria-busy="true"] { pointer-events: none; }
.btn[aria-busy="true"] .btn__ind {
  border-color: color-mix(in oklab, currentColor 35%, transparent);
  border-block-start-color: currentColor; }
@media (prefers-reduced-motion: no-preference) {
  .btn[aria-busy="true"] .btn__ind { animation: btn-turn 900ms linear infinite; }
}
@keyframes btn-turn { to { rotate: 1turn; } }
```

Under reduced motion the ring stops turning, so the ring is not carrying the
state on its own. The `role="status"` paragraph is what actually says "Sending"
and then "Sent". That is rule 8 and the reduce-rather-than-remove position in
`motion.md` meeting in one component.

### The error state, extending the house field

The form treatment in `sections.md` stays: boxless, one bottom hairline, the
uppercase UI label. Error adds a message and thickens the hairline, because a
colour change alone fails 1.4.1.

```html
<div class="field">
  <label for="email">Email</label>
  <input id="email" name="email" type="email" autocomplete="email" required
         aria-describedby="email-error" aria-invalid="true">
  <p class="field__error" id="email-error">
    <span class="visually-hidden">Error:</span>
    Enter an email address in the format name@example.com
  </p>
</div>
```

```css
/* site.css */
.field:has([aria-invalid="true"]) :is(input, textarea, select) {
  border-block-end-width: 2px; border-block-end-color: var(--state-error); }
.field__error { font-family: var(--font-ui); font-size: var(--step--2);
                color: var(--state-error); }
```

Two notes on `--state-error`. It is derived inside the house system rather than
pulled from a framework default, and it is measured against the ground it sits
on rather than assumed (see section 6, rule 6). It is not the accent: the accent
rule of one hue on at most three elements governs decoration, and a status colour
is functional and only present while its state is live.

The focus treatment on a boxless field is the hairline moving to `--accent`.
Thicken it as well. The colour move alone is the same 1.4.1 problem as the error
colour alone.

### When not to build the matrix

A static editorial page with three links and one form does not need selected,
indeterminate or dragging states, and inventing them is how a one-page site grows
a component library nobody will ever open (section 6).

The floor is four: rest, hover, focus-visible, active. Add disabled and error to
anything inside a form. Add loading to anything that talks to a server. Stop
there.

### What a junior ships and a senior rejects

- `transition: all` carrying every state at one duration.
- `outline: none` with a hover `box-shadow` as the only feedback.
- A red border as the whole error state, with the message in the console.
- A spinner that replaces the button label and resizes the button.
- `disabled` on the submit button as the validation strategy.
- A green tick or a red cross with no text next to it.
- `:invalid` styling, so the form is red before anyone types.
- `cursor: pointer` on a `<div>` with a click handler and no states at all.
- A caption, a price or a secondary action that only appears on hover.
- A toggle whose label and `aria-pressed` both flip, so the screen reader reads
  the opposite of the truth.

---

## 2. Accessibility past the checklist

`checklist.md` has the floor and `visual-debug.md` is honest that a clean
automated report proves nothing. This is the layer between them.

`awards.md` has the reason to care that is not compliance: accessibility is the
weakest scored dimension on most winners and the cheapest unclaimed score on the
platform. Nothing here is a trade against motion or against the look.

### WCAG 2.2, named correctly

These nine are new in 2.2 relative to 2.1. Verified against the Recommendation.

| SC | Title | Level |
|---|---|---|
| 2.4.11 | Focus Not Obscured (Minimum) | AA |
| 2.4.12 | Focus Not Obscured (Enhanced) | AAA |
| 2.4.13 | Focus Appearance | AAA |
| 2.5.7 | Dragging Movements | AA |
| 2.5.8 | Target Size (Minimum) | AA |
| 3.2.6 | Consistent Help | A |
| 3.3.7 | Redundant Entry | A |
| 3.3.8 | Accessible Authentication (Minimum) | AA |
| 3.3.9 | Accessible Authentication (Enhanced) | AAA |

**4.1.1 Parsing was removed in 2.2 and is marked obsolete.** Do not cite it.

The criteria this style of page hits constantly:

- **2.4.11 Focus Not Obscured (Minimum), AA.** "When a user interface component
  receives keyboard focus, the component is not entirely hidden due to
  author-created content." The named causes are sticky headers, sticky footers,
  non-modal dialogs, semi-transparent overlays, cookie banners, chatbots and
  expandable side navigation. A page with `.nav.is-stuck` has solved the anchor
  case with `:where([id]) { scroll-margin-top }` and has not solved the Tab case:
  tabbing back up the page scrolls the focused element under the sticky header.
  The fix is a different property on the scroll container:

  ```css
  /* site.css - scroll-margin-top handles anchors, this handles Tab */
  html { scroll-padding-top: calc(var(--nav-h, 4.5rem) + 1rem); }
  ```

- **2.5.8 Target Size (Minimum), AA.** 24 by 24 CSS pixels, with five exceptions:
  Spacing (a 24px-diameter circle centred on the undersized target must not
  intersect another target or another such circle), Equivalent, Inline (the
  target is in a sentence or its size is otherwise constrained by the
  line-height of non-target text), User Agent Control, Essential. The Inline
  wording is exactly the exemption `inspect.mjs` implements. Do not over-correct
  it: a link inside a sentence is exempt, a row of small footer links is not, and
  neither is a row of dots.
- **2.5.5 Target Size (Enhanced), AAA.** 44 by 44 CSS pixels, with the
  Equivalent, Inline, User Agent Control and Essential exceptions. Android's
  published guidance is 48dp, on the reasoning that a 48x48dp target is about
  9mm against a recommended 7 to 10mm. Design thumb-operated targets to 44-48.
  24 is the legal floor, not the target.
- **1.4.10 Reflow, AA.** No two-dimensional scrolling at 320 CSS pixels wide or
  256 CSS pixels tall. 320 CSS pixels is equivalent to a 1280px viewport at 400%
  zoom, which is why 320 is a zoom test rather than a phone test.
- **1.4.4 Resize Text, AA.** Text can be resized without assistive technology up
  to 200 percent without loss of content or functionality. Section 3 has the
  `clamp()` failure mode, which is the one this aesthetic produces.
- **1.4.12 Text Spacing, AA.** No loss of content or functionality when the user
  sets line height to 1.5 times the font size, space after paragraphs to 2 times,
  letter spacing to 0.12 times and word spacing to 0.16 times. Fixed-height cards
  and buttons with no wrap tolerance fail this and nothing automated will say so.
- **2.5.3 Label in Name, A.** For components with labels that include text, the
  accessible name contains the text presented visually. A button reading "Get the
  brief" with `aria-label="Contact"` fails it, and a voice-control user cannot
  activate it by saying what they can see.
- **3.2.2 On Input, A.** Changing the setting of a component does not
  automatically cause a change of context unless the user was told first. The
  named failures are a form that submits when a field receives a value, and a
  select, radio or checkbox that opens a window.

### Focus management: the two moments

**Opening a modal.** Native `<dialog>` with `showModal()` does most of the work:
it goes in the top layer, gets a `::backdrop`, makes the rest of the document
inert as if the `inert` attribute were set, is implicitly `aria-modal="true"`,
and closes on Esc. Baseline widely available since March 2022. What is still
yours:

1. `autofocus` on the right element, which is the element needing immediate
   interaction. If nothing does, put it on the close button or the dialog itself.
   Not the first input by reflex: autofocusing a text field on a phone raises the
   keyboard over the dialog you just opened.
2. Never put `tabindex` on the `<dialog>` element itself.
3. A name: `aria-labelledby` pointing at the dialog's own heading.
4. Restore focus yourself. Store the element that opened it and call `focus()` on
   close. UNVERIFIED: MDN's `dialog` page does not document automatic focus
   restoration to the invoker, so do not rely on it.
5. UNVERIFIED: the `closedby` attribute (`any`, `closerequest`, `none`) controls
   light dismiss. MDN documents it and gives `closerequest` as the `showModal()`
   default; its browser support was not confirmed, so treat it as an enhancement
   and let Esc be the guaranteed exit.

`inert` as a standalone attribute is Baseline widely available since April 2023.
It removes a subtree from click, focus, find-in-page, text selection and the
accessibility tree. The design consequence is in MDN's own warning: there is no
visual way to tell whether an element is inert. You have to dim or scrim it
yourself, which is why `::backdrop` is structural and not decoration.

**Changing route.** Not a concern for a static multi-page site, where a real
navigation resets focus for you. It is a concern the moment anything is
client-routed, and a one-page site with a JS view swap is client-routed whether
or not it has a router.

The measured answer comes from the Gatsby and Marcy Sutton user study (2019),
the only test of the alternatives with real screen reader, magnification and
voice users: focusing a heading was reported as the best experience because it
saved time and made clear what had happened. Resetting focus to the top of the
app was overwhelming. A live-region announcement on its own was weaker than
moving focus for voice-navigation users, who were following the visible focus
indicator. Their recommendation combines a skip link that takes focus on route
change with a live region naming the new page.

The mechanism is `tabindex="-1"` on the target plus `.focus()`. That is the
sanctioned use of `tabindex="-1"`: elements that should not be tabbed to but need
focus set programmatically. Never a `tabindex` above 0. `motion.md` has the
related case, which is that Lenis does not move focus on anchor links.

### Keyboard traps, and the thing that is not one

**2.1.2 No Keyboard Trap (A)**: if focus can get in, it must get out with the
keyboard alone, and if getting out needs more than unmodified arrow or Tab keys,
the user must be told how. A modal that contains focus is not a trap, because Esc
is a standard exit.

The real traps in this style of page are a scroll-jacked section that swallows
Tab, a third-party embed, a carousel that loops focus forever, and smooth-scroll
code that moves the scroll without moving focus. The general form: any JavaScript
that takes over a native interaction has to hand the keyboard back.

### Accessible name computation, in precedence order

From the ACCNAME specification. Cite it as a Working Draft, currently dated
27 August 2026, superseding the 1.1 Recommendation.

1. `aria-labelledby`, if it has at least one valid IDREF and is not already
   inside a labelling traversal.
2. `aria-label`, if non-empty.
3. Host-language labelling: `<label for>`, `alt`, `<caption>`, `<legend>`.
4. Name from content, where the role permits it.
5. Tooltip attributes such as `title`, used only when nothing else, including
   subtree content, produced a result.

Two consequences. First, `aria-label` silently beats the visible text, which is
how 2.5.3 gets failed by somebody trying to be helpful. Second, some roles are
`nameFrom: prohibited`, where authors must not use `aria-label` or
`aria-labelledby` at all. That covers generic containers and paragraphs, so
labelling a `<div>` or a `<span>` does nothing and hides the problem from you.

For the icon-only controls this style produces constantly (a close button, a
scroll cue, the `.sky__dot` set): `aria-hidden="true"` on the SVG, the name on
the button. `title` is the last resort and is not exposed on touch.

### Live regions, and when they are noise

`aria-live` takes `off` (the default), `polite` (announced at the next graceful
opportunity) and `assertive` (highest priority, announced immediately). MDN's
warning is the design rule: an interruption may disorient users or stop them
finishing the task, so do not use `assertive` unless the interruption is
imperative. `role="status"` carries implicit `aria-live="polite"` and implicit
`aria-atomic="true"`; `role="alert"` is the assertive counterpart; `role="log"`
exists for append-only streams.

1. **The region must be in the DOM before the message.** Screen readers buffer at
   load, and a region injected together with its content may never announce. Ship
   an empty `<p role="status"></p>` and write into it.
2. **One region per purpose, reused.** Three stacked regions announce three
   times.
3. **Never a live region and a focus move for the same event.** If a situation
   requires moving focus, a live region is the wrong tool for it.
4. **`aria-busy="true"` while a multi-part update is in flight**, `false` when it
   settles, or the region announces each fragment as it lands.

Things that should not be live regions: a filter count updating per keystroke, a
scroll-progress value, a carousel position, anything that changes more than once
a second. If it changes continuously it is decoration. Mark it `aria-hidden` and
expose the resting value somewhere else.

### Motion sensitivity beyond the media query

`prefers-reduced-motion` is Baseline widely available since January 2020, and the
guidance is to reduce or replace rather than remove: MDN's own example swaps a
scaling pulse for an opacity dissolve. That is the position `motion.md` already
holds. What is missing there:

- **2.3.3 Animation from Interactions (AAA)**: motion animation triggered by
  interaction can be disabled, unless the animation is essential to the
  functionality or the information being conveyed. The Understanding document
  uses parallax scrolling as its example of non-essential animation and
  recommends avoiding it or providing a control to disable it. For a house style
  whose signature is a five-plane parallax hero, the honest reading is that the
  OS preference covers the users who have set it and an in-page motion toggle
  covers the users who have not. The section library does not have that control
  yet. If you build one, it is a `aria-pressed` toggle writing a class on `<html>`
  that the motion rules also key off, and it persists.
- **2.2.2 Pause, Stop, Hide (A)** covers automatically starting motion, which is
  a different scope: the `.marquee`, an autoplaying video, a looping background.
- The severity is worth keeping in mind because it is not a preference: nausea,
  migraine, and needing extended rest afterwards.
- `prefers-reduced-transparency` is **Baseline limited**: Chrome and Edge 119
  (October 2023), not in Firefox or Safari. It cannot be the mechanism that makes
  a glass surface safe. The glass rules in `sections.md` still have to hold on
  their own.
- `forced-colors` is Baseline widely available (Safari 16, September 2022).
  `core.css` has a `forced-colors: active` branch for the focus ring. The thing
  to check is that your *state* information survives it, because every author
  colour is discarded and only system colours remain. `GrayText` is the
  forced-colors expression of disabled.

### What automated checkers cannot see

Deque publishes a coverage figure of **57.38% of total issues identified by their
automated tests**, from a sample they describe as 13,000-plus pages and page
states and nearly 300,000 issues. That is counted by issue volume, not by success
criteria covered, and it is a vendor number about a vendor tool. They list
criteria with zero automated coverage, including 2.4.3 Focus Order, 2.4.7 Focus
Visible, 1.4.11 Non-text Contrast and 1.3.2 Meaningful Sequence. Treat it as an
order of magnitude.

The WebAIM Million (February 2026) found detected WCAG 2 failures on 95.9% of
home pages, averaging 56.1 errors per page, up 10.1% from 51 the year before. The
distribution is almost entirely design decisions: low contrast text 83.9%,
missing alternative text 53.1%, missing form input labels 51%, empty links 46.3%,
empty buttons 30.6%, missing document language 13.5%. WebAIM's own caveat is the
one that matters: absence of detected errors does not indicate that a page is
accessible or conformant. That page is republished annually, so re-check the
figures before quoting them.

The manual pass, for a page built in this style. None of these are mechanisable
and `inspect.mjs` does not claim them:

1. Tab the whole page and write the order down. Does it match the visual order
   after the grid has reordered anything?
2. Tab *upward* with the sticky header present (2.4.11).
3. Open every dialog from the keyboard, Esc out, confirm focus came back to what
   opened it.
4. Read every accessible name out loud. Does it contain the visible label
   (2.5.3)?
5. Turn CSS off. Is the reading order still the content order?
6. Zoom to 200% and 400%, and check 320px (1.4.4, 1.4.10).
7. Apply the four text-spacing values (1.4.12) and look for clipping.
8. Set reduced motion at the OS and reload. Not toggled in devtools, which misses
   anything read once at init.
9. Turn on Windows high contrast and check that states survive.
10. Unplug the mouse and do the primary task.

### When not to do all of this

Every item above is scoped to what the page actually contains. A page with no
dialog needs no focus restoration, a page with no client routing needs no route
announcement, a page with no drag needs no click path. What is never optional:
the focus ring, the tab order, the names, the labels, reflow at 320, and reduced
motion.

### What a junior ships and a senior rejects

- `scroll-margin-top` on anchors with no `scroll-padding-top`, so tabbing
  backwards hides the focused element under the nav.
- A custom modal built from a `<div>` with `role="dialog"` and no inert
  background, when `<dialog>` plus `showModal()` was three lines.
- `aria-label` on a button that already has visible text, with different words in
  it.
- `aria-label` on a `<div>` or a `<span>`, which does nothing.
- An icon SVG with no `aria-hidden` sitting inside a button with no name.
- A live region injected into the DOM at the same moment as its message.
- `role="alert"` on a routine confirmation.
- A toast that appears, announces assertively and steals focus.
- A parallax hero with no reduced-motion branch and no in-page control.
- An accessibility claim made on the strength of a clean automated report.

---

## 3. Responsive strategy

### Container queries against media queries

Container queries are Baseline widely available, low date 2023-02-14 (Firefox
110), high date 2025-08-14. Chrome and Edge 105, Safari 16, Firefox 110. There is
no support argument left.

| Media query | Container query |
|---|---|
| Page composition: grid column count, nav to mobile nav, section padding | Any component that appears at more than one column width |
| Anything keyed to the viewport itself: a `100svh` hero, sticky offsets | A card that sits in both a 12-column band and a narrow rail |
| `print`, `prefers-*`, `forced-colors` | A figure switching from stacked to side by side on its own width |
| The one breakpoint the whole page turns on | Anything reused on a page you have not designed yet |

The mechanical rule people trip on: **a container cannot query itself.** The
query conditions styles on the container's descendants, so the element carrying
`container-type` is never the element the query styles. Every container query
needs a wrapper.

```css
/* site.css */
.card-wrap { container-type: inline-size; container-name: card; }
@container card (inline-size > 30rem) {
  .card { grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); }
}
```

`container-type` takes `normal` (the default, not a size container),
`inline-size` and `size`. UNVERIFIED: the exact containment list differs between
CSS Conditional 5 and MDN, so do not quote one as settled. The practical
consequences are what matter. The element gets its own formatting context, and
`size` additionally contains the block size, which means the element can no
longer be sized by its content. That is why `size` breaks layouts and
`inline-size` does not. Use `inline-size`.

Container query units are `cqw`, `cqh`, `cqi`, `cqb`, `cqmin`, `cqmax`. With no
eligible container the unit falls back to the small viewport unit for that axis,
so a `cqi`-sized heading silently becomes viewport-sized the day somebody deletes
the wrapper. Style queries (`@container style(--cards: small)`) exist and query
computed custom property values; they are the newer half of the feature, so check
support separately before shipping one.

Where this applies in the chassis: `.card`, `.cards--rail` cards, `.stat` and
`.callout` all appear at more than one width. The 12-column to 4-column collapse
at 48rem in `core.css` is a page-level decision and correctly a media query. The
component-level decision is a container query and it belongs in `site.css`.

### Fluid type and the zoom trap

This is the most common accessibility defect in this aesthetic, because the
aesthetic is built on `clamp()`.

The mechanism: browser zoom shrinks the layout viewport measured in CSS pixels
while enlarging each CSS pixel, so a `vw` term *falls* as the user zooms and
cancels the zoom. W3C publishes this as a named failure, **F94, Failure of
Success Criterion 1.4.4 due to incorrect use of viewport units to resize text**,
whose entire content is that viewport units on `font-size` mean attempts to zoom
or adjust text size will not work. Roselli's measurements put numbers on it: with
`font-size: clamp(1.5rem, 5vw, 3rem)` in a 1024px window, 200% zoom produced a
6.25% increase and 300% zoom reached about 150% of the original, never the
required 200%.

1. Every fluid expression keeps a `rem` term that survives to the maximum:
   `clamp(<rem min>, <rem base> + <vw slope>, <rem max>)`. A bare `vw` middle term
   is the failure. The scale in `core.css` is built this way; anything you add in
   `site.css` must be too.
2. The spread has to leave room for 200%. `typography.md` states the constraint as
   max no more than 2.5 times min. That is the number; do not restate it with a
   different one.
3. Never set a root `font-size` in `px`, `vw` or a percentage below 100%. Root at
   `100%`, relative units below it, nothing under `1rem` as a base.
4. Test by zooming, not by resizing the window. They are different operations and
   only one of them is what a low-vision user does.
5. Never `user-scalable=no` and never a restrictive `maximum-scale`. The
   recommended viewport content is `width=device-width`; Safari on iOS 10 and
   later ignores both restrictions anyway, and the intent still fails 1.4.4.
   `interactive-widget=resizes-content` exists for the virtual-keyboard case.

UNVERIFIED: the widely repeated claim that iOS Safari auto-zooms a focused input
whose `font-size` is under 16px has no primary Apple or WebKit documentation that
I could find. It is documented only in secondary sources. If you size inputs at
16px for this reason, know that you are acting on observed behaviour, not a
vendor statement.

### The widths that matter

Emulation profiles from Puppeteer's device descriptors: iPhone SE 320x568, Galaxy
S8 360x740, iPhone 12 and 13 390x844, Pixel 5 393x851, iPhone 14 Pro Max and 15
Pro Max 430x739. UNVERIFIED as device specifications: these are emulation
viewports and the heights include browser chrome. The widths are the usable part.

The test set is **320 / 360 / 390 / 430**, and 320 is in it because of 1.4.10
Reflow, not because anyone is holding an iPhone SE 1.

What breaks in that band, in the order it breaks:

1. **Uppercase tracked labels.** House tracking on an 11px label is the first
   thing to wrap badly. An eyebrow that fits at 390 breaks to two lines at 320.
2. **Display type carrying too much `vw`.** Fine at 430, clipped at 320, and the
   same term that clips here is the term that fails zoom above.
3. **Dot leaders.** `.index` rows collapse when the title plus the number exceed
   the row. The `min-width: 2ch` on the numeral is what keeps the right edge
   honest.
4. **Tables.** `.spec` at 320 needs its own `overflow-x: auto` wrapper. That is
   the one place a page in this style is allowed to scroll horizontally.
5. **Long unbroken strings.** A URL, an email, a product code. `minmax(0, 1fr)`
   is already the house rule; add `overflow-wrap: anywhere` on prose containers.
6. **Fixed-height heroes.** `100vh` leaves content under the iOS URL bar. `100svh`
   is already the house answer.
7. **Targets at the viewport edge.** A 24px target 4px from the edge is reachable
   on paper and not in the hand.
8. **The nav.** `core.css` sets `.nav__links { display: none }` under 46rem with
   no replacement, so every page built from the library currently has no
   navigation on a phone. That is the largest responsive gap in the chassis and
   it sits inside this band.

### The missing mobile nav

Until the chassis ships one, this goes in `site.css` and the page. A disclosure
button and the same list, not a second navigation.

```html
<button class="nav__toggle" type="button" aria-expanded="false"
        aria-controls="nav-menu">Menu</button>
<ul class="nav__links" id="nav-menu">...</ul>
```

```css
/* site.css - replaces the display:none under 46rem */
.nav__toggle { display: none; }
@media (max-width: 46rem) {
  .nav__toggle { display: inline-flex; min-block-size: 44px; align-items: center; }
  .nav__links { display: none; }
  .nav__toggle[aria-expanded="true"] + .nav__links {
    display: grid; gap: var(--s-3);
    position: absolute; inset-inline: 0; inset-block-start: 100%;
    padding: var(--s-5) var(--gutter); background: var(--bg); }
}
```

The four things that make it correct rather than present: the button's
`aria-expanded` is the state (do not also change its label), Esc closes it and
returns focus to the button, the open panel must not cover the focused link
(2.4.11), and every link inside it clears 44px including its spacing. Toggle the
attribute in JS and let CSS read it; do not maintain a parallel class.

### Thumb zones, honestly

The measured study (UXmatters, Steven Hoober, February 2013; 1,333 people
observed, 780 actively touching the screen): one-handed 49%, cradled 36%,
two-handed 15%. Of the one-handed, right thumb 67% and left thumb 33%. Of those
cradling, thumb 72% and finger 28%.

The finding that matters more than the percentages is that people switched grip
constantly, sometimes every few seconds, depending on the task. So "put the CTA
in the thumb arc" is a weak rule and "do not put a destructive action where a
thumb rests" is a strong one. Primary actions belong in the lower two thirds on a
phone; a bottom-anchored bar clears the home indicator and is never the only
route to anything; anything a resting thumb can graze needs either a confirmation
(section 5) or enough space around it.

### Target sizing, put together

| Standard | Size | Status |
|---|---|---|
| WCAG 2.5.8 (AA) | 24x24 CSS px, with the spacing, inline, equivalent, UA and essential exceptions | the legal floor |
| WCAG 2.5.5 (AAA) | 44x44 CSS px | the design target |
| Android guidance | 48x48 dp, about 9mm | the design target on touch |

UNVERIFIED: the commonly cited Apple 44x44 point minimum. Apple's layout page did
not return usable content, so do not attribute that figure to Apple. WCAG 2.5.5
and Android's 48dp are both verified and say the same thing.

### Mobile first is a build order

It is a source-order and cascade decision: write the single-column case as the
unconditional rule and add complexity in min-width queries, and you never un-set
anything. Worth doing.

It is not a design philosophy, and treating it as one produces the centred
single-column page `tells.md` already names. An asymmetric editorial composition
is authored at the wide width because there is no asymmetry to express at 360px.
Design the wide composition, build the narrow one first, and make sure the narrow
one is a deliberate layout rather than the wide one with its columns dropped.

### What a junior ships and a senior rejects

- `font-size: clamp(1.5rem, 5vw, 3rem)`, with no `rem` term in the middle.
- A container query written on the element it is meant to style.
- `container-type: size` where `inline-size` was meant, and a collapsed layout.
- A page tested by dragging the window narrow and never by zooming to 200%.
- `user-scalable=no` in the viewport meta.
- A phone build with no navigation, because the desktop list was set to
  `display: none`.
- A hamburger that toggles a class with no `aria-expanded` and no Esc.
- `100vh` on the hero.
- A spec table that forces the whole page to scroll sideways at 320px.
- Footer links at 14px with 6px between them, defended as an inline exemption.

---

## 4. Performance as a design constraint

### Core Web Vitals as they stand

Verified on web.dev. Three metrics, all assessed at the **75th percentile** of
page loads, segmented across mobile and desktop.

| Metric | Good | Needs improvement | Poor |
|---|---|---|---|
| LCP | 2.5s or less | 2.5-4.0s | over 4.0s |
| INP | 200ms or less | 200-500ms | over 500ms |
| CLS | 0.1 or less | 0.1-0.25 | over 0.25 |

The "good" thresholds and the 75th percentile rule are stated on
web.dev/articles/vitals; the LCP band boundaries are confirmed on
web.dev/articles/lcp.

INP replaced FID and became a stable Core Web Vital in 2024. Do not write FID
anywhere. TTFB, FCP and TBT are diagnostic rather than core (TBT is the lab proxy
for INP).

INP counts clicks, taps and key presses only, not scrolling, hovering or zooming,
and splits into input delay, processing duration and presentation delay. On a
page in this style the interaction that blows it is almost always a scroll-linked
handler doing layout reads, or a click that mutates a large part of the DOM.
`motion.md` has the read-then-write rule and the passive-listener rule.
UNVERIFIED: the commonly repeated "ignores the worst one per 50 interactions"
rule. web.dev says only that the value is the longest interaction observed,
sometimes ignoring outliers.

### LCP is a design decision first

The subpart budget web.dev publishes, as percentages of total LCP: time to first
byte about 40%, resource load delay under 10%, resource load duration about 40%,
element render delay under 10%. Two of those four are the designer's.

Three statements from web.dev that decide the hero:

- Never lazy-load the LCP image. It always adds resource load delay.
- Set `fetchpriority="high"` on an `<img>` you believe will be the LCP element.
- It is critical that the resource is discoverable in the initial HTML document
  response by the browser's preload scanner.

That last one is why a CSS `background-image` hero, a JS-injected hero, or a hero
that lives inside a WebGL canvas costs LCP by construction. `.hero__media` as a
real `<img>` with `fetchpriority="high"`, no `loading="lazy"` and explicit
dimensions is the fast version of the same picture.

A hero whose LCP element is *text* is faster still, which is a performance
argument for the layered-SVG and gradient heroes in `imagery.md` and for the
`hero-gradient` and `hero-depth` blocks in the section library. Choosing between
`hero-photo` and `hero-gradient` is choosing your LCP element.

### CLS is almost entirely design

The named causes are images or videos with unknown dimensions, fonts that render
at a different size from the fallback, and third-party content that resizes
itself. Scoring is impact fraction times distance fraction, summed inside a
session window of shifts less than 1 second apart and at most 5 seconds long.

The fixes, in web.dev's terms: always set `width` and `height` on images and
video, or reserve the space with `aspect-ratio`; reserve space for late-loading
content in the initial layout; avoid inserting new content without a user
interaction; minimise the size difference between the fallback and the web font
using `size-adjust`, `ascent-override`, `descent-override` and
`line-gap-override`. The back-forward cache restores pages without re-shifting.

The audit already errors on `<img>` without dimensions. What no tool will see:

- A button that resizes when it enters its loading state (section 1, rule 1).
- A nav that gains height and a shadow on `.is-stuck`.
- An accordion animating `height` from 0.
- A cookie banner arriving late and pushing the hero down.
- A `.stat` numeral that changes width because the figures are not tabular.

### Fonts: the one table

| `font-display` | Block period | Swap period | Use for |
|---|---|---|---|
| `block` | 2-3s | infinite | never on body text |
| `swap` | 0ms | infinite | the display face, where a flash is acceptable |
| `fallback` | 100ms | 3s | body text |
| `optional` | 100ms | none | body text when CLS matters more than the face |

UNVERIFIED as normative: the CSS specification describes these periods
qualitatively ("short", "extremely small"), and Firefox exposes them as
preferences. The numbers above are UA behaviour as published on
web.dev/articles/font-best-practices.

`optional` is web.dev's recommendation where re-layout is the priority. Price the
trade honestly: it can mean a returning visitor sees the serif and a first-time
visitor does not, which on a page whose identity is the serif is a real cost. The
metric-matched fallback with `size-adjust` in `core.css` is what makes `swap` or
`fallback` survivable; `typography.md` says to regenerate that `size-adjust`
value rather than guess it, and that is the line between `swap` being fine and
`swap` being a visible reflow.

On preload, web.dev is more cautious than the folklore: it bypasses some of the
browser's content negotiation, should be used prudently, and should cover only a
single font format. Preload the one face that draws the first screen. Never the
family.

### Budgets

web.dev's published starting numbers are under 5 seconds Time to Interactive and
under 170 KB of critical-path resources, compressed and minified, against
baseline devices and 3G. UNVERIFIED as current metrics: those figures trace to
2017-era research and TTI is no longer a Core Web Vital. Use them as an order of
magnitude for the critical path. The durable part of that article is the method:
benchmark against the competitor set, hold the number, and when something new
arrives either optimise an existing asset, remove an existing asset, or do not
add the new one.

A defensible per-page budget for a site in this style, stated as design limits:

| Item | Limit | Why it is a design decision |
|---|---|---|
| Hero image | one, about 200 KB at 1600w AVIF | it is the LCP element |
| Type families | 2 | each family is a network round trip |
| Font files | 4 or fewer, one variable per family plus italic | `font-variation-settings` replaces static weights |
| Photographic moments | 1 per page, already the house rule | every extra one is another decode |
| Libraries | GSAP or Lenis or three.js, priced in `stack.md` | three.js is not a hero background |
| Scroll handlers doing layout reads | 0 | this is the INP failure mode |

### The seven the designer owns

An engineer can fix everything else later. These are decided in the layout and
cannot be recovered without redesigning:

1. Whether the LCP element is text or an image.
2. Whether the hero is discoverable in the HTML or constructed by script.
3. How many families, weights and optical sizes exist at all.
4. Whether every image has an intrinsic aspect ratio in the design. An image
   whose ratio is "whatever it is" cannot have its space reserved.
5. Whether late content (banner, embed, third-party block) has a reserved slot in
   the composition.
6. Whether any state change resizes its own element.
7. Whether the motion budget fits inside transform and opacity.

### When not to optimise

A single-page site with one photograph, two fonts and no framework is already
inside every budget above. Do not add a build step, a critical-CSS extractor or
an image pipeline to a page that ships four files. The work here is the seven
decisions, not the tooling.

### What a junior ships and a senior rejects

- A hero as a CSS `background-image`, so the preload scanner cannot find it.
- `loading="lazy"` on the hero image.
- Six font files for two families, because each weight was requested separately.
- A `<canvas>` hero with the headline drawn inside it.
- A stat row whose numbers are not tabular, shifting on every increment.
- A scroll handler reading `offsetTop` on every frame.
- `font-display: block` on body text.
- A cookie banner injected at the top of `<body>` with no reserved height.
- FID quoted anywhere.
- A performance claim made from a local `file://` load.

---

## 5. Content design

The plugin already says copy is design material and that nothing may be invented.
What it does not have is the microcopy layer: the words inside controls, which
are the only words most users read.

### Button labels

GOV.UK's rule, from service-wide testing rather than preference: write button
text in sentence case, describing the action it performs. Their published set is
worth having as a register: "Start now", "Sign in", "Continue" (when data is not
saved), "Save and continue" (when it is), "Save and come back later", "Add
another", "Pay", "Confirm and send", "Accept and send", "Sign out". Add words
when the object is ambiguous: "Add another address".

1. Verb plus object, in the user's words rather than the system's. "Send the
   brief", not "Submit".
2. The label answers "what happens when I press this", including where it goes.
   "Continue" is fine only when the next step is already obvious.
3. The visible label is contained in the accessible name (2.5.3). If the button
   says "Get the brief", the name cannot be "Contact".
4. Never "Click here", "Learn more" or "Read more" as the whole label. Four of
   them on a page gives a screen reader four identical links.
5. Do not change a toggle's label when its state changes if you are using
   `aria-pressed`. Change the state, keep the word.
6. One primary action per view. A second `.btn` of equal weight means the page
   has not decided.

### Error messages

GOV.UK: describe what has happened and tell them how to fix it, in plain English,
using positive language, getting to the point. Avoid technical jargon ("form post
error", "unspecified error", error codes) and the words "forbidden", "illegal",
"you forgot", "prohibited". Avoid "please", because it implies a choice. Avoid
"sorry", because it does not help fix the problem. Avoid informal or humorous
language such as "oops".

Their examples are the model, and note that each begins with the verb the user
must perform:

- "Enter a National Insurance number in the correct format"
- "The date your passport was issued must be in the past"
- "Select if you are British, Irish or a citizen of a different country"

Nielsen Norman's guidelines add placement and recovery: put the message close to
its source; use noticeable, redundant and accessible indicators; design the
treatment according to the error's impact; do not display errors prematurely; use
human-readable language; describe the issue concisely and precisely; offer
constructive advice; take a positive tone and do not blame the user; safeguard
against likely mistakes; preserve what the user typed; reduce the effort of
correcting.

The markup is in section 1. The visually hidden "Error:" prefix is there so a
screen reader user hears "Error: the date your passport was issued must be in the
past" rather than the sentence alone. The message sits after the label and hint
and before the control.

WCAG's own floor is much lower than any of this. **3.3.3 Error Suggestion (AA)**
only requires that when an input error is automatically detected and suggestions
for correction are known, the suggestions are provided, unless that would
jeopardise the security or purpose of the content. Meeting 3.3.3 is not the same
as writing a usable error.

### Empty states

An empty state communicates system status, helps users discover unused features
and provides a direct path to getting started. NN/g's warning is blunt: do not
default to totally empty states, because that creates confusion.

Three parts, in this order: what this area is, why it is empty right now, and one
control that fills it. A search result with nothing in it is an empty state and
needs the same three parts plus the query echoed back.

On a marketing site the empty states are: no search results, a filter that
excludes everything, the form's success view, and the 404 page. All four usually
ship as a centred grey sentence, which is the templated tell in another costume.
Each of them is a composition with a heading, a line of prose and one action, set
in the same type as the rest of the page.

### Confirmations

GOV.UK on warning buttons: use them only for actions with serious destructive
consequences that cannot easily be undone, and implement a two-step confirmation
(a standard button, then a warning button to confirm), because colour alone is
insufficient and the text has to carry the consequence.

1. Confirm only what cannot be undone. A confirmation on a reversible action
   teaches people to dismiss confirmations.
2. The heading names the object: "Delete the 2024 archive?", not "Are you sure?"
3. The confirming button repeats the verb: "Delete archive", never "OK" or "Yes".
4. State the consequence in one sentence, including what is *not* affected.
5. Never autofocus the destructive button (section 2, focus management).
6. Undo beats confirm wherever undo is possible.

### The honesty rule, applied to small print

Microcopy is where invented specifics get onto a page most easily, because they
read as reassurance rather than as claims. "Usually replies within 2 hours."
"Trusted by teams at..." "Cancel anytime." "No spam, ever." "Your data is
encrypted." Every one of those is a factual claim about a real business.

If it has not been confirmed by the business, the element is cut. That is the
same rule `tells.md` applies to statistics and the audit enforces on placeholder
residue, applied to the fine print where nobody thinks to look.

The version that is always safe describes the mechanism instead of promising an
outcome: "This goes to one inbox, read by one person."

### When not to write any of this

A page with one form, one button and no application state needs the button label,
the error messages and the privacy line. It does not need an empty state, a
confirmation pattern or a toast. Writing the ones you do not have is how a
brochure site acquires a design system it will never use (section 6).

### What a junior ships and a senior rejects

- "Submit" on a form that sends a project brief.
- "Learn more" four times on one page.
- "Oops! Something went wrong." with the real error in the console.
- A red field border as the entire error, with no sentence.
- Validation firing on the first keystroke of the first field.
- A form that clears the user's input on a failed submit.
- "No results found." centred in grey, with no way back.
- "Are you sure?" with OK and Cancel.
- A destructive action as the autofocused button in the dialog.
- "Trusted by 10,000+ teams", "Usually replies in 2 hours", or any other number
  the business never gave you.

---

## 6. Tokens and systems thinking

### The three layers

| Layer | What it is | Named for | Example |
|---|---|---|---|
| Primitive | the raw ramp | the value | `--bone-100`, `--ink-800` |
| Semantic | the role | the job | `--bg`, `--fg-muted`, `--rule` |
| Component | one component's use of a role, including state | component, property, state | `--btn-bg-hover` |

`core.css` ships the first two layers complete, with the semantic set re-declared
under `[data-tone="dark"]`. It ships almost none of the third, which is right for
a one-page site, and is the reason there is no disabled, error or loading token
anywhere (section 1).

Primer's published token names are a usable model for the third layer's shape,
because they encode component, property and state in a fixed order:
`--fgColor-accent`, `--bgColor-accent-emphasis`, `--borderColor-neutral-muted`,
and for components `--button-primary-bgColor-rest`,
`--button-danger-bgColor-hover`, `--button-danger-bgColor-disabled`. The part
worth taking is not the casing. It is that **rest is a named state**. A token set
with `-hover` and `-active` but no `-rest` always ends up with the rest value
hard-coded somewhere else in the file.

UNVERIFIED: the widely circulated namespace/object/base/modifier/state taxonomy.
The EightShapes article returned 403 and the Spectrum and Carbon pages returned
no usable content, so Primer is the only token-layering evidence cited here.

### The interchange format, if it ever matters

The W3C Community Group format (Design Tokens Format Module) is a Draft Community
Group Report carrying the warning that it is a preview of in-progress changes,
should not be referred to directly, and should not be implemented. Tokens are
objects with `$value` (required), `$type`, `$description`, `$extensions` and
`$deprecated`; references use `{group.token}` or a JSON Pointer `$ref`; names must
not begin with `$` and must not contain `{`, `}` or `.`; and groups are
organisational only, with tools instructed not to infer type or purpose from
them.

It does not define a primitive/semantic distinction. That taxonomy is convention,
not specification. Present it as such.

### Naming rules

1. Semantic names describe the role, never the appearance. `--rule`, not
   `--warm-grey-line`. `tells.md` already holds this position; the extension is
   that **state belongs in the name too**.
2. Keep one part order: component, property, variant, state.
3. Every interactive token family declares `-rest` explicitly.
4. Never encode the value. `--space-4` survives a redesign; `--space-16px` does
   not.
5. Never a scale per component. One spacing scale, one radius scale, one duration
   scale, page-wide.
6. **A status colour is not an accent.** The accent rule (one hue, at most three
   elements, drawn from the photograph) governs decoration. Error and success are
   functional and appear only while their state is live. They are still derived
   inside the system rather than pulled from a framework default, they are still
   measured against the ground they sit on, and they still cannot carry the state
   alone (1.4.1). The neutral rule is untouched: neutrals stay in hue 60-95 with
   chroma at least 0.008.
7. Project tokens go in `site.css`. `core.css` is never edited inside a project.

### When a system is premature

A token exists so that one change propagates correctly. With exactly one use, a
token is an indirection that hides the value from the next person reading the
CSS. The test, in order:

1. Does this value appear in more than one place? If not, write the value.
2. If it changed, would every one of those places have to change at once? If not,
   they are different values that happen to coincide. Do not merge them.
3. Does it vary by theme, tone or state? If yes, it is semantic and it needs a
   name.

Over-systematised, on a one-page site: a token file longer than the stylesheet;
tokens with a single consumer; a component layer for components that appear once;
`--space-1` through `--space-12` with five in use; a naming scheme that has to be
documented before anyone can change a colour.

Under-systematised: the same off-black at four slightly different values; three
radii that were meant to be one; `0.3s`, `300ms` and `0.25s` in the same file; a
dark section that restates its colours instead of flipping the semantic set with
`[data-tone="dark"]`.

### Staying consistent on one page without building a system

Six things drift, and all six already exist in `core.css`: ground, ink, rule,
accent, the radius tier, and the motion durations. So the rule for a one-page
build is not "build a system". It is: **use the six that ship, add nothing to the
primitive layer, and give every project-specific value a semantic name in
`site.css`.**

Consistency is then checkable by reading `site.css` for literals. A hex code, a
raw `px` radius or a bare duration in that file is either a deliberate one-off,
which should carry a comment saying so, or it is drift.

### What a junior ships and a senior rejects

- `--purple-500` used directly in a component rule.
- A component token layer on a page with one button.
- `--space-16px`, or `--gap-medium` next to `--gap-md`.
- `-hover` and `-active` tokens with the rest value hard-coded in the ruleset.
- An error colour copied out of a framework palette, in a hue the page does not
  otherwise contain.
- A second accent, because a section "needed" one.
- Edits to `core.css` inside a project.
- A dark section that re-states every colour instead of setting
  `data-tone="dark"`.
- `0.3s` in one rule and `var(--dur-2)` in the next.
- A tokens document written before the second page exists.

---

## Sources

Verified by fetching, on the date of writing:

- WCAG 2.2 Recommendation and the Understanding documents for 1.4.1, 1.4.3,
  1.4.4, 1.4.10, 1.4.11, 1.4.12, 2.1.2, 2.2.2, 2.3.3, 2.4.11, 2.4.13, 2.5.3,
  2.5.5, 2.5.7, 2.5.8, 3.2.2, 3.3.3, 4.1.3, and Technique failure F94.
- ACCNAME (Working Draft, 27 August 2026).
- CSS Conditional Rules 5 for container queries.
- web.dev: vitals, inp, optimize-inp, lcp, optimize-lcp, cls, optimize-cls,
  font-best-practices, performance-budgets-101.
- MDN: `:focus-visible`, `:user-invalid`, `prefers-reduced-motion`, `hover`,
  `font-display`, `aria-disabled`, `aria-live`, `aria-busy`, `aria-pressed`,
  `aria-current`, `status` role, `inert`, `tabindex`, `dialog`, `showModal()`,
  container queries, the viewport meta element.
- Baseline status via the Web Platform Status API for container queries,
  `forced-colors` and `prefers-reduced-transparency`.
- Design Tokens Format Module (Draft Community Group Report); Primer colour
  primitives.
- GOV.UK Design System: button, error message.
- Nielsen Norman Group: error message guidelines, empty state interface design,
  response times.
- Gatsby and Marcy Sutton accessible client routing user testing (2019).
- WebAIM Million; Deque automated accessibility testing coverage.
- Adrian Roselli, responsive type and zoom.
- Android accessibility guidance on touch target size.
- UXmatters, how do users really hold mobile devices (2013).
- Puppeteer device descriptors.

Everything marked UNVERIFIED above could not be confirmed from a primary source
and must not be restated as fact.
