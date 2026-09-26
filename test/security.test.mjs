import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { securityAudit, formatSecurity, headersConfig, cspPolicies, parseCsp, cspAllows, loadedUrls, vercelIgnore } from '../scripts/security.mjs';

function site(files) {
  const dir = mkdtempSync(join(tmpdir(), 'security-'));
  for (const [name, text] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, text);
  }
  return dir;
}
const texts = (r, level) => r.findings.filter((f) => !level || f.level === level).map((f) => f.text);

test('a leaked live key is high, and the fix says rotate', () => {
  // Assembled here so no key-shaped literal is ever committed (GitHub push
  // protection reads the diff); the fixture on disk is contiguous.
  const dir = site({ 'app.js': 'const stripe = "' + 'sk_live_' + 'x'.repeat(24) + '";' });
  try {
    const r = securityAudit(dir);
    assert.ok(texts(r, 'high').some((t) => /Stripe live secret key/.test(t)));
    assert.match(r.findings[0].fix, /ROTATE/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a publishable key, a content hash and a data URI are not secrets', () => {
  const dir = site({ 'index.html': '<script>const pk="pk_live_51H1234567890abcdefghijklmnop";</script><img src="data:image/png;base64,' + 'A'.repeat(200) + '"><script src="https://cdn.example.com/x.js" integrity="sha384-' + 'B'.repeat(64) + '" crossorigin="anonymous"></script>' });
  try {
    const r = securityAudit(dir);
    assert.equal(texts(r, 'high').length, 0, JSON.stringify(r.findings));
    assert.ok(!texts(r).some((t) => /Stripe/.test(t)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('files that must never ship are found by their presence alone', () => {
  const dir = site({ '.env': 'SECRET=1', 'main.js.map': '{}', 'index.html': '<h1>x</h1>' });
  try {
    const r = securityAudit(dir);
    assert.ok(texts(r, 'high').some((t) => /environment file/.test(t)));
    assert.ok(texts(r, 'medium').some((t) => /source map/.test(t)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a form that sends personal data over GET, to http, with no privacy link, is three findings', () => {
  const dir = site({ 'index.html': '<form action="http://example.com/send"><input type="email" name="e"><button>Go</button></form>' });
  try {
    const t = texts(securityAudit(dir));
    assert.ok(t.some((x) => /personal data with GET/.test(x)));
    assert.ok(t.some((x) => /posts to plain http/.test(x)));
    assert.ok(t.some((x) => /links no privacy policy/.test(x)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a correct form raises nothing about itself', () => {
  const dir = site({ 'index.html': '<a href="/privacy">Privacy</a><form method="post" action="https://example.com/send" data-netlify="true" netlify-honeypot="bot-field"><input type="email" name="e"></form>' });
  try {
    assert.equal(texts(securityAudit(dir)).filter((x) => /form/i.test(x)).length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CDN scripts are pinned or flagged; font CSS is exempt from integrity; import maps want an integrity block', () => {
  const dir = site({ 'index.html': [
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader">',
    '<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>',
    '<script src="https://cdn.jsdelivr.net/npm/lenis@1.3.26/dist/lenis.min.js" integrity="sha384-abc"></script>',
    '<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js"}}</script>',
  ].join('\n') });
  try {
    const t = texts(securityAudit(dir));
    assert.ok(t.some((x) => /without a usable integrity hash/.test(x)));
    assert.ok(t.some((x) => /integrity without crossorigin/.test(x)));
    assert.ok(t.some((x) => /import map.*no "integrity"/.test(x)));
    assert.ok(t.some((x) => /fonts served from Google/.test(x)));
    assert.ok(!t.some((x) => /stylesheet from fonts\.googleapis\.com without integrity/.test(x)), 'font CSS cannot carry a hash and must not be asked to');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('client-side holes: innerHTML from a variable, postMessage to *, an unchecked message listener, mixed content', () => {
  const dir = site({ 'index.html': '<img src="http://example.com/a.png"><svg xmlns="http://www.w3.org/2000/svg"></svg><a target="_blank" href="/x">x</a><button onclick="go()">go</button>',
    'app.js': 'el.innerHTML = location.hash; el.innerHTML = "<b>ok</b>"; window.postMessage(data, "*"); addEventListener("message", (e) => { use(e.data); });' });
  try {
    const t = texts(securityAudit(dir));
    assert.equal(t.filter((x) => /innerHTML assigned from a non-literal/.test(x)).length, 1, 'the literal assignment is fine');
    assert.ok(t.some((x) => /postMessage to any origin/.test(x)));
    assert.ok(t.some((x) => /message listener with no origin check/.test(x)));
    assert.equal(t.filter((x) => /plain-http resource/.test(x)).length, 1, 'the xmlns is a namespace, not a fetch');
    assert.ok(t.some((x) => /target="_blank" without rel="noopener"/.test(x)));
    assert.ok(t.some((x) => /inline event handler/.test(x)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a message listener that checks the origin is not flagged', () => {
  const dir = site({ 'app.js': 'addEventListener("message", (e) => { if (e.origin !== "https://a.example") return; use(e.data); });' });
  try {
    assert.ok(!texts(securityAudit(dir)).some((x) => /message listener/.test(x)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('header configuration is read from netlify.toml and each missing header is named', () => {
  const dir = site({ 'index.html': '<h1>x</h1>', 'netlify.toml': '[[headers]]\n  for = "/*"\n  [headers.values]\n    X-Content-Type-Options = "nosniff"\n' });
  try {
    const cfg = headersConfig(dir);
    assert.equal(cfg.nosniff, true);
    assert.equal(cfg.csp, false);
    const t = texts(securityAudit(dir));
    assert.ok(t.some((x) => /no Content-Security-Policy/.test(x)));
    assert.ok(t.some((x) => /nothing forbids framing/.test(x)));
    assert.ok(!t.some((x) => /nosniff/.test(x)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('no header configuration at all is one finding, not six', () => {
  const dir = site({ 'index.html': '<h1>x</h1>' });
  try {
    const t = texts(securityAudit(dir)).filter((x) => /header/i.test(x));
    assert.equal(t.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the report exits on high only and always lists the live checks', () => {
  const dir = site({ 'index.html': '<h1>clean</h1>', 'netlify.toml': '[[headers]]\n for="/*"\n [headers.values]\n Content-Security-Policy="frame-ancestors \'none\'"\n Strict-Transport-Security="max-age=1"\n X-Content-Type-Options="nosniff"\n Referrer-Policy="no-referrer"\n Permissions-Policy="camera=()"\n' });
  try {
    const shown = formatSecurity(securityAudit(dir), 'clean');
    assert.equal(shown.high, 0);
    assert.match(shown.text, /\.git\/HEAD/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Third pass, two skeptics each. The attribute being present is not the same
// as the subresource being pinned.
test('an integrity attribute that is empty or not a hash is not a pin', () => {
  const dir = site({ 'index.html': [
    '<script src="https://cdn.jsdelivr.net/npm/a@1/a.js" integrity="" crossorigin="anonymous"></script>',
    '<script src="https://cdn.jsdelivr.net/npm/b@1/b.js" integrity="notahash" crossorigin="anonymous"></script>',
    '<script src="https://cdn.jsdelivr.net/npm/c@1/c.js" integrity="sha384-' + 'A'.repeat(32) + '" crossorigin="anonymous"></script>',
  ].join('\n') });
  try {
    const t = texts(securityAudit(dir)).filter((x) => /usable integrity/.test(x));
    assert.equal(t.length, 2, 'the empty and the garbage one, not the real hash');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The commonest way anyone writes an injection was the one form it could not see.
test('a template literal with interpolation is an injection; without it, it is a literal', () => {
  const dir = site({ 'app.js': 'el.innerHTML = `<div>Hello ${userName}</div>`; other.innerHTML = `<b>static</b>`;' });
  try {
    const t = texts(securityAudit(dir)).filter((x) => /innerHTML/.test(x));
    assert.equal(t.length, 1, JSON.stringify(t));
    assert.match(t[0], /template literal with interpolation/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a secret under a quoted JSON key is a finding, not a note', () => {
  const dir = site({ 'config.json': '{\n  "authToken": "abcdefghijklmnopqrstuvwxyz012345"\n}\n' });
  try {
    const r = securityAudit(dir);
    assert.ok(texts(r, 'medium').some((x) => /secret-shaped value/.test(x)), JSON.stringify(r.findings));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* Field test: Doodle Voyager, 2026-09-25 (docs/field-tests/doodle-voyager.md,
   lesson DV-8). The shapes below are the game's own: the staged _headers
   policy from tools/stage.mjs before commit c76f025, and net.js's
   PROJECT constant, esm.sh import and Realtime channel. */
const DV_BEFORE_CSP = "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'sha256-AAAA'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://cdn.jsdelivr.net blob:; frame-ancestors 'none'";
const DV_AFTER_CSP = "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'sha256-AAAA'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://cdn.jsdelivr.net https://cafodiocsvzgeninsjzi.supabase.co wss://cafodiocsvzgeninsjzi.supabase.co blob:; frame-ancestors 'none'";
const DV_NET_BEFORE = [
  "export const PROJECT = 'https://cafodiocsvzgeninsjzi.supabase.co';",
  'export async function realtimeTransport(room) {',
  "  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');",
  '  const client = createClient(PROJECT, KEY, { realtime: { params: { eventsPerSecond: 20 } } });',
  '  return client.channel(room);',
  '}',
].join('\n');
const DV_NET_AFTER = DV_NET_BEFORE.replace("await import('https://esm.sh/@supabase/supabase-js@2')", 'await import(SUPABASE_JS)')
  .replace("export const PROJECT", "export const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';\nexport const PROJECT");
const headersFile = (csp) => '/*\n  Content-Security-Policy: ' + csp + '\n  X-Content-Type-Options: nosniff\n';

test('a CSP that refuses the code\'s own client library and Realtime host is high; the fixed policy is clean (Doodle Voyager)', () => {
  const before = site({ 'index.html': '<h1>x</h1>', 'js/net.js': DV_NET_BEFORE, '_headers': headersFile(DV_BEFORE_CSP) });
  const after = site({ 'index.html': '<h1>x</h1>', 'js/net.js': DV_NET_AFTER, '_headers': headersFile(DV_AFTER_CSP) });
  try {
    const hits = securityAudit(before).findings.filter((f) => /Content-Security-Policy .* refuses/.test(f.text));
    const said = hits.map((f) => f.text).join('\n');
    assert.ok(hits.every((f) => f.level === 'high'), said);
    assert.ok(hits.some((f) => /script-src refuses https:\/\/esm\.sh/.test(f.text) && f.line === 3), said);
    assert.ok(hits.some((f) => /connect-src refuses https:\/\/cafodiocsvzgeninsjzi\.supabase\.co/.test(f.text)), said);
    assert.ok(hits.some((f) => /connect-src refuses wss:\/\/cafodiocsvzgeninsjzi\.supabase\.co/.test(f.text)), said);
    assert.equal(hits.length, 3, said);
    const clean = securityAudit(after).findings.filter((f) => /refuses/.test(f.text));
    assert.deepEqual(clean, []);
  } finally { rmSync(before, { recursive: true, force: true }); rmSync(after, { recursive: true, force: true }); }
});

test('CSP matching follows the spec where it matters: paths, wildcards, schemes, default-src and strict-dynamic', () => {
  const p = (v) => parseCsp(v);
  // A path-scoped source allows only what sits under that path.
  assert.equal(cspAllows(p("script-src https://cdn.jsdelivr.net/npm/three@0.170.0/"), 'script', 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js').allowed, true);
  assert.equal(cspAllows(p("script-src https://cdn.jsdelivr.net/npm/three@0.170.0/"), 'script', 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js').allowed, false);
  // *.host covers subdomains, and an https source does not cover wss.
  assert.equal(cspAllows(p('connect-src https://*.supabase.co'), 'connect', 'https://abc.supabase.co/rest/v1/x').allowed, true);
  assert.equal(cspAllows(p('connect-src https://*.supabase.co'), 'connect', 'wss://abc.supabase.co/realtime').allowed, false);
  assert.equal(cspAllows(p('connect-src wss:'), 'connect', 'wss://abc.supabase.co/realtime').allowed, true);
  // default-src governs when the specific directive is absent; no policy for
  // the kind means no restriction; strict-dynamic is not judged.
  assert.equal(cspAllows(p("default-src 'self'"), 'connect', 'https://api.example.com/').allowed, false);
  assert.equal(cspAllows(p("style-src 'self'"), 'connect', 'https://api.example.com/').allowed, true);
  assert.equal(cspAllows(p("script-src 'nonce-x' 'strict-dynamic'"), 'script', 'https://esm.sh/x').allowed, true);
  // Only URLs that resolve exactly are judged: an unknown variable is not.
  assert.deepEqual(loadedUrls('const u = await import(someUrl); fetch(`${base}/x`);'), []);
  assert.deepEqual(loadedUrls("const HOST = 'api.example.com'; fetch(`https://${HOST}/v1`);").map((u) => u.url), ['https://api.example.com/v1']);
  // vercel.json and netlify.toml are both read.
  const dir = site({ 'vercel.json': JSON.stringify({ headers: [{ source: '/(.*)', headers: [{ key: 'Content-Security-Policy', value: "script-src 'self'" }] }] }), 'netlify.toml': '[[headers]]\n  for = "/*"\n  [headers.values]\n    Content-Security-Policy = "connect-src \'self\'"\n' });
  try { assert.deepEqual(cspPolicies(dir).sort(), ["connect-src 'self'", "script-src 'self'"]); } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('notes in the site folder are found, and what .vercelignore keeps out is not (HQ)', () => {
  // HQ, 2026-09-24: .vercelignore listed bridge/ and tests/ but not docs/, so
  // the build brief would have been served at /docs/LAB-BRIEF.md.
  const dir = site({
    'index.html': '<h1>x</h1>',
    'docs/LAB-BRIEF.md': '# brief',
    'tests/run.mjs': "const key = 'x';",
    'bridge/room-key.txt': 'k',
    'debug.log': 'x',
    '.vercelignore': 'bridge/\ntests/\n*.log\n.vercel\n',
  });
  try {
    const r = securityAudit(dir);
    const notes = r.findings.filter((f) => /notes or log file/.test(f.text)).map((f) => f.file.replace(/\\/g, '/'));
    assert.deepEqual(notes, ['docs/LAB-BRIEF.md']);
    assert.ok(!r.findings.some((f) => /^(tests|bridge)[\\/]/.test(f.file || '')), JSON.stringify(r.findings));
    const ignored = vercelIgnore(dir);
    assert.equal(ignored('tests/run.mjs'), true);
    assert.equal(ignored('docs/LAB-BRIEF.md'), false);
    assert.equal(ignored('bridge'), false, 'a folder rule does not match a file of the same name');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a deploy link to a project named like a build folder is reported, and the real one is named (Doodle Voyager)', () => {
  // stage.mjs emptied dist/, .vercel included, and the next deploy created a
  // project called "dist" instead of updating doodle-voyager - twice.
  const stray = site({ 'index.html': '<h1>x</h1>', '.vercel/project.json': JSON.stringify({ projectId: 'prj_x', orgId: 'team_x', projectName: 'dist' }) });
  const real = site({ 'index.html': '<h1>x</h1>', '.vercel/project.json': JSON.stringify({ projectId: 'prj_y', orgId: 'team_x', projectName: 'doodle-voyager' }) });
  try {
    const bad = securityAudit(stray);
    assert.ok(bad.findings.some((f) => f.level === 'medium' && /Vercel project named "dist"/.test(f.text)), JSON.stringify(bad.findings));
    const good = securityAudit(real);
    assert.ok(!good.findings.some((f) => /Vercel project named/.test(f.text)));
    assert.match(formatSecurity(good, 'x').text, /deploys to Vercel project doodle-voyager/);
  } finally { rmSync(stray, { recursive: true, force: true }); rmSync(real, { recursive: true, force: true }); }
});

test('a commented-out load is not judged, and an absolute URL on the site\'s own canonical origin counts as self', () => {
  assert.deepEqual(loadedUrls("// was: await import('https://esm.sh/x')\n/* fetch('https://api.example.com/') */\n * fetch('https://b.example.com/')"), []);
  const dir = site({
    'index.html': '<link rel="canonical" href="https://www.example.org/"><h1>x</h1><script src="app.js"></script>',
    'app.js': "fetch('https://www.example.org/api/items');\nfetch('https://elsewhere.example.net/');",
    '_headers': "/*\n  Content-Security-Policy: default-src 'self'; connect-src 'self'\n",
  });
  try {
    const hits = securityAudit(dir).findings.filter((f) => /refuses/.test(f.text)).map((f) => f.text);
    assert.equal(hits.length, 1, hits.join('\n'));
    assert.match(hits[0], /elsewhere\.example\.net/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
