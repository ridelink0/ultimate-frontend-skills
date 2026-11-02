'use strict';

// Subagent transcripts live under <project>/<session>/subagents/ and spend
// the same budget as the session that spawned them. They count toward cost
// and calibration; they do not count as turns, because a turn is one
// main-thread call and that is the unit the headroom is planned in.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const usage = require('../skills/usage-limits/scripts/usage.js');
const tempdirs = require('../tools/test-tempdirs.js');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-09-01T10:00:00.000Z');
const SESSION = 'sess-sub';

// One Opus call: (1000 * 5 + 100 * 25) / 1e6 dollars.
const CALL = 0.0075;

function line(id, at, over) {
  return JSON.stringify(
    Object.assign(
      {
        type: 'assistant',
        timestamp: new Date(at).toISOString(),
        requestId: 'req_' + id,
        sessionId: SESSION,
        message: {
          id: 'msg_' + id,
          model: 'claude-opus-5',
          usage: { input_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 100 },
        },
      },
      over || {}
    )
  );
}

function event(over) {
  return Object.assign({ at: NOW - 10 * MINUTE, cost: 1, tokens: 100, model: 'claude-opus-5', sidechain: false }, over || {});
}

test('eventFrom leaves out a synthetic message, which is not an API call', () => {
  const synthetic = line('syn', NOW, {
    message: { id: 'msg_syn', model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 } },
  });
  assert.strictEqual(usage.eventFrom(synthetic, new Set(), 'proj'), null);
});

// Subagent calls are not turns - counting each as one makes a turn look cheap.
// But their spend comes out of the same window, so the turn that dispatched
// them costs what they cost. Counting the calls and counting the money are
// different questions and this is where they were conflated: a session that
// fanned out was promised four hundred turns and got sixty.
test('a turn is priced with the subagent spend it caused, but subagents are not turns', () => {
  const sample = [];
  for (let i = 0; i < 5; i += 1) sample.push(event({ cost: 1 }));
  for (let i = 0; i < 20; i += 1) sample.push(event({ cost: 0.01, sidechain: true }));
  // $5 of main thread, 20 cents of agents: a turn really costs $1.04.
  assert.ok(Math.abs(usage.typicalTurnCost(sample, sample, sample, 5) - 1.04) < 1e-9);
  const spread = usage.costPercentiles(sample);
  assert.strictEqual(spread.sample, 5, 'still five turns, not twenty five');
  assert.strictEqual(spread.median, 1);
});

test('a heavy fan-out prices the turn that caused it', () => {
  const sample = [];
  for (let i = 0; i < 5; i += 1) sample.push(event({ cost: 1 }));
  for (let i = 0; i < 3; i += 1) sample.push(event({ cost: 3, sidechain: true }));
  // $5 visible, $14 spent: turns cost 2.8x what the main thread shows.
  assert.ok(Math.abs(usage.typicalTurnCost(sample, sample, sample, 5) - 2.8) < 1e-9);
});

test('one enormous fan-out does not price every future turn as another one', () => {
  const sample = [];
  for (let i = 0; i < 5; i += 1) sample.push(event({ cost: 1 }));
  sample.push(event({ cost: 500, sidechain: true }));
  // Unclamped this would be 101x. Five is the ceiling.
  assert.strictEqual(usage.typicalTurnCost(sample, sample, sample, 5), 5);
});

test('with no subagents at all the price is unchanged', () => {
  const sample = [];
  for (let i = 0; i < 5; i += 1) sample.push(event({ cost: 1 }));
  assert.strictEqual(usage.typicalTurnCost(sample, sample, sample, 5), 1);
});

test('buildWindow counts subagent spend in the money and leaves it out of the turns', () => {
  const spec = { key: 'five_hour', label: '5-hour', span: 5 * HOUR };
  const snapshot = { utilization: 10, resets_at: new Date(NOW + HOUR).toISOString() };
  const sample = [];
  for (let i = 0; i < 5; i += 1) sample.push(event({ at: NOW - 30 * MINUTE, cost: 1 }));
  for (let i = 0; i < 4; i += 1) sample.push(event({ at: NOW - 30 * MINUTE, cost: 0.25, sidechain: true }));
  const window = usage.buildWindow(spec, snapshot, sample, NOW);
  assert.strictEqual(window.turns, 5);
  assert.strictEqual(window.subagentTurns, 4);
  assert.ok(Math.abs(window.spentUSD - 6) < 1e-9, 'five dollars of turns plus a dollar of subagents');
  assert.ok(Math.abs(window.usdPerPercent - 0.6) < 1e-9, 'and the point is priced from all of it');
});

test('sessionSpend counts main-thread turns and all of the money', () => {
  const events = [
    { sessionId: 'a', cost: 1, tokens: 10, sidechain: false },
    { sessionId: 'a', cost: 0.5, tokens: 5, sidechain: true },
    { sessionId: 'b', cost: 9, tokens: 9, sidechain: false },
  ];
  assert.deepStrictEqual(usage.sessionSpend(events, 'a'), { turns: 1, cost: 1.5, tokens: 15 });
});

test('the report reads subagent transcripts and says how many calls they made', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-sub-'));
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  usage.setHost('claude');
  try {
    fs.writeFileSync(
      path.join(dir, '.claude.json'),
      JSON.stringify({
        oauthAccount: { organizationType: 'claude_max', userRateLimitTier: 'default_claude_max_5x' },
        cachedUsageUtilization: {
          fetchedAtMs: NOW - MINUTE,
          utilization: {
            five_hour: { utilization: 10, resets_at: new Date(NOW + 4 * HOUR).toISOString() },
            seven_day: { utilization: 5, resets_at: new Date(NOW + 6 * DAY).toISOString() },
          },
        },
      })
    );
    const project = path.join(dir, 'projects', 'C--proj');
    fs.mkdirSync(path.join(project, SESSION, 'subagents'), { recursive: true });
    const main = [];
    for (let i = 0; i < 6; i += 1) main.push(line('m' + i, NOW - (30 - i) * MINUTE));
    main.push(line('syn', NOW - 2 * MINUTE, { message: { id: 'msg_syn', model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 } } }));
    fs.writeFileSync(path.join(project, SESSION + '.jsonl'), main.join('\n') + '\n');
    const sub = [];
    for (let i = 0; i < 3; i += 1) sub.push(line('s' + i, NOW - (20 - i) * MINUTE, { isSidechain: true, agentId: 'abc' }));
    fs.writeFileSync(path.join(project, SESSION, 'subagents', 'agent-abc.jsonl'), sub.join('\n') + '\n');

    const data = await usage.report(NOW, { sessionId: SESSION });
    assert.strictEqual(data.measuredTurns, 6, 'six main calls; the synthetic line is not one');
    assert.strictEqual(data.subagentTurns, 3);
    const five = data.windows.find((w) => w.key === 'five_hour');
    assert.strictEqual(five.turns, 6);
    assert.ok(Math.abs(five.spentUSD - 9 * CALL) < 1e-9, 'nine calls of spend inside the window');
    assert.deepStrictEqual(data.session, { turns: 6, cost: 9 * CALL, tokens: 9 * 1100 });

    const text = usage.render(data);
    assert.match(text, /Measured\s+6 turns of local transcript [(][+]3 subagent calls[)]/);
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readClaudeEvents finds the agents a Workflow runs, two directories down', async () => {
  const dir = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-workflows-'));
  const project = path.join(dir, 'projects', 'C--proj');
  fs.mkdirSync(path.join(project, SESSION, 'subagents', 'workflows', 'wf_1'), { recursive: true });
  fs.writeFileSync(path.join(project, SESSION + '.jsonl'), line('main', NOW - MINUTE) + '\n');
  fs.writeFileSync(path.join(project, SESSION, 'subagents', 'agent-a.jsonl'), line('sub', NOW - MINUTE, { isSidechain: true }) + '\n');
  fs.writeFileSync(
    path.join(project, SESSION, 'subagents', 'workflows', 'wf_1', 'agent-b.jsonl'),
    line('wf', NOW - MINUTE, { isSidechain: true }) + '\n'
  );
  fs.writeFileSync(path.join(project, SESSION, 'subagents', 'workflows', 'wf_1', 'agent-b.meta.json'), '{}');
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    const events = await usage.readClaudeEvents(NOW - HOUR);
    assert.strictEqual(events.length, 3, 'main, plain subagent and workflow agent');
    assert.strictEqual(events.filter((event) => event.sidechain).length, 2);
    assert.strictEqual(usage.subagentTranscripts(path.join(project, SESSION, 'subagents'), 0).length, 2);
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
  }
});

// One Fable 5.1 call at 1000 in / 100 out: (1000 * 10 + 100 * 50) / 1e6.
const FABLE_CALL = 0.015;
// The same call on Sonnet 5: (1000 * 2 + 100 * 10) / 1e6.
const SONNET_CALL = 0.003;

// A Sonnet research agent under a Fable session spends Sonnet money. Its
// transcript names claude-sonnet-5 on every assistant record, and that is the
// rate its tokens are priced at - never the session's. A record that names no
// model at all is the one case priced at the session's model, read from the
// parent transcript.
test('a subagent transcript is priced at the model it names, and a nameless one at the session model', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-submodel-'));
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  usage.setHost('claude');
  try {
    fs.writeFileSync(
      path.join(dir, '.claude.json'),
      JSON.stringify({
        oauthAccount: { organizationType: 'claude_max', userRateLimitTier: 'default_claude_max_5x' },
        cachedUsageUtilization: {
          fetchedAtMs: NOW - MINUTE,
          utilization: {
            five_hour: { utilization: 10, resets_at: new Date(NOW + 4 * HOUR).toISOString() },
            seven_day: { utilization: 5, resets_at: new Date(NOW + 6 * DAY).toISOString() },
          },
        },
      })
    );
    const project = path.join(dir, 'projects', 'C--proj');
    fs.mkdirSync(path.join(project, SESSION, 'subagents'), { recursive: true });
    const fable = (id, at, over) =>
      line(id, at, Object.assign({
        message: {
          id: 'msg_' + id,
          model: 'claude-fable-5-1',
          usage: { input_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 100 },
        },
      }, over || {}));
    const main = [];
    for (let i = 0; i < 6; i += 1) main.push(fable('m' + i, NOW - (30 - i) * MINUTE));
    fs.writeFileSync(path.join(project, SESSION + '.jsonl'), main.join('\n') + '\n');

    const sonnet = [];
    for (let i = 0; i < 3; i += 1) {
      sonnet.push(
        line('s' + i, NOW - (20 - i) * MINUTE, {
          isSidechain: true,
          agentId: 'abc',
          message: {
            id: 'msg_s' + i,
            model: 'claude-sonnet-5',
            usage: { input_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 100 },
          },
        })
      );
    }
    fs.writeFileSync(path.join(project, SESSION, 'subagents', 'agent-abc.jsonl'), sonnet.join('\n') + '\n');
    // A record with no model field at all, in a second agent.
    const nameless = line('n1', NOW - 10 * MINUTE, {
      isSidechain: true,
      agentId: 'def',
      message: {
        id: 'msg_n1',
        usage: { input_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 100 },
      },
    });
    fs.writeFileSync(path.join(project, SESSION, 'subagents', 'agent-def.jsonl'), nameless + '\n');

    const data = await usage.report(NOW, { sessionId: SESSION });
    const five = data.windows.find((w) => w.key === 'five_hour');
    const expected = 6 * FABLE_CALL + 3 * SONNET_CALL + FABLE_CALL;
    assert.ok(
      Math.abs(five.spentUSD - expected) < 1e-9,
      'six Fable turns, three Sonnet calls at Sonnet rates, one nameless call at the session rate: got ' + five.spentUSD
    );
    assert.ok(Math.abs(five.spentUSD - 10 * FABLE_CALL) > 1e-6, 'and not everything at the session rate');
    assert.ok(Math.abs(data.session.cost - expected) < 1e-9);
    const sonnetRow = data.models.find((row) => row.model === 'claude-sonnet-5');
    assert.ok(sonnetRow, 'the Sonnet spend is attributed to Sonnet');
    assert.ok(Math.abs(sonnetRow.cost - 3 * SONNET_CALL) < 1e-9);
    const fableRow = data.models.find((row) => row.model === 'claude-fable-5-1');
    assert.strictEqual(fableRow.turns, 7, 'the nameless call is counted as the session model');
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('eventFrom prices a nameless record at the fallback, and asks for it only then', () => {
  const named = line('a', NOW, { isSidechain: true });
  let asked = 0;
  const fallback = () => {
    asked += 1;
    return 'claude-sonnet-5';
  };
  const event = usage.eventFrom(named, new Set(), 'proj', fallback);
  assert.strictEqual(event.model, 'claude-opus-5', 'a named record keeps its own model');
  assert.strictEqual(asked, 0, 'and the parent transcript is not read for it');

  const nameless = line('b', NOW, {
    isSidechain: true,
    message: { id: 'msg_b', usage: { input_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 100 } },
  });
  const assumed = usage.eventFrom(nameless, new Set(), 'proj', fallback);
  assert.strictEqual(assumed.model, 'claude-sonnet-5');
  assert.ok(Math.abs(assumed.cost - SONNET_CALL) < 1e-12);
  assert.strictEqual(asked, 1);
  // With nothing to fall back to, the record is priced as an unknown model, as before.
  const unknown = usage.eventFrom(nameless, new Set(), 'proj', null);
  assert.strictEqual(unknown.model, '');
});
