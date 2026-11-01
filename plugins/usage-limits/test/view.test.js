'use strict';

const test = require('node:test');
const assert = require('node:assert');

const view = require('../skills/usage-limits/scripts/view.js');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const NOW = Date.parse('2026-09-05T12:00:00.000Z');

function snapshot(overrides) {
  return Object.assign(
    {
      five_hour: { utilization: 11, resets_at: new Date(NOW + 4 * HOUR).toISOString() },
      seven_day: { utilization: 4, resets_at: new Date(NOW + 30 * HOUR).toISOString() },
      limits: [
        { kind: 'session', percent: 11, resets_at: new Date(NOW + 4 * HOUR).toISOString(), is_active: true },
        { kind: 'weekly_all', percent: 4, resets_at: new Date(NOW + 30 * HOUR).toISOString(), is_active: false },
        {
          kind: 'weekly_scoped',
          percent: 3,
          resets_at: new Date(NOW + 30 * HOUR).toISOString(),
          scope: { model: { id: null, display_name: 'Fable' } },
          is_active: false,
        },
      ],
    },
    overrides || {}
  );
}

function byKey(built, key) {
  return built.rows.find((row) => row.key === key) || null;
}

test('the three windows come out with Claude\'s own titles', () => {
  const built = view.build({
    now: NOW,
    utilization: snapshot(),
    fetchedAtMs: NOW - MINUTE,
    source: 'api',
    model: 'claude-fable-5-1[1m]',
  });
  assert.deepStrictEqual(
    built.rows.map((row) => row.title),
    ['Current session', 'Current week (all models)', 'Current week (Fable)']
  );
  assert.strictEqual(byKey(built, 'five_hour').percent, 11);
  assert.strictEqual(byKey(built, 'five_hour').percentText, '11%');
  assert.strictEqual(byKey(built, 'five_hour').msToReset, 4 * HOUR);
  assert.strictEqual(byKey(built, 'five_hour').source, 'api');
  assert.strictEqual(built.fable.percent, 3);
  assert.strictEqual(built.fable.family, 'fable');
  assert.strictEqual(built.modelLabel, 'Fable 5.1 1M');
  assert.strictEqual(built.state, 'live');
  assert.strictEqual(built.ageMs, MINUTE);
  assert.strictEqual(built.note, null);
});

test('the Fable week only shows while Fable is the model in use', () => {
  const opus = view.build({ now: NOW, utilization: snapshot(), fetchedAtMs: NOW, source: 'api', model: 'claude-opus-5' });
  assert.strictEqual(opus.fable, null);
  assert.strictEqual(opus.rows.length, 2);
  assert.strictEqual(opus.hidden.length, 1);
  assert.strictEqual(opus.hidden[0].title, 'Current week (Fable)');

  // The setting is the fallback when the status line has not said.
  const setting = view.build({ now: NOW, utilization: snapshot(), fetchedAtMs: NOW, source: 'api', settingsModel: 'claude-fable-5-1' });
  assert.ok(setting.fable);

  // Unknown model: nothing is hidden on a guess.
  const unknown = view.build({ now: NOW, utilization: snapshot(), fetchedAtMs: NOW, source: 'api', model: null, settingsModel: 'default' });
  assert.ok(unknown.fable, 'shown when the model cannot be told');
  assert.strictEqual(unknown.modelLabel, 'Default model');
});

test('per-response headers beat an older reading and lose to a newer one', () => {
  const headers = {
    five_hour: { used_percentage: 23.5, resets_at: Math.floor((NOW + 3 * HOUR) / 1000) },
    seven_day: { used_percentage: 41.2, resets_at: Math.floor((NOW + 20 * HOUR) / 1000) },
  };
  const newerHeaders = view.build({
    now: NOW,
    utilization: snapshot(),
    fetchedAtMs: NOW - 10 * MINUTE,
    source: 'api',
    headers,
    headersAt: NOW - 5 * 1000,
    model: 'claude-opus-5',
  });
  assert.strictEqual(byKey(newerHeaders, 'five_hour').percent, 23.5);
  assert.strictEqual(byKey(newerHeaders, 'five_hour').percentText, '23%');
  assert.strictEqual(byKey(newerHeaders, 'five_hour').source, 'headers');
  assert.strictEqual(byKey(newerHeaders, 'five_hour').msToReset, 3 * HOUR);
  assert.strictEqual(byKey(newerHeaders, 'seven_day').source, 'headers');

  const newerApi = view.build({
    now: NOW,
    utilization: snapshot(),
    fetchedAtMs: NOW - 1000,
    source: 'api',
    headers,
    headersAt: NOW - 10 * MINUTE,
    model: 'claude-opus-5',
  });
  assert.strictEqual(byKey(newerApi, 'five_hour').percent, 11);
  assert.strictEqual(byKey(newerApi, 'five_hour').source, 'api');
});

test('headers alone are enough for the two shared windows', () => {
  const built = view.build({
    now: NOW,
    headers: { five_hour: { used_percentage: 50, resets_at: (NOW + HOUR) / 1000 } },
    headersAt: NOW,
    model: 'claude-opus-5',
  });
  assert.strictEqual(byKey(built, 'five_hour').percent, 50);
  assert.strictEqual(byKey(built, 'seven_day').percent, null);
  assert.strictEqual(byKey(built, 'seven_day').percentText, 'no reading');
  assert.strictEqual(built.state, 'live');
});

test('levels follow the thresholds per window', () => {
  const built = view.build({
    now: NOW,
    utilization: snapshot({
      five_hour: { utilization: 80, resets_at: new Date(NOW + HOUR).toISOString() },
      seven_day: { utilization: 90, resets_at: new Date(NOW + HOUR).toISOString() },
    }),
    fetchedAtMs: NOW,
    source: 'api',
    model: 'claude-opus-5',
  });
  assert.strictEqual(byKey(built, 'five_hour').level, 'warning');
  assert.strictEqual(byKey(built, 'seven_day').level, 'error');
  assert.strictEqual(built.fable, null);
});

test('zero with no reset time is an empty window from a live reading, unknown from a cache', () => {
  const empty = { five_hour: { utilization: 0, resets_at: null }, seven_day: { utilization: 3, resets_at: new Date(NOW + HOUR).toISOString() } };
  const liveRead = view.build({ now: NOW, utilization: empty, fetchedAtMs: NOW, source: 'api', model: 'claude-opus-5' });
  assert.strictEqual(byKey(liveRead, 'five_hour').idle, true);
  assert.strictEqual(byKey(liveRead, 'five_hour').unreported, false);
  assert.strictEqual(byKey(liveRead, 'five_hour').percentText, '0%');

  const cached = view.build({ now: NOW, utilization: empty, fetchedAtMs: NOW - HOUR, source: 'cache', model: 'claude-opus-5' });
  assert.strictEqual(byKey(cached, 'five_hour').idle, true);
  assert.strictEqual(byKey(cached, 'five_hour').unreported, true);
  assert.strictEqual(byKey(cached, 'five_hour').percentText, '?');
  assert.strictEqual(cached.state, 'cached');
});

test('a window whose reset has passed is stale', () => {
  const built = view.build({
    now: NOW,
    utilization: snapshot({ five_hour: { utilization: 70, resets_at: new Date(NOW - MINUTE).toISOString() } }),
    fetchedAtMs: NOW - 2 * HOUR,
    source: 'cache',
    model: 'claude-opus-5',
  });
  const row = byKey(built, 'five_hour');
  assert.strictEqual(row.stale, true);
  assert.strictEqual(row.percentText, 'rolling');
  assert.ok(row.msToReset < 0);
});

test('state and note describe what the reader is looking at', () => {
  const none = view.build({ now: NOW });
  assert.strictEqual(none.state, 'none');
  assert.strictEqual(none.rows.length, 2);
  assert.strictEqual(none.ageMs, null);

  const old = view.build({ now: NOW, utilization: snapshot(), fetchedAtMs: NOW - 20 * MINUTE, source: 'api', model: 'claude-opus-5' });
  assert.strictEqual(old.state, 'cached');

  const offline = view.build({
    now: NOW,
    utilization: snapshot(),
    fetchedAtMs: NOW - 3 * MINUTE,
    source: 'api',
    model: 'claude-opus-5',
    outcome: { ok: false, kind: 'offline' },
  });
  assert.strictEqual(offline.note, 'offline, showing the reading from 3m ago');

  const signedOut = view.build({ now: NOW, outcome: { ok: false, kind: 'unauthorized' } });
  assert.strictEqual(signedOut.note, 'sign in to Claude Code again, no reading yet');

  const noLogin = view.build({ now: NOW, utilization: snapshot(), fetchedAtMs: NOW - HOUR, source: 'cache', outcome: { ok: false, kind: 'no_credentials' } });
  assert.strictEqual(noLogin.note, 'no Claude login found, showing the reading from 1h ago');

  const busy = view.build({ now: NOW, outcome: { ok: false, kind: 'rate_limited' } });
  assert.strictEqual(busy.note, 'the usage endpoint is busy, retrying, no reading yet');

  const off = view.build({ now: NOW, utilization: snapshot(), fetchedAtMs: NOW - MINUTE, source: 'cache', outcome: { ok: false, kind: 'disabled' } });
  assert.strictEqual(off.note, 'network off, showing the reading from 1m ago');

  const fine = view.build({ now: NOW, utilization: snapshot(), fetchedAtMs: NOW, source: 'api', outcome: { ok: true } });
  assert.strictEqual(fine.note, null);
});

test('ultracode is the effort level, ultrathink is the word, and each paints the bars its own way', () => {
  // Ultracode is a session mode: Claude Code keeps reporting the level as
  // xhigh while it is on, so the mark (or the setting) is the signal, and it
  // gives the bars the effort picker's purple shimmer.
  const xhigh = view.build({ now: NOW, effort: 'xhigh', working: true, ultracode: true });
  assert.strictEqual(xhigh.effort, 'xhigh');
  assert.strictEqual(xhigh.working, true);
  assert.strictEqual(xhigh.ultracode, true);
  assert.strictEqual(xhigh.style, 'ultra', 'the purple shimmer under ultracode');
  assert.strictEqual(view.build({ now: NOW, effort: 'xhigh' }).style, null, 'plain bars at plain xhigh');

  // Ultrathink paints THE WORD in the rainbow and nothing else: the bars keep
  // their own colour, and the effort is still xhigh.
  const thinking = view.build({ now: NOW, effort: 'xhigh', ultrathink: true });
  assert.strictEqual(thinking.ultrathink, true);
  assert.strictEqual(thinking.ultracode, false);
  assert.strictEqual(thinking.effort, 'xhigh');
  assert.strictEqual(thinking.style, null, 'the bars are never rainbow for ultrathink');

  // The ultracode level: purple bars, the colour the effort picker uses.
  const ultra = view.build({ now: NOW, effort: 'ultracode' });
  assert.strictEqual(ultra.ultracode, true);
  assert.strictEqual(ultra.style, 'ultra');

  // Max effort is the other level Claude Code animates in the rainbow.
  assert.strictEqual(view.build({ now: NOW, effort: 'max' }).style, 'rainbow');
  assert.strictEqual(view.build({ now: NOW, effort: 'max' }).ultracode, false);
  // Both at once: ultrathink only ever paints the word, so the bars are the
  // ultracode shimmer and the two are never mixed on one bar.
  assert.strictEqual(view.build({ now: NOW, effort: 'ultracode', ultrathink: true }).style, 'ultra');
  assert.strictEqual(view.build({ now: NOW }).style, null);
  assert.strictEqual(view.build({ now: NOW }).working, false);
});

test('a spend limit from a gateway is shown when present', () => {
  const built = view.build({
    now: NOW,
    headers: { spend_limit: { used_percentage: 62.8, resets_at: (NOW + 48 * HOUR) / 1000 } },
    headersAt: NOW,
    model: 'claude-opus-5',
  });
  const spend = byKey(built, 'spend_limit');
  assert.ok(spend);
  assert.strictEqual(spend.title, 'Spend limit');
  assert.strictEqual(spend.percentText, '62%');
});

test('the display name from Claude beats the pretty-printed id', () => {
  const built = view.build({ now: NOW, model: 'claude-fable-5-1[1m]', modelName: 'Fable 5.1' });
  assert.strictEqual(built.modelLabel, 'Fable 5.1');
  assert.strictEqual(built.model, 'claude-fable-5-1[1m]');
});

test('a host with windows of its own lengths gets a row per window', () => {
  const built = view.build({
    now: NOW,
    utilization: {
      five_hour: { utilization: 5, resets_at: new Date(NOW + HOUR).toISOString() },
      window_1440m: { utilization: 40, resets_at: new Date(NOW + 12 * HOUR).toISOString() },
    },
    fetchedAtMs: NOW,
    source: 'api',
    windowSpecs: [{ key: 'five_hour', label: '5-hour' }, { key: 'window_1440m', label: '24-hour' }],
    model: 'gpt-6-astra',
  });
  assert.deepStrictEqual(
    built.rows.map((row) => row.title),
    ['Current session', 'Current week (all models)', 'Current 24-hour window']
  );
  assert.strictEqual(built.rows[2].percent, 40);
  assert.strictEqual(built.modelLabel, 'GPT-6 Astra');
});

test('the model Claude Code reports wins over the setting for the Fable week', () => {
  const moved = view.build({ now: NOW, utilization: snapshot(), fetchedAtMs: NOW, source: 'api', model: 'claude-opus-5', settingsModel: 'claude-fable-5-1' });
  assert.strictEqual(moved.fable, null, 'the session moved to Opus, whatever the setting says');
  assert.strictEqual(moved.hidden.length, 1);
  assert.strictEqual(view.build({ now: NOW, outcome: { ok: false, kind: 'expired' } }).note, 'the login has expired, Claude Code renews it on its next call, no reading yet');
});
