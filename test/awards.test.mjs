import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { normaliseRow, applyCheck, buildCorpus, formatAwards, pickReferences, statusVerdict, errorVerdict, CORPUS } from '../scripts/awards.mjs';

// The corpus had no tests of its own, and three of its bugs shipped: --pick ran
// unfiltered, a rebuild resurrected dead URLs as verified, and the merge dropped
// the aiGenerated flag every games/apps harvester wrote. Nothing here writes the
// shipped corpus - a check stamp from a hand run is how one entry came to say it
// died "at test".

const row = (over = {}) => ({
  id: 'x', name: 'X', url: 'https://example.com/', year: 2026, kind: 'game', source: 'game',
  techniques: ['a'], stack: [], verified: true, ...over,
});

test('the merge keeps whether a person or an agent built the site, and only when a harvester said so', () => {
  const report = { dropped: [] };
  assert.equal(normaliseRow(row({ aiGenerated: true }), 'f', report).aiGenerated, true);
  assert.equal(normaliseRow(row({ aiGenerated: false }), 'f', report).aiGenerated, false);
  // Missing is "not recorded", never "made by a person".
  assert.equal('aiGenerated' in normaliseRow(row(), 'f', report), false);
  assert.equal('aiGenerated' in normaliseRow(row({ aiGenerated: 'yes' }), 'f', report), false);
});

test('a row without a usable url is dropped and harvester provenance never becomes a technique', () => {
  const report = { dropped: [] };
  assert.equal(normaliseRow(row({ url: 'not a url' }), 'chunk-x.json', report), null);
  assert.match(report.dropped[0], /chunk-x\.json: X has no usable url/);
  const clean = normaliseRow(row({ techniques: ['real thing', 'unverified - listed on the tag feed, not individually fetched'] }), 'f', report);
  assert.deepEqual(clean.techniques, ['real thing']);
});

test('the list says which references were agent-built', () => {
  const text = formatAwards([
    { ...normaliseRow(row({ id: 'made', name: 'Made' }), 'f', { dropped: [] }) },
    { ...normaliseRow(row({ id: 'agent', name: 'Agent', aiGenerated: true }), 'f', { dropped: [] }) },
  ]);
  const block = (name) => text.split('\n\n').find((b) => b.startsWith(name));
  assert.match(block('Agent'), /agent-built/);
  assert.doesNotMatch(block('Made'), /agent-built/);
});

test('a check marks a dead site, and a later check that reaches it brings it back as it was', () => {
  const before = statSync(CORPUS).mtimeMs;
  const rows = [
    { id: 'was-verified', url: 'https://a.example/', verified: true },
    { id: 'never-verified', url: 'https://b.example/', verified: false },
  ];
  applyCheck({ dead: [{ id: 'was-verified', status: 404 }, { id: 'never-verified', status: 0 }], moved: [], reachable: [], stampedAt: 'T1' }, { rows });
  assert.equal(rows[0].verified, false);
  assert.deepEqual(rows[0].dead, { status: 404, at: 'T1', wasVerified: true });
  assert.equal(rows[1].dead.wasVerified, false);

  // Down twice in a row: the second mark must remember the ORIGINAL claim, not
  // the false the first mark wrote.
  applyCheck({ dead: [{ id: 'was-verified', status: 503 }], moved: [], reachable: [], stampedAt: 'T2' }, { rows });
  assert.equal(rows[0].dead.wasVerified, true);

  const changed = applyCheck({ dead: [], moved: [], reachable: ['was-verified', 'never-verified'], stampedAt: 'T3' }, { rows });
  assert.equal(changed, 2);
  assert.equal(rows[0].dead, undefined);
  assert.equal(rows[0].verified, true);
  assert.equal(rows[0].checked, 'T3');
  // A check can only restore what a harvester claimed, never upgrade it.
  assert.equal(rows[1].verified, false);
  assert.equal(statSync(CORPUS).mtimeMs, before, 'an in-memory check must not write the shipped corpus');
});

test('a bot wall is its own verdict: neither dead nor alive', () => {
  assert.equal(statusVerdict(200), 'ok');
  assert.equal(statusVerdict(302), 'ok');
  for (const s of [401, 403, 429]) assert.equal(statusVerdict(s), 'blocked', String(s));
  for (const s of [502, 503, 504]) assert.equal(statusVerdict(s), 'unsure', String(s));
  for (const s of [0, 400, 404, 410, 500, 525]) assert.equal(statusVerdict(s), 'dead', String(s));
  const failed = (code) => Object.assign(new Error('fetch failed'), { cause: { code } });
  assert.equal(errorVerdict(failed('ENOTFOUND')), 'dead');
  assert.equal(errorVerdict(failed('ERR_TLS_CERT_ALTNAME_INVALID')), 'dead');
  assert.equal(errorVerdict(failed('UND_ERR_CONNECT_TIMEOUT')), 'unsure');
  assert.equal(errorVerdict(new Error('fetch failed')), 'unsure');
  // A blocked row is not in `dead`, so applyCheck leaves a live entry exactly as it was.
  const rows = [
    { id: 'walled', url: 'https://w.example/', verified: true },
    // Marked by the rule that counted a 403 as death: withdrawn.
    { id: 'old-403', url: 'https://o.example/', verified: false, dead: { status: 403, at: 'T0', wasVerified: true } },
    // Marked on a 404: an unreachable host now proves nothing about that, so it stays.
    { id: 'old-404', url: 'https://g.example/', verified: false, dead: { status: 404, at: 'T0' } },
    // Marked on a 400 that turned out to be a site-wide wall answering 400 again: withdrawn.
    { id: 'old-400', url: 'https://m.example/p', verified: false, dead: { status: 400, at: 'T0' } },
    // Marked on a network failure whose cause was never recorded: stays.
    { id: 'old-0', url: 'https://n.example/', verified: false, dead: { status: 0, at: 'T0' } },
  ];
  applyCheck({
    dead: [],
    blocked: [{ id: 'walled', status: 403 }, { id: 'old-403', status: 403 }, { id: 'old-400', status: 400 }],
    unsure: [{ id: 'old-404', status: 0 }, { id: 'old-0', status: 0 }],
    moved: [], reachable: [], stampedAt: 'T',
  }, { rows });
  assert.deepEqual(rows[0], { id: 'walled', url: 'https://w.example/', verified: true });
  assert.equal(rows[1].dead, undefined);
  assert.equal(rows[1].verified, true);
  assert.deepEqual(rows[2].dead, { status: 404, at: 'T0' });
  assert.equal(rows[3].dead, undefined);
  assert.equal(rows[3].verified, false, 'no wasVerified recorded, so no claim to restore');
  assert.deepEqual(rows[4].dead, { status: 0, at: 'T0' });
});

test('a mark made before wasVerified was recorded recovers as unverified rather than guessing', () => {
  const rows = [{ id: 'legacy', url: 'https://c.example/', verified: false, dead: { status: 404, at: '2026-09-14' } }];
  applyCheck({ dead: [], moved: [], reachable: ['legacy'], stampedAt: 'T' }, { rows });
  assert.equal(rows[0].dead, undefined);
  assert.equal(rows[0].verified, false);
});

test('--pick still returns three references that disagree, from an in-memory corpus', () => {
  const corpus = ['a', 'b', 'c', 'd'].map((k, i) => normaliseRow(row({
    id: k, name: k.toUpperCase(), url: `https://${k}.example/`, kind: 'game',
    source: i < 2 ? 'game' : 'threejs', studio: i === 1 ? 'Same' : `S${k}`, techniques: [`t-${k}`],
  }), 'f', { dropped: [] }));
  const picked = pickReferences('game', 3, { corpus });
  assert.equal(picked.length, 3);
  // Two sources exist, so the first pass takes one of each before repeating one.
  assert.deepEqual([...new Set(picked.slice(0, 2).map((e) => e.source))].sort(), ['game', 'threejs']);
});

test('building twice gives the same corpus, whatever a check followed in between', () => {
  const once = buildCorpus({ write: false });
  // A check that followed a redirect for every row, fed into the next build.
  const checked = once.rows.map((e) => ({ ...e, checked: 'T', url: e.url.replace(/\/?$/, '/moved') }));
  const twice = buildCorpus({ write: false, prior: checked });
  const thrice = buildCorpus({ write: false, prior: twice.rows });
  assert.deepEqual(twice.rows.map((e) => e.id), once.rows.map((e) => e.id));
  assert.deepEqual(thrice.rows.map((e) => [e.id, e.url]), twice.rows.map((e) => [e.id, e.url]));
});

test('the shipped corpus is what the chunks build, and carries no stamp from a test run', () => {
  const merged = JSON.parse(readFileSync(CORPUS, 'utf8'));
  const before = statSync(CORPUS).mtimeMs;
  // The same merge `awards --build` runs, in memory. Ids, not URLs: the check
  // follows redirects into the merged file, so a URL legitimately drifts from
  // its chunk.
  const rebuilt = buildCorpus({ write: false });
  assert.equal(statSync(CORPUS).mtimeMs, before, 'an in-memory build must not write the shipped corpus');
  const shipped = new Set(merged.map((e) => e.id));
  const missing = rebuilt.rows.map((e) => e.id).filter((id) => !shipped.has(id));
  const extra = [...shipped].filter((id) => !rebuilt.rows.some((e) => e.id === id));
  assert.deepEqual({ missing, extra }, { missing: [], extra: [] }, 'a chunk changed and `awards --build` was not run');
  assert.ok(merged.some((e) => e.aiGenerated === true) && merged.some((e) => e.aiGenerated === false),
    'the rebuilt corpus must carry the aiGenerated flag the chunks record');
  const leaked = merged.filter((e) => e.checked === 'test' || (e.dead && e.dead.at === 'test')).map((e) => e.id);
  assert.deepEqual(leaked, []);
});
