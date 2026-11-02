'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const drift = require('../skills/usage-limits/scripts/drift.js');
const reading = require('../skills/usage-limits/scripts/reading.js');

const MINUTE = 60 * 1000;
const NOW = Date.parse('2026-09-08T20:40:00.000Z');

function withConfigDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-drift-'));
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('reading.record measures drift against whatever was there before it', () =>
  withConfigDir(() => {
    const first = {
      key: 'five_hour',
      percentUsed: 13,
      turnsLeft: 190,
      resetsAt: NOW + 3 * 60 * MINUTE,
      adjusted: true,
    };
    const second = Object.assign({}, first, { percentUsed: 73, turnsLeft: 40 });

    assert.strictEqual(reading.record(first, NOW), true);
    assert.strictEqual(drift.summary().sample, 0, 'nothing to compare against yet');

    assert.strictEqual(reading.record(second, NOW + 20 * MINUTE), true);
    const stats = drift.summary();
    assert.strictEqual(stats.sample, 1);
    assert.strictEqual(stats.medianAbsPercent, 60);
    assert.strictEqual(stats.worstAbsPercent, 60);
    assert.strictEqual(stats.medianAbsTurns, 150);

    const raw = drift.read();
    assert.strictEqual(raw.entries[0].predictedPercentUsed, 13);
    assert.strictEqual(raw.entries[0].actualPercentUsed, 73);
    assert.strictEqual(raw.entries[0].ageMs, 20 * MINUTE);
  }));

test('a window reset between two readings is a fresh start, not drift', () =>
  withConfigDir(() => {
    const before = {
      key: 'five_hour',
      percentUsed: 90,
      turnsLeft: 5,
      resetsAt: NOW + 5 * MINUTE,
      adjusted: true,
    };
    const after = {
      key: 'five_hour',
      percentUsed: 2,
      turnsLeft: 300,
      resetsAt: NOW + 5 * 60 * MINUTE,
      adjusted: true,
    };
    reading.record(before, NOW);
    reading.record(after, NOW + 10 * MINUTE);
    assert.strictEqual(drift.summary().sample, 0);
  }));

test('the ledger is bounded and never grows without limit', () =>
  withConfigDir(() => {
    for (let i = 0; i < drift.MAX_ENTRIES + 25; i++) {
      const at = NOW + i * MINUTE;
      reading.record(
        { key: 'five_hour', percentUsed: i % 100, turnsLeft: 100, resetsAt: at + 10 * 60 * MINUTE, adjusted: true },
        at
      );
    }
    const raw = drift.read();
    assert.ok(raw.entries.length <= drift.MAX_ENTRIES);
  }));

test('drift.describe reads plainly with nothing on record', () =>
  withConfigDir(() => {
    assert.match(drift.describe(), /no corrections measured/);
  }));

test('drift.describe reports the median and worst, and the gap that makes them readable', () =>
  withConfigDir(() => {
    // Two points off after two minutes is a working plugin; thirty points off
    // after half an hour is the complaint this ledger exists to settle. The
    // numbers are the same shape, so the gap has to be printed with them or
    // the line cannot be acted on.
    reading.record({ key: 'five_hour', percentUsed: 10, turnsLeft: 100, resetsAt: NOW + 5 * 60 * MINUTE, adjusted: true }, NOW);
    reading.record({ key: 'five_hour', percentUsed: 12, turnsLeft: 96, resetsAt: NOW + 5 * 60 * MINUTE, adjusted: true }, NOW + 2 * MINUTE);
    reading.record({ key: 'five_hour', percentUsed: 42, turnsLeft: 20, resetsAt: NOW + 5 * 60 * MINUTE, adjusted: true }, NOW + 32 * MINUTE);
    const text = drift.describe();
    assert.match(text, /2 measured corrections/);
    assert.match(text, /worst 30 points off over 30m/);
    assert.match(text, /median 16 points off over a typical 16m gap/);
  }));

test('the gap is only reported when the entries carry one', () => {
  assert.strictEqual(drift.gap(90 * 1000), '1.5m');
  assert.strictEqual(drift.gap(30 * 60 * 1000), '30m');
  assert.strictEqual(drift.gap(null), null);
  assert.strictEqual(drift.gap(NaN), null);
});

test('recording never throws on a malformed pair', () =>
  withConfigDir(() => {
    assert.strictEqual(drift.record(null, {}, {}, NOW), false);
    assert.strictEqual(drift.record('k', { percentUsed: 1, at: NOW }, { percentUsed: NaN, at: NOW }, NOW), false);
    assert.strictEqual(drift.record('k', {}, { percentUsed: 1, at: NOW }, NOW), false);
  }));

test('only an elapsed reset is excluded, not a long gap inside one window', () =>
  withConfigDir(() => {
    // The exclusion has to be exact. Too loose and a window that rolled over
    // contributes an eighty-point "drift" that swamps every real measurement;
    // too tight and the long blind stretches - the ones this ledger exists to
    // measure - are the first thing thrown away, because they are the ones
    // most likely to end near a reset.
    const window = { at: NOW, percentUsed: 20, turnsLeft: 100 };
    const later = { at: NOW + 40 * MINUTE, percentUsed: 85, turnsLeft: 9 };

    // Reset one millisecond after the second reading: same window, real drift,
    // and a forty-minute gap is exactly the case worth keeping.
    assert.strictEqual(
      drift.record('five_hour', Object.assign({}, window, { resetsAt: later.at + 1 }), later, later.at),
      true
    );
    // Reset exactly at the second reading: the meter has zeroed, so the jump
    // is not a measurement of anything.
    assert.strictEqual(
      drift.record('five_hour', Object.assign({}, window, { resetsAt: later.at }), later, later.at),
      false
    );
    const stats = drift.summary();
    assert.strictEqual(stats.sample, 1, 'one kept, one excluded');
    assert.strictEqual(stats.worstAbsPercent, 65);
    assert.strictEqual(stats.worstGapMs, 40 * MINUTE);
  }));

test('a ledger that cannot be written does not fail the reading that carries it', () =>
  withConfigDir((dir) => {
    // drift.record runs inside reading.record, which runs inside hooks. A hook
    // that fails over a measurement file would cost more than the measurement
    // is worth, so the ledger has to be the thing that gives way. A directory
    // where the file belongs makes every write fail for real, rather than by
    // stubbing something out.
    fs.mkdirSync(path.join(dir, 'usage-limits-drift.json'), { recursive: true });
    const first = { key: 'five_hour', percentUsed: 10, turnsLeft: 100, resetsAt: NOW + 60 * MINUTE, adjusted: true };
    assert.strictEqual(reading.record(first, NOW), true);
    assert.strictEqual(
      reading.record(Object.assign({}, first, { percentUsed: 55 }), NOW + MINUTE),
      true,
      'the correction is still written even though the ledger could not be'
    );
    assert.strictEqual(reading.read().five_hour.percentUsed, 55);
    assert.deepStrictEqual(drift.read(), { entries: [] });
    assert.strictEqual(drift.summary().sample, 0);
    assert.doesNotThrow(() => drift.describe());
  }));

test('a corrupt ledger is replaced, not thrown over', () =>
  withConfigDir((dir) => {
    fs.writeFileSync(path.join(dir, 'usage-limits-drift.json'), '{not json at all');
    const first = { key: 'five_hour', percentUsed: 10, turnsLeft: 100, resetsAt: NOW + 60 * MINUTE, adjusted: true };
    reading.record(first, NOW);
    reading.record(Object.assign({}, first, { percentUsed: 30 }), NOW + MINUTE);
    assert.strictEqual(drift.summary().sample, 1);
  }));
