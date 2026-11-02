'use strict';

// usage.js as the entry point, not as a library. tally.js requires usage.js
// back, so anything main() requires lazily sees whatever exports had been
// assigned by then. The unit tests cannot catch that; a child process can.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.join(__dirname, '..', 'skills', 'usage-limits', 'scripts', 'usage.js');

test('usage.js run as the entry point can read the session history', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-entry-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'usage-limits-sessions.json'),
      JSON.stringify({
        'abcd1234-0000': {
          project: 'C--proj',
          prompts: 2,
          turns: 5,
          subagentTurns: 0,
          tokens: { input: 1, cacheWrite: 2, cacheRead: 3, output: 4, reasoning: 0 },
          cost: 1.5,
          firstAt: Date.now() - 60000,
          lastAt: Date.now() - 1000,
          endedAt: null,
          models: {},
        },
      })
    );
    const env = Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: dir, USAGE_LIMITS_HOST: 'claude' });

    const list = spawnSync(process.execPath, [script, '--sessions'], { env, encoding: 'utf8' });
    assert.strictEqual(list.status, 0, list.stderr);
    assert.match(list.stdout, /abcd1234/, 'the session on disk is listed');
    assert.doesNotMatch(list.stderr, /circular dependency/);

    const one = spawnSync(process.execPath, [script, '--session', 'last'], { env, encoding: 'utf8' });
    assert.strictEqual(one.status, 0, one.stderr);
    assert.match(one.stdout, /Session abcd1234 [(]C--proj[)]/);
    assert.match(one.stdout, /Cost\s+[$]1[.]50/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
