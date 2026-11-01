'use strict';

// A failed launch must not end the relay.
//
// The relay exists so that work interrupted by a limit is picked up
// unattended, hours later, with nobody watching. Until this was fixed, the
// attempt budget only ever covered one case - a window that had not really
// reset - and a failure to LAUNCH went straight to a terminal "failed" on the
// first try.
//
// The failure that found it, from this machine's relay log on 2026-09-14:
//
//   01:51:58  armed 10e28688 for 2026-09-14T04:25:00 via ScheduledTasks
//   04:25:01  wake 10e28688: failed - API Error: Unable to connect to API:
//             SSL certificate hostname mismatch
//
// 1.5 seconds after waking, with attempt still 0. That is a machine whose
// network is not up yet, and the whole night's work was dropped for it.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const wake = require('../skills/usage-limits/scripts/wake.js');
const relay = require('../skills/usage-limits/scripts/relay.js');
const tempdirs = require('../tools/test-tempdirs.js');

const SSL = 'API Error: Unable to connect to API: SSL certificate hostname mismatch';

function isolate() {
  const dir = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-wake-'));
  process.env.CLAUDE_CONFIG_DIR = dir;
  return dir;
}

function armedRecord(extra) {
  return Object.assign(
    {
      id: '10e28688-8fa3-4e1a-acf3-597619397aec',
      task: 'UsageLimitsRelay-test',
      host: 'claude',
      cwd: process.cwd(),
      project: 'test',
      armedAt: 1,
      wakeAt: 2,
      resetsAt: 2,
      windowKey: 'five_hour',
      mode: 'resume',
      attempt: 0,
      continuation: false,
      work: { pending: 1, todos: [] },
    },
    extra || null
  );
}

// The window HAS reset (percent well under the threshold), the CLI is found,
// and delivery fails. That is the exact shape of the real incident.
// Online, stubbed, like every other outside effect here. Left to the real
// network, the preflight in wake.run made this whole file pass or fail on
// whether this machine could reach api.anthropic.com: on a laptop with its wifi
// off - or behind a TLS-inspecting proxy, which is what this machine reads as -
// every test below took the OFFLINE branch and never reached the launch it is
// about. The offline branch has its own test at the bottom of the file.
const ONLINE = async () => ({ online: true, reason: 'ok', detail: null, results: [] });

function deps(state, failWith) {
  return {
    reachable: ONLINE,
    windowReopened: async () => ({ known: true, percent: 3 }),
    deliverClaude: () => ({ ok: false, error: failWith }),
    deliverCodex: () => ({ ok: false, error: failWith }),
    toast: () => {},
    userIsPresent: () => ({ known: true, present: false }),
    capabilities: () => ({ claude: 'claude', codex: 'codex', computerUse: null }),
    // Never register a real scheduled task from a test.
    arm: (options) => {
      const held = relay.read();
      held.armed = armedRecord({ attempt: options.config ? 0 : 0 });
      relay.write(held);
      state.armCalls.push(options);
      return { ok: true, how: 'test' };
    },
  };
}

function seed(record) {
  const state = relay.read();
  // A fresh config defaults to 'notify', which never reaches the delivery step
  // this test is about. Gev's real config is 'resume'; match it.
  state.config = Object.assign({}, state.config, { mode: 'resume', enabled: true });
  state.armed = record;
  relay.write(state);
}

test('a failed launch re-arms instead of giving up', async () => {
  const saved = process.env.CLAUDE_CONFIG_DIR;
  isolate();
  try {
    seed(armedRecord());
    const calls = { armCalls: [] };
    const result = await wake.run(Date.now(), [], deps(calls, SSL));

    assert.equal(result.outcome, 'retrying', 'should retry, not fail');
    assert.equal(result.attempt, 1);
    assert.equal(result.error, SSL);
    assert.equal(calls.armCalls.length, 1, 'should have booked another wake');

    // The retry is booked from now, not from the original reset time, or it
    // would be scheduled in the past and fire immediately in a loop.
    const booked = calls.armCalls[0];
    assert.ok(Number.isFinite(booked.resetsAt), 'the retry needs a reset time');
    assert.ok(booked.resetsAt >= Date.now() - 5000, 'booked from now, not from the old reset');
    // The work has to travel with it, or the retry resumes an empty plan.
    assert.ok(booked.work && booked.work.hasWork, 'the work must carry over');

    // And the attempt counter is persisted, so the next wake knows.
    assert.equal(relay.read().armed.attempt, 1);
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
  }
});

test('it gives up once the attempt budget is spent', async () => {
  const saved = process.env.CLAUDE_CONFIG_DIR;
  isolate();
  try {
    const config = relay.settings(relay.read());
    // One short of the budget: the next failure is the last.
    seed(armedRecord({ attempt: config.attempts - 1 }));
    const calls = { armCalls: [] };
    const result = await wake.run(Date.now(), [], deps(calls, SSL));

    // The short retries are spent, so the immediate loop stops. What happens
    // next is onFailure's decision, not this one's: by default the work gets
    // one more window rather than being dropped at 4am.
    assert.equal(result.outcome, 'rearmed', 'the work survives to the next window');
    assert.equal(result.rearms, 1);
    assert.equal(relay.read().armed.attempt, 0, 'the short-retry budget resets for the new window');
    assert.equal(relay.read().armed.rearms, 1, 'but the rearm is counted, so this cannot run forever');
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
  }
});

test('a retry that cannot be booked fails cleanly rather than hanging', async () => {
  const saved = process.env.CLAUDE_CONFIG_DIR;
  isolate();
  try {
    seed(armedRecord());
    const result = await wake.run(Date.now(), [], {
      reachable: ONLINE,
      windowReopened: async () => ({ known: true, percent: 3 }),
      deliverClaude: () => ({ ok: false, error: SSL }),
      deliverCodex: () => ({ ok: false, error: SSL }),
      toast: () => {},
    userIsPresent: () => ({ known: true, present: false }),
    capabilities: () => ({ claude: 'claude', codex: 'codex', computerUse: null }),
      arm: () => ({ ok: false, error: 'scheduler refused' }),
    });
    assert.equal(result.outcome, 'failed');
    assert.equal(result.error, SSL);
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
  }
});

test('a successful launch still does not retry', async () => {
  const saved = process.env.CLAUDE_CONFIG_DIR;
  isolate();
  try {
    seed(armedRecord());
    const calls = { armCalls: [] };
    const result = await wake.run(Date.now(), [], {
      reachable: ONLINE,
      windowReopened: async () => ({ known: true, percent: 3 }),
      deliverClaude: () => ({ ok: true, how: 'claude --resume' }),
      deliverCodex: () => ({ ok: true, how: 'codex' }),
      toast: () => {},
    userIsPresent: () => ({ known: true, present: false }),
    capabilities: () => ({ claude: 'claude', codex: 'codex', computerUse: null }),
      arm: (o) => {
        calls.armCalls.push(o);
        return { ok: true, how: 'test' };
      },
    });
    assert.equal(result.outcome, 'resumed');
    assert.equal(calls.armCalls.length, 0);
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
  }
});

test('onFailure stop keeps the old behaviour: terminal means terminal', async () => {
  const saved = process.env.CLAUDE_CONFIG_DIR;
  isolate();
  try {
    relay.configure({ onFailure: 'stop' });
    const config = relay.settings(relay.read());
    seed(armedRecord({ attempt: config.attempts - 1 }));
    const calls = { armCalls: [] };
    const result = await wake.run(Date.now(), [], deps(calls, SSL));

    assert.equal(result.outcome, 'failed', 'should stop retrying eventually');
    assert.equal(calls.armCalls.length, 0, 'no further wake should be booked');
    assert.equal(relay.read().armed, null);
  } finally {
    relay.configure({ onFailure: 'rearm' });
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
  }
});

test('rearming is bounded - the work gets maxRearms extra windows and then stops', async () => {
  const saved = process.env.CLAUDE_CONFIG_DIR;
  isolate();
  try {
    const config = relay.settings(relay.read());
    // Already rearmed as many times as it is allowed to.
    seed(armedRecord({ attempt: config.attempts - 1, rearms: config.maxRearms }));
    const calls = { armCalls: [] };
    const result = await wake.run(Date.now(), [], deps(calls, SSL));

    assert.equal(result.outcome, 'failed', 'a scheduled task that reschedules itself forever is worse than giving up');
    assert.equal(relay.read().armed, null);
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
  }
});

// The branch the seam above uncovered. Until `reachable` was a dependency this
// was untestable, so the preflight - the part that decides what happens to a
// night's work on a laptop whose wifi is off - had no test at all, while six
// tests that were not about it exercised it by accident.
test('offline is waited out on its own longer budget, not spent from the launch attempts', async () => {
  const saved = process.env.CLAUDE_CONFIG_DIR;
  isolate();
  try {
    seed(armedRecord());
    const calls = { armCalls: [] };
    const base = deps(calls, SSL);
    const result = await wake.run(Date.now(), [], Object.assign({}, base, {
      reachable: async () => ({ online: false, reason: 'offline', detail: 'fetch failed', results: [] }),
      // If the preflight works, nothing below it runs.
      deliverClaude: () => {
        throw new Error('the launch must not be attempted while offline');
      },
    }));

    assert.equal(result.outcome, 'offline', result.outcome);
    assert.equal(result.attempt, 1, 'the first offline try');
    assert.ok(result.retryInMinutes > 0, 'it books a retry');
    assert.equal(calls.armCalls.length, 1, 'and books it through arm()');
    // The launch budget is untouched: being offline is not a failed launch.
    const after = relay.read().armed;
    assert.equal(after.offlineAttempt, 1);
    assert.equal(after.attempt || 0, 0, 'the launch attempts are not spent on a network that is not there');
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
  }
});
