'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const usage = require(path.join(__dirname, '..', 'skills', 'usage-limits', 'scripts', 'usage.js'));

// The VS Code panel has no status line, and until this existed it borrowed the
// newest status-line slot on the machine for its model - a 19-hour-old Opus
// session, shown over a Fable one on 2026-09-08.
test('liveModel reads the model from the session transcript, newest assistant line first', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-model-'));
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = home;
  try {
    const dir = path.join(home, 'projects', 'C--x');
    fs.mkdirSync(dir, { recursive: true });
    const id = '11111111-2222-3333-4444-555555555555';
    fs.writeFileSync(
      path.join(dir, id + '.jsonl'),
      [
        JSON.stringify({ type: 'user', sessionId: id, timestamp: '2026-09-08T10:00:00.000Z', message: { role: 'user', content: 'hi' } }),
        JSON.stringify({ type: 'assistant', sessionId: id, timestamp: '2026-09-08T10:00:01.000Z', message: { model: 'claude-opus-5', role: 'assistant', content: [] } }),
        JSON.stringify({ type: 'assistant', sessionId: id, timestamp: '2026-09-08T10:00:02.000Z', message: { model: 'claude-fable-5-1', role: 'assistant', content: [] } }),
        JSON.stringify({ type: 'assistant', sessionId: id, timestamp: '2026-09-08T10:00:03.000Z', message: { model: '<synthetic>', role: 'assistant', content: [] } }),
      ].join('\n') + '\n'
    );
    const found = usage.liveModel(id);
    assert.ok(found, 'a model was read');
    assert.strictEqual(found.model, 'claude-fable-5-1');
    assert.strictEqual(found.at, Date.parse('2026-09-08T10:00:02.000Z'));
    assert.strictEqual(usage.liveModel('no-such-session'), null);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
