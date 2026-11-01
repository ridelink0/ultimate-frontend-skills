'use strict';

// Two fixes that share a cause: the plugin reporting a number that was true a
// while ago as though it were true now.
//
//   the effort   read off settings.json, which never moves mid-session
//   the scan     too slow to finish inside a hook's ten seconds, so the hook
//                was killed and a stale cached view was served instead

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const usage = require('../skills/usage-limits/scripts/usage.js');
const view = require('../skills/usage-limits/scripts/view.js');

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const NOW = Date.parse('2026-09-06T12:00:00.000Z');
const SESSION = 'sess-effort';

function line(id, at, over) {
  return JSON.stringify(
    Object.assign(
      {
        type: 'assistant',
        timestamp: new Date(at).toISOString(),
        requestId: 'req_' + id,
        sessionId: SESSION,
        effort: 'xhigh',
        message: {
          id: 'msg_' + id,
          model: 'claude-opus-5',
          usage: {
            input_tokens: 1000,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
            output_tokens: 100,
          },
        },
      },
      over || {}
    )
  );
}

// Awaited, not just called: an earlier version returned the promise and then
// restored the environment in `finally` before the body had run, so the async
// tests below quietly read the real ~/.claude instead of the fixture.
async function withConfigDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-effort-'));
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    return await run(dir);
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Which effort a display reports
// ---------------------------------------------------------------------------

test('the newer of the two live sources wins', () => {
  const line = { effort: 'xhigh', at: NOW - MINUTE };
  const transcript = { effort: 'max', at: NOW };
  assert.strictEqual(view.pickEffort(line, transcript, 'low'), 'max');
  assert.strictEqual(view.pickEffort(transcript, line, 'low'), 'max');
});

test('the setting is a last resort, never a live reading', () => {
  // The bug this guards: a session running at max, with no status line to ask,
  // reported "xhigh" for its whole life because that is what settings.json said.
  assert.strictEqual(view.pickEffort(null, { effort: 'max', at: NOW }, 'xhigh'), 'max');
  assert.strictEqual(view.pickEffort(null, null, 'xhigh'), 'xhigh');
});

test('an absent or default setting reports nothing rather than the word default', () => {
  assert.strictEqual(view.pickEffort(null, null, 'default'), null);
  assert.strictEqual(view.pickEffort(null, null, ''), null);
  assert.strictEqual(view.pickEffort(null, null, '   '), null);
  assert.strictEqual(view.pickEffort(null, null, null), null);
  assert.strictEqual(view.pickEffort(null, null, undefined), null);
});

test('a reading with no timestamp still beats the setting', () => {
  assert.strictEqual(view.pickEffort({ effort: 'high' }, null, 'xhigh'), 'high');
});

test('empty or non-string efforts are ignored', () => {
  assert.strictEqual(view.pickEffort({ effort: '', at: NOW }, null, 'xhigh'), 'xhigh');
  assert.strictEqual(view.pickEffort({ effort: 5, at: NOW }, null, 'xhigh'), 'xhigh');
});

test('liveEffort reads the effort off the transcript, which follows /effort', async () => {
  await withConfigDir((dir) => {
    const project = path.join(dir, 'projects', 'C--proj');
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(
      path.join(project, SESSION + '.jsonl'),
      [
        line('a', NOW - 3 * MINUTE),
        line('b', NOW - 2 * MINUTE, { effort: 'max' }),
      ].join('\n') + '\n'
    );
    const found = usage.liveEffort(SESSION);
    assert.strictEqual(found.effort, 'max', 'the newest line wins, not the first');
    assert.strictEqual(found.at, NOW - 2 * MINUTE);
  });
});

test('liveEffort is quiet about a session it has never seen', async () => {
  await withConfigDir(() => {
    assert.strictEqual(usage.liveEffort('no-such-session'), null);
    assert.strictEqual(usage.liveEffort(null), null);
    assert.strictEqual(usage.liveEffort(''), null);
  });
});

test('a half-written line at the tail does not stop the effort being read', async () => {
  await withConfigDir((dir) => {
    const project = path.join(dir, 'projects', 'C--proj');
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(
      path.join(project, SESSION + '.jsonl'),
      line('a', NOW - MINUTE, { effort: 'high' }) + '\n' + '{"type":"assistant","timest'
    );
    assert.strictEqual(usage.liveEffort(SESSION).effort, 'high');
  });
});

// ---------------------------------------------------------------------------
// What a turn costs at each effort
// ---------------------------------------------------------------------------

function turn(effort, output, cost, over) {
  return Object.assign(
    {
      at: NOW,
      effort,
      cost,
      tokens: output,
      parts: { input: 0, cacheWrite: 0, cacheRead: 0, output, reasoning: Math.round(output / 2) },
    },
    over || {}
  );
}

test('each effort is measured on its own, sorted by what it writes', () => {
  const rates = usage.effortRates([
    turn('low', 100, 1),
    turn('low', 100, 1),
    turn('ultra', 600, 1),
    turn('ultra', 600, 1),
  ]);
  assert.deepStrictEqual(rates.map((row) => row.effort), ['low', 'ultra']);
  assert.strictEqual(rates[0].outputPerTurn, 100);
  assert.strictEqual(rates[1].outputPerTurn, 600);
  assert.strictEqual(rates[1].reasoningPerTurn, 300);
});

test('subagent calls and refusals are not turns and do not dilute the rate', () => {
  const rates = usage.effortRates([
    turn('ultra', 600, 1),
    turn('ultra', 0, 0, { sidechain: true }),
    turn('ultra', 0, 0, { rejected: { status: 'rejected' } }),
    turn(null, 999, 9),
  ]);
  assert.strictEqual(rates.length, 1);
  assert.strictEqual(rates[0].turns, 1);
  assert.strictEqual(rates[0].outputPerTurn, 600);
});

test('the warning prices the window at the effort actually set', () => {
  // Six low turns and six ultra turns. The blended figure says 99 turns left;
  // at ultra it is a fraction of that, and that gap is the whole bug: a Plus
  // account emptied a five-hour window on one task while being told it had room.
  const events = [];
  for (let i = 0; i < 6; i += 1) events.push(turn('low', 100, 0.01));
  for (let i = 0; i < 6; i += 1) events.push(turn('ultra', 600, 0.10));
  const window = { label: '5-hour', stale: false, percentLeft: 80, usdPerPercent: 0.05, turnsLeft: 99 };

  const warning = usage.effortWarning(events, 'ultra', window);
  assert.ok(warning, 'ultra against a mostly-low history must warn');
  assert.strictEqual(warning.effort, 'ultra');
  // 80 points left x $0.05 a point = $4.00, at $0.10 a turn = 40 turns.
  assert.strictEqual(warning.turnsLeft, 40);
  assert.strictEqual(warning.blendedTurnsLeft, 99);
  assert.strictEqual(warning.cheaper.effort, 'low');
  assert.ok(Math.abs(warning.cheaper.multiple - 6) < 1e-9, 'ultra writes 6x the output of low');
});

test('the comparison is on output, not on cost, so a big context cannot invert it', () => {
  // Real data from a Codex account had "low" costing more per turn than
  // "ultra", purely because those low turns carried a huge context. Comparing
  // on cost would have named ultra the cheap one.
  const events = [];
  for (let i = 0; i < 4; i += 1) events.push(turn('low', 100, 5));
  for (let i = 0; i < 4; i += 1) events.push(turn('ultra', 600, 1));
  const rates = usage.effortRates(events);
  assert.deepStrictEqual(rates.map((row) => row.effort), ['low', 'ultra'], 'ordered by output written');
  const warning = usage.effortWarning(events, 'ultra', {
    stale: false,
    percentLeft: 50,
    usdPerPercent: 1,
    turnsLeft: 50,
  });
  assert.strictEqual(warning.cheaper.effort, 'low');
});

test('nothing is said without enough turns at that effort to mean anything', () => {
  const events = [turn('ultra', 600, 1), turn('low', 100, 0.01), turn('low', 100, 0.01), turn('low', 100, 0.01)];
  const window = { stale: false, percentLeft: 80, usdPerPercent: 1, turnsLeft: 99 };
  assert.strictEqual(usage.effortWarning(events, 'ultra', window), null, 'one ultra turn is not a measurement');
});

test('nothing is said about a rolled-over window or an unknown effort', () => {
  const events = [];
  for (let i = 0; i < 6; i += 1) events.push(turn('ultra', 600, 0.1));
  for (let i = 0; i < 6; i += 1) events.push(turn('low', 100, 0.01));
  assert.strictEqual(usage.effortWarning(events, 'ultra', { stale: true, percentLeft: 80 }), null);
  assert.strictEqual(usage.effortWarning(events, 'nosuch', { stale: false, percentLeft: 80 }), null);
  assert.strictEqual(usage.effortWarning(events, null, { stale: false, percentLeft: 80 }), null);
  assert.strictEqual(usage.effortWarning(events, 'ultra', null), null);
});

// ---------------------------------------------------------------------------
// The scan cache
// ---------------------------------------------------------------------------

test('the scan offset is counted in bytes, so multi-byte characters cannot drift it', () => {
  // The bug this guards is silent: counting characters instead of bytes leaves
  // the offset short by one per non-ASCII character, and the next incremental
  // read then re-parses a fragment and drops the turn it belonged to.
  const first = line('a', NOW - MINUTE);
  const second = line('b', NOW - MINUTE, { message: { id: 'msg_b', model: 'claude-opus-5 — dash “quotes” ✻', usage: { input_tokens: 1, output_tokens: 1 } } });
  const text = first + '\n' + second + '\n';
  const buffer = Buffer.from(text, 'utf8');
  assert.ok(buffer.length > text.length, 'the fixture must actually contain multi-byte characters');

  const parsed = usage.parseSlice(buffer, 'proj', 0);
  assert.strictEqual(parsed.offset, buffer.length, 'the offset is a byte count, not a character count');
});

test('a trailing partial line is left for the next read rather than half-parsed', () => {
  const whole = line('a', NOW - MINUTE);
  const buffer = Buffer.from(whole + '\n' + '{"type":"assist', 'utf8');
  const parsed = usage.parseSlice(buffer, 'proj', 0);
  assert.strictEqual(parsed.events.length, 1);
  assert.strictEqual(parsed.offset, Buffer.byteLength(whole + '\n', 'utf8'));
});

test('a second scan reuses the cache and returns exactly what the first did', async () => {
  await withConfigDir(async (dir) => {
    const project = path.join(dir, 'projects', 'C--proj');
    fs.mkdirSync(project, { recursive: true });
    const file = path.join(project, SESSION + '.jsonl');
    fs.writeFileSync(file, [line('a', NOW - 3 * MINUTE), line('b', NOW - 2 * MINUTE)].join('\n') + '\n');

    const cold = await usage.readClaudeEvents(NOW - HOUR);
    const warm = await usage.readClaudeEvents(NOW - HOUR);
    assert.strictEqual(cold.length, 2);
    assert.deepStrictEqual(warm, cold, 'the cached path must round-trip every field');
    assert.ok(fs.existsSync(usage.scanFile()), 'the cache is written beside the other state');

    // Appending is read from the offset, and the earlier turns still come back.
    fs.appendFileSync(file, line('c', NOW - MINUTE) + '\n');
    const grown = await usage.readClaudeEvents(NOW - HOUR);
    assert.strictEqual(grown.length, 3);
    assert.deepStrictEqual(grown.slice(0, 2), cold);
  });
});

test('a turn repeated in a resumed session is counted once across files', async () => {
  await withConfigDir(async (dir) => {
    const project = path.join(dir, 'projects', 'C--proj');
    fs.mkdirSync(project, { recursive: true });
    // The same message id and request id in two transcripts: one call, not two.
    fs.writeFileSync(path.join(project, 'one.jsonl'), line('dup', NOW - 2 * MINUTE) + '\n');
    fs.writeFileSync(path.join(project, 'two.jsonl'), line('dup', NOW - 2 * MINUTE) + '\n');
    const events = await usage.readClaudeEvents(NOW - HOUR);
    assert.strictEqual(events.length, 1, 'deduplication must survive the cache');
  });
});

test('a rewritten file is re-read from the start rather than trusted at its old offset', async () => {
  await withConfigDir(async (dir) => {
    const project = path.join(dir, 'projects', 'C--proj');
    fs.mkdirSync(project, { recursive: true });
    const file = path.join(project, SESSION + '.jsonl');
    fs.writeFileSync(file, [line('a', NOW - 3 * MINUTE), line('b', NOW - 2 * MINUTE)].join('\n') + '\n');
    assert.strictEqual((await usage.readClaudeEvents(NOW - HOUR)).length, 2);

    // Truncated to something shorter: the offset can no longer be trusted.
    fs.writeFileSync(file, line('z', NOW - MINUTE) + '\n');
    const events = await usage.readClaudeEvents(NOW - HOUR);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].dedupId, 'msg_z|req_z');
  });
});

test('a scan that runs out of its budget says so instead of reporting a short total', async () => {
  await withConfigDir(async (dir) => {
    const project = path.join(dir, 'projects', 'C--proj');
    fs.mkdirSync(project, { recursive: true });
    for (let i = 0; i < 8; i += 1) {
      fs.writeFileSync(path.join(project, 'sess-' + i + '.jsonl'), line('e' + i, NOW - MINUTE) + '\n');
    }
    // A budget of zero milliseconds is spent before the first file.
    const events = await usage.readClaudeEvents(NOW - HOUR, { budgetMs: 0 });
    assert.strictEqual(events.partial, true, 'the caller must be able to tell it is a floor');
    // And with no budget the same scan is complete and says nothing.
    const full = await usage.readClaudeEvents(NOW - HOUR);
    assert.strictEqual(full.length, 8);
    assert.strictEqual(full.partial, undefined);
  });
});
