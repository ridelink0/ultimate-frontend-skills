'use strict';

const test = require('node:test');
const assert = require('node:assert');

const recommend = require('../skills/usage-limits/scripts/recommend.js');

// A binding window priced at one dollar a point keeps the arithmetic in the
// tests readable: percentLeft is dollars left, and a median turn of fifty
// cents makes turnsLeft exactly twice the percentage.
function binding(overrides) {
  return Object.assign(
    { key: 'five_hour', label: '5-hour', percentLeft: 50, usdPerPercent: 1, stale: false },
    overrides
  );
}

function inputs(overrides) {
  return Object.assign(
    {
      binding: binding(),
      rates: { median: 0.5, high: 1, sample: 20 },
      settings: { model: 'opus', effortLevel: 'xhigh' },
      recentEffort: null,
      recentTurnsPerHour: null,
      reasoningShare: 0.4,
      sessions: 1,
      codex: false,
      turns: null,
    },
    overrides
  );
}

test('no binding window means no recommendation', () => {
  const decision = recommend.decide(inputs({ binding: null }));
  assert.strictEqual(decision.posture, 'unknown');
  assert.match(decision.reason, /no fresh reading/);
});

test('a stale window is treated as no reading', () => {
  const decision = recommend.decide(inputs({ binding: binding({ stale: true }) }));
  assert.strictEqual(decision.posture, 'unknown');
});

test('no measured turn cost means no recommendation', () => {
  const decision = recommend.decide(inputs({ rates: null }));
  assert.strictEqual(decision.posture, 'unknown');
  assert.match(decision.reason, /turn cost/);
});

test('roomy keeps everything as it is', () => {
  const decision = recommend.decide(inputs());
  assert.strictEqual(decision.posture, 'roomy');
  assert.strictEqual(decision.turnsLeft, 100);
  assert.strictEqual(decision.effort.changes, false);
  assert.strictEqual(decision.effort.target, 'xhigh');
  assert.strictEqual(decision.apply.now, null);
  assert.strictEqual(decision.apply.next, null);
});

test('tight drops effort one notch and spells out both commands', () => {
  const decision = recommend.decide(inputs({ binding: binding({ percentLeft: 10 }) }));
  assert.strictEqual(decision.posture, 'tight');
  assert.strictEqual(decision.turnsLeft, 20);
  assert.strictEqual(decision.effort.target, 'medium');
  assert.strictEqual(decision.effort.changes, true);
  assert.strictEqual(decision.apply.now, '/effort medium');
  assert.match(decision.apply.next, /lowpower\.js on --effort medium/);
  assert.strictEqual(decision.model.delegate, 'sonnet');
  assert.match(decision.apply.delegate, /subagent on sonnet at low effort/);
});

test('critical goes to the floor and moves the next session to sonnet', () => {
  const decision = recommend.decide(inputs({ binding: binding({ percentLeft: 2 }) }));
  assert.strictEqual(decision.posture, 'critical');
  assert.strictEqual(decision.effort.target, 'low');
  assert.strictEqual(decision.model.nextSession, 'sonnet');
  assert.match(decision.apply.next, /--effort low --model sonnet/);
});

test('a small reasoning share vetoes the effort change', () => {
  const decision = recommend.decide(
    inputs({ binding: binding({ percentLeft: 10 }), reasoningShare: 0.04 })
  );
  assert.strictEqual(decision.posture, 'tight');
  assert.strictEqual(decision.effort.changes, false);
  assert.match(decision.effort.why, /4% of output/);
});

test('when the reset wins the race, nothing is economised', () => {
  const decision = recommend.decide(
    inputs({
      binding: binding({ percentLeft: 50, msToReset: 30 * 60 * 1000 }),
      recentTurnsPerHour: 10,
    })
  );
  assert.strictEqual(decision.posture, 'reset-first');
  assert.strictEqual(decision.effort.changes, false);
});

test('a job that does not fit is critical however roomy the window looks', () => {
  const decision = recommend.decide(inputs({ binding: binding({ percentLeft: 20 }), turns: 30 }));
  assert.strictEqual(decision.posture, 'critical');
  assert.match(decision.reason, /30 turn job does not fit/);
});

test('a job that barely fits is tight', () => {
  const decision = recommend.decide(inputs({ binding: binding({ percentLeft: 20 }), turns: 16 }));
  assert.strictEqual(decision.posture, 'tight');
});

test('a small job against a wide window is roomy', () => {
  const decision = recommend.decide(inputs({ binding: binding({ percentLeft: 20 }), turns: 5 }));
  assert.strictEqual(decision.posture, 'roomy');
});

test('the delegate ladder goes one tier down and stops at haiku', () => {
  assert.strictEqual(recommend.delegateModel('opus'), 'sonnet');
  assert.strictEqual(recommend.delegateModel('claude-fable-5'), 'sonnet');
  assert.strictEqual(recommend.delegateModel('sonnet'), 'haiku');
  assert.strictEqual(recommend.delegateModel('haiku'), 'haiku');
  assert.strictEqual(recommend.delegateModel('default'), 'sonnet');
});

test('currentEffort prefers the setting, then the measured effort, then xhigh', () => {
  assert.strictEqual(recommend.currentEffort({ effortLevel: 'high' }, 'low'), 'high');
  assert.strictEqual(recommend.currentEffort({ effortLevel: 'default' }, 'medium'), 'medium');
  assert.strictEqual(recommend.currentEffort({}, null), 'xhigh');
});

test('under Codex the command saves Codex defaults without Claude model advice', () => {
  const decision = recommend.decide(
    inputs({ binding: binding({ percentLeft: 10 }), codex: true })
  );
  assert.match(decision.apply.next, /--host codex/);
  assert.strictEqual(decision.model.delegate, null);
  assert.strictEqual(decision.apply.delegate, null);
  assert.ok(decision.notes.some((note) => /not the running task/.test(note)));
});

test("a current effort of max is warned about, and never written to settings", () => {
  const decision = recommend.decide(
    inputs({
      binding: binding({ percentLeft: 10 }),
      settings: { model: 'opus', effortLevel: 'max' },
    })
  );
  assert.strictEqual(decision.effort.target, 'high');
  assert.match(decision.apply.next, /--effort high/);
  assert.ok(decision.notes.some((note) => /settings\.json does not accept 'max'/.test(note)));
});

test('a second session spending the budget is noted', () => {
  const decision = recommend.decide(
    inputs({ binding: binding({ percentLeft: 10 }), sessions: 2 })
  );
  assert.ok(decision.notes.some((note) => /2 sessions/.test(note)));
});

test('fromReport reduces the report to what decide reads', () => {
  const data = {
    binding: binding(),
    rates: { median: 0.5, high: 1, sample: 9 },
    settings: { model: 'opus', effortLevel: 'xhigh' },
    recent: { turns: 12, effort: 'high' },
    reasoning: { shareOfOutput: 0.3 },
    sessions: [{}, {}],
    money: false,
  };
  const reduced = recommend.fromReport(data, 15);
  assert.strictEqual(reduced.recentEffort, 'high');
  assert.strictEqual(reduced.recentTurnsPerHour, 12);
  assert.strictEqual(reduced.reasoningShare, 0.3);
  assert.strictEqual(reduced.sessions, 2);
  assert.strictEqual(reduced.codex, true);
  assert.strictEqual(reduced.turns, 15);
});

test('renderRecommend explains itself when there is nothing to go on', () => {
  const text = recommend.renderRecommend({}, null);
  assert.match(text, /Nothing to recommend yet/);
  assert.match(text, /Run \/usage once/);
});

test('renderRecommend prints the commands when the budget is tight', () => {
  const data = {
    binding: binding({ percentLeft: 10, msToReset: 90 * 60 * 1000 }),
    rates: { median: 0.5, high: 1, sample: 20 },
    settings: { model: 'opus', effortLevel: 'xhigh' },
    recent: { turns: 0, effort: null },
    reasoning: { shareOfOutput: 0.4 },
    sessions: [{}],
    money: true,
  };
  const text = recommend.renderRecommend(data, null);
  assert.match(text, /Posture {3}tight/);
  assert.match(text, /\/effort medium/);
  assert.match(text, /lowpower\.js on --effort medium/);
  assert.match(text, /resets in 1h 30m/);
});

// The ladder is an assumption. The record is a measurement, and where there is
// one it decides instead.
test('delegateModel sends the bulk to the cheapest model this account has measured', () => {
  const headroom = [
    { family: 'opus', usdPerTurn: 0.211, ownWindow: false, turnsLeft: 1200 },
    { family: 'sonnet', usdPerTurn: 0.012, ownWindow: false, turnsLeft: null },
    { family: 'haiku', usdPerTurn: 0.018, ownWindow: false, turnsLeft: null },
  ];
  assert.strictEqual(recommend.delegateModel('opus', headroom), 'sonnet', 'cheapest measured, not one tier down');
  // Without a record the ladder still answers.
  assert.strictEqual(recommend.delegateModel('opus', null), 'sonnet');
  assert.strictEqual(recommend.delegateModel('sonnet', null), 'haiku');
  // A model whose own weekly is spent is not somewhere to send work.
  const spent = [
    { family: 'opus', usdPerTurn: 0.211, ownWindow: false, turnsLeft: 1200 },
    { family: 'fable', usdPerTurn: 0.01, ownWindow: true, turnsLeft: 0 },
  ];
  assert.strictEqual(recommend.delegateModel('opus', spent), 'sonnet', 'falls back rather than sending work at a wall');
  // Nothing measured is cheaper than what is already running: delegating buys
  // nothing, so do not pretend it does.
  const dearer = [
    { family: 'haiku', usdPerTurn: 0.02, ownWindow: false, turnsLeft: null },
    { family: 'opus', usdPerTurn: 0.9, ownWindow: false, turnsLeft: 10 },
  ];
  assert.strictEqual(recommend.delegateModel('haiku', dearer), 'haiku');
});
