# Field test: HQ (2026-09-23 to 2026-09-24)

HQ is a key-gated dashboard website for Gev and a friend: shared to-do list,
whiteboard, RideLink numbers, Gmail and AdMob through Google sign-in, limit
resets, and later a Lab with a live WebGL2 shader editor and a three.js PBR
material viewer (commit 0e4d4f6). Plain HTML, CSS and JS on Vercel
(gev-hq.vercel.app), Supabase RPCs behind a key. Source: D:/gev-hq.

Gev's brief, 2026-09-24: "Use UFS to create an excellent UI", and "add support
for the UFS plugin to handle video creation". Built with UFS 6.1.2; 6.2.0 was
released from the same session with the first three fixes below.

Mined from: HQ's git log (5860c87, cfa5b49, 0e4d4f6), `docs/LAB-BRIEF.md`,
`tests/run.mjs`, Gev's memory note project_gev_hq_dashboard, UFS 6.2.0
(24bae6e), and targeted greps of the build session's transcript, including
Gev's nine-point review of the first version, quoted in HQ-5 to HQ-8.

### HQ-1. Asked for video from references, and UFS could only read video

**What happened.** Gev asked for UFS to "take references, use the UFS plugin,
and generate a high-quality video". The only video code in UFS was
`video.mjs`, which pulls frames out of a video; it could not make one.

**What UFS said or did.** `webdesign.mjs video` extracted frames; nothing
rendered.

**What it should have said or done.** Take references in and render a
frame-exact MP4, and know what makes a video read as machine-made.

**The UFS fix.** 6.2.0 (24bae6e, 2026-09-24): `video scene` and `video
render` (HTML scenes rendered frame by frame to MP4 through ffmpeg),
`references/video.md`, section "The route", and `references/video-tells.md`,
section "The check, before a final render".

**Regression check.** `test/video.test.mjs`, "stills and a clip render to an MP4 with exactly the requested frames"
and `test/video.test.mjs`, "a scene never overwrites another scene, and unknown references are refused"

### HQ-2. The render check lost Edge 153, and left thirty browsers behind

**What happened.** The first render of HQ hung. Edge 153 hands its session to
a child process and the launcher exits 0 at once; UFS took the exit as a
failed launch and stopped waiting, then cleaned up with `proc.kill()`, which
never reaches the handed-off child. Headless browsers piled up (thirty, as
measured then).

**What UFS said or did.** "browser did not expose a debugging port", and
orphaned processes.

**What it should have said or done.** Treat a launcher exit of 0 as a
hand-off, find the port by the port file or by asking the port, close the
browser over the protocol, and on Windows end only the processes carrying
this run's own temporary profile.

**The UFS fix.** 6.2.0: `launch()` in scripts/inspect.mjs. It is a tool fix
with no reference text; the comments in `launch()` carry the reasons.

**Regression check.** Not testable automatically: it needs a browser whose
launcher hands off (Edge 153 and later on Windows). On such a machine every
real-browser test goes through this path and fails with "did not expose a
debugging port" if it breaks, but no test isolates it, and the process
clean-up is not asserted.

### HQ-3. Scrolling panels read as text on top of text

**What happened.** HQ's panels scroll. The render check reported every row
scrolled out of a panel as "overlap 100%" with the panel under it, so a
correct dashboard failed.

**What UFS said or did.** It measured each text box whole, including the
part its scroll box clips away.

**What it should have said or done.** Measure only the part of a text box its
overflow ancestors let through.

**The UFS fix.** 6.2.0: the probe in scripts/inspect.mjs clips each text box
to its overflow ancestors.

**Regression check.** `test/browser.test.mjs`, "text clipped inside a scrolling panel is not an overlap; text painted over text still is"

### HQ-4. Every render check was a check of the key screen

**What happened.** HQ shows only a key screen until the key passes. The first
screenshots (tests/locked/ in 5860c87) were of the lock; every overlap,
contrast and layout finding was about it. The session got past it by putting
the key in the URL fragment the app happens to read, which a gated site
usually does not offer.

**What UFS said or did.** Its actions could click, hover and focus, but not
type, so no actions file could get through a key or password screen.

**What it should have said or done.** Type into a field and press Enter, take
the secret from the environment rather than the actions file, never write it
to the report, and measure the page behind the gate.

**The UFS fix.** This change: a `type` action in scripts/inspect.mjs
(`text` or `textFromEnv`, optional `"key": "Enter"`); the typed text is
replaced by its length in review.json; any step can carry `"wait"` so a gate
that asks a server has settled before the probe. `references/visual-debug.md`,
section "Gated pages and game screens". Run on the live site into the test
room (2026-09-25): 4 text elements on the lock, 77 on the board behind it,
`#main` visible, and the key nowhere in the results. Without the wait the
same run found the board still shut 200 ms after Enter.

**Regression check.** `test/field-tests.test.mjs`, "a key screen can be typed through, and the key never reaches the report (HQ)"

### HQ-5. A display face on panel titles, and serif on every control

**What happened.** Gev's review of the first version, points 1 and 2: "The
chunky display font is on every panel title. 'Whiteboard,' 'RideLink,' and
'To do' at that small size read as yellow blobs. That font only works big."
And: "Serif font on buttons and controls. Serif works for the big clock, but
on small buttons, tags and links it looks like a Word doc."

**What UFS said or did.** The house style is editorial serif typography, and
nothing in UFS separated a website's display type from a tool's controls.
(The display face on every heading was also a standing instruction for
RideLink work; UFS had no rule to push back with.)

**What it should have said or done.** On a dashboard: the display face on the
wordmark only, a bold sans for panel titles, a crisp sans for every control;
serif only for display moments like a big clock or number.

**The UFS fix.** This change: `references/apps.md`, section "Dashboards:
nine things Gev's review of HQ caught", items 1 and 2, routed from the app
row of SKILL.md.

**Regression check.** Not testable automatically: which face counts as
"display" and which size is "small" for it is a judgement per face; a rule on
font names would be wrong for most of them.

### HQ-6. Every panel equally loud, the wrong one biggest, and too many

**What happened.** Review points 3, 4, 6, 8 and 9: the same border on every
panel so "nothing stands out"; the whiteboard "takes up most of the screen"
while the to-do list is squeezed; a double logo ("H HQ"); "9+ panels ...
That's a junk drawer, not an HQ"; and a button labelled "Gev" that "nobody
can tell" is a user or a setting.

**What UFS said or did.** Nothing about dashboards; `references/apps.md` was
a corpus of shipped apps and the app tells.

**What it should have said or done.** Name the panel the page exists for and
give only it the accent; size follows daily use; one logo; everything not
checked daily goes behind one drawer; labels say what they are.

**The UFS fix.** This change: `references/apps.md`, section "Dashboards: nine
things Gev's review of HQ caught", items 3, 4, 6, 8 and 9.

**Regression check.** Not testable automatically: importance, daily use and
label clarity are product judgements; a count of panels or borders would
fail good dashboards as often as bad ones.

### HQ-7. A five-row task input and a cut-off date box

**What happened.** Review point 5: "Input, 3 dropdowns, and an Add button on
its own row, plus 2 rows of filter chips. That's about 5 rows before you see
a single task ... The native date box shows a cut-off 'mm/dd/y:', which looks
broken."

**What UFS said or did.** Nothing on inputs. The render check could not see
the date box: the field is in the shadow DOM, so its `scrollWidth` equals
its width even when it is cut short (measured: 71 and 71 for a date input
squeezed to 70 px).

**What it should have said or done.** One-line input, Enter adds, tag and
date as inline icons; and report a date, time or select control narrower than
what it shows.

**The UFS fix.** This change: `references/apps.md`, section "Dashboards: nine
things Gev's review of HQ caught", item 5, and a probe in scripts/inspect.mjs
that measures a hidden twin of each date, time and select control at its
natural width (a select judged on the option it shows) and warns "control cut
short"; a button is reported only when it clips its own label.

**Regression check.** `test/field-tests.test.mjs`, "a native date field squeezed below its own width is reported; one at its width is not (HQ)"

### HQ-8. Empty panels made the board look dead

**What happened.** Review point 7: "Socials say 'Nothing logged yet,' Gmail
says 'Connect Google,' and there's a weather prompt. An empty dashboard looks
dead. Hide panels until they have data."

**What UFS said or did.** `references/apps.md` said empty states should be
"written for the actual thing that is empty"; it did not say a dashboard
panel with nothing in it should not be there.

**What it should have said or done.** A panel appears when it has data or a
connection; one Connect button replaces several empty panels.

**The UFS fix.** This change: `references/apps.md`, section "Dashboards: nine
things Gev's review of HQ caught", item 7.

**Regression check.** Not testable automatically: an empty state is right on
a first run of most screens; whether a panel should be hidden instead is a
product decision the page cannot state.

### HQ-9. The build brief would have been served at /docs/LAB-BRIEF.md

**What happened.** The Lab's build brief sat in `docs/`. HQ deploys its repo
root, and `.vercelignore` listed `bridge/`, `tests/`, `NOTES.md` and logs but
not `docs/`, so the brief, with database project ids and the backend's
design, would have been public. Caught by hand while writing the brief.

**What UFS said or did.** `webdesign.mjs security` read only source
extensions, so a markdown file was invisible to it, and it did not read
`.vercelignore`, so it also reported on files Vercel never deploys.

**What it should have said or done.** Name notes and logs that would be
served, and judge only what the host will deploy.

**The UFS fix.** This change: `.md`, `.markdown` and `.log` files in the site
folder are a low finding, and `.vercelignore` is honoured (names, anchored
paths, folders, globs; negation lines are skipped, so it can only check more
files than Vercel deploys, never fewer). `references/pipeline.md`, section
"9. Ship". On D:/gev-hq today it reports none of either: `docs/` is now in
its ignore file.

**Regression check.** `test/security.test.mjs`, "notes in the site folder are found, and what .vercelignore keeps out is not (HQ)"

### HQ-10. The Lab's tests had to copy UFS's canvas patch by hand

**What happened.** The Lab's pixel checks need WebGL drawing buffers kept
readable before the page runs. UFS does exactly that with `CANVAS_INIT`, but
did not export it, so the brief told the Lab to copy it ("the same patch
inspect.mjs uses (CANVAS_INIT, which it does not export)").

**What UFS said or did.** `findBrowser`, `launch` and `Session` were
exported; the one piece a WebGL test needs was private.

**What it should have said or done.** Export it, and say in the three.js
reference that it is there.

**The UFS fix.** This change: `export const CANVAS_INIT` in
scripts/inspect.mjs; `references/three.md`, section "11. Field notes from
HQ's Lab".

**Regression check.** `test/field-tests.test.mjs`, "CANVAS_INIT is exported, so a project suite can read WebGL pixels the way inspect does (HQ)"

### HQ-11. The Lab brief's three.js findings

**What happened.** Writing the Lab brief against the vendored three r186
turned up four things: the first plan would have loaded a second three.js
(0.170 from jsDelivr beside the vendored r186), which downloads twice and
makes three warn "Multiple instances of Three.js being imported."; a sheen
slider does nothing because `sheenColor` defaults to black; a still material
viewer should render on demand; and shared shaders can hang the GPU and lose
the context.

**What UFS said or did.** `references/three.md` covered `thickness` and tone
mapping but not one-instance loading, the black `sheenColor`, or context
loss.

**What it should have said or done.** Say all four where a three.js page is
planned.

**The UFS fix.** This change: `references/three.md`, section "11. Field notes
from HQ's Lab". `sheenColor=new Color(0)` and the warning string were checked
in HQ's vendored three.core.js; the site-wide WebGL block after repeated
context losses is the brief's account and is marked UNVERIFIED there.

**Regression check.** Not testable automatically: a second three.js already
shows up in the render check as a `warn console:` line (the render check
reports console warnings), but a dedicated fixture would need two three.js
builds vendored into the test tree; the other three are material and
shader-author choices.

### HQ-12. HQ probed for WebGL before drawing; UFS's own render check did not

**What happened.** HQ's key screen loads a three.js gold key, and its
`key3d.js` asks for a WebGL2 context on a throwaway canvas first: if there is
none it returns and the key screen stands on its own with nothing in the
console, and if there is one it releases the probe with `WEBGL_lose_context`
before building the renderer (read back from D:/gev-hq/key3d.js, read-only).
UFS's render check had no such probe. On the windows-latest CI runner, which
has no GPU, the browser's WebGL context was lost as soon as it was made, and
a correctly drawn two-colour game canvas read back as a flat fill. The 6.5.0
Windows job failed on every push from fcb96b3 to df4b7c5 (runs 36208761961,
36209230456, 36209682631, 36209979300) while Ubuntu passed.

**What UFS said or did.** The render check reported the page as having
"rendered a flat fill", a false finding against the page for what was the
browser's failure, and it would have said the same to anyone checking a page
on a VM, a CI runner or a remote desktop. Three fixes to the test fixture
(f9bc58c, e2bd1e3, df4b7c5) changed nothing, because the fixture was never
the problem. `references/three.md` told a page to probe `getContext('webgl2')`
before committing to 3D, and the checker did not do it for itself.

**What it should have said or done.** Test WebGL on the browser it launched,
the way HQ's page does, and tell three cases apart: the page drew one colour,
the page lost its own context, and this browser has no working WebGL at all.
Only the first is a finding against the page. When the GPU path is dead, try
the software renderer before giving up.

**The UFS fix.** e3c39ca and 213c8d2: `launchRendering()` in
`scripts/inspect.mjs` tests WebGL on the fresh browser without writing to the
page's console, and relaunches with `SOFTWARE_WEBGL` (SwiftShader) only when
it is dead; the report says when WebGL ran in software, a page that loses its
own context is told so, and with no WebGL anywhere a canvas is a note naming
the browser. The Windows job has been green since (run 36216733416 on
5480e0d, both runners). The practice, for the checker and for pages, is in
`references/visual-debug.md`, section "A machine with no GPU".

**Regression check.** `test/field-tests.test.mjs`, "the game world reads as two colours in a browser with the GPU switched off"
and `test/field-tests.test.mjs`, "a browser whose WebGL is dead is relaunched on the software renderer, and says so"
and `test/field-tests.test.mjs`, "a page that loses its own WebGL context is told so, not told it drew a flat fill"
and `test/field-tests.test.mjs`, "with no WebGL anywhere, a lost canvas is a note naming the browser, never a warning against the page".

## What held up

Gev's review opened with what worked: "The black-and-yellow palette is
consistent and the whole thing feels like yours, not a template", "The big
clock and date in the header look good", and "The 3-column layout is the right
basic structure." Those are kept in the Dashboards section as the things to
keep.
