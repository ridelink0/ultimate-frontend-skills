// Live checks against the four real collections. Not part of `npm test`
// (the network is not the code under test, and a collection being down should
// not turn CI red); run with `npm run test:live` before a release.
import test from 'node:test';
import assert from 'node:assert/strict';
import { searchImages, SOURCES } from '../../skills/image-deep-research/scripts/images.mjs';

for (const source of SOURCES) {
  test(`${source}: a common query returns results whose URLs answer with an image`, { timeout: 120000 }, async () => {
    const res = await searchImages('cypress trees', { sources: [source], n: 3 });
    assert.deepEqual(res.errors, []);
    assert.ok(res.results.length >= 1, 'no results');
    const ok = res.results.filter((r) => r.verified.ok);
    assert.ok(ok.length >= 1, 'no result verified: ' + JSON.stringify(res.results.map((r) => [r.url, r.verified])));
    for (const r of res.results) assert.ok(r.licence, 'licence missing for ' + r.url);
  });
}
