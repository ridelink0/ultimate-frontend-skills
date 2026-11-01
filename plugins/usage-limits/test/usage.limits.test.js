'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The snapshot carries a `limits` array beside the per-window buckets: one
// entry per limit the account enforces, with a severity, whether it is the
// active one, and for the per-model weeklies which model it scopes to. This
// is the account's own description of its limits, and it was being ignored.

const test = require('node:test');
const assert = require('node:assert');

const usage = require('../skills/usage-limits/scripts/usage.js');
const tempdirs = require('../tools/test-tempdirs.js');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-09-01T10:00:00.000Z');

function iso(at) {
  return new Date(at).toISOString();
}

// The shape captured from ~/.claude.json on 2026-09-01, trimmed to what matters.
function snapshot(over) {
  return Object.assign(
    {
      five_hour: { utilization: 28, resets_at: iso(NOW + 2 * HOUR), limit_dollars: null, used_dollars: null, remaining_dollars: null, locked_reason: null },
      seven_day: { utilization: 11, resets_at: iso(NOW + 5 * DAY), limit_dollars: null, used_dollars: null, remaining_dollars: null, locked_reason: null },
      seven_day_opus: null,
      seven_day_sonnet: null,
      nimbus_quill: { utilization: 0, resets_at: null },
      extra_usage: { is_enabled: false },
      limits: [
        { kind: 'session', group: 'session', percent: 28, severity: 'normal', resets_at: iso(NOW + 2 * HOUR), scope: null, is_active: true },
        { kind: 'weekly_all', group: 'weekly', percent: 11, severity: 'normal', resets_at: iso(NOW + 5 * DAY), scope: null, is_active: false },
        {
          kind: 'weekly_scoped',
          group: 'weekly',
          percent: 17,
          severity: 'normal',
          resets_at: iso(NOW + 5 * DAY),
          scope: { model: { id: '', display_name: 'Fable' }, surface: null },
          is_active: false,
        },
      ],
      spend: { enabled: false },
      member_dashboard_available: false,
    },
    over || {}
  );
}

function event(model, cost, at) {
  return { at: at || NOW - HOUR, cost, tokens: 100, model, sidechain: false, sessionId: 's' };
}

function mixed() {
  const list = [];
  for (let i = 0; i < 6; i += 1) list.push(event('claude-fable-5', 1));
  for (let i = 0; i < 4; i += 1) list.push(event('claude-opus-5', 0.5));
  return list;
}

test('limitWindows reads every limit the account lists, scoped ones included', () => {
  const rows = usage.limitWindows(snapshot());
  assert.deepStrictEqual(rows.map((row) => row.key), ['five_hour', 'seven_day', 'seven_day_scoped:fable']);

  const session = rows[0];
  assert.strictEqual(session.percent, 28);
  assert.strictEqual(session.isActive, true);
  assert.strictEqual(session.severity, 'normal');
  assert.strictEqual(session.resetsAt, NOW + 2 * HOUR);

  const scoped = rows[2];
  assert.strictEqual(scoped.label, 'weekly (Fable)');
  assert.strictEqual(scoped.family, 'fable');
  assert.strictEqual(scoped.spanMs, 7 * DAY);
  assert.strictEqual(scoped.percent, 17);
  assert.strictEqual(scoped.isActive, false);
});

test('limitWindows copes with a snapshot that has no such list', () => {
  assert.deepStrictEqual(usage.limitWindows({}), []);
  assert.deepStrictEqual(usage.limitWindows({ limits: 'nope' }), []);
  assert.deepStrictEqual(usage.limitWindows(null), []);
  assert.deepStrictEqual(usage.limitWindows({ limits: [{ kind: 'session' }, null, { kind: 'weekly_scoped', percent: 3 }] }), []);
});

test('buildWindows adds a per-model weekly window priced from that model alone', () => {
  const windows = usage.buildWindows(snapshot(), mixed(), NOW, NOW - MINUTE, {}, null, new Map());
  const scoped = windows.find((w) => w.key === 'seven_day_scoped:fable');
  assert.ok(scoped, 'the Fable weekly is a window in its own right');
  assert.strictEqual(scoped.label, 'weekly (Fable)');
  assert.strictEqual(scoped.percentUsed, 17);
  assert.strictEqual(scoped.spanMs, 7 * DAY);
  assert.strictEqual(scoped.scoped, true);
  assert.strictEqual(scoped.family, 'fable');
  assert.strictEqual(scoped.turns, 6, 'only the Fable calls');
  assert.ok(Math.abs(scoped.spentUSD - 6) < 1e-9, 'and only their money');
  assert.ok(Math.abs(scoped.usdPerPercent - 6 / 17) < 1e-9);

  const five = windows.find((w) => w.key === 'five_hour');
  assert.ok(Math.abs(five.spentUSD - 8) < 1e-9, 'the shared window still sees everything');
  assert.strictEqual(five.isActive, true);
  assert.strictEqual(five.severity, 'normal');
  const week = windows.find((w) => w.key === 'seven_day');
  assert.strictEqual(week.isActive, false);
});

test('buildWindows takes a window from the limits list when its bucket is missing', () => {
  const only = { limits: snapshot().limits, extra_usage: { is_enabled: false } };
  const windows = usage.buildWindows(only, mixed(), NOW, NOW - MINUTE, {}, null, new Map());
  const five = windows.find((w) => w.key === 'five_hour');
  assert.strictEqual(five.percentUsed, 28);
  assert.strictEqual(five.resetsAt, NOW + 2 * HOUR);
  assert.strictEqual(five.verdict === 'unknown', false);
});

test('buildWindows prices a metered window from its dollar limit, not from calibration', () => {
  const metered = snapshot({
    five_hour: { utilization: 28, resets_at: iso(NOW + 2 * HOUR), limit_dollars: 100, used_dollars: 28, remaining_dollars: 72 },
  });
  const windows = usage.buildWindows(metered, mixed(), NOW, NOW - MINUTE, {}, null, new Map());
  const five = windows.find((w) => w.key === 'five_hour');
  assert.strictEqual(five.metered, true);
  assert.ok(Math.abs(five.usdPerPercent - 1) < 1e-9, 'a hundred dollars is a hundred points');
  assert.ok(Math.abs(five.remainingUSD - 72) < 1e-9);
});

test('bindingWindow trusts the limit the account marks active when its own measure is a tie', () => {
  const five = { key: 'five_hour', label: '5-hour', percentUsed: 30, stale: false, spanMs: 5 * HOUR, headroomMs: null, isActive: false };
  const week = { key: 'seven_day', label: 'weekly', percentUsed: 40, stale: false, spanMs: 7 * DAY, headroomMs: null, isActive: true };
  assert.strictEqual(usage.bindingWindow([five, week]).key, 'seven_day');
  // Without the flag the shorter window wins the tie, as before.
  assert.strictEqual(
    usage.bindingWindow([Object.assign({}, five, { isActive: false }), Object.assign({}, week, { isActive: false })]).key,
    'five_hour'
  );
  // But a measured pace still beats the flag: whichever runs out first binds.
  assert.strictEqual(
    usage.bindingWindow([Object.assign({}, five, { headroomMs: HOUR }), Object.assign({}, week, { headroomMs: 3 * HOUR })]).key,
    'five_hour'
  );
});

test('render marks a window the account calls critical', () => {
  const five = {
    key: 'five_hour', label: '5-hour', percentUsed: 96, stale: false, msToReset: HOUR, remainingUSD: 1,
    turnsLeft: 2, severity: 'critical', verdict: 'burning', headroomMs: HOUR, isActive: true,
  };
  const text = usage.render({
    host: 'claude', money: true, plan: 'Claude Max 5x', snapshotAgeMs: MINUTE, now: NOW,
    settings: { model: 'default', effortLevel: 'xhigh' }, credits: null,
    windows: [five], binding: five, otherLimits: [], models: [], projects: [], sessions: [],
    recent: { turns: 0 }, measuredTurns: 0,
  });
  const row = text.split('\n').find((line) => line.indexOf('5-hour') === 2);
  assert.ok(row, 'the window has a row');
  assert.match(row, /<- binding, critical$/);
});

// A per-model weekly caps one model family's spend and nothing else, so it can
// only ever stop work that uses that family. Reported without that
// qualification it became the loudest number in the brief for a limit the
// session could not move: a session running Opus was told to weigh a Fable
// weekly sitting at 88%.

test('familiesInUse takes the configured model, and adds what the session actually ran', () => {
  assert.deepStrictEqual([...usage.familiesInUse([], null, 'opus[1m]')], ['opus']);
  assert.deepStrictEqual([...usage.familiesInUse([], null, ['claude-fable-5-1'])], ['fable']);
  // Subagents on another model spend into that model's weekly too.
  const ours = [event('claude-opus-5', 1), event('claude-haiku-4-5-20251001', 0.1)];
  assert.deepStrictEqual([...usage.familiesInUse(ours, 's', 'opus')].sort(), ['haiku', 'opus']);
  // What another session is burning is not this one's constraint.
  const theirs = [Object.assign(event('claude-fable-5', 1), { sessionId: 'other' })];
  assert.deepStrictEqual([...usage.familiesInUse(theirs, 's', 'opus')], ['opus']);
  // Nothing recognisable: suppress nothing on the strength of a guess.
  assert.strictEqual(usage.familiesInUse([], null, 'default').size, 0);
  assert.strictEqual(usage.familiesInUse(null, null, [null, undefined]).size, 0);
});

test('a per-model weekly only applies to an agent running that model', () => {
  const built = () => usage.buildWindows(snapshot(), mixed(), NOW, NOW - MINUTE, {}, null, new Map());
  const onOpus = usage.markApplicable(built(), usage.familiesInUse([], null, 'opus'));
  assert.strictEqual(onOpus.find((w) => w.key === 'seven_day_scoped:fable').applies, false);
  for (const key of ['five_hour', 'seven_day']) {
    const window = onOpus.find((w) => w.key === key);
    assert.strictEqual(window.applies, true, key + ' caps the account, not one model');
  }
  // Switch to that model and it is a live limit again.
  const onFable = usage.markApplicable(built(), usage.familiesInUse([], null, 'claude-fable-5'));
  assert.strictEqual(onFable.find((w) => w.key === 'seven_day_scoped:fable').applies, true);
  // And with no idea what is running, nothing is suppressed.
  const unknown = usage.markApplicable(built(), usage.familiesInUse([], null, 'default'));
  assert.strictEqual(unknown.find((w) => w.key === 'seven_day_scoped:fable').applies, true);
});

test('the bucket-table per-model weeklies are scoped to their model too', () => {
  const withOpus = snapshot({ seven_day_opus: { utilization: 94, resets_at: iso(NOW + 5 * DAY) } });
  const windows = usage.markApplicable(
    usage.buildWindows(withOpus, mixed(), NOW, NOW - MINUTE, {}, null, new Map()),
    usage.familiesInUse([], null, 'sonnet')
  );
  assert.strictEqual(windows.find((w) => w.key === 'seven_day_opus').applies, false);
  assert.strictEqual(windows.find((w) => w.key === 'seven_day').applies, true);
});

test('bindingWindow never picks a window this agent cannot spend into', () => {
  const five = { key: 'five_hour', label: '5-hour', percentUsed: 9, stale: false, spanMs: 5 * HOUR, headroomMs: 4 * HOUR, isActive: false, applies: true };
  const fable = { key: 'seven_day_scoped:fable', label: 'weekly (Fable)', percentUsed: 88, stale: false, spanMs: 7 * DAY, headroomMs: MINUTE, isActive: true, applies: false };
  assert.strictEqual(usage.bindingWindow([five, fable]).key, 'five_hour');
  // The account calling it the active limit does not make it this model's.
  assert.strictEqual(
    usage.bindingWindow([five, Object.assign({}, fable, { applies: true })]).key,
    'seven_day_scoped:fable'
  );
  // A window that was never marked behaves exactly as it did before.
  const bare = { key: 'seven_day', label: 'weekly', percentUsed: 99, stale: false, spanMs: 7 * DAY, headroomMs: MINUTE, isActive: false };
  assert.strictEqual(usage.bindingWindow([five, bare]).key, 'seven_day');
  // And one is still returned when, impossibly, every window belongs to a model.
  assert.strictEqual(usage.bindingWindow([fable]).key, 'seven_day_scoped:fable');
});

test('criticalOthers leaves out a full window that this agent cannot move', () => {
  const fable = { key: 'seven_day_scoped:fable', label: 'weekly (Fable)', percentUsed: 88, stale: false, applies: false };
  const week = { key: 'seven_day', label: 'weekly', percentUsed: 91, stale: false, applies: true };
  assert.deepStrictEqual(
    usage.criticalOthers([fable, week], 'five_hour', 85).map((w) => w.key),
    ['seven_day']
  );
  assert.deepStrictEqual(
    usage.criticalOthers([Object.assign({}, fable, { applies: true }), week], 'five_hour', 85).map((w) => w.key),
    ['seven_day_scoped:fable', 'seven_day']
  );
});

test('the status line leaves out a per-model weekly for a model that is not running', () => {
  const saved = process.env.ANTHROPIC_MODEL;
  delete process.env.ANTHROPIC_MODEL;
  // Point the config directory at an empty one for the duration.
  //
  // statusLine() applies the corrected reading that the hooks leave in
  // CLAUDE_CONFIG_DIR/usage-limits-reading.json, so without this the fixture's
  // 28 per cent was silently replaced by whatever the REAL machine had spent.
  // The test therefore passed on an idle machine and failed on a busy one -
  // it read 57% during the session that found this. Fixtures must not be able
  // to lose to the developer's own account.
  const savedDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-test-'));
  try {
    const collected = { now: NOW, utilization: snapshot(), settings: { model: 'opus', effortLevel: 'high' } };
    // Shown, because hiding a limit outright is worse than over-reporting one
    // and the setting is all this line has to go on. It just never raises LOW.
    assert.match(usage.statusLine(collected), /fable 17%/);
    assert.match(usage.statusLine(collected), /5h 28%/);
    const nearlyGone = snapshot();
    nearlyGone.limits = nearlyGone.limits.map((l) => (l.kind === 'weekly_scoped' ? Object.assign({}, l, { percent: 97 }) : l));
    const loud = Object.assign({}, collected, { utilization: nearlyGone });
    assert.strictEqual(usage.statusLine(loud).indexOf('LOW'), -1, 'not this agent to lose');
    const onIt = Object.assign({}, loud, { settings: { model: 'claude-fable-5', effortLevel: 'high' } });
    assert.strictEqual(usage.statusLine(onIt).indexOf('LOW'), 0, 'but it is once that model is running');
    const onFable = Object.assign({}, collected, { settings: { model: 'claude-fable-5', effortLevel: 'high' } });
    assert.match(usage.statusLine(onFable), /fable 17%/);
    // No usable setting, nothing suppressed.
    const unknown = Object.assign({}, collected, { settings: { model: 'default', effortLevel: 'high' } });
    assert.match(usage.statusLine(unknown), /fable 17%/);
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_MODEL;
    else process.env.ANTHROPIC_MODEL = saved;
    if (savedDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = savedDir;
  }
});

test('render says which windows this agent is not spending into', () => {
  const five = {
    key: 'five_hour', label: '5-hour', percentUsed: 9, stale: false, msToReset: HOUR,
    remainingUSD: 100, turnsLeft: 200, verdict: 'idle', headroomMs: null, applies: true,
  };
  const fable = {
    key: 'seven_day_scoped:fable', label: 'weekly (Fable)', percentUsed: 88, stale: false,
    msToReset: 5 * DAY, remainingUSD: 56, turnsLeft: 115, severity: 'critical',
    verdict: 'idle', applies: false,
  };
  const text = usage.render({
    host: 'claude', money: true, plan: 'Claude Max 5x', snapshotAgeMs: MINUTE, now: NOW,
    settings: { model: 'opus[1m]', effortLevel: 'xhigh' }, credits: null,
    windows: [five, fable], binding: five, otherLimits: [], models: [], projects: [], sessions: [],
    modelHeadroom: [{ family: 'opus', inUse: true }, { family: 'fable', inUse: false }],
    recent: { turns: 0 }, measuredTurns: 0,
  });
  const row = text.split('\n').find((line) => line.indexOf('weekly (Fable)') === 2);
  assert.ok(row, 'the window still has a row');
  // The account's own severity is not swallowed by the marker: that model's
  // weekly really is critical, it is simply not this agent's wall.
  assert.match(row, /not in use, critical for that model$/);
  assert.ok(
    text.indexOf('caps one model, and this agent is running opus') !== -1,
    'and the table says what "not in use" means, naming what is actually running'
  );
});

test('familiesInUse counts subagent turns, and only this session', () => {
  const mine = [
    Object.assign(event('claude-opus-5', 1), { sidechain: false }),
    // A subagent dispatched onto another model spends into that model's weekly
    // as surely as a main-thread turn does.
    Object.assign(event('claude-fable-5', 1), { sidechain: true }),
  ];
  assert.deepStrictEqual([...usage.familiesInUse(mine, 's', 'opus')].sort(), ['fable', 'opus']);

  // With no session to scan - the CLI report - the configured model is the
  // whole answer. Counting every session on disk would put another window's
  // Fable turns back into this agent's families.
  const theirs = [Object.assign(event('claude-fable-5', 1), { sessionId: 'other' })];
  assert.deepStrictEqual([...usage.familiesInUse(theirs, null, 'opus')], ['opus']);
  assert.deepStrictEqual([...usage.familiesInUse(theirs, 's', 'opus')], ['opus']);
});

// opusplan plans on Opus and executes on Sonnet. Read as one model it would
// suppress a Sonnet weekly while Sonnet was the thing spending it.
test('a setting that names a strategy rather than a model resolves to every model it runs', () => {
  assert.deepStrictEqual([...usage.familiesInUse([], null, 'opusplan')].sort(), ['opus', 'sonnet']);
  const week = { key: 'seven_day_sonnet', family: 'sonnet', percentUsed: 96, stale: false };
  usage.markApplicable([week], usage.familiesInUse([], null, 'opusplan'));
  assert.strictEqual(week.applies, true);
});

// A scoped weekly names its model by display name. One released after this
// table was written falls back to that raw name, which familyOf() will never
// return for the setting either, so it would be suppressed for ever - while it
// was the very thing being spent.
test('a per-model weekly for a model this table does not know is never suppressed', () => {
  const unknown = { key: 'seven_day_scoped:cirrus', family: 'cirrus', percentUsed: 99, stale: false };
  usage.markApplicable([unknown], usage.familiesInUse([], null, 'opus'));
  assert.strictEqual(unknown.applies, true);
  assert.strictEqual(usage.appliesTo({ family: 'fable' }, new Set(['opus'])), false, 'a known one still is');
});

test('bindingWindow still names a window when the only reading left is a suppressed one', () => {
  const five = { key: 'five_hour', label: '5-hour', percentUsed: null, stale: false, spanMs: 5 * HOUR, applies: true };
  const fable = {
    key: 'seven_day_scoped:fable', label: 'weekly (Fable)', percentUsed: 88, stale: false,
    spanMs: 7 * DAY, headroomMs: MINUTE, applies: false,
  };
  assert.strictEqual(usage.bindingWindow([five, fable]).key, 'seven_day_scoped:fable');
});

