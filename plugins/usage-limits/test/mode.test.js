'use strict';

// Budget modes.
//
// The tests that matter here are not "does it store a string". They are the
// three rules the feature exists to keep:
//
//   - `off` costs nothing and says nothing, including at the wall.
//   - No mode ever writes settings.json. That file is the user's own baseline,
//     and the plugin only ever reads it.
//   - Nothing the plugin says points outside the bounds the user set, and a
//     recommendation without a measurement behind it is never made.
//
// Everything else - aliases, precedence, the change log - is scaffolding for
// those.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const mode = require('../skills/usage-limits/scripts/mode.js');
const drift = require('../skills/usage-limits/scripts/drift.js');
const brief = require('../skills/usage-limits/scripts/brief.js');
const tempdirs = require('../tools/test-tempdirs.js');

const NOW = Date.parse('2026-09-08T21:00:00.000Z');

// Every test runs against a scratch config directory, and pins the host, so
// nothing here can reach the real ~/.claude or ~/.codex.
function withConfigDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-mode-'));
  const before = {
    dir: process.env.CLAUDE_CONFIG_DIR,
    host: process.env.USAGE_LIMITS_HOST,
    mode: process.env.USAGE_LIMITS_MODE,
  };
  process.env.CLAUDE_CONFIG_DIR = dir;
  process.env.USAGE_LIMITS_HOST = 'claude';
  delete process.env.USAGE_LIMITS_MODE;
  try {
    return fn(dir);
  } finally {
    for (const [key, value] of [
      ['CLAUDE_CONFIG_DIR', before.dir],
      ['USAGE_LIMITS_HOST', before.host],
      ['USAGE_LIMITS_MODE', before.mode],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Names

// Stated here rather than read out of the table it is checking. Comparing the
// table against itself passes whatever the table says, which is exactly what
// an alias test must not do: these are the words people actually use, and each
// one has a promised destination.
const PROMISED = {
  ultra: 'max', ultraefficient: 'max', 'ultra-efficient': 'max', maxtoken: 'max', 'max-token': 'max',
  maxefficient: 'max', maxefficiency: 'max', 'max-efficient': 'max',
  highefficient: 'high', 'high-efficient': 'high', 'high-efficiency': 'high', highefficiency: 'high', smart: 'high',
  tokenefficient: 'standard', 'token-efficient': 'standard', efficient: 'standard', default: 'standard', on: 'standard',
  none: 'off', ignore: 'off', quiet: 'off', silent: 'off',
};

test('every alias resolves to the mode it was promised to', () => {
  for (const alias of Object.keys(PROMISED)) {
    const found = mode.normalise(alias);
    assert.ok(found && found.mode, alias + ' resolved to nothing');
    assert.strictEqual(found.mode, PROMISED[alias], alias + ' resolved to the wrong mode');
  }
  assert.deepStrictEqual(
    Object.keys(mode.ALIASES).sort(),
    Object.keys(PROMISED).sort(),
    'an alias was added or removed without saying where it should point'
  );
  // And the four names themselves, in any casing, with whitespace.
  for (const name of mode.ORDER) {
    assert.strictEqual(mode.normalise('  ' + name.toUpperCase() + ' ').mode, name);
  }
  assert.strictEqual(mode.normalise('nonsense'), null);
  assert.strictEqual(mode.normalise(''), null);
  assert.strictEqual(mode.normalise(null), null);
});

// The one word that must never be guessed at. It means the fourth mode to the
// person who asked for this feature and the third mode to everyone else, so a
// silent guess picks the opposite of what was meant half the time.
test('"normal" is answered with a question, not a guess', () => {
  const found = mode.normalise('normal');
  assert.ok(found.ambiguous, 'normal must not resolve to a mode');
  assert.deepStrictEqual(found.ambiguous, ['standard', 'off']);
  assert.match(found.message, /normal is ambiguous here/);
  assert.match(found.message, /standard  the plugin working as usual/);
  assert.match(found.message, /off       the plugin stays out of the way/);
  assert.ok(!Object.keys(mode.ALIASES).includes('normal'), 'normal must not be an alias of either');
});

test('asking for "normal" changes nothing on disk', () =>
  withConfigDir(() => {
    const answer = mode.main(['normal']);
    assert.match(answer, /ambiguous/);
    assert.strictEqual(mode.read().mode, 'standard', 'an ambiguous word must not set anything');
    assert.strictEqual(fs.existsSync(mode.modeFile()), false, 'and must not even create the file');
  }));

// ---------------------------------------------------------------------------
// Resolution and precedence

test('precedence runs environment, then session, then file, then the default', () =>
  withConfigDir(() => {
    assert.strictEqual(mode.resolve({}).name, 'standard');
    assert.strictEqual(mode.resolve({}).source, 'the default');

    mode.main(['high']);
    assert.strictEqual(mode.resolve({}).name, 'high');
    assert.strictEqual(mode.resolve({}).source, 'the file');

    mode.main(['max', '--session', '--session-id', 'S1']);
    assert.strictEqual(mode.resolve({ sessionId: 'S1' }).name, 'max');
    assert.strictEqual(mode.resolve({ sessionId: 'S1' }).source, 'this session');
    assert.strictEqual(mode.resolve({ sessionId: 'OTHER' }).name, 'high', 'a session override is one session only');

    process.env.USAGE_LIMITS_MODE = 'off';
    assert.strictEqual(mode.resolve({ sessionId: 'S1' }).name, 'off');
    assert.strictEqual(mode.resolve({ sessionId: 'S1' }).source, 'environment');
    delete process.env.USAGE_LIMITS_MODE;
  }));

test('a corrupt state file falls back to standard rather than throwing', () =>
  withConfigDir((dir) => {
    fs.writeFileSync(path.join(dir, 'usage-limits-mode.json'), '{"mode": "max"');
    assert.strictEqual(mode.read().mode, 'standard');
    assert.strictEqual(mode.resolve({}).name, 'standard');
    fs.writeFileSync(path.join(dir, 'usage-limits-mode.json'), '["max"]');
    assert.strictEqual(mode.resolve({}).name, 'standard');
    fs.writeFileSync(path.join(dir, 'usage-limits-mode.json'), '{"mode": "banana", "auto": "yes"}');
    assert.strictEqual(mode.resolve({}).name, 'standard');
    assert.strictEqual(mode.resolve({}).auto, false);
  }));

test('the state file is written atomically and leaves nothing behind', () =>
  withConfigDir((dir) => {
    mode.main(['max']);
    const written = fs.readFileSync(mode.modeFile(), 'utf8');
    assert.strictEqual(JSON.parse(written).mode, 'max', 'the file is complete JSON, not a half write');
    // Both temporary suffixes this plugin has used: .tmp before 1.39.6, .usage-limits-tmp since.
    const strays = fs.readdirSync(dir).filter((name) => name.endsWith('.tmp') || name.endsWith('.usage-limits-tmp'));
    assert.deepStrictEqual(strays, [], 'the temporary file is renamed, not left');
  }));

// ---------------------------------------------------------------------------
// auto

test('auto picks from pressure and always reports what it picked', () => {
  assert.strictEqual(mode.autoPick({ percentUsed: 10, pressure: 'roomy' }), 'standard');
  assert.strictEqual(mode.autoPick({ percentUsed: 49, pressure: 'roomy' }), 'standard');
  assert.strictEqual(mode.autoPick({ percentUsed: 50, pressure: 'roomy' }), 'high');
  assert.strictEqual(mode.autoPick({ percentUsed: 79, pressure: 'roomy' }), 'high');
  assert.strictEqual(mode.autoPick({ percentUsed: 80, pressure: 'roomy' }), 'max');
  assert.strictEqual(mode.autoPick({ percentUsed: 100, pressure: 'gone' }), 'max');
  // Pressure outranks the percentage: a short runway at 20 per cent is still
  // the moment to be careful.
  assert.strictEqual(mode.autoPick({ percentUsed: 20, pressure: 'tight' }), 'max');
  // Nothing readable is not a reason to change anything.
  assert.strictEqual(mode.autoPick({ percentUsed: null, pressure: 'unknown' }), 'standard');
  assert.strictEqual(mode.autoPick(null), 'standard');
});

test('auto never resolves to off, at any reading', () => {
  for (const percent of [0, 25, 50, 75, 80, 95, 100, 140]) {
    for (const pressure of ['roomy', 'tight', 'gone', 'unknown']) {
      assert.notStrictEqual(
        mode.autoPick({ percentUsed: percent, pressure }),
        'off',
        'turning the plugin off is a decision a person makes, not a threshold'
      );
    }
  }
});

test('auto is reported as the mode it resolved to, never as a mystery', () =>
  withConfigDir(() => {
    mode.main(['auto']);
    const decided = mode.resolve({ reading: { percentUsed: 85, pressure: 'roomy' } });
    assert.strictEqual(decided.name, 'max');
    assert.strictEqual(decided.label, 'auto -> max');
    assert.strictEqual(decided.auto, true);
    mode.main(['auto', 'off']);
    assert.strictEqual(mode.resolve({}).auto, false);
  }));

// ---------------------------------------------------------------------------
// off, and the wall

test('setting off says once what off costs, and offers the guard', () =>
  withConfigDir(() => {
    const said = mode.main(['off']);
    assert.match(said, /nothing will be injected, including at the wall/);
    assert.match(said, /--guard 95/);
    assert.strictEqual(mode.read().guardPercent, null, 'the guard stays discoverable, not imposed');
  }));

test('the guard is stored, and is the only thing off will ever say', () =>
  withConfigDir(() => {
    mode.main(['off', '--guard', '95']);
    const decided = mode.resolve({});
    assert.strictEqual(decided.name, 'off');
    assert.strictEqual(decided.guardPercent, 95);
    assert.strictEqual(decided.policy.briefStyle, 'none');
    assert.strictEqual(decided.policy.refreshSeconds, 0, 'the hooks short-circuit before reading anything');
    assert.strictEqual(decided.directive, null);
  }));

test('the guard line stays quiet below its percentage and speaks at it', () =>
  withConfigDir(() => {
    const usage = require('../skills/usage-limits/scripts/usage.js');
    const realCollect = usage.collect;
    const at = (percent) => ({
      utilization: { limits: [{ kind: 'session', percent, resets_at: new Date(NOW + 3600000).toISOString() }] },
      snapshotFetchedAt: NOW,
      settings: {},
    });
    try {
      usage.collect = () => at(80);
      assert.strictEqual(brief.guardLine(NOW, { guardPercent: 95 }), '');
      usage.collect = () => at(96);
      const said = brief.guardLine(NOW, { guardPercent: 95 });
      assert.match(said, /96% used/);
      assert.match(said, /only line/);
      // And with no guard set, off is silent at any percentage at all.
      assert.strictEqual(brief.guardLine(NOW, { guardPercent: null }), '');
    } finally {
      usage.collect = realCollect;
    }
  }));

// ---------------------------------------------------------------------------
// The two planes

test('no path through this module writes settings.json', () =>
  withConfigDir((dir) => {
    // The user's own baseline, exactly as they left it.
    const settings = path.join(dir, 'settings.json');
    const original = JSON.stringify({ model: 'opus', effortLevel: 'xhigh', statusLine: { type: 'command', command: 'x' } }, null, 2) + '\n';
    fs.writeFileSync(settings, original, 'utf8');

    const paths = [];
    for (const name of mode.ORDER.concat(Object.keys(mode.ALIASES))) paths.push([name]);
    paths.push(['normal']);
    paths.push(['auto']);
    paths.push(['auto', 'off']);
    paths.push(['off', '--guard', '95']);
    paths.push(['--floor', 'sonnet/medium']);
    paths.push(['--ceiling', 'opus/xhigh']);
    paths.push(['--floor', 'none']);
    paths.push(['--pin']);
    paths.push(['--no-pin']);
    paths.push(['--no-advice']);
    paths.push(['--advice-on']);
    paths.push(['--list']);
    paths.push(['--explain', 'max']);
    paths.push(['--history']);
    paths.push(['--ledger']);
    paths.push(['--baseline']);
    paths.push(['undo']);
    paths.push(['undo']);
    paths.push([]);
    for (const argv of paths) {
      mode.main(argv);
      assert.strictEqual(
        fs.readFileSync(settings, 'utf8'),
        original,
        'settings.json changed while running: mode ' + argv.join(' ')
      );
    }
  }));

test('the baseline is shown beside the running tier, and says which is whose', () =>
  withConfigDir(() => {
    const said = mode.main(['--baseline']);
    assert.match(said, /baseline/);
    assert.match(said, /running/);
    assert.match(said, /yours/);
    // The surprise this heads off: a baseline change does not move the session
    // already running.
    assert.match(said, /NEW sessions/);
  }));

test('the tier line says where the reading came from, not merely what it is', () => {
  const line = mode.tierLine({
    baseline: { model: 'claude-opus-4-5', effort: 'xhigh' },
    running: { model: 'claude-sonnet-4-5', effort: 'medium', source: 'this turn' },
  });
  // The version is shown, not only the family: opus 4.5 and opus 5.5 are
  // different models at different prices.
  assert.match(line, /opus 4\.5\/xhigh/);
  assert.match(line, /sonnet 4\.5\/medium/);
  assert.match(line, /this turn/);
  // Where they agree there is nothing interesting to say, so it is said once.
  const same = mode.tierLine({
    baseline: { model: 'opus', effort: 'high' },
    running: { model: 'opus', effort: 'high', source: 'settings' },
  });
  assert.strictEqual(same.indexOf('baseline'), -1);
  assert.match(same, /Running opus\/high \(settings\)/);
});

test('CLAUDE_EFFORT is preferred for the running tier, because the host sets it per turn', () =>
  withConfigDir(() => {
    const before = process.env.CLAUDE_EFFORT;
    process.env.CLAUDE_EFFORT = 'low';
    try {
      const tier = mode.tierNow({
        env: process.env,
        usage: { effortNow: () => ({ effort: 'xhigh', source: 'settings' }), collect: () => ({ settings: { effortLevel: 'xhigh', model: 'opus' } }), liveModel: () => null },
      });
      assert.strictEqual(tier.running.effort, 'low');
      assert.strictEqual(tier.running.source, 'this turn');
      assert.strictEqual(tier.baseline.effort, 'xhigh', 'and the baseline is still reported as theirs');
    } finally {
      if (before === undefined) delete process.env.CLAUDE_EFFORT;
      else process.env.CLAUDE_EFFORT = before;
    }
  }));

// ---------------------------------------------------------------------------
// The user's bounds

test('a tier is read from either half, or both', () => {
  assert.deepStrictEqual(mode.parseTier('sonnet/medium'), { model: 'sonnet', effort: 'medium' });
  assert.deepStrictEqual(mode.parseTier('medium'), { model: null, effort: 'medium' });
  assert.deepStrictEqual(mode.parseTier('opus'), { model: 'opus', effort: null });
  // ultracode is xhigh plus orchestration, not a sixth level.
  assert.strictEqual(mode.parseTier('ultracode').effort, 'xhigh');
  assert.ok(mode.parseTier('banana').error);
});

test('a floor and a ceiling both bite, and an unranked name is never called a breach', () => {
  const bounds = { floor: { model: 'opus', effort: 'high' }, ceiling: null };
  assert.strictEqual(mode.allows(bounds, { effort: 'medium' }), false);
  assert.strictEqual(mode.allows(bounds, { effort: 'high' }), true);
  assert.strictEqual(mode.allows(bounds, { model: 'sonnet' }), false);
  assert.strictEqual(mode.allows(bounds, { model: 'fable' }), true);
  assert.strictEqual(mode.allows(bounds, { model: 'something-new' }), true, 'an unranked name is not evidence');
  const ceiling = { floor: null, ceiling: { effort: 'high' } };
  assert.strictEqual(mode.allows(ceiling, { effort: 'xhigh' }), false);
  assert.strictEqual(mode.allows(ceiling, { effort: 'low' }), true);
  assert.strictEqual(mode.allows(null, { effort: 'low' }), true);
});

test('xhigh and max carry the thinking caveat wherever they are named', () => {
  assert.match(mode.thinkingCaveat({ effort: 'xhigh' }), /thinking/);
  assert.match(mode.thinkingCaveat({ effort: 'max' }), /refused/);
  assert.strictEqual(mode.thinkingCaveat({ effort: 'high' }), null);
});

test('setting a floor reports it, and setting a thinking-only one warns', () =>
  withConfigDir(() => {
    assert.match(mode.main(['--floor', 'sonnet/medium']), /floor is sonnet\/medium/);
    assert.deepStrictEqual(mode.read().floor, { model: 'sonnet', effort: 'medium' });
    assert.match(mode.main(['--ceiling', 'opus/xhigh']), /thinking/);
    assert.match(mode.main(['--floor', 'banana']), /Could not read a tier/);
  }));

test('pin produces reporting language and never an instruction to switch', () =>
  withConfigDir(() => {
    mode.main(['--pin']);
    const decided = mode.resolve({});
    assert.strictEqual(decided.bounds.pin, true);
    const text = brief.briefText({
      mode: decided,
      binding: { key: 'seven_day_scoped:fable', label: 'weekly (Fable)', family: 'fable', percentUsed: 95, stale: false, turnsLeft: 4, headroomMs: 5 * 60 * 1000 },
      pressure: 'tight',
      escape: { kind: 'model', report: true, family: 'fable', nextLabel: '5-hour', nextPercent: 30, suggest: 'opus', command: '/model opus' },
      sessions: 1,
      critical: [],
      turnsLeft: 4,
    });
    assert.match(text, /pinned/i);
    assert.ok(!/ Do that, say in one line that you switched/.test(text), 'pinned must not instruct a switch');
    assert.ok(!/You may make that change yourself/.test(text), 'nor invite one');
    // It still reports the route: hiding a true fact is not restraint.
    assert.match(text, /\/model opus/);
  }));

// ---------------------------------------------------------------------------
// The change log

test('the change log records what changed, when, and at whose instruction', () =>
  withConfigDir(() => {
    mode.main(['high']);
    mode.main(['max']);
    const said = mode.history(NOW);
    assert.match(said, /mode: high -> max/);
    assert.match(said, /by user/);
  }));

test('undo reverses exactly the last change and nothing else', () =>
  withConfigDir(() => {
    mode.main(['high']);
    mode.main(['--floor', 'sonnet/medium']);
    mode.main(['max']);
    const answer = mode.undo(NOW);
    assert.strictEqual(answer.ok, true);
    assert.match(answer.text, /Reverting mode max back to high/);
    assert.strictEqual(mode.read().mode, 'high');
    assert.deepStrictEqual(mode.read().floor, { model: 'sonnet', effort: 'medium' }, 'the floor set before it is untouched');
  }));

test('undo with an empty history says so rather than guessing', () =>
  withConfigDir(() => {
    const answer = mode.undo(NOW);
    assert.strictEqual(answer.ok, false);
    assert.match(answer.text, /nothing in the change log/);
  }));

test('undo of a user-plane change names it and the command, and writes nothing', () =>
  withConfigDir((dir) => {
    const settings = path.join(dir, 'settings.json');
    const original = '{"effortLevel":"medium"}\n';
    fs.writeFileSync(settings, original, 'utf8');
    mode.logChange({ plane: 'user', key: 'effortLevel', from: 'xhigh', to: 'medium', by: 'user', reason: 'low power on' }, NOW);
    const answer = mode.undo(NOW + 1000);
    assert.strictEqual(answer.ok, false, 'the user plane is not this script\'s to write');
    assert.match(answer.text, /lowpower\.js off/);
    assert.match(answer.text, /NEW sessions/);
    assert.strictEqual(fs.readFileSync(settings, 'utf8'), original);
  }));

// "Nothing has been changed yet" and "the record of what changed is gone" are
// different facts, and only one of them is true of a file that will not parse.
// Reporting the second as the first tells a user who HAS been making changes
// that they never made any, which leaves them no reason to suspect the file.
test('a corrupt or truncated change log does not throw', () =>
  withConfigDir((dir) => {
    fs.writeFileSync(path.join(dir, 'usage-limits-changes.json'), '{"entries": [{"at": 1, "key"');
    assert.deepStrictEqual(mode.readChanges(), { entries: [], unreadable: true });
    assert.ok(!/Nothing has been changed/.test(mode.history(NOW)), 'a lost record is not an empty one');
    assert.match(mode.history(NOW), /could not be read/);
    assert.match(mode.undo(NOW).text, /could not be read/);
    fs.writeFileSync(path.join(dir, 'usage-limits-changes.json'), '{"entries": [null, 3, {"key":"mode"}]}');
    assert.deepStrictEqual(mode.readChanges().entries, [], 'entries that are not entries are dropped');
    assert.strictEqual(mode.undo(NOW).ok, false);
  }));

// The ordinary case, and the one that must NOT be reported as damage: a file
// that has never been written.
test('a change log that was never written says exactly that', () =>
  withConfigDir(() => {
    assert.deepStrictEqual(mode.readChanges(), { entries: [] });
    assert.match(mode.history(NOW), /Nothing has been changed/);
    assert.match(mode.undo(NOW).text, /nothing in the change log to undo/);
  }));

test('the change log is bounded', () =>
  withConfigDir(() => {
    for (let i = 0; i < mode.KEEP_CHANGES + 25; i += 1) {
      mode.logChange({ plane: 'mode', key: 'mode', from: 'a', to: 'b', by: 'user' }, NOW + i);
    }
    assert.strictEqual(mode.readChanges().entries.length, mode.KEEP_CHANGES);
  }));

// ---------------------------------------------------------------------------
// The advice channel

const FIT = {
  effort: 'xhigh',
  sample: 40,
  cheaper: 'medium',
  cheaperSample: 22,
  multiple: 3.4,
  command: '/effort medium',
};

test('a recommendation with no measurement behind it is never emitted', () =>
  withConfigDir(() => {
    const decided = mode.resolve({});
    const pending = mode.advicePending({ decided, fit: null, sessionId: 'S' });
    assert.strictEqual(pending.ok, false);
    assert.strictEqual(pending.reason, 'no measurement');
    assert.strictEqual(pending.text, null);
  }));

test('a recommendation names the measurement, the command and when it applies', () =>
  withConfigDir(() => {
    const pending = mode.advicePending({ decided: mode.resolve({}), fit: FIT, sessionId: 'S' });
    assert.strictEqual(pending.ok, true);
    assert.match(pending.text, /3\.4 times/);
    assert.match(pending.text, /\/effort medium/);
    assert.match(pending.text, /next turn/);
    assert.match(pending.text, /offer it, do not make it/);
  }));

test('the same recommendation is never made twice once declined, across sessions', () =>
  withConfigDir(() => {
    const id = mode.adviceId(FIT);
    mode.adviceDecline(id, NOW);
    for (const sessionId of ['S1', 'S2', 'S3']) {
      const pending = mode.advicePending({ decided: mode.resolve({}), fit: FIT, sessionId });
      assert.strictEqual(pending.ok, false, 'a declined recommendation came back in session ' + sessionId);
      assert.strictEqual(pending.reason, 'declined before');
    }
  }));

test('at most one recommendation per session', () =>
  withConfigDir(() => {
    const first = mode.advicePending({ decided: mode.resolve({}), fit: FIT, sessionId: 'S' });
    assert.strictEqual(first.alreadyOffered, false);
    mode.adviceOffer(first.id, 'S', NOW);
    const again = mode.advicePending({ decided: mode.resolve({}), fit: FIT, sessionId: 'S' });
    assert.strictEqual(again.alreadyOffered, true, 'the second time in one session is not volunteered');
    const elsewhere = mode.advicePending({ decided: mode.resolve({}), fit: FIT, sessionId: 'OTHER' });
    assert.strictEqual(elsewhere.alreadyOffered, false, 'but a different session gets its one');
  }));

test('no recommendation at all in off, and none when the channel is muted', () =>
  withConfigDir(() => {
    mode.main(['off']);
    assert.strictEqual(mode.advicePending({ decided: mode.resolve({}), fit: FIT, sessionId: 'S' }).ok, false);
    assert.strictEqual(mode.advicePending({ decided: mode.resolve({}), fit: FIT, sessionId: 'S' }).reason, 'off');
    mode.main(['standard']);
    mode.main(['--no-advice']);
    const muted = mode.advicePending({ decided: mode.resolve({}), fit: FIT, sessionId: 'S' });
    assert.strictEqual(muted.ok, false);
    assert.strictEqual(muted.reason, 'muted');
    mode.main(['--advice-on']);
    assert.strictEqual(mode.advicePending({ decided: mode.resolve({}), fit: FIT, sessionId: 'S' }).ok, true);
  }));

test('advice is still capped and evidenced in max, only shorter', () =>
  withConfigDir(() => {
    mode.main(['max']);
    const pending = mode.advicePending({ decided: mode.resolve({}), fit: FIT, sessionId: 'S' });
    assert.strictEqual(pending.ok, true);
    assert.strictEqual(pending.terse, true);
    assert.match(pending.text, /3\.4x/);
    assert.match(pending.text, /\/effort medium/);
    assert.ok(pending.text.length < 220, 'terse means fewer words, not less evidence');
  }));

test('a recommendation that points below the bounds the user set is not made', () =>
  withConfigDir(() => {
    mode.main(['--floor', 'opus/high']);
    const pending = mode.advicePending({ decided: mode.resolve({}), fit: FIT, sessionId: 'S' });
    assert.strictEqual(pending.ok, false);
    assert.strictEqual(pending.reason, 'below the bounds set');
  }));

// ---------------------------------------------------------------------------
// The ledger

test('the ledger measures cost per mode from what replies actually cost', () =>
  withConfigDir(() => {
    drift.recordTurns('max', 10, 1.2, NOW, null);
    drift.recordTurns('max', 24, 2.88, NOW + 1000, null);
    drift.recordTurns('standard', 10, 4.7, NOW + 2000, null);
    const rows = drift.modeSummary(null);
    const max = rows.find((row) => row.mode === 'max');
    assert.strictEqual(max.turns, 34);
    assert.ok(Math.abs(max.usdPerTurn - 0.12) < 0.001);
    const said = mode.main(['--ledger']);
    assert.match(said, /max/);
    assert.match(said, /\$0\.12\/turn/);
    assert.match(said, /34 turns/);
  }));

test('the ledger is bounded and says so when it has nothing', () =>
  withConfigDir(() => {
    assert.match(mode.main(['--ledger']), /nothing measured yet/);
    for (let i = 0; i < drift.MAX_MODE_ENTRIES + 20; i += 1) drift.recordTurns('high', 1, 0.1, NOW + i, null);
    assert.strictEqual(drift.read(null).modes.length, drift.MAX_MODE_ENTRIES);
  }));

// ---------------------------------------------------------------------------
// The policy table itself

test('every mode is a complete record, so nothing downstream has to special-case a name', () => {
  const fields = Object.keys(mode.MODES.standard);
  for (const name of mode.ORDER) {
    const policy = mode.MODES[name];
    for (const field of fields) {
      assert.ok(field in policy, name + ' is missing ' + field + ', so a reader would silently get undefined');
    }
  }
});

test('only off returns nothing, and only off reads nothing', () => {
  for (const name of mode.ORDER) {
    const policy = mode.MODES[name];
    assert.strictEqual(policy.briefStyle === 'none', name === 'off');
    assert.strictEqual(policy.refreshSeconds === 0, name === 'off');
  }
});

// The trap this whole feature has to avoid: a mode that saves tokens by doing
// the job worse. The savings come from ceremony and nothing else.
test('no directive ever tells the agent to do the work worse', () => {
  const forbidden = [
    /skip the tests?/i,
    /good enough/i,
    /less thorough/i,
    /do less\b/i,
    /cut corners/i,
    /lower quality/i,
    /skip the hard/i,
    /don't bother/i,
    /narrow the request/i,
  ];
  for (const name of mode.ORDER) {
    const text = mode.DIRECTIVES[name];
    if (!text) continue;
    for (const phrase of forbidden) {
      assert.ok(!phrase.test(text), name + ' directive tells the agent to do the work worse: ' + phrase);
    }
  }
  assert.match(mode.DIRECTIVES.max, /Quality is not negotiable/);
});

// The honest half. Nothing a hook emits can change the running session's own
// model or effort, so no directive may imply that it does.
test('no directive claims a lever the host does not give a hook', () => {
  for (const name of mode.ORDER) {
    const text = mode.DIRECTIVES[name];
    if (!text) continue;
    assert.ok(!/I will switch|switching you|has switched your model/i.test(text));
  }
  // And the one that talks about tiers says whose each one is.
  assert.match(mode.DIRECTIVES.high, /not yours to set mid-turn/);
  assert.match(mode.DIRECTIVES.high, /Agent call/);
  assert.match(mode.DIRECTIVES.high, /Workflow script/);
});

test('--explain prints the whole record, including the directive it injects', () => {
  const said = mode.explain('max');
  assert.match(said, /briefStyle\s+terse/);
  assert.match(said, /refreshSeconds\s+600/);
  assert.match(said, /Fewest tokens/);
  assert.match(mode.explain('off'), /Nothing is injected at all/);
  assert.match(mode.explain('banana'), /No such mode/);
});

// ---------------------------------------------------------------------------
// What the hooks do about it

// The promise of `off` is not "a shorter line". It is that the plugin costs
// nothing: no reading, no scan, no state write, no injection. A hook that
// "returns immediately" after paying for a transcript scan has already broken
// it, so this counts the scans rather than reading the answer.
test('in off the pulse returns before it reads, scans or writes anything', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-mode-pulse-'));
  const before = { dir: process.env.CLAUDE_CONFIG_DIR, host: process.env.USAGE_LIMITS_HOST, pulse: process.env.USAGE_LIMITS_PULSE };
  process.env.CLAUDE_CONFIG_DIR = dir;
  process.env.USAGE_LIMITS_HOST = 'claude';
  process.env.USAGE_LIMITS_PULSE = 'always';
  const pulse = require('../skills/usage-limits/scripts/pulse.js');
  const usage = require('../skills/usage-limits/scripts/usage.js');
  const realReport = usage.report;
  let scans = 0;
  try {
    usage.report = async () => {
      scans += 1;
      return { binding: { key: 'five_hour', label: '5-hour', percentUsed: 99, stale: false, turnsLeft: 1 }, sessions: [] };
    };
    mode.main(['off']);
    for (let i = 0; i < 5; i += 1) {
      const text = await pulse.run(NOW + i * 60000, { session_id: 'P', hook_event_name: 'PostToolUse', tool_name: 'Read' });
      assert.strictEqual(text, '', 'off injected something from the pulse');
    }
    assert.strictEqual(scans, 0, 'off paid for a scan');
    assert.strictEqual(fs.existsSync(path.join(dir, 'usage-limits-pulse.json')), false, 'off wrote throttle state');
    assert.strictEqual(fs.existsSync(path.join(dir, 'usage-limits-activity.json')), false, 'off wrote an activity mark');
  } finally {
    usage.report = realReport;
    for (const [key, value] of [['CLAUDE_CONFIG_DIR', before.dir], ['USAGE_LIMITS_HOST', before.host], ['USAGE_LIMITS_PULSE', before.pulse]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The distinguishing feature of `high`, and the thing that had to be verified
// before it could be built: a PostToolUse hook really can put a line in front
// of the model mid-turn.
//
// Driven through the real fitFromRates on purpose. The old version of this
// test stubbed usage.settingFit and so proved nothing about the wiring - which
// is exactly where the bug was: the re-cost asked report() for `data.events`,
// a field report() has never returned, and got null back on every machine.
// Here the report stub returns the per-effort TABLE report() actually returns,
// and the measurement has to survive the journey.
test('high re-costs mid-turn, on its own two-minute throttle', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-mode-recheck-'));
  const before = { dir: process.env.CLAUDE_CONFIG_DIR, host: process.env.USAGE_LIMITS_HOST, fetch: process.env.USAGE_LIMITS_FETCH };
  process.env.CLAUDE_CONFIG_DIR = dir;
  process.env.USAGE_LIMITS_HOST = 'claude';
  process.env.USAGE_LIMITS_FETCH = 'off';
  const pulse = require('../skills/usage-limits/scripts/pulse.js');
  const usage = require('../skills/usage-limits/scripts/usage.js');
  const real = { report: usage.report, escapeRoute: usage.escapeRoute };
  // The table report() returns, not the event list it does not.
  let rates = [
    { effort: 'xhigh', turns: 40, outputPerTurn: 3400, perTurn: 0.4 },
    { effort: 'medium', turns: 22, outputPerTurn: 1000, perTurn: 0.1 },
  ];
  try {
    // Roomy on purpose: the ordinary pulse says nothing here, and the re-cost
    // still has to. A turn running a tier far bigger than the work needs is
    // exactly the case where the budget still looks fine.
    usage.report = async () => ({
      binding: { key: 'five_hour', label: '5-hour', percentUsed: 20, stale: false, turnsLeft: 200, headroomMs: 4 * 60 * 60 * 1000 },
      windows: [],
      sessions: [],
      effortRates: rates,
      effortNow: 'xhigh',
    });
    usage.escapeRoute = () => null;
    mode.main(['high']);

    const first = await pulse.run(NOW, { session_id: 'H', hook_event_name: 'PostToolUse', tool_name: 'Edit' });
    assert.match(first, /Re-costed/);
    // The measurement itself, carried the whole way from the rates table.
    assert.match(first, /3\.4 times the cost of medium/);
    assert.match(first, /\/effort medium/);
    // It says whose lever is whose: the main loop's tier is not the hook's to
    // move, and what the turn spawns is.
    assert.match(first, /user's to make/);
    assert.match(first, /Size what you spawn/);

    const soon = await pulse.run(NOW + 30 * 1000, { session_id: 'H', hook_event_name: 'PostToolUse', tool_name: 'Edit' });
    assert.strictEqual(soon, '', 'the re-cost is throttled to the mode two minutes');

    // Two minutes on, with nothing changed, it says NOTHING. Repeating the
    // same 370 characters every 120 seconds is fifteen identical injections in
    // a half-hour turn: the mode named for efficiency charging for advice it
    // has already given.
    const later = await pulse.run(NOW + 130 * 1000, { session_id: 'H', hook_event_name: 'PostToolUse', tool_name: 'Edit' });
    assert.strictEqual(later, '', 'the same re-cost is not said twice');

    // And it is not simply dead after the first one: when the answer changes,
    // it speaks again.
    rates = [
      { effort: 'xhigh', turns: 40, outputPerTurn: 3400, perTurn: 0.4 },
      { effort: 'low', turns: 30, outputPerTurn: 400, perTurn: 0.05 },
    ];
    const changed = await pulse.run(NOW + 260 * 1000, { session_id: 'H', hook_event_name: 'PostToolUse', tool_name: 'Edit' });
    assert.match(changed, /Re-costed/, 'a different answer is worth saying');
    assert.match(changed, /cost of low/);
  } finally {
    Object.assign(usage, real);
    for (const [key, value] of [['CLAUDE_CONFIG_DIR', before.dir], ['USAGE_LIMITS_HOST', before.host], ['USAGE_LIMITS_FETCH', before.fetch]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The mid-turn re-cost is a recommendation about the user's own setting, so it
// obeys the advice rules rather than running beside them. It used to filter
// only on the bounds, so a user who had said "stop suggesting that" was told it
// again every two minutes - roughly thirty times an hour - in the one mode that
// speaks mid-turn.
test('the mid-turn re-cost obeys the advice rules it is a recommendation under', async () => {
  const drive = async (setup) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-mode-recheck-advice-'));
    const before = { dir: process.env.CLAUDE_CONFIG_DIR, host: process.env.USAGE_LIMITS_HOST, fetch: process.env.USAGE_LIMITS_FETCH };
    process.env.CLAUDE_CONFIG_DIR = dir;
    process.env.USAGE_LIMITS_HOST = 'claude';
    process.env.USAGE_LIMITS_FETCH = 'off';
    const pulse = require('../skills/usage-limits/scripts/pulse.js');
    const usage = require('../skills/usage-limits/scripts/usage.js');
    const real = { report: usage.report, escapeRoute: usage.escapeRoute };
    try {
      usage.report = async () => ({
        binding: { key: 'five_hour', label: '5-hour', percentUsed: 20, stale: false, turnsLeft: 200, headroomMs: 4 * 60 * 60 * 1000 },
        windows: [],
        sessions: [],
        effortRates: [
          { effort: 'xhigh', turns: 40, outputPerTurn: 3400, perTurn: 0.4 },
          { effort: 'medium', turns: 22, outputPerTurn: 1000, perTurn: 0.1 },
        ],
        effortNow: 'xhigh',
      });
      usage.escapeRoute = () => null;
      mode.main(['high']);
      setup();
      return await pulse.run(NOW, { session_id: 'A', hook_event_name: 'PostToolUse', tool_name: 'Edit' });
    } finally {
      Object.assign(usage, real);
      for (const [key, value] of [['CLAUDE_CONFIG_DIR', before.dir], ['USAGE_LIMITS_HOST', before.host], ['USAGE_LIMITS_FETCH', before.fetch]]) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  assert.match(await drive(() => {}), /Re-costed/, 'it speaks when nothing forbids it');
  assert.strictEqual(await drive(() => mode.main(['--no-advice'])), '', 'mode --no-advice means this too');
  assert.strictEqual(
    await drive(() => mode.main(['--decline', 'effort:xhigh>medium'])),
    '',
    'a declined recommendation is not re-made every two minutes'
  );
  assert.strictEqual(
    await drive(() => mode.main(['--floor', 'high'])),
    '',
    'and it never points below the bound the user set'
  );
  assert.strictEqual(
    await drive(() => mode.adviceOffer('effort:xhigh>medium', 'A', NOW)),
    '',
    'at most one per session, counting the one the brief already made'
  );
});

// Saying no has to have something to say no to. The re-cost writes down what
// it offered, so `mode --decline` typed straight after one has an id to act on.
test('a mid-turn re-cost is on the record, so it can be declined', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-mode-recheck-record-'));
  const before = { dir: process.env.CLAUDE_CONFIG_DIR, host: process.env.USAGE_LIMITS_HOST, fetch: process.env.USAGE_LIMITS_FETCH };
  process.env.CLAUDE_CONFIG_DIR = dir;
  process.env.USAGE_LIMITS_HOST = 'claude';
  process.env.USAGE_LIMITS_FETCH = 'off';
  const pulse = require('../skills/usage-limits/scripts/pulse.js');
  const usage = require('../skills/usage-limits/scripts/usage.js');
  const real = { report: usage.report, escapeRoute: usage.escapeRoute };
  try {
    usage.report = async () => ({
      binding: { key: 'five_hour', label: '5-hour', percentUsed: 20, stale: false, turnsLeft: 200, headroomMs: 4 * 60 * 60 * 1000 },
      windows: [],
      sessions: [],
      effortRates: [
        { effort: 'xhigh', turns: 40, outputPerTurn: 3400, perTurn: 0.4 },
        { effort: 'medium', turns: 22, outputPerTurn: 1000, perTurn: 0.1 },
      ],
      effortNow: 'xhigh',
    });
    usage.escapeRoute = () => null;
    mode.main(['high']);
    assert.match(await pulse.run(NOW, { session_id: 'R', hook_event_name: 'PostToolUse', tool_name: 'Edit' }), /Re-costed/);
    assert.match(mode.main(['--advice', '--session-id', 'R']), /xhigh/, 'it is pending, with its evidence');
    assert.match(mode.main(['--decline', '--session-id', 'R']), /effort:xhigh>medium/, 'and declining it needs no id typed out');
  } finally {
    Object.assign(usage, real);
    for (const [key, value] of [['CLAUDE_CONFIG_DIR', before.dir], ['USAGE_LIMITS_HOST', before.host], ['USAGE_LIMITS_FETCH', before.fetch]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// standard is "what the plugin does today", and today's pulse interval is two
// minutes. The brief's refresh is a different cadence and always was; folding
// the two together quietly slowed the mid-turn ping by half.
test('standard keeps both of today\'s cadences, and max takes fewer readings', () => {
  assert.strictEqual(mode.MODES.standard.refreshSeconds, 180);
  assert.strictEqual(mode.MODES.standard.pulseSeconds, 120);
  assert.strictEqual(mode.MODES.max.pulseSeconds, 600);
  assert.strictEqual(mode.MODES.high.recheckSeconds, 120);
  assert.strictEqual(mode.MODES.standard.recheckSeconds, 0, 'only high re-costs mid-turn');
});

// The terse line drops what reads the same every turn. It must not drop what
// changes the decision.
test('the terse line keeps the decision, the tier and the way out', () => {
  const budget = {
    name: 'max',
    label: 'max',
    source: 'test',
    policy: mode.MODES.max,
    bounds: { floor: null, ceiling: null, pin: false },
    directive: mode.directive('max'),
  };
  const binding = { key: 'seven_day_scoped:fable', label: 'weekly (Fable)', family: 'fable', percentUsed: 95, stale: false, turnsLeft: 6, headroomMs: 60 * 60 * 1000 };
  const text = brief.briefText({
    mode: budget,
    tier: 'Running opus/xhigh (this turn).',
    binding,
    pressure: 'tight',
    escape: { kind: 'model', family: 'fable', nextLabel: '5-hour', nextPercent: 20, suggest: 'opus', command: '/model opus' },
    host: 'claude',
    sessions: 1,
    critical: [],
    turnsLeft: 6,
    session: { turns: 40, tokens: 900000, cost: 12 },
    context: 200000,
    lastReply: { cost: 0.4 },
  });
  assert.match(text, /weekly \(Fable\)/);
  assert.match(text, /opus\/xhigh \(this turn\)/);
  assert.match(text, /\/model opus/);
  assert.match(text, /nearly gone/);
  // And it drops the standing furniture: the session totals, the context note
  // and the two reminders that read the same on every prompt.
  assert.ok(!/This session: 40 turns/.test(text));
  assert.ok(!/Quote the binding window/.test(text));
});

// The terse line drops the sentences that read the same on every prompt. The
// way out of a nearly-full window is not one of them, and below the wall the
// instruction does not carry it - so this is the case that proves it survives
// on its own, rather than being smuggled in by the instruction.
test('below the wall, the terse line still carries the way out', () => {
  const budget = {
    name: 'max', label: 'max', source: 'test', policy: mode.MODES.max,
    bounds: { floor: null, ceiling: null, pin: false }, directive: mode.directive('max'),
  };
  const binding = { key: 'seven_day_scoped:fable', label: 'weekly (Fable)', family: 'fable', percentUsed: 70, stale: false, turnsLeft: 40, headroomMs: 5 * 60 * 60 * 1000 };
  const text = brief.briefText({
    mode: budget,
    binding,
    pressure: 'roomy',
    escape: { kind: 'model', family: 'fable', nextLabel: '5-hour', nextPercent: 20, suggest: 'opus', command: '/model opus' },
    host: 'claude', sessions: 1, critical: [], turnsLeft: 40,
  });
  assert.match(text, /scoped to one model/, 'the escape sentence is gone from the terse line');
  assert.match(text, /\/model opus/);
});

// The tier belongs in the ordinary line too, not only the terse one. It was
// the number the briefing never printed.
test('the normal line states the tier as well', () => {
  const budget = {
    name: 'standard', label: 'standard', source: 'test', policy: mode.MODES.standard,
    bounds: { floor: null, ceiling: null, pin: false }, directive: null,
  };
  const text = brief.briefText({
    mode: budget,
    tier: 'Running sonnet/medium (this turn); your baseline is opus/xhigh.',
    binding: { key: 'five_hour', label: '5-hour', percentUsed: 30, stale: false, turnsLeft: 90 },
    pressure: 'roomy', host: 'claude', sessions: 1, critical: [], turnsLeft: 90,
  });
  assert.match(text, /Running sonnet\/medium \(this turn\)/);
  assert.match(text, /baseline is opus\/xhigh/);
});

// A fan-out is never throttled - it is said before every Agent call, because
// every one of them is about to cost. That is exactly why the mid-turn re-cost
// needs a throttle of its own: without one it would ride along with every
// single fan-out.
test('the re-cost keeps its own throttle even where the pulse has none', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-mode-fanout-'));
  const before = { dir: process.env.CLAUDE_CONFIG_DIR, host: process.env.USAGE_LIMITS_HOST, fetch: process.env.USAGE_LIMITS_FETCH };
  process.env.CLAUDE_CONFIG_DIR = dir;
  process.env.USAGE_LIMITS_HOST = 'claude';
  process.env.USAGE_LIMITS_FETCH = 'off';
  const pulse = require('../skills/usage-limits/scripts/pulse.js');
  const usage = require('../skills/usage-limits/scripts/usage.js');
  const real = { report: usage.report, escapeRoute: usage.escapeRoute };
  try {
    usage.report = async () => ({
      binding: { key: 'five_hour', label: '5-hour', percentUsed: 20, stale: false, turnsLeft: 200, headroomMs: 4 * 60 * 60 * 1000 },
      windows: [], sessions: [],
      effortRates: [
        { effort: 'xhigh', turns: 40, outputPerTurn: 3400, perTurn: 0.4 },
        { effort: 'medium', turns: 22, outputPerTurn: 1000, perTurn: 0.1 },
      ],
      effortNow: 'xhigh',
    });
    usage.escapeRoute = () => null;
    mode.main(['high']);
    const fanout = { session_id: 'F', hook_event_name: 'PreToolUse', tool_name: 'Agent' };
    const first = await pulse.run(NOW, fanout);
    assert.match(first, /Re-costed/);
    const second = await pulse.run(NOW + 10 * 1000, fanout);
    assert.match(second, /Before this fan-out/, 'the fan-out warning itself is never throttled');
    assert.ok(!/Re-costed/.test(second), 'but the re-cost is: it must not ride along with every agent call');
  } finally {
    Object.assign(usage, real);
    for (const [key, value] of [['CLAUDE_CONFIG_DIR', before.dir], ['USAGE_LIMITS_HOST', before.host], ['USAGE_LIMITS_FETCH', before.fetch]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The reading itself costs a request and a wait, so the mode that exists to
// spend as little as possible takes fewer of them.
test('max takes one reading where standard would take several', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-mode-cadence-'));
  const before = { dir: process.env.CLAUDE_CONFIG_DIR, host: process.env.USAGE_LIMITS_HOST, pulse: process.env.USAGE_LIMITS_PULSE, fetch: process.env.USAGE_LIMITS_FETCH };
  process.env.CLAUDE_CONFIG_DIR = dir;
  process.env.USAGE_LIMITS_HOST = 'claude';
  process.env.USAGE_LIMITS_PULSE = 'always';
  process.env.USAGE_LIMITS_FETCH = 'off';
  const pulse = require('../skills/usage-limits/scripts/pulse.js');
  const usage = require('../skills/usage-limits/scripts/usage.js');
  const realReport = usage.report;
  let scans = 0;
  try {
    usage.report = async () => {
      scans += 1;
      return { binding: { key: 'five_hour', label: '5-hour', percentUsed: 40, stale: false, turnsLeft: 60 }, windows: [], sessions: [] };
    };
    const call = (at, session) => pulse.run(at, { session_id: session, hook_event_name: 'PostToolUse', tool_name: 'Read' });

    mode.main(['max']);
    for (let minute = 0; minute <= 8; minute += 2) await call(NOW + minute * 60000, 'MAX');
    assert.strictEqual(scans, 1, 'max reads once in ten minutes, not five times');

    scans = 0;
    mode.main(['standard']);
    for (let minute = 0; minute <= 8; minute += 2) await call(NOW + minute * 60000, 'STD');
    assert.strictEqual(scans, 5, "standard keeps today's two-minute cadence");
  } finally {
    usage.report = realReport;
    for (const [key, value] of [['CLAUDE_CONFIG_DIR', before.dir], ['USAGE_LIMITS_HOST', before.host], ['USAGE_LIMITS_PULSE', before.pulse], ['USAGE_LIMITS_FETCH', before.fetch]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The mode's own appetite reaches the escape route. A lateral move is not a
// way out, so `standard` keeps the wide margin; the efficient modes act on a
// smaller improvement, because taking it is the whole point of being in them.
test("the escape route takes the mode's appetite for a switch", () => {
  const usage = require('../skills/usage-limits/scripts/usage.js');
  const binding = { key: 'seven_day_scoped:fable', label: 'weekly (Fable)', family: 'fable', percentUsed: 40, stale: false, applies: true };
  const other = { key: 'five_hour', label: '5-hour', family: null, percentUsed: 33, stale: false, applies: true };
  assert.strictEqual(
    usage.escapeRoute([binding, other], binding, null, 'claude', mode.MODES.standard),
    null,
    'seven points emptier is a lateral move, not a way out'
  );
  const eager = usage.escapeRoute([binding, other], binding, null, 'claude', mode.MODES.max);
  assert.ok(eager, 'max acts on the smaller improvement');
  assert.strictEqual(eager.kind, 'model');
  // And with no mode at all the old, wider margin still applies.
  assert.strictEqual(usage.escapeRoute([binding, other], binding, null, 'claude'), null);
});

// A change log whose entries are not an array at all - not a truncation, a
// different shape. The parse succeeds, so nothing catches it for us.
test('a change log with the wrong shape entirely is still safe to read', () =>
  withConfigDir((dir) => {
    fs.writeFileSync(path.join(dir, 'usage-limits-changes.json'), '{"entries": {"a": 1}}');
    assert.deepStrictEqual(mode.readChanges(), { entries: [], unreadable: true });
    assert.match(mode.history(NOW), /could not be read/);
  }));

// The status line says which mode it is in - but only when it is not the one
// the plugin has always been in. `standard` is today's behaviour and today's
// line, unchanged to the character, and a token there would be a word every
// user pays for to be told nothing has changed.
test('the status line carries the mode, and only when it is worth carrying', () => {
  const view = require('../skills/usage-limits/scripts/view.js');
  const feed = require('../skills/usage-limits/scripts/feed.js');
  const built = (budget) =>
    view.build({
      now: NOW,
      budget,
      utilization: {
        five_hour: { utilization: 40, resets_at: new Date(NOW + 3600000).toISOString() },
        seven_day: { utilization: 12, resets_at: new Date(NOW + 30 * 3600000).toISOString() },
      },
      fetchedAtMs: NOW,
      source: 'api',
      model: 'claude-opus-4-5',
      effort: 'high',
      env: {},
    });
  const drawn = { columns: 200, mode: 'none', tick: 0 };
  assert.match(feed.line(built({ name: 'max', label: 'max' }), drawn), /budget max/);
  assert.match(feed.line(built({ name: 'off', label: 'off' }), drawn), /budget off/);
  assert.match(feed.line(built({ name: 'standard', label: 'auto -> standard' }), drawn), /^(?!.*budget).*$/s);
  assert.match(feed.line(built(null), drawn), /^(?!.*budget).*$/s);
  // And it is dropped with the head when the terminal is too narrow, before it
  // can cost a percentage its place on the line.
  const narrow = feed.line(built({ name: 'max', label: 'max' }), { columns: 30, mode: 'none', tick: 0 });
  assert.ok(narrow.indexOf('budget') === -1, 'the mode token outlived the model name on a narrow line');
  assert.match(narrow, /\d+%/, 'and the percentage survived');
});

// Somebody has to be able to say no. Without a verb for it, "a declined
// recommendation is never raised again" is a promise with no way to keep it.
test('a decline can be recorded by id, and by "the one you just made"', () =>
  withConfigDir(() => {
    const id = mode.adviceId(FIT);
    assert.match(mode.main(['--decline', id]), /will not be suggested again/);
    assert.strictEqual(mode.advicePending({ decided: mode.resolve({}), fit: FIT, sessionId: 'S' }).reason, 'declined before');
    // And it is in the change log, so "why did it stop suggesting that" has an
    // answer.
    assert.match(mode.history(NOW), /declined/);
    // With nothing pending and no id, it says so rather than declining
    // something nobody offered.
    assert.match(mode.main(['--decline']), /nothing pending/);
  }));

// The guard is the one line `off` will ever emit, and there is no second line
// to correct it, so it has to read the same windows every other reader reads.
//
// It used to read `utilization.limits` alone. That array is the account's own
// description of its limits and it is optional: every fixture here, and every
// other reader in the plugin, works from the top-level five_hour/seven_day
// keys. On that payload the guard was silent at 97 per cent used - in the mode
// where a silent cutoff is the whole thing it exists to prevent.
test('the guard reads the snapshot every other reader reads', () =>
  withConfigDir(() => {
    const usage = require('../skills/usage-limits/scripts/usage.js');
    const realCollect = usage.collect;
    // No `limits` array at all: only the bucket keys.
    const at = (percent) => ({
      utilization: {
        five_hour: { utilization: percent, resets_at: new Date(NOW + 3600000).toISOString() },
      },
      snapshotFetchedAt: NOW,
      settings: {},
      windowSpecs: null,
    });
    try {
      usage.collect = () => at(97);
      const said = brief.guardLine(NOW, { guardPercent: 95 });
      assert.match(said, /97% used/, 'the guard fires on the shape everything else calls primary');
      // And it says "5-hour", not "five_hour". A raw key in the single
      // sentence this mode is allowed is the plugin talking to itself.
      assert.match(said, /5-hour is 97% used/);
      assert.doesNotMatch(said, /five_hour/);
      usage.collect = () => at(80);
      assert.strictEqual(brief.guardLine(NOW, { guardPercent: 95 }), '');
    } finally {
      usage.collect = realCollect;
    }
  }));

// A per-model weekly for a model this session is not running cannot be the
// window that stops the work, so it must not be the thing that fires the guard
// either. Without this the guard cried wolf at 99 per cent on an Opus weekly
// at a user with 80 per cent of their real budget still there - and in `off`
// there is nothing else said all session to take it back.
test('the guard does not fire on a window this session cannot spend into', () =>
  withConfigDir(() => {
    const usage = require('../skills/usage-limits/scripts/usage.js');
    const realCollect = usage.collect;
    try {
      usage.collect = () => ({
        utilization: {
          five_hour: { utilization: 12, resets_at: new Date(NOW + 3600000).toISOString() },
          seven_day: { utilization: 20, resets_at: new Date(NOW + 6 * 86400000).toISOString() },
          seven_day_opus: { utilization: 99, resets_at: new Date(NOW + 6 * 86400000).toISOString() },
        },
        snapshotFetchedAt: NOW,
        // Running Sonnet, so the Opus weekly is not this session's constraint.
        settings: { model: 'claude-sonnet-4-5-20250929' },
        windowSpecs: null,
      });
      assert.strictEqual(
        brief.guardLine(NOW, { guardPercent: 95 }),
        '',
        'a weekly for a model this session is not running is not a reason to speak'
      );
      // And when it IS the model in use, the same window does fire.
      const realCollect2 = usage.collect;
      const inner = realCollect2();
      usage.collect = () => Object.assign({}, inner, { settings: { model: 'claude-opus-4-6-20260115' } });
      assert.match(brief.guardLine(NOW, { guardPercent: 95 }), /99% used/);
    } finally {
      usage.collect = realCollect;
    }
  }));

// `off` is a promise about cost, not only about what is injected, and the Stop
// hook was the expensive one still running: it read the whole transcript after
// every reply - 2.77 MB on the session that measured it - wrote two state
// files and printed a line, in the mode documented as "the hooks return before
// reading anything: no scan, no state write, no line".
test('off stops the end-of-reply hooks too, not only the injected ones', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-mode-off-hooks-'));
  const before = { dir: process.env.CLAUDE_CONFIG_DIR, host: process.env.USAGE_LIMITS_HOST };
  process.env.CLAUDE_CONFIG_DIR = dir;
  process.env.USAGE_LIMITS_HOST = 'claude';
  const stop = require('../skills/usage-limits/scripts/stop.js');
  const sessionend = require('../skills/usage-limits/scripts/sessionend.js');
  const tally = require('../skills/usage-limits/scripts/tally.js');
  const realUpdate = tally.update;
  let scans = 0;
  try {
    const transcript = path.join(dir, 'transcript.jsonl');
    fs.writeFileSync(transcript, '');
    tally.update = (...args) => {
      scans += 1;
      return realUpdate(...args);
    };
    const input = { session_id: 'Z', transcript_path: transcript, hook_event_name: 'Stop', cwd: dir };

    mode.main(['standard']);
    await stop.run(NOW, input);
    assert.ok(scans > 0, 'standard is unchanged: it still reads the transcript');

    // Clear what `standard` legitimately wrote, so what follows is measuring
    // `off` rather than the run before it.
    scans = 0;
    for (const name of ['usage-limits-sessions.json', 'usage-limits-activity.json']) {
      fs.rmSync(path.join(dir, name), { force: true });
    }
    mode.main(['off']);
    assert.strictEqual(await stop.run(NOW, input), '', 'no line');
    assert.strictEqual(await sessionend.run(NOW, Object.assign({}, input, { hook_event_name: 'SessionEnd' })), '', 'and none at the close');
    assert.strictEqual(scans, 0, 'and no transcript read to get there');
    assert.ok(
      !fs.existsSync(path.join(dir, 'usage-limits-sessions.json')),
      'and no state written'
    );
    assert.ok(!fs.existsSync(path.join(dir, 'usage-limits-activity.json')));
  } finally {
    tally.update = realUpdate;
    for (const [key, value] of [['CLAUDE_CONFIG_DIR', before.dir], ['USAGE_LIMITS_HOST', before.host]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Setting off says so, because a user who notices the cost line has vanished
// should not have to go looking for why.
test('setting off names the hooks it stops', () =>
  withConfigDir(() => {
    const said = mode.main(['off']);
    assert.match(said, /no end-of-reply cost line/);
    assert.match(said, /panel will not animate/);
  }));

// "Change my effort back" needs a referent, and the only thing in this plugin
// that writes settings.json was the one change the log could not name: every
// logChange call site was in mode.js, so `mode --history` answered "nothing has
// been changed through this plugin yet" immediately after the user's baseline
// had been rewritten, and undo's whole user-plane branch was unreachable.
test('a settings.json write is written down, and undo can name it', () =>
  withConfigDir((dir) => {
    const lowpower = require('../skills/usage-limits/scripts/lowpower.js');
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ effortLevel: 'xhigh' }));
    const quiet = process.stdout.write;
    process.stdout.write = () => true;
    try {
      lowpower.main(['on', '--effort', 'low']);
    } finally {
      process.stdout.write = quiet;
    }

    const log = mode.readChanges();
    const entry = log.entries[log.entries.length - 1];
    assert.strictEqual(entry.plane, 'user', 'it is the user plane, and it is recorded as such');
    assert.strictEqual(entry.key, 'effortLevel');
    assert.strictEqual(entry.from, 'xhigh');
    assert.strictEqual(entry.to, 'low');

    assert.match(mode.history(NOW), /effortLevel: xhigh -> low/);

    // And undo names it and the command that reverses it, without writing the
    // file itself: the user plane is the user's.
    const answer = mode.undo(Date.now());
    assert.strictEqual(answer.ok, false);
    assert.match(answer.text, /lowpower\.js off/);
    assert.strictEqual(
      JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).effortLevel,
      'low',
      'undo reports, it does not write'
    );
  }));

// The other direction. Naming "lowpower off" after a restore would be telling
// the user to run the thing they just ran.
test('undo names the command that actually reverses the change', () =>
  withConfigDir((dir) => {
    const lowpower = require('../skills/usage-limits/scripts/lowpower.js');
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ effortLevel: 'xhigh' }));
    const quiet = process.stdout.write;
    process.stdout.write = () => true;
    try {
      lowpower.main(['on', '--effort', 'low']);
      lowpower.main(['off']);
    } finally {
      process.stdout.write = quiet;
    }
    const answer = mode.undo(Date.now());
    assert.match(answer.text, /lowpower\.js on --effort low/);
  }));

// The half of the re-cost that is not a settings recommendation - "this window
// will stop you, and here is the lever that frees it" - is not capped at one
// per session, because it is about the binding window rather than about the
// user's habits. So it is the half that would repeat forever on the throttle
// alone, and it is where the unchanged-guard has to hold.
//
// Measured before the guard: fifteen byte-identical injections, 5,550
// characters, in one thirty-minute turn at 20 per cent used.
test('the re-cost does not repeat itself while nothing has changed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-mode-recheck-quiet-'));
  const before = { dir: process.env.CLAUDE_CONFIG_DIR, host: process.env.USAGE_LIMITS_HOST, fetch: process.env.USAGE_LIMITS_FETCH };
  process.env.CLAUDE_CONFIG_DIR = dir;
  process.env.USAGE_LIMITS_HOST = 'claude';
  process.env.USAGE_LIMITS_FETCH = 'off';
  const pulse = require('../skills/usage-limits/scripts/pulse.js');
  const usage = require('../skills/usage-limits/scripts/usage.js');
  const real = { report: usage.report, escapeRoute: usage.escapeRoute };
  let to = 'medium';
  try {
    usage.report = async () => ({
      binding: { key: 'five_hour', label: '5-hour', percentUsed: 20, stale: false, turnsLeft: 200, headroomMs: 4 * 60 * 60 * 1000 },
      // No measured table, so the recommendation half is not in play at all
      // and what is left is purely the escape.
      windows: [], sessions: [], effortRates: [], effortNow: 'xhigh',
    });
    usage.escapeRoute = () => ({ kind: 'effort', from: 'xhigh', to, multiple: 3, command: '/effort ' + to });
    mode.main(['high']);
    const call = (at) => pulse.run(at, { session_id: 'Q', hook_event_name: 'PostToolUse', tool_name: 'Edit' });

    assert.match(await call(NOW), /would free the window that binds/);
    // Half an hour of tool calls, every one of them past the two-minute
    // throttle, and not one repeat.
    let spoke = 0;
    for (let minute = 2; minute <= 30; minute += 2) {
      if (await call(NOW + minute * 60000)) spoke += 1;
    }
    assert.strictEqual(spoke, 0, 'the same sentence is not worth saying fifteen times');

    // Still alive: when the answer changes, it says the new one.
    to = 'low';
    assert.match(await call(NOW + 32 * 60000), /\/effort low/);
  } finally {
    Object.assign(usage, real);
    for (const [key, value] of [['CLAUDE_CONFIG_DIR', before.dir], ['USAGE_LIMITS_HOST', before.host], ['USAGE_LIMITS_FETCH', before.fetch]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The bounds are the user's, and they govern the escape half of the re-cost as
// much as the recommendation half: a way out that points below the floor they
// set is a suggestion they have already refused.
test('the re-cost will not point below the bound the user set', async () => {
  const drive = async (setup) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-mode-recheck-bound-'));
    const before = { dir: process.env.CLAUDE_CONFIG_DIR, host: process.env.USAGE_LIMITS_HOST, fetch: process.env.USAGE_LIMITS_FETCH };
    process.env.CLAUDE_CONFIG_DIR = dir;
    process.env.USAGE_LIMITS_HOST = 'claude';
    process.env.USAGE_LIMITS_FETCH = 'off';
    const pulse = require('../skills/usage-limits/scripts/pulse.js');
    const usage = require('../skills/usage-limits/scripts/usage.js');
    const real = { report: usage.report, escapeRoute: usage.escapeRoute };
    try {
      usage.report = async () => ({
        binding: { key: 'five_hour', label: '5-hour', percentUsed: 20, stale: false, turnsLeft: 200, headroomMs: 4 * 60 * 60 * 1000 },
        windows: [], sessions: [], effortRates: [], effortNow: 'xhigh',
      });
      usage.escapeRoute = () => ({ kind: 'effort', from: 'xhigh', to: 'medium', multiple: 3, command: '/effort medium' });
      mode.main(['high']);
      setup();
      return await pulse.run(NOW, { session_id: 'B', hook_event_name: 'PostToolUse', tool_name: 'Edit' });
    } finally {
      Object.assign(usage, real);
      for (const [key, value] of [['CLAUDE_CONFIG_DIR', before.dir], ['USAGE_LIMITS_HOST', before.host], ['USAGE_LIMITS_FETCH', before.fetch]]) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  assert.match(await drive(() => {}), /\/effort medium/, 'with no bound set it names the way out');
  assert.strictEqual(await drive(() => mode.main(['--floor', 'high'])), '', 'below the floor, it says nothing');
});

test('the tier line asks for a decision only when the tier is dear', () => {
  // MODEL_ORDER runs CHEAPEST first (haiku, sonnet, opus, mythos, fable), so
  // the dear end is a HIGH rank. The first version compared <= 1 and so asked
  // haiku to justify itself while letting opus through silently - the exact
  // inverse of the point, and invisible without this test because tierLine
  // reads the live session tier rather than its arguments.
  assert.equal(mode.topTier('opus', 'low'), true, 'opus is dear on its own');
  assert.equal(mode.topTier('mythos', 'medium'), true);
  assert.equal(mode.topTier('fable', 'low'), true);
  assert.equal(mode.topTier('sonnet', 'xhigh'), true, 'xhigh is dear on its own');
  assert.equal(mode.topTier('haiku', 'max'), true);
  assert.equal(mode.topTier('haiku', 'low'), false, 'nothing to decide here');
  assert.equal(mode.topTier('sonnet', 'medium'), false);
  assert.equal(mode.topTier(null, null), false, 'an unknown tier is not a prompt');
});

test('ultracode is reported as ultracode, not as the xhigh it resolves to', () => {
  // Ultracode RESOLVES to xhigh, so every effort reader honestly reports xhigh
  // and the display said xhigh at somebody who had asked for ultracode. Same
  // reasoning, very different everything else, and no way to tell it took.
  //
  // The flag was already being recorded on the session's activity mark by
  // brief.js and simply never read back.
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-uc-'));
  try {
    const activity = require('../skills/usage-limits/scripts/activity.js');
    const now = Date.now();
    activity.mark('working', 'asked-for-it', { ultracode: true }, now);
    activity.mark('working', 'did-not', { ultracode: false }, now);

    assert.equal(mode.ultracodeName('xhigh', 'asked-for-it', now), 'ultracode');
    assert.equal(mode.ultracodeName('xhigh', 'did-not', now), 'xhigh');
    // Only xhigh is renamed: calling a HIGHER effort "ultracode" would be a
    // downgrade dressed up as a label.
    assert.equal(mode.ultracodeName('max', 'asked-for-it', now), 'max');
    assert.equal(mode.ultracodeName('high', 'asked-for-it', now), 'high');
    // And it never invents one.
    assert.equal(mode.ultracodeName('xhigh', null, now), 'xhigh');
    assert.equal(mode.ultracodeName('xhigh', 'never-seen', now), 'xhigh');
    assert.equal(mode.ultracodeName(null, 'asked-for-it', now), null);
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
  }
});
