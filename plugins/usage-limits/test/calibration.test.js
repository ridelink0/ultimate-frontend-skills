'use strict';

// What a point of a window costs, and the two ends where that arithmetic
// breaks.
//
// The price is the spend inside a window divided by the meter's own
// percentage, so both extremes lie. Near zero the denominator is mostly
// rounding. Near 100 the meter has stopped counting, and everything spent past
// the cap is real money that moved no points, so the price comes out too cheap
// and every later correction overshoots.

const test = require('node:test');
const assert = require('node:assert');

const usage = require('../skills/usage-limits/scripts/usage.js');

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-09-07T12:00:00.000Z');

function events(count, each, from) {
  const list = [];
  for (let i = 0; i < count; i += 1) {
    list.push({
      at: (from || NOW - HOUR) + i * 1000,
      model: 'claude-opus-5',
      cost: each,
      tokens: 1000,
      parts: { input: 100, cacheWrite: 0, cacheRead: 0, output: 50, reasoning: 0 },
      sessionId: 'sess',
    });
  }
  return list;
}

function windowFor(percent, opts) {
  const options = opts || {};
  return usage.buildWindow(
    { key: 'five_hour', label: '5-hour', span: 5 * HOUR },
    { utilization: percent, resets_at: new Date(NOW + HOUR).toISOString() },
    options.events || [],
    NOW,
    Object.assign({ fetchedAt: NOW - 60 * 1000 }, options.extra || {})
  );
}

test('the two ends of the meter are both refused as a baseline', () => {
  assert.ok(usage.MIN_BASELINE_PERCENT > 0);
  assert.ok(usage.MAX_BASELINE_PERCENT < 100, 'a full meter has stopped counting');
  assert.ok(usage.MAX_BASELINE_PERCENT > usage.MIN_BASELINE_PERCENT);
});

test('a price is learned from a reading in the healthy middle', () => {
  // Twenty turns at a dollar, against a meter reading 40: $0.50 a point.
  const built = windowFor(40, { events: events(20, 1) });
  assert.ok(built.calibration, 'a mid-range reading prices a point');
  assert.ok(Math.abs(built.calibration.usdPerPercent - 0.5) < 1e-9);
  assert.strictEqual(built.calibration.percent, 40);
});

test('a full meter learns nothing, because it was no longer counting', () => {
  // This is the bug. The same twenty dollars against a reading of 100 would
  // price a point at $0.20 - but the meter stopped at 100 and some of that
  // money moved nothing, so the true price is dearer than it looks. Learning
  // it makes every later correction convert spend into too many points.
  const built = windowFor(100, { events: events(20, 1) });
  assert.ok(!built.calibration, 'nothing is learned at the cap');
});

test('a nearly empty meter learns nothing either, for the opposite reason', () => {
  const built = windowFor(1, { events: events(20, 1) });
  assert.ok(!built.calibration, 'at 1% the denominator is rounding');
});

test('a remembered price learned at the cap is not trusted', () => {
  // Exactly what was on this machine: a five-hour price of $0.67 a point
  // learned from a reading of 100, while the window really cost $0.91.
  const stale = { usdPerPercent: 0.6661, turns: 88, percent: 100 };
  const honest = { usdPerPercent: 0.9065, turns: 40, percent: 47 };

  // With only the stale one on record and nothing measurable now, the
  // correction must not run off it.
  const withStale = windowFor(30, { events: [], extra: { knownCalibration: stale } });
  assert.ok(!Number.isFinite(withStale.usdPerPercent), 'a capped price prices nothing');

  // The same window with an honest price does correct.
  const withHonest = windowFor(30, { events: [], extra: { knownCalibration: honest } });
  assert.ok(Number.isFinite(withHonest.usdPerPercent), 'a mid-range price is usable');
  assert.ok(Math.abs(withHonest.usdPerPercent - 0.9065) < 1e-9);
});

test('the correction it produces matches what the account actually reported', () => {
  // The measurement this fix came from. Between two live readings 2m34s apart
  // the account went 24% -> 47% on $20.85 of spend: 23 points, $0.9065 each.
  // Given the honest price, a snapshot of 24 plus that spend must land on 47.
  const spend = 20.85;
  const priced = { usdPerPercent: spend / 23, turns: 40, percent: 47 };
  const after = events(10, spend / 10, NOW - 30 * 1000);
  const built = windowFor(24, { events: after, extra: { knownCalibration: priced } });
  assert.strictEqual(built.percentUsed, 47, 'the corrected figure is the one the API gave');
  assert.strictEqual(built.adjusted, true);

  // And with the capped price it was using before, it overshoots - which is
  // what was on screen: 54 against an account at 47.
  const cheap = { usdPerPercent: 0.6661, turns: 88, percent: 47 };
  const wrong = windowFor(24, { events: after, extra: { knownCalibration: cheap } });
  assert.ok(wrong.percentUsed > 47, 'the too-cheap price reads high: ' + wrong.percentUsed);
});

test('an honest price displaces one learned at the cap, so the file heals', () => {
  // 100 is the highest number there is, so ranking on percent alone meant a
  // price learned at the cap won every comparison and was written back for
  // ever - the file could never recover, even once the readers ignored it.
  const capped = { usdPerPercent: 0.6661, turns: 88, percent: 100 };
  const honest = { usdPerPercent: 0.9065, turns: 40, percent: 47 };
  assert.deepStrictEqual(usage.betterCalibration(capped, honest), honest);
  assert.deepStrictEqual(usage.betterCalibration(honest, capped), honest, 'the capped one never wins');
  // Two honest readings still rank by how much of the window they saw.
  const wider = { usdPerPercent: 0.9, turns: 10, percent: 80 };
  assert.deepStrictEqual(usage.betterCalibration(honest, wider), wider);
  // And nothing usable on either side is nothing, not the capped one.
  assert.strictEqual(usage.betterCalibration(capped, capped), null);
});

test('usableCalibration is the one gate, and it refuses both ends', () => {
  assert.ok(usage.usableCalibration({ usdPerPercent: 1, percent: 50 }));
  assert.strictEqual(usage.usableCalibration({ usdPerPercent: 1, percent: 100 }), null);
  assert.strictEqual(usage.usableCalibration({ usdPerPercent: 1, percent: 1 }), null);
  assert.strictEqual(usage.usableCalibration({ usdPerPercent: 0, percent: 50 }), null);
  assert.strictEqual(usage.usableCalibration(null), null);
  // A price with no reading recorded predates the check and is taken on trust.
  assert.ok(usage.usableCalibration({ usdPerPercent: 1 }));
});
