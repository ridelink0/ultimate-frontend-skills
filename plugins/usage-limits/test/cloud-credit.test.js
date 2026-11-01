'use strict';

// The cloud-session credit, and the session that runs on it.
//
// Usage credits are one lever at the wall and the cloud-session credit is
// another, and on this account only the second one is there: extra usage is
// off at the org level (cachedExtraUsageDisabledReason "org_level_disabled"),
// while the CLI offers "$250 for cloud sessions, on top of your plan limits"
// at the same wall. Before this the report said "Work stops when it does" and
// nothing else, which was true of the local session and left out the one way
// past it.
//
// Two rules these tests defend. The amount is the server's, parsed out of its
// own copy, never a number written here. And a cloud container keeps no usage
// snapshot, so "run /usage once" is advice that cannot work inside one.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempdirs = require('../tools/test-tempdirs.js');

// Pinned before anything is required: the report reads the config directory,
// and this machine's own ~/.claude may carry the very flag under test.
const SCRATCH = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-cloud-credit-'));
process.env.CLAUDE_CONFIG_DIR = SCRATCH;
process.env.USAGE_LIMITS_HOST = 'claude';
process.env.USAGE_LIMITS_FETCH = 'off';

const lowpri = require('../skills/usage-limits/scripts/lowpri.js');
const usage = require('../skills/usage-limits/scripts/usage.js');
const brief = require('../skills/usage-limits/scripts/brief.js');
const mode = require('../skills/usage-limits/scripts/mode.js');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const NOW = Date.parse('2026-09-28T22:00:00.000Z');

// The literal flag read off ~/.claude.json in a cloud container on 2026-09-28
// (Claude Code 2.1.284).
const SWIFT_LYNX = {
  version: 2,
  endpoint: '/v1/code/promo/cloud_credit',
  webPath: '/code/claim-credit',
  desktopPath: '/claude-code-desktop/claim-credit',
  claimLinkIncludesOrganization: true,
  startup: {
    text: "You've been granted a $250 bonus credit for cloud sessions, on top of your plan limits",
    claimPageLine: 'Get started with your $250 cloud session credit',
    buttonLabel: 'Get started',
  },
  limitWall: {
    noticeLine: 'While you wait, start a new cloud session with a $250 credit',
    label: 'While you wait, start a new cloud session with a $250 credit',
    claimPageLine: 'Get started with your $250 cloud session credit',
  },
  ide: { text: 'While you wait, start a new cloud session with a $250 credit', buttonLabel: 'Get started' },
};

function withFlag(value) {
  return { cachedExtraUsageDisabledReason: 'org_level_disabled', cachedGrowthBookFeatures: { tengu_swift_lynx: value } };
}

// The same offer at another amount, so nothing can pass by knowing 250.
function offerOf(amount) {
  return JSON.parse(JSON.stringify(SWIFT_LYNX).split('$250').join('$' + amount));
}

const CLOUD_ENV = {
  CLAUDE_CODE_CONTAINER_ID: 'container_01Vg6--claude_code_remote--59b8',
  CCR_AGENT_PROXY_ENABLED: '1',
  CLAUDE_CODE_SESSION_ID: 'sess-cloud',
};

// ---------------------------------------------------------------- reader --

test('the cloud-session credit is read from tengu_swift_lynx, amount and link from the server\'s own copy', () => {
  assert.deepStrictEqual(lowpri.cloudCredit(withFlag(SWIFT_LYNX)), {
    amount: 250,
    currency: 'USD',
    claimUrl: 'https://claude.ai/code/claim-credit',
    wallNotice: true,
    version: 2,
  });
  const other = lowpri.cloudCredit(withFlag(offerOf('1,000.50')));
  assert.strictEqual(other.amount, 1000.5, 'parsed, not assumed');
  assert.strictEqual(lowpri.creditText(other), '$1000.50');
  assert.strictEqual(lowpri.creditText(lowpri.cloudCredit(withFlag(SWIFT_LYNX))), '$250');
});

test('an absent, malformed or empty offer is no offer at all', () => {
  assert.strictEqual(lowpri.cloudCredit(null), null);
  assert.strictEqual(lowpri.cloudCredit({}), null);
  assert.strictEqual(lowpri.cloudCredit({ cachedGrowthBookFeatures: {} }), null);
  for (const bad of [null, 'yes', 1, [], {}, { version: 3 }, Object.assign({}, SWIFT_LYNX, { enabled: false })]) {
    assert.strictEqual(lowpri.cloudCredit(withFlag(bad)), null, JSON.stringify(bad));
  }
  // Copy with no amount in it cannot be repeated as an offer of anything.
  const wordless = { version: 2, webPath: '/code/claim-credit', startup: { text: 'A bonus credit for cloud sessions' } };
  assert.strictEqual(lowpri.cloudCredit(withFlag(wordless)), null);
});

test('a flag with only the startup copy still has an amount, but the CLI says nothing at the wall', () => {
  const quiet = { version: 1, startup: { text: 'You have a $40 credit for cloud sessions' }, webPath: 'javascript:alert(1)' };
  const credit = lowpri.cloudCredit(withFlag(quiet));
  assert.strictEqual(credit.amount, 40);
  assert.strictEqual(credit.wallNotice, false);
  assert.strictEqual(credit.claimUrl, null, 'only a plain path is joined onto claude.ai');
});

test('a cloud container is recognised from the environment, and nothing else is', () => {
  assert.deepStrictEqual(lowpri.cloudSession(CLOUD_ENV), { cloud: true, sessionId: 'sess-cloud' });
  assert.deepStrictEqual(
    lowpri.cloudSession({ CLAUDE_CODE_REMOTE: 'true', CCR_AGENT_PROXY_ENABLED: '1' }),
    { cloud: true, sessionId: null }
  );
  assert.strictEqual(lowpri.cloudSession({}), null);
  assert.strictEqual(lowpri.cloudSession({ CLAUDE_CODE_REMOTE: 'true' }), null, 'one marker alone is not the container');
  assert.strictEqual(lowpri.cloudSession({ CLAUDE_CODE_CONTAINER_ID: 'some-other-container' }), null);
});

// ---------------------------------------------------------------- report --

const outOfRoom = {
  key: 'five_hour',
  label: '5-hour',
  percentUsed: 92,
  percentLeft: 8,
  msToReset: 4 * HOUR,
  resetsAt: NOW + 4 * HOUR,
  remainingUSD: 2,
  turnsLeft: 6,
  headroomMs: 20 * MINUTE,
  coarse: false,
  stale: false,
  verdict: 'runs-out',
};

function reportData(extra) {
  return Object.assign(
    {
      plan: 'Claude Max',
      planAdvice: null,
      snapshotAgeMs: 60000,
      settings: { model: 'opus', effortLevel: 'xhigh' },
      windows: [outOfRoom],
      binding: outOfRoom,
      resumeAt: outOfRoom.resetsAt,
      scopeLabel: '5-hour',
      models: [],
      projects: [],
      tokens: null,
      credits: { enabled: false, limitReached: false, used: 0, limit: null, percent: 0, currency: 'USD', disabledReason: 'org_level_disabled' },
      cloudCredit: lowpri.cloudCredit(withFlag(SWIFT_LYNX)),
      cloudSession: null,
      recent: { turns: 3, usd: 0.5, usdPerTurn: 0.16, tokens: 0, effort: 'xhigh' },
      measuredTurns: 100,
    },
    extra
  );
}

test('at the wall with usage credits off, the report names the cloud credit as the way on now, and keeps the resume time', () => {
  const text = usage.render(reportData({}));
  assert.match(text, /Cloud credit {2}\$250 for cloud sessions, on top of the plan: claude --cloud, or claude\.ai\/code/);
  assert.match(text, /Nothing carries on into paid credits/, 'usage credits are still off, and it still says so');
  assert.match(text, /To carry on now instead of waiting, start a cloud session on the \$250\n {2}cloud-session credit: relay cloud/);
  assert.match(text, /resume after \d{1,2}:\d{2}/);
  // The order is the argument: what stops, the way on, then the plan B.
  assert.ok(text.indexOf('Nothing carries on') < text.indexOf('To carry on now'));
  assert.ok(text.indexOf('To carry on now') < text.indexOf('resume after'));
});

test('the amount in the report is the one on the flag, and with no flag nothing about it is said', () => {
  const text = usage.render(reportData({ cloudCredit: lowpri.cloudCredit(withFlag(offerOf(75))) }));
  assert.match(text, /Cloud credit {2}\$75 for cloud sessions/);
  assert.match(text, /cloud session on the \$75/);
  assert.doesNotMatch(text, /\$250/);
  const without = usage.render(reportData({ cloudCredit: null }));
  assert.doesNotMatch(without, /cloud/i);
  assert.match(without, /Nothing carries on into paid credits/);
});

test('with usage credits on, the wall is a cost boundary and the cloud line is not repeated there', () => {
  const text = usage.render(
    reportData({ credits: { enabled: true, limitReached: false, used: 4.2, limit: 50, percent: 8, currency: 'USD' } })
  );
  assert.match(text, /Cloud credit {2}\$250/, 'the offer still exists, so the header row stays');
  assert.doesNotMatch(text, /To carry on now/);
  // Spend limit reached puts the wall back.
  const capped = usage.render(
    reportData({ credits: { enabled: true, limitReached: true, used: 50, limit: 50, percent: 100, currency: 'USD' } })
  );
  assert.match(capped, /To carry on now instead of waiting/);
});

test('with room left there is no wall to get past, so only the header row mentions it', () => {
  const roomy = Object.assign({}, outOfRoom, { verdict: 'resets-first' });
  const text = usage.render(reportData({ windows: [roomy], binding: roomy }));
  assert.match(text, /Cloud credit/);
  assert.doesNotMatch(text, /To carry on now/);
});

test('inside a cloud container the report never says to run /usage, and says what this session has cost', () => {
  const text = usage.render(
    reportData({
      windows: [],
      binding: null,
      resumeAt: null,
      credits: null,
      cloudSession: { cloud: true, sessionId: 'sess-cloud', spent: { turns: 29, cost: 4.2033, tokens: 5778203 } },
    })
  );
  assert.doesNotMatch(text, /Run \/usage once|No usage snapshot/);
  assert.match(text, /Cloud session {2}a claude\.ai\/code session, billed to the cloud-session credit\n {17}rather than the plan's 5-hour window/);
  assert.match(text, /So far {9}about \$4\.20 this session at API list prices, 29 turns;/);
  assert.match(text, /the credit is \$250 across all cloud sessions/);
  assert.match(text, /not readable here/, 'the balance is not in any file, and it says so');
  assert.doesNotMatch(text, /Cloud credit {2}/, 'no advice to start the kind of session this already is');
});

test('a cloud session with no readable offer is not said to be on a credit', () => {
  const text = usage.render(
    reportData({
      windows: [],
      binding: null,
      credits: null,
      cloudCredit: null,
      cloudSession: { cloud: true, sessionId: 'sess-cloud', spent: null },
    })
  );
  assert.doesNotMatch(text, /Run \/usage once/);
  assert.doesNotMatch(text, /credit/);
  assert.match(text, /Cloud session {2}a claude\.ai\/code session\. Its container keeps no usage/);
  assert.match(text, /nothing this session has spent is on record yet/);
});

// The report end to end: the flag read from a fixture config, the cloud
// detected from an injected environment, and the session priced from its own
// transcript and its subagent's, at list prices.
function transcriptLine(id, at, session, over) {
  return JSON.stringify(
    Object.assign(
      {
        type: 'assistant',
        timestamp: new Date(at).toISOString(),
        requestId: 'req_' + id,
        sessionId: session,
        message: {
          id: 'msg_' + id,
          model: 'claude-opus-5',
          usage: { input_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 100 },
        },
      },
      over || {}
    )
  );
}

test('report() finds the offer in the config and prices this cloud session from its transcripts', async () => {
  // The snapshot is there so this fixture, and not the machine's own
  // ~/.claude.json, is the account file on every machine.
  fs.writeFileSync(
    path.join(SCRATCH, '.claude.json'),
    JSON.stringify({
      cachedUsageUtilization: { fetchedAtMs: NOW - MINUTE, utilization: { five_hour: { utilization: 10, resets_at: new Date(NOW + 3 * HOUR).toISOString() } } },
      cachedExtraUsageDisabledReason: 'org_level_disabled',
      cachedGrowthBookFeatures: { tengu_swift_lynx: offerOf(175) },
    })
  );
  const project = path.join(SCRATCH, 'projects', '-home-user');
  fs.mkdirSync(path.join(project, 'sess-cloud', 'subagents'), { recursive: true });
  fs.writeFileSync(
    path.join(project, 'sess-cloud.jsonl'),
    [transcriptLine('a', NOW - 20 * MINUTE, 'sess-cloud'), transcriptLine('b', NOW - 10 * MINUTE, 'sess-cloud')].join('\n') + '\n'
  );
  fs.writeFileSync(
    path.join(project, 'sess-cloud', 'subagents', 'agent-x.jsonl'),
    transcriptLine('c', NOW - 5 * MINUTE, 'sess-cloud', { isSidechain: true }) + '\n'
  );
  // Another session on the same disk is not this one's spend.
  fs.writeFileSync(path.join(project, 'sess-other.jsonl'), transcriptLine('d', NOW - 5 * MINUTE, 'sess-other') + '\n');

  const cloud = await usage.report(NOW, { env: CLOUD_ENV });
  assert.strictEqual(cloud.cloudCredit.amount, 175);
  assert.strictEqual(cloud.cloudSession.cloud, true);
  assert.strictEqual(cloud.cloudSession.sessionId, 'sess-cloud');
  // Three Opus calls at (1000 * 5 + 100 * 25) / 1e6 each; two are turns.
  assert.strictEqual(cloud.cloudSession.spent.turns, 2);
  assert.ok(Math.abs(cloud.cloudSession.spent.cost - 3 * 0.0075) < 1e-9, String(cloud.cloudSession.spent.cost));

  // The same machine, not in a container: no cloud block, and the offer stays.
  const local = await usage.report(NOW, { env: {} });
  assert.strictEqual(local.cloudSession, null);
  assert.strictEqual(local.cloudCredit.amount, 175);
});

// ----------------------------------------------------------------- brief --

const TIGHT = { key: 'five_hour', label: '5-hour', percentUsed: 96, stale: false, applies: true, resetsAt: NOW + HOUR, turnsLeft: 3 };

function decided(name) {
  return { name, label: name, source: 'test', policy: mode.MODES[name], bounds: { floor: null, ceiling: null, pin: false }, directive: mode.directive(name) };
}

test('near the wall the brief names the cloud credit once, in both styles, and not when there is room', () => {
  for (const name of ['standard', 'max']) {
    const text = brief.briefText({ mode: decided(name), binding: TIGHT, turnsLeft: 3, pressure: 'tight', cloudCredit: '$250' });
    assert.match(text, /A cloud session is the way past this wall now rather than after the reset/, name);
    assert.match(text, /\$250 cloud-session credit on top of the plan/, name);
    assert.match(text, /relay cloud prints the claude --cloud command/, name);
    assert.match(text, /push first/, name);
    assert.match(text, /starting it is their call/, name);
    assert.strictEqual(text.split('cloud-session credit').length, 2, 'said once: ' + name);
  }
  const roomy = brief.briefText({
    mode: decided('standard'),
    binding: Object.assign({}, TIGHT, { percentUsed: 20, turnsLeft: 300 }),
    turnsLeft: 300,
    pressure: 'roomy',
    cloudCredit: '$250',
  });
  assert.doesNotMatch(roomy, /cloud/i);
});

test('the brief offers it once a session, and a second session hears it too', () => {
  const credit = lowpri.cloudCredit(withFlag(SWIFT_LYNX));
  assert.strictEqual(brief.cloudCreditFor('s1', credit, NOW), '$250');
  assert.strictEqual(brief.cloudCreditFor('s1', credit, NOW + MINUTE), null, 'not again in the same session');
  assert.strictEqual(brief.cloudCreditFor('s2', credit, NOW + MINUTE), '$250');
  // A different offer is news.
  assert.strictEqual(brief.cloudCreditFor('s1', lowpri.cloudCredit(withFlag(offerOf(300))), NOW + 2 * MINUTE), '$300');
  assert.strictEqual(brief.cloudCreditFor('s3', null, NOW), null);
});

test('the brief\'s reading: the offer and whether this is already a cloud session', () => {
  const account = withFlag(SWIFT_LYNX);
  const local = lowpri.forBrief({ account, now: NOW, env: {} });
  assert.strictEqual(local.cloudCredit.amount, 250);
  assert.strictEqual(local.inCloud, false);
  assert.strictEqual(local.credits.reason, 'org_level_disabled');
  assert.strictEqual(lowpri.forBrief({ account, now: NOW, env: CLOUD_ENV }).inCloud, true);
});

test('the hook offers it only where it is the way past the wall: credits not on, and not already in the cloud', () => {
  const file = path.join(SCRATCH, '.claude.json');
  const keys = ['CLAUDE_CODE_CONTAINER_ID', 'CLAUDE_CODE_REMOTE', 'CCR_AGENT_PROXY_ENABLED'];
  const saved = {};
  for (const key of keys) saved[key] = process.env[key];
  const accountWith = (extraUsage) =>
    fs.writeFileSync(
      file,
      JSON.stringify({
        cachedUsageUtilization: { fetchedAtMs: NOW, utilization: { five_hour: { utilization: 96 }, extra_usage: extraUsage } },
        cachedExtraUsageDisabledReason: extraUsage.is_enabled ? undefined : 'org_level_disabled',
        cachedGrowthBookFeatures: { tengu_swift_lynx: SWIFT_LYNX },
      })
    );
  try {
    for (const key of keys) delete process.env[key];
    accountWith({ is_enabled: false });
    assert.strictEqual(brief.wallFeatures(NOW, TIGHT, [TIGHT], 'claude').cloudCredit.amount, 250);
    assert.strictEqual(brief.wallFeatures(NOW, TIGHT, [TIGHT], 'codex').cloudCredit, undefined, 'a Claude Code offer, not Codex\'s');

    accountWith({ is_enabled: true });
    assert.strictEqual(brief.wallFeatures(NOW, TIGHT, [TIGHT], 'claude').cloudCredit, null, 'usage credits carry it already');

    accountWith({ is_enabled: false });
    Object.assign(process.env, { CLAUDE_CODE_CONTAINER_ID: CLOUD_ENV.CLAUDE_CODE_CONTAINER_ID });
    assert.strictEqual(brief.wallFeatures(NOW, TIGHT, [TIGHT], 'claude').cloudCredit, null, 'already a cloud session');
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});
