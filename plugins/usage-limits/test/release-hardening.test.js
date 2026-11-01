'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const live = require('../skills/usage-limits/scripts/live.js');
const usage = require('../skills/usage-limits/scripts/usage.js');
const tokens = require('../skills/usage-limits/scripts/tokens.js');
const feed = require('../skills/usage-limits/scripts/feed.js');
const brief = require('../skills/usage-limits/scripts/brief.js');
const NOW = Date.UTC(2026, 10, 1, 12);
const SAMPLE = { five_hour: { utilization: 15, resets_at: '2026-11-01T16:00:00.000Z' } };
async function isolated(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-hardening-'));
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try { await fn(dir); } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
async function server(handler, fn) {
  const srv = http.createServer(handler);
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  try { await fn('http://127.0.0.1:' + srv.address().port + '/usage'); }
  finally { await new Promise((resolve) => srv.close(resolve)); }
}
test('switching accounts skips both the previous freshness TTL and its backoff', () => isolated(async (dir) => {
  fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'new-login' } }));
  live.writeLive({ fetchedAtMs: NOW - 100, accountUuid: 'old', utilization: SAMPLE });
  fs.writeFileSync(live.attemptFile(), JSON.stringify({ attemptedAtMs: NOW, delayMs: 600000, kind: 'forbidden', accountUuid: 'old' }));
  let hits = 0;
  await server((req, res) => { hits++; res.writeHead(200); res.end(JSON.stringify(SAMPLE)); }, async (url) => {
    const result = await live.refreshIfStale({ now: NOW, accountUuid: 'new', cacheFetchedAtMs: NOW - 10, url, env: {} });
    assert.equal(result.skipped, null);
    assert.equal(hits, 1);
    assert.equal(result.snapshot.accountUuid, 'new');
    assert.equal(JSON.parse(fs.readFileSync(live.attemptFile(), 'utf8')).accountUuid, 'new');
    assert.equal(live.readLive({ accountUuid: 'old' }), null);
  });
}));
test('a late answer from an old login cannot overwrite the new login', () => isolated(async (dir) => {
  const file = path.join(dir, '.credentials.json');
  const login = (token) => fs.writeFileSync(file, JSON.stringify({ claudeAiOauth: { accessToken: token } }));
  login('old-login');
  let release;
  let ready;
  const started = new Promise((resolve) => { ready = resolve; });
  await server((req, res) => { release = () => { res.writeHead(200); res.end(JSON.stringify(SAMPLE)); }; ready(); }, async (url) => {
    const pending = live.refresh({ now: NOW, accountUuid: 'old', url, env: {} });
    await started;
    login('new-login');
    live.writeLive({ fetchedAtMs: NOW + 1, accountUuid: 'new', utilization: SAMPLE });
    release();
    const result = await pending;
    assert.equal(result.outcome.kind, 'account_changed');
    assert.equal(result.snapshot, null);
    assert.equal(live.readLive().accountUuid, 'new');
    assert.equal(fs.readFileSync(live.liveFile(), 'utf8').includes('login'), false);
  });
}));
test('provider token splits preserve unknowns, zeroes and output subsets', () => {
  assert.deepEqual(tokens.fromUsage({}, 'anthropic'), { input: null, output: null, uncachedInput: null, cacheRead: null, cacheWrite: null, reasoning: null });
  const a = tokens.fromUsage({ input_tokens: 10, cache_creation_input_tokens: 30, cache_read_input_tokens: 60, output_tokens: 5 }, 'anthropic');
  assert.equal(a.input, 100);
  assert.equal(a.output, 5);
  const o = tokens.fromUsage({ input_tokens: 100, cached_input_tokens: 60, output_tokens: 5, reasoning_output_tokens: 3 }, 'openai');
  assert.equal(o.input, 100);
  assert.equal(o.uncachedInput, 40);
  assert.equal(o.output, 5);
  assert.equal(o.reasoning, 3);
  assert.equal(tokens.fromUsage({ input_tokens: null, output_tokens: 0 }, 'openai').input, null);
  assert.equal(tokens.fromUsage({ input_tokens: 100, cached_input_tokens: 120 }, 'openai').uncachedInput, null);
  assert.equal(tokens.fromStatusLine({ context_window: { current_usage: null, total_input_tokens: 0 } }), null);
  assert.match(tokens.lines({ input: null, output: 0, cacheRead: null, cacheWrite: 0 }).join('\n'), /Input \?  Output 0/);
});
test('status feed clears old account headers and exposes latest-response token directions', () => isolated((dir) => {
  fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: 'new' }, cachedUsageUtilization: {} }));
  const prior = { at: NOW - 100, accountUuid: 'old', rateLimits: { five_hour: { used_percentage: 90 } }, tokens: { input: 900 } };
  const next = feed.slotFrom({ session_id: 's', context_window: { total_input_tokens: 100, total_output_tokens: 5,
    current_usage: { input_tokens: 10, cache_creation_input_tokens: 30, cache_read_input_tokens: 60, output_tokens: 5 } } }, prior, NOW);
  assert.equal(next.accountUuid, 'new');
  assert.equal(next.rateLimits, null);
  assert.equal(next.tokens.input, 100);
  assert.equal(next.tokens.output, 5);
  assert.equal(feed.slotFrom({ session_id: 's', context_window: { current_usage: null } }, next, NOW + 1).tokens, null);
}));
test('work fit never promises coverage for missing, stale or shared measurements', () => {
  const window = { key: 'five_hour', label: '5-hour', usdPerPercent: 1, percentLeft: 80 };
  const data = { rates: { median: 1, high: 2, sample: 10 }, windows: [window] };
  assert.match(usage.renderForecast(data, 10), /Work fit: fits\./);
  assert.match(usage.renderForecast(data, 50), /Work fit: it may not fit\./);
  assert.match(usage.renderForecast({ ...data, windows: [{ ...window, stale: true }] }, 10), /it may not fit/);
  assert.match(usage.renderForecast({ ...data, sessions: [{}, {}] }, 10), /Work fit: it may not fit\./);
  assert.match(usage.renderForecast({ windows: [] }, 10), /it may not fit/);
  assert.equal(usage.forecastWindow({ ...window, percentLeft: null }, 10, data.rates), null);
  const text = brief.briefText({ binding: { label: '5-hour', percentUsed: 1 }, pressure: 'roomy', turnsLeft: 100 });
  assert.match(text, /say exactly "it may not fit"/);
  assert.doesNotMatch(text, /stating this and that the request fits/);
});
