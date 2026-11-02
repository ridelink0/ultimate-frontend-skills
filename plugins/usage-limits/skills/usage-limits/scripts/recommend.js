'use strict';

// Turns the budget figures into a choice of effort and model, and says where
// each half of that choice can actually be applied. There are three levers and
// they belong to different hands:
//
//   - The running session's effort and model are the user's: only /effort and
//     /model change them, and they change them immediately.
//   - New sessions are the script's: lowpower.js writes effortLevel and model
//     into settings.json, which Claude Code reads at launch.
//   - Delegated work is Claude's alone: a subagent can be dispatched on any
//     model at any effort, mid-session, with no one asked.
//
// Nothing here touches disk. decide() is a pure function over the same report
// data usage.js already gathers, so the reasoning can be tested without a
// transcript in sight.

// One notch down, not a cliff. Dropping xhigh to low on work that still has
// judgement in it costs more in rework than it saves; the ladder loses height
// a step at a time and 'critical' is the only posture that goes straight to
// the floor.
const NEXT_LOWER = { ultra: 'xhigh', none: 'none', minimal: 'minimal', max: 'high', xhigh: 'medium', high: 'medium', medium: 'low', low: 'low' };

// Below this share of output, reasoning is not where the money is going, and
// turning effort down would trade quality for a saving that is not there.
const REASONING_FLOOR = 0.1;

// Turns-left walls used when no job size is given. Ten turns is barely a
// feature; twenty-five is room for one, carefully.
const CRITICAL_TURNS = 10;
const TIGHT_TURNS = 25;

const HOUR = 60 * 60 * 1000;

// Where the mechanical bulk should go when it is delegated.
//
// The ladder below is an assumption: one tier down from whatever is doing the
// judgement, haiku being the floor. It is a reasonable assumption and it is
// still the fallback, but this account has measured the answer - what a call to
// each model has really cost here - and a measurement beats a ladder. On one
// machine the ladder said sonnet while the record said sonnet calls had cost
// $0.012 against Opus turns at $0.211, which is the same advice with a number
// behind it, and would have said haiku had haiku been the cheaper one.
function ladderModel(model) {
  const name = String(model || '').toLowerCase();
  if (name.indexOf('haiku') !== -1) return 'haiku';
  if (name.indexOf('sonnet') !== -1) return 'haiku';
  return 'sonnet';
}

// Whose family a model setting names, without requiring usage.js back: that
// would make these two modules a cycle.
function familyName(model) {
  const name = String(model || '').toLowerCase();
  for (const family of ['fable', 'mythos', 'opus', 'sonnet', 'haiku']) {
    if (name.indexOf(family) !== -1) return family === 'mythos' ? 'fable' : family;
  }
  return null;
}

function delegateModel(model, headroom) {
  const mine = familyName(model);
  const measured = (headroom || []).filter(
    (row) =>
      row &&
      row.family &&
      row.family !== mine &&
      Number.isFinite(row.usdPerTurn) &&
      row.usdPerTurn > 0 &&
      // A model whose own weekly is spent is not somewhere to send work.
      !(row.ownWindow && row.turnsLeft === 0)
  );
  if (!measured.length) return ladderModel(model);

  const cheapest = measured.reduce((best, row) => (row.usdPerTurn < best.usdPerTurn ? row : best));
  // Never up the ladder. If everything measured is dearer than what is already
  // running, delegating buys nothing and the assumption is the better answer.
  const here = (headroom || []).find((row) => row && row.family === mine);
  if (here && Number.isFinite(here.usdPerTurn) && cheapest.usdPerTurn >= here.usdPerTurn) {
    return ladderModel(model);
  }
  return cheapest.family;
}

// The effort actually in force. settings.json says 'default' when nothing is
// set, and the measured dominant effort of recent turns is better evidence
// than a guess; xhigh is what Claude Code defaults to when neither knows.
function currentEffort(settings, recentEffort) {
  const set = settings && settings.effortLevel;
  if (set && set !== 'default') return set;
  if (recentEffort) return recentEffort;
  return 'xhigh';
}

function decide(inputs) {
  const binding = inputs.binding;
  const rates = inputs.rates;
  const settings = inputs.settings || {};
  const effortNow = currentEffort(settings, inputs.recentEffort);
  const modelNow = (settings.model && settings.model !== 'default' && settings.model) || 'default';

  const base = {
    posture: 'unknown',
    reason: null,
    turnsLeft: null,
    effort: { current: effortNow, target: effortNow, changes: false, why: null },
    model: { current: modelNow, delegate: null, nextSession: null, why: null },
    apply: { now: null, next: null, delegate: null },
    notes: [],
  };

  if (!binding || binding.stale) {
    base.reason = 'no fresh reading of the binding window';
    return base;
  }
  if (!rates || !Number.isFinite(rates.median) || rates.median <= 0) {
    base.reason = 'no measured turn cost to price the budget in turns';
    return base;
  }
  if (!Number.isFinite(binding.usdPerPercent) || binding.usdPerPercent <= 0) {
    base.reason = 'the binding window has no calibrated price per point yet';
    return base;
  }

  const percentLeft = Number.isFinite(binding.percentLeft) ? binding.percentLeft : 0;
  const turnsLeft = Math.floor((percentLeft * binding.usdPerPercent) / rates.median);
  base.turnsLeft = turnsLeft;

  // When the clock wins the race, the limit is not the constraint and there
  // is nothing to buy by economising: whatever is left at the reset is lost.
  const pace = inputs.recentTurnsPerHour;
  if (
    Number.isFinite(binding.msToReset) &&
    binding.msToReset > 0 &&
    Number.isFinite(pace) &&
    pace > 0 &&
    (binding.msToReset / HOUR) * pace < turnsLeft * 0.8
  ) {
    base.posture = 'reset-first';
    base.reason = 'the window resets before this pace can spend it';
    base.effort.why = 'the budget is not the constraint';
    base.model.why = 'the budget is not the constraint';
    return base;
  }

  // With a job size, the forecast arithmetic decides. Without one, the raw
  // turns of headroom do. Both use the expensive end of the measured spread,
  // because that is the honest number for a long run.
  if (Number.isFinite(inputs.turns) && inputs.turns > 0) {
    const percentHigh = (inputs.turns * rates.high) / binding.usdPerPercent;
    if (percentHigh > percentLeft) {
      base.posture = 'critical';
      base.reason = 'a ' + inputs.turns + ' turn job does not fit in what is left';
    } else if (percentHigh > percentLeft * 0.75) {
      base.posture = 'tight';
      base.reason = 'a ' + inputs.turns + ' turn job fits, but only just';
    } else {
      base.posture = 'roomy';
      base.reason = 'a ' + inputs.turns + ' turn job fits with room to spare';
    }
  } else if (percentLeft <= 0 || turnsLeft <= 0) {
    base.posture = 'critical';
    base.reason = 'the binding window is spent';
  } else if (turnsLeft <= CRITICAL_TURNS) {
    base.posture = 'critical';
    base.reason = 'about ' + turnsLeft + ' turns of headroom';
  } else if (turnsLeft <= TIGHT_TURNS) {
    base.posture = 'tight';
    base.reason = 'about ' + turnsLeft + ' turns of headroom';
  } else {
    base.posture = 'roomy';
    base.reason = 'about ' + turnsLeft + ' turns of headroom';
  }

  if (base.posture === 'roomy') {
    base.effort.why = 'cheapness is not a virtue when the budget is not tight';
    base.model.why = 'cheapness is not a virtue when the budget is not tight';
    return base;
  }

  // Effort is the biggest per-turn lever, but only when reasoning is actually
  // where the money goes. The reasoning share is the ceiling on the saving,
  // so a small share means the honest advice is to leave effort alone.
  const share = inputs.reasoningShare;
  if (Number.isFinite(share) && share < REASONING_FLOOR) {
    base.effort.why =
      'reasoning is only ' + Math.round(share * 100) +
      '% of output, so effort is not where the money is going';
  } else {
    const target = base.posture === 'critical' ? (['none', 'minimal'].includes(effortNow) ? effortNow : 'low') : NEXT_LOWER[effortNow] || 'medium';
    if (target !== effortNow) {
      base.effort.target = target;
      base.effort.changes = true;
      base.effort.why =
        base.posture === 'critical'
          ? 'reasoning is billed as output, and low is the largest saving that changes nothing else'
          : 'one notch covers the mechanical stretches; keep judgement calls at full effort';
    } else {
      base.effort.why = 'already at the floor for this posture';
    }
  }

  if (inputs.codex) {
    // Claude's family ladder and slash commands do not describe Codex.
    base.model.why = 'Keep the current Codex model; select another supported model in the host controls when needed.';
    if (base.effort.changes) {
      base.apply.now = 'use the Codex model and effort controls and select ' + base.effort.target;
      base.apply.next = 'node scripts/lowpower.js on --host codex --effort ' + base.effort.target;
    }
    base.notes.push('Saved defaults affect new sessions, not the running task. Profiles and CLI overrides take precedence.');
    if (Number.isFinite(inputs.sessions) && inputs.sessions > 1)
      base.notes.push(inputs.sessions + ' sessions share this account budget.');
    return base;
  }

  // The main model is only worth flipping when things are critical, and even
  // then it lands in settings.json for the next session: switching the running
  // session's model mid-task invalidates the prompt cache, so the change
  // belongs at a session boundary.
  base.model.delegate = delegateModel(modelNow, inputs.headroom);
  const mine = (inputs.headroom || []).find((row) => row && row.family === familyName(modelNow));
  const there = (inputs.headroom || []).find((row) => row && row.family === base.model.delegate);
  // With both prices measured, say the saving rather than asserting one.
  const saving =
    mine && there && Number.isFinite(mine.usdPerTurn) && Number.isFinite(there.usdPerTurn) && there.usdPerTurn > 0
      ? ', measured here at ' + Math.round(mine.usdPerTurn / there.usdPerTurn) + 'x cheaper'
      : '';
  base.model.why =
    'keep ' + (modelNow === 'default' ? 'the current model' : modelNow) +
    ' for the judgement; the saving is in where the mechanical bulk runs' + saving;
  if (base.posture === 'critical' && base.model.delegate !== 'haiku') {
    base.model.nextSession = 'sonnet';
  }

  // The commands, spelled out, because the point of a recommendation is that
  // it can be acted on without working anything out.
  if (base.effort.changes) {
    base.apply.now = '/effort ' + base.effort.target;
  }
  if (inputs.codex) {
    base.notes.push(
      'Under Codex, settings.json is not in play: change model or effort through ' +
        "Codex's own controls."
    );
  } else if (base.effort.changes || base.model.nextSession) {
    const settingsEffort = base.effort.changes ? base.effort.target : effortNow;
    base.apply.next =
      'node scripts/lowpower.js on --effort ' +
      (settingsEffort === 'max' ? 'xhigh' : settingsEffort) +
      (base.model.nextSession ? ' --model ' + base.model.nextSession : '');
  }
  base.apply.delegate =
    'dispatch self-contained mechanical work to a subagent on ' +
    base.model.delegate +
    ' at low effort, and keep the judgement here';

  if (Number.isFinite(inputs.sessions) && inputs.sessions > 1) {
    base.notes.push(
      inputs.sessions + ' sessions are spending this budget at once, so the headroom ' +
        'drains faster than these figures alone suggest.'
    );
  }
  if (effortNow === 'max') {
    base.notes.push(
      "settings.json does not accept 'max', so a saved level can only go up to " +
        'xhigh; max survives only through /effort or CLAUDE_CODE_EFFORT_LEVEL.'
    );
  }

  return base;
}

// The report data usage.js gathers, reduced to what decide() reads.
function fromReport(data, turns) {
  return {
    binding: (data && data.binding) || null,
    headroom: (data && data.modelHeadroom) || null,
    rates: (data && data.rates) || null,
    settings: (data && data.settings) || {},
    recentEffort: data && data.recent ? data.recent.effort : null,
    recentTurnsPerHour: data && data.recent ? data.recent.turns : null,
    reasoningShare: data && data.reasoning ? data.reasoning.shareOfOutput : null,
    sessions: data && data.sessions ? data.sessions.length : 1,
    codex: Boolean(data && data.money === false),
    turns: Number.isFinite(turns) ? turns : null,
  };
}

// Local and small on purpose: requiring usage.js back for its formatters
// would make the two modules a cycle.
function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 'now';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return minutes + 'm';
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return hours + 'h ' + (minutes % 60) + 'm';
  return Math.floor(hours / 24) + 'd ' + (hours % 24) + 'h';
}

function renderRecommend(data, turns) {
  const decision = decide(fromReport(data, turns));
  const lines = [];
  lines.push('Recommendation' + (Number.isFinite(turns) && turns > 0 ? ' for ' + turns + ' turns' : ''));
  lines.push('');

  if (decision.posture === 'unknown') {
    lines.push('  Nothing to recommend yet: ' + decision.reason + '.');
    lines.push('  Run /usage once, do a little work, then ask again.');
    return lines.join('\n');
  }

  const binding = data.binding;
  const where =
    binding.label +
    ' window, ' +
    (Number.isFinite(binding.percentLeft) ? Math.max(0, Math.round(binding.percentLeft)) : '?') +
    '% left' +
    (Number.isFinite(binding.msToReset) ? ', resets in ' + fmtDuration(binding.msToReset) : '');
  lines.push('  Posture   ' + decision.posture + ' - ' + decision.reason + ' (' + where + ')');

  if (decision.posture === 'roomy' || decision.posture === 'reset-first') {
    lines.push('  Effort    keep ' + decision.effort.current + '; ' + decision.effort.why);
    lines.push('  Model     keep ' + decision.model.current + '; do not economise');
    return lines.join('\n');
  }

  if (decision.effort.changes) {
    lines.push('  Effort    ' + decision.effort.current + ' -> ' + decision.effort.target + '; ' + decision.effort.why);
    lines.push('            this session: ' + decision.apply.now + '   (only the user can run it)');
  } else {
    lines.push('  Effort    keep ' + decision.effort.current + '; ' + decision.effort.why);
  }
  if (decision.apply.next) {
    lines.push('            new sessions: ' + decision.apply.next);
  }
  lines.push('  Model     ' + decision.model.why);
  if (decision.apply.delegate) lines.push('            ' + decision.apply.delegate);
  if (decision.model.nextSession) {
    lines.push('            new sessions: main model to ' + decision.model.nextSession + ' until the window resets');
  }
  for (const note of decision.notes) {
    lines.push('  Note      ' + note);
  }
  return lines.join('\n');
}

module.exports = {
  decide,
  fromReport,
  familyName,
  ladderModel,
  renderRecommend,
  delegateModel,
  currentEffort,
  NEXT_LOWER,
  REASONING_FLOOR,
  CRITICAL_TURNS,
  TIGHT_TURNS,
};
