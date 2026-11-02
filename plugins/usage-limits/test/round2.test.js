'use strict';

// The second bug pass of 8 September 2026: nine findings that survived two
// independent skeptics each. The tests here pin the ones that were arithmetic
// or quoting - the kind that come back.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const usage = require('../skills/usage-limits/scripts/usage.js');
const relay = require('../skills/usage-limits/scripts/relay.js');
const statusline = require('../skills/usage-limits/scripts/statusline.js');
const brief = require('../skills/usage-limits/scripts/brief.js');

const NOW = Date.parse('2026-09-08T22:00:00.000Z');

function withConfigDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-round2-'));
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// A window whose spend has outrun its snapshot: the percentage is a floor,
// the price per point came from a dead denominator, and buildWindow nulls the
// turn count. Everything else that derives a number from it has to agree.
const OVERSHOT = {
  key: 'five_hour',
  label: '5-hour',
  stale: false,
  applies: true,
  percentUsed: 13,
  percentLeft: 87,
  usdPerPercent: 0.5,
  turnsLeft: null,
  headroomMs: null,
  remainingUSD: null,
  pointsBeyondSnapshot: 400,
  correctionUnreliable: true,
};

test('effortWarning quotes no turn count off a window whose spend outran its snapshot', () => {
  const events = [];
  for (let i = 0; i < 5; i += 1) events.push({ at: NOW - i * 60000, cost: 0.5, effort: 'ultra', sidechain: false });
  for (let i = 0; i < 5; i += 1) events.push({ at: NOW - i * 60000, cost: 0.1, effort: 'medium', sidechain: false });
  // Before: {effort:'ultra', turnsLeft:72, ...} printed beside the warning
  // that the window may already be exhausted.
  assert.strictEqual(usage.effortWarning(events, 'ultra', OVERSHOT), null);
});

test('an overshot window is the binding one, however low its floor reads', () => {
  const busy = { key: 'seven_day', label: 'weekly', stale: false, applies: true, percentUsed: 40, headroomMs: 3 * 60 * 60 * 1000 };
  assert.strictEqual(usage.bindingWindow([busy, OVERSHOT]).key, 'five_hour');
  assert.strictEqual(usage.bindingWindow([OVERSHOT, busy]).key, 'five_hour');
});

test('an overshot window is named among the critical others whatever its floor says', () => {
  const others = usage.criticalOthers([OVERSHOT, { key: 'seven_day', stale: false, applies: true, percentUsed: 40 }], 'seven_day');
  assert.deepStrictEqual(others.map((w) => w.key), ['five_hour']);
});

// The wake's command line is unquoted by CommandLineToArgvW, whose one rule a
// naive quoter misses: a backslash escapes only a quote, so a run of them
// before the closing quote has to be doubled or the quote is eaten.
test('a Windows argument ending in a backslash keeps its closing quote', () => {
  assert.strictEqual(relay.winArg('plain'), 'plain');
  assert.strictEqual(relay.winArg('C:\\Users\\Two Words\\'), '"C:\\Users\\Two Words\\\\"');
  assert.strictEqual(relay.winArg('say "hi"'), '"say \\"hi\\""');
  assert.strictEqual(relay.winArg('a\\"b'), '"a\\\\\\"b"');
  assert.strictEqual(relay.winArg('C:\\no space\\'), '"C:\\no space\\\\"');
});

test('the scheduler trims its waits to the time the caller has left', () => {
  const now = Date.now();
  assert.strictEqual(relay.remainingMs(now + 3000, 8000) <= 3000, true);
  assert.strictEqual(relay.remainingMs(now - 1000, 8000), 0);
  assert.strictEqual(relay.remainingMs(null, 8000), 8000);
  assert.strictEqual(relay.remainingMs(now + 60000, 8000), 8000);
});

test('a settings file saved with a byte order mark is read, not refused', () =>
  withConfigDir((dir) => {
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, '\uFEFF' + JSON.stringify({ model: 'opus' }));
    const applied = relay.applyAlwaysThinking(true);
    assert.strictEqual(applied.ok, true, applied.error);
    assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')).alwaysThinkingEnabled, true);
  }));

// Two "on" runs with a different status line set between them: the second
// run must remember the one in front of it, not the one from the first run,
// or "off" restores something the user already replaced.
test('a status line set between two on runs is what off will restore', () => {
  const launcher = 'C:/x/usage-limits-statusline.js';
  const first = statusline.planOn({ statusLine: { type: 'command', command: 'old-thing' } }, null, { launcher });
  assert.deepStrictEqual(first.state.previous, { type: 'command', command: 'old-thing' });
  // The user then installs something else by hand.
  const second = statusline.planOn({ statusLine: { type: 'command', command: 'new-thing' } }, first.state, { launcher });
  assert.deepStrictEqual(second.state.previous, { type: 'command', command: 'new-thing' });
  // And a plain second "on" over our own launcher keeps the memory.
  const third = statusline.planOn(second.settings, second.state, { launcher });
  assert.deepStrictEqual(third.state.previous, { type: 'command', command: 'new-thing' });
});

test('relay and reading state files are written whole or not at all', () =>
  withConfigDir((dir) => {
    relay.configure({ enabled: true });
    assert.strictEqual(fs.readdirSync(dir).filter((name) => name.endsWith('.tmp') || name.endsWith('.usage-limits-tmp')).length, 0, 'no temp file is left behind');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'usage-limits-relay.json'), 'utf8')).config.enabled, true);
  }));

// The session that ended for no reason: the Fable weekly at 89 per cent was
// binding, the line said the budget was nearly gone, and the work stopped -
// with the five-hour window at 46 and every other model untouched. A per-model
// weekly is one model's budget, not the account's, and a switch retires it.
test('a model-scoped wall names the switch that clears it', () => {
  const fable = { key: 'seven_day_scoped:fable', label: 'weekly (Fable)', family: 'fable', percentUsed: 89, stale: false, applies: true };
  const five = { key: 'five_hour', label: '5-hour', family: null, percentUsed: 46, stale: false, applies: true };
  const week = { key: 'seven_day', label: 'weekly', family: null, percentUsed: 77, stale: false, applies: true };
  const opus = { key: 'seven_day_opus', label: 'weekly (Opus)', family: 'opus', percentUsed: 12, stale: false, applies: false };
  const out = usage.escapeRoute([fable, five, week, opus], fable, null);
  assert.strictEqual(out.kind, 'model');
  assert.strictEqual(out.nextLabel, 'weekly');
  assert.strictEqual(out.nextPercent, 77);
  assert.strictEqual(out.suggest, 'opus', 'name the emptiest other model, not just "switch"');
});

test('a lateral move is not an escape, and neither is a guess', () => {
  const fable = { key: 'f', label: 'weekly (Fable)', family: 'fable', percentUsed: 89, stale: false };
  // 89 -> 87 buys nothing.
  assert.strictEqual(usage.escapeRoute([fable, { key: 'w', label: 'weekly', family: null, percentUsed: 87, stale: false }], fable, null), null);
  // With no other readable window there is no evidence a switch helps.
  assert.strictEqual(usage.escapeRoute([fable], fable, null), null);
  assert.strictEqual(usage.escapeRoute([], fable, null), null);
  // A stale window is not evidence either.
  assert.strictEqual(usage.escapeRoute([fable, { key: 'w', label: 'weekly', family: null, percentUsed: 10, stale: true }], fable, null), null);
});

test('a shared window follows the account, so effort is the only lever', () => {
  const five = { key: 'five_hour', label: '5-hour', family: null, percentUsed: 92, stale: false, applies: true };
  const week = { key: 'seven_day', label: 'weekly', family: null, percentUsed: 40, stale: false, applies: true };
  assert.strictEqual(usage.escapeRoute([five, week], five, null), null, 'no cheaper effort measured, so nothing to promise');
  const withEffort = usage.escapeRoute([five, week], five, { effort: 'ultra', cheaper: { effort: 'medium', multiple: 6 } });
  assert.strictEqual(withEffort.kind, 'effort');
  assert.strictEqual(withEffort.to, 'medium');
  assert.strictEqual(withEffort.multiple, 6);
});

test('at the wall with an escape, the instruction is switch and carry on - not stop', () => {
  const brief = require('../skills/usage-limits/scripts/brief.js');
  const binding = { key: 'f', label: 'weekly (Fable)', family: 'fable', percentUsed: 89, stale: false, resetsAt: null };
  const text = brief.briefText({
    binding,
    pressure: 'tight',
    escape: { kind: 'model', frees: 'weekly (Fable)', family: 'fable', nextLabel: 'weekly', nextPercent: 77, suggest: 'opus', command: '/model opus' },
    sessions: 1,
    critical: [],
  });
  assert.match(text, /must\s+not stop as though you were/);
  assert.match(text, /\/model opus/);
  assert.match(text, /77 per cent/);
  assert.doesNotMatch(text, /nothing further will run/);
});

test('the older family sentence steps aside for the line that names the model', () => {
  const brief = require('../skills/usage-limits/scripts/brief.js');
  const binding = { key: 'f', label: 'weekly (Fable)', family: 'fable', percentUsed: 89, stale: false, resetsAt: null };
  const escape = { kind: 'model', frees: 'weekly (Fable)', family: 'fable', nextLabel: 'weekly', nextPercent: 76, suggest: 'opus', command: '/model opus' };
  const both = brief.briefText({ binding, family: 'Fable', escape, pressure: 'roomy', sessions: 1, critical: [] });
  assert.doesNotMatch(both, /counts Fable turns only/, 'one point, one sentence');
  assert.match(both, /\/model opus/);
  // With no escape to name, the original sentence is still the only warning there is.
  const alone = brief.briefText({ binding, family: 'Fable', escape: null, pressure: 'roomy', sessions: 1, critical: [] });
  assert.match(alone, /counts Fable turns only/);
});

// /model and /effort do not exist in Codex. Naming them there tells Codex to
// do nothing while believing it acted.
test('the lever is named in the vocabulary of the host it will run in', () => {
  const claude = usage.levers('claude');
  const codex = usage.levers('codex');
  assert.strictEqual(claude.effort('medium'), '/effort medium');
  assert.match(claude.model('opus'), /^\/model opus/);
  assert.doesNotMatch(codex.effort('medium'), /\/effort/);
  assert.doesNotMatch(codex.model('opus'), /\/model/);
  assert.match(codex.effort('medium'), /--host codex --effort medium/);
  assert.match(codex.effort('medium'), /cannot change one already running/, 'the weaker promise is stated, not implied');
  assert.match(codex.model(null), /--host codex --model/);
});

test('escapeRoute carries the host-correct command', () => {
  const fable = { key: 'f', label: 'weekly (Fable)', family: 'fable', percentUsed: 89, stale: false, applies: true };
  const week = { key: 'w', label: 'weekly', family: null, percentUsed: 60, stale: false, applies: true };
  assert.match(usage.escapeRoute([fable, week], fable, null, 'claude').command, /^\/model/);
  assert.match(usage.escapeRoute([fable, week], fable, null, 'codex').command, /--host codex/);
});

test('the escape reads as a choice, not only as a wall notice', () => {
  const brief = require('../skills/usage-limits/scripts/brief.js');
  const binding = { key: 'f', label: 'weekly (Fable)', family: 'fable', percentUsed: 70, stale: false, resetsAt: null };
  const text = brief.briefText({
    binding,
    pressure: 'roomy',
    escape: { kind: 'model', nextLabel: 'weekly', nextPercent: 40, suggest: 'opus', command: '/model opus' },
    sessions: 1,
    critical: [],
  });
  // Early, and clearly, and still not the agent's to take. The command named
  // here is user-plane - /model is typed by a person, and the lowpower path
  // behind it writes settings.json - so "you may make that change yourself, at
  // any point and without being asked" was this plugin's own doctrine broken
  // in the single channel that actually reaches the model.
  assert.match(text, /dearer than the work needs/);
  assert.match(text, /leave the change itself to the user/);
  assert.doesNotMatch(text, /without being asked/);
  assert.doesNotMatch(text, /lowpower/);
  assert.match(text, /\/model opus/);
  // The half that IS the agent's, so the sentence is a redirection rather than
  // a refusal.
  assert.match(text, /the tier of what you SPAWN/);
});

test('an escape with no command names the lever and invents no syntax', () => {
  const brief = require('../skills/usage-limits/scripts/brief.js');
  const binding = { key: 'f', label: 'weekly (Fable)', family: 'fable', percentUsed: 89, stale: false, resetsAt: null };
  const text = brief.briefText({
    binding, pressure: 'tight', sessions: 1, critical: [],
    escape: { kind: 'model', nextLabel: 'weekly', nextPercent: 40, suggest: null, command: null },
  });
  assert.doesNotMatch(text, /undefined|null/);
  assert.match(text, /switching model retires it/);
});

// Agents spend the same window and had no voice on any display: a fan-out
// emptied half a five-hour window in five minutes while the line showed one
// session working.
test('live agents are counted, cached, and shown on the line', () => {
  const view = require('../skills/usage-limits/scripts/view.js');
  const feed = require('../skills/usage-limits/scripts/feed.js');
  const base = {
    now: NOW,
    utilization: { five_hour: { utilization: 40, resets_at: new Date(NOW + 3.6e6).toISOString() } },
    fetchedAtMs: NOW, source: 'cache', working: true,
  };
  assert.deepStrictEqual(view.build(base).agents, { running: 0, runs: 0 }, 'absent means none, never undefined');
  const many = view.build(Object.assign({}, base, { agents: { running: 6, runs: 2 } }));
  const plain = (s) => s.replace(/\u001b\[[0-9;]*m/g, '');
  assert.match(plain(feed.line(many, { columns: 120, mode: 'ansi' })), /\+6 agents \(2 runs\)/);
  const one = view.build(Object.assign({}, base, { agents: { running: 1, runs: 1 } }));
  assert.match(plain(feed.line(one, { columns: 120, mode: 'ansi' })), /\+1 agent(?!s)/, 'singular, and no run count for one run');
  // Narrow terminals drop it: a percentage nobody can see is worse than a
  // count nobody can see.
  assert.doesNotMatch(plain(feed.line(many, { columns: 30, mode: 'ansi' })), /agent/);
  assert.doesNotMatch(plain(feed.line(view.build(base), { columns: 120, mode: 'ansi' })), /agent/);
});

test('the agent scan is cheap enough for a display that redraws every second', () => {
  const first = usage.liveAgents(Date.now());
  assert.ok(Number.isFinite(first.running) && first.running >= 0);
  const started = Date.now();
  for (let i = 0; i < 20; i += 1) usage.liveAgents(Date.now());
  assert.ok(Date.now() - started < 200, 'twenty calls must come off the memo, not the disk');
});

// Found by walking the Codex instruction across the whole range, which is the
// check Gev asked for: does it stop at a good stopping point, or just make a
// plan? At 100 per cent of a SHARED window the escape wording had it refuse to
// stop because a cheaper effort existed - but a cheaper turn against an
// exhausted window is still a turn you cannot take. Only a model switch
// retires a window outright, so only a model switch survives to 'gone'.
test('at a spent shared window it stops; at a spent model window it switches', () => {
  const brief = require('../skills/usage-limits/scripts/brief.js');
  const shared = { key: 'five_hour', label: '5-hour', family: null, percentUsed: 100, percentLeft: 0, stale: false, applies: true, resetsAt: NOW + 9e5, turnsLeft: 0 };
  const scoped = { key: 'f', label: 'weekly (Fable)', family: 'fable', percentUsed: 100, percentLeft: 0, stale: false, applies: true, resetsAt: NOW + 9e5, turnsLeft: 0 };
  const effort = { kind: 'effort', from: 'high', to: 'medium', multiple: 4, command: '/effort medium' };
  const model = { kind: 'model', nextLabel: 'weekly', nextPercent: 30, suggest: 'opus', command: '/model opus' };

  const spentShared = brief.briefText({ binding: shared, pressure: 'gone', escape: effort, sessions: 1, critical: [] });
  assert.match(spentShared, /nothing further will run/, 'a spent shared window is spent');
  assert.doesNotMatch(spentShared, /must not stop/, 'effort cannot buy back an exhausted window');

  const spentScoped = brief.briefText({ binding: scoped, pressure: 'gone', escape: model, sessions: 1, critical: [] });
  assert.match(spentScoped, /must not stop/, 'a model switch retires the window outright');
  assert.match(spentScoped, /\/model opus/);

  // Effort still earns its place while headroom remains.
  const tight = brief.briefText({ binding: shared, pressure: 'tight', escape: effort, sessions: 1, critical: [], turnsLeft: 6 });
  assert.match(tight, /must not stop/);
  assert.match(tight, /\/effort medium/);
});

// "Claude checks the model and effort, notices how it's big and not necessary,
// then either reduces its work or workflow or changes the model or effort
// itself." Budget-triggered advice cannot do that: a mechanical hour at the top
// setting is waste at 10 per cent used exactly as much as at 80.
test('the setting is judged against the work, not against the window', () => {
  const events = [];
  for (let i = 0; i < 8; i += 1) events.push({ effort: 'ultra', cost: 1.2, tokens: 9e5, parts: { output: 9000 }, sidechain: false });
  for (let i = 0; i < 6; i += 1) events.push({ effort: 'medium', cost: 0.2, tokens: 1.5e5, parts: { output: 1500 }, sidechain: false });
  const fit = usage.settingFit(events, 'ultra', 'claude');
  assert.strictEqual(fit.cheaper, 'medium');
  assert.strictEqual(fit.multiple, 6);
  assert.strictEqual(fit.command, '/effort medium');
  assert.strictEqual(fit.sample, 8);
  // Codex is told about Codex's control, never /effort.
  assert.doesNotMatch(usage.settingFit(events, 'ultra', 'codex').command, /\/effort/);
});

test('it refuses to invent a ratio it has not measured', () => {
  const thin = [{ effort: 'ultra', cost: 1, parts: { output: 10 }, sidechain: false }];
  assert.strictEqual(usage.settingFit(thin, 'ultra', 'claude'), null, 'one turn is not evidence');
  const oneLevel = [];
  for (let i = 0; i < 8; i += 1) oneLevel.push({ effort: 'ultra', cost: 1, parts: { output: 100 }, sidechain: false });
  assert.strictEqual(usage.settingFit(oneLevel, 'ultra', 'claude'), null, 'nothing to compare against');
  // Already at the cheap end: nothing to say.
  const both = oneLevel.concat(oneLevel.map(() => ({ effort: 'medium', cost: 1, parts: { output: 100 }, sidechain: false })));
  assert.strictEqual(usage.settingFit(both, 'medium', 'claude'), null);
});

test('the fit sentence names all three levers and asks for the judgement', () => {
  const text = brief.briefText({
    binding: { key: 'five_hour', label: '5-hour', percentUsed: 12, stale: false, resetsAt: NOW + 9e5 },
    pressure: 'roomy', sessions: 1, critical: [], host: 'claude',
    fit: { effort: 'ultra', sample: 8, cheaper: 'medium', cheaperSample: 6, multiple: 6, command: '/effort medium' },
  });
  assert.match(text, /measured at 6 times the cost of medium/);
  assert.match(text, /Judge what is actually in front of you/);
  // Lever 1 is the user's own effort setting, so it is offered and not taken.
  assert.match(text, /Dropping your own effort \(\/effort medium\)/, 'lever 1: effort');
  assert.match(text, /offer it rather than making it/, 'and it is offered, not made');
  assert.match(text, /handing the stretch to a cheaper model/, 'lever 2: model');
  assert.match(text, /a fan-out multiplies the setting across every agent/, 'lever 3: less work');
  assert.match(text, /Put it back when the work gets hard again/);
  // It fires with the window at 12 per cent: the trigger is the setting.
  assert.match(text, /get on with the work/);
});

// "The usage thingy still thinks I'm on xhigh and not ultra." It was not
// misreading: Claude Code's own words are "ultracode: xhigh + dynamic workflow
// orchestration (this session only)". Ultracode IS xhigh effort, and the mode
// is never written to disk, so settings and the transcript both say xhigh and
// neither can name the mode.
test('effort is read from the freshest source available, and says which', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-effort-'));
  const before = process.env.CLAUDE_CONFIG_DIR;
  const beforeEnv = process.env.CLAUDE_CODE_EFFORT_LEVEL;
  process.env.CLAUDE_CONFIG_DIR = dir;
  delete process.env.CLAUDE_CODE_EFFORT_LEVEL;
  try {
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ effortLevel: 'xhigh' }));
    assert.deepStrictEqual(usage.effortNow(), { effort: 'xhigh', source: 'settings', live: false });

    // The one case nothing can see: /effort ultracode typed in the session.
    assert.strictEqual(usage.writeEffortOverride('ultracode', Date.now()).ok, true);
    const byHand = usage.effortNow();
    assert.strictEqual(byHand.effort, 'ultracode');
    assert.strictEqual(byHand.source, 'set by hand');
    assert.strictEqual(byHand.live, true);

    // Claude Code's own session override outranks a hand-set one.
    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'medium';
    assert.deepStrictEqual(usage.effortNow(), { effort: 'medium', source: 'environment', live: true });
    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'banana';
    assert.strictEqual(usage.effortNow().effort, 'ultracode', 'nonsense in the environment is ignored');
    delete process.env.CLAUDE_CODE_EFFORT_LEVEL;

    // A hand-set override describes one session and must not outlive it.
    usage.writeEffortOverride('ultracode', Date.now() - 13 * 60 * 60 * 1000);
    assert.strictEqual(usage.effortNow().source, 'settings', 'a stale override expires');

    assert.strictEqual(usage.writeEffortOverride('banana', Date.now()).ok, false);
    usage.writeEffortOverride(null);
    assert.strictEqual(usage.readEffortOverride(), null);
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = before;
    if (beforeEnv === undefined) delete process.env.CLAUDE_CODE_EFFORT_LEVEL; else process.env.CLAUDE_CODE_EFFORT_LEVEL = beforeEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
