// usage-limits effort: the hook line said "yours opus/xhigh" after a session
// had switched to medium, because the effort chain ranked settings.effortLevel
// above the session's own record. Claude Code re-stamps `effort` on every
// assistant line, and the status-line slot holds what the picker last said.
// The plugin's own tests live under plugins/usage-limits/test and
// npm run test:fast does not reach them, so each source is pinned here too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const scripts = join(root, 'plugins/usage-limits/skills/usage-limits/scripts');
const usage = require(join(scripts, 'usage.js'));
const mode = require(join(scripts, 'mode.js'));

const SESSION = '11111111-2222-4333-8444-555555555555';

function transcript(file, entries) {
  mkdirSync(dirname(file), { recursive: true });
  const lines = entries.map(([effort, at]) =>
    JSON.stringify({ type: 'assistant', sessionId: SESSION, timestamp: new Date(at).toISOString(), effort, message: { model: 'claude-opus-5-5', role: 'assistant' } })
  );
  writeFileSync(file, lines.join('\n') + '\n');
}

function withConfig(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-usage-effort-'));
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ model: 'opus', effortLevel: 'xhigh' }));
    return fn(dir, join(dir, 'projects', 'D--work-project', SESSION + '.jsonl'));
  } finally {
    usage.writeEffortOverride(null);
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = before;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('settings answer only when the session has said nothing', () => {
  withConfig(() => {
    assert.deepEqual(usage.effortNow(SESSION, {}), { effort: 'xhigh', source: 'settings', live: false });
  });
});

test('the transcript by session id outranks settings, newest line first', () => {
  withConfig((dir, file) => {
    const now = Date.now();
    transcript(file, [['xhigh', now - 60000], ['high', now - 30000], ['medium', now - 1000]]);
    assert.deepEqual(usage.effortNow(SESSION, {}), { effort: 'medium', source: 'transcript', live: true });
  });
});

test('the hook transcript_path is read first', () => {
  withConfig((dir) => {
    const now = Date.now();
    const hookFile = join(dir, 'elsewhere', 'this-turn.jsonl');
    transcript(hookFile, [['xhigh', now - 5000], ['high', now - 1000]]);
    assert.deepEqual(usage.effortNow(SESSION, {}, { transcriptPath: hookFile }), { effort: 'high', source: 'transcript', live: true });
  });
});

test('the status-line slot answers before the next assistant line', () => {
  withConfig((dir, file) => {
    const now = Date.now();
    transcript(file, [['xhigh', now - 60000]]);
    writeFileSync(join(dir, 'usage-limits-feed.json'), JSON.stringify({ [SESSION]: { at: now - 1000, effort: 'low' }, other: { at: now, effort: 'high' } }));
    assert.deepEqual(usage.effortNow(SESSION, {}), { effort: 'low', source: 'status line', live: true });
  });
});

test('the environment still outranks the session', () => {
  withConfig((dir, file) => {
    transcript(file, [['medium', Date.now()]]);
    assert.equal(usage.effortNow(SESSION, { CLAUDE_CODE_EFFORT_LEVEL: 'low' }).source, 'environment');
  });
});

test('a hand-set ultracode holds at xhigh and yields once the session moves', () => {
  withConfig((dir, file) => {
    const now = Date.now();
    usage.writeEffortOverride('ultracode', now - 60000);
    transcript(file, [['xhigh', now - 1000]]);
    assert.equal(usage.effortNow(SESSION, {}).effort, 'ultracode');
    transcript(file, [['xhigh', now - 1000], ['medium', now]]);
    assert.equal(usage.effortNow(SESSION, {}).effort, 'medium');
  });
});

test('the hook tier line names the live effort, with the setting as yours', () => {
  withConfig((dir) => {
    const now = Date.now();
    const hookFile = join(dir, 'elsewhere', 'this-turn.jsonl');
    transcript(hookFile, [['xhigh', now - 5000], ['medium', now - 1000]]);
    const tier = mode.tierNow({ sessionId: SESSION, now, usage, env: {}, transcriptPath: hookFile });
    assert.equal(tier.running.effort, 'medium');
    const text = mode.tierLine(tier, { terse: true });
    assert.match(text, /\/medium \(transcript\)/);
    assert.match(text, /yours [^ ]*\/xhigh$/);
  });
});
