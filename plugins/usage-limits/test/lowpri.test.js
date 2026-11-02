'use strict';

// Claude Code's own wall-time features, as far as a hook can actually read
// them: /low-priority, the manual session reset, the graceful wrap-up note,
// usage credits, and the CLI's own auto-continue past a reset.
//
// The rule every test here is defending: the plugin reports what is READABLE
// and nothing else. It never claims low-priority is on, never invents
// Anthropic's copy, and never advertises a command this account does not have.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const T = Date.UTC(2026, 8, 25, 21, 0, 0);

// Every test gets its own CLAUDE_CONFIG_DIR and deletes it again, including
// when the body throws: 2,774 folders leaked out of this suite once already.
function isolated(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ul-lowpri-'));
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

// The same, for a body that awaits. A synchronous isolated() would restore the
// environment and delete the directory the moment the body returned its
// promise - which is before the code under test has read anything, so the run
// would quietly use the real machine's state and write into the real ~/.claude.
async function isolatedAsync(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ul-lowpri-'));
  const before = { dir: process.env.CLAUDE_CONFIG_DIR, fetch: process.env.USAGE_LIMITS_FETCH };
  process.env.CLAUDE_CONFIG_DIR = dir;
  // No network call: this test is about one sentence, not a live reading.
  // CODEX_HOME is deliberately left alone - setting it would make host.detect()
  // call this a Codex session and brief Codex's (absent) meter instead.
  process.env.USAGE_LIMITS_FETCH = 'off';
  try {
    return await fn(dir);
  } finally {
    for (const [key, value] of [['CLAUDE_CONFIG_DIR', before.dir], ['USAGE_LIMITS_FETCH', before.fetch]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function fresh(name) {
  delete require.cache[require.resolve('../skills/usage-limits/scripts/' + name + '.js')];
  return require('../skills/usage-limits/scripts/' + name + '.js');
}

// The shape ~/.claude.json really has on this machine, trimmed to what these
// functions read. cachedUsageUtilization has to be present or the account
// reader falls through to the real home file, exactly as usage.js does.
function account(extra) {
  return Object.assign(
    {
      cachedUsageUtilization: { fetchedAtMs: T, utilization: { five_hour: { utilization: 0.9 } } },
      cachedGrowthBookFeatures: {},
    },
    extra || {}
  );
}

// The literal payload read off C:/Users/OWNER/.claude.json on 2026-09-25.
const TOASTY = {
  enabled: true,
  version: 3,
  label: 'Continue now at lower priority',
  noticeLine: '/low-priority to continue now at lower priority \u00b7 uses your weekly limit',
  statusLine: 'Lower priority until {reset}',
  allowanceNote: '{percent} allowance left',
  cooloffMinutes: 10,
  waitBanner: 'Working at lower priority \u00b7 waiting for capacity',
  budgetExhaustedCopy: "You've used this week's lower-priority allowance",
};

const FIVE_HOUR = { key: 'five_hour', label: '5-hour', percentUsed: 96, stale: false, applies: true, resetsAt: T + HOUR, turnsLeft: 3 };
const WEEKLY = { key: 'seven_day', label: 'weekly', percentUsed: 40, stale: false, applies: true, resetsAt: T + 2 * DAY, turnsLeft: 400 };

test('the offer is read from tengu_toasty_breeze, and a missing key is "not offered" rather than "off"', () => {
  const lowpri = fresh('lowpri');

  const on = lowpri.offer(account({ cachedGrowthBookFeatures: { tengu_toasty_breeze: TOASTY } }));
  assert.strictEqual(on.known, true);
  assert.strictEqual(on.offered, true);
  assert.strictEqual(on.cooloffMinutes, 10);
  assert.strictEqual(on.version, 3);
  // The server ships the wording; the plugin carries it rather than writing
  // its own, because Anthropic can change it.
  assert.strictEqual(on.noticeLine, TOASTY.noticeLine);
  assert.strictEqual(on.budgetExhaustedCopy, TOASTY.budgetExhaustedCopy);

  const absent = lowpri.offer(account());
  assert.strictEqual(absent.known, false, 'the key was never seen');
  assert.strictEqual(absent.offered, false);

  const off = lowpri.offer(account({ cachedGrowthBookFeatures: { tengu_toasty_breeze: { enabled: false } } }));
  assert.strictEqual(off.known, true);
  assert.strictEqual(off.offered, false);

  // Nothing readable at all is still an answer, not a throw.
  assert.strictEqual(lowpri.offer(null).offered, false);
  assert.strictEqual(lowpri.offer(null).known, false);
});

test('the offer never invents copy the server did not send', () => {
  const lowpri = fresh('lowpri');
  const bare = lowpri.offer(account({ cachedGrowthBookFeatures: { tengu_toasty_breeze: { enabled: true } } }));
  assert.strictEqual(bare.offered, true);
  assert.strictEqual(bare.noticeLine, null);
  assert.strictEqual(bare.budgetExhaustedCopy, null);
  // The cooloff is the one number with a documented client default.
  assert.strictEqual(bare.cooloffMinutes, lowpri.DEFAULT_COOLOFF_MINUTES);
});

test('the account snapshot is the file that carries a meter, the way usage.js picks it', () =>
  isolated((dir) => {
    const lowpri = fresh('lowpri');
    // A migration stub with no meter must not answer "offered".
    //
    // This deliberately does NOT assert which file snapshot() returns when the
    // only candidate is the stub. Two files are in play - the one beside
    // CLAUDE_CONFIG_DIR and the real ~/.claude.json - and only one of them is a
    // fixture, so an assertion about the winner reads differently on a machine
    // that has a real snapshot and on CI, which has none. The first version of
    // this test made exactly that mistake: it passed here because the home file
    // carried a meter and failed on all four CI runners, which is a test lying
    // about the code rather than the code being wrong.
    //
    // What IS the same everywhere, and is the behaviour that matters, is that
    // nothing in a stub can be mistaken for a provisioned account.
    fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ someMachineId: 'x' }));
    const stub = lowpri.snapshot();
    const fromStub = lowpri.offer(stub);
    if (stub && stub.someMachineId) {
      assert.strictEqual(fromStub.known, false, 'a stub carries no feature cache, so nothing is known');
      assert.strictEqual(fromStub.offered, false);
    }
    fs.writeFileSync(
      path.join(dir, '.claude.json'),
      JSON.stringify(account({ cachedGrowthBookFeatures: { tengu_toasty_breeze: TOASTY } }))
    );
    const real = lowpri.snapshot();
    assert.ok(real && real.cachedGrowthBookFeatures.tengu_toasty_breeze, 'the file with the meter is read');
    assert.strictEqual(lowpri.offer(real).offered, true);
  }));

test('an acknowledgement is Gev saying so: written with a timestamp and the window it belongs to, and cleared at that reset', () =>
  isolated(() => {
    const lowpri = fresh('lowpri');
    assert.strictEqual(lowpri.readAck(T), null, 'nothing is assumed');

    const record = lowpri.acknowledge({ on: true, windowKey: 'five_hour', resetsAt: T + HOUR, now: T });
    assert.strictEqual(record.on, true);
    assert.strictEqual(record.at, T);
    assert.strictEqual(record.windowKey, 'five_hour');
    assert.strictEqual(record.resetsAt, T + HOUR);

    const read = lowpri.readAck(T + MINUTE);
    assert.ok(read, 'it is remembered inside the window');
    assert.strictEqual(read.on, true);

    // Past the reset the window it belonged to is gone, and so is the fact.
    assert.strictEqual(lowpri.readAck(T + HOUR + 1), null, 'cleared at the next reset');

    // And the user can take it back before then.
    lowpri.acknowledge({ on: true, windowKey: 'five_hour', resetsAt: T + HOUR, now: T });
    assert.ok(lowpri.readAck(T + MINUTE));
    lowpri.acknowledge({ on: false, now: T + 2 * MINUTE });
    assert.strictEqual(lowpri.readAck(T + 3 * MINUTE), null, 'switched off is not acknowledged');
  }));

test('an unreadable acknowledgement file is "not acknowledged", never a throw', () =>
  isolated((dir) => {
    const lowpri = fresh('lowpri');
    fs.writeFileSync(lowpri.stateFile(), '{ this is not json');
    assert.strictEqual(lowpri.readAck(T), null);
    fs.rmSync(lowpri.stateFile());
    assert.strictEqual(lowpri.readAck(T), null);
    assert.ok(dir);
  }));

test('there are exactly three states, and none of them claims low-priority is ON', () =>
  isolated(() => {
    const lowpri = fresh('lowpri');
    const withOffer = account({ cachedGrowthBookFeatures: { tengu_toasty_breeze: TOASTY } });

    assert.strictEqual(lowpri.stateOf({ account: account(), now: T }).state, 'absent');
    const offered = lowpri.stateOf({ account: withOffer, now: T });
    assert.strictEqual(offered.state, 'offered');
    lowpri.acknowledge({ on: true, windowKey: 'five_hour', resetsAt: T + HOUR, now: T });
    assert.strictEqual(lowpri.stateOf({ account: withOffer, now: T + MINUTE }).state, 'acknowledged');

    // The whole point. Whether it is actually running is in the CLI's process
    // memory and nowhere on disk, so every state says so.
    for (const state of [
      lowpri.stateOf({ account: account(), now: T }),
      lowpri.stateOf({ account: withOffer, now: T }),
      lowpri.stateOf({ account: withOffer, now: T + MINUTE }),
    ]) {
      assert.strictEqual(state.activeKnown, false);
    }
  }));

test('the recommendation is numeric: offered at the 5-hour wall with the weekly under the threshold, refused above it', () =>
  isolated(() => {
    const lowpri = fresh('lowpri');
    const withOffer = account({ cachedGrowthBookFeatures: { tengu_toasty_breeze: TOASTY } });
    const at = (weeklyPercent, binding) =>
      lowpri.advise({
        account: withOffer,
        now: T,
        binding: binding || FIVE_HOUR,
        windows: [binding || FIVE_HOUR, Object.assign({}, WEEKLY, { percentUsed: weeklyPercent })],
      });

    const offer = at(40);
    assert.ok(offer, 'at the wall with a weekly at 40 there is room to say it');
    assert.strictEqual(offer.kind, 'offer');
    assert.strictEqual(offer.weeklyPercent, 40);
    assert.strictEqual(offer.threshold, lowpri.WEEKLY_HEADROOM_MAX);

    assert.strictEqual(at(lowpri.WEEKLY_HEADROOM_MAX).kind, 'offer', 'the threshold itself is still room');
    const hold = at(lowpri.WEEKLY_HEADROOM_MAX + 1);
    assert.strictEqual(hold.kind, 'hold', 'past the threshold it says do not');
    assert.strictEqual(hold.weeklyPercent, lowpri.WEEKLY_HEADROOM_MAX + 1);

    // Not at the wall, so nothing is said.
    assert.strictEqual(at(40, Object.assign({}, FIVE_HOUR, { percentUsed: 30 })), null);
    // The binding window is not the 5-hour one, so this is not that wall.
    assert.strictEqual(at(40, Object.assign({}, WEEKLY, { percentUsed: 96 })), null);
    // Not provisioned: never advertise a command this account does not have.
    assert.strictEqual(
      lowpri.advise({ account: account(), now: T, binding: FIVE_HOUR, windows: [FIVE_HOUR, WEEKLY] }),
      null
    );
    // No weekly reading at all is not a licence to guess.
    assert.strictEqual(lowpri.advise({ account: withOffer, now: T, binding: FIVE_HOUR, windows: [FIVE_HOUR] }), null);
  }));

test("the CLI's own auto-continue defaults to on, and the file that set it is named", () =>
  isolated((dir) => {
    const lowpri = fresh('lowpri');
    const absent = lowpri.autoContinue();
    assert.strictEqual(absent.value, true, 'absent means the documented default, which is true');
    assert.strictEqual(absent.source, 'default');

    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ autoContinueAtUsageLimit: false }));
    const set = lowpri.autoContinue();
    assert.strictEqual(set.value, false);
    assert.strictEqual(set.source, 'settings.json');

    fs.writeFileSync(path.join(dir, 'settings.local.json'), JSON.stringify({ autoContinueAtUsageLimit: true }));
    const local = lowpri.autoContinue();
    assert.strictEqual(local.value, true);
    assert.strictEqual(local.source, 'settings.local.json', 'the local file wins');
  }));

test('the graceful wrap-up is read from the mode flag, and "off" means the CLI does not wrap up here', () => {
  const lowpri = fresh('lowpri');
  // Verified in the installed 2.1.283 bundle: the mode normalizer keeps only
  // "wrap-up" and "next-steps" and maps everything else to "off".
  const off = lowpri.wrapUp(account({ cachedGrowthBookFeatures: { tengu_lantern_wick_mode: 'off', tengu_lantern_wick_text: 'some text' } }));
  assert.strictEqual(off.mode, 'off');
  assert.strictEqual(off.hostWrapsUp, false, 'the text being provisioned is not the note firing');
  assert.strictEqual(off.textProvisioned, true);

  for (const mode of ['wrap-up', 'next-steps']) {
    const on = lowpri.wrapUp(account({ cachedGrowthBookFeatures: { tengu_lantern_wick_mode: mode } }));
    assert.strictEqual(on.mode, mode);
    assert.strictEqual(on.hostWrapsUp, true);
  }
  // A mode nobody recognises is "off", the way the CLI normalises it.
  assert.strictEqual(lowpri.wrapUp(account({ cachedGrowthBookFeatures: { tengu_lantern_wick_mode: 'MAYBE' } })).hostWrapsUp, false);
  // Absent is absent: not a guess either way.
  const none = lowpri.wrapUp(account());
  assert.strictEqual(none.known, false);
  assert.strictEqual(none.hostWrapsUp, false);

  // The separate near-limit note, gated on its own flag.
  assert.strictEqual(lowpri.wrapUp(account({ cachedGrowthBookFeatures: { tengu_vellum_anchor: true } })).nearWallNote, true);
  assert.strictEqual(lowpri.wrapUp(account({ cachedGrowthBookFeatures: { tengu_vellum_anchor: false } })).nearWallNote, false);
});

test('a manual session reset is reported only when there is something readable to report', () => {
  const lowpri = fresh('lowpri');
  assert.strictEqual(lowpri.sessionReset(account()).present, false, 'no flag and no grant is no reset');

  const flagged = lowpri.sessionReset(account({ cachedGrowthBookFeatures: { tengu_cedar_ember: { enabled: true } } }));
  assert.strictEqual(flagged.present, true);

  const granted = lowpri.sessionReset(
    account({ cachedUsageUtilization: { fetchedAtMs: T, utilization: { cedar_ember: { resets_left: 1 } } } })
  );
  assert.strictEqual(granted.present, true);
  // resets_left comes from a live endpoint, so the count is never claimed.
  assert.strictEqual(granted.resetsLeft, null);

  // A null grant is not a grant.
  assert.strictEqual(
    lowpri.sessionReset(account({ cachedUsageUtilization: { fetchedAtMs: T, utilization: { cedar_ember: null } } })).present,
    false
  );
  assert.strictEqual(flagged.variant, 'grant');

  // The variant this account actually holds, read from ~/.claude.json on
  // 2026-09-25: the once-a-week session reset. The first build read only
  // tengu_cedar_ember and called this account grant-less.
  const weekly = lowpri.sessionReset(
    account({ cachedGrowthBookFeatures: { tengu_nifty_lemur: { enabled: true, version: 1 } } })
  );
  assert.strictEqual(weekly.present, true);
  assert.strictEqual(weekly.variant, 'weekly');
  assert.strictEqual(weekly.resetsLeft, null);

  // Both on: the CLI prefers the grant, and so does this.
  assert.strictEqual(
    lowpri.sessionReset(
      account({ cachedGrowthBookFeatures: { tengu_nifty_lemur: { enabled: true }, tengu_cedar_ember: { enabled: true } } })
    ).variant,
    'grant'
  );

  // The CLI reads enabled === true on a plain object and nothing else. A
  // switched-off flag is a truthy object, and it is not a reset on offer.
  for (const off of [{ enabled: false }, {}, [], 'yes', 1, null]) {
    assert.strictEqual(
      lowpri.sessionReset(account({ cachedGrowthBookFeatures: { tengu_nifty_lemur: off, tengu_cedar_ember: off } })).present,
      false,
      JSON.stringify(off)
    );
  }
});

test('usage credits are reported as unavailable when the org has switched them off', () => {
  const lowpri = fresh('lowpri');
  const blocked = lowpri.credits(
    account({
      cachedExtraUsageDisabledReason: 'org_level_disabled',
      cachedUsageUtilization: { fetchedAtMs: T, utilization: { extra_usage: { is_enabled: false, user_disabled: true } } },
    })
  );
  assert.strictEqual(blocked.available, false);
  assert.strictEqual(blocked.reason, 'org_level_disabled');

  const on = lowpri.credits(
    account({ cachedUsageUtilization: { fetchedAtMs: T, utilization: { extra_usage: { is_enabled: true } } } })
  );
  assert.strictEqual(on.available, true);
  // Nothing readable is "unknown", not "available".
  assert.strictEqual(lowpri.credits(account()).available, null);
});

test('the brief says the /low-priority line at the wall: what it costs, that replies pause, and that the user types it', () => {
  const brief = fresh('brief');
  const text = brief.briefText({
    binding: Object.assign({}, FIVE_HOUR),
    turnsLeft: 3,
    pressure: 'tight',
    lowPriority: {
      state: 'offered',
      advise: { kind: 'offer', weeklyPercent: 40, threshold: 80 },
      notice: TOASTY.noticeLine,
      cooloffMinutes: 10,
      weeklyLabel: 'weekly',
    },
  });
  assert.match(text, /\/low-priority/);
  assert.match(text, /weekly/i, 'it says which budget it spends');
  assert.match(text, /paus/i, 'it says replies can pause');
  // The one thing it must never imply: that anything here can switch it on.
  // The brief is read by the model, where "you" is the model, so the typist
  // has to be named as the user; "you type it yourself" said the opposite.
  assert.match(text, /only\s+the user can type/i);
  assert.match(text, /you cannot run a slash command/i);
  assert.doesNotMatch(text, /you type it|type it yourself|yours to type/i);
  assert.doesNotMatch(text, /I will (turn|switch) (it )?on/i);
  // A possibility, not a promise: the arm is in a response header nothing here sees.
  assert.match(text, /if the wall offers it|may offer|is not guaranteed/i);
  // And no invented wait number.
  assert.doesNotMatch(text, /20 ?s\b|20 minutes|every 20 seconds/);
});

test('above the weekly threshold the brief says do not use it, and why', () => {
  const brief = fresh('brief');
  const text = brief.briefText({
    binding: Object.assign({}, FIVE_HOUR),
    turnsLeft: 3,
    pressure: 'tight',
    lowPriority: {
      state: 'offered',
      advise: { kind: 'hold', weeklyPercent: 94, threshold: 80 },
      notice: TOASTY.noticeLine,
      weeklyLabel: 'weekly',
    },
  });
  assert.match(text, /\/low-priority/);
  assert.match(text, /not worth it|do not|don't/i);
  assert.match(text, /94/, 'it cites the weekly figure it judged on');
  // One user's bug report (anthropics/claude-code#92544) is a report, not a
  // measurement, and the decision is the user's to make, not the model's.
  assert.match(text, /one user has reported/i);
  assert.doesNotMatch(text, /has been measured/i);
  assert.match(text, /only the user can type it/i);
  assert.doesNotMatch(text, /the answer is no/i);
});

test('with no offer on this account the brief never mentions /low-priority', () => {
  const brief = fresh('brief');
  const text = brief.briefText({
    binding: Object.assign({}, FIVE_HOUR),
    turnsLeft: 3,
    pressure: 'tight',
    lowPriority: { state: 'absent', advise: null, notice: null },
  });
  assert.doesNotMatch(text, /low-priority/);
});

test('once Gev has acknowledged it, the brief brakes on the weekly and stops telling him to stop at the 5-hour wall', () => {
  const brief = fresh('brief');
  const text = brief.briefText({
    // The weekly IS the binding window now; that swap is what acknowledgement buys.
    binding: Object.assign({}, WEEKLY, { percentUsed: 55 }),
    turnsLeft: 300,
    pressure: 'roomy',
    resetsIn: '2d',
    lowPriority: {
      state: 'acknowledged',
      advise: null,
      notice: TOASTY.noticeLine,
      weeklyBinding: true,
      weeklyLabel: 'weekly',
      fiveHourPercent: 100,
    },
  });
  assert.match(text, /lower priority/i);
  assert.match(text, /weekly/i);
  assert.match(text, /paus/i, 'replies may pause while it waits for capacity');
  // The five-hour wall is no longer the thing that stops the work, and the
  // line must not tell the session to wind down at it.
  assert.doesNotMatch(text, /The budget is gone/);
  assert.match(text, /5-hour|five-hour/i, 'the retired wall is still named, as a fact');
});

test('the brief does not duplicate the wrap-up instruction when the CLI is the one giving it', () => {
  const brief = fresh('brief');
  const parts = {
    binding: Object.assign({}, FIVE_HOUR, { percentUsed: 99 }),
    turnsLeft: 1,
    pressure: 'tight',
    lowPriority: { state: 'absent', advise: null, notice: null },
  };
  // Mode off, which is what this machine reads: the plugin's own instruction stands.
  const mine = brief.briefText(Object.assign({}, parts, { hostWrapsUp: false }));
  assert.match(mine, /The budget is nearly gone/);

  const theirs = brief.briefText(Object.assign({}, parts, { hostWrapsUp: true }));
  assert.match(theirs, /Claude Code is injecting its own wrap-up/i);
  assert.doesNotMatch(theirs, /The budget is nearly gone, so make being cut off cheap/);
});

test('a relay wake for the 5-hour reset is refused while low-priority is acknowledged, and the weekly still arms', () =>
  isolated(() => {
    const lowpri = fresh('lowpri');
    const relay = fresh('relay');
    const config = Object.assign({}, relay.settings(relay.read()), { enabled: true, at: 80, armOn: 'threshold' });
    const work = { hasWork: true, pending: 1, source: 'todos', todos: [{ status: 'pending', content: 'x' }], plan: null };

    const five = { key: 'five_hour', label: '5-hour', percentUsed: 96, stale: false, resetsAt: T + HOUR };
    const weekly = { key: 'seven_day', label: 'weekly', percentUsed: 96, stale: false, resetsAt: T + 2 * DAY };

    // Nothing acknowledged: the 5-hour wake is exactly as armable as before.
    assert.strictEqual(relay.armable({ config, binding: five, sessionId: 's1', work, now: T }).ok, true);

    lowpri.acknowledge({ on: true, windowKey: 'five_hour', resetsAt: T + HOUR, now: T });
    const refused = relay.armable({ config, binding: five, sessionId: 's1', work, now: T + MINUTE });
    assert.strictEqual(refused.ok, false);
    assert.match(refused.why, /low-priority/, 'and it says why in plain words');
    assert.match(refused.why, /5-hour|five-hour/);

    // The weekly is a different window and a real wall: it still arms.
    assert.strictEqual(relay.armable({ config, binding: weekly, sessionId: 's1', work, now: T + MINUTE }).ok, true);

    // And once that 5-hour window has reset, the refusal lapses with the fact.
    assert.strictEqual(relay.armable({ config, binding: five, sessionId: 's1', work, now: T + HOUR + MINUTE }).ok, true);
  }));

test('a manual session reset is named at the wall only when one is actually readable, and never counted', () => {
  const brief = fresh('brief');
  const parts = { binding: Object.assign({}, FIVE_HOUR), turnsLeft: 2, pressure: 'tight' };
  const none = brief.briefText(Object.assign({}, parts, { lowPriority: { state: 'absent', advise: null, resetGrant: false } }));
  assert.doesNotMatch(none, /limit-reset/, 'no reset on the account, so nothing is said');

  // The counted grant (tengu_cedar_ember). Its own copy has a use-by date, a
  // count and an early-use path, so "once a week" and "only at a limit" - which
  // the first build said for it - are not claimed.
  const some = brief.briefText(
    Object.assign({}, parts, { lowPriority: { state: 'absent', advise: null, resetGrant: true, resetVariant: 'grant' } })
  );
  assert.match(some, /\/limit-reset/);
  assert.match(some, /refilling your limits/);
  assert.doesNotMatch(some, /once a week|once-weekly/i);
  assert.doesNotMatch(some, /only works while|only at a/i);
  assert.match(some, /not readable from here/, 'resets_left is never claimed');
  assert.doesNotMatch(some, /\d+ resets? left/);
  assert.match(some, /only the user can type it; you cannot run a slash command/);

  // Not while there is room: at 20 per cent nobody needs telling.
  const roomy = brief.briefText({
    binding: Object.assign({}, FIVE_HOUR, { percentUsed: 20 }),
    turnsLeft: 200,
    pressure: 'roomy',
    lowPriority: { state: 'absent', advise: null, resetGrant: true, resetVariant: 'grant' },
  });
  assert.doesNotMatch(roomy, /limit-reset/);
});

test('the once-a-week session reset this account holds is named at the 5-hour wall, in its own terms, and nowhere else', () => {
  const brief = fresh('brief');
  const lp = { state: 'absent', advise: null, resetGrant: true, resetVariant: 'weekly' };
  const atWall = brief.briefText({ binding: Object.assign({}, FIVE_HOUR), turnsLeft: 2, pressure: 'tight', lowPriority: lp });
  assert.match(atWall, /\/limit-reset/);
  assert.match(atWall, /once a week it resets the 5-hour limit/);
  assert.match(atWall, /still counts toward the weekly/);
  assert.match(atWall, /not readable from here/);
  assert.match(atWall, /only the user can type it; you cannot run a slash command/);
  assert.doesNotMatch(atWall, /\d+ resets? left/);

  // At a WEEKLY wall a reset of the 5-hour limit cannot help, so it is not
  // offered as though it could.
  const weeklyWall = brief.briefText({
    binding: Object.assign({}, WEEKLY, { percentUsed: 97, turnsLeft: 3 }),
    turnsLeft: 3,
    pressure: 'tight',
    lowPriority: lp,
  });
  assert.doesNotMatch(weeklyWall, /limit-reset/, weeklyWall);

  // The CLI refuses a reset while lower priority runs ("Resets can't be used
  // while you continue at lower priority"). With no weekly reading the brief
  // cannot swap, so the 5-hour window is still binding - and it must still not
  // offer the reset once the user has said low-priority is on.
  const acknowledged = brief.briefText({
    binding: Object.assign({}, FIVE_HOUR),
    turnsLeft: 2,
    pressure: 'tight',
    lowPriority: Object.assign({}, lp, { state: 'acknowledged', weeklyBinding: false }),
  });
  assert.doesNotMatch(acknowledged, /limit-reset/, acknowledged);

  const roomy = brief.briefText({
    binding: Object.assign({}, FIVE_HOUR, { percentUsed: 20 }),
    turnsLeft: 200,
    pressure: 'roomy',
    lowPriority: lp,
  });
  assert.doesNotMatch(roomy, /limit-reset/);
});

test('the reset is read end to end from the flag this account really carries', () =>
  isolatedAsync(async (dir) => {
    const brief = fresh('brief');
    fresh('lowpri');
    const now = Date.now();
    fs.writeFileSync(
      path.join(dir, '.claude.json'),
      JSON.stringify({
        oauthAccount: { accountUuid: 'acct-lemur', organizationType: 'claude_max' },
        cachedGrowthBookFeatures: {
          tengu_nifty_lemur: { enabled: true, version: 1, noticeLine: '/limit-reset to reset your session limit now' },
        },
        cachedUsageUtilization: {
          fetchedAtMs: now,
          accountUuid: 'acct-lemur',
          utilization: {
            five_hour: { utilization: 97, resets_at: new Date(now + 40 * MINUTE).toISOString() },
            seven_day: { utilization: 45, resets_at: new Date(now + 2 * DAY).toISOString() },
            cedar_ember: null,
          },
        },
      })
    );
    const text = await brief.run(now, { session_id: 'lemur-1', cwd: dir });
    assert.match(text, /\/limit-reset/, text);
    assert.match(text, /once a week it resets the 5-hour limit/, text);
  }));

test("an armed resume relay says the CLI's own auto-continue would carry the same session, so both must not fire", () => {
  const brief = fresh('brief');
  const parts = {
    binding: Object.assign({}, FIVE_HOUR),
    turnsLeft: 3,
    pressure: 'tight',
    relay: {
      enabled: true,
      armed: { wakeAt: T + 2 * HOUR, mode: 'resume', continuation: true },
      config: { graceMinutes: 15 },
    },
  };
  const both = brief.briefText(Object.assign({}, parts, { autoContinue: { value: true, source: 'default' } }));
  assert.match(both, /Continue automatically at usage limit/);
  assert.match(both, /twice/, 'it names the cost of both firing');
  assert.match(both, /default/, 'and where the setting came from');

  const off = brief.briefText(Object.assign({}, parts, { autoContinue: { value: false, source: 'settings.json' } }));
  assert.doesNotMatch(off, /Continue automatically at usage limit/, 'nothing to warn about when it is off');
  // A notify-only relay never starts anything, so there is nothing to collide.
  const notify = brief.briefText(
    Object.assign({}, parts, {
      autoContinue: { value: true, source: 'default' },
      relay: { enabled: true, armed: { wakeAt: T + 2 * HOUR, mode: 'notify', continuation: true }, config: { graceMinutes: 15 } },
    })
  );
  assert.doesNotMatch(notify, /Continue automatically at usage limit/);
});

test('run() actually puts the /low-priority line in front of Claude, not just briefText', () =>
  isolatedAsync(async (dir) => {
    const brief = fresh('brief');
    // A whole account snapshot: the wall on the 5-hour window, room on the
    // weekly, and the toggle provisioned. `utilization` is a percentage here,
    // the way Claude Code writes it.
    const now = Date.now();
    fs.writeFileSync(
      path.join(dir, '.claude.json'),
      JSON.stringify({
        oauthAccount: { accountUuid: 'acct-1', organizationType: 'claude_max' },
        cachedGrowthBookFeatures: { tengu_toasty_breeze: TOASTY, tengu_lantern_wick_mode: 'off' },
        cachedUsageUtilization: {
          fetchedAtMs: now,
          accountUuid: 'acct-1',
          utilization: {
            five_hour: { utilization: 97, resets_at: new Date(now + 40 * MINUTE).toISOString() },
            seven_day: { utilization: 45, resets_at: new Date(now + 2 * DAY).toISOString() },
          },
        },
      })
    );
    const text = await brief.run(now, { session_id: 'sess-lowpri', cwd: dir });
    assert.match(text, /\/low-priority/, text);
    assert.match(text, /weekly limit, which is at 45%/, text);
    assert.match(text, /only\s+the user can type/, text);
    assert.doesNotMatch(text, /you\s+type it yourself/, text);
    assert.doesNotMatch(text, /20 minutes/);

    // And with the flag absent the very same account says nothing about it.
    fs.rmSync(path.join(dir, 'usage-limits-brief.json'), { force: true });
    const account = JSON.parse(fs.readFileSync(path.join(dir, '.claude.json'), 'utf8'));
    delete account.cachedGrowthBookFeatures.tengu_toasty_breeze;
    fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify(account));
    const quiet = await brief.run(now, { session_id: 'sess-lowpri-2', cwd: dir });
    assert.doesNotMatch(quiet, /low-priority/, quiet);
  }));

test('the acknowledgement is set by the user through usage-mode, never by the plugin on its own', () =>
  isolated(() => {
    const lowpri = fresh('lowpri');
    const mode = fresh('mode');
    // Reading it before anything is said reports the honest nothing.
    const before = mode.main(['--low-priority']);
    assert.match(before, /not been acknowledged|nothing acknowledged/i);

    const on = mode.main(['--low-priority', 'on']);
    assert.match(on, /weekly/i, 'setting it repeats what it costs');
    assert.ok(lowpri.readAck(Date.now()), 'the fact is written down');

    const off = mode.main(['--low-priority', 'off']);
    assert.match(off, /off|cleared/i);
    assert.strictEqual(lowpri.readAck(Date.now()), null);
  }));

test('the terse style keeps the /low-priority line: it changes what happens next', () => {
  const brief = fresh('brief');
  const mode = fresh('mode');
  const parts = {
    mode: { name: 'max', label: 'max', policy: mode.MODES.max, directive: mode.DIRECTIVES[mode.MODES.max.directive] || null },
    binding: Object.assign({}, FIVE_HOUR),
    turnsLeft: 3,
    pressure: 'tight',
    lowPriority: { state: 'offered', advise: { kind: 'offer', weeklyPercent: 40, threshold: 80 }, notice: TOASTY.noticeLine },
  };
  const terse = brief.briefText(parts);
  assert.strictEqual(mode.MODES.max.briefStyle, 'terse', 'max is the terse style');
  assert.match(terse, /\/low-priority/, terse);
  assert.match(terse, /weekly limit, which is at 40%/, terse);
  // And the hold form too: refusing is the more expensive thing to drop.
  const hold = brief.briefText(
    Object.assign({}, parts, { lowPriority: { state: 'offered', advise: { kind: 'hold', weeklyPercent: 95, threshold: 80 } } })
  );
  assert.match(hold, /not worth taking/, hold);
});

test('when the weekly takes over as the binding window, nothing derived from the 5-hour one comes with it', () =>
  isolatedAsync(async (dir) => {
    const lowpri = fresh('lowpri');
    const brief = fresh('brief');
    const now = Date.now();
    fs.writeFileSync(
      path.join(dir, '.claude.json'),
      JSON.stringify({
        oauthAccount: { accountUuid: 'acct-2', organizationType: 'claude_max' },
        cachedGrowthBookFeatures: { tengu_toasty_breeze: TOASTY },
        cachedUsageUtilization: {
          fetchedAtMs: now,
          accountUuid: 'acct-2',
          utilization: {
            five_hour: { utilization: 100, resets_at: new Date(now + 30 * MINUTE).toISOString() },
            seven_day: { utilization: 50, resets_at: new Date(now + 2 * DAY).toISOString() },
          },
        },
      })
    );
    // Before the acknowledgement the 5-hour window is the wall and the line says so.
    const before = await brief.run(now, { session_id: 'swap-1', cwd: dir });
    assert.match(before, /binding window is 5-hour/, before);

    lowpri.acknowledge({ on: true, windowKey: 'five_hour', resetsAt: now + 30 * MINUTE, now });
    fs.rmSync(path.join(dir, 'usage-limits-brief.json'), { force: true });
    const after = await brief.run(now, { session_id: 'swap-2', cwd: dir });
    assert.match(after, /binding window is weekly/, after);
    // The weekly is the binding window, so it is not also a "note that" warning
    // about itself, and it is not listed under "Other windows" either.
    assert.doesNotMatch(after, /Note that weekly is at/, after);
    assert.doesNotMatch(after, /Other windows: weekly /, after);
    // At 50 per cent of the weekly there is room, and the line must not be
    // telling the session to wind down at a 5-hour wall it has gone past.
    assert.doesNotMatch(after, /The budget is gone/, after);
    assert.match(after, /brake is the weekly window and not the 5-hour one/, after);

    // And the acknowledgement lapses with the window it was recorded against.
    fs.rmSync(path.join(dir, 'usage-limits-brief.json'), { force: true });
    const lapsed = await brief.run(now + 31 * MINUTE, { session_id: 'swap-3', cwd: dir });
    assert.doesNotMatch(lapsed, /brake is the weekly window/, lapsed);
  }));

test('none of this is read, or said, in Codex or Antigravity', () =>
  isolated((dir) => {
    const lowpri = fresh('lowpri');
    const brief = fresh('brief');
    const host = require('../skills/usage-limits/scripts/host.js');
    // A provisioned account, and an acknowledgement, both sitting on disk.
    fs.writeFileSync(
      path.join(dir, '.claude.json'),
      JSON.stringify(account({ cachedGrowthBookFeatures: { tengu_toasty_breeze: TOASTY, tengu_lantern_wick_mode: 'wrap-up' } }))
    );
    lowpri.acknowledge({ on: true, windowKey: 'five_hour', resetsAt: T + HOUR, now: T });

    // Claude Code reads it.
    const mine = brief.wallFeatures(T, FIVE_HOUR, [FIVE_HOUR, WEEKLY], host.CLAUDE);
    assert.strictEqual(mine.lowPriority.state, 'acknowledged');
    assert.strictEqual(mine.hostWrapsUp, true);
    assert.strictEqual(mine.swapped, true);

    // The other two do not, and cannot be talked into it. /low-priority is a
    // Claude Code slash command; naming it in Codex is telling Codex to reach
    // for a control it does not have, against an account it is not spending.
    for (const other of [host.CODEX, host.GEMINI]) {
      const theirs = brief.wallFeatures(T, FIVE_HOUR, [FIVE_HOUR, WEEKLY], other);
      assert.strictEqual(theirs.lowPriority, null, other);
      assert.strictEqual(theirs.hostWrapsUp, false, other);
      assert.strictEqual(theirs.swapped, false, other);
      assert.strictEqual(theirs.binding, FIVE_HOUR, other + ' keeps its own binding window');
      // And the sentence cannot be built from nothing.
      const text = brief.briefText({
        binding: FIVE_HOUR,
        turnsLeft: 3,
        pressure: 'tight',
        lowPriority: theirs.lowPriority,
        hostWrapsUp: theirs.hostWrapsUp,
      });
      assert.doesNotMatch(text, /low-priority/, other);
      assert.doesNotMatch(text, /limit-reset/, other);
    }

    // The relay makes the same distinction, and it has to: Codex files a
    // five-hour window under the same key, so an acknowledgement made against a
    // Claude account must not refuse a Codex wake.
    const relay = fresh('relay');
    const config = Object.assign({}, relay.settings(relay.read()), { enabled: true, at: 80, armOn: 'threshold' });
    const work = { hasWork: true, pending: 1, source: 'todos', todos: [{ status: 'pending', content: 'x' }], plan: null };
    const five = { key: 'five_hour', label: '5-hour', percentUsed: 96, stale: false, resetsAt: T + HOUR };
    assert.strictEqual(
      relay.armable({ config, binding: five, sessionId: 's1', work, now: T, hostName: host.CLAUDE }).ok,
      false,
      'Claude Code refuses it'
    );
    for (const other of [host.CODEX, host.GEMINI]) {
      assert.strictEqual(
        relay.armable({ config, binding: five, sessionId: 's1', work, now: T, hostName: other }).ok,
        true,
        other + ' is unaffected by a Claude acknowledgement'
      );
    }

    // And the command says so rather than quietly writing the wrong thing.
    const mode = fresh('mode');
    for (const [arg, name] of [['codex', 'Codex'], ['gemini', 'Antigravity']]) {
      const before = process.argv;
      process.argv = [before[0], before[1], '--host', arg];
      try {
        const answer = mode.main(['--low-priority', 'on', '--host', arg]);
        assert.match(answer, new RegExp('does not exist in ' + name));
      } finally {
        process.argv = before;
      }
    }
  }));

test('the mid-turn pulse follows the brief onto the weekly, so the two never disagree', () =>
  isolatedAsync(async (dir) => {
    const lowpri = fresh('lowpri');
    const pulse = fresh('pulse');
    const now = Date.now();
    fs.writeFileSync(
      path.join(dir, '.claude.json'),
      JSON.stringify({
        oauthAccount: { accountUuid: 'acct-3', organizationType: 'claude_max' },
        cachedGrowthBookFeatures: { tengu_toasty_breeze: TOASTY },
        cachedUsageUtilization: {
          fetchedAtMs: now,
          accountUuid: 'acct-3',
          utilization: {
            five_hour: { utilization: 99, resets_at: new Date(now + 20 * MINUTE).toISOString() },
            seven_day: { utilization: 94, resets_at: new Date(now + 2 * DAY).toISOString() },
          },
        },
      })
    );
    const input = { session_id: 'pulse-lowpri', cwd: dir, tool_name: 'Bash', hook_event_name: 'PostToolUse' };
    const before = await pulse.run(now, input);
    assert.match(before, /5-hour/, before);

    lowpri.acknowledge({ on: true, windowKey: 'five_hour', resetsAt: now + 20 * MINUTE, now });
    const after = await pulse.run(now, Object.assign({}, input, { session_id: 'pulse-lowpri-2' }));
    assert.match(after, /weekly/, after);
    assert.doesNotMatch(after, /5-hour/, after);

    // And with room on the weekly the pulse says nothing at all, rather than
    // counting down a 5-hour wall this session has gone past. That silence is
    // the feature: the pulse only speaks under pressure, and once low-priority
    // is on the pressure is the weekly's.
    const roomy = JSON.parse(fs.readFileSync(path.join(dir, '.claude.json'), 'utf8'));
    roomy.cachedUsageUtilization.utilization.seven_day.utilization = 30;
    fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify(roomy));
    const quiet = await pulse.run(now, Object.assign({}, input, { session_id: 'pulse-lowpri-3' }));
    assert.strictEqual(quiet, '', quiet);
  }));

test('a deferral to a time the user named is still honoured, with a note that a 5-hour wait buys nothing', () =>
  isolated(() => {
    const lowpri = fresh('lowpri');
    const defer = fresh('defer');
    const five = { percent: 99, resetsAt: T + HOUR, windowKey: 'five_hour' };

    // The user named a time, so unlike an automatic wake this is never refused.
    const plain = defer.plan({ now: T, when: 'reset', binding: five });
    assert.strictEqual(plain.ok, true);
    assert.doesNotMatch(plain.notes.join(' '), /low-priority/);

    const noted = defer.plan({ now: T, when: 'reset', binding: five, lowPriorityAck: true });
    assert.strictEqual(noted.ok, true, 'still scheduled: a deferral is the user deciding');
    // Two notes apply at once here, and the second one is the one that matters.
    // plan() used to return only the first, which would have dropped it.
    assert.ok(noted.notes.length >= 2, JSON.stringify(noted.notes));
    assert.match(noted.notes.join(' '), /waiting for it buys nothing/);
    // And the confirmation the user reads prints all of them.
    const said = defer.confirmation({ clock: noted.clock, label: noted.label, in: noted.in, items: null, resetNote: noted.resetNote, notes: noted.notes });
    assert.match(said, /waiting for it buys nothing/);
    assert.match(said, /the window will have reset by then/);

    // And a weekly wall gets no such note: that reset is still a real one.
    const weekly = { percent: 99, resetsAt: T + 2 * DAY, windowKey: 'seven_day' };
    const forWeekly = defer.plan({ now: T, when: 'in 30m', binding: weekly, lowPriorityAck: true });
    assert.doesNotMatch(forWeekly.notes.join(' '), /low-priority/);

    // The reader behind it is Claude-Code-only, like every other one.
    lowpri.acknowledge({ on: true, windowKey: 'five_hour', resetsAt: T + HOUR, now: T });
    const argv = process.argv;
    try {
      process.argv = [argv[0], argv[1]];
      assert.strictEqual(defer.lowPriorityAcknowledged(T + MINUTE), true);
      process.argv = [argv[0], argv[1], '--host', 'codex'];
      assert.strictEqual(defer.lowPriorityAcknowledged(T + MINUTE), false, 'not Codex\'s fact');
    } finally {
      process.argv = argv;
    }
  }));

test('nothing in this module throws on a machine with no Claude Code state at all', () =>
  isolated(() => {
    const lowpri = fresh('lowpri');
    assert.doesNotThrow(() => {
      lowpri.snapshot();
      lowpri.offer(lowpri.snapshot());
      lowpri.wrapUp(lowpri.snapshot());
      lowpri.credits(lowpri.snapshot());
      lowpri.sessionReset(lowpri.snapshot());
      lowpri.autoContinue();
      lowpri.readAck(T);
      lowpri.stateOf({ now: T });
      lowpri.advise({ now: T });
      lowpri.forBrief({ now: T });
    });
  }));

// ---------------------------------------------------------------------------
// The adversarial pass, 2026-09-26. Five defects the first build shipped, each
// found by running the real hooks as child processes with a crafted
// CLAUDE_CONFIG_DIR rather than by calling the functions.
// ---------------------------------------------------------------------------

test('acknowledged with no weekly to brake on, the brief does not claim the figures are the weekly', () =>
  isolatedAsync(async (dir) => {
    const lowpri = fresh('lowpri');
    const brief = fresh('brief');
    const now = Date.now();
    // Provisioned, at the 5-hour wall, and NO seven_day window at all - which
    // happens on a snapshot that has not carried one yet.
    fs.writeFileSync(
      path.join(dir, '.claude.json'),
      JSON.stringify({
        oauthAccount: { accountUuid: 'acct-nw', organizationType: 'claude_max' },
        cachedGrowthBookFeatures: { tengu_toasty_breeze: TOASTY },
        cachedUsageUtilization: {
          fetchedAtMs: now,
          accountUuid: 'acct-nw',
          utilization: { five_hour: { utilization: 99, resets_at: new Date(now + 40 * MINUTE).toISOString() } },
        },
      })
    );
    lowpri.acknowledge({ on: true, windowKey: 'five_hour', resetsAt: now + 40 * MINUTE, now });
    const text = await brief.run(now, { session_id: 'nw-1', cwd: dir });
    // wallFeatures cannot swap, so the 5-hour window is still what the figures
    // describe - and the sentence must not contradict them.
    assert.match(text, /binding window is 5-hour/, text);
    assert.doesNotMatch(text, /the figures above are the weekly/, text);
    assert.doesNotMatch(text, /brake is the weekly window and not the 5-hour one/, text);
    // It still says the acknowledgement was heard, and says what to do about it.
    assert.match(text, /no usable weekly reading/, text);
    assert.match(text, /still the one to plan against/, text);
  }));

test('acknowledged with the weekly already binding on its own still gets the swapped wording', () =>
  isolatedAsync(async (dir) => {
    const lowpri = fresh('lowpri');
    const brief = fresh('brief');
    const now = Date.now();
    // The ordinary shape after a while at lower priority: the 5-hour window has
    // rolled over and reads low, the weekly is the wall. No swap is needed
    // because the weekly is binding already, and the sentence is still true.
    fs.writeFileSync(
      path.join(dir, '.claude.json'),
      JSON.stringify({
        oauthAccount: { accountUuid: 'acct-wb', organizationType: 'claude_max' },
        cachedGrowthBookFeatures: { tengu_toasty_breeze: TOASTY },
        cachedUsageUtilization: {
          fetchedAtMs: now,
          accountUuid: 'acct-wb',
          utilization: {
            five_hour: { utilization: 5, resets_at: new Date(now + 40 * MINUTE).toISOString() },
            seven_day: { utilization: 70, resets_at: new Date(now + 2 * DAY).toISOString() },
          },
        },
      })
    );
    lowpri.acknowledge({ on: true, windowKey: 'five_hour', resetsAt: now + 40 * MINUTE, now });
    const text = await brief.run(now, { session_id: 'wb-1', cwd: dir });
    assert.match(text, /binding window is weekly/, text);
    assert.match(text, /the figures above are the weekly/, text);
  }));

test('an acknowledgement with no readable reset lapses after the window it belongs to, instead of living for ever', () =>
  isolated(() => {
    const lowpri = fresh('lowpri');
    const now = T;
    // This is exactly what mode.js writes when no five_hour reset was readable.
    lowpri.acknowledge({ on: true, windowKey: null, resetsAt: null, now });
    const fresh1 = lowpri.readAck(now);
    assert.ok(fresh1, 'it counts right away');
    assert.strictEqual(fresh1.expiryKnown, false, 'and says the expiry is not the real reset');
    assert.strictEqual(fresh1.expiresAt, now + lowpri.ACK_MAX_MS);
    assert.ok(lowpri.readAck(now + lowpri.ACK_MAX_MS - MINUTE), 'still on just inside the window');
    assert.strictEqual(lowpri.readAck(now + lowpri.ACK_MAX_MS), null, 'and spent at the end of it');
    // Three days later is the case that was live before: it read as ON.
    assert.strictEqual(lowpri.readAck(now + 3 * DAY), null);
  }));

test('a record with no usable timestamp is not a record, so nothing prints "Invalid Date"', () =>
  isolated((dir) => {
    const lowpri = fresh('lowpri');
    const mode = fresh('mode');
    fs.writeFileSync(
      path.join(dir, 'usage-limits-lowpri.json'),
      JSON.stringify({ ack: { on: true, at: 'nope', resetsAt: 'nope' } })
    );
    assert.strictEqual(lowpri.readAck(T), null, 'a hand-edited file is not an acknowledgement');
    const said = mode.main(['--low-priority']);
    assert.doesNotMatch(said, /Invalid Date/, said);
    assert.match(said, /has not been acknowledged/, said);
  }));

test('a statement that could not be saved is never reported as recorded', () =>
  isolated((dir) => {
    const lowpri = fresh('lowpri');
    const mode = fresh('mode');
    // A directory where the state file goes: the write can never succeed.
    fs.mkdirSync(path.join(dir, 'usage-limits-lowpri.json'));
    const written = lowpri.acknowledge({ on: true, windowKey: 'five_hour', resetsAt: T + HOUR, now: T });
    assert.strictEqual(written.saved, false, 'acknowledge reports the failure');

    const said = mode.main(['--low-priority', 'on']);
    assert.doesNotMatch(said, /^Recorded/, said);
    assert.match(said, /NOT recorded/, said);
    assert.match(said, /could not be written/, said);
    // And it does not then claim to be on.
    assert.match(mode.main(['--low-priority']), /has not been acknowledged/);
  }));

test('a wake armed by hand for the 5-hour reset says that low-priority makes it a second start', () =>
  isolated((dir) => {
    const lowpri = fresh('lowpri');
    const relay = fresh('relay');
    const host = require('../skills/usage-limits/scripts/host.js');
    lowpri.acknowledge({ on: true, windowKey: 'five_hour', resetsAt: Date.now() + HOUR, now: Date.now() });
    // armable() is the gate the hooks go through; the by-hand command did not.
    const refused = relay.armable({
      now: Date.now(),
      sessionId: 'byhand-1',
      hostName: host.CLAUDE,
      binding: { key: 'five_hour', percentUsed: 99, resetsAt: Date.now() + HOUR },
      work: { hasWork: true, pending: 1, todos: [] },
      config: Object.assign({}, relay.settings(relay.read()), { enabled: true, at: 75, armOn: 'threshold' }),
      atCompletion: true,
    });
    assert.strictEqual(refused.ok, false);
    assert.match(refused.why, /low-priority is acknowledged on/);
    // And the acknowledgement is what the by-hand path now has to read, so the
    // note it appends is not silent about the same fact.
    assert.ok(lowpri.readAck(Date.now()), 'the record the by-hand path reads');
    assert.strictEqual(typeof relay.armByHand, 'function', 'and the path that has to say it');
  }));

// ---------------------------------------------------------------------------
// The second adversarial pass, 2026-09-25 late. Each of these was reproduced by
// running mode.js and brief.js as child processes against a crafted config
// directory before it was fixed.
// ---------------------------------------------------------------------------

test('a state file holding an array is not a state, so "on" really is recorded', () =>
  isolated((dir) => {
    const lowpri = fresh('lowpri');
    const mode = fresh('mode');
    // JSON.stringify drops a named property set on an array, so this used to
    // write [] back, report saved:true, and print "Recorded".
    fs.writeFileSync(path.join(dir, 'usage-limits-lowpri.json'), '[]');
    const said = mode.main(['--low-priority', 'on']);
    assert.match(said, /^Recorded/, said);
    assert.ok(lowpri.readAck(Date.now()), 'and the next read finds it');
    assert.match(mode.main(['--low-priority']), /acknowledged low-priority ON/);
  }));

test('a snapshot whose 5-hour reset is already past does not stamp that past time on the record', () =>
  isolated((dir) => {
    const lowpri = fresh('lowpri');
    const mode = fresh('mode');
    const now = Date.now();
    // Six hours old: the five_hour reset it carries has already gone by.
    fs.writeFileSync(
      path.join(dir, '.claude.json'),
      JSON.stringify({
        oauthAccount: { accountUuid: 'acct-past' },
        cachedGrowthBookFeatures: { tengu_toasty_breeze: TOASTY },
        cachedUsageUtilization: {
          fetchedAtMs: now - 6 * HOUR,
          accountUuid: 'acct-past',
          utilization: {
            five_hour: { utilization: 97, resets_at: new Date(now - HOUR).toISOString() },
            seven_day: { utilization: 40, resets_at: new Date(now + 2 * DAY).toISOString() },
          },
        },
      })
    );
    const said = mode.main(['--low-priority', 'on']);
    assert.match(said, /^Recorded/, said);
    // It used to say "lapses on its own at <an hour ago>" and then be gone.
    assert.match(said, /No 5-hour reset time was readable/, said);
    const ack = lowpri.readAck(Date.now());
    assert.ok(ack, 'the statement survives the next read');
    assert.strictEqual(ack.expiryKnown, false);
    assert.ok(ack.expiresAt > Date.now());
  }));

test('a clear that could not be written is never reported as cleared', () =>
  isolated(() => {
    const lowpri = fresh('lowpri');
    const mode = fresh('mode');
    const atomic = require('../skills/usage-limits/scripts/atomic.js');
    lowpri.acknowledge({ on: true, windowKey: 'five_hour', resetsAt: Date.now() + HOUR, now: Date.now() });
    const real = atomic.writeFileAtomic;
    atomic.writeFileAtomic = () => {
      throw new Error('EPERM: simulated');
    };
    let said;
    try {
      said = mode.main(['--low-priority', 'off']);
    } finally {
      atomic.writeFileAtomic = real;
    }
    assert.doesNotMatch(said, /^Cleared/, said);
    assert.match(said, /NOT cleared/, said);
    assert.ok(lowpri.readAck(Date.now()), 'and the record really is still there');
    // With the write working again, off clears it.
    assert.match(mode.main(['--low-priority', 'off']), /^Cleared/);
    assert.strictEqual(lowpri.readAck(Date.now()), null);
  }));
