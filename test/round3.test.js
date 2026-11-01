'use strict';

// The 2026-09-20 review, second pass: the standing text said once, the tight
// pulse throttled, both account readings named when they disagree, the last
// content block kept, a cache miss named once, and the headless run not
// updating itself at four in the morning.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function isolated(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ul-r3-'));
  const before = { dir: process.env.CLAUDE_CONFIG_DIR, full: process.env.USAGE_LIMITS_BRIEF_FULL };
  process.env.CLAUDE_CONFIG_DIR = dir;
  delete process.env.USAGE_LIMITS_BRIEF_FULL;
  try {
    return fn(dir);
  } finally {
    if (before.dir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before.dir;
    if (before.full === undefined) delete process.env.USAGE_LIMITS_BRIEF_FULL;
    else process.env.USAGE_LIMITS_BRIEF_FULL = before.full;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function fresh(name) {
  delete require.cache[require.resolve('../skills/usage-limits/scripts/' + name + '.js')];
  return require('../skills/usage-limits/scripts/' + name + '.js');
}

const BINDING = { key: 'five_hour', label: '5-hour', percentUsed: 20, stale: false };
const T = Date.UTC(2026, 8, 21, 21, 0, 0);

test('the standing instruction is said in full once per session, then keeps the fit contract concise', () =>
  isolated(() => {
    const brief = fresh('brief');
    const parts = { binding: BINDING, turnsLeft: 50, resetsIn: '3h', pressure: 'roomy' };
    const full = brief.briefText(parts);
    assert.match(full, /Before work, estimate the turns for the whole request/);
    assert.match(full, /Quote the binding window/);
    assert.match(full, /end it with one plain line giving the session total/);
    const short = brief.briefText(Object.assign({}, parts, { standingShort: true }));
    assert.ok(short.endsWith('\n' + brief.STANDING_SHORT), short);
    assert.ok(brief.STANDING_SHORT.split(/\s+/).length <= 25);
    assert.match(brief.STANDING_SHORT, /"fits" with evidence, otherwise "it may not fit"/);
    assert.doesNotMatch(short, /Quote the binding window/);
    assert.doesNotMatch(short, /Open with one short line stating/);
    // The wall keeps its own words whatever the memo says.
    const tight = brief.briefText(Object.assign({}, parts, { standingShort: true, pressure: 'tight', binding: Object.assign({}, BINDING, { percentUsed: 92 }) }));
    assert.match(tight, /The budget is nearly gone/);
    assert.match(tight, /Quote the binding window/);
    // The memo: per session, survives the ninety-second memo, and the opt-out wins.
    assert.strictEqual(brief.standingShortFor('s-1', T, {}), false);
    brief.markStanding('s-1', T);
    assert.strictEqual(brief.standingShortFor('s-1', T + 5 * HOUR, {}), true);
    assert.strictEqual(brief.standingShortFor('s-2', T, {}), false, 'another session has not heard it');
    assert.strictEqual(brief.standingShortFor('s-1', T + MINUTE, { USAGE_LIMITS_BRIEF_FULL: '1' }), false);
    brief.sayOnce('s-1', 'a line', T + 10);
    assert.strictEqual(brief.standingShortFor('s-1', T + 20, {}), true, 'the ninety-second memo does not drop it');
  }));

test('the brief names a cache miss the user caused, once, on the prompt right after it', () =>
  isolated((dir) => {
    const brief = fresh('brief');
    const feed = require('../skills/usage-limits/scripts/feed.js');
    const slot = feed.slotFrom(
      { session_id: 's-1', prompt_cache: { last_miss_at: Math.floor(T / 1000), last_miss_cause: { causes: ['tools_changed'] } } },
      null,
      T
    );
    assert.deepStrictEqual(slot.cacheMiss, { at: T, causes: ['tools_changed'] }, 'epoch seconds become milliseconds');
    const kept = feed.slotFrom({ session_id: 's-1', prompt_cache: { last_miss_at: null, last_miss_cause: null } }, slot, T + 1000);
    assert.deepStrictEqual(kept.cacheMiss, slot.cacheMiss, 'a refresh with no diagnosed miss keeps the last one');
    assert.strictEqual(feed.slotFrom({ session_id: 's-1' }, null, T).cacheMiss, null);
    fs.writeFileSync(path.join(dir, 'usage-limits-feed.json'), JSON.stringify({ 's-1': slot }));
    assert.strictEqual(brief.cacheMissWhyFor('s-1', T + MINUTE), 'the tool list changed');
    assert.strictEqual(brief.cacheMissWhyFor('s-1', T + 2 * MINUTE), null, 'said once per miss');
    fs.writeFileSync(
      path.join(dir, 'usage-limits-feed.json'),
      JSON.stringify({ 's-1': Object.assign({}, slot, { cacheMiss: { at: T - 31 * MINUTE, causes: ['system_prompt_changed'] } }) })
    );
    assert.strictEqual(brief.cacheMissWhyFor('s-1', T), null, 'half an hour later is not right after');
    assert.strictEqual(brief.missReason(['ttl_expired_5m']), null, 'time passing is nobody\'s doing');
    assert.strictEqual(brief.missReason(['likely_server_side']), null);
    assert.strictEqual(brief.missReason(['ttl_expired_5m', 'system_prompt_changed']), 'the system prompt changed');
    const text = brief.briefText({ binding: BINDING, pressure: 'roomy', cacheMissWhy: 'the tool list changed' });
    assert.match(text, /^\[usage-limits\] binding window is 5-hour 20% used; the prompt cache missed on the last call because the tool list changed, so that call re-read the whole context\./);
    assert.doesNotMatch(brief.briefText({ binding: BINDING, pressure: 'roomy' }), /prompt cache/);
  }));

test('two account readings that disagree by more than five points are both named', () => {
  const brief = require('../skills/usage-limits/scripts/brief.js');
  const w = Object.assign({}, BINDING, { sources: { cache: 14, live: 20, used: 'live' } });
  assert.strictEqual(brief.describeWindow(w), "5-hour 20% (the live reading; Claude Code's cache says 14%)");
  assert.strictEqual(
    brief.describeWindow(Object.assign({}, w, { percentUsed: 14, sources: { cache: 14, live: 20, used: 'cache' } })),
    "5-hour 14% (Claude Code's cache; the live reading says 20%)"
  );
  assert.strictEqual(brief.describeWindow(Object.assign({}, w, { sources: { cache: 15, live: 20, used: 'live' } })), '5-hour 20%', 'five points is one reading');
  assert.strictEqual(brief.describeWindow(BINDING), '5-hour 20%');
});

test('collect keeps both account readings per window and the report carries them', async () => {
  const usage = fresh('usage');
  const live = require('../skills/usage-limits/scripts/live.js');
  const NOW = Date.parse('2026-09-21T12:00:00.000Z');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ul-sources-'));
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  usage.setHost('claude');
  try {
    const snap = (five) => ({
      five_hour: { utilization: five, resets_at: '2026-09-21T16:00:00.000Z' },
      seven_day: { utilization: 4, resets_at: '2026-09-23T23:00:00.000Z' },
    });
    fs.writeFileSync(
      path.join(dir, '.claude.json'),
      JSON.stringify({
        oauthAccount: { accountUuid: 'acc', organizationType: 'claude_max' },
        cachedUsageUtilization: { fetchedAtMs: NOW - 10 * MINUTE, accountUuid: 'acc', utilization: snap(14) },
      })
    );
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ model: 'claude-opus-5' }));
    live.writeLive({ fetchedAtMs: NOW - MINUTE, utilization: snap(20), accountUuid: 'acc' });
    const collected = usage.collectClaude(NOW);
    assert.strictEqual(collected.snapshotSource, 'live');
    assert.deepStrictEqual(collected.sources.five_hour, { cache: 14, live: 20, used: 'live' });
    const data = await usage.report(NOW, {});
    assert.deepStrictEqual(data.windows.find((w) => w.key === 'five_hour').sources, { cache: 14, live: 20, used: 'live' });
    // A live file for another account is not a second reading of this one.
    live.writeLive({ fetchedAtMs: NOW - MINUTE, utilization: snap(20), accountUuid: 'other' });
    assert.strictEqual(usage.collectClaude(NOW).sources, null);
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Measured 2026-09-21 on 179 real agent transcripts: 1,991 of 2,504 messages
// written as several content blocks ran like [1, 1, 202] on output_tokens.
test('a message written as several content blocks is priced by its last block', async () => {
  const usage = fresh('usage');
  const NOW = Date.parse('2026-09-21T10:00:00.000Z');
  const SESSION = 'sess-blocks';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ul-blocks-'));
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  usage.setHost('claude');
  const line = (id, at, output, over) =>
    JSON.stringify(
      Object.assign(
        {
          type: 'assistant',
          timestamp: new Date(at).toISOString(),
          requestId: 'req_' + id,
          sessionId: SESSION,
          message: { id: 'msg_' + id, model: 'claude-opus-5', usage: { input_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: output } },
        },
        over || {}
      )
    );
  try {
    fs.writeFileSync(
      path.join(dir, '.claude.json'),
      JSON.stringify({
        oauthAccount: { organizationType: 'claude_max', userRateLimitTier: 'default_claude_max_5x' },
        cachedUsageUtilization: {
          fetchedAtMs: NOW - MINUTE,
          utilization: {
            five_hour: { utilization: 10, resets_at: new Date(NOW + 4 * HOUR).toISOString() },
            seven_day: { utilization: 5, resets_at: new Date(NOW + 6 * DAY).toISOString() },
          },
        },
      })
    );
    const project = path.join(dir, 'projects', 'C--proj');
    fs.mkdirSync(path.join(project, SESSION, 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(project, SESSION + '.jsonl'), line('m0', NOW - 30 * MINUTE, 100) + '\n');
    // One message, three blocks: the last carries the count that matters.
    const sub = [1, 1, 202].map((output, i) => line('s0', NOW - 20 * MINUTE + i * 1000, output, { isSidechain: true, agentId: 'abc' }));
    fs.writeFileSync(path.join(project, SESSION, 'subagents', 'agent-abc.jsonl'), sub.join('\n') + '\n');
    const data = await usage.report(NOW, { sessionId: SESSION });
    assert.strictEqual(data.subagentTurns, 1, 'three blocks are one call');
    // Opus: (1000 * 5 + output * 25) / 1e6 per call.
    const expected = (1000 * 5 + 100 * 25) / 1e6 + (1000 * 5 + 202 * 25) / 1e6;
    assert.ok(Math.abs(data.session.cost - expected) < 1e-9, 'priced at 202 output tokens, not 1: ' + data.session.cost);
    assert.strictEqual(data.session.tokens, 1100 + 1202);
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the tight and gone sentences are advice, said on the same ten-minute slot as the fan-out advice', () =>
  isolated(() => {
    const pulse = fresh('pulse');
    const said = pulse.pulseText({ label: '5-hour', percentUsed: 92, sessions: 1, pressure: 'tight' });
    assert.match(said, /Keep going with the whole job/);
    assert.strictEqual(pulse.pulseText({ label: '5-hour', percentUsed: 92, sessions: 1, pressure: 'tight', advice: false }), '[usage-limits] 5-hour now 92%.');
    assert.strictEqual(pulse.pulseText({ label: '5-hour', percentUsed: 100, sessions: 1, pressure: 'gone', advice: false }), '[usage-limits] 5-hour now 100%.');
    assert.match(pulse.pulseText({ label: '5-hour', percentUsed: 100, sessions: 1, pressure: 'gone' }), /The budget is gone/);
    // The slot is the fan-out advice's slot, keyed the same way.
    const all = pulse.trim({}, 's-1#fanout-advice', T);
    assert.strictEqual(pulse.due(all, 's-1#fanout-advice', T + 5 * MINUTE, 10 * MINUTE), false);
    assert.strictEqual(pulse.due(all, 's-1#fanout-advice', T + 11 * MINUTE, 10 * MINUTE), true);
  }));

test('the headless resume does not update itself at four in the morning', () => {
  const wake = require('../skills/usage-limits/scripts/wake.js');
  const before = process.env.DISABLE_AUTOUPDATER;
  try {
    delete process.env.DISABLE_AUTOUPDATER;
    const options = wake.spawnOptionsFor({ cwd: 'C:\\p' }, {}, 'claude.cmd');
    assert.strictEqual(options.env.DISABLE_AUTOUPDATER, '1');
    // process.env is case-insensitive on Windows; a copy of it keeps the key the
    // machine uses, which is Path on a stock Windows runner.
    const pathKey = Object.keys(options.env).find((key) => key.toUpperCase() === 'PATH');
    assert.strictEqual(options.env[pathKey], process.env.PATH, 'the rest of the environment is inherited');
    process.env.DISABLE_AUTOUPDATER = '0';
    assert.strictEqual(wake.spawnOptionsFor({ cwd: 'C:\\p' }, {}, 'claude.cmd').env.DISABLE_AUTOUPDATER, '0', 'a value already set is left alone');
  } finally {
    if (before === undefined) delete process.env.DISABLE_AUTOUPDATER;
    else process.env.DISABLE_AUTOUPDATER = before;
  }
});
