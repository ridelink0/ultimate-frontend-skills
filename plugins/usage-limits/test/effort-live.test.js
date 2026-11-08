'use strict';

// "The hook line says yours opus/xhigh even after I switch to medium." The
// effort chain ranked settings.effortLevel above the session's own record, on
// the belief that the transcript was stamped once at session start. It is not:
// Claude Code stamps `effort` on every assistant line (session a574e6c1 on
// 2026-11-08 reads high, xhigh, high, xhigh, medium). One test per source.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const usage = require('../skills/usage-limits/scripts/usage.js');
const mode = require('../skills/usage-limits/scripts/mode.js');

const SESSION = '11111111-2222-4333-8444-555555555555';

function line(effort, at) {
  return JSON.stringify({
    type: 'assistant',
    sessionId: SESSION,
    timestamp: new Date(at).toISOString(),
    effort,
    message: { model: 'claude-opus-5-5', role: 'assistant' },
  });
}

function withConfig(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-effort-live-'));
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ model: 'opus', effortLevel: 'xhigh' }));
    return fn(dir);
  } finally {
    usage.writeEffortOverride(null);
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeTranscript(file, entries) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, entries.map(([effort, at]) => line(effort, at)).join('\n') + '\n');
}

function projectTranscript(dir) {
  return path.join(dir, 'projects', 'D--work-project', SESSION + '.jsonl');
}

test('with nothing from the session, the setting is the answer', () => {
  withConfig(() => {
    assert.deepStrictEqual(usage.effortNow(SESSION, {}), { effort: 'xhigh', source: 'settings', live: false });
  });
});

test('the transcript found by session id outranks the setting, newest line first', () => {
  withConfig((dir) => {
    const now = Date.now();
    writeTranscript(projectTranscript(dir), [['xhigh', now - 60000], ['high', now - 30000], ['medium', now - 1000]]);
    assert.deepStrictEqual(usage.effortNow(SESSION, {}), { effort: 'medium', source: 'transcript', live: true });
  });
});

test('the hook transcript_path is read first, even outside the projects folder', () => {
  withConfig((dir) => {
    const now = Date.now();
    const hookFile = path.join(dir, 'elsewhere', 'this-turn.jsonl');
    writeTranscript(hookFile, [['xhigh', now - 5000], ['high', now - 1000]]);
    assert.deepStrictEqual(usage.effortNow(SESSION, {}, { transcriptPath: hookFile }), { effort: 'high', source: 'transcript', live: true });
    assert.strictEqual(usage.transcriptEffort(path.join(dir, 'missing.jsonl')), null);
    // Without the path, and with nothing under projects, it falls back.
    assert.strictEqual(usage.effortNow(SESSION, {}).source, 'settings');
  });
});

test('the status-line slot answers before the next assistant line is written', () => {
  withConfig((dir) => {
    const now = Date.now();
    writeTranscript(projectTranscript(dir), [['xhigh', now - 60000]]);
    fs.writeFileSync(
      path.join(dir, 'usage-limits-feed.json'),
      JSON.stringify({ [SESSION]: { at: now - 1000, effort: 'low' }, other: { at: now, effort: 'high' } })
    );
    assert.deepStrictEqual(usage.effortNow(SESSION, {}), { effort: 'low', source: 'status line', live: true });
    // Another session's slot is not this one's.
    assert.strictEqual(usage.statusLineEffort('nobody'), null);
    // An older slot loses to a newer transcript line.
    writeTranscript(projectTranscript(dir), [['xhigh', now - 60000], ['medium', now]]);
    assert.strictEqual(usage.effortNow(SESSION, {}).effort, 'medium');
  });
});

test('the environment still outranks everything', () => {
  withConfig((dir) => {
    writeTranscript(projectTranscript(dir), [['medium', Date.now()]]);
    assert.deepStrictEqual(usage.effortNow(SESSION, { CLAUDE_CODE_EFFORT_LEVEL: 'low' }), { effort: 'low', source: 'environment', live: true });
  });
});

test('a hand-set ultracode holds while the session reads xhigh, and yields once it moves', () => {
  withConfig((dir) => {
    const now = Date.now();
    usage.writeEffortOverride('ultracode', now - 60000);
    writeTranscript(projectTranscript(dir), [['xhigh', now - 1000]]);
    assert.strictEqual(usage.effortNow(SESSION, {}).effort, 'ultracode', 'ultracode resolves to xhigh');
    writeTranscript(projectTranscript(dir), [['xhigh', now - 1000], ['medium', now]]);
    assert.deepStrictEqual(usage.effortNow(SESSION, {}), { effort: 'medium', source: 'transcript', live: true });
  });
});

test('the hook tier line names the live effort, not the setting', () => {
  withConfig((dir) => {
    const now = Date.now();
    const hookFile = path.join(dir, 'elsewhere', 'this-turn.jsonl');
    writeTranscript(hookFile, [['xhigh', now - 5000], ['medium', now - 1000]]);
    const tier = mode.tierNow({ sessionId: SESSION, now, usage, env: {}, transcriptPath: hookFile });
    assert.strictEqual(tier.running.effort, 'medium');
    assert.strictEqual(tier.running.source, 'transcript');
    assert.strictEqual(tier.baseline.effort, 'xhigh');
    const text = mode.tierLine(tier, { terse: true });
    assert.match(text, /\/medium \(transcript\)/);
    assert.doesNotMatch(text, /^[^,]*\/xhigh/, 'the running half is not the setting');
  });
});
