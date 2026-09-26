/* The copy tells copy-tells.md marks as scannable, checked against fixture
   strings. The audit is pure - it reads files and returns findings - so these
   run with no browser and finish in milliseconds. Each test writes one page
   into a temp directory and asserts only on the finding it is about; the rest
   of the audit's output for that page is not the subject. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAudit } from '../scripts/audit.mjs';

function page(body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width"><title>Fixture</title>
<meta name="description" content="A fixture page for the audit's copy checks, long enough to pass the length check.">
<style>@media (prefers-reduced-motion: reduce) { * { animation: none } }</style>
</head><body><main><section><h1>Heading</h1>${body}</section></main></body></html>`;
}

function auditOf(body) {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-audit-'));
  try {
    writeFileSync(join(dir, 'index.html'), page(body));
    return runAudit(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const warns = (r) => r.findings.filter((f) => f.level === 'warn').map((f) => f.text);
const errors = (r) => r.findings.filter((f) => f.level === 'error').map((f) => f.text);

test('banned button text is a warning, and a named action is not', () => {
  const hit = auditOf('<a class="btn" href="/x">Get Started</a><button>Learn more</button><button>Discover</button>');
  const found = warns(hit).filter((t) => /button text/.test(t));
  assert.equal(found.length, 1, warns(hit).join('\n'));
  assert.match(found[0], /"Get Started"/);
  assert.match(found[0], /\+2 more/);
  assert.ok(!errors(hit).some((t) => /button text/.test(t)), 'a warning, not an error');
  const clean = auditOf('<a class="btn" href="/x">Book a survey</a><button>Send the brief</button>');
  assert.ok(!warns(clean).some((t) => /button text/.test(t)));
  // The words are only a tell on a button. Prose may say "explore".
  const prose = auditOf('<p>Explore the archive; discover the 1962 catalogue.</p>');
  assert.ok(!warns(prose).some((t) => /button text/.test(t)));
});

test('"no X, no Y, just Z" is caught beside "not just X, it\'s Y"', () => {
  const r = auditOf('<p>No fluff, no filler, just results.</p><p>Not just a tool, it\'s a partner.</p>');
  assert.ok(warns(r).some((t) => /no X, no Y, just Z/.test(t)), warns(r).join('\n'));
  assert.ok(warns(r).some((t) => /not just X/.test(t)));
  const clean = auditOf('<p>No parking on the north side; the lot is behind the mill.</p>');
  assert.ok(!warns(clean).some((t) => /no X, no Y, just Z/.test(t)));
});

test('copula substitutes warn above three per page, not at three', () => {
  const four = auditOf('<p>The mill serves as a hub. The tower stands as a landmark. The bridge represents the town. The plan boasts detail.</p>');
  const hit = warns(four).filter((t) => /copula substitutes/.test(t));
  assert.equal(hit.length, 1, warns(four).join('\n'));
  assert.match(hit[0], /4 /);
  const three = auditOf('<p>The mill serves as a hub. The tower stands as a landmark. The bridge represents the town.</p>');
  assert.ok(!warns(three).some((t) => /copula substitutes/.test(t)), 'three is the threshold, not a hit');
});

test('a leaked refusal is reported, as a warning', () => {
  const r = auditOf('<p>Unfortunately I do not have enough information to summarize further.</p>');
  const hit = warns(r).filter((t) => /leaked model refusal/.test(t));
  assert.equal(hit.length, 1, warns(r).join('\n'));
  assert.ok(!errors(r).some((t) => /leaked/.test(t)));
  const r2 = auditOf('<p>As an AI language model I cannot browse.</p>');
  assert.ok(warns(r2).some((t) => /leaked model refusal/.test(t)));
});

test('the 2026 emphasis phrases are marketing filler; "delve into" no longer is', () => {
  const r = auditOf('<p>This is a testament to the craft. It plays a crucial role. It marks a turning point and sets the stage for an ever-evolving practice.</p>');
  const hit = warns(r).filter((t) => /marketing filler/.test(t));
  assert.equal(hit.length, 1, warns(r).join('\n'));
  assert.match(hit[0], /"is a testament to"/);
  assert.match(hit[0], /\+4 more/);
  const stale = auditOf('<p>We delve into the archive every winter.</p>');
  assert.ok(!warns(stale).some((t) => /marketing filler/.test(t)), 'the 2023 word is not fought again');
});

test('a page with none of it produces none of these warnings', () => {
  const r = auditOf('<p>The kiln runs at 1,260 degrees for eleven hours. Firing dates are on the notice board.</p><a class="btn" href="/visit">Plan a visit</a>');
  const ours = warns(r).filter((t) => /button text|no X, no Y|copula substitutes|leaked model refusal|marketing filler/.test(t));
  assert.deepEqual(ours, []);
});

/* The violet CTA is the second-highest-weighted tell and the check was a hex
   scan, so it saw a generated page from 2023 and nothing at all from one built
   today: Tailwind v4 and the current shadcn/ui scaffold write their tokens as
   oklch(), and the generation before wrote bare HSL triples. Same colour, three
   notations. Matched by colour, never by a hue band - a band would fail a
   designer who genuinely chose violet. */
const colourHits = (body) => errors(auditOf(body)).filter((t) => /generated-page colour/.test(t));

test('the generated violet is caught in oklch and hsl, not only in hex', () => {
  // #6366f1 itself, written the four ways a scaffold writes it.
  assert.equal(colourHits('<style>.b{background:#6366f1}</style>').length, 1);
  assert.match(colourHits('<style>.b{background:oklch(58.5% 0.204 277.1)}</style>')[0], /oklch\(58\.5% 0\.204 277\.1\) \(= #6366f1\)/);
  // Lightness given 0-1 rather than as a percentage, which is the form the
  // shadcn scaffold actually emits.
  assert.equal(colourHits('<style>.b{background:oklch(0.586 0.2 277)}</style>').length, 1);
  assert.match(colourHits('<style>.b{background:hsl(239, 84%, 67%)}</style>')[0], /\(= #6366f1\)/);
  // The bare triple, legal only inside the hsl() the framework wraps round it.
  assert.match(colourHits('<style>:root{--primary: 262 83% 58%;}</style>')[0], /\(= #7c3aed\)/);
});

test('a colour that is merely violet, and the house accent, are not the tell', () => {
  // Deliberately close enough to prove the check is a colour match and not a
  // "purple is banned" rule: same family, nobody's default.
  assert.deepEqual(colourHits('<style>.b{background:oklch(40% 0.19 300)}</style>'), []);
  assert.deepEqual(colourHits('<style>.b{background:hsl(210, 60%, 40%)}</style>'), []);
  // The chassis itself, which lives in hue 28-150 and must never fail its own
  // audit.
  assert.deepEqual(colourHits('<style>.b{background:oklch(58% 0.072 62)}</style>'), []);
  assert.deepEqual(colourHits('<style>.b{background:oklch(48% 0.14 28)}</style>'), []);
});

test('a hand gamma-encode ahead of UnrealBloomPass is a warning until the output colour space or OutputPass settles it (Doodle Voyager)', () => {
  // The shape of js/render.js at d3aa89b, before fc25a40 set LinearSRGBColorSpace.
  const render = [
    "import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';",
    'const POST_FS = `vec3 toS(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }`;',
    'this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.45, 0.85);',
  ].join('\n');
  const run = (js) => {
    const dir = mkdtempSync(join(tmpdir(), 'ufs-audit-gamma-'));
    try {
      writeFileSync(join(dir, 'index.html'), page('<p>Game</p>'));
      writeFileSync(join(dir, 'render.js'), js);
      return warns(runAudit(dir)).filter((t) => /gamma-encodes by hand/.test(t));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  assert.equal(run(render).length, 1);
  assert.equal(run(render + '\nthis.gl.outputColorSpace = THREE.LinearSRGBColorSpace;').length, 0);
  assert.equal(run(render + "\nimport { OutputPass } from 'three/addons/postprocessing/OutputPass.js';").length, 0);
  assert.equal(run(render.replaceAll('UnrealBloomPass', 'AfterimagePass')).length, 0, 'no bloom, no second encode');
});

// Both fixtures below are the shape of the game's own files at 66a08be, read
// back on 2026-09-25: js/game.js keeps `shake: true` and sets `this.shake`,
// js/render.js draws a camera motion blur, and the reduced-motion rules are a
// stylesheet block and CSS text that js/media.js injects for a video card.
function runJs(files, html = '<p>Game</p>') {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-audit-game-'));
  try {
    writeFileSync(join(dir, 'index.html'), page(html));
    for (const [name, js] of Object.entries(files)) writeFileSync(join(dir, name), js);
    return warns(runAudit(dir));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('camera shake or motion blur with no matchMedia read of reduced motion is a warning (Doodle Voyager)', () => {
  const game = 'const defaults = { fov: 72, shake: true };\nthis.shake = Math.max(this.shake || 0, 0.14);';
  const render = '// Camera motion blur. Every pixel is reprojected along its motion.\nthis.motion.uniforms.strength.value = q.blur;';
  const media = "const css = '@media (prefers-reduced-motion:reduce){.mp-card{animation:none}}';";
  const hit = (w) => w.filter((t) => /never reads prefers-reduced-motion with matchMedia/.test(t));
  assert.equal(hit(runJs({ 'game.js': game, 'render.js': render, 'media.js': media })).length, 1, 'CSS text inside a script does not reach the loop');
  assert.equal(hit(runJs({ 'render.js': render })).length, 1, 'motion blur alone is enough');
  assert.equal(hit(runJs({ 'game.js': game, 'prefs.js': "const reduce = matchMedia('(prefers-reduced-motion: reduce)');" })).length, 0);
  assert.equal(hit(runJs({ 'app.js': "el.addEventListener('click', () => el.classList.add('open'));" })).length, 0, 'no screen effect, nothing to say');
  assert.equal(hit(runJs({ 'cam.js': 'this.cameraShake = 0.2;' })).length, 1, 'a camelCase name is still a shake');
  assert.equal(hit(runJs({ 'net.js': 'const handshake = await peer.connect();' })).length, 0, 'a network handshake is not a screen effect');
});

test('a sounding media element outside the AudioContext mix is a warning; a muted or routed one is not (Doodle Voyager)', () => {
  const audio = 'const AC = window.AudioContext || window.webkitAudioContext;\nG.duck = gain(1);\nG.music.connect(G.duck);';
  const screen = "const v = this.video = document.createElement('video');\nv.volume = this._volume;";
  const thumb = "const t = document.createElement('video');\nt.muted = true;";
  const hit = (w) => w.filter((t) => /plays outside it/.test(t));
  assert.equal(hit(runJs({ 'audio.js': audio, 'media.js': thumb + '\n' + screen })).length, 1, 'one muted thumbnail does not excuse the sounding screen');
  assert.equal(hit(runJs({ 'audio.js': audio, 'media.js': thumb })).length, 0, 'every element muted');
  assert.equal(hit(runJs({ 'audio.js': audio + '\nctx.createMediaElementSource(v).connect(G.music);', 'media.js': screen })).length, 0, 'routed into the mix');
  assert.equal(hit(runJs({ 'media.js': screen })).length, 0, 'no AudioContext, no mix to bypass');
  assert.equal(hit(runJs({ 'audio.js': audio }, '<video src="intro.mp4" autoplay></video>')).length, 1, 'an HTML element with sound counts too');
  assert.equal(hit(runJs({ 'audio.js': audio }, '<video src="loop.mp4" autoplay muted loop></video>')).length, 0);
});
