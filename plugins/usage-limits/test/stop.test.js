'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stop = require('../skills/usage-limits/scripts/stop.js');
const sessionend = require('../skills/usage-limits/scripts/sessionend.js');
const tally = require('../skills/usage-limits/scripts/tally.js');

const MINUTE = 60 * 1000;
const NOW = Date.parse('2026-09-01T10:00:00.000Z');
const SESSION = 'sess-hook';

function turn(id, at) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: new Date(at).toISOString(),
    requestId: 'req_' + id,
    sessionId: SESSION,
    message: {
      id: 'msg_' + id,
      model: 'claude-opus-5',
      usage: { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: 100 },
    },
  });
}

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-stop-'));
  const project = path.join(dir, 'projects', 'C--proj');
  fs.mkdirSync(project, { recursive: true });
  const transcript = path.join(project, SESSION + '.jsonl');
  fs.writeFileSync(transcript, turn(1, NOW - 2 * MINUTE) + '\n' + turn(2, NOW - MINUTE) + '\n');
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  return {
    dir,
    transcript,
    restore() {
      if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function withEnv(name, value, fn) {
  const before = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (before === undefined) delete process.env[name];
      else process.env[name] = before;
    });
}

test('the stop hook answers with a systemMessage carrying the tally', async () => {
  const box = sandbox();
  try {
    const out = await stop.run(NOW, { session_id: SESSION, transcript_path: box.transcript, cwd: 'C:/proj' });
    const parsed = JSON.parse(out);
    // First sight of a session: what was read is history, not one reply.
    assert.match(parsed.systemMessage, /^\[usage-limits\] This session: 0 prompts, 2 turns, 2k tokens/);
    assert.doesNotMatch(parsed.systemMessage, /this reply/);
    assert.ok(!('decision' in parsed), 'must never decide anything, or it would keep Claude talking');

    // The next reply is reported as one.
    fs.appendFileSync(box.transcript, turn(3, NOW + MINUTE) + '\n');
    const next = JSON.parse(await stop.run(NOW + 2 * MINUTE, { session_id: SESSION, transcript_path: box.transcript }));
    assert.match(next.systemMessage, /^\[usage-limits\] this reply: 1 turn, 1k tokens, \$0\.00\. This session: 0 prompts, 3 turns/);

    // A stop after nothing new says so instead of repeating the total as new.
    const again = JSON.parse(await stop.run(NOW + 3 * MINUTE, { session_id: SESSION, transcript_path: box.transcript }));
    assert.doesNotMatch(again.systemMessage, /this reply/);
    assert.match(again.systemMessage, /This session: .*3 turns/);
  } finally {
    box.restore();
  }
});

test('the stop hook keeps its running total on disk', async () => {
  const box = sandbox();
  try {
    await stop.run(NOW, { session_id: SESSION, transcript_path: box.transcript });
    let state = tally.readState();
    assert.strictEqual(state[SESSION].turns, 2);
    assert.strictEqual(state[SESSION].lastReply, null, 'the first read is history, not a reply');

    fs.appendFileSync(box.transcript, turn(3, NOW + MINUTE) + '\n');
    await stop.run(NOW + 2 * MINUTE, { session_id: SESSION, transcript_path: box.transcript });
    state = tally.readState();
    assert.strictEqual(state[SESSION].turns, 3);
    assert.strictEqual(state[SESSION].lastReply.turns, 1);
  } finally {
    box.restore();
  }
});

test('the stop hook says nothing without a transcript to read', async () => {
  const box = sandbox();
  try {
    assert.strictEqual(await stop.run(NOW, { session_id: SESSION }), '');
    assert.strictEqual(await stop.run(NOW, null), '');
  } finally {
    box.restore();
  }
});

test('the tally can be turned off', async () => {
  const box = sandbox();
  try {
    await withEnv('USAGE_LIMITS_TALLY', 'off', async () => {
      assert.strictEqual(await stop.run(NOW, { session_id: SESSION, transcript_path: box.transcript }), '');
    });
  } finally {
    box.restore();
  }
});

test('the session end hook prints the closing line and stamps the session', async () => {
  const box = sandbox();
  try {
    const out = await sessionend.run(NOW, {
      session_id: SESSION,
      transcript_path: box.transcript,
      reason: 'clear',
    });
    assert.match(out, /^\[usage-limits\] session closed after 2m: 0 prompts, 2 turns, 2k tokens, about \$0\.0/);
    const state = tally.readState();
    assert.strictEqual(state[SESSION].endedAt, NOW);
    assert.strictEqual(state[SESSION].reason, 'clear');
  } finally {
    box.restore();
  }
});

test('the session end hook also respects the kill switch', async () => {
  const box = sandbox();
  try {
    await withEnv('USAGE_LIMITS_TALLY', 'off', async () => {
      assert.strictEqual(
        await sessionend.run(NOW, { session_id: SESSION, transcript_path: box.transcript, reason: 'other' }),
        ''
      );
    });
  } finally {
    box.restore();
  }
});
