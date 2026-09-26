/* The audit is the gate scaffold-website.md promises: after a scaffold, rewrite
   every word, and the audit must exit 0. It used to know 19 phrases, so a page
   that rewrote exactly those 19 passed with the <title>'s "one clause that says
   what this is", the meta description's instructions, alt="Description of the
   object" and a dozen more sentences still on it (judge round 1, 2026-09-26).

   The list now comes from the section library itself: every piece of scaffold
   copy in assets/sections.html is marked [[like this]], the scaffolder strips
   the marks, and the audit reads them back out of the library. These tests
   scaffold every section, then take each marked sentence alone - every other
   one rewritten - and require the audit to name it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAudit, libraryCopy } from '../scripts/audit.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'scripts', 'webdesign.mjs');
const library = readFileSync(join(root, 'skills/ultimate-frontend-skills/assets/sections.html'), 'utf8');
const ids = [...library.matchAll(/@section\s+([\w-]+)\s*\|/g)].map((m) => m[1]);
const heroes = ids.filter((id) => id.startsWith('hero-'));
// Everything but the heroes (one per page), the parts the scaffolder places
// itself, and nav/footer, which go first and last.
const middle = ids.filter((id) => !id.startsWith('hero-') && !['head', 'foot', 'not-found', 'nav', 'footer'].includes(id));

const copyFindings = (r) => r.findings.filter((f) => /scaffold copy/.test(f.text)).map((f) => f.text);

// One scaffold per hero, each with every other section in the library, so
// every block the scaffolder can emit is on some page.
function scaffoldAll() {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-scaffold-copy-'));
  const pages = [];
  // The caller removes dir in its finally, but only once this returns: a
  // scaffold that fails here has to take the folder with it.
  try {
    for (const hero of heroes) {
      const out = join(dir, hero);
      const made = spawnSync(process.execPath, [cli, 'new', out, '--name', 'Lantern', '--sections', ['nav', hero, ...middle, 'footer'].join(',')], { encoding: 'utf8' });
      assert.equal(made.status, 0, made.stderr);
      for (const f of ['index.html', '404.html']) pages.push({ where: hero + '/' + f, html: readFileSync(join(out, f), 'utf8') });
    }
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  return { dir, pages };
}

function auditHtml(html, name = 'index.html') {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-scaffold-copy-page-'));
  try {
    writeFileSync(join(dir, name), html);
    return runAudit(join(dir, name));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('the section library marks its scaffold copy, and the scaffolder strips the marks', () => {
  const units = libraryCopy();
  // The judge's list of sentences that got past the 19-phrase audit. Every one
  // of them has to be marked in the library.
  const missed = [
    'one clause that says what this is', 'One sentence, 140-160 characters, written for a person.',
    'Same sentence as the description.', 'Description of the object', 'First service', 'Second service',
    'Third service', 'Different enough from the first that a reader can tell them apart.',
    'Stop at three or four.', 'End on a fact, not a promise.',
    'Two or three sentences of plain, unexcited fact about the object.',
    'The one they ask when they are close to deciding', 'Answer it honestly, including the caveat.',
    'A direct answer.', 'A phone number, an address, and hours.', 'Real ones.',
  ];
  const texts = units.map((u) => u.text);
  for (const s of missed) assert.ok(texts.includes(s), `not marked in sections.html: "${s}"`);
  assert.ok(units.length >= 50, `only ${units.length} marked pieces of copy`);

  const { dir, pages } = scaffoldAll();
  try {
    for (const p of pages) assert.ok(!/\[\[|\]\]/.test(p.html), `${p.where} still carries a [[ ]] mark`);
    const added = spawnSync(process.execPath, [cli, 'add', 'services'], { encoding: 'utf8' });
    assert.equal(added.status, 0, added.stderr);
    assert.match(added.stdout, /First service/);
    assert.ok(!/\[\[|\]\]/.test(added.stdout), 'add printed the [[ ]] marks');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('every marked piece of scaffold copy is reported by name when it is the only one left', () => {
  const units = libraryCopy();
  const { dir, pages } = scaffoldAll();
  try {
    for (const u of units) {
      const page = pages.find((p) => u.raws.some((r) => p.html.includes(r)));
      assert.ok(page, `"${u.text}" is marked but no scaffold emits it`);
      // Rewrite every other marked piece, keeping this one: protect its own
      // occurrences first so a shorter piece inside it cannot eat into it.
      let html = page.html;
      const keep = [];
      for (const r of u.raws) html = html.split(r).join(`\u0000${keep.push(r) - 1}\u0000`);
      const others = units.filter((o) => o !== u).flatMap((o) => o.raws).sort((a, b) => b.length - a.length);
      // A sentence is rewritten as a sentence: dropping its full stop would
      // run it into the next one, which no real rewrite does.
      for (const r of others) html = html.split(r).join(/[.!?]$/.test(r) ? 'Kiln notes.' : 'Kiln notes');
      html = html.replace(/\u0000(\d+)\u0000/g, (m, i) => keep[+i]);
      const found = copyFindings(auditHtml(html));
      assert.equal(found.length, 1, `"${u.text}" alone on ${page.where}: ${found.join(' | ') || 'not reported'}`);
      assert.ok(found[0].includes(`"${u.text}"`), `"${u.text}" alone on ${page.where} is reported as: ${found[0]}`);
      assert.match(found[0], /\b1 piece of scaffold copy\b/, found[0]);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rewriting only the old 19 phrases still fails, naming the title, meta description and alt text', () => {
  // The judge's lazy.mjs trial: the 19 phrases the audit used to list, and
  // nothing else, replaced. This is the list as it stood in 6.5.1.
  const old19 = [
    'lorem ipsum', 'site name', 'brand name', 'your text here', 'placeholder text',
    'first half of the claim', 'one sentence under the headline', 'two short paragraphs',
    'the line that reframes', 'coming soon', 'foo bar',
    'describe the geometry', 'a sentence someone actually said', 'one last sentence',
    'the question a real person asks', 'say the grade, not the adjective',
    'the single action', 'one or two lines', 'name, role',
  ];
  const dir = mkdtempSync(join(tmpdir(), 'ufs-scaffold-lazy-'));
  try {
    const made = spawnSync(process.execPath, [cli, 'new', dir, '--name', 'Lantern', '--sections', 'nav,hero-split,manifesto,services,faq,contact,footer'], { encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.html'))) {
      let h = readFileSync(join(dir, f), 'utf8');
      for (const p of old19) h = h.replace(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'Written copy');
      writeFileSync(join(dir, f), h);
    }
    const r = runAudit(dir);
    const found = copyFindings(r);
    const index = found.find((t) => t.startsWith('index.html:'));
    assert.ok(index, found.join('\n'));
    assert.match(index, /"one clause that says what this is" \(<title>\)/);
    assert.match(index, /"One sentence, 140-160 characters, written for a person\." \(meta description\)/);
    assert.match(index, /"Same sentence as the description\." \(og:description\)/);
    assert.match(index, /"Description of the object" \(alt\)/);
    for (const s of ['First service', 'A phone number, an address, and hours.', 'Real ones.', 'End on a fact, not a promise.'])
      assert.ok(index.includes(`"${s}"`), `${s} not named: ${index}`);
    // The 404 is written from the same head, so its placeholder meta is the
    // same bug on a second page, not a length warning.
    const nf = found.find((t) => t.startsWith('404.html:'));
    assert.ok(nf, found.join('\n'));
    assert.match(nf, /"One sentence, 140-160 characters, written for a person\." \(meta description\)/);
    assert.match(nf, /"Same sentence as the description\." \(og:description\)/);
    // The CLI is the gate, so the exit code is what counts.
    const audit = spawnSync(process.execPath, [cli, 'audit', dir], { encoding: 'utf8' });
    assert.equal(audit.status, 1, audit.stdout);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('interface copy and short labels a real page shares with the library are not scaffold copy', () => {
  // Same words as the library, used as a real page would: the contact form's
  // labels and errors, a 404, and short marked pieces inside longer prose.
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Kiln Row - wood-fired stoneware from the mill</title>
<meta name="description" content="Wood-fired stoneware made in the old mill on Kiln Row, fired twice a year and sold from the yard.">
<style>@media (prefers-reduced-motion: reduce) { * { animation: none } }</style></head>
<body><a class="sr-skip" href="#main">Skip to content</a><main id="main"><section><h1>Stoneware from the mill</h1>
<p class="eyebrow">Get in touch</p><h2>Tell us what you need.</h2>
<p>Here is what happens next. The kiln is lit on a Friday; a direct answer comes from the potter.</p>
<h3>First service of the season</h3><p>The first service we offer is a studio visit.</p>
<label for="n">Name</label><input id="n"><p>Add your name so the reply has somewhere to go.</p>
<p>There is nothing at this address.</p></section></main></body></html>`;
  assert.deepEqual(copyFindings(auditHtml(page)), []);
  // The same page with one marked stand-in as a whole heading is caught.
  const caught = copyFindings(auditHtml(page.replace('First service of the season', 'First service')));
  assert.equal(caught.length, 1);
  assert.match(caught[0], /"First service" \(text\)/);
});

test('the shipped example sites carry no scaffold copy', () => {
  for (const ex of ['fable-showcase', 'houston-roofing']) {
    const r = runAudit(join(root, 'examples', ex));
    assert.deepEqual(copyFindings(r), [], ex);
  }
});
