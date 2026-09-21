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
