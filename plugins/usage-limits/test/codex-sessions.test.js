'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const panel = require(path.join(__dirname, '..', 'skills', 'usage-limits', 'scripts', 'panel.js'));

// Codex runs no hooks here, so it writes no marks; until this existed the
// sessions list showed only the Claudes while a Codex worked in the next window.
test('Codex sessions are listed from their rollout files, working when just written', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-codex-'));
  const file = path.join(dir, 'rollout-2026-09-08T11-00-00-abc.jsonl');
  const cwd = ['C:', 'work', 'site'].join(path.sep);
  fs.writeFileSync(
    file,
    JSON.stringify({ timestamp: '2026-09-08T11:00:00.000Z', type: 'session_meta', payload: { session_id: 'abc', cwd, originator: 'Codex Desktop' } }) +
      String.fromCharCode(10)
  );
  try {
    const now = 1000000000000;
    const rows = panel.codexSessions(now, {
      files: [{ file, at: now - 5000 }, { file, at: now - 120000 }, { file, at: now - 999999999 }],
      staleMs: 3600000,
    });
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].state, 'working');
    assert.strictEqual(rows[1].state, 'idle');
    assert.strictEqual(rows[0].modelName, 'Codex (Codex Desktop)');
    assert.strictEqual(path.basename(rows[0].cwd), 'site');
    assert.strictEqual(rows[0].key, 'codex:abc');
    assert.strictEqual(rows[0].host, 'codex');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an unreadable rollout still lists, named by its file', () => {
  const now = 1000000000000;
  const rows = panel.codexSessions(now, { files: [{ file: path.join(os.tmpdir(), 'no-such-rollout-xyz.jsonl'), at: now - 1000 }], staleMs: 60000 });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].id, 'no-such-rollout-xyz');
  assert.strictEqual(rows[0].modelName, 'Codex');
});
