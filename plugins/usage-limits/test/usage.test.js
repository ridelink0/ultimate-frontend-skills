'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Pinned before usage.js is required, and for the whole file.
//
// These are fixture tests, but several of the functions they call read the
// config directory for a correction an earlier hook left behind - statusLine
// most of all, because a stale snapshot on screen is the failure it exists to
// prevent. Unpinned, that directory is the developer's own ~/.claude, so six
// tests here asserted a fixture percentage and got the machine's live reading:
// "5h 62%" against "5h 37%", failing on one machine and passing on another,
// and leaving the suite permanently red - which is where a real regression
// hides. It also means the suite reads the user's real account, which it has
// no business doing.
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-usage-test-'));
process.env.CLAUDE_CONFIG_DIR = SCRATCH;
process.env.USAGE_LIMITS_HOST = 'claude';
test.after(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));

const usage = require('../skills/usage-limits/scripts/usage.js');

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-08-23T22:00:00.000Z');

function near(actual, expected, tolerance) {
  assert.ok(
    Math.abs(actual - expected) <= (tolerance || 1e-6),
    'expected ' + actual + ' to be near ' + expected
  );
}

test('rateFor matches known ids exactly', () => {
  assert.deepStrictEqual(usage.rateFor('claude-opus-5'), { input: 5, output: 25 });
  assert.deepStrictEqual(usage.rateFor('claude-haiku-4-5'), { input: 1, output: 5 });
  assert.deepStrictEqual(usage.rateFor('claude-fable-5'), { input: 10, output: 50 });
  assert.deepStrictEqual(usage.rateFor('claude-sonnet-5'), { input: 2, output: 10 });
});

test('rateFor strips a bracketed variant suffix and prices the model it names', () => {
  // "fable[1m]" and friends are context-window toggles on the same model, not
  // new models; falling to the family average priced sonnet 5 at the 4.6 blend.
  assert.deepStrictEqual(usage.rateFor('claude-sonnet-5[1m]'), usage.rateFor('claude-sonnet-5'));
  assert.deepStrictEqual(usage.rateFor('claude-fable-5[1m]'), { input: 10, output: 50 });
  assert.strictEqual(usage.isKnownModel('claude-sonnet-5[1m]'), true);
  assert.strictEqual(usage.isKnownModel('fable[1m]'), false, 'a bare alias is still a guess');
});

test('cache reads use the per-model rate when one is stated', () => {
  // The tenth-of-input rule holds everywhere except Fable/Mythos 5.1, which
  // price reads at $0.25 per million outright. In a long session reads are
  // the dominant input, so the tenth rule overstated that spend fourfold.
  const record = { cache_read_input_tokens: 1e6 };
  near(usage.costOf(record, 'claude-fable-5-1'), 0.25, 1e-9);
  near(usage.costOf(record, 'claude-mythos-5-1'), 0.25, 1e-9);
  near(usage.costOf(record, 'claude-fable-5'), 1.0, 1e-9);
  near(usage.costOf(record, 'claude-opus-5'), 0.5, 1e-9);
});

test('rateFor falls back to the family when the id is unknown', () => {
  // The Sonnet average takes in Sonnet 5.5 and 5 at $2/$10 and 4.6 at $3/$15,
  // so (2 + 2 + 3) / 3 in and (10 + 10 + 15) / 3 out.
  const sonnet = usage.rateFor('claude-sonnet-9-9');
  near(sonnet.input, 7 / 3, 1e-9);
  near(sonnet.output, 35 / 3, 1e-9);
  // The Opus average takes in every Opus row: four at $5/$25 and Opus 5.5 at
  // $4/$20, so (4 x 5 + 4) / 5 = 4.8 in and (4 x 25 + 20) / 5 = 24 out.
  assert.deepStrictEqual(usage.rateFor('CLAUDE-OPUS-9'), { input: 4.8, output: 24 });
  assert.deepStrictEqual(usage.rateFor(''), { input: 5, output: 25 });
  assert.deepStrictEqual(usage.rateFor(undefined), { input: 5, output: 25 });
});

test('costOf prices cache traffic at its own multipliers', () => {
  const record = {
    input_tokens: 2,
    cache_read_input_tokens: 24780,
    cache_creation_input_tokens: 8049,
    output_tokens: 2144,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 8049 },
  };
  // 2 + (24780 * 0.1) + (8049 * 2) = 18578 input units at $5/M,
  // plus 2144 output tokens at $25/M.
  const expected = (18578 * 5 + 2144 * 25) / 1e6;
  near(usage.costOf(record, 'claude-opus-5'), expected, 1e-9);
});

test('costOf handles records that only carry the cache total', () => {
  const record = {
    input_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 1000,
    output_tokens: 0,
  };
  near(usage.costOf(record, 'claude-opus-5'), (1000 * 1.25 * 5) / 1e6, 1e-9);
});

test('costOf is zero for a missing record', () => {
  assert.strictEqual(usage.costOf(null, 'claude-opus-5'), 0);
  assert.strictEqual(usage.costOf(undefined, ''), 0);
});

test('tokensOf sums every token class once', () => {
  const record = {
    input_tokens: 10,
    cache_read_input_tokens: 100,
    cache_creation_input_tokens: 50,
    output_tokens: 5,
  };
  assert.strictEqual(usage.tokensOf(record), 165);
});

test('eventFrom reads an assistant turn', () => {
  const line = JSON.stringify({
    type: 'assistant',
    timestamp: '2026-08-23T22:00:00.000Z',
    requestId: 'req_1',
    effort: 'xhigh',
    message: {
      id: 'msg_1',
      model: 'claude-opus-5',
      usage: { input_tokens: 100, output_tokens: 100 },
    },
  });
  const event = usage.eventFrom(line, new Set());
  assert.strictEqual(event.at, NOW);
  assert.strictEqual(event.model, 'claude-opus-5');
  assert.strictEqual(event.effort, 'xhigh');
  near(event.cost, (100 * 5 + 100 * 25) / 1e6, 1e-9);
});

// A request the limit refused is written to the transcript like an assistant
// turn, with a synthetic model and a usage block of zeros. Counting it as a turn
// dilutes the measured cost per turn with free ones; ignoring it altogether
// throws away the only statement of which window stopped the work and when it
// comes back. On 2026-08-30 the 5-hour bucket was reporting 0% with a null
// reset, so these records were the sole anchor available and were not read.
function refusal(at, key, resetsAtSeconds) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: new Date(at).toISOString(),
    requestId: 'req_reject_' + at,
    sessionId: 'session-a',
    isApiErrorMessage: true,
    apiErrorStatus: 429,
    error: 'rate_limit',
    quotaLimits: { status: 'rejected', rateLimitType: key, resetsAt: resetsAtSeconds },
    message: {
      id: 'msg_reject_' + at,
      model: '<synthetic>',
      usage: { input_tokens: 0, output_tokens: 0 },
      content: [{ type: 'text', text: "You've hit your session limit" }],
    },
  });
}

test('eventFrom reads a refused request as a refusal, not a turn', () => {
  const at = Date.parse('2026-08-30T23:31:12.000Z');
  const event = usage.eventFrom(refusal(at, 'five_hour', 1788148800), new Set());

  assert.strictEqual(event.cost, 0, 'a refused request cost nothing');
  assert.strictEqual(event.tokens, 0);
  assert.ok(event.rejected, 'it is marked so it can be kept out of the spend');
  assert.strictEqual(event.rejected.key, 'five_hour');
  assert.strictEqual(event.rejected.status, 'rejected');
  assert.strictEqual(event.rejected.resetsAt, 1788148800 * 1000, 'seconds become milliseconds');
});

test('lastRejections keeps the most recent refusal per window', () => {
  const early = Date.parse('2026-08-30T20:00:00.000Z');
  const late = Date.parse('2026-08-30T23:31:12.000Z');
  const events = [
    usage.eventFrom(refusal(early, 'five_hour', 1788130000), new Set()),
    usage.eventFrom(refusal(late, 'five_hour', 1788148800), new Set()),
    usage.eventFrom(refusal(early, 'seven_day', 1788292798), new Set()),
  ];
  const found = usage.lastRejections(events);

  assert.strictEqual(found.get('five_hour').at, late);
  assert.strictEqual(found.get('five_hour').resetsAt, 1788148800 * 1000);
  assert.strictEqual(found.get('seven_day').at, early);
  assert.strictEqual(found.size, 2);
});

test('a refusal in the past anchors the window that is running now', () => {
  // The state the account was actually in: a 5-hour bucket reading 0% with no
  // reset time, having refused work when the previous window ran out. Without
  // the refusal the window is treated as rolling and starts five hours ago,
  // sweeping in everything the exhausted window spent.
  const reset = Date.parse('2026-08-31T04:00:00.000Z');
  const now = reset + HOUR / 3;
  const spend = [
    { at: reset - HOUR, cost: 40, tokens: 0, model: 'claude-opus-5', effort: null },
    { at: reset + HOUR / 12, cost: 1, tokens: 0, model: 'claude-opus-5', effort: null },
  ];

  const rejections = usage.lastRejections([
    usage.eventFrom(refusal(reset - HOUR / 2, 'five_hour', reset / 1000), new Set()),
  ]);
  const [window] = usage.buildWindows(
    { five_hour: { utilization: 0, resets_at: null } },
    spend,
    now,
    now - HOUR / 60,
    null,
    null,
    rejections
  );

  assert.strictEqual(window.windowStart, reset, 'the window began when the refusal said it would');
  assert.strictEqual(window.turns, 1, 'only the spend after the reset counts');
  assert.strictEqual(window.refusedAt, reset - HOUR / 2);
});

test('eventFrom skips a turn already counted in another file', () => {
  const line = JSON.stringify({
    type: 'assistant',
    timestamp: '2026-08-23T22:00:00.000Z',
    requestId: 'req_1',
    message: { id: 'msg_1', model: 'claude-opus-5', usage: { input_tokens: 1, output_tokens: 1 } },
  });
  const seen = new Set();
  assert.ok(usage.eventFrom(line, seen));
  assert.strictEqual(usage.eventFrom(line, seen), null);
});

test('eventFrom ignores lines that are not billable turns', () => {
  const seen = new Set();
  assert.strictEqual(usage.eventFrom('', seen), null);
  assert.strictEqual(usage.eventFrom('not json at all', seen), null);
  assert.strictEqual(
    usage.eventFrom('{"type":"user","message":{"usage":{}},"assistant":1}', seen),
    null
  );
  assert.strictEqual(
    usage.eventFrom(JSON.stringify({ type: 'assistant', message: { usage: {} } }), seen),
    null,
    'a turn with no timestamp cannot be placed in a window'
  );
});

const spec = { key: 'five_hour', label: '5-hour', span: 5 * HOUR };

function events(list) {
  return list.map((item) => ({
    at: NOW + item.offset,
    cost: item.cost,
    tokens: item.tokens || 0,
    model: 'claude-opus-5',
    effort: item.effort || null,
  }));
}

test('buildWindow calibrates dollars per percent from measured spend', () => {
  const snapshot = { utilization: 10, resets_at: new Date(NOW + HOUR).toISOString() };
  const sample = events([
    { offset: -3 * HOUR, cost: 1 },
    { offset: -3 * HOUR, cost: 1 },
    { offset: -3 * HOUR, cost: 1 },
    { offset: -0.5 * HOUR, cost: 1 },
    { offset: -0.5 * HOUR, cost: 1 },
  ]);
  const window = usage.buildWindow(spec, snapshot, sample, NOW);

  assert.strictEqual(window.percentUsed, 10);
  assert.strictEqual(window.percentLeft, 90);
  assert.strictEqual(window.turns, 5);
  near(window.usdPerPercent, 0.5);
  near(window.remainingUSD, 45);
  near(window.percentPerTurn, 2);
  assert.strictEqual(window.turnsLeft, 45);
  near(window.headroomMs, 22.5 * HOUR, 1);
  assert.strictEqual(window.verdict, 'resets-first');
});

test('buildWindow reports runs-out when the pace beats the reset', () => {
  const snapshot = { utilization: 90, resets_at: new Date(NOW + HOUR).toISOString() };
  const sample = events([
    { offset: -3 * HOUR, cost: 1 },
    { offset: -3 * HOUR, cost: 1 },
    { offset: -3 * HOUR, cost: 1 },
    { offset: -0.5 * HOUR, cost: 1 },
    { offset: -0.5 * HOUR, cost: 1 },
  ]);
  const window = usage.buildWindow(spec, snapshot, sample, NOW);

  assert.strictEqual(window.verdict, 'runs-out');
  assert.ok(window.headroomMs < window.msToReset);
});

test('buildWindow stays idle when nothing recent can set a pace', () => {
  const snapshot = { utilization: 10, resets_at: new Date(NOW + HOUR).toISOString() };
  const sample = events([
    { offset: -3 * HOUR, cost: 1 },
    { offset: -3 * HOUR, cost: 1 },
  ]);
  const window = usage.buildWindow(spec, snapshot, sample, NOW);

  assert.strictEqual(window.headroomMs, null);
  assert.strictEqual(window.verdict, 'idle');
  assert.strictEqual(window.turnsLeft, 18, 'the window average still gives a per-turn cost');
});

test('buildWindow leaves an untouched window uncalibrated', () => {
  const snapshot = { utilization: 0, resets_at: new Date(NOW + HOUR).toISOString() };
  const window = usage.buildWindow(spec, snapshot, [], NOW);

  assert.strictEqual(window.usdPerPercent, null);
  assert.strictEqual(window.remainingUSD, null);
  assert.strictEqual(window.verdict, 'idle');
});

test('buildWindow survives a missing snapshot', () => {
  const window = usage.buildWindow(spec, null, [], NOW);
  assert.strictEqual(window.percentUsed, null);
  assert.strictEqual(window.msToReset, null);
  assert.strictEqual(window.verdict, 'unknown');
});

test('buildWindow marks a low reading as coarse', () => {
  const snapshot = { utilization: 2, resets_at: new Date(NOW + HOUR).toISOString() };
  const sample = events([{ offset: -0.5 * HOUR, cost: 1 }]);
  assert.strictEqual(usage.buildWindow(spec, snapshot, sample, NOW).coarse, true);

  const higher = { utilization: 40, resets_at: new Date(NOW + HOUR).toISOString() };
  assert.strictEqual(usage.buildWindow(spec, higher, sample, NOW).coarse, false);
});

test('buildWindow excludes spend from before the window opened', () => {
  const snapshot = { utilization: 10, resets_at: new Date(NOW + HOUR).toISOString() };
  const sample = events([
    { offset: -10 * HOUR, cost: 99 },
    { offset: -1 * HOUR, cost: 1 },
  ]);
  const window = usage.buildWindow(spec, snapshot, sample, NOW);
  assert.strictEqual(window.turns, 1);
  near(window.spentUSD, 1);
});

test('bindingWindow picks the limit that stops the work first', () => {
  const soon = { key: 'a', percentUsed: 50, headroomMs: 10 * HOUR };
  const sooner = { key: 'b', percentUsed: 20, headroomMs: 2 * HOUR };
  assert.strictEqual(usage.bindingWindow([soon, sooner]).key, 'b');
});

test('bindingWindow falls back to the fullest window with no pace', () => {
  const low = { key: 'a', percentUsed: 12, headroomMs: null };
  const high = { key: 'b', percentUsed: 88, headroomMs: null };
  assert.strictEqual(usage.bindingWindow([low, high]).key, 'b');
});

test('bindingWindow returns nothing when no window has a reading', () => {
  assert.strictEqual(usage.bindingWindow([{ key: 'a', percentUsed: null }]), null);
  assert.strictEqual(usage.bindingWindow([]), null);
});

test('formatDuration reads like a clock', () => {
  assert.strictEqual(usage.formatDuration(0), 'now');
  assert.strictEqual(usage.formatDuration(-5000), 'now');
  assert.strictEqual(usage.formatDuration(45 * 60 * 1000), '45m');
  assert.strictEqual(usage.formatDuration(2 * HOUR), '2h');
  assert.strictEqual(usage.formatDuration(2 * HOUR + 30 * 60 * 1000), '2h 30m');
  assert.strictEqual(usage.formatDuration(50 * HOUR), '2d 2h');
  assert.strictEqual(usage.formatDuration(null), '-');
});

test('formatUSD keeps small amounts readable', () => {
  assert.strictEqual(usage.formatUSD(0.164), '$0.164');
  assert.strictEqual(usage.formatUSD(12.5), '$12.50');
  assert.strictEqual(usage.formatUSD(121.4), '$121');
  assert.strictEqual(usage.formatUSD(null), '-');
});

test('dominantEffort reports the level most turns ran at', () => {
  const sample = events([
    { offset: -1, cost: 0, effort: 'xhigh' },
    { offset: -2, cost: 0, effort: 'xhigh' },
    { offset: -3, cost: 0, effort: 'low' },
  ]);
  assert.strictEqual(usage.dominantEffort(sample), 'xhigh');
  assert.strictEqual(usage.dominantEffort([]), null);
});

test('verdictLine says something useful in every state', () => {
  const base = { label: 'weekly', percentUsed: 50, msToReset: HOUR, resetsAt: NOW + HOUR };
  for (const verdict of ['exhausted', 'resets-first', 'runs-out', 'idle', 'unknown']) {
    const line = usage.verdictLine(
      Object.assign({}, base, { verdict, headroomMs: 2 * HOUR })
    );
    assert.ok(line.length > 20, verdict + ' should produce a sentence');
  }
  assert.match(usage.verdictLine(null), /\/usage/);
});

test('render explains itself when there is no snapshot', () => {
  const text = usage.render({
    plan: 'unknown',
    snapshotAgeMs: null,
    settings: { model: 'default', effortLevel: 'default' },
    extraUsage: null,
    windows: [],
    binding: null,
    recent: { turns: 0, usd: 0, usdPerTurn: null, tokens: 0, effort: null },
    measuredTurns: 0,
  });
  assert.match(text, /No usage snapshot/);
});

test('detectPlan identifies Pro', () => {
  const plan = usage.detectPlan({
    organizationType: 'claude_pro',
    organizationRateLimitTier: 'default_claude_ai',
  });
  assert.strictEqual(plan.id, 'pro');
  assert.strictEqual(plan.label, 'Claude Pro');
  assert.ok(plan.advice.length > 20);
});

test('detectPlan separates Max 5x from Max 20x', () => {
  const five = usage.detectPlan({
    organizationType: 'claude_max',
    organizationRateLimitTier: 'default_claude_max_5x',
  });
  const twenty = usage.detectPlan({
    organizationType: 'claude_max',
    organizationRateLimitTier: 'default_claude_max_20x',
  });
  assert.strictEqual(five.id, 'max_5x');
  assert.strictEqual(five.label, 'Claude Max 5x');
  assert.strictEqual(twenty.id, 'max_20x');
  assert.strictEqual(twenty.label, 'Claude Max 20x');
  assert.notStrictEqual(five.advice, twenty.advice);
});

test('detectPlan prefers the user tier over the org tier', () => {
  const plan = usage.detectPlan({
    organizationType: 'claude_max',
    organizationRateLimitTier: 'default_claude_max_5x',
    userRateLimitTier: 'default_claude_max_20x',
  });
  assert.strictEqual(plan.id, 'max_20x');
  assert.strictEqual(plan.tier, 'default_claude_max_20x');
});

test('detectPlan falls back to plain Max when no tier is reported', () => {
  const plan = usage.detectPlan({ organizationType: 'claude_max' });
  assert.strictEqual(plan.id, 'max');
  assert.strictEqual(plan.tier, null);
  assert.ok(plan.advice.includes('5x Pro'));
});

test('detectPlan handles Team and Enterprise', () => {
  assert.strictEqual(usage.detectPlan({ organizationType: 'claude_team' }).id, 'team');
  assert.strictEqual(
    usage.detectPlan({ organizationType: 'claude_enterprise' }).id,
    'enterprise'
  );
});

test('detectPlan degrades instead of throwing', () => {
  assert.strictEqual(usage.detectPlan(null).id, 'unknown');
  assert.strictEqual(usage.detectPlan({}).id, 'unknown');
  assert.strictEqual(usage.detectPlan({}).advice, null);

  const future = usage.detectPlan({ organizationType: 'claude_something_new' });
  assert.strictEqual(future.id, 'unknown');
  assert.strictEqual(
    future.label,
    'something_new',
    'an unseen plan should still show what the account reported'
  );
});

test('render prints the plan advice when there is one', () => {
  // An empty window list returns early, so give it a window to render.
  const window = {
    key: 'five_hour',
    label: '5-hour',
    percentUsed: 40,
    percentLeft: 60,
    msToReset: 2 * HOUR,
    resetsAt: NOW + 2 * HOUR,
    remainingUSD: 12,
    turnsLeft: 80,
    headroomMs: 3 * HOUR,
    coarse: false,
    verdict: 'resets-first',
  };
  const data = {
    plan: 'Claude Max 20x',
    planAdvice: 'Max 20x rarely binds.',
    snapshotAgeMs: 60000,
    settings: { model: 'opus', effortLevel: 'xhigh' },
    extraUsage: null,
    windows: [window],
    binding: window,
    recent: { turns: 3, usd: 0.5, usdPerTurn: 0.16, tokens: 0, effort: 'xhigh' },
    measuredTurns: 100,
  };
  const text = usage.render(data);
  assert.match(text, /Claude Max 20x/);
  assert.match(text, /Max 20x rarely binds\./);

  const silent = usage.render(Object.assign({}, data, { planAdvice: null }));
  assert.doesNotMatch(silent, /rarely binds/);
});

test('tokenParts splits the classes, with reasoning inside output', () => {
  const parts = usage.tokenParts({
    input_tokens: 10,
    cache_read_input_tokens: 100,
    cache_creation_input_tokens: 50,
    output_tokens: 5,
  });
  assert.deepStrictEqual(parts, {
    input: 10,
    cacheWrite: 50,
    cacheRead: 100,
    output: 5,
    reasoning: 0,
  });
  assert.deepStrictEqual(usage.tokenParts(null), {
    input: 0,
    cacheWrite: 0,
    cacheRead: 0,
    output: 0,
    reasoning: 0,
  });
});

// Reasoning is a slice of output, not a class beside it. Measured over 1,565
// turns of real transcripts, thinking never once exceeded output. Adding it to
// a total would price every thinking turn twice.
test('reasoning is carried alongside output, never added to it', () => {
  const parts = usage.tokenParts({
    input_tokens: 10,
    output_tokens: 900,
    output_tokens_details: { thinking_tokens: 700 },
  });
  assert.strictEqual(parts.output, 900, 'output already includes the thinking');
  assert.strictEqual(parts.reasoning, 700);

  // And the cost is unchanged by knowing about it, because it was always in
  // there. This is the guard against a silent doubling.
  const withDetails = usage.costOf(
    { input_tokens: 10, output_tokens: 900, output_tokens_details: { thinking_tokens: 700 } },
    'claude-opus-5'
  );
  const without = usage.costOf({ input_tokens: 10, output_tokens: 900 }, 'claude-opus-5');
  assert.strictEqual(withDetails, without);
});

test('reasoningSpend prices the thinking at the rate of whoever did it', () => {
  const models = [
    { model: 'claude-opus-5', parts: { output: 1e6, reasoning: 1e6 } },
    { model: 'claude-haiku-4-5', parts: { output: 1e6, reasoning: 1e6 } },
  ];
  const spend = usage.reasoningSpend(models, { output: 4e6, reasoning: 2e6 });
  // A million Opus output tokens is $25, a million Haiku is $5.
  near(spend.cost, 30);
  assert.strictEqual(spend.tokens, 2e6);
  assert.strictEqual(spend.shareOfOutput, 0.5);
});

test('reasoningSpend stays quiet when there was no thinking to price', () => {
  assert.strictEqual(usage.reasoningSpend([], { output: 100, reasoning: 0 }), null);
  assert.strictEqual(usage.reasoningSpend([], { output: 0, reasoning: 0 }), null);
  assert.strictEqual(usage.reasoningSpend(null, null), null);
});

test('reasoningSpend reports a share even when it cannot price it', () => {
  // Codex meters an allowance rather than a price, so there is no rate to
  // apply, but the share of output is still the useful half.
  const spend = usage.reasoningSpend([], { output: 1000, reasoning: 400 });
  assert.strictEqual(spend.cost, null);
  assert.strictEqual(spend.shareOfOutput, 0.4);
  assert.strictEqual(spend.tokens, 400);
});

test('byModel groups by model, dearest first, with shares summing to one', () => {
  const sample = [
    { model: 'claude-haiku-4-5', cost: 1, tokens: 100, parts: { input: 1, cacheWrite: 2, cacheRead: 3, output: 4 } },
    { model: 'claude-opus-5', cost: 3, tokens: 300, parts: { input: 1, cacheWrite: 1, cacheRead: 1, output: 1 } },
    { model: 'claude-opus-5', cost: 6, tokens: 600, parts: { input: 1, cacheWrite: 1, cacheRead: 1, output: 1 } },
  ];
  const rows = usage.byModel(sample);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].model, 'claude-opus-5');
  assert.strictEqual(rows[0].turns, 2);
  assert.strictEqual(rows[0].tokens, 900);
  assert.strictEqual(rows[0].parts.output, 2);
  assert.strictEqual(Math.round(rows[0].share * 100), 90);
  assert.strictEqual(Math.round(rows[1].share * 100), 10);
  assert.deepStrictEqual(usage.byModel([]), []);
});

test('formatTokens stays short at every scale', () => {
  assert.strictEqual(usage.formatTokens(318), '318');
  assert.strictEqual(usage.formatTokens(631000), '631k');
  assert.strictEqual(usage.formatTokens(26200000), '26.2M');
  assert.strictEqual(usage.formatTokens(2e9), '2.0B');
  assert.strictEqual(usage.formatTokens(NaN), '-');
});

test('statusLine is short and names every window', () => {
  const line = usage.statusLine({
    now: NOW,
    utilization: {
      five_hour: { utilization: 62, resets_at: new Date(NOW + 100 * 60000).toISOString() },
      seven_day: { utilization: 75, resets_at: new Date(NOW + 52 * HOUR).toISOString() },
    },
  });
  assert.strictEqual(line, '5h 62% 1h 40m  wk 75% 2d 4h');
});

test('statusLine flags a window that is nearly gone', () => {
  const line = usage.statusLine({
    now: NOW,
    utilization: { five_hour: { utilization: 94, resets_at: new Date(NOW + HOUR).toISOString() } },
  });
  assert.match(line, /^LOW {2}5h 94%/);
});

test('statusLine says nothing rather than something wrong', () => {
  assert.strictEqual(usage.statusLine({ now: NOW, utilization: null }), '');
  assert.strictEqual(usage.statusLine(null), '');
  assert.strictEqual(usage.statusLine({ now: NOW, utilization: { five_hour: null } }), '');
});

test('statusLine copes with a window that reports no reset time', () => {
  const line = usage.statusLine({
    now: NOW,
    utilization: { seven_day: { utilization: 40, resets_at: null } },
  });
  assert.strictEqual(line, 'wk 40%');
});

test('byProject groups spend by working directory, dearest first', () => {
  const rows = usage.byProject([
    { project: 'C--Users-OWNER', cost: 1, tokens: 10 },
    { project: 'd--work-app', cost: 6, tokens: 60 },
    { project: 'd--work-app', cost: 3, tokens: 30 },
    { project: null, cost: 0, tokens: 0 },
  ]);
  assert.strictEqual(rows[0].project, 'd--work-app');
  assert.strictEqual(rows[0].turns, 2);
  assert.strictEqual(rows[0].tokens, 90);
  assert.strictEqual(Math.round(rows[0].share * 100), 90);
  assert.strictEqual(rows[2].project, 'unknown');
  assert.deepStrictEqual(usage.byProject([]), []);
});

test('shortenProject keeps the identifying tail', () => {
  assert.strictEqual(usage.shortenProject('short', 22), 'short');
  assert.strictEqual(usage.shortenProject('a'.repeat(30), 10), '...' + 'a'.repeat(7));
  assert.strictEqual(usage.shortenProject(null, 10), '');
});

test('render shows the project split only when more than one ran', () => {
  const window = {
    key: 'seven_day',
    label: 'weekly',
    percentUsed: 40,
    percentLeft: 60,
    msToReset: 2 * HOUR,
    resetsAt: NOW + 2 * HOUR,
    remainingUSD: 12,
    turnsLeft: 80,
    headroomMs: 3 * HOUR,
    coarse: false,
    verdict: 'resets-first',
  };
  const base = {
    plan: 'Claude Pro',
    planAdvice: null,
    snapshotAgeMs: 60000,
    settings: { model: 'opus', effortLevel: 'xhigh' },
    extraUsage: null,
    windows: [window],
    binding: window,
    scopeLabel: 'weekly',
    models: [],
    tokens: null,
    recent: { turns: 3, usd: 0.5, usdPerTurn: 0.16, tokens: 0, effort: 'xhigh' },
    measuredTurns: 100,
  };

  const two = usage.render(
    Object.assign({}, base, {
      projects: [
        { project: 'd--work-app', turns: 930, tokens: 45200000, share: 0.78 },
        { project: 'C--Users-OWNER', turns: 240, tokens: 12100000, share: 0.22 },
      ],
    })
  );
  assert.match(two, /Projects in the weekly window/);
  assert.match(two, /d--work-app/);
  assert.match(two, /78%/);

  const one = usage.render(
    Object.assign({}, base, {
      projects: [{ project: 'd--work-app', turns: 930, tokens: 45200000, share: 1 }],
    })
  );
  assert.doesNotMatch(one, /Projects in the/);
});

test('buildWindow treats a passed reset time as stale, not as exhausted', () => {
  const snapshot = {
    utilization: 100,
    resets_at: new Date(NOW - 5 * 60000).toISOString(),
  };
  const sample = events([{ offset: -2 * HOUR, cost: 1 }, { offset: -0.5 * HOUR, cost: 1 }]);
  const window = usage.buildWindow(spec, snapshot, sample, NOW);

  assert.strictEqual(window.stale, true);
  assert.strictEqual(window.verdict, 'rolled-over');
  assert.strictEqual(window.turnsLeft, null, 'a stale window cannot project turns');
  assert.strictEqual(window.remainingUSD, null);
  assert.strictEqual(window.headroomMs, null);
});

test('buildWindow leaves a live window unstale', () => {
  const snapshot = { utilization: 50, resets_at: new Date(NOW + HOUR).toISOString() };
  assert.strictEqual(usage.buildWindow(spec, snapshot, [], NOW).stale, false);
});

test('bindingWindow ignores a stale window when a live one exists', () => {
  const stale = { key: 'a', percentUsed: 100, stale: true, headroomMs: 0 };
  const live = { key: 'b', percentUsed: 10, stale: false, headroomMs: 5 * HOUR };
  assert.strictEqual(usage.bindingWindow([stale, live]).key, 'b');
  assert.strictEqual(
    usage.bindingWindow([stale]).key,
    'a',
    'it still reports something when every window is stale'
  );
});

test('verdictLine explains a rolled over window', () => {
  const line = usage.verdictLine({
    label: '5-hour',
    verdict: 'rolled-over',
    percentUsed: 100,
    msToReset: -5000,
    headroomMs: null,
  });
  assert.match(line, /out of date/);
  assert.match(line, /turned over/);
});

test('statusLine says rolling instead of a percentage it knows is wrong', () => {
  const line = usage.statusLine({
    now: NOW,
    utilization: {
      five_hour: { utilization: 95, resets_at: new Date(NOW - 60000).toISOString() },
      seven_day: { utilization: 12, resets_at: new Date(NOW + 3 * HOUR).toISOString() },
    },
  });
  assert.strictEqual(line, '5h rolling  wk 12% 3h');
  assert.doesNotMatch(line, /LOW/, 'a stale window must not raise the alarm');
});

test('creditsFrom reads the disabled shape without inventing numbers', () => {
  const credits = usage.creditsFrom({
    extra_usage: {
      is_enabled: false,
      monthly_limit: null,
      used_credits: null,
      utilization: null,
      user_disabled: true,
      spend_limit_reached: false,
      credits_ever_enabled: true,
      disabled_reason: null,
    },
    spend: {
      used: { amount_minor: 0, currency: 'USD', exponent: 2 },
      limit: null,
      percent: 0,
      enabled: false,
    },
  });
  assert.strictEqual(credits.enabled, false);
  assert.strictEqual(credits.everEnabled, true);
  assert.strictEqual(credits.used, 0);
  assert.strictEqual(credits.limit, null);
  assert.strictEqual(credits.currency, 'USD');
});

test('creditsFrom converts minor units at the stated exponent', () => {
  const credits = usage.creditsFrom({
    extra_usage: { is_enabled: true, utilization: 8, spend_limit_reached: false },
    spend: {
      used: { amount_minor: 420, currency: 'USD', exponent: 2 },
      limit: { amount_minor: 5000, currency: 'USD', exponent: 2 },
      enabled: true,
    },
  });
  assert.strictEqual(credits.enabled, true);
  assert.strictEqual(credits.used, 4.2);
  assert.strictEqual(credits.limit, 50);
  assert.strictEqual(credits.percent, 8);
});

test('creditsFrom returns nothing when neither block is present', () => {
  assert.strictEqual(usage.creditsFrom({}), null);
  assert.strictEqual(usage.creditsFrom(null), null);
});

test('formatClock gives a wall clock time', () => {
  assert.match(usage.formatClock(NOW), /\d{1,2}:\d{2}/);
  assert.strictEqual(usage.formatClock(null), '-');
});

const outOfRoom = {
  key: 'five_hour',
  label: '5-hour',
  percentUsed: 92,
  percentLeft: 8,
  msToReset: 4 * HOUR,
  resetsAt: NOW + 4 * HOUR,
  remainingUSD: 2,
  turnsLeft: 6,
  headroomMs: 20 * 60000,
  coarse: false,
  stale: false,
  verdict: 'runs-out',
};

function reportData(extra) {
  return Object.assign(
    {
      plan: 'Claude Pro',
      planAdvice: null,
      snapshotAgeMs: 60000,
      settings: { model: 'opus', effortLevel: 'xhigh' },
      windows: [outOfRoom],
      binding: outOfRoom,
      resumeAt: outOfRoom.resetsAt,
      scopeLabel: '5-hour',
      models: [],
      projects: [],
      tokens: null,
      credits: null,
      recent: { turns: 3, usd: 0.5, usdPerTurn: 0.16, tokens: 0, effort: 'xhigh' },
      measuredTurns: 100,
    },
    extra
  );
}

test('render reports credits without repeating the warning Claude Code gives', () => {
  const text = usage.render(
    reportData({ credits: { enabled: true, limitReached: false, used: 4.2, limit: 50, percent: 8, currency: 'USD' } })
  );
  assert.match(text, /Credits {4}on, \$4\.20 used of \$50\.00 \(8%\)/);
  // Claude Code announces the switch to credits and asks before making it.
  assert.doesNotMatch(text, /moves to paid credits/);
  assert.doesNotMatch(text, /Nothing carries on/, 'that line is for the credits-off case');
});

test('render says work simply stops when credits are off', () => {
  const text = usage.render(
    reportData({ credits: { enabled: false, limitReached: false, used: 0, limit: null, percent: 0, currency: 'USD' } })
  );
  assert.match(text, /Credits {4}off, work stops/);
  assert.match(text, /Nothing carries on into paid credits/);
  assert.doesNotMatch(text, /spending moves to paid credits/);
});

test('render names a time to come back to the work', () => {
  const text = usage.render(reportData({}));
  assert.match(text, /resume after \d{1,2}:\d{2}/);
});

test('render leaves the plan block out when there is room', () => {
  const roomy = Object.assign({}, outOfRoom, { verdict: 'resets-first' });
  const text = usage.render(reportData({ windows: [roomy], binding: roomy }));
  assert.doesNotMatch(text, /resume after/);
  assert.doesNotMatch(text, /Nothing carries on/);
});

test('costPercentiles describes the spread, not just the middle', () => {
  const events = [1, 2, 3, 4, 10].map((cost) => ({ cost }));
  const rates = usage.costPercentiles(events);
  assert.strictEqual(rates.sample, 5);
  assert.strictEqual(rates.median, 3);
  assert.strictEqual(rates.high, 10, 'the expensive tail is the point of this');
  assert.ok(rates.high > rates.median);
});

test('costPercentiles ignores turns that cost nothing', () => {
  const rates = usage.costPercentiles([{ cost: 0 }, { cost: 2 }, { cost: -1 }]);
  assert.strictEqual(rates.sample, 1);
  assert.strictEqual(rates.median, 2);
});

test('costPercentiles gives up on an empty history', () => {
  assert.strictEqual(usage.costPercentiles([]), null);
  assert.strictEqual(usage.costPercentiles(null), null);
});

const priced = {
  key: 'seven_day',
  label: 'weekly',
  percentLeft: 40,
  usdPerPercent: 2,
  stale: false,
};

test('forecastWindow prices a job in points of the window', () => {
  const shot = usage.forecastWindow(priced, 10, { median: 1, high: 2, sample: 20 });
  assert.strictEqual(shot.usdLow, 10);
  assert.strictEqual(shot.usdHigh, 20);
  assert.strictEqual(shot.percentLow, 5);
  assert.strictEqual(shot.percentHigh, 10);
  assert.strictEqual(shot.leaves, 30, 'what is left is measured against the dear case');
  assert.strictEqual(shot.fits, true);
  assert.strictEqual(shot.tight, false);
});

test('forecastWindow calls it tight before it calls it impossible', () => {
  const shot = usage.forecastWindow(priced, 35, { median: 1, high: 2, sample: 20 });
  assert.strictEqual(shot.fits, true);
  assert.strictEqual(shot.tight, true, '70 of 40 points left is not comfortable');
});

test('forecastWindow refuses a job that does not fit', () => {
  const shot = usage.forecastWindow(priced, 50, { median: 1, high: 2, sample: 20 });
  assert.strictEqual(shot.fits, false);
  assert.ok(shot.leaves < 0);
});

test('forecastWindow will not price what it cannot measure', () => {
  assert.strictEqual(usage.forecastWindow(priced, 10, null), null);
  assert.strictEqual(usage.forecastWindow(null, 10, { median: 1, high: 2 }), null);
  assert.strictEqual(
    usage.forecastWindow({ percentLeft: 40, usdPerPercent: null }, 10, { median: 1, high: 2 }),
    null
  );
  assert.strictEqual(
    usage.forecastWindow(Object.assign({}, priced, { stale: true }), 10, { median: 1, high: 2 }),
    null,
    'a stale window cannot price anything'
  );
  assert.strictEqual(usage.forecastWindow(priced, 0, { median: 1, high: 2 }), null);
  assert.strictEqual(usage.forecastWindow(priced, NaN, { median: 1, high: 2 }), null);
});

test('renderForecast says whether the job fits and why', () => {
  const data = { windows: [priced], rates: { median: 1, high: 2, sample: 20 } };

  const roomy = usage.renderForecast(data, 5);
  assert.ok(roomy.includes('Forecast for 5 turns'));
  assert.ok(roomy.includes('fits'));
  assert.ok(roomy.includes('There is room for this'));
  assert.ok(roomy.includes('Priced from 20 recent turns'));

  const blocked = usage.renderForecast(data, 50);
  assert.ok(blocked.includes('it may not fit'));
  assert.ok(blocked.includes('record the remaining work without reducing scope'));
});

test('renderForecast asks for a number rather than guessing', () => {
  const data = { windows: [priced], rates: { median: 1, high: 2, sample: 20 } };
  for (const bad of [NaN, 0, -3, undefined]) {
    const text = usage.renderForecast(data, bad);
    assert.ok(text.includes('Give a number of turns'), 'should ask, for ' + bad);
    // The heading used to be built before the check, so a bad argument printed
    // straight into it as "Forecast for NaN turns".
    assert.ok(!text.includes('NaN'), 'must not print the bad value back');
    assert.ok(!text.includes('undefined'));
    assert.ok(!/Forecast for -/.test(text));
  }
});

test('renderForecast admits when it has nothing to price against', () => {
  const text = usage.renderForecast({ windows: [priced], rates: null }, 10);
  assert.ok(text.includes('Nothing recent to price this against'));
});

test('renderForecast prices a Codex reading in window points, not dollars', () => {
  // Codex meters a share of an allowance and never quotes a price, so this
  // path must never format `rates` as USD the way Claude Code's does - and it
  // must still quote a rate, in the unit Codex has. 10 turns costing 5 to 10
  // points of the weekly is 0.5 to 1.0 points a turn, and those are the
  // table's own figures divided by the turns they were priced for, so the
  // sentence and the row above it can never disagree.
  const data = { money: false, windows: [priced], rates: { median: 1, high: 2, sample: 20 } };
  const text = usage.renderForecast(data, 10);
  assert.ok(
    text.includes('Priced from 20 recent turns: about 0.5% of the weekly window per turn typical, 1.0% at the expensive end.'),
    text
  );
  assert.ok(!text.includes('$'), 'must not invent a dollar figure for a host with no price');

  // The same reading on Claude Code still gets the rate card it does have.
  const claude = usage.renderForecast(Object.assign({}, data, { money: true }), 10);
  assert.ok(claude.includes('$'), 'a host that quotes a price must still quote it');
  assert.ok(!claude.includes('per turn typical'));
});

test('familyOf recognises the family from the model id', () => {
  assert.strictEqual(usage.familyOf('claude-opus-5-2'), 'opus');
  assert.strictEqual(usage.familyOf('claude-sonnet-6'), 'sonnet');
  assert.strictEqual(usage.familyOf('CLAUDE-HAIKU-9'), 'haiku');
  assert.strictEqual(usage.familyOf('claude-fable-7'), 'fable');
  assert.strictEqual(usage.familyOf('claude-mythos-9'), 'fable', 'mythos is priced with fable');
  assert.strictEqual(usage.familyOf('gpt-4'), null);
  assert.strictEqual(usage.familyOf(null), null);
});

test('familyAverage averages every known member of the family', () => {
  const table = {
    'claude-opus-a': { input: 2, output: 10 },
    'claude-opus-b': { input: 8, output: 40 },
    'claude-haiku-a': { input: 1, output: 5 },
  };
  assert.deepStrictEqual(usage.familyAverage('opus', table), { input: 5, output: 25 });
  assert.deepStrictEqual(usage.familyAverage('haiku', table), { input: 1, output: 5 });
  assert.strictEqual(usage.familyAverage('sonnet', table), null);
  assert.strictEqual(usage.familyAverage(null, table), null);
});

test('an unreleased model is priced at its family average, not refused', () => {
  assert.deepStrictEqual(usage.rateFor('claude-opus-5-2'), usage.familyAverage('opus'));
  assert.deepStrictEqual(usage.rateFor('claude-sonnet-7'), usage.familyAverage('sonnet'));
  assert.deepStrictEqual(usage.rateFor('claude-haiku-9-9'), usage.familyAverage('haiku'));
});

test('an unrecognised family errs expensive rather than cheap', () => {
  const rate = usage.rateFor('claude-quartz-1');
  assert.deepStrictEqual(rate, { input: 5, output: 25 });
  assert.ok(
    rate.input >= usage.familyAverage('sonnet').input,
    'guessing low would overstate headroom, which is the dangerous direction'
  );
});

test('isKnownModel separates a real rate from an assumed one', () => {
  assert.strictEqual(usage.isKnownModel('claude-opus-5'), true);
  assert.strictEqual(usage.isKnownModel('CLAUDE-OPUS-5'), true);
  assert.strictEqual(usage.isKnownModel('claude-opus-5-2'), false);
  assert.strictEqual(usage.isKnownModel(null), false);
});

test('byModel flags rows that were priced by assumption', () => {
  const rows = usage.byModel([
    { model: 'claude-opus-5', cost: 1, tokens: 10, parts: { input: 0, cacheWrite: 0, cacheRead: 0, output: 1 } },
    { model: 'claude-opus-5-2', cost: 1, tokens: 10, parts: { input: 0, cacheWrite: 0, cacheRead: 0, output: 1 } },
  ]);
  const known = rows.find((r) => r.model === 'claude-opus-5');
  const guessed = rows.find((r) => r.model === 'claude-opus-5-2');
  assert.strictEqual(known.estimated, false);
  assert.strictEqual(guessed.estimated, true);
});

const fiveHour = { key: 'five_hour', label: '5-hour', span: 5 * HOUR };

// A snapshot whose window closed `ago` before now, reporting `percent` used.
function rolledOver(percent, ago) {
  return { utilization: percent, resets_at: new Date(NOW - ago).toISOString() };
}

test('reconstructWindow prices the live window from the closed one', () => {
  // The closed window cost $100 and was reported as 100% used, so a point is
  // worth a dollar. $37 has gone through the window running now.
  const closed = events([
    { offset: -7 * HOUR, cost: 60 },
    { offset: -6 * HOUR, cost: 40 },
  ]);
  const live = events([{ offset: -1 * HOUR, cost: 37 }]);
  const shot = usage.reconstructWindow(
    fiveHour,
    rolledOver(100, 2 * HOUR),
    closed.concat(live),
    NOW
  );
  assert.strictEqual(shot.usdPerPercent, 1);
  assert.strictEqual(shot.percentUsed, 37);
  // The old window reset two hours ago, so the one running now is two hours
  // old, not five. Reaching back a full span would count the expired window.
  assert.strictEqual(shot.windowStart, NOW - 2 * HOUR);
});

test('reconstructWindow refuses a rebuild that overflows the window', () => {
  // Was: capped at 100. Capping turned a broken calibration into a confident
  // "your budget is gone", which is exactly the wrong way to be wrong.
  const closed = events([{ offset: -7 * HOUR, cost: 10 }]);
  const live = events([{ offset: -1 * HOUR, cost: 999 }]);
  assert.strictEqual(
    usage.reconstructWindow(fiveHour, rolledOver(100, 2 * HOUR), closed.concat(live), NOW),
    null
  );
});

test('reconstructWindow leaves a window that has not rolled over alone', () => {
  const snapshot = { utilization: 50, resets_at: new Date(NOW + HOUR).toISOString() };
  assert.strictEqual(
    usage.reconstructWindow(fiveHour, snapshot, events([{ offset: -HOUR, cost: 5 }]), NOW),
    null
  );
});

test('reconstructWindow refuses when it cannot calibrate', () => {
  const spend = events([{ offset: -1 * HOUR, cost: 5 }]);
  // Nothing was spent inside the closed window, so a point has no price.
  assert.strictEqual(usage.reconstructWindow(fiveHour, rolledOver(100, 2 * HOUR), spend, NOW), null);
  // An untouched closed window says nothing either.
  assert.strictEqual(usage.reconstructWindow(fiveHour, rolledOver(0, 2 * HOUR), spend, NOW), null);
  assert.strictEqual(usage.reconstructWindow(fiveHour, null, spend, NOW), null);
  assert.strictEqual(
    usage.reconstructWindow(fiveHour, { utilization: 50, resets_at: null }, spend, NOW),
    null
  );
});

test('a rolled over window comes back rebuilt, and says it was rebuilt', () => {
  const utilization = {
    five_hour: rolledOver(100, 2 * HOUR),
    seven_day: { utilization: 34, resets_at: new Date(NOW + 5 * 24 * HOUR).toISOString() },
  };
  const sample = events([
    { offset: -7 * HOUR, cost: 100 },
    { offset: -1 * HOUR, cost: 37 },
  ]);
  const windows = usage.buildWindows(utilization, sample, NOW);
  const five = windows.find((w) => w.key === 'five_hour');

  assert.strictEqual(five.stale, false, 'it is usable again');
  assert.strictEqual(five.estimated, true, 'but the reader has to know it was derived');
  assert.strictEqual(five.percentUsed, 37);
});

test('a rebuilt window is eligible to be the binding one', () => {
  const utilization = {
    five_hour: rolledOver(100, 2 * HOUR),
    seven_day: { utilization: 5, resets_at: new Date(NOW + 5 * 24 * HOUR).toISOString() },
  };
  const sample = events([
    { offset: -7 * HOUR, cost: 100 },
    { offset: -0.5 * HOUR, cost: 80 },
  ]);
  const windows = usage.buildWindows(utilization, sample, NOW);
  const binding = usage.bindingWindow(windows);
  assert.strictEqual(
    binding.key,
    'five_hour',
    'dropping it would hide the limit that actually stops short work'
  );
});

const shortSpan = 5 * HOUR;
const longSpan = 7 * 24 * HOUR;

function window5(percent, headroomMs) {
  return { key: 'five_hour', label: '5-hour', percentUsed: percent, stale: false,
           headroomMs, spanMs: shortSpan };
}
function windowWeek(percent, headroomMs) {
  return { key: 'seven_day', label: 'weekly', percentUsed: percent, stale: false,
           headroomMs, spanMs: longSpan };
}

test('a nearly full window is not passed over for lacking a pace estimate', () => {
  // The failure this guards: 5-hour at 95% with nothing spent lately loses to
  // a roomy weekly window purely because the weekly one had a pace.
  const binding = usage.bindingWindow([window5(95, null), windowWeek(20, 40 * HOUR)]);
  assert.strictEqual(binding.key, 'five_hour');
});

test('an empty window with no pace does not claim to be binding', () => {
  const binding = usage.bindingWindow([window5(5, null), windowWeek(60, 2 * HOUR)]);
  assert.strictEqual(binding.key, 'seven_day');
});

test('an equally urgent tie goes to the shorter window', () => {
  const binding = usage.bindingWindow([windowWeek(50, 3 * HOUR), window5(50, 3 * HOUR)]);
  assert.strictEqual(
    binding.key,
    'five_hour',
    'the 5-hour limit is the one hit first in practice'
  );
});

test('the weekly window still binds when it is genuinely the wall', () => {
  const binding = usage.bindingWindow([window5(50, 3 * HOUR), windowWeek(99, 0.2 * HOUR)]);
  assert.strictEqual(
    binding.key,
    'seven_day',
    'forcing the 5-hour here would hide the limit about to stop the work'
  );
});

function costs(list) {
  return list.map((cost) => ({ cost }));
}

test('typicalTurnCost throws out the extremes rather than following them', () => {
  // One huge turn must not define the pace. The plain mean here is 2.22.
  const sample = costs([0.2, 0.25, 0.3, 0.35, 10]);
  assert.strictEqual(usage.typicalTurnCost(sample, [], [], 5), 0.3);
});

// It is a trimmed mean rather than the middle turn, because the figure is used
// to divide a budget into a number of turns. Turn costs are skewed - a few are
// far dearer than the rest, and they get dearer as context grows - so the
// middle turn promises more turns than the budget holds. Measured on the window
// that ran out on 2026-08-30: 182 promised against 110 actually left.
test('typicalTurnCost follows the skew, so a turn count is not flattered', () => {
  const skewed = costs([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.9, 1.0]);
  const middle = 0.1;
  const measured = usage.typicalTurnCost(skewed, [], [], 5);
  assert.ok(
    measured > middle,
    'the dear turns are real spending and must raise the cost of a turn'
  );
  // Still well under the plain mean of 0.27, so one outlier cannot run away
  // with it either.
  assert.ok(measured < 0.27);
});

test('typicalTurnCost ignores a sample too thin to trust', () => {
  const oneBigTurn = costs([7.13]);
  const window = costs([0.2, 0.2, 0.25, 0.3, 0.3, 0.35]);
  // The thin sample is passed over for the window: 0.2625, not the 7.13 turn
  // and not the 2.3 mean of both together.
  assert.strictEqual(
    usage.typicalTurnCost(oneBigTurn, window, [], 5),
    0.2625,
    'a single expensive turn is not a pace'
  );
});

test('typicalTurnCost widens again when the window itself is thin', () => {
  const everything = costs([0.2, 0.2, 0.25, 0.3, 0.3, 0.35]);
  assert.strictEqual(
    usage.typicalTurnCost(costs([9]), costs([9, 8]), everything, 5),
    0.2625,
    'a five hour window holding two turns cannot price a turn'
  );
});

test('typicalTurnCost uses the best it has when nothing reaches the floor', () => {
  assert.strictEqual(usage.typicalTurnCost(costs([1]), costs([1, 2, 3]), costs([5]), 5), 2);
});

test('typicalTurnCost ignores turns that cost nothing', () => {
  assert.strictEqual(usage.typicalTurnCost(costs([0, 0, 0.5, -1]), [], [], 1), 0.5);
});

test('typicalTurnCost gives up on an empty history', () => {
  assert.strictEqual(usage.typicalTurnCost([], [], [], 5), null);
  assert.strictEqual(usage.typicalTurnCost(null, null, null, 5), null);
});

const MIN = 60 * 1000;

function turn(minutesAgo, cost, sessionId) {
  return { at: NOW - minutesAgo * MIN, cost, tokens: 0, sessionId };
}

test('activeSessions finds the sessions spending right now', () => {
  const rows = usage.activeSessions(
    [turn(2, 3, 'mine'), turn(5, 2, 'mine'), turn(3, 3, 'other')],
    NOW
  );
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].sessionId, 'mine', 'dearest first');
  assert.strictEqual(rows[0].turns, 2);
  assert.strictEqual(rows[0].cost, 5);
  assert.strictEqual(Math.round(rows[0].share * 100), 63);
  assert.strictEqual(Math.round(rows[1].share * 100), 38);
});

test('activeSessions ignores a session that has gone quiet', () => {
  const rows = usage.activeSessions([turn(2, 3, 'mine'), turn(40, 9, 'finished')], NOW);
  assert.deepStrictEqual(
    rows.map((r) => r.sessionId),
    ['mine'],
    'a session idle for forty minutes is not competing for the budget'
  );
});

test('activeSessions takes a custom window', () => {
  const rows = usage.activeSessions([turn(2, 1, 'a'), turn(40, 1, 'b')], NOW, 60 * MIN);
  assert.strictEqual(rows.length, 2);
});

test('activeSessions copes with turns that carry no session', () => {
  const rows = usage.activeSessions([turn(1, 1, null)], NOW);
  assert.strictEqual(rows[0].sessionId, 'unknown');
});

test('shareOf gives the whole budget to a session working alone', () => {
  assert.strictEqual(usage.shareOf([{ sessionId: 'mine', share: 1 }], 'mine'), 1);
  assert.strictEqual(usage.shareOf([], 'mine'), 1);
  assert.strictEqual(usage.shareOf(null, 'mine'), 1);
});

test('shareOf splits the budget when another session is working', () => {
  const rows = usage.activeSessions([turn(2, 3, 'mine'), turn(3, 1, 'other')], NOW);
  assert.strictEqual(usage.shareOf(rows, 'mine'), 0.75);
});

test('shareOf assumes an even split when it cannot identify the caller', () => {
  const rows = usage.activeSessions([turn(2, 3, 'a'), turn(3, 1, 'b')], NOW);
  assert.strictEqual(usage.shareOf(rows, 'unknown-to-us'), 0.5);
});

test('a rebuild that overflows the window refuses instead of reporting 100%', () => {
  // The closed window was reported fully used, but only $5 of it is in local
  // transcripts because the rest was spent elsewhere. That makes a point look
  // like five cents, so $30 of live spend divides to 600%.
  const spec = { key: 'five_hour', label: '5-hour', span: 5 * HOUR };
  const snapshot = { utilization: 100, resets_at: new Date(NOW - 2 * HOUR).toISOString() };
  const sample = events([{ offset: -7 * HOUR, cost: 5 }, { offset: -1 * HOUR, cost: 30 }]);

  assert.strictEqual(
    usage.reconstructWindow(spec, snapshot, sample, NOW),
    null,
    'capping that at 100 would tell someone at half their budget that it is gone'
  );
});

test('an overflowing rebuild leaves the window unknown, not full', () => {
  const utilization = {
    five_hour: { utilization: 100, resets_at: new Date(NOW - 2 * HOUR).toISOString() },
    seven_day: { utilization: 50, resets_at: new Date(NOW + 5 * 24 * HOUR).toISOString() },
  };
  const sample = events([{ offset: -7 * HOUR, cost: 5 }, { offset: -1 * HOUR, cost: 30 }]);
  const five = usage.buildWindows(utilization, sample, NOW).find((w) => w.key === 'five_hour');

  assert.strictEqual(five.stale, true, 'unknown, so it must not pose as a reading');
  assert.strictEqual(five.estimated, false);
  assert.strictEqual(five.verdict, 'rolled-over');
});

test('a sound rebuild is still accepted', () => {
  const spec = { key: 'five_hour', label: '5-hour', span: 5 * HOUR };
  const snapshot = { utilization: 100, resets_at: new Date(NOW - 2 * HOUR).toISOString() };
  const sample = events([{ offset: -7 * HOUR, cost: 100 }, { offset: -1 * HOUR, cost: 37 }]);
  assert.strictEqual(usage.reconstructWindow(spec, snapshot, sample, NOW).percentUsed, 37);
});

test('the saturation limit leaves room for rounding, not for nonsense', () => {
  const spec = { key: 'five_hour', label: '5-hour', span: 5 * HOUR };
  const snapshot = { utilization: 100, resets_at: new Date(NOW - 2 * HOUR).toISOString() };

  // 102% of a window is plausible rounding, and is kept.
  const near = events([{ offset: -7 * HOUR, cost: 100 }, { offset: -1 * HOUR, cost: 102 }]);
  assert.strictEqual(usage.reconstructWindow(spec, snapshot, near, NOW).percentUsed, 100);

  // 130% is not.
  const over = events([{ offset: -7 * HOUR, cost: 100 }, { offset: -1 * HOUR, cost: 130 }]);
  assert.strictEqual(usage.reconstructWindow(spec, snapshot, over, NOW), null);
  assert.strictEqual(usage.SATURATION_LIMIT, 105);
});

test('spend since the snapshot is added to its reading', () => {
  // The reported failure: a snapshot nine minutes old said 49%, three sessions
  // had spent forty points in the gap, and the real figure was near 90.
  const fetchedAt = NOW - 10 * 60 * 1000;
  const spec = { key: 'five_hour', label: '5-hour', span: 5 * HOUR };
  const snapshot = { utilization: 49, resets_at: new Date(NOW + 4 * HOUR).toISOString() };
  // Six turns before the snapshot, because a point cannot be priced off one.
  // They have to sit inside the window, which opened an hour ago.
  const sample = events([
    { offset: -55 * 60 * 1000, cost: 3.51 },
    { offset: -50 * 60 * 1000, cost: 3.51 },
    { offset: -45 * 60 * 1000, cost: 3.51 },
    { offset: -40 * 60 * 1000, cost: 3.51 },
    { offset: -35 * 60 * 1000, cost: 3.51 },
    { offset: -30 * 60 * 1000, cost: 3.51 },
    { offset: -5 * 60 * 1000, cost: 16.97 },
  ]);

  const window = usage.buildWindow(spec, snapshot, sample, NOW, { fetchedAt });
  assert.strictEqual(window.adjusted, true);
  assert.ok(window.percentUsed > 80, 'got ' + window.percentUsed + ', expected near 88');
  assert.ok(window.percentUsed <= 100);
  assert.ok(window.pointsSinceSnapshot > 30);
});

test('a fresh snapshot with nothing spent since is left alone', () => {
  const spec = { key: 'five_hour', label: '5-hour', span: 5 * HOUR };
  const snapshot = { utilization: 49, resets_at: new Date(NOW + 4 * HOUR).toISOString() };
  const sample = events([{ offset: -60 * 60 * 1000, cost: 21 }]);
  const window = usage.buildWindow(spec, snapshot, sample, NOW, { fetchedAt: NOW - 1000 });
  assert.strictEqual(window.adjusted, false);
  assert.strictEqual(window.percentUsed, 49);
});

test('the adjustment never runs on a window that has rolled over', () => {
  const spec = { key: 'five_hour', label: '5-hour', span: 5 * HOUR };
  const rolled = { utilization: 100, resets_at: new Date(NOW - HOUR).toISOString() };
  const sample = events([{ offset: -4 * HOUR, cost: 10 }, { offset: -1000, cost: 5 }]);
  const window = usage.buildWindow(spec, rolled, sample, NOW, { fetchedAt: NOW - 10 * 60 * 1000 });
  assert.strictEqual(window.adjusted, false, 'a stale reading is not a base to build on');
});

test('a correction that overflows the window is refused, not capped', () => {
  // Capping produced the reported failure in the other direction: a window
  // truly at 55% was corrected all the way to a confident 100.
  const spec = { key: 'five_hour', label: '5-hour', span: 5 * HOUR };
  const snapshot = { utilization: 90, resets_at: new Date(NOW + HOUR).toISOString() };
  const sample = events([
    { offset: -70 * 60 * 1000, cost: 15 },
    { offset: -65 * 60 * 1000, cost: 15 },
    { offset: -60 * 60 * 1000, cost: 15 },
    { offset: -55 * 60 * 1000, cost: 15 },
    { offset: -50 * 60 * 1000, cost: 15 },
    { offset: -45 * 60 * 1000, cost: 15 },
    { offset: -60 * 1000, cost: 500 },
  ]);
  const window = usage.buildWindow(spec, snapshot, sample, NOW, { fetchedAt: NOW - 10 * 60 * 1000 });
  assert.strictEqual(window.percentUsed, 90, 'the reading is left as it was');
  assert.strictEqual(window.adjusted, false);
  assert.strictEqual(window.correctionUnreliable, true, 'and it says the figure may be low');
});

test('a baseline too thin to price a point is not used', () => {
  const spec = { key: 'five_hour', label: '5-hour', span: 5 * HOUR };
  const snapshot = { utilization: 49, resets_at: new Date(NOW + 4 * HOUR).toISOString() };
  // Two turns before the snapshot cannot say what a point costs.
  const sample = events([
    { offset: -60 * 60 * 1000, cost: 2 },
    { offset: -50 * 60 * 1000, cost: 2 },
    { offset: -60 * 1000, cost: 30 },
  ]);
  const window = usage.buildWindow(spec, snapshot, sample, NOW, { fetchedAt: NOW - 10 * 60 * 1000 });
  assert.strictEqual(window.adjusted, false);
  assert.strictEqual(window.percentUsed, 49);
});

test('a near-empty reading cannot price a point, so spend after it is left alone', () => {
  // The reported failure: a snapshot at 1% taken just after a reset priced a
  // point off a rounding bracket, and a window truly at 35% was asserted at
  // 97, climbing all afternoon while the real figure crawled.
  const spec = { key: 'five_hour', label: '5-hour', span: 5 * HOUR };
  const snapshot = { utilization: 1, resets_at: new Date(NOW + 4 * HOUR).toISOString() };
  const fetchedAt = NOW - 44 * 60 * 1000;
  const sample = events([
    { offset: -58 * 60 * 1000, cost: 0.05 },
    { offset: -56 * 60 * 1000, cost: 0.05 },
    { offset: -54 * 60 * 1000, cost: 0.05 },
    { offset: -52 * 60 * 1000, cost: 0.05 },
    { offset: -50 * 60 * 1000, cost: 0.05 },
    { offset: -48 * 60 * 1000, cost: 0.05 },
    { offset: -5 * 60 * 1000, cost: 28 },
  ]);
  const window = usage.buildWindow(spec, snapshot, sample, NOW, { fetchedAt });
  assert.strictEqual(window.adjusted, false, 'no correction beats one that is three times too big');
  assert.strictEqual(window.percentUsed, 1);
  assert.strictEqual(usage.MIN_BASELINE_PERCENT, 5);
});

test('the same near-empty reading corrects fine off a remembered real price', () => {
  const spec = { key: 'five_hour', label: '5-hour', span: 5 * HOUR };
  const snapshot = { utilization: 1, resets_at: new Date(NOW + 4 * HOUR).toISOString() };
  const fetchedAt = NOW - 44 * 60 * 1000;
  const sample = events([
    { offset: -58 * 60 * 1000, cost: 0.05 },
    { offset: -56 * 60 * 1000, cost: 0.05 },
    { offset: -54 * 60 * 1000, cost: 0.05 },
    { offset: -52 * 60 * 1000, cost: 0.05 },
    { offset: -50 * 60 * 1000, cost: 0.05 },
    { offset: -48 * 60 * 1000, cost: 0.05 },
    { offset: -5 * 60 * 1000, cost: 28 },
  ]);
  const window = usage.buildWindow(spec, snapshot, sample, NOW, {
    fetchedAt,
    knownCalibration: { usdPerPercent: 0.85, turns: 60, percent: 40 },
  });
  assert.strictEqual(window.adjusted, true);
  assert.ok(
    window.percentUsed >= 30 && window.percentUsed <= 40,
    'got ' + window.percentUsed + ', expected near 34'
  );
});

test('a remembered price read off a near-empty meter is refused too', () => {
  const spec = { key: 'five_hour', label: '5-hour', span: 5 * HOUR };
  const snapshot = { utilization: 1, resets_at: new Date(NOW + 4 * HOUR).toISOString() };
  const sample = events([{ offset: -5 * 60 * 1000, cost: 28 }]);
  const window = usage.buildWindow(spec, snapshot, sample, NOW, {
    fetchedAt: NOW - 44 * 60 * 1000,
    knownCalibration: { usdPerPercent: 0.29, turns: 44, percent: 1 },
  });
  assert.strictEqual(window.adjusted, false, 'the same rounding bracket in disguise');
  assert.strictEqual(window.percentUsed, 1);
});

test('betterCalibration prefers meter movement over turn count', () => {
  const coarse = { usdPerPercent: 0.29, turns: 80, percent: 1 };
  const wide = { usdPerPercent: 0.85, turns: 10, percent: 60 };
  assert.strictEqual(usage.betterCalibration(coarse, wide), wide);
  assert.strictEqual(usage.betterCalibration(wide, coarse), wide);
});

test('a rebuild refuses a closed window that read almost nothing', () => {
  const spec = { key: 'five_hour', label: '5-hour', span: 5 * HOUR };
  const snapshot = { utilization: 2, resets_at: new Date(NOW - 10 * 60 * 1000).toISOString() };
  const sample = events([
    { offset: -3 * HOUR, cost: 0.4 },
    { offset: -5 * 60 * 1000, cost: 12 },
  ]);
  assert.strictEqual(usage.reconstructWindow(spec, snapshot, sample, NOW), null);
});

test('no snapshot timestamp means no adjustment rather than a guess', () => {
  const spec = { key: 'five_hour', label: '5-hour', span: 5 * HOUR };
  const snapshot = { utilization: 49, resets_at: new Date(NOW + 4 * HOUR).toISOString() };
  const sample = events([{ offset: -60 * 1000, cost: 20 }]);
  const window = usage.buildWindow(spec, snapshot, sample, NOW, {});
  assert.strictEqual(window.adjusted, false);
  assert.strictEqual(window.percentUsed, 49);
});

test('a rebuild counts only the window running now, not the one that reset', () => {
  // The reported failure: the old window reset three minutes ago, so the new
  // one is three minutes old, but a rolling five hour sum swept in the whole
  // expired window and called a fresh window completely full.
  const spec = { key: 'five_hour', label: '5-hour', span: 5 * HOUR };
  const resetAt = NOW - 3 * 60 * 1000;
  const snapshot = { utilization: 100, resets_at: new Date(resetAt).toISOString() };
  const sample = events([
    { offset: -4 * HOUR, cost: 42 },
    { offset: -1 * HOUR, cost: 15 },
    { offset: -1 * 60 * 1000, cost: 14 },
  ]);

  const shot = usage.reconstructWindow(spec, snapshot, sample, NOW);
  assert.strictEqual(shot.windowStart, resetAt, 'the new window began at the reset');
  assert.ok(
    shot.percentUsed < 50,
    'got ' + shot.percentUsed + '%, but only the last turn belongs to this window'
  );
});

test('a reset longer ago than the span falls back to the rolling window', () => {
  const spec = { key: 'five_hour', label: '5-hour', span: 5 * HOUR };
  const resetAt = NOW - 9 * HOUR;
  const snapshot = { utilization: 80, resets_at: new Date(resetAt).toISOString() };
  const sample = events([
    { offset: -13 * HOUR, cost: 80 },
    { offset: -1 * HOUR, cost: 20 },
  ]);

  const shot = usage.reconstructWindow(spec, snapshot, sample, NOW);
  assert.strictEqual(
    shot.windowStart,
    NOW - 5 * HOUR,
    'nothing from the expired window is in range anyway'
  );
});

test('spend before the reset never counts toward the new window', () => {
  const spec = { key: 'five_hour', label: '5-hour', span: 5 * HOUR };
  const resetAt = NOW - 10 * 60 * 1000;
  const snapshot = { utilization: 100, resets_at: new Date(resetAt).toISOString() };
  // Everything is in the expired window; nothing has been spent since.
  const sample = events([{ offset: -2 * HOUR, cost: 100 }]);

  const shot = usage.reconstructWindow(spec, snapshot, sample, NOW);
  assert.strictEqual(shot.percentUsed, 0, 'a window with nothing spent in it is empty');
});

// Guards for the two reporting bugs fixed on 25 Aug 2026. Both understated
// usage, which is the direction that lets someone run out unwarned.
const liveSnapshot = { utilization: 49, resets_at: new Date(NOW + 4 * HOUR).toISOString() };
const laggingSpend = events([
  { offset: -60 * 60 * 1000, cost: 21 },
  { offset: -5 * 60 * 1000, cost: 17 },
]);
const fiveSpec = { key: 'five_hour', label: '5-hour', span: 5 * HOUR };

test('a rebuilt window is never also adjusted', () => {
  const utilization = {
    five_hour: { utilization: 100, resets_at: new Date(NOW - 10 * 60 * 1000).toISOString() },
    seven_day: { utilization: 40, resets_at: new Date(NOW + 5 * 24 * HOUR).toISOString() },
  };
  const sample = events([{ offset: -4 * HOUR, cost: 50 }, { offset: -60 * 1000, cost: 10 }]);
  const five = usage
    .buildWindows(utilization, sample, NOW, NOW - 30 * 60 * 1000)
    .find((w) => w.key === 'five_hour');

  assert.strictEqual(five.estimated, true);
  assert.strictEqual(five.adjusted, false, 'a rebuild already covers the whole live window');
});

test('adjusting keeps used and left adding up', () => {
  const w = usage.buildWindow(fiveSpec, liveSnapshot, laggingSpend, NOW, {
    fetchedAt: NOW - 10 * 60 * 1000,
  });
  assert.strictEqual(w.percentUsed + w.percentLeft, 100);
  assert.ok(Math.abs(w.remainingUSD - w.usdPerPercent * w.percentLeft) < 1e-9);
});

test('a snapshot timestamp outside the window is ignored', () => {
  const future = usage.buildWindow(fiveSpec, liveSnapshot, laggingSpend, NOW, {
    fetchedAt: NOW + 9999999,
  });
  assert.strictEqual(future.adjusted, false, 'clock skew must not invent spend');

  const ancient = usage.buildWindow(fiveSpec, liveSnapshot, laggingSpend, NOW, {
    fetchedAt: NOW - 9 * HOUR,
  });
  assert.strictEqual(ancient.adjusted, false, 'a reading older than the window anchors nothing');
});

test('adjusting cannot drive headroom below zero', () => {
  const w = usage.buildWindow(
    fiveSpec,
    { utilization: 90, resets_at: new Date(NOW + HOUR).toISOString() },
    events([{ offset: -60 * 60 * 1000, cost: 90 }, { offset: -60 * 1000, cost: 900 }]),
    NOW,
    { fetchedAt: NOW - 10 * 60 * 1000 }
  );
  assert.ok(w.percentLeft >= 0);
  assert.ok(w.turnsLeft >= 0);
});

test('another Claude working alongside is counted in the reading', () => {
  // Sessions share one limit, so the correction has to cover every session's
  // spend, not just the one asking. Otherwise the reading understates by
  // exactly what the other windows are burning.
  const snapshot = { utilization: 49, resets_at: new Date(NOW + 4 * HOUR).toISOString() };
  const fetchedAt = NOW - 10 * 60 * 1000;
  const withSession = (offset, cost, sessionId) =>
    Object.assign(events([{ offset, cost }])[0], { sessionId });

  const baseline = [55, 50, 45, 40, 35, 30].map((mins) =>
    withSession(-mins * 60 * 1000, 3.5, 'mine')
  );
  const alone = baseline.concat([withSession(-5 * 60 * 1000, 4, 'mine')]);
  const shared = alone.concat([
    withSession(-4 * 60 * 1000, 3, 'other'),
    withSession(-2 * 60 * 1000, 3, 'third'),
  ]);

  const solo = usage.buildWindow(fiveSpec, snapshot, alone, NOW, { fetchedAt });
  const together = usage.buildWindow(fiveSpec, snapshot, shared, NOW, { fetchedAt });

  assert.ok(
    together.pointsSinceSnapshot > solo.pointsSinceSnapshot,
    'the other sessions spent real budget and it has to show'
  );
  assert.ok(together.percentUsed > solo.percentUsed);
});

test('report carries everything the hook needs, so neither builds its own view', () => {
  // The reported failure: the hook built windows itself and forgot to pass the
  // snapshot timestamp, so the correction reached the report and never reached
  // the line Claude actually reads. One builder, or they drift again.
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'skills', 'usage-limits', 'scripts', 'brief.js'),
    'utf8'
  );
  assert.ok(
    !/usage\.buildWindows\(/.test(source),
    'brief.js must not build windows itself; it should ask report() for them'
  );
  assert.ok(/usage\.report\(/.test(source), 'brief.js should call report()');
});

test('criticalOthers finds a near-full window that is not the binding one', () => {
  const five = { key: 'five_hour', label: '5-hour', percentUsed: 68, stale: false };
  const week = { key: 'seven_day', label: 'weekly', percentUsed: 91, stale: false };
  const found = usage.criticalOthers([five, week], 'five_hour');
  assert.deepStrictEqual(found.map((w) => w.key), ['seven_day']);
});

test('criticalOthers never reports the binding window back', () => {
  const week = { key: 'seven_day', label: 'weekly', percentUsed: 96, stale: false };
  assert.deepStrictEqual(usage.criticalOthers([week], 'seven_day'), []);
});

test('criticalOthers ignores comfortable and unreadable windows', () => {
  const roomy = { key: 'seven_day', label: 'weekly', percentUsed: 40, stale: false };
  const stale = { key: 'seven_day', label: 'weekly', percentUsed: 99, stale: true };
  const blank = { key: 'seven_day', label: 'weekly', percentUsed: null, stale: false };
  assert.deepStrictEqual(usage.criticalOthers([roomy, stale, blank], 'five_hour'), []);
  assert.strictEqual(usage.CRITICAL_PERCENT, 85);
});

// The reported failure: the status line looped over the bucket table only, so
// a per-model weekly - which lives in the account's `limits` list, not as a
// bucket key - never appeared. On a plan where the Fable weekly binds, the
// line quoted the shared weekly at 24% while the window about to stop the work
// sat at 76.
test('the status line includes a per-model weekly, not just the bucket windows', () => {
  const resets = new Date(NOW + 4 * 24 * HOUR).toISOString();
  const collected = {
    now: NOW,
    utilization: {
      five_hour: { utilization: 1, resets_at: new Date(NOW + HOUR).toISOString() },
      seven_day: { utilization: 24, resets_at: resets },
      limits: [
        { kind: 'session', percent: 1, resets_at: new Date(NOW + HOUR).toISOString() },
        { kind: 'weekly_all', percent: 24, resets_at: resets },
        {
          kind: 'weekly_scoped',
          percent: 76,
          resets_at: resets,
          is_active: true,
          scope: { model: { id: null, display_name: 'Fable' } },
        },
      ],
    },
  };

  const line = usage.statusLine(collected);
  assert.match(line, /fable 76%/, 'the window that actually binds has to be on the line');
  assert.match(line, /wk 24%/, 'and the shared weekly stays');
});

test('betterCalibration keeps whichever sample rests on more turns', () => {
  const thin = { usdPerPercent: 0.9, turns: 3, percent: 30 };
  const solid = { usdPerPercent: 0.54, turns: 50, percent: 68 };
  assert.strictEqual(usage.betterCalibration(thin, solid), solid);
  assert.strictEqual(usage.betterCalibration(solid, thin), solid, 'a thin sample cannot displace a good one');
  assert.strictEqual(usage.betterCalibration(null, thin), thin, 'anything beats nothing');
});

test('betterCalibration refuses a nonsense sample', () => {
  const solid = { usdPerPercent: 0.54, turns: 50, percent: 68 };
  assert.strictEqual(usage.betterCalibration(solid, null), solid);
  assert.strictEqual(usage.betterCalibration(solid, { usdPerPercent: 0, turns: 999 }), solid);
  assert.strictEqual(usage.betterCalibration(solid, { usdPerPercent: NaN, turns: 999 }), solid);
  assert.strictEqual(usage.betterCalibration(null, { usdPerPercent: -1, turns: 9 }), null);
});

test('a thin baseline borrows the remembered price instead of guessing', () => {
  // The reported failure: a stale snapshot with few turns behind it priced a
  // point far too cheaply, and a window truly at 70% was reported as 82%.
  const spec = { key: 'five_hour', label: '5-hour', span: 5 * HOUR };
  const snapshot = { utilization: 30, resets_at: new Date(NOW + 4 * HOUR).toISOString() };
  const fetchedAt = NOW - 24 * 60 * 1000;
  const sample = events([
    { offset: -40 * 60 * 1000, cost: 3 },
    { offset: -35 * 60 * 1000, cost: 3 },
    { offset: -30 * 60 * 1000, cost: 3 },
    { offset: -28 * 60 * 1000, cost: 3 },
    { offset: -26 * 60 * 1000, cost: 3 },
    { offset: -10 * 60 * 1000, cost: 21 },
  ]);

  const guessing = usage.buildWindow(spec, snapshot, sample, NOW, { fetchedAt });
  const remembering = usage.buildWindow(spec, snapshot, sample, NOW, {
    fetchedAt,
    knownCalibration: { usdPerPercent: 0.54, turns: 50, percent: 68 },
  });

  assert.ok(
    remembering.percentUsed < guessing.percentUsed,
    'the remembered price is dearer, so it adds fewer points'
  );
  assert.strictEqual(remembering.calibration.turns, 5, 'it still reports what it saw itself');
});

// A point of a window is a share of an allowance, so changing the plan changes
// what a point is worth and voids everything learned about the old one. Pro to
// Max 5x is roughly a fivefold move: a remembered $0.40 point applied to a Max
// window promises several times the turns that exist. Nothing records when a
// plan changed - subscriptionCreatedAt is the original signup - so the plan is
// stamped on the calibration and a mismatched stamp is the proof.
test('a calibration learned on another plan is dropped, not reused', () => {
  const onDisk = {
    five_hour: { usdPerPercent: 0.4, turns: 149, percent: 82, plan: 'pro' },
    seven_day: { usdPerPercent: 5.1, turns: 1191, percent: 51, plan: 'pro' },
  };
  const scoped = usage.calibrationForPlan(onDisk, 'max_5x');
  assert.deepStrictEqual(scoped.learned, {}, 'nothing learned on Pro survives the move to Max');
  assert.strictEqual(scoped.planChanged, true, 'and the report can say why the figures went');
});

test('a calibration from the same plan is kept', () => {
  const onDisk = { five_hour: { usdPerPercent: 0.4, turns: 149, plan: 'max_5x' } };
  const scoped = usage.calibrationForPlan(onDisk, 'max_5x');
  assert.deepStrictEqual(scoped.learned, onDisk);
  assert.strictEqual(scoped.planChanged, false);
});

// The first run after this version ships meets entries written before the stamp
// existed. Their provenance cannot be established, and keeping them would be
// assuming the answer in the one direction that causes the bug.
test('an unstamped calibration is unknown rather than assumed current', () => {
  const scoped = usage.calibrationForPlan(
    { five_hour: { usdPerPercent: 0.4, turns: 149, percent: 82 } },
    'max_5x'
  );
  assert.deepStrictEqual(scoped.learned, {}, 'unproven provenance is not a licence to price with it');
  assert.strictEqual(
    scoped.planChanged,
    false,
    'every install upgrading to this version passes through here, so it is not evidence of a change'
  );
});

test('with no plan detected nothing is dropped', () => {
  const onDisk = { five_hour: { usdPerPercent: 0.4, turns: 149 } };
  assert.deepStrictEqual(usage.calibrationForPlan(onDisk, null).learned, onDisk);
});

test('what is written back carries the plan it was learned on', () => {
  const stamped = usage.stampPlan({ five_hour: { usdPerPercent: 0.9, turns: 20 } }, 'max_5x');
  assert.strictEqual(stamped.five_hour.plan, 'max_5x');
  assert.strictEqual(stamped.five_hour.usdPerPercent, 0.9, 'the sample itself is untouched');
});

test('a better baseline is preferred over a remembered one', () => {
  const spec = { key: 'five_hour', label: '5-hour', span: 5 * HOUR };
  const snapshot = { utilization: 50, resets_at: new Date(NOW + 4 * HOUR).toISOString() };
  const many = [];
  for (let i = 0; i < 40; i += 1) many.push({ offset: -(60 - i) * 60 * 1000, cost: 1 });
  many.push({ offset: -60 * 1000, cost: 5 });

  const window = usage.buildWindow(spec, snapshot, events(many), NOW, {
    fetchedAt: NOW - 10 * 60 * 1000,
    knownCalibration: { usdPerPercent: 99, turns: 2, percent: 10 },
  });
  assert.ok(window.calibration.turns > 2);
  assert.ok(window.adjusted, 'its own richer sample should have been used');
});

test('promptFrom recognises a prompt the user typed and nothing else', () => {
  const typed = JSON.stringify({ type: 'user', message: { role: 'user', content: 'do the thing' } });
  const blocks = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: 'and this' }] },
  });
  const result = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] },
  });
  const meta = JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: 'internal' } });
  const assistant = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'hi' } });
  assert.strictEqual(usage.promptFrom(typed), true);
  assert.strictEqual(usage.promptFrom(blocks), true);
  assert.strictEqual(usage.promptFrom(result), false);
  assert.strictEqual(usage.promptFrom(meta), false);
  assert.strictEqual(usage.promptFrom(assistant), false);
  assert.strictEqual(usage.promptFrom('not json'), false);
});

test('eventFrom carries the context the model saw and whether it was a sidechain', () => {
  const line = JSON.stringify({
    type: 'assistant',
    timestamp: '2026-08-23T22:00:00.000Z',
    requestId: 'req_ctx',
    isSidechain: true,
    agentId: 'abc',
    message: {
      id: 'msg_ctx',
      model: 'claude-opus-5',
      usage: {
        input_tokens: 200,
        cache_read_input_tokens: 60000,
        cache_creation_input_tokens: 9000,
        output_tokens: 800,
      },
    },
  });
  const event = usage.eventFrom(line, new Set(), 'proj');
  assert.strictEqual(event.context, 69200, 'input plus both cache classes, not the output');
  assert.strictEqual(event.sidechain, true);

  const main = usage.eventFrom(line.replace('"isSidechain":true,"agentId":"abc",', ''), new Set(), 'proj');
  assert.strictEqual(main.sidechain, false);
});

test('shareOf never starves a session that has only just started', () => {
  // This session had spent $0.50 in a window where two others had spent $16.50,
  // so its share of past spend was three per cent, and 208 turns of headroom
  // became "about 6 turns left" two tool calls into the session.
  const rows = usage.activeSessions([turn(1, 0.5, 'fresh'), turn(2, 14, 'busy'), turn(3, 2.5, 'other')], NOW);
  assert.ok(Math.abs(usage.shareOf(rows, 'fresh') - 1 / 3) < 1e-9, 'an equal split is the floor');
  assert.ok(Math.abs(usage.shareOf(rows, 'busy') - 14 / 17) < 1e-9, 'a session doing most of the spending keeps its share');
});

test('shareOf splits among every open session when more are open than have spent', () => {
  const rows = usage.activeSessions([turn(2, 3, 'mine')], NOW);
  assert.ok(Math.abs(usage.shareOf(rows, 'mine', 3) - 1 / 3) < 1e-9, 'being the only one to have spent yet is not owning the budget');
  const two = usage.activeSessions([turn(2, 3, 'mine'), turn(3, 1, 'other')], NOW);
  assert.strictEqual(usage.shareOf(two, 'mine', 3), 0.75, 'a measured share above the split stands');
  assert.ok(Math.abs(usage.shareOf(two, 'other', 4) - 0.25) < 1e-9);
  assert.ok(Math.abs(usage.shareOf(two, 'stranger', 4) - 0.25) < 1e-9);
});

// Measured live on 2026-09-08: the budget line read "13 per cent used, about
// 1301 turns of headroom" in the same breath as warning that about 97 points
// had been spent since the snapshot - more than it said was left. The prose was
// right and the number was a fantasy: once spending has outrun the snapshot,
// the price per point was derived from a denominator that has stopped being
// true, and everything downstream of it inflates. There is no honest count in
// that state, so none is printed.
test('once spending has outrun the snapshot, no turn count is quoted at all', () => {
  const spec = { key: 'five_hour', label: '5-hour', span: 5 * HOUR };
  const snapshot = { utilization: 13, resets_at: new Date(NOW + HOUR).toISOString() };
  const sample = events([
    { offset: -70 * 60 * 1000, cost: 15 },
    { offset: -65 * 60 * 1000, cost: 15 },
    { offset: -60 * 60 * 1000, cost: 15 },
    { offset: -55 * 60 * 1000, cost: 15 },
    { offset: -50 * 60 * 1000, cost: 15 },
    { offset: -45 * 60 * 1000, cost: 15 },
    { offset: -60 * 1000, cost: 900 },
  ]);
  const window = usage.buildWindow(spec, snapshot, sample, NOW, { fetchedAt: NOW - 30 * 60 * 1000 });
  assert.ok(window.pointsBeyondSnapshot > 0, 'the overshoot is what makes the reading a floor');
  assert.strictEqual(window.percentUsed, 13, 'the percentage stays the last real reading');
  assert.strictEqual(window.turnsLeft, null, 'and no headroom is claimed beside that warning');
  assert.strictEqual(window.headroomMs, null);
  assert.strictEqual(window.remainingUSD, null);
});
