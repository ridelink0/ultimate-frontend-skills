'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const feed = require('../skills/usage-limits/scripts/feed.js');
const view = require('../skills/usage-limits/scripts/view.js');
const bars = require('../skills/usage-limits/scripts/bars.js');
const statusline = require('../skills/usage-limits/scripts/statusline.js');
const tempdirs = require('../tools/test-tempdirs.js');

const script = path.join(__dirname, '..', 'skills', 'usage-limits', 'scripts', 'feed.js');
const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-09-05T12:00:00.000Z');

function account(now) {
  return {
    oauthAccount: { accountUuid: 'acc', organizationType: 'claude_max' },
    cachedUsageUtilization: {
      fetchedAtMs: now - 1000,
      accountUuid: 'acc',
      utilization: {
        five_hour: { utilization: 42, resets_at: new Date(now + HOUR).toISOString() },
        seven_day: { utilization: 7, resets_at: new Date(now + 24 * HOUR).toISOString() },
        limits: [
          {
            kind: 'weekly_scoped',
            percent: 3,
            resets_at: new Date(now + 24 * HOUR).toISOString(),
            scope: { model: { id: null, display_name: 'Fable' } },
            is_active: false,
          },
        ],
      },
    },
  };
}

function tempConfig(withSnapshot) {
  const dir = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-feed-'));
  const data = withSnapshot === false ? { cachedUsageUtilization: {} } : account(Date.now());
  fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify(data));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ model: 'claude-opus-5' }));
  return dir;
}

// CODEX_HOME is pinned at an empty directory by default, so these assert on the
// Claude line alone. Without it the status line grew a second line on any
// machine that happens to have Codex installed and stayed one line on CI, so
// the same test passed or failed depending on whose laptop ran it.
function run(dir, input, env) {
  return spawnSync(process.execPath, [script], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    timeout: 15000,
    env: Object.assign(
      { NO_COLOR: '1', COLUMNS: '120' },
      process.env,
      // The host is stated outright: CODEX_HOME is one of the things
      // host.detect() reads as "this is Codex", and pointing it at a fixture
      // would otherwise silence the Claude line entirely.
      { CLAUDE_CONFIG_DIR: dir, USAGE_LIMITS_HOST: 'claude', CODEX_HOME: path.join(dir, 'no-codex') },
      env || {}
    ),
  });
}

// A Codex home with one rollout in it, carrying the meter Codex writes beside
// every request: 15% of the week spent, which the display shows as 85% left.
function codexHome(usedPercent) {
  const dir = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-codexhome-'));
  const day = path.join(dir, 'sessions', '2026', '09', '06');
  fs.mkdirSync(day, { recursive: true });
  const at = new Date().toISOString();
  const resets = Math.floor(Date.now() / 1000) + 6 * 24 * 60 * 60;
  fs.writeFileSync(
    path.join(day, 'rollout-2026-09-06T14-06-29-01a0781d-6c98-7da2-830d-314b05b7ed61.jsonl'),
    JSON.stringify({
      timestamp: at,
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { last_token_usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5, total_tokens: 15 } },
        rate_limits: {
          limit_id: 'codex',
          secondary: { used_percent: usedPercent, window_minutes: 10080, resets_at: resets },
          plan_type: 'plus',
        },
      },
    }) + '\n'
  );
  return dir;
}

function statusInput(model, extra) {
  return Object.assign(
    {
      session_id: 'sess-1',
      model: { id: model, display_name: bars.prettyModel(model) },
      effort: { level: 'xhigh' },
      cost: { total_cost_usd: 1.25 },
      context_window: { used_percentage: 12 },
    },
    extra || {}
  );
}

test('the line names the windows with their percentages', () => {
  const dir = tempConfig();
  const result = run(dir, statusInput('claude-opus-5'));
  assert.strictEqual(result.status, 0, result.stderr);
  const line = result.stdout.trim();
  assert.match(line, /Opus 5/);
  assert.match(line, /xhigh/);
  assert.match(line, /session .*42%/);
  assert.match(line, /week .*7%/);
  assert.strictEqual(line.indexOf('fable'), -1, 'Fable is not running');
  assert.strictEqual(line.indexOf('\x1b'), -1, 'NO_COLOR means no escapes');
});

test('the Fable week appears when Fable is the model', () => {
  const dir = tempConfig();
  const result = run(dir, statusInput('claude-fable-5-1[1m]'));
  assert.match(result.stdout, /fable .*3%/);
});

test('per-response rate limits from Claude Code win over the cache', () => {
  const dir = tempConfig();
  const result = run(
    dir,
    statusInput('claude-opus-5', {
      rate_limits: {
        five_hour: { used_percentage: 61.7, resets_at: Math.floor((Date.now() + HOUR) / 1000) },
        seven_day: { used_percentage: 9.2, resets_at: Math.floor((Date.now() + 24 * HOUR) / 1000) },
      },
    })
  );
  assert.match(result.stdout, /session .*61%/);
  assert.match(result.stdout, /week .*9%/);
});

test('the feed records the session, and a quick second update means working', () => {
  const dir = tempConfig();
  run(dir, statusInput('claude-opus-5', { rate_limits: { five_hour: { used_percentage: 5, resets_at: 1 } } }));
  let all = JSON.parse(fs.readFileSync(path.join(dir, 'usage-limits-feed.json'), 'utf8'));
  assert.strictEqual(all['sess-1'].model, 'claude-opus-5');
  assert.strictEqual(all['sess-1'].effort, 'xhigh');
  assert.strictEqual(all['sess-1'].rateLimits.five_hour.used_percentage, 5);
  assert.strictEqual(all['sess-1'].cost, 1.25);
  assert.strictEqual(feed.isWorking(all['sess-1'], Date.now()), false, 'one update is not a turn');

  // A run without rate_limits keeps the ones already seen.
  run(dir, statusInput('claude-opus-5'));
  all = JSON.parse(fs.readFileSync(path.join(dir, 'usage-limits-feed.json'), 'utf8'));
  assert.strictEqual(all['sess-1'].rateLimits.five_hour.used_percentage, 5);
  assert.strictEqual(feed.isWorking(all['sess-1'], Date.now()), true);
  assert.strictEqual(feed.isWorking(all['sess-1'], Date.now() + 10000), false);
});

test('it fits the columns it is given', () => {
  const dir = tempConfig();
  for (const columns of [120, 60, 38, 24]) {
    const result = run(dir, statusInput('claude-fable-5-1[1m]'), { COLUMNS: String(columns) });
    const line = result.stdout.trim();
    assert.ok(bars.visibleWidth(line) <= columns, columns + ' columns: ' + line);
    assert.match(line, /42%/);
  }
});

test('bad stdin is not a crash', () => {
  const dir = tempConfig();
  const result = run(dir, '{not json');
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stderr, '');
  const empty = run(dir, '');
  assert.strictEqual(empty.status, 0);
});

test('no snapshot at all says so rather than inventing bars', () => {
  const dir = tempConfig(false);
  const result = run(dir, statusInput('claude-opus-5'));
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /no reading yet/);
});

test('a previous status line runs first and its output goes above ours', () => {
  const dir = tempConfig();
  // Written where the child will look, never through stateFile(): that reads
  // CLAUDE_CONFIG_DIR from this process, which is the real config directory.
  fs.writeFileSync(
    path.join(dir, 'usage-limits-statusline.json'),
    JSON.stringify({
      // A shell echo, not a node spawn. runPrevious gives the chained command
      // only what is LEFT of the two-second budget after our own work, so under
      // a loaded parallel run a node cold start was being starved, timing out,
      // and then silently dropped - which is indistinguishable from a failure
      // and made this test flaky. spawnSync uses shell:true, so echo works on
      // cmd and sh alike and costs nothing to start.
      previous: { type: 'command', command: 'echo prev line' },
      chain: true,
    })
  );
  const result = run(dir, statusInput('claude-opus-5'));
  const lines = result.stdout.trim().split('\n');
  assert.strictEqual(lines[0], 'prev line');
  assert.match(lines[1], /session .*42%/);
});

test('a previous status line that fails is skipped silently', () => {
  const dir = tempConfig();
  fs.writeFileSync(
    path.join(dir, 'usage-limits-statusline.json'),
    JSON.stringify({ previous: { type: 'command', command: '"' + process.execPath + '" -e "process.exit(1)"' }, chain: true })
  );
  const result = run(dir, statusInput('claude-opus-5'));
  const lines = result.stdout.trim().split('\n');
  assert.strictEqual(lines.length, 1);
  assert.match(lines[0], /session .*42%/);
});

test('USAGE_LIMITS_STATUSLINE=off still records the feed but prints nothing', () => {
  const dir = tempConfig();
  const result = run(dir, statusInput('claude-opus-5'), { USAGE_LIMITS_STATUSLINE: 'off' });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '');
  assert.ok(fs.existsSync(path.join(dir, 'usage-limits-feed.json')));
});

test('line paints the percentage only once it is worth noticing', () => {
  const built = view.build({
    now: NOW,
    utilization: {
      five_hour: { utilization: 85, resets_at: new Date(NOW + HOUR).toISOString() },
      seven_day: { utilization: 12, resets_at: new Date(NOW + HOUR).toISOString() },
    },
    fetchedAtMs: NOW,
    source: 'api',
    model: 'claude-opus-5',
  });
  const text = feed.line(built, { columns: 120, mode: 'truecolor', tick: 0 });
  assert.ok(text.indexOf('\x1b[38;2;255;193;7m85%') !== -1, 'the warning percentage is yellow');
  assert.ok(text.indexOf('\x1b[38;2;255;193;7m12%') === -1, 'the calm one is not');
  assert.match(bars.stripAnsi(text), /^✻ Opus 5  session █+░+ 85%  week █+░+ 12%$/);
});

test('line shows the spinner while working, and names the effort it was given', () => {
  const built = view.build({ now: NOW, headers: { five_hour: { used_percentage: 5, resets_at: 1 } }, headersAt: NOW, model: 'claude-opus-5', working: true, effort: 'xhigh' });
  const painted = feed.line(built, { columns: 120, mode: 'truecolor', tick: 1 });
  assert.strictEqual(bars.stripAnsi(painted).charAt(0), '✢');
  assert.match(bars.stripAnsi(painted), /xhigh/);
  assert.strictEqual(bars.stripAnsi(painted).indexOf('ultracode'), -1, 'xhigh is not ultracode');
  const rainbow = bars.THEME.rainbow.concat(bars.THEME.rainbowShimmer).map((rgb) => '38;2;' + rgb.join(';') + 'm');
  assert.strictEqual(rainbow.filter((code) => painted.indexOf(code) !== -1).length, 0, 'nothing rainbow at xhigh');
});

test('slotFrom keeps what an update does not repeat', () => {
  const first = feed.slotFrom({ session_id: 's', model: { id: 'claude-opus-5', display_name: 'Opus 5' }, rate_limits: { five_hour: { used_percentage: 1 } } }, null, NOW);
  const second = feed.slotFrom({ session_id: 's' }, first, NOW + 1000);
  assert.strictEqual(second.model, 'claude-opus-5');
  assert.strictEqual(second.modelName, 'Opus 5');
  assert.strictEqual(second.rateLimits.five_hour.used_percentage, 1);
  assert.strictEqual(second.headersAt, NOW);
  assert.strictEqual(second.prevAt, NOW);
  assert.strictEqual(second.at, NOW + 1000);
});

test('record keeps the newest sessions and newest picks the latest', () => {
  let all = {};
  for (let index = 0; index < 12; index += 1) {
    all = feed.record(all, { session_id: 's' + index }, NOW + index * 1000);
  }
  assert.strictEqual(Object.keys(all).length, feed.KEEP_SESSIONS);
  assert.strictEqual(feed.newest(all).sessionId, 's11');
  assert.strictEqual(feed.record(all, null, NOW), all);
  assert.strictEqual(feed.newest({}), null);
});

test('a status line on a fast timer cannot look permanently working', () => {
  assert.strictEqual(feed.gapMeansWorking({}), true);
  assert.strictEqual(feed.gapMeansWorking({ statusLine: { refreshInterval: 10 } }), true);
  assert.strictEqual(feed.gapMeansWorking({ statusLine: { refreshInterval: 2 } }), false);
});

test('the line spins for its own session only', () => {
  const marks = { me: { at: NOW, state: 'working', ultracode: true }, other: { at: NOW, state: 'working' } };
  assert.deepStrictEqual(feed.ownState(marks, 'me', NOW + 1000), { working: true, ultracode: true, ultrathink: false });
  assert.deepStrictEqual(feed.ownState(marks, 'quiet', NOW + 1000), { working: false, ultracode: false, ultrathink: false });
  assert.deepStrictEqual(feed.ownState(marks, 'me', NOW + 20 * 60 * 1000), { working: false, ultracode: false, ultrathink: false });
});

test('the bars run rainbow under ultrathink and purple under the ultracode level', () => {
  const headers = { five_hour: { used_percentage: 50, resets_at: 1 }, seven_day: { used_percentage: 20, resets_at: 1 } };
  const rainbowLine = feed.line(view.build({ now: NOW, headers, headersAt: NOW, model: 'claude-opus-5', working: true, effort: 'xhigh', ultrathink: true }), { columns: 120, mode: 'truecolor', tick: 2 });
  const rainbow = bars.THEME.rainbow.concat(bars.THEME.rainbowShimmer).map((rgb) => '38;2;' + rgb.join(';') + 'm');
  assert.ok(rainbow.filter((code) => rainbowLine.indexOf(code) !== -1).length >= 3, 'several rainbow colours in the bars');
  assert.strictEqual(bars.stripAnsi(rainbowLine).charAt(0), '✳', 'the spinner is a spinner, not a rainbow');

  const purpleLine = feed.line(view.build({ now: NOW, headers, headersAt: NOW, model: 'claude-opus-5', working: true, effort: 'ultracode' }), { columns: 120, mode: 'truecolor', tick: 2 });
  assert.ok(purpleLine.indexOf('38;2;175;135;255') !== -1, 'the ultra purple');
  assert.ok(purpleLine.indexOf('38;2;177;185;249') === -1, 'not the plain fill');
  assert.strictEqual(rainbow.filter((code) => purpleLine.indexOf(code) !== -1).length, 0, 'and no rainbow');
});

test('a display sticks to one session instead of flipping between two', () => {
  // Two Claudes, same model, different efforts: the header used to swap
  // between ultracode and xhigh every time either one ticked.
  const all = {
    a: { at: NOW, sessionId: 'a', effort: 'ultracode', model: 'claude-opus-5' },
    b: { at: NOW + 500, sessionId: 'b', effort: 'xhigh', model: 'claude-opus-5' },
  };
  const first = feed.stickySlot(all, null, NOW + 1000);
  assert.strictEqual(first.sessionId, 'b', 'with nothing held, the newest');
  assert.strictEqual(feed.stickySlot(all, 'a', NOW + 1000).sessionId, 'a', 'held sessions are kept');
  assert.strictEqual(feed.stickySlot(all, 'a', NOW + 2000).effort, 'ultracode');
  // Only once the held session has been quiet for a while does it move on.
  assert.strictEqual(feed.stickySlot(all, 'a', NOW + feed.STICKY_QUIET_MS + 1).sessionId, 'b');
  // A held session that has gone away is not held.
  assert.strictEqual(feed.stickySlot(all, 'gone', NOW + 1000).sessionId, 'b');
  assert.strictEqual(feed.stickySlot({}, 'a', NOW), null);
});

test('Codex gets a line of its own, underneath, counting down', () => {
  const dir = tempConfig();
  const result = run(dir, statusInput('claude-opus-5'), { CODEX_HOME: codexHome(15) });
  const lines = result.stdout.trim().split('\n');
  assert.strictEqual(lines.length, 2, 'the Claude line, then Codex below it: ' + result.stdout);
  assert.match(lines[0], /session/, 'Claude stays on the first line');
  assert.doesNotMatch(lines[0], /left/, 'and carries none of the Codex figures');
  // 15 per cent spent on the wire is 85 per cent left on screen.
  assert.match(lines[1], /85% left/);
  assert.match(lines[1], /ChatGPT Plus/);
  assert.ok(bars.visibleWidth(lines[1]) <= 120);
});

test('the Codex line is dropped, not blanked, when there is nothing to report', () => {
  const dir = tempConfig();
  const result = run(dir, statusInput('claude-opus-5'));
  assert.strictEqual(result.stdout.trim().split('\n').length, 1, 'no Codex, no second line');
});

test('the Codex line fits whatever width it is given', () => {
  const dir = tempConfig();
  const home = codexHome(94);
  // 24 and 20 are where it used to run four columns over: the rolled-over
  // window was still being drawn in a pane with no room for it.
  for (const columns of [120, 60, 38, 24, 20]) {
    const result = run(dir, statusInput('claude-opus-5'), { COLUMNS: String(columns), CODEX_HOME: home });
    const lines = result.stdout.trim().split('\n');
    assert.strictEqual(lines.length, 2, columns + ' columns lost the Codex line');
    for (const one of lines) {
      assert.ok(bars.visibleWidth(one) <= columns, columns + ' columns: ' + one);
    }
    // Nearly spent, so it must say so rather than reading as nearly full.
    assert.match(lines[1], /6% left/);
  }
});

test('Claude Code handing over its own status JSON settles the host', () => {
  // CODEX_HOME is what a Codex user has set globally; it must not silence the
  // Claude status line.
  const dir = tempConfig();
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify(statusInput('claude-opus-5')),
    encoding: 'utf8',
    timeout: 15000,
    env: Object.assign({ NO_COLOR: '1', COLUMNS: '120' }, process.env, {
      CLAUDE_CONFIG_DIR: dir,
      CODEX_HOME: path.join(dir, 'no-codex'),
    }),
  });
  assert.match(result.stdout, /session .*42%/, 'the Claude line survives CODEX_HOME');
});
