'use strict';

// The stopping decision, checked exhaustively rather than by spot-reading.
//
// The complaint about this plugin was specific: under Codex it "doesn't stop
// at a good stopping point", and it "just makes a plan". Both are failures of
// one decision - what the budget line tells the agent to DO - and that decision
// now has six inputs: how full the binding window is, whether that window is
// scoped to a model or shared by the account, which host is reading, whether a
// relay is armed, whether a cheaper lever exists, and which budget mode the
// plugin is in.
//
// Six inputs is far too many to spot-check. Walking the whole product found a
// real bug the first time it was tried (a spent shared window telling the agent
// it was "not out of budget" because a cheaper effort existed), so it is a
// matrix here rather than a handful of cases, and the invariants are stated as
// rules the whole matrix must satisfy.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const brief = require('../skills/usage-limits/scripts/brief.js');
const usage = require('../skills/usage-limits/scripts/usage.js');
const mode = require('../skills/usage-limits/scripts/mode.js');

const NOW = Date.parse('2026-09-08T23:00:00.000Z');
const CONFIG = { near: 90, floor: 40, ahead: 15, cacheSeconds: 60, fewTurns: 10, runwayMinutes: 10, refreshSeconds: 180 };

const other = { key: 'seven_day', label: 'weekly', family: null, percentUsed: 30, stale: false, applies: true };

function windowAt(percent, family) {
  return {
    key: family ? 'seven_day_scoped:' + family : 'five_hour',
    label: family ? 'weekly (' + family + ')' : '5-hour',
    family: family || null,
    percentUsed: percent,
    percentLeft: 100 - percent,
    stale: false,
    applies: true,
    resetsAt: NOW + 90 * 60 * 1000,
    turnsLeft: Math.max(0, Math.round((100 - percent) * 1.2)),
    headroomMs: Math.max(0, (100 - percent) * 60 * 1000),
    usdPerPercent: 0.5,
  };
}

// A decided mode, as the hook hands it to the renderer. Built from the policy
// table rather than restated here, so a change to the table is a change to what
// this matrix checks.
function decided(name) {
  return {
    name,
    label: name,
    source: 'test',
    policy: mode.MODES[name],
    bounds: { floor: null, ceiling: null, pin: false },
    directive: mode.directive(name),
  };
}

// Every combination that can reach a reader.
const PERCENTS = [10, 50, 70, 80, 88, 90, 92, 95, 97, 100];
const FAMILIES = [null, 'fable'];
const HOSTS = ['claude', 'codex'];
const EFFORTS = [null, { effort: 'high', cheaper: { effort: 'medium', multiple: 4 } }];
const RELAYS = [null, { armed: { wakeAt: NOW + 3e6, mode: 'notify', continuation: true, warning: null }, config: { graceMinutes: 5 } }];

function* matrix() {
  for (const percent of PERCENTS) {
    for (const family of FAMILIES) {
      for (const host of HOSTS) {
        for (const effortNote of EFFORTS) {
          for (const relay of RELAYS) {
            const binding = windowAt(percent, family);
            const pressure = brief.pressure(binding, NOW, CONFIG, binding.turnsLeft);
            const base = `${percent}% ${family || 'shared'} host=${host} effort=${effortNote ? 'cheaper' : 'none'} relay=${relay ? 'armed' : 'off'}`;
            for (const name of mode.ORDER) {
              const budget = decided(name);
              // The mode reaches escapeRoute too: it carries how much emptier
              // another window has to be before a switch is worth naming.
              const escape = usage.escapeRoute([binding, other], binding, effortNote, host, budget.policy);
              const text = brief.briefText({
                binding, pressure, escape, relay, host, sessions: 1, critical: [],
                turnsLeft: binding.turnsLeft, effortWarning: effortNote,
                mode: budget,
                tier: 'Running opus/high (settings).',
              });
              yield { percent, family, host, effortNote, relay, binding, escape, pressure, text,
                mode: name, base, where: base + ' mode=' + name };
            }
          }
        }
      }
    }
  }
}

const says = (c, re) => re.test(c.text);
const STOPS = /nothing further will run/;
const CARRY_ON = /must not stop as though you were/;
// `off` says nothing at all, by design. Every invariant about what the line
// SAYS is therefore about the three modes that speak; that off says nothing is
// its own invariant, below, and it is the strongest one here.
const speaking = (c) => c.mode !== 'off';

test('it never tells a spent shared window that it still has budget', () => {
  for (const c of matrix()) {
    if (c.pressure !== 'gone' || c.family) continue;
    assert.ok(!says(c, CARRY_ON), 'a spent shared window claimed budget it does not have: ' + c.where);
  }
});

test('a spent model-scoped window is offered the switch, never a plain stop', () => {
  for (const c of matrix()) {
    if (c.pressure !== 'gone' || !c.family || !speaking(c)) continue;
    // The escape only exists when another window is genuinely emptier, which
    // is true throughout this matrix (the other window sits at 30).
    assert.ok(says(c, CARRY_ON), 'a model-scoped window is one model\'s budget, not the account\'s: ' + c.where);
    assert.ok(!says(c, STOPS), 'it must not say nothing further will run: ' + c.where);
  }
});

test('it never contradicts itself in one line', () => {
  for (const c of matrix()) {
    assert.ok(!(says(c, STOPS) && says(c, CARRY_ON)), 'both stop and carry on: ' + c.where);
  }
});

// "It just makes a plan." Below the wall, writing a handoff instead of working
// is the failure; the instruction there must be to get on with the work.
test('below the wall it never asks for a handoff instead of the work', () => {
  for (const c of matrix()) {
    if (c.percent >= 90 || !speaking(c)) continue;
    assert.strictEqual(c.pressure, 'roomy', 'the wall is 90 and nothing below it escalates: ' + c.where);
    assert.ok(says(c, /get on with the work/), 'below the wall the instruction is the work: ' + c.where);
    assert.ok(!says(c, /write the handoff/), 'no handoff is asked for below the wall: ' + c.where);
  }
});

// The commands must exist in the host being spoken to. /model and /effort do
// not exist in Codex; naming them there is telling it to do nothing.
test('no mode ever names a Claude Code command to Codex', () => {
  for (const c of matrix()) {
    if (c.host !== 'codex') continue;
    assert.ok(!says(c, /\/model\b/), 'named /model to Codex: ' + c.where);
    assert.ok(!says(c, /\/effort\b/), 'named /effort to Codex: ' + c.where);
  }
});

test('under Claude Code the lever is a command that can actually be typed', () => {
  for (const c of matrix()) {
    if (c.host !== 'claude' || !c.escape || !speaking(c)) continue;
    if (c.binding.percentUsed < 50) continue;
    assert.ok(says(c, /\/model |\/effort /), 'an escape with no usable command: ' + c.where);
  }
});

// A relay changes what being cut off costs, so at the wall it must change the
// instruction from "stop" to "keep working and write the continuation".
test('an armed relay never leaves a stop instruction standing alone', () => {
  for (const c of matrix()) {
    if (!c.relay || c.pressure === 'roomy' || !speaking(c)) continue;
    assert.ok(says(c, /relay/i), 'the relay is armed and unmentioned: ' + c.where);
    if (says(c, STOPS)) {
      assert.ok(says(c, /relay note|acted on when the window reopens/i),
        'told to stop with a relay armed and no word on the continuation: ' + c.where);
    }
  }
});

test('no reachable combination produces an empty or malformed instruction', () => {
  let seen = 0;
  let spoke = 0;
  for (const c of matrix()) {
    seen += 1;
    if (!speaking(c)) continue;
    spoke += 1;
    assert.ok(c.text && c.text.length > 80, 'empty instruction: ' + c.where);
    assert.ok(!/undefined|NaN|null|\[object/.test(c.text), 'a value leaked into the line: ' + c.where + '\n' + c.text);
  }
  assert.strictEqual(seen, PERCENTS.length * FAMILIES.length * HOSTS.length * EFFORTS.length * RELAYS.length * mode.ORDER.length);
  assert.strictEqual(seen, 640);
  assert.strictEqual(spoke, 480);
});

// ---------------------------------------------------------------------------
// The mode invariants

// The whole promise of `off`, and the reason it is a mode rather than a
// setting: not a shorter line, no line.
test('in off, nothing is injected at any percent, at any pressure', () => {
  let seen = 0;
  for (const c of matrix()) {
    if (c.mode !== 'off') continue;
    seen += 1;
    assert.strictEqual(c.text, '', 'off injected something at ' + c.where);
  }
  assert.strictEqual(seen, 160, 'every combination was checked in off');
});

// The irony rule, as a test. A mode that saves tokens by injecting a lecture
// about saving tokens has saved nothing, and this is the one number that can
// prove it did not happen.
test('max\'s line is never longer than standard\'s for the same reading', () => {
  const byBase = new Map();
  for (const c of matrix()) {
    const row = byBase.get(c.base) || {};
    row[c.mode] = c.text;
    byBase.set(c.base, row);
  }
  for (const [base, row] of byBase) {
    assert.ok(
      row.max.length <= row.standard.length,
      'max is the expensive one at ' + base + ': ' + row.max.length + ' characters against standard\'s ' +
        row.standard.length + '\n---max---\n' + row.max + '\n---standard---\n' + row.standard
    );
  }
});

// The rule that matters more than any saving: when things are tight you change
// the ORDER of the work, never the amount or the quality.
test('no mode\'s text ever tells the agent to do the work worse', () => {
  const forbidden = [
    /skip the tests?/i,
    /good enough/i,
    /less thoroughly/i,
    /do less thorough/i,
    /cut corners/i,
    /lower the quality/i,
    /skip the hard part/i,
    /shrink the request/i,
  ];
  for (const c of matrix()) {
    for (const phrase of forbidden) {
      assert.ok(!phrase.test(c.text), 'the line tells the agent to do the job worse (' + phrase + '): ' + c.where);
    }
  }
});

// Terseness may cost the table. It may not cost the wall.
test('at the wall, every mode except off still says something', () => {
  for (const c of matrix()) {
    if (c.pressure === 'roomy') continue;
    if (c.mode === 'off') {
      assert.strictEqual(c.text, '', 'off is off, including at the wall: ' + c.where);
      continue;
    }
    assert.ok(c.text.length > 120, 'the wall went unsaid: ' + c.where);
    assert.ok(
      says(c, STOPS) || says(c, CARRY_ON) || says(c, /nearly gone/),
      'at the wall the line must still say what to do: ' + c.where + '\n' + c.text
    );
  }
});

// The two-planes rule, as a test, and the one that must never go green by
// accident: the whole matrix is rendered and every CLI path is exercised, then
// the user's own file is compared byte for byte.
test('no mode writes settings.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-planes-'));
  const before = { dir: process.env.CLAUDE_CONFIG_DIR, host: process.env.USAGE_LIMITS_HOST };
  process.env.CLAUDE_CONFIG_DIR = dir;
  process.env.USAGE_LIMITS_HOST = 'claude';
  const settings = path.join(dir, 'settings.json');
  const original = JSON.stringify({ model: 'opus', effortLevel: 'xhigh' }, null, 2) + '\n';
  fs.writeFileSync(settings, original, 'utf8');
  try {
    // Every line the modes can produce.
    for (const c of matrix()) assert.ok(typeof c.text === 'string');
    // And every way of setting one.
    const paths = [[], ['--list'], ['auto'], ['auto', 'off'], ['off', '--guard', '95'], ['--pin'], ['--no-pin'],
      ['--floor', 'sonnet/medium'], ['--ceiling', 'opus/xhigh'], ['--advice'], ['--no-advice'], ['--advice-on'],
      ['--history'], ['--ledger'], ['--baseline'], ['undo'], ['normal']];
    for (const name of mode.ORDER.concat(Object.keys(mode.ALIASES))) paths.push([name]);
    for (const argv of paths) mode.main(argv);
    assert.strictEqual(fs.readFileSync(settings, 'utf8'), original, 'the user\'s own baseline was written to');
  } finally {
    if (before.dir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before.dir;
    if (before.host === undefined) delete process.env.USAGE_LIMITS_HOST;
    else process.env.USAGE_LIMITS_HOST = before.host;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The user's bounds outrank the mode's appetite. In max - the most eager mode
// there is - with a floor of opus/high, nothing the line says may point below
// opus/high.
test('floor and ceiling are respected, even in max', () => {
  const bounds = { floor: { model: 'opus', effort: 'high' }, ceiling: null, pin: false };
  const budget = Object.assign(decided('max'), { bounds });
  const below = /\bsonnet\b|\bhaiku\b|\/effort (low|medium)\b|\bmedium\b|\blow\b/i;
  for (const percent of PERCENTS) {
    for (const family of FAMILIES) {
      const binding = windowAt(percent, family);
      const effortNote = { effort: 'high', cheaper: { effort: 'medium', multiple: 4 } };
      const escape = usage.escapeRoute([binding, other], binding, effortNote, 'claude', budget.policy);
      const text = brief.briefText({
        binding,
        pressure: brief.pressure(binding, NOW, CONFIG, binding.turnsLeft),
        escape,
        host: 'claude',
        sessions: 1,
        critical: [],
        turnsLeft: binding.turnsLeft,
        effortWarning: effortNote,
        fit: { effort: 'xhigh', sample: 40, cheaper: 'medium', cheaperSample: 20, multiple: 3, command: '/effort medium' },
        mode: budget,
      });
      assert.ok(!below.test(text), 'pointed below the floor the user set at ' + percent + '% ' + (family || 'shared') + ':\n' + text);
      assert.match(text, /never below opus\/high/, 'and the bound itself is stated, so the agent knows why');
    }
  }
});

// Pinned is the pure form of "the user wants to decide this themselves": the
// plugin observes, reports the gap, and keeps its hands off.
test('pin produces reporting language only, never an instruction to switch', () => {
  const bounds = { floor: null, ceiling: null, pin: true };
  for (const name of ['max', 'high', 'standard']) {
    const budget = Object.assign(decided(name), { bounds });
    for (const percent of [50, 90, 95, 100]) {
      const binding = windowAt(percent, 'fable');
      const escape = usage.escapeRoute([binding, other], binding, null, 'claude', Object.assign({}, budget.policy, { pin: true }));
      const text = brief.briefText({
        binding,
        pressure: brief.pressure(binding, NOW, CONFIG, binding.turnsLeft),
        escape,
        host: 'claude',
        sessions: 1,
        critical: [],
        turnsLeft: binding.turnsLeft,
        mode: budget,
      });
      const where = name + ' at ' + percent + '%';
      assert.ok(!/Do that, say in one line that you switched/.test(text), 'instructed a switch while pinned: ' + where);
      assert.ok(!/You may make that change yourself/.test(text), 'invited a switch while pinned: ' + where);
      assert.match(text, /pinned/i, 'and it says why it is only reporting: ' + where);
    }
  }
});
