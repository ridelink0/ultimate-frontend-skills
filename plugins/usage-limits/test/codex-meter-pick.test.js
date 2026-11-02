'use strict';

// The credit meter must never shadow the window meter.
//
// Every payload in this file is copied verbatim from a real rollout written by
// codex on a ChatGPT Plus account
// (sessions/2026/09/07/rollout-2026-09-07T11-48-05...jsonl), where the last
// rate_limits line of the session was the `premium` one and the `codex` one two
// lines earlier read 99 per cent of the five-hour window.

const test = require('node:test');
const assert = require('node:assert');

const codex = require('../skills/usage-limits/scripts/codex.js');

// limit_id "codex": the windows live here.
const WINDOWS = {
  limit_id: 'codex',
  limit_name: null,
  primary: { used_percent: 99.0, window_minutes: 300, resets_at: 1788883856 },
  secondary: { used_percent: 15.0, window_minutes: 10080, resets_at: 1789470656 },
  credits: { has_credits: false, unlimited: false, balance: '0' },
  individual_limit: null,
  spend_control_reached: null,
  plan_type: 'plus',
  rate_limit_reached_type: null,
};

// limit_id "premium": the credit balance, with both window slots null.
const CREDITS = {
  limit_id: 'premium',
  limit_name: null,
  primary: null,
  secondary: null,
  credits: { has_credits: false, unlimited: false, balance: '0' },
  individual_limit: null,
  spend_control_reached: null,
  plan_type: 'plus',
  rate_limit_reached_type: null,
};

function line(meter, iso) {
  return JSON.stringify({
    timestamp: iso,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: {
          input_tokens: 77256,
          cached_input_tokens: 74368,
          cache_write_input_tokens: 0,
          output_tokens: 451,
          reasoning_output_tokens: 104,
          total_tokens: 77707,
        },
      },
      rate_limits: meter,
    },
  });
}

const AT_WINDOWS = Date.parse('2026-09-08T11:30:53.893Z');
const AT_CREDITS = Date.parse('2026-09-08T11:30:54.185Z');

test('carriesWindows tells the two meters apart', () => {
  assert.equal(codex.carriesWindows(WINDOWS), true);
  assert.equal(codex.carriesWindows(CREDITS), false);
  assert.equal(codex.carriesWindows(null), false);
  assert.equal(codex.carriesWindows({}), false);
});

test('a limit hit with null slots still counts as a window reading', () => {
  // At a limit hit the slots can come back null with the reached type set. That
  // payload is the truest description of the window there is, and skipping it
  // for an older one that still had numbers would report a spent window as
  // running.
  const hit = Object.assign({}, CREDITS, {
    limit_id: 'codex',
    rate_limit_reached_type: 'primary',
  });
  assert.equal(codex.carriesWindows(hit), true);
});

test('pickMeter prefers the window meter over a newer credit meter', () => {
  const picked = codex.pickMeter([
    { meter: WINDOWS, at: AT_WINDOWS },
    { meter: CREDITS, at: AT_CREDITS },
  ]);
  assert.equal(picked.meter.limit_id, 'codex');
  assert.equal(picked.meter.primary.used_percent, 99);
  // The reading ages from when the windows were read, not from the credit line
  // that happened to be written after it.
  assert.equal(picked.at, AT_WINDOWS);
});

test('pickMeter keeps the newest reading of the window meter', () => {
  const older = Object.assign({}, WINDOWS, {
    primary: { used_percent: 12.0, window_minutes: 300, resets_at: 1788883856 },
  });
  const picked = codex.pickMeter([
    { meter: older, at: AT_WINDOWS - 60000 },
    { meter: WINDOWS, at: AT_WINDOWS },
    { meter: CREDITS, at: AT_CREDITS },
  ]);
  assert.equal(picked.meter.primary.used_percent, 99);
});

test('pickMeter falls back to the newest payload when nothing carries a window', () => {
  const picked = codex.pickMeter([{ meter: CREDITS, at: AT_CREDITS }]);
  assert.equal(picked.meter.limit_id, 'premium');
  assert.equal(picked.at, AT_CREDITS);
});

test('pickMeter ignores junk entries', () => {
  assert.equal(codex.pickMeter([]), null);
  assert.equal(codex.pickMeter(null), null);
  assert.equal(codex.pickMeter([{ meter: null, at: 1 }, { meter: WINDOWS, at: NaN }]), null);
});

test('meterFromLines does not stop at a trailing credit meter', () => {
  // The exact ordering of the real rollout: windows, then credits, last line.
  const text = [line(WINDOWS, '2026-09-08T11:30:53.893Z'), line(CREDITS, '2026-09-08T11:30:54.185Z'), ''].join('\n');
  const found = codex.meterFromLines(text, false);
  assert.ok(found, 'a meter should be found');
  assert.equal(found.meter.limit_id, 'codex');
  assert.equal(found.meter.primary.used_percent, 99);
});

test('the windows survive all the way through to a utilization reading', () => {
  // This is the assertion that matters: before the fix this produced no windows
  // at all, which is what left Codex with nothing to slow down for.
  const text = [line(WINDOWS, '2026-09-08T11:30:53.893Z'), line(CREDITS, '2026-09-08T11:30:54.185Z'), ''].join('\n');
  const found = codex.meterFromLines(text, false);
  const mapped = codex.utilizationFrom(found.meter);
  assert.equal(mapped.unreadable, false);
  assert.equal(mapped.windowless, false);
  assert.equal(mapped.specs.length, 2);
  assert.equal(mapped.utilization.five_hour.utilization, 99);
  assert.equal(mapped.planType, 'plus');
});

test('the credit meter alone still reports unreadable rather than windowless', () => {
  // Plus is metered by windows without exception, so a meter with none in it is
  // one that failed to read them. That distinction was already right and must
  // stay right.
  const mapped = codex.utilizationFrom(CREDITS);
  assert.equal(mapped.unreadable, true);
  assert.equal(mapped.windowless, false);
});

test('latestMeter prefers the window meter over a newer credit meter', () => {
  const events = [
    { meter: WINDOWS, at: AT_WINDOWS },
    { meter: CREDITS, at: AT_CREDITS },
  ];
  const found = codex.latestMeter(events);
  assert.equal(found.meter.limit_id, 'codex');
  assert.equal(found.at, AT_WINDOWS);
});

test('latestMeter skips events that carry no meter', () => {
  const events = [
    { meter: null, at: 1 },
    { meter: WINDOWS, at: AT_WINDOWS },
    { meter: null, at: AT_CREDITS },
  ];
  const found = codex.latestMeter(events);
  assert.equal(found.meter.limit_id, 'codex');
});

test('latestMeter returns null when there is no meter at all', () => {
  assert.equal(codex.latestMeter([]), null);
  assert.equal(codex.latestMeter([{ meter: null, at: 1 }]), null);
});
