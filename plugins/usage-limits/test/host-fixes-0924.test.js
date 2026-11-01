'use strict';

// Regression tests for the 2026-09-24 host audit: Codex's live meter arrives in
// camelCase, Antigravity's PreToolUse needs an explicit decision, and the
// Antigravity brief must never report Claude Code's usage.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tempdirs = require('../tools/test-tempdirs.js');

const SCRIPTS = path.join(__dirname, '..', 'skills', 'usage-limits', 'scripts');

test('a camelCase Codex live meter reads the same as the snake_case rollout shape', () => {
  const codex = require(path.join(SCRIPTS, 'codex.js'));
  // The exact shape found on disk: app-server account/rateLimits/read, stored verbatim.
  const live = {
    limitId: 'codex',
    primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1790298264 },
    secondary: { usedPercent: 76, windowDurationMins: 10080, resetsAt: 1790476897 },
    credits: { hasCredits: false, unlimited: false, balance: '0' },
    spendControlReached: false,
    planType: 'plus',
    rateLimitReachedType: 'rate_limit_reached',
  };
  const meter = codex.normalizeMeter(live);
  assert.equal(meter.limit_id, 'codex');
  assert.deepEqual(meter.primary, { used_percent: 100, window_minutes: 300, resets_at: 1790298264 });
  assert.equal(meter.secondary.used_percent, 76);
  assert.equal(meter.plan_type, 'plus');
  assert.equal(meter.rate_limit_reached_type, 'rate_limit_reached');
  assert.equal(meter.credits.has_credits, false);
  // Already snake_case input passes through unchanged.
  assert.deepEqual(codex.normalizeMeter(meter), meter);
  // A snake_case field wins over a camelCase twin, in either order.
  assert.equal(codex.normalizeMeter({ plan_type: 'pro', planType: 'plus' }).plan_type, 'pro');
  assert.equal(codex.normalizeMeter({ planType: 'plus', plan_type: 'pro' }).plan_type, 'pro');
});

test('Antigravity fan-out tools count as multipliers; ordinary tools do not', () => {
  const ceiling = require(path.join(SCRIPTS, 'ceiling.js'));
  assert.equal(ceiling.isMultiplier('invoke_subagent'), true);
  assert.equal(ceiling.isMultiplier('browser_subagent'), true);
  assert.equal(ceiling.isMultiplier('run_command'), false);
  assert.equal(ceiling.isMultiplier('view_file'), false);
});

test('the Antigravity installer narrows PreToolUse to the fan-out tools', () => {
  const source = fs.readFileSync(path.join(SCRIPTS, 'install-antigravity.js'), 'utf8');
  assert.match(source, /matcher: 'invoke_subagent\|browser_subagent'/);
  assert.doesNotMatch(source, /matcher: '\.\*'/);
});

function runHook(args, stdin, env) {
  const { spawnSync } = require('node:child_process');
  const home = tempdirs.make(path.join(os.tmpdir(), 'ul-agy-'));
  const result = spawnSync(process.execPath, [path.join(SCRIPTS, 'agy-hook.js'), ...args], {
    input: stdin,
    encoding: 'utf8',
    timeout: 30000,
    env: Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: home, HOME: home, USERPROFILE: home, USAGE_LIMITS_FETCH: 'off' }, env || {}),
  });
  return JSON.parse(result.stdout.trim().split('\n').pop());
}

test('Antigravity PreToolUse always answers with an explicit decision', () => {
  // An ordinary tool: allowed, never a bare {} (Antigravity reads that as a refusal).
  assert.deepEqual(runHook(['--event', 'PreToolUse'], JSON.stringify({ toolCall: { name: 'run_command' } })), { decision: 'allow' });
  // Unparseable input on PreToolUse still yields an explicit allow.
  assert.deepEqual(runHook(['--event', 'PreToolUse'], 'not json'), { decision: 'allow' });
});

test('the Antigravity brief never reports Claude Code usage and says the quota is unreadable', () => {
  // Empty stdin used to fall through host detection to Claude Code.
  for (const stdin of ['', JSON.stringify({ conversationId: 'c1', invocationNum: 1 })]) {
    const out = runHook(['--event', 'PreInvocation'], stdin);
    const text = JSON.stringify(out);
    assert.doesNotMatch(text, /Claude Code's cache|opus|sonnet|Running /i, 'must not carry Claude data: ' + text);
    // The honest line must actually arrive - an empty answer is how a thrown
    // error hid behind this hook before.
    assert.match(out.injectSteps[0].ephemeralMessage, /Antigravity's quota is not readable/);
  }
});

test('brief.run with a Codex meter that says the limit is reached names it', async () => {
  const brief = require(path.join(SCRIPTS, 'brief.js'));
  assert.equal(typeof brief.run, 'function');
  // The line is a constant; a limit-reached meter with no percentages must not produce ''.
  const source = fs.readFileSync(path.join(SCRIPTS, 'brief.js'), 'utf8');
  assert.match(source, /base\.reachedType \|\| base\.spendControlReached\) return sayOnce\(sessionId, LIMIT_REACHED, now\)/);
});

test('a Codex payload (turn_id) is Codex even when Codex runs the Claude-style plugin hooks', () => {
  const host = require(path.join(SCRIPTS, 'host.js'));
  const bare = { CLAUDE_PLUGIN_ROOT: 'C:/x' };
  assert.equal(host.detectFromHook([], bare, { session_id: 's', turn_id: 't1', permission_mode: 'default' }), host.CODEX);
  // An explicit --host still wins over the payload.
  assert.equal(host.detectFromHook(['--host', 'claude'], bare, { turn_id: 't1' }), host.CLAUDE);
  // A Claude Code payload has no turn_id and keeps the old detection.
  assert.equal(host.detectFromHook([], bare, { session_id: 's' }), host.CLAUDE);
});

// The stance is judged on this session's own headroom, so when that is the
// smaller number the line has to carry it: a brief once said "the budget is
// nearly gone" beside "about 594 turns of headroom".
test('the brief names your own headroom when it is the number being judged', () => {
  const brief = require(path.join(SCRIPTS, 'brief.js'));
  const base = {
    binding: { key: 'five_hour', label: '5-hour', percentUsed: 3, stale: false },
    othersSummary: 'weekly 2%', turnsLeft: 594, resetsIn: '4h 53m', sessions: 1,
  };
  const tight = brief.briefText({ ...base, yourTurnsLeft: 9, pressure: 'tight' });
  assert.match(tight, /about 594 turns of headroom \(about 9 turns of that yours at this context size\)/);
  // One session, and the two figures agree: no extra clause to add.
  const roomy = brief.briefText({ ...base, yourTurnsLeft: 560, pressure: 'roomy' });
  assert.doesNotMatch(roomy, /of that yours/);
  // Several sessions keep the wording they already had.
  const shared = brief.briefText({ ...base, sessions: 3, yourTurnsLeft: 120, pressure: 'roomy' });
  assert.match(shared, /3 sessions active, roughly 120 of them yours/);
});
