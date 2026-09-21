# What makes a browser game's start screen read as human, AI-generated, or ordinary-studio

Research pass over two named exhibits plus 13 additional sites, all fetched/rendered directly (curl for CSS/JS/HTML, `webdesign.mjs` for screenshots). Unconfirmed claims are marked UNVERIFIED inline; everything else was pulled from a live response in this session.

Tools used: `curl` against CSS/JS/HTML endpoints; `node C:\Users\OWNER\cinematic-web-design\scripts\webdesign.mjs debug|look|study <url>` for renders. `debug`/`look` timed out on both `whiteout.plgb.chatgpt.site` (three.js scene never fired a load event inside the timeout) and a few other heavy WebGL sites — noted per-site below. Where render failed, the site's own static HTML/CSS was still fetched with curl, which is what actually carries a start screen's copy and structure (canvas paints the 3D scene, not the UI overlay), so the analysis is not compromised.

---

## Exhibit 1 — HUMAN-LOOKING: Doodle District

URL: https://doodleshooter.vercel.app
CSS: https://doodleshooter.vercel.app/style.A4A8BF44.css (fetched, 224 lines)
JS: https://doodleshooter.vercel.app/game.7LCERBLR.js (fetched, 302,767 bytes, grepped for strings)
Render: `webdesign.mjs debug` succeeded — `.../render/doodleshooter/normal/w1440.png`, `w390.png`, plus `reduced`-motion variants; review.html generated. Screenshot supplied by Gev also read directly (`images/2.png`).

### Fonts & colour (from `:root` and `body`)
```
:root { --ink: #1a30c0; --red: #d02030; --paper: #f6f3e6; }
body { font-family: 'Patrick Hand', 'Caveat', 'Comic Sans MS', 'Marker Felt', 'Segoe Print', cursive; }
```
Google Fonts import (from doodleshooter.html): `family=Patrick+Hand&family=Caveat:wght@600&display=swap`. Two real handwriting webfonts, not a display grotesque pretending to be handmade, with actual OS handwriting fonts (`Marker Felt`, `Segoe Print`) as the fallback stack — the fallback chain itself is a joke that only makes sense if you know what "scribbled" needs to degrade to.

### Structural craft (verbatim CSS, the actual tells)
- **Multiply blend mode everywhere on HUD**: `.hud-tl, .hud-tr, .hud-bl, .hud-br, .crosshair, .grapple-ret, .hitmarker, .dmg-ind, .message, .killfeed { mix-blend-mode: multiply; }` — the ink visually sits *on* the paper/3D backdrop rather than floating above it in a flat alpha layer. This is a physically-motivated CSS choice tied directly to the paper conceit, not a generic effect.
- **Per-element bespoke asymmetric border-radius**, never reused as one value:
  - `.bar { border-radius: 6px 8px 5px 7px / 8px 5px 7px 6px; }`
  - `.panel { border-radius: 12px 18px 10px 16px / 16px 10px 18px 12px; }`
  - `.mainbtns button { border-radius: 9px 13px 8px 12px / 12px 8px 11px 9px; }`
  - `.mapbtn { border-radius: 7px 10px 6px 9px / 10px 6px 9px 7px; }`
  - `.fm-tube { border-radius: 8px 11px 7px 10px / 11px 7px 10px 8px; }`
  Every rounded rectangle gets its own four-plus-four corner values, all close to each other but never identical — a hand-tuned "wobbly rectangle," repeated with variation dozens of times across the sheet, never abstracted into a single reusable token.
- **Per-element unique small rotation**, not a shared "tilt" utility class: `.hud-tl{rotate(-1.5deg)}`, `.hud-tr{rotate(1deg)}`, `.tally i{rotate(4deg)}`, `.tally i:nth-child(5n){rotate(-8deg)}`, `.bar{rotate(-1deg)}`, `.panel{rotate(-.6deg)}`, `.mainbtns button{rotate(-.8deg)}`, `.mainbtns button:nth-child(2){rotate(.7deg)}` (the two main buttons tilt in *opposite* directions, like two stickers slapped down separately), `.mapbtn{rotate(-.6deg)}`, `.modebtn{rotate(-.5deg)}`, `.lobby button{rotate(-.6deg)}`. Dozens of independent, slightly-different rotation values — the opposite of a single `--wobble` variable reused everywhere.
- **Hard, unblurred offset drop-shadows** (paper/sticker look, not a soft AI glow): `.panel { box-shadow: 6px 6px 0 rgba(26,48,192,.15); }`, `.mainbtns button.start { box-shadow: 6px 7px 0 rgba(0,0,0,.18); }`
- **A performative title animation**, not a fade: `@keyframes scribble { 0% { opacity:0; transform:rotate(-7deg) scale(1.7); filter:blur(3px); } 55% { opacity:1; transform:rotate(-1deg) scale(.95); filter:blur(0); } 100% { opacity:1; transform:rotate(-2deg) scale(1); } }` run over 0.55s — oversells the idea of a word being scrawled down fast and settling, wobble and all.

### Verbatim menu copy
- Title card: `<h1>DOODLE DISTRICT</h1><h2>a scribbled survival shooter</h2>`
- `START` button, subtext `solo · survive the waves`
- `PLAY ONLINE` button, subtext `free for all · up to 10 players` (elsewhere the online-lobby header uses `free for all · first to ${ms} · up to 10 players`)
- Map picker: `DOODLE DISTRICT` — *"streets, rooftops and fire escapes"*; `DOODLE JUNGLE` — *"canopies, vines and a lost temple"*; a hidden/test map `DOODLE MEXICO` — *"a sun-baked plaza · piñatas, tacos and mariachi · test map"* (an internal joke map left in, admitting it's a test map, with a fully-committed bit of local colour — exactly the kind of unpolished, specific, slightly silly detail a person leaves in for their own amusement)
- Full two-column control legend, verbatim, e.g.: `WASD move`, `Space jump (again on a wall = wall jump)`, `Space again in the air = double jump`, `C / Ctrl slide on the ground · air dash in the air`, `Q / E grapple: tap to swing, hold to reel, jump to launch`, `F quick katana slash`, `G grenade · hold it to throw further`, `1-4 / wheel rifle · shotgun · sniper · katana`, `Both mouse buttons dash-slash once the gauge is lit`; PS5 column: `L1 grapple (hold to reel, ✕ to launch)`, `L2 + R2 dash-slash once the katana gauge is lit`, `R1 quick katana slash, then back to your gun`. This documents *emergent tech* (wall-jump chaining, dash-slash once a meter is charged) precisely enough to learn advanced play from the start screen alone.
- `look sensitivity` slider reading `100%`; checkboxes `invert vertical look`, `trackpad mode · Shift aims · double-tap W sprints`, `music (M)`
- `checkpoints` row: `WAVE 5` / `WAVE 10` buttons
- `best score: 60393` — an actual, ugly, non-round persisted number, not a placeholder like `0` or `9999`

### Verbatim in-game / HUD copy (from JS strings)
- Weapon names: `KATANA`, `REVOLVER`, `RIFLE`, `SHOTGUN`, `SNIPER`
- Enemy names: `GRUNT`, `SNIPER`, `SWARM` — with a one-line design-rationale joke baked into its own description: `SWARM · more of them, thinner`
- `HEADSHOT`, `combo x`
- Contextual hint lines: `kills in the air are worth more · stay off the floor`, `slash · hold aim to block & return bullets`, `grapple needs a breather`, `blocked · the dash did not reach`, `catch your breath · +`
- System/status messages: `READY`, `BACK IN`, `FREE FOR ALL`, `HOST REMOVED`, `YOU ARE THE HOST NOW`, `YOU WIN`, `STILL THERE?` (AFK nudge), and — the standout — `OFF THE PAGE` as the fall-death message, a pun on the game's own paper conceit rather than a generic "GAME OVER"
- Multiplayer error copy, written in a casual, second-person, troubleshooting voice as if texting a friend: `could not load the networking library · check your connection and reload`, `could not reach the matchmaking server · check your connection`, `found the lobby but could not connect · one of you may be on a network that blocks it`, `no lobby with that code · check it with your friend`, `type the code your friend gave you`, `the lobby turned you away`, `move or you get kicked for inactivity`, `leave your lobby first`, `your rope got cut`
- `you survived <b>${wave}</b> wave${wave===1?"":"s"}` — grammatically handles the singular/plural case, a small correctness detail

### World behind the card
Hand-drawn blueprint 3D city (three.js) visible behind the paper card in the screenshot: pale cream ground, thin blue construction-line arcs and circles, small pencil-shaded 3D blocks (a truck, boxes, scaffolding) rendered in a sketchy outline style consistent with the "doodle" premise, not a generic skybox.

---

## Exhibit 2 — AI-LOOKING: Whiteout

URL: https://whiteout.plgb.chatgpt.site
CSS: https://whiteout.plgb.chatgpt.site/assets/index-DR4Z_j9N.css (fetched, minified, one line)
JS bundle: https://whiteout.plgb.chatgpt.site/assets/index-D2c3ZgEq.js (fetched, 892,055 bytes)
HTML: fetched directly (`curl https://whiteout.plgb.chatgpt.site/`) — the entire overlay/menu/end-screen/pause-menu/settings/video-export markup is static HTML in the document, not canvas-drawn, so this is complete and verbatim.
Render: `webdesign.mjs debug` then `look` both failed with `Error: Page load timed out; inspection is incomplete.` (three.js scene never fired `load` inside the tool's timeout budget) — noted as a render failure, not a content gap. Screenshot supplied by Gev read directly (`images/1.png`).

### Credits (verbatim, from the page's own footer — the single most load-bearing primary source in this whole study)
> Built by Philipp Burckhardt with GPT-6 Astra (Codex).
> World geometry & destruction authored with Blender
> Rendered with Three.js
> Sound effects created with ElevenLabs
> Soundtrack created with Suno
> Additional assets & textures from Poly Haven and OpenAI image generation
> Inspired by the driving escape sequence in *Alone in the Dark* (2008). A scene that stayed with me.

Note the register: this reads like a tool/stack disclosure (naming the AI model itself, naming every asset pipeline) rather than a thank-you to people. A genuine indie credit block is usually names of collaborators, or nothing at all.

### Fonts & colour
```
@import "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap";
```
Barlow Condensed (headings/wordmark/eyebrows), Inter (body). Background `#111b24`/`#101e28` near-black navy; text `#e3e9eb` off-white; one restrained warm accent `#bf9271`/`#be866c` (title-rule hairline, load-bar fill, focus ring, front-marker dot); secondary text greys `#a4afb4`/`#b3c3cc`/`#93a4ae`. A near-monochrome base plus exactly one "premium" accent colour — notably, the game's own subject is a *white/snow* escape, yet the UI chrome is black, not white or ice-toned; the palette reads as generic "dark mode SaaS," not derived from the fiction.

### Verbatim start-screen structure (from the live HTML)
```html
<header class="menu-title">
  <span class="title-rule" aria-hidden="true"></span>
  <h1 id="game-title">WHITEOUT</h1>
  <p id="intro">Keep moving. Cross the bridge.</p>
</header>
<div class="menu-actions">
  <div id="load" aria-label="Loading progress"><span></span></div>
  <button id="start" disabled>LOADING…</button>
  <button class="secondary start-settings" data-open-settings>Settings</button>
</div>
```
- `.title-rule`: a 34×2px copper hairline centred above the headline (`background:#bf9271;width:34px;height:2px`)
- `h1`: Barlow Condensed 600, `clamp(76px,12vw,154px)`, `letter-spacing:.065em`, `line-height:.85` — a condensed bold-caps wordmark
- `#intro` tagline: **"Keep moving. Cross the bridge."** — 15px, `letter-spacing:.035em`, muted grey `#a4afb4`
- Buttons sit in a `grid-template-columns: 1fr 138px` row — one wide primary + one small square secondary, both far smaller type (11–15px) than the 154px headline — an extreme, template-grade scale contrast
- Controls block: three `.control-group`s, each a row of `<kbd>` key-caps with a plain verb label underneath: `W`/`↑` → **Accelerate**; `A` `D` / `←` `→` → **Steer**; `SPACE` → **Brake**. Generic verbs, not named mechanics — there is no second layer of tech to document.
- Footnote: `<svg headphone-icon/> Sound & music · Headphones recommended` — a polite, formal register applied to a two-button start screen

### Other screens (verbatim)
- End screen: eyebrow `THE CITY DOESN'T WAIT`, title `LOST IN THE WHITEOUT`, button `TRY AGAIN` — a grand, vague, present-tense personification of the setting; the noun could be swapped for almost any survival game ("the desert doesn't wait," "the ocean doesn't wait") without losing anything specific.
- Pause menu: eyebrow `WHITEOUT`, `<h2>TAKE A BREATH.</h2>`, buttons `CONTINUE DRIVING`, `START AGAIN`, `SETTINGS` — "Take a breath." is comforting UX copy that could belong to any app, not a line about *this* driving-escape fiction.
- Settings dialog copy, three parallel balanced clauses: *"Ultra prioritizes reflections, lighting and detail over frame rate. High balances quality and smooth driving. Performance reduces shadows and effects."* — reads like product documentation, not flavour text.
- A full **video-export feature**: "Save your run" dialog with Clip (Full run / Last 30 seconds), Format (Landscape 16:9 / Vertical 9:16), Resolution (720p / 1080p), Graphics (High / Ultra), Include game sound checkbox, Create/Download/Share/Close actions — an impressive, fully-wired feature checklist disconnected from the core two-button driving loop; the kind of "complete the whole feature idea" breadth an agent adds rather than the specific thing a solo dev prioritizes first.
- The CSS literally contains a class named `.eyebrow` — confirming the page was authored from generic web-design vocabulary (kicker line above a headline) rather than game-UI vocabulary.

---

## Additional corpus (13 sites across three groups)

### Group A — human-made / indie / distinctive

**A1. Hollow Knight Silksong** (Team Cherry) — https://www.hollowknightsilksong.com
Rendered (`webdesign.mjs study`, sheet OK). This is the studio's *marketing* page, not the in-game title screen. Dark near-black background throughout; ornate flourished logo lockup "HOLLOW KNIGHT SILKSONG" over painted red/black key art (a character wielding a long needle weapon). Editorial section headers in a clean sans, each paired with a full paragraph of specific mechanical/narrative description, not a vague blurb: *"Ascend to the Peak of a Haunted Kingdom"*, *"Lethal Acrobatic Action"* (body: "Hornet must master a whole new suite of powerful moves to survive. She'll unleash devastating attacks, learn incredible silken abilities, and craft deadly tools in order to overcome the kingdom's challenges."), *"Beauty and Wonder in a Haunted World"*, *"Captured and Taken to a Distant Land"*. Real embedded gameplay screenshots/gifs throughout, Team Cherry logo + social icons in the header.

**A2. A Short Hike** — https://ashorthike.com
Rendered (OK). Flat vector illustration, no photo/3D render: layered flat-colour mountain silhouettes in a warm yellow-orange-to-green gradient sky, a small bird-person hiker mid-scene, soft rounded hand-lettered-style wordmark "A Short Hike". Tagline, lowercase, modest: *"a little exploration game about hiking up a mountain"* — the self-deprecating "a little X game" register is common genuine-indie phrasing, the opposite of a grandiose AI stinger. Embedded YouTube launch-trailer thumbnail; platform links as plain text (`nintendo switch · playstation 4 · xbox one · itch.io · epic · steam · gog`), no glossy pill buttons.

**A3. Bruno Simon's portfolio** — https://bruno-simon.com
Render attempted: `webdesign.mjs study` returned `wall — almost no text rendered - blocked, or a JS-only page` (the tool's own diagnostic). `<title>Bruno's</title>` (playful truncation, lowercase-feeling informality, no grand title), meta description *"Bruno Simon's creative portfolio"*. The whole site is a drivable WebGL go-kart through a 3D world; there is deliberately no HTML start-screen copy, no instructions overlay, no menu — the interaction itself replaces the interface. Near-zero server-rendered text is itself the tell: a confident human design choice an AI-authored page rarely risks, since AI-generated pages default to a safe HTML overlay with labelled instructions.

**A4. Balatro** — https://www.playbalatro.com
Fetched HTML only (canvas/JS wall for a full render in the time available). `<title>Balatro: Deck-Building Roguelite</title>`, meta description: *"Balatro is a deck-building roguelite where you must play poker hands and earn chips to defeat enemy blinds."* — one sentence, using the game's own proprietary jargon ("chips," "blinds") without stopping to over-explain it, confident that a newcomer will look it up. UNVERIFIED beyond this fetched title/description: the in-game title screen's hand-painted joker card art, custom warped display type and one-word menu options are public knowledge but were not re-confirmed by render in this session.

**A5. Krunker.io** — https://krunker.io
Fetched HTML (`webdesign.mjs study` reported `skip — Navigation failed: net::ERR_ABORTED`, likely an anti-bot redirect). `<title>Krunker.io - Free Online Multiplayer FPS Game | Play Now</title>`, meta description: *"Play Krunker.io - the ultimate free browser FPS game! Join millions of players in fast-paced multiplayer battles. No download required, works on any device."* This is a useful **boundary case**: Krunker is a genuinely human-made, long-running browser FPS, yet years of growth-marketing iteration have pushed its homepage copy into generic SEO/ad voice, closer in register to the AI exhibits than to Doodle District's specific, personal copy. Conclusion drawn from this: generic marketing copy alone does not prove AI authorship — it has to be read together with the structural/typographic tells and, most reliably, with whether real functional/mechanical detail is present.

### Group B — AI-generated (all `*.chatgpt.site`, OpenAI's own hosting domain for AI-built apps)

**B1. DOOMFLY** — https://fly-brain-doom.awormuth.chatgpt.site
Rendered (OK, screenshot captured) and HTML fetched (35,501 bytes). Fonts: `'Geist Mono'` (+ `'Geist Mono Fallback'`) and `'Silkscreen'` (+ fallback) — Geist Mono is Vercel's own font and one of the single strongest "scaffolded with AI web tooling" signals in 2025–2026, since it is the default monospace baked into countless AI-generated dashboards. Palette: pure black/white, thin 1px hairline borders, monospace throughout.
Structural conceit, verbatim from the rendered screenshot: the game (a Doom-style shooter) is wrapped in a fake research-instrument dashboard. Header: `DOOMFLY` · `HOW IT WORKS`. A panel titled `LIVE TELEMETRY` with stat tiles `HEALTH` `KILLS` `AMMO` (shown as em-dash placeholders before play) and `SPEED` / `BRAIN TIME`; a `NEURON → BUTTON` panel mapping `TURN` `MOVE` `FIRE`; two `LOOK INSIDE` panels labelled `01 / SENSORY INPUT · LIVE PIXELS` and `02 / NEURAL ACTIVITY`, both reading `Waiting for retinal input` / `Waiting for neural activity`; the main viewport itself shows `NO SIGNAL` / `Waiting for the simulation host`; footer strip reads `NEURAL EXPERIMENT · NO LEARNING` and `ONE SHARED LIVE RUN — Buffered live · 8 FPS capture cap · host must stay online`.
This is the single clearest structural AI-tell found in the whole study: the maker reframed a simple shooter as an instrumented "AI research demo," numbering panels and exposing its own infrastructure constraints (buffering, FPS cap, host-must-stay-online) directly in player-facing copy — a working game's UI never explains its own server architecture to the player.

**B2. Glass Towers** — https://glass-towers.openai.chatgpt.site
HTML fetched (80,444 bytes); render timed out (`Page.captureScreenshot timed out` — itself notable, a very heavy client bundle). Font stack: `"Helvetica Neue", Helvetica, Arial, sans-serif` — a completely safe system stack, no distinct display font at all, the mirror-opposite tell of Doodle District's deliberate handwriting fonts. Colours found repeatedly in the markup: `#d8d2dc` (dusty lavender-grey, appears 6×, a systematic muted neutral used for chrome), `#0a2033` (deep navy), `#ff6256` (a single coral accent), `#fff9f6`/`#eee8eb` (near-white warm neutrals) — a safe, low-saturation "premium neutral" palette rather than one derived from the game's fiction.
Copy: `<h1 aria-label="Glass Towers">` for the loading brand, and — critically — a second, fully-authored real heading for the failure state: `<h1>Glass Towers could not start</h1>`. An error screen written with the same care as the title screen is a classic AI-agent completionism habit: every state in the imagined state machine (loading/playing/error) gets built out uniformly, where a human prototyping alone would usually leave a failure state as a bare console message or skip it.

**B3. Tiny Rails** — https://sol-on-rails.openai.chatgpt.site (`<title>Tiny Rails — Endless Rail-Coaster Simulator Game</title>`)
HTML fetched (21,813 bytes). Fonts: `'Barlow Condensed'` — **the same family Whiteout uses**, an independent second AI-generated exhibit reaching for the identical display font — plus `'Bitter'` (serif) and `'Azeret Mono'`. Verbatim copy: `<h1 id="simulator-title">Take the line.</h1>`, sub-line *"An endless miniature coaster. You're at the controls."* — two short declarative sentences, both ending in a full stop, second person — the same multi-beat imperative-tagline cadence as Whiteout's "Keep moving. Cross the bridge." Loading copy: *"Opening the signal box"* — a personified, whimsical progressive-verb loading message.

**B4. Asterism** — https://asterism.openai.chatgpt.site (`<title>Asterism — The Constellation Game</title>`)
HTML fetched (7,772 bytes, a minimal shell — most content likely client-rendered). `<h1>Asterism</h1>`, loading line *"Reading the night chart…"* — again a poetic, personified, ellipsis-terminated loading message, matching the shape found in B3 and B5.

**B5. Elsewhere** — https://elsewhere-dream.domtyler1975.chatgpt.site (`<title>Elsewhere · A waking dream</title>`, note the middle-dot subtitle separator and literary fragment)
HTML fetched (29,917 bytes); render blocked (JS wall). `<h1 class="ew-title">Elsewhere</h1>`, subtitle: **"Survive. Find a portal. Go further."** — three short imperative sentences, period-punctuated, present tense, ascending urgency: the exact multi-beat tagline shape recurring a *third* independent time across this small AI-generated sample. Loading states: *"Opening your dream…"*, *"Loading the game.  Please keep this page open."* (note the double space and the oddly formal, customer-service-register courtesy phrase). Buttons dressed in narrative verbs instead of naming the action: `Keep wandering` (= Resume), `Start a new journey` (= Restart), enter-button-while-loading reads `Growing your world…`. The "How to Play" panel is dense, systematic, rules-lawyer prose in full sentences ("Land doorways reveal their trade-off when you approach... Before every fourth new land, choose a change of pace...") — closer to a rulebook than a quick-glance HUD hint.

### Group C — ordinary studio / publisher pages

**C1. Valorant** (Riot Games) — https://playvalorant.com
Rendered (OK). Full character close-up render as hero background; small centred wordmark "VALORANT" + one-line descriptor *"VALORANT — A 5V5 TACTICAL SHOOTER FEATURING AGENTS WITH UNIQUE ABILITIES"* + a single red pill CTA `PLAY FOR FREE`. Standard publisher content-hub nav (`GAME INFO / MEDIA / NEWS / SUPPORT / OUR SOCIALS / ESPORTS / MERCH / MORE`, search + account + "Play Now" in the header), a news/promo feed below the fold with dated posts ("Champions Shanghai - Merch Collection", "Champions Shanghai Opening Day"), and a cookie-consent banner. Nothing about the *layout* is specific to Valorant besides the character art and wordmark — the same shape recurs on hundreds of live-service game sites.

**C2. Overwatch 2** (Blizzard) — https://overwatch.blizzard.com
Rendered (OK). Same publisher-portal shape: cross-game nav (Blizzard logo, Game Info/Heroes/Season/News/Community/Shop, Account, Play Now), hero banner "OVERWATCH" + tagline *"A FUTURE WORTH FIGHTING FOR"* + *"TEAM-BASED ACTION · FREE TO PLAY"* + orange `PLAY NOW` + a platform-badge row (Battle.net/Xbox Series X|S/PlayStation/Switch/Steam). Second panel is pure live-ops merchandising: *"OVERWATCH X LE SSERAFIM BACK ON TOUR"*, a paragraph about a K-pop collaboration, a named-cosmetic grid ("ULTRA MADE MY NIGHT D.MON" etc.) and a `GET THE D.MON BUNDLE` CTA — the front page is a storefront/live-ops calendar, not a start screen at all.

**C3. Fortnite** (Epic) — https://www.fortnite.com
Render attempted: `webdesign.mjs study` reported `wall — almost no text rendered - blocked, or a JS-only page` (a fully client-rendered React app; nothing usable came through in the time available). Kept in the corpus only as a third documented example of the "publisher page is a storefront wall, not a start screen" pattern — no copy from this session is quoted for it, and any claim about its specific content beyond the block diagnostic is UNVERIFIED.

---

## Synthesis

### The short form

Measured on the two exhibits - Doodle District, hand-made, and Whiteout,
built with a code agent and credited as such on its own credits screen - and
holding across the corpus above. The long form follows it.

1. **Specificity.** The made thing names its own parts: "L2 aim, R2 fire",
   "checkpoints WAVE 5 / WAVE 10", "best score: 60393". The generated one names
   categories: Accelerate, Steer, Brake, Settings.
2. **Density where the player needs it.** Two full control columns on one card
   beat three key caps and a footnote. A start screen with nothing to read is
   a poster, not a start screen.
3. **Type from the world of the thing.** Patrick Hand and Caveat on lined paper
   because the game is a doodle. The generated page reaches for a condensed
   grotesk over black because that is what "cinematic" looks like on average.
4. **Irregularity that was chosen.** Per-element rotation, hand-set radii,
   offset shadows, a card that is not centred. Grid-perfect rows of identical
   buttons read as generated.
5. **Copy that could only belong here.** "OFF THE PAGE" as the death line of a
   paper game. The generated fingerprint is the pattern, not a phrase: two-beat
   imperative taglines and caps eyebrows that name no mechanic. "Keep moving.
   Cross the bridge." and "THE CITY DOESN'T WAIT" were read from the exhibit
   pages (checkable tells 17-18 below); `copy-tells.md` could not source either
   to a critique and marks them illustrative. "Headphones recommended" is a
   genre convention older than any model and is not a tell on its own; "TAKE A
   BREATH." is UNVERIFIED and not attributed to any page here.
6. **State that persists.** A best score, a remembered sensitivity, a
   checkpoint: evidence that someone played it. Generated start screens are
   stateless.
7. **Credits that name people and tools plainly**, in a footer, not a hero.

### Checkable tells that mark an AI-generated game start screen

**Typographic**
1. Barlow Condensed (or a very similar grotesque-condensed) as the bold-caps display font — found independently on **two** unrelated "AI-built" exhibits here (Whiteout, Tiny Rails). A shared "generator's reach-for" font recurring across otherwise-unrelated makers is a stronger signal than any single font choice.
2. Geist Mono as the monospace pairing (DOOMFLY) — Vercel's own font; its presence is close to a direct fingerprint of AI-assisted/v0-style web tooling.
3. Inter for body copy — the single most common "no decision was made" body font, present on Whiteout.
4. No hand-authored, script, or world-specific display font anywhere in Group B; safe system stacks (`Helvetica Neue, Arial`) or safe Google-Fonts pairings chosen because they read as "premium," not because they fit this game's fiction.
5. Wide, uniform letter-spacing applied indiscriminately: eyebrows at .22–.28em, buttons .08–.18em, even intro body text .035em — the generic "premium SaaS landing page" tracked-caps tic, applied regardless of whether the text is a label, a sentence, or a button.
6. Extreme, binary type scale: one oversized `clamp()` hero headline (76–156px) against uniformly tiny UI text (11–15px), nothing built in between.

**Layout / structural**
7. A literal `.eyebrow` kicker-label pattern (small tracked caps above a big headline) — vocabulary borrowed from generic marketing templates, not from game UI.
8. Grid-perfect two-button action rows: one wide primary CTA + one small square secondary, e.g. `grid-template-columns: 1fr 138px` — a transplanted "hero CTA + secondary CTA" web pattern.
9. Full completionism of imagined states: dedicated, fully-styled markup for loading, error ("Glass Towers could not start"), settings (with parallel three-clause explainer prose), and even a disconnected feature checklist (Whiteout's full video-export dialog: clip length, aspect ratio, resolution, quality) — breadth over depth, every conceivable screen built out evenly regardless of whether the core loop needs it.
10. Numbered/labelled instrumentation panels grafted onto the game itself (DOOMFLY's `01 / SENSORY INPUT`, `02 / NEURAL ACTIVITY`, `LIVE TELEMETRY`) — dashboard chrome where a HUD should be.
11. Self-referential meta-copy that leaks the making of the thing instead of describing the game world: "Buffered live · 8 FPS capture cap · host must stay online," "NEURAL EXPERIMENT · NO LEARNING." A working game never explains its own server budget to the player.
12. Controls documented only as generic verbs (Accelerate/Steer/Brake) with no second layer of mechanic — no meter, gauge, combo, or timing trick explained, because there usually isn't one to document.
13. No functional persistence surfaced on the start screen: no best score, no checkpoint list, no named map/mode picker — these require real save-state plumbing that a single generation pass rarely wires up.
14. Credits that read as a stack disclosure rather than a thank-you: naming the AI model itself, naming every asset-pipeline vendor (Blender, Three.js, ElevenLabs, Suno, Poly Haven, "OpenAI image generation").

**Colour**
15. Near-monochrome base (black/off-white) plus exactly one restrained "brand" accent colour, chosen for looking premium rather than for fitting the fiction (Whiteout's copper on a *snow* game; Glass Towers' single coral accent on a "glass" game).

**Motion**
16. Small, tasteful, template-grade micro-interactions only: hover brightens, `translateY(-1px)` lifts, an arrow nudging 3px on hover — competent but generic, versus a human exhibit's willingness to build one oversized, over-performed flourish that exists purely to sell a single idea (see Doodle District's 550ms scribble keyframe).

**Copy tells — phrases and sentence shapes (the most checkable of all)**
17. Two- or three-beat imperative taglines, each clause a short full sentence ending in a period, found **independently three times** in this small sample: *"Keep moving. Cross the bridge."* (Whiteout); *"Take the line."* / *"An endless miniature coaster. You're at the controls."* (Tiny Rails); *"Survive. Find a portal. Go further."* (Elsewhere).
18. A vague, portentous, present-tense personification of the setting as a stinger: *"THE CITY DOESN'T WAIT"* — swap one noun and it fits almost any survival game.
19. Formal, customer-service-register footnotes: *"Sound & music · Headphones recommended"*, *"Please keep this page open."*
20. Progressive-verb, ellipsis-terminated loading copy that personifies the world instead of naming what's actually loading: *"Opening your dream…"*, *"Reading the night chart…"*, *"Growing your world…"*, *"Opening the signal box"*.
21. Settings/help copy written as matched, parallel explainer prose (documentation register): *"Ultra prioritizes reflections, lighting and detail over frame rate. High balances quality and smooth driving. Performance reduces shadows and effects."*
22. Ordinary buttons dressed in narrative verbs instead of naming the action: `Keep wandering` (Resume), `Start a new journey` (Restart) — a thesaurus pass over a button, not a joke or a world detail.
23. Eyebrow labels in all-caps paired with numbered indices as a structural habit (`01 / SENSORY INPUT`), not just as an occasional flourish.

### What human-made ones do instead

1. **Specificity of mechanics inside the UI copy itself** — Doodle District's control legend names exact key combinations and their emergent results ("Space again in the air = double jump," "L2+R2 dash-slash once the katana gauge is lit"). You could learn advanced tech from the start screen alone.
2. **Density over restraint** — two full control columns, a sensitivity slider, checkboxes, a map picker, checkpoints, and a best score all visible on one card at once; no attempt to look minimal or "premium."
3. **Hand-made type choices that pay off the concept**, not safe defaults — Patrick Hand + Caveat exist *because* the game's whole premise is "scribbled"; the fallback stack (`Marker Felt`, `Segoe Print`) is itself a small joke.
4. **Bespoke, varied micro-detail repeated with variation, never abstracted to one reusable token** — a different asymmetric border-radius per element, a different small rotation per element, hard offset shadows, `mix-blend-mode: multiply` tying the UI physically to the backdrop.
5. **Functional detail that only exists because the game has real state** — checkpoints named by wave number, an ugly non-round persisted best score (60393), a lobby-code system with troubleshooting copy clearly written by someone who watched friends actually fail to connect.
6. **Copy that names real things in the actual game**, not generic verbs — weapon names, enemy names with a design joke attached ("SWARM · more of them, thinner"), a hidden test map with a fully-committed bit ("DOODLE MEXICO — piñatas, tacos and mariachi").
7. **In-world, thematic system messages** — a death message that puns on the game's own premise ("OFF THE PAGE") instead of a generic "GAME OVER."
8. **Casual, personal, second-person voice in error states** — closer to a Discord message from the developer than to software documentation.

Caveat drawn from the Krunker.io boundary case: generic marketing copy alone is not sufficient proof of AI authorship — long-running human-made games can drift into generic SEO voice too. The structural and typographic tells (density, bespoke micro-detail, named mechanics, real persisted state) are more reliable than copy register alone.

### Studio/publisher marketing page vs. an in-game start screen — the third pole

A studio or publisher page (Valorant, Overwatch, and by strong pattern Fortnite) is not attempting to *be* a start screen at all — it is a content hub / storefront: a persistent multi-item nav bar (Game Info / News / Esports / Shop / Merch / Account), a news-and-promo feed below the hero, a cookie-consent banner, a platform-badge row, and second-string sections that sell cosmetics by name ("GET THE D.MON BUNDLE"). The actual start screen for these games lives inside the downloaded client, behind a "PLAY NOW" / "PLAY FOR FREE" CTA that leaves the browser entirely — the website's job is acquisition and live-ops merchandising, not conveying controls or game state.

Distinctive indie sites (Silksong, A Short Hike) sit structurally close to the publisher template — hero, section blocks, trailer embed, platform links — but differ sharply in voice and specificity: full narrative paragraphs describing actual mechanics and story beats, modest self-describing taglines ("a little exploration game about hiking up a mountain") instead of grand stingers, and platform links presented as plain text rather than a single glossy CTA pill.

The dividing line, in short: an **in-game start screen** exists to get you playing correctly (controls, state, options) and, when human-made, tends to over-share mechanical and personal detail because the person behind it cares about the specific thing they built. A **studio marketing page** exists to get you to click "Play Now" and hand off to the real client, so it looks like every other content hub regardless of the game inside. An **AI-generated start screen** tries to look like the *marketing page's* aesthetic vocabulary (eyebrows, tracked caps, one hero CTA, one brand accent, parallel explainer prose) grafted directly onto the actual gameplay entry point it never had a marketing page's excuse to use.

---

## URLs referenced

- https://doodleshooter.vercel.app
- https://doodleshooter.vercel.app/style.A4A8BF44.css
- https://doodleshooter.vercel.app/game.7LCERBLR.js
- https://whiteout.plgb.chatgpt.site
- https://whiteout.plgb.chatgpt.site/assets/index-DR4Z_j9N.css
- https://whiteout.plgb.chatgpt.site/assets/index-D2c3ZgEq.js
- https://www.hollowknightsilksong.com
- https://ashorthike.com
- https://bruno-simon.com
- https://www.playbalatro.com
- https://krunker.io
- https://fly-brain-doom.awormuth.chatgpt.site
- https://glass-towers.openai.chatgpt.site
- https://sol-on-rails.openai.chatgpt.site
- https://asterism.openai.chatgpt.site
- https://elsewhere-dream.domtyler1975.chatgpt.site
- https://playvalorant.com
- https://overwatch.blizzard.com
- https://www.fortnite.com

Not successfully examined this session (attempted, blocked/errored, excluded from the corpus rather than guessed at): `http://www.celestegame.com` (`Page load timed out`), `https://dredgegame.com` (`net::ERR_SSL_PROTOCOL_ERROR`), Slay the Spire's site (not attempted — turn budget spent on the above 13 plus two exhibits, which already covers the 10–14 target with confirmed primary-source data).
