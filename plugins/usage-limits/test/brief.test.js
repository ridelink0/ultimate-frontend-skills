'use strict';

const test = require('node:test');
const assert = require('node:assert');

const brief = require('../skills/usage-limits/scripts/brief.js');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-08-24T12:00:00.000Z');

const config = brief.DEFAULTS;

// A weekly window that opened `elapsed` ago with `percent` of the budget gone.
function weekly(percent, elapsed, extra) {
  return Object.assign(
    {
      key: 'seven_day',
      label: 'weekly',
      percentUsed: percent,
      windowStart: NOW - elapsed,
      spanMs: 7 * DAY,
      msToReset: 7 * DAY - elapsed,
      stale: false,
      verdict: 'resets-first',
      turnsLeft: 40,
    },
    extra
  );
}

test('aheadOfPace measures spending against the clock, not the budget alone', () => {
  // Two days into a week is 28.6% elapsed, so 60% spent is well ahead.
  assert.ok(Math.abs(brief.aheadOfPace(weekly(60, 2 * DAY), NOW) - 31.4) < 0.2);
  assert.ok(Math.abs(brief.aheadOfPace(weekly(29, 2 * DAY), NOW)) < 1);
  assert.ok(brief.aheadOfPace(weekly(10, 2 * DAY), NOW) < 0);
});

test('aheadOfPace gives up rather than guessing', () => {
  assert.strictEqual(brief.aheadOfPace(null, NOW), null);
  assert.strictEqual(brief.aheadOfPace({ percentUsed: 50 }, NOW), null);
});

test('a window in step with the clock reads roomy', () => {
  assert.strictEqual(brief.pressure(weekly(20, 2 * DAY), NOW, config), 'roomy');
  assert.strictEqual(brief.pressure(weekly(29, 2 * DAY), NOW, config), 'roomy');
});

test('the wall reads tight regardless of pace', () => {
  assert.strictEqual(brief.pressure(weekly(92, 6 * DAY), NOW, config), 'tight');
});

// The wall is the only thing that changes behaviour, and it is at 90 per cent.
// Everything below it is reported and nothing below it is discouraged, because
// budget left unspent at the reset is destroyed rather than saved. An earlier
// version escalated from 40 per cent used and spent its time telling sessions
// with a third of their budget left to stop starting things.
test('a budget that is merely well used is not a reason to wind down', () => {
  for (const percent of [60, 75, 85, 89]) {
    assert.strictEqual(
      brief.pressure(weekly(percent, 2 * DAY), NOW, config),
      'roomy',
      percent + '% used, with the rest of it about to expire, is room to work'
    );
  }
});

test('being ahead of the clock is reported, not escalated on', () => {
  // Two days into a week at 60% is well ahead of pace, and that is a fact about
  // how the week is going rather than an instruction to do less today.
  assert.ok(brief.aheadOfPace(weekly(60, 2 * DAY), NOW) > 15);
  assert.strictEqual(brief.pressure(weekly(60, 2 * DAY), NOW, config), 'roomy');
  assert.strictEqual(brief.pressure(weekly(30, HOUR), NOW, config), 'roomy');
});

test('the verdict overrides the arithmetic', () => {
  assert.strictEqual(
    brief.pressure(weekly(12, HOUR, { verdict: 'runs-out' }), NOW, config),
    'tight'
  );
  assert.strictEqual(
    brief.pressure(weekly(100, HOUR, { verdict: 'exhausted' }), NOW, config),
    'gone'
  );
});

test('a stale window is unknown rather than tight', () => {
  assert.strictEqual(
    brief.pressure(weekly(100, 6 * DAY, { stale: true }), NOW, config),
    'unknown',
    'its number is known to be wrong, so it must not drive the wording'
  );
  assert.strictEqual(brief.pressure(null, NOW, config), 'unknown');
});

test('sessionSpend counts only the session it was asked about', () => {
  const events = [
    { sessionId: 'a', cost: 1 },
    { sessionId: 'b', cost: 10 },
    { sessionId: 'a', cost: 2 },
  ];
  assert.deepStrictEqual(brief.sessionSpend(events, 'a'), { turns: 2, cost: 3, tokens: 0 });
  assert.deepStrictEqual(brief.sessionSpend(events, 'b'), { turns: 1, cost: 10, tokens: 0 });
});

test('sessionSpend says nothing rather than zero when it cannot tell', () => {
  assert.strictEqual(brief.sessionSpend([{ sessionId: 'a', cost: 1 }], null), null);
  assert.strictEqual(brief.sessionSpend([{ sessionId: 'a', cost: 1 }], 'missing'), null);
  assert.strictEqual(brief.sessionSpend([], 'a'), null);
});

test('describeWindow reads a window, and flags one that is rolling', () => {
  assert.strictEqual(brief.describeWindow(weekly(16, 2 * DAY)), 'weekly 16%');
  assert.strictEqual(
    brief.describeWindow(Object.assign(weekly(100, 6 * DAY), { stale: true })),
    'weekly rolling over'
  );
  assert.strictEqual(brief.describeWindow(null), null);
});

test('summariseOthers leaves out the binding window itself', () => {
  const five = Object.assign(weekly(70, 1 * DAY), { key: 'five_hour', label: '5-hour' });
  const week = weekly(18, 2 * DAY);
  assert.strictEqual(brief.summariseOthers([five, week], 'five_hour'), 'weekly 18%');
  assert.strictEqual(brief.summariseOthers([five, week], 'seven_day'), '5-hour 70%');
});

test('summariseOthers skips windows with no reading', () => {
  const text = brief.summariseOthers(
    [weekly(16, 2 * DAY), { key: 'x', label: 'x', percentUsed: null }],
    'nothing'
  );
  assert.strictEqual(text, 'weekly 16%');
});

test('the line names the binding window and hangs its numbers off it', () => {
  const text = brief.briefText({
    binding: { key: 'seven_day', label: 'weekly', percentUsed: 16, stale: false },
    othersSummary: '5-hour 47%',
    turnsLeft: 75,
    resetsIn: '3h 52m',
    session: { turns: 229, cost: 64.16 },
    pressure: 'roomy',
  });
  assert.match(text, /^\[usage-limits\] binding window is weekly 16% used/);
  assert.match(text, /about 75 turns of headroom/);
  assert.match(text, /resets in 3h 52m/);
  assert.match(text, /Other windows: 5-hour 47%/);
  assert.match(text, /This session: 229 turns/);
  assert.match(text, /Before work, estimate the turns for the whole request/);
});

test('the numbers cannot be read against the wrong window', () => {
  // The case that actually bit: 5-hour binding at 70%, weekly roomy at 18%.
  // Quoting "weekly 18%, about 52 turns" understates the real constraint.
  const text = brief.briefText({
    binding: { key: 'five_hour', label: '5-hour', percentUsed: 70, stale: false },
    othersSummary: 'weekly 18%',
    turnsLeft: 52,
    resetsIn: '1h 50m',
    session: null,
    pressure: 'tight',
  });
  const binding = text.slice(0, text.indexOf('Other windows'));
  assert.match(binding, /5-hour 70% used/);
  assert.match(binding, /52 turns/);
  assert.match(binding, /1h 50m/);
  assert.doesNotMatch(binding, /weekly/, 'the roomy window must not sit beside those figures');
  assert.match(text, /Quote the binding window; its turns and reset time belong to it alone/);
});

test('a tight budget changes the instruction, not just the numbers', () => {
  const text = brief.briefText({
    binding: { key: 'seven_day', label: 'weekly', percentUsed: 88, stale: false },
    othersSummary: '',
    turnsLeft: 6,
    resetsIn: '40m',
    session: null,
    pressure: 'tight',
  });
  assert.match(text, /nearly gone/);
  assert.doesNotMatch(text, /confirming the request fits/);

  // The contract, not the wording. Near the wall the work still gets done in
  // full; what changes is that being cut off is made cheap. Deciding on the
  // user's behalf to do less of what they asked spends their request to protect
  // a budget that expires anyway, and they did not ask for that trade.
  assert.match(text, /whole request/);
  assert.match(text, /keep working/i);
  assert.doesNotMatch(
    text,
    /do not start anything new|stop adding work|leave for after the reset/i,
    'near the wall must not truncate the plan; scaling the work down is a decision for the user, not for the plugin'
  );
  // And it must still make the cutoff survivable.
  assert.match(text, /valuable part lands first/);
  assert.match(text, /save at clean boundaries/);
  assert.match(text, /which files are mid-change/);
});

test('the line still works when parts are missing', () => {
  const text = brief.briefText({
    binding: { key: 'seven_day', label: 'weekly', percentUsed: 16, stale: false },
    othersSummary: '',
    turnsLeft: null,
    resetsIn: null,
    session: null,
    pressure: 'roomy',
  });
  assert.match(text, /weekly 16%/);
  assert.doesNotMatch(text, /turns of headroom/);
  assert.doesNotMatch(text, /resets in/);
  assert.doesNotMatch(text, /This session/);
  assert.doesNotMatch(text, /Other windows/);
});

test('thresholds are configurable through the environment', () => {
  const previous = process.env.USAGE_LIMITS_NEAR;
  process.env.USAGE_LIMITS_NEAR = '55';
  try {
    const settings = brief.settings();
    assert.strictEqual(settings.near, 55);
    assert.strictEqual(settings.floor, brief.DEFAULTS.floor, 'unset values keep defaults');
  } finally {
    if (previous === undefined) delete process.env.USAGE_LIMITS_NEAR;
    else process.env.USAGE_LIMITS_NEAR = previous;
  }
});

test('nonsense in the environment falls back rather than producing NaN', () => {
  const previous = process.env.USAGE_LIMITS_NEAR;
  process.env.USAGE_LIMITS_NEAR = 'soon';
  try {
    assert.strictEqual(brief.settings().near, brief.DEFAULTS.near);
  } finally {
    if (previous === undefined) delete process.env.USAGE_LIMITS_NEAR;
    else process.env.USAGE_LIMITS_NEAR = previous;
  }
});

test('the off switch wins over everything', async () => {
  const previous = process.env.USAGE_LIMITS_BRIEF;
  process.env.USAGE_LIMITS_BRIEF = 'off';
  try {
    assert.strictEqual(await brief.run(NOW, { session_id: 'a' }), '');
  } finally {
    if (previous === undefined) delete process.env.USAGE_LIMITS_BRIEF;
    else process.env.USAGE_LIMITS_BRIEF = previous;
  }
});

test('pickCached returns a slot that is still warm', () => {
  const all = { alpha: { at: NOW - 10 * 1000, turnsLeft: 40 } };
  const hit = brief.pickCached(all, 'alpha', NOW, 60 * 1000);
  assert.strictEqual(hit.turnsLeft, 40);
});

test('pickCached ignores a slot that has gone cold', () => {
  const all = { alpha: { at: NOW - 90 * 1000, turnsLeft: 40 } };
  assert.strictEqual(brief.pickCached(all, 'alpha', NOW, 60 * 1000), null);
});

test('one session never reads another session slot', () => {
  const all = { alpha: { at: NOW, turnsLeft: 40 } };
  assert.strictEqual(brief.pickCached(all, 'beta', NOW, 60 * 1000), null);
});

test('pickCached survives a missing or malformed cache', () => {
  assert.strictEqual(brief.pickCached(null, 'a', NOW, 1000), null);
  assert.strictEqual(brief.pickCached({}, 'a', NOW, 1000), null);
  assert.strictEqual(brief.pickCached({ a: {} }, 'a', NOW, 1000), null);
  assert.strictEqual(brief.pickCached({ a: { at: 'soon' } }, 'a', NOW, 1000), null);
});

test('a session with no id still gets a slot of its own', () => {
  const merged = brief.mergeCache({}, null, { at: NOW, turnsLeft: 5 }, 5);
  assert.deepStrictEqual(Object.keys(merged), ['_']);
  assert.strictEqual(brief.pickCached(merged, null, NOW, 60 * 1000).turnsLeft, 5);
});

test('mergeCache keeps other sessions rather than replacing them', () => {
  const existing = { alpha: { at: NOW - 5000, turnsLeft: 40 } };
  const merged = brief.mergeCache(existing, 'beta', { at: NOW, turnsLeft: 12 }, 5);
  assert.deepStrictEqual(Object.keys(merged).sort(), ['alpha', 'beta']);
  assert.strictEqual(merged.alpha.turnsLeft, 40, 'the other session must survive');
});

test('mergeCache prunes the oldest so the file cannot grow forever', () => {
  let all = {};
  for (let i = 0; i < 8; i += 1) {
    all = brief.mergeCache(all, 'session' + i, { at: NOW + i, turnsLeft: i }, 3);
  }
  const keys = Object.keys(all);
  assert.strictEqual(keys.length, 3);
  assert.deepStrictEqual(keys.sort(), ['session5', 'session6', 'session7'], 'newest survive');
});

test('mergeCache defaults to the shipped slot count', () => {
  let all = {};
  for (let i = 0; i < 9; i += 1) {
    all = brief.mergeCache(all, 's' + i, { at: NOW + i, turnsLeft: i });
  }
  assert.strictEqual(Object.keys(all).length, brief.KEEP_SESSIONS);
});

test('a cache from before per-session slots is discarded, not carried forward', () => {
  // What 1.1.1 wrote: the fields sat at the top level, with no session key.
  const old = { at: NOW - 5000, turnsLeft: 40, session: { turns: 3, cost: 1 }, sessionId: 'old' };
  assert.deepStrictEqual(
    brief.keepSlots(old),
    {},
    'carrying those forward would squat four of the five slots'
  );
});

test('keepSlots keeps real slots and drops the rest', () => {
  const mixed = {
    alpha: { at: NOW, turnsLeft: 10 },
    at: 12345,
    session: { turns: 3, cost: 1 },
    beta: { at: NOW - 1000, turnsLeft: 20 },
    broken: { turnsLeft: 5 },
  };
  assert.deepStrictEqual(Object.keys(brief.keepSlots(mixed)).sort(), ['alpha', 'beta']);
});

test('keepSlots survives anything at all', () => {
  assert.deepStrictEqual(brief.keepSlots(null), {});
  assert.deepStrictEqual(brief.keepSlots('nonsense'), {});
  assert.deepStrictEqual(brief.keepSlots(42), {});
  assert.deepStrictEqual(brief.keepSlots({}), {});
});

test('a rebuilt reading is hedged, a read one is not', () => {
  assert.strictEqual(brief.describeWindow(weekly(41, 2 * DAY)), 'weekly 41%');
  assert.strictEqual(
    brief.describeWindow(Object.assign(weekly(41, 2 * DAY), { estimated: true })),
    'weekly about 41%',
    'a derived number must not read as a measured one'
  );
});

test('the line explains a rebuilt reading and how to replace it', () => {
  const text = brief.briefText({
    binding: { key: 'five_hour', label: '5-hour', percentUsed: 41, stale: false, estimated: true },
    othersSummary: 'weekly 34%',
    turnsLeft: 30,
    resetsIn: null,
    session: null,
    rebuilt: true,
    snapshotAge: '10h 19m',
    pressure: 'tight',
  });
  assert.match(text, /5-hour about 41% used/);
  assert.match(text, /rebuilt from local history/);
  assert.match(text, /snapshot is 10h 19m old/);
  assert.match(text, /run \/usage/);
});

test('a normal reading says nothing about rebuilding', () => {
  const text = brief.briefText({
    binding: { key: 'five_hour', label: '5-hour', percentUsed: 41, stale: false, estimated: false },
    othersSummary: 'weekly 34%',
    turnsLeft: 30,
    resetsIn: '2h',
    session: null,
    rebuilt: false,
    snapshotAge: '3m',
    pressure: 'roomy',
  });
  assert.doesNotMatch(text, /rebuilt from local history/);
  assert.doesNotMatch(text, /run \/usage/);
});

test('an exhausted budget is the only state that stops the work', () => {
  const text = brief.briefText({
    binding: { key: 'five_hour', label: '5-hour', percentUsed: 90, stale: false },
    othersSummary: '',
    turnsLeft: 4,
    resetsIn: '20m',
    session: null,
    pressure: 'gone',
  });
  assert.match(text, /budget is gone/);
  assert.match(text, /write the handoff/);
  assert.doesNotMatch(
    text,
    /sending them together/,
    'asking someone to batch their prompts is a saving measure, and there is nothing left to save'
  );

  // Nearly gone is not gone: that one carries on.
  const nearly = brief.briefText(Object.assign({}, {
    binding: { key: 'five_hour', label: '5-hour', percentUsed: 90, stale: false },
    othersSummary: '',
    turnsLeft: 4,
    resetsIn: '20m',
    session: null,
    pressure: 'tight',
  }));
  assert.match(nearly, /Carry on with the whole request/);
});

const rolling = {
  key: 'five_hour',
  label: '5-hour',
  percentUsed: 61,
  stale: false,
  estimated: true,
  windowStart: NOW - 5 * HOUR,
  spanMs: 5 * HOUR,
  verdict: 'burning',
};

test('a short turn count is tight whatever the percentage says', () => {
  assert.strictEqual(brief.pressure(rolling, NOW, config, 30), 'roomy');
  assert.strictEqual(brief.pressure(rolling, NOW, config, 12), 'roomy');
  assert.strictEqual(brief.pressure(rolling, NOW, config, 8), 'tight');
});

// The failure this reproduces: on 2026-08-30 three sessions were cut off by the
// 5-hour limit at 23:31Z. Nine minutes earlier the window had been rebuilt at
// 58%, with headroomMs of 43 minutes and no reset time, so its verdict was
// 'burning'. Every escalation branch looked at something else - the percentage,
// the turn count, the pace against the clock - and none of them looked at the
// one figure that said the budget was nearly gone. The brief said it fitted
// easily.
test('a window with little runway left is tight even with no reset time', () => {
  const burning = Object.assign({}, rolling, {
    percentUsed: 58,
    verdict: 'burning',
    msToReset: null,
    headroomMs: 6 * MINUTE,
  });
  assert.strictEqual(
    brief.pressure(burning, NOW, config, 231),
    'tight',
    'six minutes is not enough to land the work, whatever the percentage says'
  );
});

// The escalation above is judged against the cached copy of the window, not the
// window itself, so a field the cache drops is a field the decision never sees.
// headroomMs was dropped, which made the runway rule dead in production while
// every test of it passed.
test('the cache keeps every field the pressure decision reads', () => {
  const window = { key: 'five_hour', label: '5-hour', percentUsed: 58, headroomMs: 43 * MINUTE };
  const cached = brief.cacheableBinding(window);
  for (const field of brief.pressureInputs()) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(cached, field),
      field + ' is read by pressure() but not kept in the cache'
    );
  }
  assert.strictEqual(cached.headroomMs, 43 * MINUTE);
  assert.strictEqual(brief.cacheableBinding(null), null);
});

test('a cached window is judged the same as a fresh one', () => {
  const fresh = Object.assign({}, rolling, {
    percentUsed: 58,
    verdict: 'burning',
    msToReset: null,
    headroomMs: 43 * MINUTE,
  });
  assert.strictEqual(
    brief.pressure(brief.cacheableBinding(fresh), NOW, config, 231),
    brief.pressure(fresh, NOW, config, 231)
  );
});

// A five hour window resets whole, so holding budget back in one buys nothing.
// Anchoring the window start correctly at its reset made this worse rather than
// better: twenty minutes in, the elapsed fraction is tiny, so any real work
// reads as far ahead of the clock. That is how 44% used came to be reported as
// tight, which is the plugin telling someone to slow down for no gain.
test('a short window is not paced, only measured', () => {
  const justReset = {
    key: 'five_hour',
    label: '5-hour',
    percentUsed: 44,
    stale: false,
    estimated: false,
    windowStart: NOW - 20 * MINUTE,
    spanMs: 5 * HOUR,
    msToReset: 5 * HOUR - 20 * MINUTE,
    verdict: 'burning',
  };
  assert.strictEqual(brief.pacingMatters(justReset, NOW), false);
  assert.strictEqual(
    brief.pressure(justReset, NOW, config, 190),
    'roomy',
    '44% of a window that resets in hours is room to work, not a reason to slow down'
  );
});

test('a weekly window is still paced once enough of it has gone', () => {
  assert.strictEqual(brief.pacingMatters(weekly(60, 2 * DAY), NOW), true);
  // Still true, and still only information: it does not make the budget tight.
  assert.strictEqual(brief.pressure(weekly(60, 2 * DAY), NOW, config), 'roomy');
  // Early on, the elapsed fraction dominates and the comparison says nothing.
  assert.strictEqual(brief.pacingMatters(weekly(30, HOUR), NOW), false);
});

test('a short window still escalates on the runway that actually binds', () => {
  // Removing the pace rule must not remove the warning: the measured runway is
  // what replaces it, and it is the honest version of the same concern.
  const burning = {
    key: 'five_hour',
    label: '5-hour',
    percentUsed: 44,
    stale: false,
    estimated: false,
    windowStart: NOW - 20 * MINUTE,
    spanMs: 5 * HOUR,
    msToReset: 5 * HOUR - 20 * MINUTE,
    verdict: 'burning',
    headroomMs: 5 * MINUTE,
  };
  assert.strictEqual(brief.pressure(burning, NOW, config, 190), 'tight');
});

test('plenty of runway is still roomy', () => {
  const easy = Object.assign({}, rolling, {
    percentUsed: 30,
    verdict: 'burning',
    msToReset: null,
    headroomMs: 6 * HOUR,
  });
  assert.strictEqual(brief.pressure(easy, NOW, config, 400), 'roomy');
});

test('the runway that binds is the one the whole account is burning', () => {
  // headroomMs is measured from every session's spend, not just this one, so it
  // already carries the cost of sharing. That is exactly why it is the figure
  // to escalate on when several agents are running.
  const shared = Object.assign({}, rolling, {
    percentUsed: 40,
    verdict: 'burning',
    msToReset: null,
    headroomMs: 4 * MINUTE,
  });
  assert.strictEqual(brief.pressure(shared, NOW, config, 900), 'tight');
});

test('a rebuilt figure is held to the same wall as a measured one', () => {
  // It used to be escalated from 70% because a rebuilt reading only counts this
  // machine and so reads low. The runway and the spend-since-snapshot
  // correction both cover that better, and reacting early to a number that is
  // merely uncertain is how a session with a quarter of its budget left was
  // told to wind down.
  const higher = Object.assign({}, rolling, { percentUsed: 72 });
  assert.strictEqual(brief.pressure(higher, NOW, config, 500), 'roomy');
  // Same percentage, and deliberately not ahead of pace either: four hours into
  // a five hour window, 72% is roughly on schedule. The only difference left is
  // whether the figure was measured or rebuilt.
  const measured = Object.assign({}, higher, {
    estimated: false,
    windowStart: NOW - 4 * HOUR,
  });
  assert.strictEqual(
    brief.pressure(measured, NOW, config, 500),
    'roomy',
    '72% is not near the wall, measured or rebuilt'
  );
});

test('pace is not consulted for a rolling window', () => {
  // windowStart is now minus the span, so it is always "fully elapsed" and the
  // pace comparison would never fire. It must not be what decides this.
  assert.strictEqual(brief.aheadOfPace(rolling, NOW), 61 - 100);
  assert.strictEqual(brief.pressure(rolling, NOW, config, 500), 'roomy');
});

test('the few-turns threshold is configurable', () => {
  const previous = process.env.USAGE_LIMITS_FEW_TURNS;
  process.env.USAGE_LIMITS_FEW_TURNS = '40';
  try {
    assert.strictEqual(brief.settings().fewTurns, 40);
    assert.strictEqual(brief.pressure(rolling, NOW, brief.settings(), 30), 'tight');
  } finally {
    if (previous === undefined) delete process.env.USAGE_LIMITS_FEW_TURNS;
    else process.env.USAGE_LIMITS_FEW_TURNS = previous;
  }
});

test('the line says how many of those turns are actually yours', () => {
  const text = brief.briefText({
    binding: { key: 'five_hour', label: '5-hour', percentUsed: 30, stale: false },
    othersSummary: 'weekly 38%',
    turnsLeft: 169,
    yourTurnsLeft: 101,
    sessions: 2,
    resetsIn: '3h',
    session: null,
    pressure: 'roomy',
  });
  assert.match(text, /about 169 turns of headroom/);
  assert.match(text, /2 sessions active, roughly 101 of them yours/);
});

test('a session working alone is not told about sharing', () => {
  const text = brief.briefText({
    binding: { key: 'five_hour', label: '5-hour', percentUsed: 30, stale: false },
    othersSummary: '',
    turnsLeft: 169,
    yourTurnsLeft: 169,
    sessions: 1,
    resetsIn: '3h',
    session: null,
    pressure: 'roomy',
  });
  assert.match(text, /about 169 turns of headroom, resets in 3h/);
  assert.doesNotMatch(text, /sessions active/);
  assert.doesNotMatch(text, /of them yours/);
});

test('a window it could not rebuild is called unknown, and the fix is named', () => {
  const text = brief.briefText({
    binding: { key: 'seven_day', label: 'weekly', percentUsed: 57, stale: false },
    othersSummary: '5-hour rolling over',
    turnsLeft: 100,
    resetsIn: '5d',
    session: null,
    rebuilt: false,
    staleWindows: 1,
    snapshotAge: '10h',
    pressure: 'roomy',
  });
  assert.match(text, /could not be rebuilt/);
  assert.match(text, /unknown rather than current/);
  assert.match(text, /run \/usage/);
});

test('a rebuilt window explains itself instead of the unknown wording', () => {
  const text = brief.briefText({
    binding: { key: 'five_hour', label: '5-hour', percentUsed: 41, stale: false, estimated: true },
    othersSummary: 'weekly 34%',
    turnsLeft: 30,
    resetsIn: null,
    session: null,
    rebuilt: true,
    staleWindows: 1,
    snapshotAge: '10h',
    pressure: 'tight',
  });
  assert.match(text, /rebuilt from local history/);
  assert.doesNotMatch(text, /could not be rebuilt/);
});

test('nothing stale means neither message appears', () => {
  const text = brief.briefText({
    binding: { key: 'five_hour', label: '5-hour', percentUsed: 49, stale: false },
    othersSummary: 'weekly 57%',
    turnsLeft: 105,
    resetsIn: '4h',
    session: null,
    rebuilt: false,
    staleWindows: 0,
    snapshotAge: '2m',
    pressure: 'roomy',
  });
  assert.doesNotMatch(text, /could not be rebuilt/);
  assert.doesNotMatch(text, /rebuilt from local history/);
});

test('an adjusted figure is hedged, an untouched one is not', () => {
  const adjusted = { key: 'five_hour', label: '5-hour', percentUsed: 88, stale: false, adjusted: true };
  const plain = { key: 'five_hour', label: '5-hour', percentUsed: 49, stale: false, adjusted: false };
  assert.strictEqual(brief.describeWindow(adjusted), '5-hour about 88%');
  assert.strictEqual(brief.describeWindow(plain), '5-hour 49%');
});

test('the line explains points added since the snapshot', () => {
  const text = brief.briefText({
    binding: { key: 'five_hour', label: '5-hour', percentUsed: 88, stale: false, adjusted: true },
    othersSummary: 'weekly 57%',
    turnsLeft: 12,
    resetsIn: '4h',
    session: null,
    rebuilt: false,
    staleWindows: 0,
    pointsSinceSnapshot: 39,
    snapshotAge: '9m',
    pressure: 'tight',
  });
  assert.match(text, /about 39 points spent since the snapshot/);
  assert.match(text, /9m ago/);
});

test('a near-full window is called out even when something else binds', () => {
  const text = brief.briefText({
    binding: { key: 'five_hour', label: '5-hour', percentUsed: 68, stale: false },
    othersSummary: 'weekly 91%',
    turnsLeft: 41,
    resetsIn: '4h 20m',
    session: null,
    critical: [{ label: 'weekly', percentUsed: 91, resetsIn: '4d 2h' }],
    pressure: 'roomy',
  });
  assert.match(text, /weekly is at 91% and resets in 4d 2h/);
  assert.match(text, /stops work for far longer/);
  assert.match(text, /not what runs out first/);
});

test('nothing is called out when the other windows are comfortable', () => {
  const text = brief.briefText({
    binding: { key: 'five_hour', label: '5-hour', percentUsed: 68, stale: false },
    othersSummary: 'weekly 40%',
    turnsLeft: 41,
    resetsIn: '4h 20m',
    session: null,
    critical: [],
    pressure: 'roomy',
  });
  assert.doesNotMatch(text, /stops work for far longer/);
});

test('activeShare counts sessions that have prompted as well as those that have spent', () => {
  const slots = { a: { at: NOW - MINUTE }, b: { at: NOW - 2 * MINUTE }, old: { at: NOW - HOUR } };
  const spent = [{ sessionId: 'a', share: 0.9, turns: 20 }, { sessionId: 'fresh', share: 0.1, turns: 1 }];
  const found = brief.activeShare(spent, slots, NOW, 'fresh');
  assert.strictEqual(found.active, 3, 'a and b are live, plus this one');
  assert.ok(Math.abs(found.share - 1 / 3) < 1e-9, 'a fresh session gets an equal split, not its sliver of past spend');
  assert.deepStrictEqual(brief.activeShare([], {}, NOW, 'fresh'), { active: 1, share: 1 });
  assert.deepStrictEqual(brief.activeShare(null, null, NOW, null), { active: 1, share: 1 });
});

// A per-model weekly caps one model's spend. Naming it in the line without
// saying whose it is put 88% next to the other percentages, where it read as
// 88% of the budget in hand and sized the reply down against a limit not one
// turn of this session could move.
test('a window this session cannot spend into is named as one', () => {
  const fable = {
    key: 'seven_day_scoped:fable', label: 'weekly (Fable)', percentUsed: 88,
    stale: false, applies: false,
  };
  assert.strictEqual(brief.describeWindow(fable), "weekly (Fable) 88% (not this session's model)");
  const five = { key: 'five_hour', label: '5-hour', percentUsed: 9, stale: false, applies: true };
  assert.strictEqual(brief.describeWindow(five), '5-hour 9%');
  assert.strictEqual(
    brief.summariseOthers([five, fable], 'five_hour'),
    "weekly (Fable) 88% (not this session's model)"
  );
});

test('a per-model weekly says that only a model switch frees it', () => {
  const near = {
    binding: { key: 'seven_day_scoped:fable', label: 'weekly (Fable)', family: 'fable', percentUsed: 66, applies: true, verdict: 'burning' },
    othersSummary: '5-hour 12%',
    turnsLeft: 300,
    yourTurnsLeft: 300,
    family: 'Fable',
    pressure: 'roomy',
  };
  const text = brief.briefText(near);
  assert.match(text, /counts Fable turns only/);
  assert.match(text, /lowering effort does not free it/);
  // It names the lever and leaves the pulling of it to the user. The model
  // this session runs is a user-plane setting: /model is typed by a person and
  // lowpower.js writes settings.json, so a sentence here telling the agent to
  // go and change it is the two-planes rule broken in the one channel that
  // reaches the model.
  assert.match(text, /the user's own setting to change/);
  assert.match(text, /say so in one line rather than changing it/);
  assert.doesNotMatch(text, /lowpower/, 'never the settings.json writer, unasked');
  // And it still says what IS the agent's, so "leave it alone" does not read
  // as "there is nothing you can do".
  assert.match(text, /the model on anything you spawn/);

  // Nothing said for a shared window, or for a per-model week with room left.
  const shared = brief.briefText({ binding: { key: 'five_hour', label: '5-hour', percentUsed: 66 }, pressure: 'roomy' });
  assert.strictEqual(shared.indexOf('counts'), -1);
});

// Fast mode, per code.claude.com/docs/en/fast-mode: on a subscription it is
// "available via usage credits only and not included in the subscription rate
// limits", and per /docs/en/prompt-caching the first request sent with it on
// "reads the entire conversation history with no cache hits". One clause, in
// the opening line, only while it is on.
test('fast mode is one clause of the opening line, and only when it is on', () => {
  const on = brief.briefText({
    binding: { key: 'five_hour', label: '5-hour', percentUsed: 28, stale: false },
    turnsLeft: 159,
    resetsIn: '2h 10m',
    pressure: 'roomy',
    fastMode: true,
  });
  const opening = on.split('\n')[0].split('. ')[0];
  assert.match(
    opening,
    /^\[usage-limits\] binding window is 5-hour 28% used, about 159 turns of headroom, resets in 2h 10m; fast mode on, billed from usage credits rather than this window, and its first turn re-reads the whole context uncached\.$/
  );
  assert.strictEqual(on.split('fast mode').length, 2, 'said once');

  const off = brief.briefText({
    binding: { key: 'five_hour', label: '5-hour', percentUsed: 28, stale: false },
    turnsLeft: 159,
    resetsIn: '2h 10m',
    pressure: 'roomy',
    fastMode: false,
  });
  assert.doesNotMatch(off, /fast mode/);
  assert.doesNotMatch(brief.briefText({ binding: null, pressure: 'unknown' }), /fast mode/, 'absent means off');
  // With no window reading it still belongs to the opening line.
  assert.match(brief.briefText({ binding: null, pressure: 'unknown', fastMode: true }), /^\[usage-limits\] no usable window reading; fast mode on,/);
});

test('fastModeFor reads the fast_mode the status line recorded for this session', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const feed = require('../skills/usage-limits/scripts/feed.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-brief-fast-'));
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    assert.strictEqual(brief.fastModeFor('s1'), false, 'no feed yet reads as off');
    let all = feed.record({}, { session_id: 's1', model: { id: 'claude-opus-5' }, fast_mode: true }, NOW);
    all = feed.record(all, { session_id: 's2', model: { id: 'claude-opus-5' } }, NOW);
    feed.writeFeed(all);
    assert.strictEqual(brief.fastModeFor('s1'), true);
    assert.strictEqual(brief.fastModeFor('s2'), false, 'another session with it off');
    assert.strictEqual(brief.fastModeFor(null), false);
    fs.writeFileSync(feed.feedFile(), '{not json');
    assert.strictEqual(brief.fastModeFor('s1'), false, 'a broken feed file is off, never a throw');
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The corrected figure is the snapshot plus local spend at a learned price. It
// can land on either side of the account - on 2026-09-20 it ran 13 to 17 points
// high - so it is an estimate. Only the refused correction, where the raw
// snapshot is all that is shown, is a lower bound and may be called a floor.
test('an aged snapshot is called an estimate; only a refused correction is a floor', () => {
  const base = {
    binding: { key: 'five_hour', label: '5-hour', percentUsed: 63, stale: false },
    turnsLeft: 40,
    resetsIn: '2h',
    pressure: 'roomy',
    snapshotAge: '24m',
  };
  const aged = brief.briefText(Object.assign({}, base, { snapshotStale: true }));
  assert.match(aged, /Treat that percentage as an estimate rather than a reading, high or low: the account snapshot behind it is 24m old/);
  assert.doesNotMatch(aged, /floor/);

  const refused = brief.briefText(Object.assign({}, base, { correctionUnreliable: true, pointsBeyondSnapshot: 12 }));
  assert.match(refused, /5-hour 63% used at the last real reading/);
  assert.match(refused, /That percentage is a floor, not a current reading/);
  assert.doesNotMatch(refused, /estimate rather than a reading/);
});
