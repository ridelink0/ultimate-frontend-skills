'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tally = require('../skills/usage-limits/scripts/tally.js');

const MINUTE = 60 * 1000;
const NOW = Date.parse('2026-09-01T10:00:00.000Z');
const SESSION = 'sess-1';

// A transcript line for one assistant turn, priced at Opus rates.
function turn(id, at, over) {
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
          usage: {
            input_tokens: 100,
            cache_read_input_tokens: 1000,
            cache_creation_input_tokens: 0,
            output_tokens: 200,
          },
        },
      },
      over || {}
    )
  );
}

function prompt(text, at) {
  return JSON.stringify({
    type: 'user',
    timestamp: new Date(at).toISOString(),
    sessionId: SESSION,
    message: { role: 'user', content: text },
  });
}

function toolResult(at) {
  return JSON.stringify({
    type: 'user',
    timestamp: new Date(at).toISOString(),
    sessionId: SESSION,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] },
  });
}

// Every test gets its own config directory so the state file never touches
// the real one, and a transcript laid out the way Claude Code lays them out.
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-tally-'));
  const project = path.join(dir, 'projects', 'C--proj');
  fs.mkdirSync(project, { recursive: true });
  const transcript = path.join(project, SESSION + '.jsonl');
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  return {
    dir,
    project,
    transcript,
    subagentDir: path.join(project, SESSION, 'subagents'),
    restore() {
      if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('readNewLines hands back only complete lines and where to resume', () => {
  const box = sandbox();
  try {
    fs.writeFileSync(box.transcript, 'one\ntwo\nthr');
    const first = tally.readNewLines(box.transcript, 0);
    assert.deepStrictEqual(first.lines, ['one', 'two']);
    assert.strictEqual(first.next, 'one\ntwo\n'.length, 'stop at the last newline, not the end');

    fs.appendFileSync(box.transcript, 'ee\n');
    const second = tally.readNewLines(box.transcript, first.next);
    assert.deepStrictEqual(second.lines, ['three']);
  } finally {
    box.restore();
  }
});

test('readNewLines starts over when the file is shorter than the cursor', () => {
  const box = sandbox();
  try {
    fs.writeFileSync(box.transcript, 'a\n');
    const read = tally.readNewLines(box.transcript, 500);
    assert.deepStrictEqual(read.lines, ['a']);
    assert.strictEqual(read.reset, true);
  } finally {
    box.restore();
  }
});

test('readNewLines copes with a file that is not there', () => {
  const read = tally.readNewLines(path.join(os.tmpdir(), 'no-such-file.jsonl'), 0);
  assert.deepStrictEqual(read.lines, []);
  assert.strictEqual(read.next, 0);
});

test('update totals a session once and reports only what is new the next time', () => {
  const box = sandbox();
  try {
    fs.writeFileSync(
      box.transcript,
      [prompt('build it', NOW), turn(1, NOW + MINUTE), turn(2, NOW + 2 * MINUTE), toolResult(NOW + 2 * MINUTE)].join('\n') + '\n'
    );
    const all = {};
    const first = tally.update(all, SESSION, box.transcript, NOW + 3 * MINUTE, { cwd: 'C:/proj' });
    assert.strictEqual(first.session.turns, 2);
    assert.strictEqual(first.session.prompts, 1, 'a tool result is not a prompt');
    assert.strictEqual(first.session.tokens.cacheRead, 2000);
    assert.strictEqual(first.session.tokens.output, 400);
    assert.ok(first.session.cost > 0);
    assert.strictEqual(first.delta.turns, 2);
    assert.strictEqual(first.session.project, 'C--proj');
    assert.strictEqual(first.session.firstAt, NOW + MINUTE);
    assert.strictEqual(first.session.lastAt, NOW + 2 * MINUTE);
    assert.strictEqual(first.created, true);
    assert.strictEqual(first.session.lastReply, null, 'history read on first sight is not a reply');

    const again = tally.update(all, SESSION, box.transcript, NOW + 4 * MINUTE, {});
    assert.strictEqual(again.session.turns, 2, 'nothing new means nothing added');
    assert.strictEqual(again.delta.turns, 0);
    assert.strictEqual(again.delta.tokens, 0);
    assert.strictEqual(again.created, false);

    fs.appendFileSync(box.transcript, turn(3, NOW + 5 * MINUTE) + '\n');
    const third = tally.update(all, SESSION, box.transcript, NOW + 6 * MINUTE, {});
    assert.strictEqual(third.session.turns, 3);
    assert.strictEqual(third.delta.turns, 1);
    assert.strictEqual(third.delta.tokens, 1300);
    assert.deepStrictEqual(third.session.lastReply, { turns: 1, subagentTurns: 0, tokens: 1300, cost: third.delta.cost });
  } finally {
    box.restore();
  }
});

test('update counts subagent transcripts as this session, apart from the turns', () => {
  const box = sandbox();
  try {
    fs.writeFileSync(box.transcript, turn(1, NOW) + '\n');
    fs.mkdirSync(box.subagentDir, { recursive: true });
    fs.writeFileSync(
      path.join(box.subagentDir, 'agent-abc.jsonl'),
      [
        prompt('explore', NOW),
        turn('a1', NOW + MINUTE, { isSidechain: true, agentId: 'abc' }),
        turn('a2', NOW + 2 * MINUTE, { isSidechain: true, agentId: 'abc' }),
      ].join('\n') + '\n'
    );
    const all = {};
    const result = tally.update(all, SESSION, box.transcript, NOW + 3 * MINUTE, {});
    assert.strictEqual(result.session.turns, 1, 'a turn is a main-thread call');
    assert.strictEqual(result.session.subagentTurns, 2);
    assert.strictEqual(result.session.prompts, 0, 'the agent brief is not a prompt the user typed');
    assert.strictEqual(result.session.tokens.output, 600, 'but the tokens are all spent by this session');
    assert.strictEqual(result.delta.subagentTurns, 2);

    // The subagent keeps working; only its new turns count next time.
    fs.appendFileSync(
      path.join(box.subagentDir, 'agent-abc.jsonl'),
      turn('a3', NOW + 4 * MINUTE, { isSidechain: true, agentId: 'abc' }) + '\n'
    );
    const next = tally.update(all, SESSION, box.transcript, NOW + 5 * MINUTE, {});
    assert.strictEqual(next.delta.subagentTurns, 1);
    assert.strictEqual(next.session.subagentTurns, 3);
  } finally {
    box.restore();
  }
});

test('update does not count a turn twice when a fork replays it', () => {
  const box = sandbox();
  try {
    fs.writeFileSync(box.transcript, turn(1, NOW) + '\n' + turn(2, NOW + MINUTE) + '\n');
    const all = {};
    tally.update(all, SESSION, box.transcript, NOW + MINUTE, {});

    // A forked session copies the history into a new file under a new id.
    const fork = path.join(box.project, 'sess-2.jsonl');
    fs.writeFileSync(fork, turn(1, NOW) + '\n' + turn(2, NOW + MINUTE) + '\n' + turn(3, NOW + 2 * MINUTE) + '\n');
    const forked = tally.update(all, 'sess-2', fork, NOW + 3 * MINUTE, {});
    assert.strictEqual(forked.session.turns, 1, 'only the turn the fork actually made');
    assert.strictEqual(all[SESSION].turns, 2, 'and the original keeps its own');
  } finally {
    box.restore();
  }
});

test('update remembers the latest context size and the model mix', () => {
  const box = sandbox();
  try {
    fs.writeFileSync(
      box.transcript,
      turn(1, NOW) + '\n' +
        turn(2, NOW + MINUTE, {
          message: {
            id: 'msg_2',
            model: 'claude-sonnet-5',
            usage: {
              input_tokens: 50,
              cache_read_input_tokens: 90000,
              cache_creation_input_tokens: 5000,
              output_tokens: 10,
            },
          },
        }) + '\n'
    );
    const { session } = tally.update({}, SESSION, box.transcript, NOW + 2 * MINUTE, {});
    assert.strictEqual(session.context, 95050, 'input plus cache read plus cache write of the last turn');
    assert.strictEqual(session.models['claude-opus-5'].turns, 1);
    assert.strictEqual(session.models['claude-sonnet-5'].turns, 1);
  } finally {
    box.restore();
  }
});

test('trim keeps the newest sessions by last activity', () => {
  const many = {};
  for (let index = 0; index < 60; index += 1) many['s' + index] = { lastAt: NOW - index * MINUTE };
  const kept = tally.trim(many);
  assert.strictEqual(Object.keys(kept).length, tally.KEEP_SESSIONS);
  assert.ok(kept.s0);
  assert.ok(!kept.s59);
});

function sample(over) {
  return Object.assign(
    {
      prompts: 9,
      turns: 48,
      subagentTurns: 0,
      tokens: { input: 5000, cacheWrite: 120000, cacheRead: 2900000, output: 61000, reasoning: 30000 },
      cost: 12.4,
      context: 130000,
      firstAt: NOW - 102 * MINUTE,
      lastAt: NOW,
    },
    over || {}
  );
}

test('formatTally leads with what this reply cost, then the session, tokens first', () => {
  const text = tally.formatTally(sample(), { turns: 6, subagentTurns: 0, tokens: 210000, cost: 0.95 }, {
    usdPerPercent: 0.4,
    label: '5-hour',
  });
  assert.match(text, /^\[usage-limits\] this reply: 6 turns, 210k tokens, \$0\.95\./);
  assert.match(text, /This session: 9 prompts, 48 turns, 3\.1M tokens \(2\.9M cache read, 61k output\), about \$12\.40/);
  assert.match(text, /roughly 31 points of the 5-hour window/);
  assert.match(text, /Context is now about 130k tokens\./);
  assert.ok(text.indexOf('\n') === -1, 'one line');
});

test('formatTally leaves out what it does not know', () => {
  const text = tally.formatTally(sample({ context: null }), { turns: 0, subagentTurns: 0, tokens: 0, cost: 0 }, {});
  assert.doesNotMatch(text, /this reply/);
  assert.match(text, /^\[usage-limits\] This session:/);
  assert.doesNotMatch(text, /points of/);
  assert.doesNotMatch(text, /Context/);
});

test('formatTally names subagent turns separately', () => {
  const text = tally.formatTally(sample({ subagentTurns: 100 }), { turns: 2, subagentTurns: 40, tokens: 500000, cost: 2 }, {});
  assert.match(text, /this reply: 2 turns \(\+40 subagent\)/);
  assert.match(text, /48 turns \(\+100 subagent\)/);
});

test('formatClosed says how long the session ran and what it cost', () => {
  const text = tally.formatClosed(sample(), NOW);
  assert.match(text, /^\[usage-limits\] session closed after 1h 42m: 9 prompts, 48 turns, 3\.1M tokens, about \$12\.40\.$/);
});

test('the state file lives beside the other caches and honours CLAUDE_CONFIG_DIR', () => {
  const box = sandbox();
  try {
    assert.strictEqual(tally.stateFile(), path.join(box.dir, 'usage-limits-sessions.json'));
    tally.writeState({ a: { lastAt: NOW } });
    assert.deepStrictEqual(tally.readState(), { a: { lastAt: NOW } });
  } finally {
    box.restore();
  }
});

test('readState survives a corrupt file', () => {
  const box = sandbox();
  try {
    fs.writeFileSync(tally.stateFile(), '{not json');
    assert.deepStrictEqual(tally.readState(), {});
  } finally {
    box.restore();
  }
});

test('formatTally and formatClosed use the singular for one of something', () => {
  const one = sample({ prompts: 1, turns: 1 });
  const text = tally.formatTally(one, { turns: 1, subagentTurns: 1, tokens: 1000, cost: 0.1 }, {});
  assert.match(text, /this reply: 1 turn \(\+1 subagent\)/);
  assert.match(text, /This session: 1 prompt, 1 turn,/);
  assert.match(tally.formatClosed(one, NOW), /: 1 prompt, 1 turn,/);
});

// The turn() helper's call on Opus 5: (100 * 5 + 1000 * 0.5 + 200 * 25) / 1e6.
const OPUS_CALL = 0.006;
// The same call on Sonnet 5: (100 * 2 + 1000 * 0.2 + 200 * 10) / 1e6.
const SONNET_CALL = 0.0024;

function sonnetTurn(id, at) {
  return turn(id, at, {
    isSidechain: true,
    agentId: 'abc',
    message: {
      id: 'msg_' + id,
      model: 'claude-sonnet-5',
      usage: { input_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: 200 },
    },
  });
}

function namelessTurn(id, at) {
  return turn(id, at, {
    isSidechain: true,
    agentId: 'def',
    message: {
      id: 'msg_' + id,
      usage: { input_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: 200 },
    },
  });
}

// Six Sonnet agents under a Fable session were once suspected of being tallied
// at the session's rate. Each transcript is priced at the model its own records
// name; only a record with no model at all is priced at the session's, and
// that is the newest main-thread model seen, or the parent transcript's tail
// when this update read no main-thread turn.
test('update prices each subagent transcript at its own model and a nameless one at the session model', () => {
  const box = sandbox();
  try {
    fs.writeFileSync(box.transcript, turn(1, NOW) + '\n');
    fs.mkdirSync(box.subagentDir, { recursive: true });
    fs.writeFileSync(
      path.join(box.subagentDir, 'agent-abc.jsonl'),
      sonnetTurn('a1', NOW + MINUTE) + '\n' + sonnetTurn('a2', NOW + 2 * MINUTE) + '\n'
    );
    fs.writeFileSync(path.join(box.subagentDir, 'agent-def.jsonl'), namelessTurn('d1', NOW + 2 * MINUTE) + '\n');
    const all = {};
    const first = tally.update(all, SESSION, box.transcript, NOW + 3 * MINUTE, {});
    const expected = OPUS_CALL + 2 * SONNET_CALL + OPUS_CALL;
    assert.ok(Math.abs(first.session.cost - expected) < 1e-12, 'one Opus turn, two Sonnet calls, one nameless call at Opus: got ' + first.session.cost);
    assert.ok(Math.abs(first.session.models['claude-sonnet-5'].cost - 2 * SONNET_CALL) < 1e-12);
    assert.strictEqual(first.session.models['claude-opus-5'].turns, 2, 'the nameless call is counted as the session model');
    assert.strictEqual(first.session.subagentTurns, 3);

    // The next update reads no main-thread line, so the fallback has to come
    // from the transcript on disk rather than from this call's own reading.
    fs.appendFileSync(path.join(box.subagentDir, 'agent-def.jsonl'), namelessTurn('d2', NOW + 4 * MINUTE) + '\n');
    const next = tally.update(all, SESSION, box.transcript, NOW + 5 * MINUTE, {});
    assert.ok(Math.abs(next.delta.cost - OPUS_CALL) < 1e-12, 'still the session model: got ' + next.delta.cost);
    assert.strictEqual(next.session.models['claude-opus-5'].turns, 3);
  } finally {
    box.restore();
  }
});
