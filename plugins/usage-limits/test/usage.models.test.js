'use strict';

// The account's snapshot has no model dimension. It says a window is at 88 per
// cent and never says whose turns put it there, so the report could say how
// much room was left and not what that room would buy. These are the pieces
// that answer the second question from the transcripts.

const test = require('node:test');
const assert = require('node:assert');

const usage = require('../skills/usage-limits/scripts/usage.js');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const NOW = Date.parse('2026-09-01T10:00:00.000Z');

function event(model, cost, sidechain) {
  return { at: NOW - HOUR, cost, tokens: 1000, model, sidechain: Boolean(sidechain), sessionId: 's' };
}

function events() {
  const list = [];
  // Opus does the turns.
  for (let i = 0; i < 10; i += 1) list.push(event('claude-opus-5', 0.2));
  // Fable does fewer, dearer ones.
  for (let i = 0; i < 6; i += 1) list.push(event('claude-fable-5', 0.5));
  // Sonnet has only ever been an errand runner.
  for (let i = 0; i < 8; i += 1) list.push(event('claude-sonnet-5', 0.01, true));
  return list;
}

function windows() {
  return [
    { key: 'five_hour', label: '5-hour', family: null, remainingUSD: 20, applies: true },
    { key: 'seven_day', label: 'weekly', family: null, remainingUSD: 100, applies: true },
    { key: 'seven_day_scoped:fable', label: 'weekly (Fable)', family: 'fable', remainingUSD: 30, applies: false },
  ];
}

test('modelSpend counts turns and calls apart, and marks a model that has never taken a turn', () => {
  const rows = usage.modelSpend(events());
  const by = {};
  for (const row of rows) by[row.family] = row;

  assert.deepStrictEqual(rows.map((r) => r.family), ['fable', 'opus', 'sonnet'], 'dearest first');
  assert.strictEqual(by.opus.turns, 10);
  assert.strictEqual(by.opus.calls, 10);
  assert.strictEqual(by.opus.perCall, false);
  assert.ok(Math.abs(by.opus.usdPerTurn - 0.2) < 1e-9);

  assert.strictEqual(by.sonnet.turns, 0, 'every Sonnet call was a subagent errand');
  assert.strictEqual(by.sonnet.calls, 8);
  assert.strictEqual(by.sonnet.perCall, true, 'so its price is a price per call');
  assert.ok(Math.abs(by.sonnet.usdPerTurn - 0.01) < 1e-9);

  // A model whose family this table does not know is not guessed at.
  assert.deepStrictEqual(usage.modelSpend([event('gpt-9', 1)]), []);
  assert.deepStrictEqual(usage.modelSpend(null), []);
});

test('windowForFamily gives a family its own weekly, and the shared one otherwise', () => {
  assert.strictEqual(usage.windowForFamily(windows(), 'fable').key, 'seven_day_scoped:fable');
  assert.strictEqual(usage.windowForFamily(windows(), 'opus').key, 'seven_day');
  assert.strictEqual(usage.windowForFamily([], 'opus'), null);
});

test('modelHeadroom prices the room left in turns of each model', () => {
  const rows = usage.modelHeadroom(windows(), events(), new Set(['opus']), null);
  const by = {};
  for (const row of rows) by[row.family] = row;

  assert.strictEqual(by.opus.windowLabel, 'weekly');
  assert.strictEqual(by.opus.ownWindow, false);
  assert.strictEqual(by.opus.inUse, true);
  assert.strictEqual(by.opus.turnsLeft, 500, 'a hundred dollars left at twenty cents a turn');

  assert.strictEqual(by.fable.windowLabel, 'weekly (Fable)');
  assert.strictEqual(by.fable.ownWindow, true, 'Fable has a weekly of its own');
  assert.strictEqual(by.fable.inUse, false, 'and this session is not running it');
  assert.strictEqual(by.fable.windowApplies, false);
  assert.strictEqual(by.fable.turnsLeft, 60, 'thirty dollars left at fifty cents a turn');
});

// 114 Sonnet calls on this machine averaged under two cents because they were
// one-shot errands. Dividing the budget by that promised 22,752 Sonnet turns,
// which is a fabrication, and one in the direction that promises room.
test('modelHeadroom refuses to project turns for a model that has taken none', () => {
  const rows = usage.modelHeadroom(windows(), events(), null, null);
  const sonnet = rows.find((row) => row.family === 'sonnet');
  assert.strictEqual(sonnet.perCall, true);
  assert.strictEqual(sonnet.turnsLeft, null, 'no turn count out of errands');
  assert.ok(sonnet.usdPerTurn > 0, 'but what delegating to it costs is still said');

  // And a remembered per-call price does not become a turn price either.
  const thin = [event('claude-sonnet-5', 0.01, true)];
  const remembered = { sonnet: { usdPerTurn: 0.01, sample: 200, perCall: true } };
  const only = usage.modelHeadroom(windows(), thin, null, remembered)[0];
  assert.strictEqual(only.turnsLeft, null);
  assert.strictEqual(only.remembered, false);
});

test('modelHeadroom falls back to the record when this week is too thin to price a turn', () => {
  const thin = [event('claude-opus-5', 9)];
  const bare = usage.modelHeadroom(windows(), thin, null, null)[0];
  assert.strictEqual(bare.remembered, false);
  assert.strictEqual(bare.turnsLeft, 11, 'one dear turn is all there is to go on');

  const remembered = { opus: { usdPerTurn: 0.2, sample: 400, perCall: false } };
  const learned = usage.modelHeadroom(windows(), thin, null, remembered)[0];
  assert.strictEqual(learned.remembered, true);
  assert.strictEqual(learned.usdPerTurn, 0.2);
  assert.strictEqual(learned.turnsLeft, 500);

  // A proper sample this week beats the record.
  const full = usage.modelHeadroom(windows(), events(), null, { opus: { usdPerTurn: 9, sample: 400 } });
  assert.strictEqual(full.find((r) => r.family === 'opus').remembered, false);
});

test('modelSamples keeps the freshest adequate measurement and nothing else', () => {
  const rows = usage.modelHeadroom(windows(), events(), null, null);
  const first = usage.modelSamples(rows, {});
  assert.strictEqual(first.changed, true);
  assert.ok(Math.abs(first.models.opus.usdPerTurn - 0.2) < 1e-9);
  assert.strictEqual(first.models.opus.sample, 10);
  assert.strictEqual(first.models.sonnet.perCall, true);

  // Nothing new to say, nothing written.
  assert.strictEqual(usage.modelSamples(rows, first.models).changed, false);

  // A thin week does not overwrite what was measured properly.
  const thin = usage.modelHeadroom(windows(), [event('claude-opus-5', 9)], null, first.models);
  const after = usage.modelSamples(thin, first.models);
  assert.strictEqual(after.changed, false);
  assert.ok(Math.abs(after.models.opus.usdPerTurn - 0.2) < 1e-9);
});

test('the report prints the headroom table, and never a turn count it does not have', () => {
  const rows = usage.modelHeadroom(windows(), events(), new Set(['opus']), null);
  const five = {
    key: 'five_hour', label: '5-hour', percentUsed: 40, stale: false, msToReset: HOUR,
    remainingUSD: 20, turnsLeft: 80, verdict: 'idle', applies: true,
  };
  const data = {
    host: 'claude', money: true, plan: 'Claude Max 5x', snapshotAgeMs: MINUTE, now: NOW,
    settings: { model: 'opus', effortLevel: 'xhigh' }, credits: null,
    windows: [five], binding: five, otherLimits: [], models: [], projects: [], sessions: [],
    modelHeadroom: rows, recent: { turns: 0 }, measuredTurns: 0,
  };
  const text = usage.render(data);
  assert.ok(text.indexOf('Model headroom') !== -1);
  const lines = text.split('\n');
  const opus = lines.find((line) => line.indexOf('  opus ') === 2);
  assert.match(opus, /~500/);
  assert.match(opus, /<- running$/);
  const sonnet = lines.find((line) => line.indexOf('  sonnet ') === 2);
  assert.match(sonnet, /-$/, 'no turn count for a model that has taken no turns');
  assert.ok(text.indexOf('a subagent call, not a turn') !== -1);

  // Codex meters an allowance and never quotes a price, so there is no honest
  // money in the table at all.
  const codex = usage.render(Object.assign({}, data, { money: false, host: 'codex' }));
  assert.strictEqual(codex.indexOf('Model headroom'), -1);
});

// A window past its reset describes the allowance its stale reading came from,
// not the one running now. Dividing that by a turn price turned it into a
// confident five hundred turns nobody had.
test('modelHeadroom projects nothing against a window that has rolled over', () => {
  const stale = [{ key: 'seven_day', label: 'weekly', family: null, remainingUSD: 100, applies: true, stale: true }];
  const row = usage.modelHeadroom(stale, events(), null, null).find((r) => r.family === 'opus');
  assert.strictEqual(row.turnsLeft, null);
  assert.ok(row.usdPerTurn > 0, 'what a turn costs is still measured');

  const fresh = stale.map((w) => Object.assign({}, w, { stale: false }));
  assert.strictEqual(usage.modelHeadroom(fresh, events(), null, null).find((r) => r.family === 'opus').turnsLeft, 500);
});
