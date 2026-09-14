# Skill packs on the bench

Third-party skills the user may have installed through the open skills
ecosystem (`npx skills add <owner/repo>`, the `skills` CLI by Vercel Labs,
v1.5.26 at the time of writing). None of them ship inside this plugin. When one
is installed it is treated the way `frontend-design` is treated in
`plugins.md`: it owns its domain, this plugin defers inside that domain, and
the seam is silent. When it is not installed, this plugin's own references
stand in and the model never interrupts a build to say "go and install X".

`webdesign.mjs tools` reports which of these are present. The CLI installs to
`./.claude/skills/<name>` (project) or `~/.claude/skills/<name>` (global), as
symlinks to a canonical copy by default; `.agents/skills/` is the
agent-neutral location the same tool also writes. All three are checked.

Everything below was read from the packs' own files on 2026-09-14. Install
counts are from `npx skills find` the same day and will have moved.

## emilkowalski/skills - MIT, 11 skills

Emil Kowalski's design-engineering practice, codified. The relevant ones for a
website build, in the order a build meets them:

| Skill | What it owns when installed | This plugin's own fallback |
|---|---|---|
| `animate` | Any **UI component** animation: button press, dropdown, tooltip, modal, drawer, toast, accordion, tab indicator, hold-to-confirm, drag-to-dismiss. It carries a decision gate ("should this animate at all") and a RECIPES.md of built implementations. Start from its recipe, not from a blank file. | `references/motion.md` for page choreography; `references/ui.md` for the component's states |
| `review-animations` | The **verdict** on motion code, against STANDARDS.md. Run it before `webdesign.mjs verify` on any page with component motion; it catches what a render check cannot see, like `ease-in` on an entrance. | `references/checklist.md`, then your own eyes at 2-5x duration |
| `find-animation-opportunities` | Where a page **should** move and does not - and, more usefully, where it should not and does. Use it once, after the copy is written and before choreography. | Rule 8 in SKILL.md: motion earns its place |
| `animation-vocabulary` | Turning "make it feel more alive" into a named technique with a number attached. Reach for it when a brief describes motion in adjectives. | `references/awards.md`, the technique taxonomy |
| `apple-design` | Apple's motion and interface principles translated for the web. Right when the register is a **product** and the brand wants to read as engineered. Wrong for editorial, cinema and argument registers. | The `ink` preset and `references/three.md` |
| `pick-ui-library` | Which library for a **UI task**: base-ui for accessible primitives, cmdk for command palettes, Sonner for toasts, motion for springs and layout animation, NumberFlow for animating numbers, Virtuoso for long lists. | `references/stack.md`, which covers the page-level and 3D libraries these do not |
| `prototype` | Several genuinely different versions of one UI piece behind a switcher. Use it for a component decision, not a page. | `awards --pick`, three references that disagree |
| `emil-design-eng` | The umbrella: philosophy plus the animation decision framework plus component principles. The other skills are its parts; load this one when the whole practice is wanted. | This file, and SKILL.md |

Not relevant to a website build and not listed as handoffs: `animate-expo`
(React Native), `write-swift`, `ask-sonner` (only when Sonner is actually in
the project).

### Where the two systems disagree, and which one wins where

They were written for different registers and both are right inside their own.
The line is **component versus page**.

| Question | `animate` says | This plugin says | Resolution |
|---|---|---|---|
| Default entrance curve | `cubic-bezier(0.23, 1, 0.32, 1)`, a strong ease-out | `cubic-bezier(0.16, 1, 0.3, 1)`, expo-out | Same family, same intent. Use Emil's on components, this plugin's on page reveals. Never mix both on one element. |
| Forbidden curve | Never `ease-in` on UI | Entrances decelerate, exits accelerate; never `ease-in-out` on a reveal | Compatible. `ease-in` is forbidden on entrances everywhere. |
| UI duration ceiling | Under 300 ms; dropdowns 150-250, modals 200-500 | Page reveals run longer, deliberately | Components take Emil's numbers. A hero reveal is not a component. |
| Stagger | **30-80 ms** between items; longer feels slow | Characters 12-25, words 30-50, lines 60-90, **cards 80-120** | The one genuine gap. A list of UI items (menu, results, chips) takes 30-80. An editorial grid of cards, arriving as a composition, takes 80-120. Ask which the thing is. Past 12 items both agree: group fade. |
| What to animate | `transform` and `opacity` only; `clip-path` sanctioned; `height` tolerated for accordions | `translate3d`, never `left`/`top`; one rAF loop | Identical rule, two phrasings. |
| `scale(0)` | Never; start at 0.9-0.97 | Not stated | Adopt Emil's rule outright. It is correct and this plugin had no position. |
| Reduced motion | A gentler variant, not zero: keep opacity and colour, drop transform motion | Measured as a requirement; `core.css` fallback uses `1ms`, not `0` | Compatible, and Emil's phrasing is the better instruction. |
| Springs | For drag, gesture, anything interruptible; bounce 0.1-0.3, rarely | Not covered | Adopt. Springs are a component concern this plugin never needed to hold. |

Two of Emil's rules are adopted into this plugin's own practice whether or not
his pack is installed, because they were simply missing here: **never
`scale(0)`** as an entrance, and **reduced motion is a gentler variant, not
zero**. Credit where it is due.

## Other packs worth the same handshake

Found with `npx skills find`, each read before being listed. Install counts are
the ecosystem's, not an endorsement.

| Pack | Owns when installed | Notes |
|---|---|---|
| `vercel-labs/agent-skills@web-design-guidelines` | A house checklist for web design review. 633K installs, the most-installed design skill there is. | Broad and opinionated in places this plugin already has a position on (grounds, type). Where they disagree on taste, this plugin's `tells.md` stands - it is the more specific document. Where they disagree on a fact, check. |
| `addyosmani/web-quality-skills@accessibility` | Accessibility review, from the Chrome team's side. | Complements `references/craft.md`. Run it as a second reviewer on forms and navigation. |
| `ibelick/ui-skills@fixing-accessibility` | Fixing, not just finding, accessibility defects. | Hand off the fix when the finding is a component pattern; keep the fix here when it is a page-level landmark or contrast problem. |
| `cloudai-x/threejs-skills` (`fundamentals`, `geometry`, `shaders`, `animation`) | three.js as a general subject. | `references/three.md` is narrower and deeper on the one case this plugin cares about, the scroll-driven product page. Use the pack for anything outside that - a game, a data visualisation, a shader study. |
| `vercel/components.build@building-components` | Building React components to a standard. | Framework work. This plugin's chassis is class names and plain HTML; the handoff is at the React boundary. |
| `heygen-com/hyperframes@hyperframes-animation` | 417K installs, the most-installed animation skill. | UNVERIFIED: not read in this pass. Listed because a model will see it in `skills find animation` above Emil's and should know it is a different tool for a different job (video-frame composition), not a competitor to `animate`. |

## How to detect, and what not to do

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" tools
```

reports every installed pack it recognises, with the one line of what changes
because of it. Detection reads the three skill directories and resolves
symlinks, because the CLI's default install is a symlink to a canonical copy
and a check that only looks for real directories reports every pack as absent.

Do not copy a pack's files into a project. They are the user's, installed at
the user's scope, and they update through the CLI; a copy drifts. Do not
recommend installing one mid-build. If a build would clearly benefit and the
pack is absent, finish the build with this plugin's own references and mention
the pack in the two-sentence handover, once, by its install command.
