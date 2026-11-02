'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');

const panel = require('../skills/usage-limits/scripts/panel.js');
const view = require('../skills/usage-limits/scripts/view.js');
const bars = require('../skills/usage-limits/scripts/bars.js');
const tempdirs = require('../tools/test-tempdirs.js');

const script = path.join(__dirname, '..', 'skills', 'usage-limits', 'scripts', 'panel.js');
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

function tempConfig(model) {
  const dir = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-panel-'));
  fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify(account(Date.now())));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ model: model || 'claude-opus-5' }));
  return dir;
}

function run(dir, args, env) {
  return spawnSync(process.execPath, [script].concat(args || []), {
    encoding: 'utf8',
    timeout: 20000,
    env: Object.assign({ NO_COLOR: '1', COLUMNS: '60' }, process.env, { CLAUDE_CONFIG_DIR: dir }, env || {}),
  });
}

function closedPort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

const NODE = '/usr/bin/node';
const PANEL = '/home/me/panel.js';

test('openCommand knows how to split each terminal', () => {
  const tmux = panel.openCommand({ TMUX: '/tmp/x' }, PANEL, NODE, 'linux');
  assert.strictEqual(tmux.program, 'tmux');
  assert.deepStrictEqual(tmux.args, ['split-window', '-h', '-d', '-l', '24%', '"/usr/bin/node" "/home/me/panel.js"']);

  const wez = panel.openCommand({ WEZTERM_PANE: '1' }, PANEL, NODE, 'darwin');
  assert.strictEqual(wez.program, 'wezterm');
  assert.deepStrictEqual(wez.args, ['cli', 'split-pane', '--right', '--percent', '24', '--', NODE, PANEL]);

  const kitty = panel.openCommand({ KITTY_WINDOW_ID: '1' }, PANEL, NODE, 'linux');
  assert.strictEqual(kitty.program, 'kitten');
  assert.ok(kitty.args.indexOf('--location=vsplit') !== -1);

  const zellij = panel.openCommand({ ZELLIJ: '0' }, PANEL, NODE, 'linux');
  assert.strictEqual(zellij.program, 'zellij');
  assert.deepStrictEqual(zellij.args.slice(0, 4), ['action', 'new-pane', '-d', 'right']);

  const wt = panel.openCommand({ WT_SESSION: 'abc' }, 'C:\\p\\panel.js', 'C:\\node.exe', 'win32');
  assert.strictEqual(wt.shell, true);
  assert.strictEqual(
    wt.command,
    'start "" wt.exe -w 0 sp -V --size 0.24 --title "Claude usage" --suppressApplicationTitle "C:\\node.exe" "C:\\p\\panel.js"'
  );

  const plainWindows = panel.openCommand({}, 'C:\\p\\panel.js', 'C:\\node.exe', 'win32');
  assert.strictEqual(plainWindows.shell, true);
  assert.match(plainWindows.command, /^start "Claude usage" /);

  const iterm = panel.openCommand({ TERM_PROGRAM: 'iTerm.app' }, PANEL, NODE, 'darwin');
  assert.strictEqual(iterm.program, 'osascript');
  assert.match(iterm.args[1], /split vertically/);

  assert.strictEqual(panel.openCommand({}, PANEL, NODE, 'linux'), null);
  assert.strictEqual(panel.openCommand({ TERM_PROGRAM: 'Apple_Terminal' }, PANEL, NODE, 'darwin'), null);
  // A multiplexer wins over the outer terminal.
  assert.strictEqual(panel.openCommand({ TMUX: '1', WT_SESSION: 'x' }, PANEL, NODE, 'win32').program, 'tmux');
});

test('parseArgs reads every flag', () => {
  const args = panel.parseArgs(['--once', '--no-fetch', '--poll', '45', '--width=30', '--ascii', '--json']);
  assert.strictEqual(args.once, true);
  assert.strictEqual(args.fetch, false);
  assert.strictEqual(args.poll, 45);
  assert.strictEqual(args.width, 30);
  assert.strictEqual(args.ascii, true);
  assert.strictEqual(args.json, true);
  assert.strictEqual(panel.parseArgs([]).fetch, true);
  assert.strictEqual(panel.parseArgs(['--open']).open, true);
});

test('render draws a titled section per window with the reset underneath', () => {
  const built = view.build({
    now: NOW,
    utilization: account(NOW).cachedUsageUtilization.utilization,
    fetchedAtMs: NOW - 1000,
    source: 'api',
    model: 'claude-fable-5-1[1m]',
    effort: 'xhigh',
  });
  built.sessions = 2;
  built.fetch = true;
  const lines = panel.render(built, { columns: 40, mode: 'none', tick: 0, now: NOW, clock: '24h' });
  const text = lines.join('\n');
  assert.match(lines[0], /^✻ Claude usage$/);
  assert.match(lines[1], /^Fable 5\.1 1M · xhigh · idle$/);
  assert.match(text, /Current session\n█+░+ 42%\nresets in 1h at /);
  assert.match(text, /Current week \(all models\)\n█+░+ 7%\nresets in 1d 0h at /);
  assert.match(text, /Current week \(Fable\)\n█+░+ 3%/);
  assert.match(text, /2 sessions sharing this budget/);
  assert.match(text, /live, updated 1s ago/);
  assert.match(text, /q quit · r refresh/);
  for (const line of lines) assert.ok(bars.visibleWidth(line) <= 40, 'fits: ' + line);
});

test('render hides the Fable week for another model and fits a narrow pane', () => {
  const built = view.build({
    now: NOW,
    utilization: account(NOW).cachedUsageUtilization.utilization,
    fetchedAtMs: NOW - 1000,
    source: 'api',
    model: 'claude-opus-5',
  });
  const lines = panel.render(built, { columns: 24, mode: 'none', tick: 0, now: NOW });
  const text = lines.join('\n');
  assert.strictEqual(text.indexOf('Fable'), -1);
  // A narrow pane gets the short titles.
  assert.match(text, /^Session$/m);
  assert.match(text, /^Week$/m);
  assert.strictEqual(text.indexOf('Current session'), -1);
  for (const line of lines) assert.ok(bars.visibleWidth(line) <= 24, 'fits: ' + line);
});

test('render fits a short pane by dropping breathing room, then the footer', () => {
  const built = view.build({
    now: NOW,
    utilization: account(NOW).cachedUsageUtilization.utilization,
    fetchedAtMs: NOW,
    source: 'api',
    model: 'claude-opus-5',
  });
  const tall = panel.render(built, { columns: 40, mode: 'none', now: NOW });
  const medium = panel.render(built, { columns: 40, mode: 'none', now: NOW, rows: tall.length - 2 });
  assert.ok(medium.length <= tall.length - 2);
  assert.ok(medium.indexOf('') === -1, 'spacers dropped first');
  const tiny = panel.render(built, { columns: 40, mode: 'none', now: NOW, rows: 5 });
  assert.strictEqual(tiny.length, 5);
  assert.match(tiny[0], /Claude usage/);
});

test('render paints the working state, the ultracode rainbow and the note colours', () => {
  const working = view.build({
    now: NOW,
    utilization: account(NOW).cachedUsageUtilization.utilization,
    fetchedAtMs: NOW,
    source: 'api',
    model: 'claude-opus-5',
    working: true,
    effort: 'xhigh',
  });
  const spun = panel.render(working, { columns: 40, mode: 'truecolor', tick: 2, now: NOW });
  assert.strictEqual(bars.stripAnsi(spun[0]).charAt(0), '✳');
  assert.ok(spun[0].indexOf('38;2;235;159;127') !== -1, 'the title shimmers in the claude colour');
  assert.match(bars.stripAnsi(spun[1]), /working$/);

  // The animation is on the BARS, never on the title, and it follows the
  // effort level and the ultrathink keyword rather than any word in a prompt.
  const rainbowCodes = bars.THEME.rainbow.concat(bars.THEME.rainbowShimmer).map((rgb) => '38;2;' + rgb.join(';') + 'm');
  const thinking = view.build({ now: NOW, utilization: account(NOW).cachedUsageUtilization.utilization, fetchedAtMs: NOW, source: 'api', model: 'claude-opus-5', working: true, effort: 'xhigh', ultrathink: true });
  const painted = panel.render(thinking, { columns: 40, mode: 'truecolor', tick: 3, now: NOW });
  const bodyText = painted.slice(2).join('\n');
  // Only the word is rainbow. Every bar line keeps its own level colour.
  const barLines = painted.filter((line) => line.indexOf('█') !== -1 || line.indexOf('░') !== -1);
  assert.ok(barLines.length > 0, 'there are bars to check');
  for (const line of barLines) {
    assert.strictEqual(rainbowCodes.filter((code) => line.indexOf(code) !== -1).length, 0, 'the bars are not rainbow under ultrathink');
  }
  assert.ok(rainbowCodes.filter((code) => painted[1].indexOf(code) !== -1).length >= 3, 'the word ultrathink is painted in the rainbow');
  void bodyText;
  assert.strictEqual(rainbowCodes.filter((code) => painted[0].indexOf(code) !== -1).length, 0, 'the title is never rainbow');
  assert.ok(painted[0].indexOf('38;2;215;119;87') !== -1 || painted[0].indexOf('38;2;235;159;127') !== -1, 'the title stays Claude orange');
  assert.match(bars.stripAnsi(painted[1]), /xhigh/, 'the effort is still xhigh');
  assert.match(bars.stripAnsi(painted[1]), /ultrathink/);

  const ultra = view.build({ now: NOW, utilization: account(NOW).cachedUsageUtilization.utilization, fetchedAtMs: NOW, source: 'api', model: 'claude-opus-5', working: true, effort: 'ultracode' });
  const purple = panel.render(ultra, { columns: 40, mode: 'truecolor', tick: 3, now: NOW });
  assert.ok(purple.slice(2).join('\n').indexOf('38;2;175;135;255') !== -1, 'the bars run purple under the ultracode level');
  assert.strictEqual(rainbowCodes.filter((code) => purple.join('\n').indexOf(code) !== -1).length, 0, 'no rainbow anywhere');
  assert.match(bars.stripAnsi(purple[1]), /ultracode/);

  const offline = view.build({ now: NOW, utilization: account(NOW).cachedUsageUtilization.utilization, fetchedAtMs: NOW - 3 * 60000, source: 'api', model: 'claude-opus-5', outcome: { ok: false, kind: 'offline' } });
  offline.outcome = { ok: false, kind: 'offline' };
  const warned = panel.render(offline, { columns: 60, mode: 'truecolor', tick: 0, now: NOW }).join('\n');
  assert.ok(warned.indexOf('\x1b[38;2;255;193;7moffline, showing the reading from 3m ago') !== -1, 'offline is a warning');

  const signedOut = view.build({ now: NOW, outcome: { ok: false, kind: 'unauthorized' } });
  signedOut.outcome = { ok: false, kind: 'unauthorized' };
  const red = panel.render(signedOut, { columns: 60, mode: 'truecolor', tick: 0, now: NOW }).join('\n');
  assert.ok(red.indexOf('\x1b[38;2;255;107;128msign in to Claude Code again') !== -1, 'a login problem is an error');
});

test('fit cuts a painted line without leaving colour running', () => {
  const painted = bars.paint('abcdefghij', [1, 2, 3], 'truecolor');
  const cut = panel.fit(painted, 4);
  assert.strictEqual(bars.stripAnsi(cut), 'abcd');
  assert.ok(cut.endsWith('\x1b[0m'));
  assert.strictEqual(panel.fit('short', 10), 'short');
});

test('--once prints a frame from the reading on disk and exits', () => {
  const dir = tempConfig('claude-fable-5-1');
  const result = run(dir, ['--once', '--no-fetch']);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /Claude usage/);
  assert.match(result.stdout, /Current session/);
  assert.match(result.stdout, /42%/);
  assert.match(result.stdout, /Current week \(Fable\)/);
  assert.match(result.stdout, /network off/);
  assert.strictEqual(result.stdout.indexOf('q quit'), -1, 'no key hints in a one-off frame');
});

test('--json prints the frame as fields and never the token', () => {
  const dir = tempConfig('claude-opus-5');
  fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'secret-token-xyz' } }));
  const result = run(dir, ['--json', '--no-fetch']);
  assert.strictEqual(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.strictEqual(parsed.rows[0].key, 'five_hour');
  assert.strictEqual(parsed.rows[0].percent, 42);
  assert.strictEqual(parsed.fable, null);
  assert.strictEqual(parsed.hidden.length, 1);
  assert.strictEqual(result.stdout.indexOf('secret-token-xyz'), -1);
});

test('with the network unreachable the frame says offline and keeps the reading', async () => {
  const dir = tempConfig('claude-opus-5');
  fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } }));
  const port = await closedPort();
  const result = run(dir, ['--once'], { USAGE_LIMITS_USAGE_URL: 'http://127.0.0.1:' + port + '/api/oauth/usage' });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /offline, showing the reading from/);
  assert.match(result.stdout, /42%/);
});

test('USAGE_LIMITS_FETCH=off is the same as --no-fetch', async () => {
  const dir = tempConfig('claude-opus-5');
  fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } }));
  const port = await closedPort();
  const result = run(dir, ['--once'], { USAGE_LIMITS_FETCH: 'off', USAGE_LIMITS_USAGE_URL: 'http://127.0.0.1:' + port + '/x' });
  assert.strictEqual(result.stdout.indexOf('offline'), -1);
  assert.match(result.stdout, /network off/);
});

test('under Codex the panel reads the Codex meter and says so in the title', () => {
  const dir = tempConfig('claude-opus-5');
  const codexHome = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-codex-home-'));
  const result = run(dir, ['--once', '--no-fetch', '--host', 'codex'], { CODEX_HOME: codexHome });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /Codex usage/);
  assert.match(result.stdout, /no reading yet/);
  assert.strictEqual(result.stdout.indexOf('Claude usage'), -1);
  const open = panel.openCommand({ TMUX: '1' }, PANEL, NODE, 'linux', ['--host', 'codex']);
  assert.strictEqual(open.args[5], '"/usr/bin/node" "/home/me/panel.js" "--host" "codex"');
});

test('--help prints the flags', () => {
  const dir = tempConfig('claude-opus-5');
  const result = run(dir, ['--help']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /--open/);
  assert.match(result.stdout, /--no-fetch/);
});

test('pollBase is quick while working, slow while idle, and never under the floor', () => {
  assert.strictEqual(panel.pollBase({ working: true }, {}, {}), panel.POLL_WORKING_MS);
  assert.strictEqual(panel.pollBase({ working: false }, {}, {}), panel.POLL_IDLE_MS);
  assert.strictEqual(panel.pollBase({ working: false }, { poll: 45 }, {}), 45000);
  assert.strictEqual(panel.pollBase({ working: true }, { poll: 1 }, {}), 15000);
  assert.strictEqual(panel.pollBase({ working: true }, {}, { USAGE_LIMITS_POLL: '50' }), 50000);
});

test('the footer reports the network setting, not whether this frame fetched', async () => {
  const dir = tempConfig('claude-opus-5');
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    const between = await panel.snapshot({ fetch: false, network: true });
    assert.strictEqual(between.fetch, true, 'a frame rebuilt from disk between readings is not network off');
    const off = await panel.snapshot({ fetch: false, network: false });
    assert.strictEqual(off.fetch, false);
    const legacy = await panel.snapshot({ fetch: false });
    assert.strictEqual(legacy.fetch, false);
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
  }
});

test('tmux older than 3.1 gets the old percentage flag', () => {
  const old = panel.openCommand({ TMUX: '1' }, PANEL, NODE, 'linux', [], { tmuxVersion: 'tmux 3.0a' });
  assert.deepStrictEqual(old.args.slice(0, 5), ['split-window', '-h', '-d', '-p', '24']);
  const modern = panel.openCommand({ TMUX: '1' }, PANEL, NODE, 'linux', [], { tmuxVersion: 'tmux 3.4' });
  assert.deepStrictEqual(modern.args.slice(0, 5), ['split-window', '-h', '-d', '-l', '24%']);
  const unknown = panel.openCommand({ TMUX: '1' }, PANEL, NODE, 'linux', [], {});
  assert.deepStrictEqual(unknown.args.slice(3, 5), ['-l', '24%']);
});

test('render cuts to the width that really exists, even under the layout minimum', () => {
  const built = view.build({ now: NOW, utilization: account(NOW).cachedUsageUtilization.utilization, fetchedAtMs: NOW, source: 'api', model: 'claude-opus-5' });
  for (const line of panel.render(built, { columns: 15, mode: 'none', now: NOW })) {
    assert.ok(bars.visibleWidth(line) <= 15, 'fits 15: ' + line);
  }
});

test('the pace line says when the binding window runs out, coloured by how soon', () => {
  const built = view.build({ now: NOW, utilization: account(NOW).cachedUsageUtilization.utilization, fetchedAtMs: NOW, source: 'api', model: 'claude-opus-5' });
  built.pace = { label: '5-hour', headroomMs: 25 * 60 * 1000, resetsInMs: HOUR, turnsLeft: 12, runsOut: true };
  const soon = panel.render(built, { columns: 80, mode: 'truecolor', now: NOW }).join('\n');
  assert.ok(soon.indexOf('\x1b[38;2;255;193;7mat this pace the 5-hour window runs out in 25m, about 12 turns') !== -1, soon);
  built.pace = { label: '5-hour', headroomMs: 5 * 60 * 1000, resetsInMs: HOUR, turnsLeft: 2, runsOut: true };
  const now = panel.render(built, { columns: 80, mode: 'truecolor', now: NOW }).join('\n');
  assert.ok(now.indexOf('\x1b[38;2;255;107;128mat this pace') !== -1, 'under ten minutes is red');
  built.pace = { label: '5-hour', headroomMs: 3 * HOUR, resetsInMs: HOUR, turnsLeft: 90, runsOut: false };
  const fine = panel.render(built, { columns: 80, mode: 'none', now: NOW }).join('\n');
  assert.strictEqual(fine.indexOf('at this pace'), -1, 'the reset comes first, so nothing to say');
  built.pace = null;
  assert.strictEqual(panel.render(built, { columns: 80, mode: 'none', now: NOW }).join('\n').indexOf('at this pace'), -1);
  assert.strictEqual(panel.parseArgs(['--no-bell']).bell, false);
  assert.strictEqual(panel.parseArgs([]).bell, true);
});

test('the pace line shrinks to fit a narrow pane instead of being cut off', () => {
  const built = view.build({ now: NOW, utilization: account(NOW).cachedUsageUtilization.utilization, fetchedAtMs: NOW, source: 'api', model: 'claude-opus-5' });
  built.pace = { label: '5-hour', headroomMs: 25 * 60 * 1000, resetsInMs: HOUR, turnsLeft: 12, runsOut: true };
  const narrow = panel.render(built, { columns: 26, mode: 'none', now: NOW }).join('\n');
  assert.match(narrow, /^wall in 25m$/m, narrow);
  const thirty = panel.render(built, { columns: 30, mode: 'none', now: NOW }).join('\n');
  assert.match(thirty, /^runs out in 25m at this pace$/m, thirty);
  const middling = panel.render(built, { columns: 44, mode: 'none', now: NOW }).join('\n');
  assert.match(middling, /^runs out in 25m at this pace, about 12 turns$/m, middling);
  const tighter = panel.render(built, { columns: 36, mode: 'none', now: NOW }).join('\n');
  assert.match(tighter, /^runs out in 25m at this pace$/m, tighter);
  const wide = panel.render(built, { columns: 80, mode: 'none', now: NOW }).join('\n');
  assert.match(wide, /^at this pace the 5-hour window runs out in 25m, about 12 turns$/m);
});

test('the freshness footer stacks in a narrow pane and a plain cut stays plain', () => {
  const built = view.build({ now: NOW, utilization: account(NOW).cachedUsageUtilization.utilization, fetchedAtMs: NOW - 25000, source: 'api', model: 'claude-opus-5' });
  built.fetch = false;
  const narrow = panel.render(built, { columns: 30, mode: 'none', now: NOW });
  assert.ok(narrow.indexOf('live, updated 25s ago') !== -1, narrow.join('\n'));
  assert.ok(narrow.indexOf('network off') !== -1, narrow.join('\n'));
  const wide = panel.render(built, { columns: 60, mode: 'none', now: NOW });
  assert.ok(wide.indexOf('live, updated 25s ago · network off') !== -1, wide.join('\n'));
  for (const line of narrow) assert.strictEqual(line.indexOf('\x1b'), -1, 'no escapes in plain mode: ' + JSON.stringify(line));
  assert.strictEqual(panel.fit('plain text that is long', 5), 'plain');
  assert.ok(panel.fit(bars.paint('coloured text', [1, 2, 3], 'truecolor'), 4).endsWith('\x1b[0m'));
});
