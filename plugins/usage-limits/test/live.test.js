'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const live = require('../skills/usage-limits/scripts/live.js');
const tempdirs = require('../tools/test-tempdirs.js');

const NOW = Date.parse('2026-09-05T12:00:00.000Z');

function tempDir() {
  return tempdirs.make(path.join(os.tmpdir(), 'usage-limits-live-'));
}

function withConfigDir(dir, fn) {
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = before;
    });
}

// A stand-in for the usage endpoint. `handler` decides the answer; the last
// request's headers are kept so the test can check what was sent.
function serve(handler) {
  const seen = { headers: null, url: null };
  const server = http.createServer((req, res) => {
    seen.headers = req.headers;
    seen.url = req.url;
    handler(req, res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        url: 'http://127.0.0.1:' + port + '/api/oauth/usage',
        seen,
        close: () => new Promise((done) => server.close(() => done())),
        port,
      });
    });
  });
}

const SAMPLE = {
  five_hour: { utilization: 11, resets_at: '2026-09-05T22:40:00.000Z' },
  seven_day: { utilization: 4, resets_at: '2026-09-06T23:00:00.000Z' },
  limits: [
    { kind: 'session', percent: 11, resets_at: '2026-09-05T22:40:00.000Z', is_active: true },
    { kind: 'weekly_all', percent: 4, resets_at: '2026-09-06T23:00:00.000Z', is_active: false },
    {
      kind: 'weekly_scoped',
      percent: 3,
      resets_at: '2026-09-06T23:00:00.000Z',
      scope: { model: { id: null, display_name: 'Fable' } },
      is_active: false,
    },
  ],
};

test('readToken reads the access token Claude Code keeps on disk', () => {
  const dir = tempDir();
  fs.writeFileSync(
    path.join(dir, '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: 'tok-123', expiresAt: NOW + 3600000 } })
  );
  const found = live.readToken({ file: path.join(dir, '.credentials.json'), platform: 'win32' });
  assert.strictEqual(found.token, 'tok-123');
  assert.strictEqual(found.expiresAt, NOW + 3600000);
  assert.strictEqual(found.source, 'file');
});

test('readToken says why when there is nothing to read', () => {
  const dir = tempDir();
  const missing = live.readToken({ file: path.join(dir, 'nope.json'), platform: 'linux' });
  assert.strictEqual(missing.token, null);
  assert.strictEqual(missing.reason, 'no_credentials');

  fs.writeFileSync(path.join(dir, 'bad.json'), '{not json');
  const broken = live.readToken({ file: path.join(dir, 'bad.json'), platform: 'linux' });
  assert.strictEqual(broken.token, null);
  assert.strictEqual(broken.reason, 'unreadable');

  fs.writeFileSync(path.join(dir, 'empty.json'), JSON.stringify({ claudeAiOauth: {} }));
  const empty = live.readToken({ file: path.join(dir, 'empty.json'), platform: 'linux' });
  assert.strictEqual(empty.token, null);
  assert.strictEqual(empty.reason, 'no_credentials');
});

test('readToken asks the keychain on macOS when the file is absent', () => {
  const dir = tempDir();
  const calls = [];
  const exec = (args) => {
    calls.push(args);
    return JSON.stringify({ claudeAiOauth: { accessToken: 'chain-1', expiresAt: 1 } });
  };
  const found = live.readToken({ file: path.join(dir, 'nope.json'), platform: 'darwin', exec });
  assert.strictEqual(found.token, 'chain-1');
  assert.strictEqual(found.source, 'keychain');
  assert.deepStrictEqual(calls[0], ['find-generic-password', '-s', 'Claude Code-credentials', '-w']);

  const failing = () => {
    throw new Error('no keychain');
  };
  const none = live.readToken({ file: path.join(dir, 'nope.json'), platform: 'darwin', exec: failing });
  assert.strictEqual(none.token, null);
  assert.strictEqual(none.reason, 'no_credentials');
});

test('fetchUsage makes the call Claude Code makes and returns the body', async () => {
  const stub = await serve((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(SAMPLE));
  });
  try {
    const outcome = await live.fetchUsage({ token: 'tok', url: stub.url, timeoutMs: 2000 });
    assert.strictEqual(outcome.ok, true);
    assert.strictEqual(outcome.status, 200);
    assert.strictEqual(outcome.utilization.five_hour.utilization, 11);
    assert.ok(Number.isFinite(outcome.fetchedAtMs));
    assert.strictEqual(stub.seen.headers.authorization, 'Bearer tok');
    assert.strictEqual(stub.seen.headers['anthropic-beta'], 'oauth-2025-04-20');
    assert.strictEqual(stub.seen.headers['content-type'], 'application/json');
    assert.match(stub.seen.headers['user-agent'], /^claude-usage-limits\//);
    assert.strictEqual(stub.seen.url, '/api/oauth/usage');
  } finally {
    await stub.close();
  }
});

test('fetchUsage classifies every way the call can fail', async () => {
  const cases = [
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [500, 'server'],
    [503, 'server'],
    [418, 'http'],
  ];
  for (const [status, kind] of cases) {
    const stub = await serve((req, res) => {
      res.writeHead(status);
      res.end('no');
    });
    try {
      const outcome = await live.fetchUsage({ token: 'tok', url: stub.url, timeoutMs: 2000 });
      assert.strictEqual(outcome.ok, false, String(status));
      assert.strictEqual(outcome.kind, kind, String(status));
      assert.strictEqual(outcome.status, status);
      assert.ok(outcome.message, 'a message for ' + status);
    } finally {
      await stub.close();
    }
  }
});

test('a 429 carries the retry-after the server asked for', async () => {
  const stub = await serve((req, res) => {
    res.writeHead(429, { 'Retry-After': '7' });
    res.end('slow down');
  });
  try {
    const outcome = await live.fetchUsage({ token: 'tok', url: stub.url, timeoutMs: 2000 });
    assert.strictEqual(outcome.kind, 'rate_limited');
    assert.strictEqual(outcome.retryAfterMs, 7000);
  } finally {
    await stub.close();
  }
});

test('a body that is not JSON is a bad response, not a reading', async () => {
  const stub = await serve((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html>sign in</html>');
  });
  try {
    const outcome = await live.fetchUsage({ token: 'tok', url: stub.url, timeoutMs: 2000 });
    assert.strictEqual(outcome.ok, false);
    assert.strictEqual(outcome.kind, 'bad_response');
  } finally {
    await stub.close();
  }
});

test('no answer within the timeout is offline', async () => {
  const stub = await serve(() => {
    // Never answers.
  });
  try {
    const outcome = await live.fetchUsage({ token: 'tok', url: stub.url, timeoutMs: 200 });
    assert.strictEqual(outcome.ok, false);
    assert.strictEqual(outcome.kind, 'offline');
  } finally {
    await stub.close();
  }
});

test('a connection that is refused is offline', async () => {
  const stub = await serve(() => {});
  await stub.close();
  const outcome = await live.fetchUsage({ token: 'tok', url: stub.url, timeoutMs: 2000 });
  assert.strictEqual(outcome.ok, false);
  assert.strictEqual(outcome.kind, 'offline');
});

test('no token means no call at all', async () => {
  const outcome = await live.fetchUsage({ token: null, url: 'http://127.0.0.1:1/x' });
  assert.strictEqual(outcome.ok, false);
  assert.strictEqual(outcome.kind, 'no_credentials');
});

test('nextDelayMs backs off the way each failure deserves', () => {
  const opts = { baseMs: 60000, maxMs: 120000 };
  assert.strictEqual(live.nextDelayMs({ ok: true }, 5000, opts), 60000);
  assert.strictEqual(live.nextDelayMs(null, 5000, opts), 60000);
  // Offline: 5s doubling to a minute.
  assert.strictEqual(live.nextDelayMs({ ok: false, kind: 'offline' }, 0, opts), 5000);
  assert.strictEqual(live.nextDelayMs({ ok: false, kind: 'offline' }, 5000, opts), 10000);
  assert.strictEqual(live.nextDelayMs({ ok: false, kind: 'offline' }, 40000, opts), 60000);
  assert.strictEqual(live.nextDelayMs({ ok: false, kind: 'offline' }, 60000, opts), 60000);
  // Busy: what the server said, else a minute.
  assert.strictEqual(live.nextDelayMs({ ok: false, kind: 'rate_limited', retryAfterMs: 7000 }, 0, opts), 7000);
  assert.strictEqual(live.nextDelayMs({ ok: false, kind: 'rate_limited', retryAfterMs: null }, 0, opts), 60000);
  // A login problem: Claude Code may fix it on its next call, so look again soon.
  assert.strictEqual(live.nextDelayMs({ ok: false, kind: 'unauthorized' }, 0, opts), 30000);
  assert.strictEqual(live.nextDelayMs({ ok: false, kind: 'no_credentials' }, 0, opts), 30000);
  // Server trouble: 15s doubling to two minutes.
  assert.strictEqual(live.nextDelayMs({ ok: false, kind: 'server' }, 0, opts), 15000);
  assert.strictEqual(live.nextDelayMs({ ok: false, kind: 'server' }, 60000, opts), 120000);
  assert.strictEqual(live.nextDelayMs({ ok: false, kind: 'disabled' }, 0, opts), 120000);
});

test('describe gives every outcome a short honest label', () => {
  assert.strictEqual(live.describe({ ok: true }), 'live');
  assert.strictEqual(live.describe({ ok: false, kind: 'offline' }), 'offline');
  assert.match(live.describe({ ok: false, kind: 'unauthorized' }), /sign in/i);
  assert.match(live.describe({ ok: false, kind: 'no_credentials' }), /login/i);
  assert.match(live.describe({ ok: false, kind: 'disabled' }), /off/i);
  assert.ok(live.describe({ ok: false, kind: 'whatever' }));
  assert.strictEqual(live.describe(null), '');
});

test('the live file round-trips and shrugs off corruption', () =>
  withConfigDir(tempDir(), () => {
    assert.strictEqual(live.readLive(), null);
    live.writeLive({ fetchedAtMs: NOW, utilization: SAMPLE, accountUuid: 'acc' });
    const back = live.readLive();
    assert.strictEqual(back.fetchedAtMs, NOW);
    assert.strictEqual(back.accountUuid, 'acc');
    assert.strictEqual(back.utilization.seven_day.utilization, 4);
    fs.writeFileSync(live.liveFile(), '{oops');
    assert.strictEqual(live.readLive(), null);
    fs.writeFileSync(live.liveFile(), JSON.stringify({ fetchedAtMs: 'soon' }));
    assert.strictEqual(live.readLive(), null);
  }));

test('refresh with the network off makes no call and says so', () =>
  withConfigDir(tempDir(), async () => {
    fs.writeFileSync(
      path.join(process.env.CLAUDE_CONFIG_DIR, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } })
    );
    const result = await live.refresh({
      now: NOW,
      url: 'http://127.0.0.1:1/never',
      env: { USAGE_LIMITS_FETCH: 'off' },
    });
    assert.strictEqual(result.outcome.ok, false);
    assert.strictEqual(result.outcome.kind, 'disabled');
    assert.strictEqual(result.snapshot, null);
    assert.strictEqual(live.readLive(), null);
  }));

test('refresh writes the reading with the account it belongs to', () =>
  withConfigDir(tempDir(), async () => {
    fs.writeFileSync(
      path.join(process.env.CLAUDE_CONFIG_DIR, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } })
    );
    const stub = await serve((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(SAMPLE));
    });
    try {
      const result = await live.refresh({ now: NOW, url: stub.url, accountUuid: 'acc', env: {} });
      assert.strictEqual(result.outcome.ok, true);
      assert.strictEqual(result.snapshot.fetchedAtMs, NOW);
      assert.strictEqual(result.snapshot.accountUuid, 'acc');
      assert.strictEqual(result.snapshot.source, 'api');
      const onDisk = live.readLive();
      assert.strictEqual(onDisk.utilization.five_hour.utilization, 11);
      // The token never lands in the file.
      assert.strictEqual(fs.readFileSync(live.liveFile(), 'utf8').indexOf('tok'), -1);
    } finally {
      await stub.close();
    }
  }));

test('refresh without a login keeps whatever reading was there', () =>
  withConfigDir(tempDir(), async () => {
    live.writeLive({ fetchedAtMs: NOW - 1000, utilization: SAMPLE, accountUuid: 'acc' });
    const result = await live.refresh({ now: NOW, url: 'http://127.0.0.1:1/never', env: {} });
    assert.strictEqual(result.outcome.kind, 'no_credentials');
    assert.strictEqual(result.snapshot.fetchedAtMs, NOW - 1000);
  }));

test('refreshIfStale leaves a young reading alone and takes one when it has aged', () =>
  withConfigDir(tempDir(), async () => {
    fs.writeFileSync(
      path.join(process.env.CLAUDE_CONFIG_DIR, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } })
    );
    let hits = 0;
    const stub = await serve((req, res) => {
      hits += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(SAMPLE));
    });
    try {
      live.writeLive({ fetchedAtMs: NOW - 1000, utilization: SAMPLE, accountUuid: 'acc' });
      const young = await live.refreshIfStale({ now: NOW, maxAgeMs: 60000, url: stub.url, env: {} });
      assert.strictEqual(young.skipped, 'fresh');
      assert.strictEqual(hits, 0);

      // Claude Code's own cache counts as a reading too.
      live.writeLive({ fetchedAtMs: NOW - 10 * 60000, utilization: SAMPLE, accountUuid: 'acc' });
      const viaCache = await live.refreshIfStale({ now: NOW, maxAgeMs: 60000, cacheFetchedAtMs: NOW - 5000, url: stub.url, env: {} });
      assert.strictEqual(viaCache.skipped, 'fresh');
      assert.strictEqual(hits, 0);

      const aged = await live.refreshIfStale({ now: NOW, maxAgeMs: 60000, url: stub.url, accountUuid: 'acc', env: {} });
      assert.strictEqual(aged.skipped, null);
      assert.strictEqual(aged.outcome.ok, true);
      assert.strictEqual(hits, 1);
      assert.strictEqual(live.readLive().fetchedAtMs, NOW);
      assert.ok(fs.existsSync(live.attemptFile()));

      // Right after a good reading, nothing to do.
      const again = await live.refreshIfStale({ now: NOW + 1000, maxAgeMs: 60000, url: stub.url, env: {} });
      assert.strictEqual(again.skipped, 'fresh');
      assert.strictEqual(hits, 1);
    } finally {
      await stub.close();
    }
  }));

test('refreshIfStale backs off after a failure instead of waiting on every prompt', () =>
  withConfigDir(tempDir(), async () => {
    fs.writeFileSync(
      path.join(process.env.CLAUDE_CONFIG_DIR, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } })
    );
    const stub = await serve(() => {});
    await stub.close();
    live.writeLive({ fetchedAtMs: NOW - 10 * 60000, utilization: SAMPLE, accountUuid: 'acc' });
    const first = await live.refreshIfStale({ now: NOW, maxAgeMs: 60000, url: stub.url, env: {}, timeoutMs: 500 });
    assert.strictEqual(first.skipped, null);
    assert.strictEqual(first.outcome.kind, 'offline');
    assert.strictEqual(first.snapshot.fetchedAtMs, NOW - 10 * 60000, 'the old reading stands');
    const second = await live.refreshIfStale({ now: NOW + 1000, maxAgeMs: 60000, url: stub.url, env: {}, timeoutMs: 500 });
    assert.strictEqual(second.skipped, 'backoff');
    const later = await live.refreshIfStale({ now: NOW + 10000, maxAgeMs: 60000, url: stub.url, env: {}, timeoutMs: 500 });
    assert.strictEqual(later.skipped, null, 'tried again once the backoff passed');
  }));

test('refreshIfStale with the network off never calls', () =>
  withConfigDir(tempDir(), async () => {
    const result = await live.refreshIfStale({ now: NOW, maxAgeMs: 1, url: 'http://127.0.0.1:1/x', env: { USAGE_LIMITS_FETCH: 'off' } });
    assert.strictEqual(result.skipped, 'disabled');
    assert.ok(!fs.existsSync(live.attemptFile()));
  }));

test('the login only ever goes to Anthropic over https, or to this machine', () => {
  assert.strictEqual(live.allowedUrl('https://api.anthropic.com/api/oauth/usage'), 'https://api.anthropic.com/api/oauth/usage');
  assert.strictEqual(live.allowedUrl('http://127.0.0.1:4321/x'), 'http://127.0.0.1:4321/x');
  assert.strictEqual(live.allowedUrl('http://localhost:4321/x'), 'http://localhost:4321/x');
  assert.strictEqual(live.allowedUrl('http://attacker.example/'), null);
  assert.strictEqual(live.allowedUrl('https://attacker.example/'), null);
  assert.strictEqual(live.allowedUrl('https://anthropic.com.evil.example/'), null);
  assert.strictEqual(live.allowedUrl('http://api.anthropic.com/'), null, 'never plain http off the machine');
  assert.strictEqual(live.allowedUrl('not a url'), null);
  assert.strictEqual(live.allowedUrl(''), null);
});

test('a refused url makes no request', async () => {
  const outcome = await live.fetchUsage({ token: 'tok', url: 'http://attacker.example/steal', timeoutMs: 500 });
  assert.strictEqual(outcome.ok, false);
  assert.strictEqual(outcome.kind, 'bad_response');
});

test('an expired login is not sent; the panel waits for Claude Code to renew it', () =>
  withConfigDir(tempDir(), async () => {
    fs.writeFileSync(
      path.join(process.env.CLAUDE_CONFIG_DIR, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: NOW - 1000 } })
    );
    let hits = 0;
    const stub = await serve((req, res) => {
      hits += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(SAMPLE));
    });
    try {
      const result = await live.refresh({ now: NOW, url: stub.url, env: {} });
      assert.strictEqual(result.outcome.kind, 'expired');
      assert.strictEqual(hits, 0);
      assert.match(live.describe(result.outcome), /expired/);
      assert.strictEqual(live.nextDelayMs(result.outcome, 0, {}), 30000);
    } finally {
      await stub.close();
    }
  }));
