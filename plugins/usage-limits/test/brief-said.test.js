'use strict';
// A burst of prompts seconds apart gets the brief once, not once each.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('a session on an older plugin than the one installed hears so once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-stale-'));
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    delete require.cache[require.resolve('../skills/usage-limits/scripts/brief.js')];
    const brief = require('../skills/usage-limits/scripts/brief.js');
    const running = brief.runningVersion();
    assert.ok(running, 'the running version is read from package.json');
    const T = Date.UTC(2026, 8, 21, 12, 0, 0);
    const write = (version) => {
      fs.mkdirSync(path.join(dir, 'plugins'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'plugins', 'installed_plugins.json'), JSON.stringify({
        version: 2,
        plugins: { 'usage-limits@usage-limits': [{ scope: 'project', version: '0.0.1' }, { scope: 'user', version }] },
      }));
    };
    assert.strictEqual(brief.staleVersionFor('s-1', T), null, 'no registry: nothing to compare, nothing said');
    write(running);
    assert.strictEqual(brief.staleVersionFor('s-1', T), null, 'same version: silent');
    write('9.9.9');
    const said = brief.staleVersionFor('s-1', T);
    assert.match(said, /9\.9\.9 is installed but this session still runs/);
    assert.match(said, new RegExp(running.replace(/\./g, '\\.')));
    assert.strictEqual(brief.staleVersionFor('s-1', T + 60 * 1000), null, 'said once per session');
    assert.match(brief.staleVersionFor('s-2', T + 60 * 1000), /9\.9\.9/, 'another session hears it too');
    write('9.9.10');
    assert.match(brief.staleVersionFor('s-1', T + 120 * 1000), /9\.9\.10/, 'a newer install is news again');
    assert.strictEqual(brief.installedVersion(dir), '9.9.10', 'the user scope wins over the project scope');
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the same brief within ninety seconds is said once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-brief-said-'));
  const before = { dir: process.env.CLAUDE_CONFIG_DIR, rep: process.env.USAGE_LIMITS_BRIEF_REPEAT };
  process.env.CLAUDE_CONFIG_DIR = dir;
  delete process.env.USAGE_LIMITS_BRIEF_REPEAT;
  try {
    delete require.cache[require.resolve('../skills/usage-limits/scripts/brief.js')];
    const brief = require('../skills/usage-limits/scripts/brief.js');
    const T = Date.UTC(2026, 8, 20, 21, 0, 0);
    const line = '[usage-limits] binding window is 5-hour 52% used, about 58 turns of headroom, resets in 4h 29m.';
    assert.strictEqual(brief.sayOnce('s-1', line, T), line, 'first time: said');
    assert.strictEqual(brief.sayOnce('s-1', line.replace('52%', '53%'), T + 30 * 1000), '', 'same shape thirty seconds later: silent');
    assert.strictEqual(brief.sayOnce('s-2', line, T + 30 * 1000), line, 'another session: said');
    assert.strictEqual(brief.sayOnce('s-1', line + ' The budget is nearly gone.', T + 40 * 1000), line + ' The budget is nearly gone.', 'a different instruction: said');
    assert.strictEqual(brief.sayOnce('s-1', line, T + 3 * 60 * 1000), line, 'after the window: said again');
    assert.strictEqual(brief.sayOnce('s-1', '', T), '', 'nothing stays nothing');
    process.env.USAGE_LIMITS_BRIEF_REPEAT = '1';
    assert.strictEqual(brief.sayOnce('s-1', line, T + 3 * 60 * 1000 + 5000), line, 'opted out: always said');
    assert.strictEqual(brief.shapeOf('5-hour 12% used, 3 turns'), '#-hour #% used, # turns');
  } finally {
    if (before.dir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = before.dir;
    if (before.rep === undefined) delete process.env.USAGE_LIMITS_BRIEF_REPEAT; else process.env.USAGE_LIMITS_BRIEF_REPEAT = before.rep;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('how the last relay ended is said once per session, and a newer one is news again', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-relaylast-'));
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    delete require.cache[require.resolve('../skills/usage-limits/scripts/brief.js')];
    const brief = require('../skills/usage-limits/scripts/brief.js');
    const t = Date.parse('2026-09-22T22:00:00Z');
    const lost = { endedAt: t - 3600e3, outcome: 'lost', detail: 'the wake started 10:53 and never reported back' };
    assert.strictEqual(brief.relayNewsFor('s1', lost, t), lost);
    // The next prompt of the same session: already told.
    assert.strictEqual(brief.relayNewsFor('s1', lost, t + 60e3), null);
    assert.strictEqual(brief.relayNewsFor('s1', lost, t + 5 * 3600e3), null);
    // Another session has not heard it yet.
    assert.strictEqual(brief.relayNewsFor('s2', lost, t + 60e3), lost);
    // A different relay ending is news again.
    const resumed = { endedAt: t + 2 * 3600e3, outcome: 'resumed' };
    assert.strictEqual(brief.relayNewsFor('s1', resumed, t + 2 * 3600e3), resumed);
    assert.strictEqual(brief.relayNewsFor('s1', null, t), null);
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
