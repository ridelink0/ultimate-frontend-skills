/* What UFS teaches about the parts of a site that are not the art direction:
   low-end devices and screen sizes, SEO, legal safeguards (consent, licences,
   accessibility) and asking the user before building. Each point is prose in
   a reference file, so an edit can drop one silently; these tests pin each
   point to the file that carries it, check that the ship checklist every site
   reads reaches it, and check that every script and webdesign.mjs subcommand
   the doctrine tells an agent to run exists. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const S = join(root, 'skills', 'ultimate-frontend-skills');
const R = join(S, 'references');
const read = (p) => readFileSync(p, 'utf8').replace(/\s+/g, ' ');
const doc = {
  skill: read(join(S, 'SKILL.md')),
  pipeline: read(join(R, 'pipeline.md')),
  checklist: read(join(R, 'checklist.md')),
  workflows: read(join(R, 'workflows.md')),
  security: read(join(R, 'security.md')),
};
const has = (name, phrases) => {
  const missing = phrases.filter((p) => !(p instanceof RegExp ? p.test(doc[name]) : doc[name].includes(p)));
  assert.deepEqual(missing, [], name + ' no longer teaches: ' + missing.join(' | '));
};

test('low-end devices and screen sizes: measured on slow hardware, content kept on every tier, 360px and 200% zoom', () => {
  has('workflows', ['Do not claim a laptop headless run represents a low-end phone', 'Preserve text, actions and information on every tier', 'frame-time percentiles', 'cap DPR', 'dispose GPU resources']);
  has('checklist', ['Readable at 360px wide, and at 200% browser zoom', 'No horizontal scrollbar at any width', 'at 1440 and 390']);
  has('skill', ['readable at 360 px', '1440 and 390']);
});

test('SEO: emitted routes, one canonical, real sitemap, noindex is not access control, title/description/OG on every page', () => {
  has('workflows', ['Validate actual emitted routes', 'one canonical per indexable route', 'real sitemap URLs', 'structured data', 'Noindex on a preview is not access control', 'submitting a sitemap does not guarantee indexing']);
  has('checklist', ['`<title>`, meta description, favicon and Open Graph tags']);
});

test('legal safeguards: consent before tracking, licences and provenance, accessibility, and no claim of legal certification', () => {
  // cookies and trackers
  has('security', ['Block non-exempt tracking until required consent', 'provide withdrawal', 'verify network behavior after refusal', '"Cookieless" alone does not establish a consent exemption', 'it does not obtain consent', 'not a legal certification', 'link a privacy policy']);
  // licences, rights, endorsements
  has('workflows', ['rights ledger for text, code, fonts, media and testimonials', 'must keep its license and provenance', 'public availability alone is insufficient', 'not a legal certification', 'Image generation is opt-in']);
  has('skill', ['Never invent a specific']);
  // accessibility
  has('workflows', ['Reduced motion keeps substantive content and all actions', 'pause mechanism', 'pause-stop-hide']);
  has('checklist', ['Exactly one `<h1>`', 'Every focus stop is visible', 'Every form control has a real label', 'Every image has `alt`']);
});

test('workflow: a fixed order of steps, and a question for the user only when a missing fact changes the result', () => {
  has('skill', ['If the brief does not say what the subject is, ask one question; otherwise decide and go']);
  has('pipeline', [/ask one question\. Otherwise decide and go/]);
  has('workflows', ['Ask about missing facts that change behavior, not a long questionnaire', 'Implement one complete path against the real data before polishing it', 'Local checks do not establish deployed behavior or legal clearance']);
  for (let i = 1; i <= 6; i++) assert.match(doc.workflows, new RegExp('(^|\\s)' + i + '\\. [A-Z]'), 'workflows.md build order lost step ' + i);
});

test('the ship checklist every site reads reaches the SEO, device and consent guidance', () => {
  // workflows.md is routed only for complex workflow sites; a landing page
  // reaches its SEO and device sections only through the checklist.
  assert.match(doc.checklist, /workflows\.md[^.]*SEO/, 'checklist.md does not send every site to the SEO section of workflows.md');
  assert.match(doc.checklist, /workflows\.md[^.]*Performance across devices/, 'checklist.md does not send every site to the device section of workflows.md');
  assert.match(doc.checklist, /security\.md[^.]*(consent|Fonts and trackers)/, 'checklist.md does not send every site to the consent rules in security.md');
});

const docFiles = [join(S, 'SKILL.md'), ...readdirSync(R).filter((f) => f.endsWith('.md')).map((f) => join(R, f)),
  ...readdirSync(join(root, 'commands')).filter((f) => f.endsWith('.md')).map((f) => join(root, 'commands', f))];

// Bare (scripts/x.mjs) or under the plugin root (${CLAUDE_PLUGIN_ROOT}/scripts/x.mjs);
// a scripts/ folder inside another path (skills/foo/scripts/x.mjs) is not this one.
const scriptRef = /(?<![\w.-])(?<![\w.-]\/)scripts\/((?:[\w-]+\/)*[\w-]+\.(?:mjs|cjs|py))\b/g;

test('every script under scripts/ the doctrine tells an agent to run exists, bare or under ${CLAUDE_PLUGIN_ROOT}', () => {
  assert.deepEqual([...'node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" new; skills/image-deep-research/scripts/study.mjs; scripts/cut.py'.matchAll(scriptRef)].map((m) => m[1]), ['webdesign.mjs', 'cut.py']);
  const missing = [];
  for (const f of docFiles) for (const m of readFileSync(f, 'utf8').matchAll(scriptRef))
    if (!existsSync(join(root, 'scripts', m[1]))) missing.push(f.slice(root.length) + ': scripts/' + m[1]);
  assert.deepEqual([...new Set(missing)], []);
});

test('every webdesign.mjs subcommand the doctrine names is one webdesign.mjs dispatches', () => {
  const src = readFileSync(join(root, 'scripts', 'webdesign.mjs'), 'utf8');
  const known = new Set([...src.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]));
  assert.ok(known.has('audit') && known.has('three'), 'could not read the dispatch table');
  const unknown = [];
  for (const f of docFiles) for (const m of readFileSync(f, 'utf8').matchAll(/webdesign\.mjs"? ([a-z][a-z-]+)\b/g))
    if (!known.has(m[1])) unknown.push(f.slice(root.length) + ': webdesign.mjs ' + m[1]);
  assert.deepEqual([...new Set(unknown)], []);
});
