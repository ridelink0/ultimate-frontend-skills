'use strict';

// The budget line once said 42 percent, from a reading seventeen minutes old,
// as eight parallel agents emptied the window. Now the hook takes the same
// reading Claude Code takes for /usage when the one on disk has aged.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const brief = require('../skills/usage-limits/scripts/brief.js');
const live = require('../skills/usage-limits/scripts/live.js');
const tempdirs = require('../tools/test-tempdirs.js');

const HOUR = 60 * 60 * 1000;

function serve(body) {
  const server = http.createServer((req, res) => {
    server.hits = (server.hits || 0) + 1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('the before-prompt line refreshes an aged reading the way /usage would', async () => {
  const now = Date.now();
  const dir = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-brief-refresh-'));
  const resets = new Date(now + 2 * HOUR).toISOString();
  const weekly = new Date(now + 3 * 24 * HOUR).toISOString();
  fs.writeFileSync(
    path.join(dir, '.claude.json'),
    JSON.stringify({
      oauthAccount: { accountUuid: 'acc', organizationType: 'claude_max' },
      cachedUsageUtilization: {
        fetchedAtMs: now - 10 * 60 * 1000,
        accountUuid: 'acc',
        utilization: { five_hour: { utilization: 10, resets_at: resets }, seven_day: { utilization: 4, resets_at: weekly } },
      },
    })
  );
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ model: 'claude-opus-5' }));
  fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } }));
  const server = await serve({
    five_hour: { utilization: 60, resets_at: resets },
    seven_day: { utilization: 4, resets_at: weekly },
  });
  const env = { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, USAGE_LIMITS_USAGE_URL: process.env.USAGE_LIMITS_USAGE_URL, USAGE_LIMITS_FETCH: process.env.USAGE_LIMITS_FETCH };
  process.env.CLAUDE_CONFIG_DIR = dir;
  process.env.USAGE_LIMITS_USAGE_URL = 'http://127.0.0.1:' + server.address().port + '/api/oauth/usage';
  delete process.env.USAGE_LIMITS_FETCH;
  try {
    const text = await brief.run(now, { session_id: 'refresh-1', prompt: 'hello', cwd: dir });
    assert.match(text, /5-hour (about )?60% \(the live reading; Claude Code's cache says 10%\) used/, text);
    assert.strictEqual(server.hits, 1);
    assert.strictEqual(live.readLive().utilization.five_hour.utilization, 60);

    // With the network off the reading on disk stands, and nothing is called.
    process.env.USAGE_LIMITS_FETCH = 'off';
    fs.unlinkSync(live.liveFile());
    fs.rmSync(path.join(dir, 'usage-limits-brief.json'), { force: true });
    const offline = await brief.run(now, { session_id: 'refresh-2', prompt: 'hello', cwd: dir });
    assert.match(offline, /5-hour (about )?10% used/, offline);
    assert.strictEqual(server.hits, 1);
  } finally {
    for (const key of Object.keys(env)) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
    await new Promise((resolve) => server.close(resolve));
  }
});
