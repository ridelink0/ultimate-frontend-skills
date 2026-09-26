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
   Cross the bridge.", "Headphones recommended", "THE CITY DOESN'T WAIT" and
   "TAKE A BREATH." were all read from Whiteout's live HTML (Exhibit 2 above:
   tagline, footnote, end-screen eyebrow, pause-menu heading), so they are
   attributed here; `copy-tells.md` found no critique citing them and marks
   them illustrative of the pattern rather than sourced tells. "Headphones
   recommended" alone is a genre convention older than any model, not a tell.
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

## In-game rendering: five mistakes Doodle Voyager made (2026-09-24)

A three.js first-person game built from this corpus went through all five of
these. Each one shipped, looked wrong, and had one cause worth knowing before
you write the first pass.

1. **A stylised post pass that replaces lighting makes everything flat and
   white.** The game's "ballpoint on paper" pass drew ink edges and hatching
   over a paper colour and threw the lit colour away, so no surface had a
   light or a dark side. Keep real lighting in the materials and do the
   stylisation there: patch a `MeshLambertMaterial` with `onBeforeCompile`
   (after `#include <opaque_fragment>` is replaced) and draw the hatching in
   object space from the light that actually arrived. The post pass then only
   adds edges, background and screen effects. Doodle Shooter's look is a
   texture on lit surfaces, not a replacement for lighting.
2. **Bloom double-encodes gamma if the composite does its own.** With
   `EffectComposer` + `ShaderPass(composite)` + `UnrealBloomPass`, bloom is
   the last pass and copies its input to the screen with a
   `MeshBasicMaterial`, which three.js sRGB-encodes. A composite that already
   applied `pow(c, 1/2.2)` gets encoded twice and every dark value washes out
   pale. Either keep the chain linear and end with `OutputPass`, or set
   `renderer.outputColorSpace = THREE.LinearSRGBColorSpace` when you encode by
   hand. The symptom is a scene that looks right with bloom off and milky with
   it on.
3. **Colour-difference edge detection outlines every hatch stroke.** Once
   hatching is inside the material, a post-pass colour edge fires on each pen
   line and the surface turns into a bright mesh. Keep depth, background and
   material-ID edges; restrict colour edges to materials without hatching.
4. **"Neon" means a dark city lit by its signs, not every surface glowing.**
   Bright cyan edges and rims on everything read as a wireframe, not neon.
   Dark surfaces, dim silhouette lines, low fill light (a hemisphere near 0.3
   inside a cabin), and colour only on emitters: screens, lamps, signs,
   engines, enemies. Let a bloom threshold catch only those. Small interiors
   stay dim; large ones can carry more light.
5. **Check a game at the sizes it is played at.** A keyboard-and-mouse game
   has no controls at 390 px, so a phone-width render proves nothing. Use
   `webdesign.mjs look --game` (1366, 1280, 1920); add phone widths only when
   the game ships touch controls.

## Shipping a networked game: five more mistakes Doodle Voyager made (2026-09-25)

Multiplayer and a second look went in a day later. Each of these shipped or
nearly shipped with every check green. The full records, with what UFS said
at the time and the check that now holds each one, are in
`docs/field-tests/doodle-voyager.md` in the plugin repository.

6. **A policy that refuses your own transport is invisible to an offline
   suite.** `net.js` did `import('https://esm.sh/@supabase/supabase-js@2')`
   and `createClient(PROJECT)`; the staged Content-Security-Policy allowed
   only `self` and jsDelivr in `script-src`, and had no Supabase origin in
   `connect-src`. The suite drove multiplayer through a fake bus, so live
   multiplayer was dead in production and every check passed. Four rules:
   build the policy's origins from the constants the code imports from, never
   by hand; pin a CDN module to an exact version on a host the policy already
   allows; test the STAGED build served with its real headers, dynamic-import
   every lazily loaded module there and assert zero
   `securitypolicyviolation` events; and keep one live end-to-end check
   (two headless players in the real room) outside the offline suite.
   `webdesign.mjs security <dir>` now reports a policy that refuses a URL the
   code loads, as an error.
7. **In a ship-relative world, every actor goes through the one placement
   function.** The renderer draws the world relative to the ship and squashes
   distance; network ghosts were placed at their absolute coordinates, so a
   real peer sat nowhere near where it was. The check asserted
   `mesh.x === ghost.x` and so enshrined the bug. Every new kind of actor
   (ghosts, name labels, peer bolts) is placed by the same function that
   places enemies, and its test asserts the mesh against that function, not
   against raw coordinates.
8. **A headless game test advances simulated time, not the wall clock.**
   Checks that waited a number of milliseconds and let the frame loop run
   flaked on a loaded machine: the throttle check got 33 units instead of 66,
   the breach check 0.3 s of simulation instead of 0.5. Anything whose
   assertion depends on how much game time passed calls `update(dt)` a fixed
   number of times; a wall-clock wait is only for what genuinely needs frames
   (rendering, pixel readback), and nothing asserts on how much simulation
   happened during one.
9. **A renderer that keeps a material ID in alpha cannot fade anything with
   alpha.** Labels and sprites must write their ID and fade by dimming plus a
   screen-door dither (discard against interleaved-gradient noise), or they
   become false ID edges. A second look is a set of shared uniforms, switched
   with no recompile, and the HUD's CSS palette and blend mode (screen on
   dark, multiply on paper) switch with it.
10. **A stage script that empties the output folder deletes the deploy
    link.** `stage.mjs` wiped all of `dist/`, `.vercel/` included, so the next
    `vercel deploy` found no link and created a new project called `dist`.
    It happened twice. Clear everything except `.vercel/`, and before any
    production deploy read `.vercel/project.json` and confirm the project
    name is the one you mean.

## Playing it: what Gev's review caught that every check passed (2026-09-25)

The owner played the same game for twenty minutes and came back with
seventeen things wrong with it. The offline suite was 213 green, the render
check was clean, the audit was clean, and not one of these was visible to any
of them. They are not bugs in the sense a test catches; they are the game
failing to be a game. Each is written here as a rule, because every one of
them was avoidable at the design pass. The records, with what UFS said at the
time and the check that now holds each one, are in
`docs/field-tests/doodle-voyager.md` in the plugin repository.

11. **A hand-drawn look whitens the TEXTURE where the light lands. It is not
    a light effect.** The owner, verbatim: "when i mean doodle shoot textures
    I meant that lighiting makes the texture white (not the ligting the
    texture) and as you can see with the black hole you did it correctly, it
    shows shading at the end which is what I want for everything." So: light
    drives the albedo toward paper white and drives hatch coverage down; the
    shaded side keeps the hatching, dense toward the terminator and the
    silhouette. What it is not: emissive, additive, a rim light, or bloom on
    a lit face - those make the surface brighter than the paper, and a
    surface at 255 on every channel has no texture left to shade. Keep the
    lit side below pure white (a paper white near 244 leaves room), quantise
    to three to five tone bands so it reads as strokes rather than a ramp,
    and check it by sampling pixels, not by eye. The recipe is in
    `references/three.md`, section "12. The hand-drawn look: the light
    whitens the texture". `webdesign.mjs look` now warns when a WebGL canvas
    is more than 15% clipped to pure white.
12. **An enemy has to read as an enemy at the distance you first meet it.**
    The enemies were built from the same hull kit as the friendly ships, so
    at range they read as traffic. Silhouette first (a shape no friendly
    actor has), then scale, then colour - the owner asked for "big, red, all
    of that" - and each one holds at the distance the player first sees it,
    not in a model viewer. Check it the way the player meets it: a frame
    grabbed at engagement range, downscaled to a thumbnail. If you cannot
    tell friend from enemy in the thumbnail, neither can the player.
13. **Nothing that hunts you may pass through the cover you are hiding
    behind.** The interior enemies clipped through the walls of the rooms
    they were in. An actor that ignores the geometry ends the only tactic the
    room offers, and it reads as a broken game rather than a hard one. Every
    actor that moves in a bounded space is swept against that space's
    collision geometry, and the test is a level-shaped one: place the actor
    outside a wall, aim it at the player, step the simulation, and assert it
    never crosses.
14. **One traversal tool with one destination is not traversal.** The jetpack
    flew to the ship and nowhere else, so boarding a small ship was the only
    thing it could do, and doing it was the hardest thing in the game. The
    owner: "its hard to get inside the small ships when the jetpack is going
    to the ship, no where else making this game WAY too hard." A movement
    verb takes a direction from the player, or it is a cutscene. Give it free
    aim first and a snap-to-target as an assist, never the reverse.
15. **Every sensory effect gets its own control, and a zero.** Motion blur
    had no intensity of its own - its strength came from the quality preset
    (0, 0.75, 1.0) - and screen shake was a boolean. The owner reported the
    blur "shakes the screen" and had nothing to turn down. A quality preset
    is about frame rate; an effect the player can feel in their body is about
    comfort, and the two must not share a slider. Motion blur, camera shake,
    field-of-view kick, chromatic aberration, vignette pulse and flashing all
    get a named 0-100% control that reaches a real zero, and all of them
    start reduced when `prefers-reduced-motion` is set - read with
    `matchMedia()` in the script, because a stylesheet's media query never
    reaches a canvas loop (`webdesign.mjs audit` warns when shake or motion
    blur ships with no such read). See `references/motion.md`, section
    "Screen effects a player feels in their body".
16. **A window is a view, not a porthole.** The ship's windows were too small
    to see out of, which removed the reason to be at the window at all. The
    owner: make the window "take the whole side of the room". Size an opening
    by what it is for: if the point is to watch the world, the opening is the
    wall.
17. **A hazard must always have an exit.** Flying close to the black hole
    killed the player in a loop: die, respawn inside the kill radius, die
    again. Any hazard that can kill on contact needs a respawn placed outside
    it, a grace period on respawn, or both; and the test is the nasty one -
    die inside the hazard and assert the next state is playable.
18. **Content the owner asked for has to appear in play, not only in the
    code.** The planet advertisements were built and the owner never saw one:
    "There are no ads like I asked". A feature that exists in a module and
    never renders in a session is not shipped. For anything placed in a
    world, the check is a played session: reach the place it lives and
    photograph it. Absence is the default and has to be disproved.
19. **If it looks like an object, the player will try to pick it up.** "I
    cant pick up boxes for fun." Props that read as loose objects need the
    interaction the shape promises, or they should not read as loose. This is
    the affordance rule from the web, in three dimensions: a thing shaped
    like a button is a button.
20. **Multiplayer means you can go where the other player is, and tell them
    apart from the scenery.** Peers appeared but their ships could not be
    boarded and the people did not read as people. The owner wanted to visit
    other ships, and the players themselves to read as Doodle Shooter enemies
    "but BLUE" - one hue, reserved, never used for anything else. Two rules:
    every place the local player can be is a place a remote player can be
    visited in, and a remote player's colour is a team colour that nothing
    else in the palette may borrow.
21. **Speed is an axis the player controls, not a constant you tuned.** The
    ships were too slow and there was no acceleration control. The owner's
    scale for the fastest ship: from seeing the Milky Way at a distance to
    inside its edge in seconds. Give a vehicle an acceleration input, a top
    speed that differs per hull, and a sense of scale that survives it -
    then tune. A single speed number is a placeholder.
22. **A plotted course is one way to travel, never the only one.** "you
    should also be able to free roam, not just having to plot a course all
    the time." Autopilot is a convenience laid over free movement. If the
    only way to get anywhere is to pick a destination from a list, the world
    is a menu.
23. **One death screen for every cause teaches nothing.** "When you die it
    should actually show multiple screens for multiple scnearos." A death
    screen is the game's only chance to say what killed you and what to do
    differently. One per cause, naming the cause.
24. **One sound bus, or two pieces of music fight.** A second music source
    played over the soundtrack: "I hear other music on the game that isnt
    even apart of music and is battling the other music". Everything audible
    goes through one named bus with one mixer; anything that can sound at the
    same time as the music either shares its bus or ducks it; and the list of
    sources that can be audible at once is short enough to write down and
    check. The usual way a second source gets past the mixer: a `<video>` or
    `<audio>` element (a tape on an in-world screen, a trailer, an ad) plays
    straight to the speakers unless it is fed into the graph with
    `ctx.createMediaElementSource(el).connect(bus)`, so the duck on the music
    bus never touches it. Route it in, or mute it. `webdesign.mjs audit` warns
    when a project mixes through an `AudioContext` and has such an element
    unmuted and unrouted.
25. **Two names for the same verb is one too many.** "Remove the cruise it
    dosent make sense, autopiolot does, just make it so the player themselves
    can move at cruise speed." Cruise and autopilot were two modes for one
    idea. When two controls describe the same action, cut one and fold its
    behaviour into the other; the survivor is the one the player already
    understands.

## Before you call a game done: the play pass

Every finding above was found by playing, and none of them by a check. The
suite, the render check and the audit are the floor. This is the pass that
comes after them, and it is done by someone holding the controls, answering
each question out loud before the owner has to.

- [ ] Look at the stylised surfaces. Does the light whiten the texture, with
      the shading and hatching still visible where it falls away? A surface
      brighter than its own paper is a light effect, not a texture.
- [ ] From the distance you first meet them, can you tell an enemy from a
      friendly actor? Check it on a thumbnail, not a full frame.
- [ ] Can anything that hunts you pass through the cover you are using?
- [ ] Does every movement verb take a direction from the player, rather than
      only a destination?
- [ ] Does every effect you can feel - blur, shake, kick, flash - have its
      own control with a real zero, independent of the quality preset?
- [ ] Is every opening the size of the job it does? If the point is to look
      out, can you see out?
- [ ] Die inside every hazard. Is the next state playable, every time?
- [ ] Play until you have seen, with your own eyes, every feature the owner
      asked for. Name the ones you did not reach.
- [ ] Try to pick up, open, sit on and break the things that look like they
      can be. Does the shape's promise hold?
- [ ] With a second player: can you reach them, visit where they live, and
      tell them from the scenery at a glance?
- [ ] Can the player change speed, and does the world still read at the top
      of the range?
- [ ] Can you go somewhere nobody plotted a course to?
- [ ] Die of three different causes. Do you get three different screens, each
      naming its cause?
- [ ] Listen with the music on. Is exactly one piece of music playing?
- [ ] Read every control's name. Do any two name the same action?
- [ ] Write down what the owner asked for that you cannot demonstrate, and
      say so before they find it.

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
