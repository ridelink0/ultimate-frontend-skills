'use strict';

const test = require('node:test');
const assert = require('node:assert');

const codex = require('../skills/usage-limits/scripts/codex.js');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function window(usedPercent, minutes, resetsAtSeconds) {
  return { used_percent: usedPercent, window_minutes: minutes, resets_at: resetsAtSeconds };
}

function meter(extra) {
  return Object.assign(
    {
      limit_id: 'codex',
      plan_type: 'plus',
      credits: { has_credits: false, unlimited: false, balance: '0' },
    },
    extra
  );
}

// Which windows exist is a property of the plan, and it changes: the five-hour
// window was withdrawn from Plus and later reinstated, Enterprise on flexible
// pricing has none at all, and Business tiers have been seen reporting none.
// So none of it may be assumed from the plan name.

test('both windows are read when the plan reports both', () => {
  const mapped = codex.utilizationFrom(
    meter({ primary: window(61, 300, 1788137905), secondary: window(57, 10080, 1788644513) })
  );
  assert.deepStrictEqual(Object.keys(mapped.utilization), ['five_hour', 'seven_day']);
  assert.strictEqual(mapped.utilization.five_hour.utilization, 61);
  assert.strictEqual(mapped.utilization.seven_day.utilization, 57);
  assert.strictEqual(mapped.windowless, false);
  assert.deepStrictEqual(
    mapped.specs.map((spec) => [spec.key, spec.label, spec.span]),
    [
      ['five_hour', '5-hour', 5 * HOUR],
      ['seven_day', 'weekly', 7 * DAY],
    ]
  );
});

test('a window the plan does not report is not invented', () => {
  const mapped = codex.utilizationFrom(meter({ primary: null, secondary: window(40, 10080, 1) }));
  assert.deepStrictEqual(Object.keys(mapped.utilization), ['seven_day']);
  assert.strictEqual(mapped.utilization.five_hour, undefined, 'no five-hour window is conjured');
  assert.strictEqual(mapped.specs.length, 1);
});

test('a missing slot and a malformed slot are both simply absent', () => {
  const mapped = codex.utilizationFrom(
    meter({ primary: { used_percent: 'lots', window_minutes: 300 }, secondary: window(3, 10080, 1) })
  );
  assert.deepStrictEqual(Object.keys(mapped.utilization), ['seven_day']);
});

// The bug this guards: filing a window under the key of the slot it arrived in.
// A seven-day window in the primary slot would have been called `five_hour`,
// and then priced with a calibration measured for a five-hour window.
test('a window is filed by its own length, not by which slot it came in', () => {
  const mapped = codex.utilizationFrom(meter({ primary: window(20, 10080, 1), secondary: null }));
  assert.deepStrictEqual(Object.keys(mapped.utilization), ['seven_day']);
  assert.strictEqual(mapped.specs[0].label, 'weekly');
  assert.strictEqual(mapped.specs[0].span, 7 * DAY);
});

test('an unfamiliar window length is named by its length rather than guessed at', () => {
  const mapped = codex.utilizationFrom(meter({ primary: window(10, 180, 1), secondary: null }));
  const [spec] = mapped.specs;
  assert.strictEqual(spec.span, 3 * HOUR);
  assert.strictEqual(spec.label, '3-hour');
  assert.strictEqual(spec.key, 'window_180m', 'it gets a calibration of its own');
});

test('two windows of the same length do not overwrite each other', () => {
  const mapped = codex.utilizationFrom(
    meter({ primary: window(10, 300, 1), secondary: window(80, 300, 2) })
  );
  assert.strictEqual(Object.keys(mapped.utilization).length, 2);
  assert.deepStrictEqual(Object.keys(mapped.utilization), ['five_hour', 'five_hour_2']);
  assert.strictEqual(mapped.utilization.five_hour_2.utilization, 80);
});

// Enterprise and Edu on flexible pricing report no rolling window at all: usage
// scales with credits. That is an answer, not a missing reading, and throwing it
// away would discard the only figures such an account has.
test('a plan with no rolling window keeps its plan and its credits', () => {
  const mapped = codex.utilizationFrom(
    meter({
      plan_type: 'enterprise_cbp_usage_based',
      primary: null,
      secondary: null,
      credits: { has_credits: true, unlimited: false, balance: '4200' },
    })
  );
  assert.strictEqual(mapped.windowless, true);
  assert.strictEqual(mapped.utilization, null);
  assert.strictEqual(mapped.planType, 'enterprise_cbp_usage_based');
  assert.strictEqual(mapped.credits.balance, '4200');
  assert.strictEqual(mapped.credits.enabled, true);
});

// The meter can come back with its window slots present but empty - seen
// minutes after a limit hit. That is a reading without numbers, and it must not
// be reported as an account with no window at all.
test('a slot with no readable percentage is unreadable, not windowless', () => {
  const mapped = codex.utilizationFrom(
    meter({ plan_type: 'plus', primary: { used_percent: null, window_minutes: 300 }, secondary: { window_minutes: 10080 } })
  );
  assert.strictEqual(mapped.windowless, false);
  assert.strictEqual(mapped.unreadable, true);
  assert.strictEqual(mapped.utilization, null);
});

// Plus, Pro, Go and Free are always metered by windows. A Plus meter with no
// window slots at all is a failed reading, which is what Codex saw minutes
// after a limit hit on 2026-09-07 and was told was flexible pricing.
test('a consumer plan with no window slots is unreadable, not flexible pricing', () => {
  const mapped = codex.utilizationFrom(meter({ plan_type: 'plus', primary: null, secondary: null }));
  assert.strictEqual(mapped.windowless, false);
  assert.strictEqual(mapped.unreadable, true);
});

test('a null percentage is not zero percent used', () => {
  const mapped = codex.utilizationFrom(meter({ primary: window(null, 300, 1788137905), secondary: window(57, 10080, 1788644513) }));
  assert.deepStrictEqual(Object.keys(mapped.utilization), ['seven_day']);
});

test('the plan names the API reports are all recognised', () => {
  for (const id of ['free', 'go', 'plus', 'pro', 'prolite', 'business', 'team', 'enterprise', 'edu']) {
    const plan = codex.planFrom(id);
    assert.ok(plan.label.startsWith('ChatGPT'), id + ' should have a proper label');
    assert.strictEqual(plan.id, id);
  }
  assert.strictEqual(codex.planFrom('free').label, 'ChatGPT Free');
  assert.strictEqual(codex.planFrom('pro').label, 'ChatGPT Pro');
  assert.ok(
    codex.planFrom('pro').advice.indexOf('five-hour') !== -1,
    'Pro has the five-hour window too, and the advice must not imply otherwise'
  );
});

test('a plan name we have not seen is shown, not called unknown', () => {
  const plan = codex.planFrom('plus_ultra_2027');
  assert.strictEqual(plan.id, 'plus_ultra_2027');
  assert.ok(plan.label.indexOf('plus_ultra_2027') !== -1);
  assert.strictEqual(plan.advice, null);
});

test('no plan at all is unknown rather than a fabricated name', () => {
  assert.strictEqual(codex.planFrom(null).id, 'unknown');
  assert.strictEqual(codex.planFrom(null).label, 'unknown');
});

// The measured calibration. Codex logs the meter beside every request, so the
// price of a point is the spend between two readings over how far the meter
// moved, rather than something the user has to count by hand.
function event(at, cost, percent, resetsAt) {
  return {
    at,
    cost,
    meter: percent === undefined ? null : { primary: window(percent, 300, resetsAt || 999) },
  };
}

test('calibrate measures the price of a point from meter movement', () => {
  const events = [
    event(1000, 0, 10),
    event(2000, 1),
    event(3000, 1),
    event(4000, 1),
    event(5000, 1),
    event(6000, 1, 20),
  ];
  const measured = codex.calibrate(events, 'five_hour', 7000);
  assert.strictEqual(measured.usdPerPercent, 0.5, 'five units of spend moved it ten points');
  assert.strictEqual(measured.turns, 5);
  assert.strictEqual(measured.percent, 20);
});

test('calibrate refuses a sample too thin to mean anything', () => {
  const events = [event(1000, 0, 10), event(2000, 1), event(3000, 1, 20)];
  assert.strictEqual(codex.calibrate(events, 'five_hour', 4000), null, 'two turns is not a pace');
});

test('calibrate refuses when the meter barely moved', () => {
  const events = [
    event(1000, 0, 10),
    event(2000, 1),
    event(3000, 1),
    event(4000, 1),
    event(5000, 1),
    event(6000, 1, 11),
  ];
  assert.strictEqual(codex.calibrate(events, 'five_hour', 7000), null, 'one point is rounding');
});

test('calibrate never pairs readings across a reset', () => {
  // The meter falls at a reset. Pairing across it would price a point at almost
  // nothing and report a budget many times the real one.
  const events = [
    event(1000, 0, 90, 111),
    event(2000, 1, undefined),
    event(3000, 5, 4, 222),
    event(4000, 5, undefined),
    event(5000, 5, 6, 222),
  ];
  assert.strictEqual(codex.calibrate(events, 'five_hour', 6000), null);
});

test('token weighting keeps the classes apart', () => {
  const parts = codex.partsOf({
    input_tokens: 1000,
    cached_input_tokens: 800,
    cache_write_input_tokens: 50,
    output_tokens: 100,
  });
  assert.strictEqual(parts.input, 200, 'input_tokens includes the cached part, so it is subtracted');
  assert.strictEqual(parts.cacheRead, 800);
  assert.strictEqual(parts.cacheWrite, 50);
  assert.strictEqual(parts.output, 100);

  // Output is the dear one and cached input the cheap one; only the ratio
  // matters, because calibration divides the scale back out.
  const cheap = codex.weigh({ input_tokens: 1000, cached_input_tokens: 1000 });
  const dear = codex.weigh({ input_tokens: 1000, cached_input_tokens: 1000, output_tokens: 1000 });
  assert.ok(dear > cheap * 5, 'a turn that writes is worth much more than one that only reads');
});

// Codex records the same thing under a different name, and the same way round.
// Its own arithmetic proves it: total_tokens comes to input plus output on
// 11,064 of 11,133 recorded turns, so reasoning is already inside output.
test('reasoning is read from Codex too, and kept inside output', () => {
  const parts = codex.partsOf({
    input_tokens: 1000,
    cached_input_tokens: 800,
    output_tokens: 130,
    reasoning_output_tokens: 97,
  });
  assert.strictEqual(parts.output, 130);
  assert.strictEqual(parts.reasoning, 97);

  // And knowing about it must not change what the turn is worth.
  const declared = codex.weigh({ input_tokens: 1000, cached_input_tokens: 800, output_tokens: 130, reasoning_output_tokens: 97 });
  const silent = codex.weigh({ input_tokens: 1000, cached_input_tokens: 800, output_tokens: 130 });
  assert.strictEqual(declared, silent, 'reasoning is already paid for inside output');

  assert.strictEqual(codex.partsOf(null).reasoning, 0);
});

test('the model in force is carried forward from the turn context', () => {
  const context = codex.contextFrom(
    JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.6-sol', effort: 'ultra' } })
  );
  assert.deepStrictEqual(context, { model: 'gpt-5.6-sol', effort: 'ultra' });

  const line = JSON.stringify({
    timestamp: '2026-08-30T23:00:00.000Z',
    payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 10, output_tokens: 1 } } },
  });
  const event = codex.eventFrom(line, 'rollout-2026-08-30T09-52-14-01a05328-225d-7c42-8f6e-20d81fe6e01e.jsonl', null, context);
  assert.strictEqual(event.model, 'gpt-5.6-sol', 'without this every row reads "unknown"');
  assert.strictEqual(event.effort, 'ultra');
  assert.strictEqual(event.sessionId, '01a05328-225d-7c42-8f6e-20d81fe6e01e');
});
