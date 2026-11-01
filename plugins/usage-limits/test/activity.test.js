'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const activity = require('../skills/usage-limits/scripts/activity.js');
const tempdirs = require('../tools/test-tempdirs.js');

const MINUTE = 60 * 1000;
const NOW = Date.parse('2026-09-05T12:00:00.000Z');

function withConfigDir(fn) {
  const dir = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-activity-'));
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
  }
}

test('mark records a state per session and read gives it back', () =>
  withConfigDir(() => {
    assert.deepStrictEqual(activity.read(), {});
    assert.strictEqual(activity.mark('working', 'a', { ultracode: true }, NOW), true);
    assert.strictEqual(activity.mark('working', 'b', null, NOW + 1000), true);
    const all = activity.read();
    assert.strictEqual(all.a.state, 'working');
    assert.strictEqual(all.a.ultracode, true);
    assert.strictEqual(all.a.at, NOW);
    assert.strictEqual(all.b.ultracode, false);
  }));

test('summarise says whether anything is working and whether it is ultracode', () =>
  withConfigDir(() => {
    activity.mark('working', 'a', { ultracode: true }, NOW);
    let seen = activity.summarise(activity.read(), NOW + 5000);
    assert.strictEqual(seen.working, true);
    assert.strictEqual(seen.ultracode, true);

    // Stop in one session does not make another look idle.
    activity.mark('working', 'b', null, NOW + 6000);
    activity.mark('idle', 'a', null, NOW + 7000);
    seen = activity.summarise(activity.read(), NOW + 8000);
    assert.strictEqual(seen.working, true);
    assert.strictEqual(seen.ultracode, false, 'the working session is b, which is not ultracode');

    activity.mark('idle', 'b', null, NOW + 9000);
    seen = activity.summarise(activity.read(), NOW + 10000);
    assert.strictEqual(seen.working, false);

    // A mark with no session id is nobody: it must not make the machine look busy.
    activity.mark('working', null, null, NOW + 11000);
    assert.strictEqual(activity.summarise(activity.read(), NOW + 12000).working, false);
  }));

test('a session that went quiet is not working, whatever it last said', () =>
  withConfigDir(() => {
    activity.mark('working', 'a', null, NOW);
    assert.strictEqual(activity.summarise(activity.read(), NOW + activity.STALE_MS - 1).working, true);
    assert.strictEqual(activity.summarise(activity.read(), NOW + activity.STALE_MS + 1).working, false);
  }));

test('idle keeps the ultracode flag the prompt set, so the next prompt decides', () =>
  withConfigDir(() => {
    activity.mark('working', 'a', { ultracode: true }, NOW);
    activity.mark('idle', 'a', null, NOW + 1000);
    assert.strictEqual(activity.read().a.ultracode, true);
    activity.mark('working', 'a', { ultracode: false }, NOW + 2000);
    assert.strictEqual(activity.read().a.ultracode, false);
  }));

test('the file keeps the newest few sessions only', () =>
  withConfigDir(() => {
    for (let index = 0; index < 12; index += 1) activity.mark('idle', 's' + index, null, NOW + index * MINUTE);
    const all = activity.read();
    assert.strictEqual(Object.keys(all).length, activity.KEEP_SESSIONS);
    assert.ok(all.s11);
    assert.ok(!all.s0);
  }));

test('a corrupt file is an empty one', () =>
  withConfigDir(() => {
    fs.writeFileSync(activity.activityFile(), '{nope');
    assert.deepStrictEqual(activity.read(), {});
    assert.strictEqual(activity.mark('working', 'a', null, NOW), true);
    assert.ok(activity.read().a);
  }));

test('mark never throws, even where it cannot write', () => {
  const before = process.env.CLAUDE_CONFIG_DIR;
  // A file where the directory should be: nothing can be created under it.
  const blocker = path.join(tempdirs.make(path.join(os.tmpdir(), 'usage-limits-activity-')), 'blocker');
  fs.writeFileSync(blocker, 'x');
  process.env.CLAUDE_CONFIG_DIR = path.join(blocker, 'sub');
  try {
    assert.strictEqual(activity.mark('working', 'a', null, NOW), false);
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
  }
});

test('combine lists every Claude heard from lately, and says which are working', () => {
  const list = activity.combine(
    {
      marks: {
        a: { at: NOW - 1000, state: 'working', ultracode: true },
        b: { at: NOW - 3 * MINUTE, state: 'idle' },
        old: { at: NOW - 40 * MINUTE, state: 'working' },
        _: { at: NOW, state: 'working' },
      },
      feed: {
        a: { at: NOW - 2000, model: 'claude-fable-5-1', modelName: 'Fable 5.1', effort: 'xhigh', cwd: 'C:\work\app' },
        c: { at: NOW - 5 * MINUTE, model: 'claude-opus-5' },
      },
      tally: [
        { sessionId: 'b', project: 'C--work-site', lastAt: NOW - 2 * MINUTE, cost: 1.5, turns: 4 },
        { sessionId: 'old', project: 'C--old', lastAt: NOW - 40 * MINUTE },
      ],
      brief: { c: { at: NOW - 4 * MINUTE }, d: { at: NOW - 10 * MINUTE } },
    },
    NOW,
    15 * MINUTE
  );
  assert.deepStrictEqual(list.map((row) => row.sessionId), ['a', 'b', 'c', 'd']);
  assert.strictEqual(list[0].state, 'working');
  assert.strictEqual(list[0].ultracode, true);
  assert.strictEqual(list[0].modelName, 'Fable 5.1');
  assert.strictEqual(list[0].cwd, 'C:\work\app');
  assert.strictEqual(list[1].state, 'idle');
  assert.strictEqual(list[1].project, 'C--work-site');
  assert.strictEqual(list[1].cost, 1.5);
  assert.strictEqual(list[1].lastAt, NOW - 2 * MINUTE, 'the newest sighting wins');
  assert.strictEqual(list[2].model, 'claude-opus-5');
  assert.strictEqual(list[2].state, 'idle', 'no mark means idle');
  assert.strictEqual(list[3].model, null);
  // A working mark that has gone stale is not working, and the placeholder slot is nobody.
  assert.strictEqual(activity.combine({ marks: { z: { at: NOW - 20 * MINUTE, state: 'working' } }, brief: { z: { at: NOW } } }, NOW, 15 * MINUTE)[0].state, 'idle');
  assert.deepStrictEqual(activity.combine({}, NOW, 15 * MINUTE), []);
  assert.deepStrictEqual(activity.combine(null, NOW, 15 * MINUTE), []);
});
