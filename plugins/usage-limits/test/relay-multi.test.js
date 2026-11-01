'use strict';
// Two sessions arm on the same night. Neither displaces the other; each wakes
// on its own task; each can cancel only its own.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function isolated(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-relay-multi-'));
  const before = { dir: process.env.CLAUDE_CONFIG_DIR, sid: process.env.CLAUDE_CODE_SESSION_ID };
  process.env.CLAUDE_CONFIG_DIR = dir;
  delete process.env.CLAUDE_CODE_SESSION_ID;
  fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ projects: {} }));
  try {
    return fn(dir);
  } finally {
    if (before.dir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = before.dir;
    if (before.sid === undefined) delete process.env.CLAUDE_CODE_SESSION_ID; else process.env.CLAUDE_CODE_SESSION_ID = before.sid;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const NOW = Date.UTC(2026, 8, 20, 20, 0, 0);
function armIt(relay, id, cwd) {
  return relay.arm({
    now: NOW, sessionId: id, cwd, project: 'p-' + id, schedule: false,
    resetsAt: NOW + 60 * 60 * 1000,
    binding: { percentUsed: 85, resetsAt: NOW + 60 * 60 * 1000, key: 'five_hour', label: '5-hour' },
    work: { hasWork: true, pending: 1, source: 'test', todos: [] },
    config: { enabled: true, mode: 'resume', graceMinutes: 2, permissionMode: 'bypassPermissions', armOn: 'threshold', at: 80, attempts: 2, backstopAt: 95 },
  });
}

test('a second session arms beside the first instead of displacing it', () => {
  isolated((dir) => {
    delete require.cache[require.resolve('../skills/usage-limits/scripts/relay.js')];
    const relay = require('../skills/usage-limits/scripts/relay.js');
    assert.ok(armIt(relay, 'aaaa-1', dir).ok);
    assert.ok(armIt(relay, 'bbbb-2', dir).ok);
    const state = relay.read();
    assert.strictEqual(state.armed.id, 'aaaa-1', 'the first stays primary');
    assert.deepStrictEqual(relay.records(state).map((r) => r.id), ['aaaa-1', 'bbbb-2']);
    assert.strictEqual(relay.armedFor(state, 'bbbb-2').id, 'bbbb-2');
    const log = fs.readFileSync(relay.logFile(), 'utf8');
    assert.doesNotMatch(log, /displacing/);
    assert.match(log, /armed bbbb-2 .* beside aaaa-1/);
    const status = relay.status(NOW);
    assert.match(status, /session aaaa-1/);
    assert.match(status, /session bbbb-2/);
    assert.match(status, /2 sessions armed/);
  });
});

test('re-arming the same session replaces its own record only', () => {
  isolated((dir) => {
    delete require.cache[require.resolve('../skills/usage-limits/scripts/relay.js')];
    const relay = require('../skills/usage-limits/scripts/relay.js');
    armIt(relay, 'aaaa-1', dir);
    armIt(relay, 'bbbb-2', dir);
    armIt(relay, 'bbbb-2', dir);
    assert.deepStrictEqual(relay.records(relay.read()).map((r) => r.id), ['aaaa-1', 'bbbb-2']);
  });
});

test('disarm with an id cancels that session; without one cancels all', () => {
  isolated((dir) => {
    delete require.cache[require.resolve('../skills/usage-limits/scripts/relay.js')];
    const relay = require('../skills/usage-limits/scripts/relay.js');
    armIt(relay, 'aaaa-1', dir);
    armIt(relay, 'bbbb-2', dir);
    const one = relay.disarm('cancelled', NOW, 'aaaa-1');
    assert.strictEqual(one.changed, true);
    const after = relay.read();
    assert.strictEqual(after.armed.id, 'bbbb-2', 'the other is promoted to primary');
    assert.strictEqual(after.others, undefined);
    const none = relay.disarm('cancelled', NOW, 'zzzz-9');
    assert.strictEqual(none.changed, false);
    assert.strictEqual(none.refused, true);
    armIt(relay, 'cccc-3', dir);
    const all = relay.disarm('cancelled', NOW);
    assert.strictEqual(all.records.length, 2);
    assert.strictEqual(relay.records(relay.read()).length, 0);
  });
});

test('a lost wake is reaped for the session it belongs to, the other stays', () => {
  isolated((dir) => {
    delete require.cache[require.resolve('../skills/usage-limits/scripts/relay.js')];
    const relay = require('../skills/usage-limits/scripts/relay.js');
    armIt(relay, 'aaaa-1', dir);
    armIt(relay, 'bbbb-2', dir);
    const state = relay.read();
    relay.armedFor(state, 'aaaa-1').wakeAt = NOW - 24 * 60 * 60 * 1000;
    relay.write(state);
    assert.strictEqual(relay.reapLost(NOW), true);
    const after = relay.read();
    assert.deepStrictEqual(relay.records(after).map((r) => r.id), ['bbbb-2']);
    assert.strictEqual(after.history[after.history.length - 1].outcome, 'lost');
  });
});

test('the wake picks the record for its own id and leaves the other armed', async () => {
  await (async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-relay-multi-wake-'));
    const before = { dir: process.env.CLAUDE_CONFIG_DIR, sid: process.env.CLAUDE_CODE_SESSION_ID };
    process.env.CLAUDE_CONFIG_DIR = dir;
    delete process.env.CLAUDE_CODE_SESSION_ID;
    fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ projects: {} }));
    try {
      delete require.cache[require.resolve('../skills/usage-limits/scripts/relay.js')];
      delete require.cache[require.resolve('../skills/usage-limits/scripts/wake.js')];
      const relay = require('../skills/usage-limits/scripts/relay.js');
      const wake = require('../skills/usage-limits/scripts/wake.js');
      relay.configure({ enabled: true, mode: 'resume', permissionMode: 'bypassPermissions' });
      armIt(relay, 'aaaa-1', dir);
      armIt(relay, 'bbbb-2', dir);
      const result = await wake.run(NOW + 61 * 60 * 1000, ['--id', 'bbbb-2'], {
        windowReopened: async () => ({ known: true, percent: 3 }),
        // Online, stubbed: this is about which record a wake picks, not about
        // whether this machine can reach the API. Left real, it took the
        // offline branch and reported 'offline-gave-up'.
        reachable: async () => ({ online: true, reason: 'ok', detail: null, results: [] }),
        userIsPresent: () => false,
        toast: () => {},
        capabilities: () => ({ claude: true, codex: false, computerUse: false }),
        deliverClaude: () => ({ ok: true, how: 'test' }),
        deliverCodex: () => ({ ok: true, how: 'test' }),
      });
      assert.strictEqual(result.outcome, 'resumed');
      const after = relay.read();
      assert.deepStrictEqual(relay.records(after).map((r) => r.id), ['aaaa-1'], 'the first session is still armed');
      const other = await wake.run(NOW + 61 * 60 * 1000, ['--id', 'zzzz-9'], { windowReopened: async () => ({ known: false }) });
      assert.strictEqual(other.outcome, 'superseded');
    } finally {
      if (before.dir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = before.dir;
      if (before.sid === undefined) delete process.env.CLAUDE_CODE_SESSION_ID; else process.env.CLAUDE_CODE_SESSION_ID = before.sid;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  })();
});
