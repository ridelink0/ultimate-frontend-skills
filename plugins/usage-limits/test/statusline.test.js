'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const statusline = require('../skills/usage-limits/scripts/statusline.js');
const tempdirs = require('../tools/test-tempdirs.js');

const root = path.join(__dirname, '..');

function withConfigDir(fn) {
  const dir = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-statusline-'));
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
  }
}

function quietly(fn) {
  const written = [];
  const out = process.stdout.write;
  const err = process.stderr.write;
  process.stdout.write = (chunk) => {
    written.push(String(chunk));
    return true;
  };
  process.stderr.write = (chunk) => {
    written.push(String(chunk));
    return true;
  };
  try {
    const code = fn();
    return { code, output: written.join('') };
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
}

function settings(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
}

test('status reports off when nothing is set', () =>
  withConfigDir(() => {
    const { code, output } = quietly(() => statusline.main(['status']));
    assert.strictEqual(code, 0);
    assert.match(output, /status line: off/);
  }));

test('on writes the launcher and points settings.json at it', () =>
  withConfigDir((dir) => {
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ model: 'opus' }));
    const { code, output } = quietly(() => statusline.main(['on']));
    assert.strictEqual(code, 0);
    assert.match(output, /statusLine: \(unset\) ->/);
    const saved = settings(dir);
    assert.strictEqual(saved.model, 'opus', 'other keys untouched');
    assert.strictEqual(saved.statusLine.type, 'command');
    assert.ok(saved.statusLine.command.indexOf('usage-limits-statusline.js') !== -1);
    assert.strictEqual(saved.statusLine.refreshInterval, undefined);
    assert.ok(fs.existsSync(statusline.launcherFile()));
    assert.ok(fs.existsSync(path.join(dir, 'settings.json.usage-limits-backup')), 'backed up once');
    const state = statusline.readState();
    assert.strictEqual(state.previous, null);
    assert.strictEqual(state.chain, false);
    assert.strictEqual(state.feed, path.join(root, 'skills', 'usage-limits', 'scripts', 'feed.js'));

    const status = quietly(() => statusline.main(['status']));
    assert.match(status.output, /status line: on/);
  }));

test('an existing status line is kept and chained', () =>
  withConfigDir((dir) => {
    const before = { type: 'command', command: 'echo hi', padding: 1 };
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ statusLine: before }));
    quietly(() => statusline.main(['on']));
    const state = statusline.readState();
    assert.deepStrictEqual(state.previous, before);
    assert.strictEqual(state.chain, true);
    const status = quietly(() => statusline.main(['status']));
    assert.match(status.output, /chained\s+echo hi/);
  }));

test('--no-chain records the previous line but does not run it', () =>
  withConfigDir((dir) => {
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'echo hi' } }));
    quietly(() => statusline.main(['on', '--no-chain']));
    const state = statusline.readState();
    assert.strictEqual(state.chain, false);
    assert.strictEqual(state.previous.command, 'echo hi');
  }));

test('--refresh sets the timer and refuses nonsense', () =>
  withConfigDir((dir) => {
    fs.writeFileSync(path.join(dir, 'settings.json'), '{}');
    quietly(() => statusline.main(['on', '--refresh', '2']));
    assert.strictEqual(settings(dir).statusLine.refreshInterval, 2);
    const bad = quietly(() => statusline.main(['on', '--refresh', 'soon']));
    assert.strictEqual(bad.code, 2);
    const zero = quietly(() => statusline.main(['on', '--refresh=0']));
    assert.strictEqual(zero.code, 2);
  }));

test('on twice keeps the original to restore', () =>
  withConfigDir((dir) => {
    const before = { type: 'command', command: 'echo hi' };
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ statusLine: before }));
    quietly(() => statusline.main(['on']));
    const second = quietly(() => statusline.main(['on']));
    assert.match(second.output, /already on/);
    assert.deepStrictEqual(statusline.readState().previous, before);
    quietly(() => statusline.main(['off']));
    assert.deepStrictEqual(settings(dir).statusLine, before);
  }));

test('off puts back exactly what was there, including nothing', () =>
  withConfigDir((dir) => {
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ model: 'opus' }));
    quietly(() => statusline.main(['on']));
    const { code, output } = quietly(() => statusline.main(['off']));
    assert.strictEqual(code, 0);
    assert.match(output, /removed/);
    assert.deepStrictEqual(settings(dir), { model: 'opus' });
    assert.ok(!fs.existsSync(statusline.launcherFile()));
    assert.strictEqual(statusline.readState(), null);
    const again = quietly(() => statusline.main(['off']));
    assert.match(again.output, /already off/);
  }));

test('--dry-run writes nothing', () =>
  withConfigDir((dir) => {
    fs.writeFileSync(path.join(dir, 'settings.json'), '{}');
    const { output } = quietly(() => statusline.main(['on', '--dry-run']));
    assert.match(output, /statusLine: \(unset\) ->/);
    assert.deepStrictEqual(settings(dir), {});
    assert.ok(!fs.existsSync(statusline.launcherFile()));
  }));

test('an unknown command is refused', () =>
  withConfigDir(() => {
    const { code } = quietly(() => statusline.main(['sideways']));
    assert.strictEqual(code, 2);
  }));

test('the launcher finds feed.js and prints the line', () =>
  withConfigDir((dir) => {
    fs.writeFileSync(
      path.join(dir, '.claude.json'),
      JSON.stringify({
        oauthAccount: { accountUuid: 'acc', organizationType: 'claude_max' },
        cachedUsageUtilization: {
          fetchedAtMs: Date.now() - 1000,
          accountUuid: 'acc',
          utilization: {
            five_hour: { utilization: 42, resets_at: new Date(Date.now() + 3600000).toISOString() },
            seven_day: { utilization: 7, resets_at: new Date(Date.now() + 86400000).toISOString() },
          },
        },
      })
    );
    fs.writeFileSync(path.join(dir, 'settings.json'), '{}');
    quietly(() => statusline.main(['on']));
    const result = spawnSync(process.execPath, [statusline.launcherFile()], {
      input: JSON.stringify({ session_id: 'abc', model: { id: 'claude-opus-5', display_name: 'Opus 5' } }),
      encoding: 'utf8',
      timeout: 15000,
      env: Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: dir, NO_COLOR: '1', COLUMNS: '100' }),
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /session .*42%/);
    assert.match(result.stdout, /week .*7%/);
    assert.match(result.stdout, /Opus 5/);
  }));

test('the launcher exits quietly when there is nothing to run', () =>
  withConfigDir((dir) => {
    const launcher = path.join(dir, 'launcher.js');
    fs.writeFileSync(launcher, statusline.launcherSource(path.join(dir, 'nowhere', 'feed.js')));
    const result = spawnSync(process.execPath, [launcher], {
      input: '{}',
      encoding: 'utf8',
      timeout: 15000,
      env: Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: dir }),
    });
    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stdout, '');
  }));

test('planOn never records our own launcher as the thing to restore', () => {
  const launcher = '/tmp/x/usage-limits-statusline.js';
  const ours = { type: 'command', command: 'node "' + launcher + '"' };
  const planned = statusline.planOn({ statusLine: ours }, null, { launcher });
  assert.strictEqual(planned.state.previous, null);
  assert.strictEqual(planned.changes.length, 0);
});
