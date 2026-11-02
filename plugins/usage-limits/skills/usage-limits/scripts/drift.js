'use strict';

// A ledger of how wrong the reading was, measured instead of argued about.
//
// The known complaint about this plugin is that its numbers lag reality
// mid-session - reading.js exists because of one measured instance of it (13%
// shown, 73% actual). But "it lags" is an anecdote until someone can say by
// how much, how often, and whether it is getting better or worse as the
// plugin changes. So every time reading.js records a fresh, trustworthy
// correction for a window, and there was already a figure sitting there for
// readers to trust, this writes down what that older figure said next to what
// the new one says. The gap between them is the drift a real session lived
// through between two corrections.
//
// Same constraints as reading.js: cheap, bounded, and it must never be the
// reason a hook is late or fails.

const fs = require('fs');
const os = require('os');
const path = require('path');

const atomic = require('./atomic.js');
const host = require('./host.js');
const codex = require('./codex.js');

// Not "how many windows" but "how many measurements": a busy day produces a
// handful of corrections per window, and a fixed cap keeps the file the same
// size whether the plugin has run for a day or a year.
const MAX_ENTRIES = 200;

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function driftFile(codexHome) {
  return path.join(codexHome || configDir(), 'usage-limits-drift.json');
}

// The other measurement that belongs here: what a turn actually cost while
// each budget mode was on. Same file, same bounded append, for the same
// reason - it is an after-the-fact measurement of a prediction, and a second
// store would be a second thing to keep correct. Modes should be evidence
// rather than vibes, and this is where the evidence lands.
const MAX_MODE_ENTRIES = 400;

function read(codexHome) {
  try {
    const parsed = JSON.parse(fs.readFileSync(driftFile(codexHome), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return { entries: [] };
    const state = { entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
    // The mode ledger is carried only when the file actually has one. A reader
    // that has never recorded a mode gets back exactly the shape it wrote, so
    // adding this second ledger did not change what the first one reads.
    if (Array.isArray(parsed.modes)) state.modes = parsed.modes;
    return state;
  } catch (err) {
    return { entries: [] };
  }
}

// One reply, priced, tagged with the mode that was in force while it ran.
// Called from the Stop hook, which already has the exact figures.
function recordTurns(mode, turns, cost, now, codexHome) {
  if (!mode || !Number.isFinite(turns) || turns <= 0) return false;
  try {
    const state = read(codexHome);
    if (!Array.isArray(state.modes)) state.modes = [];
    state.modes.push({
      mode: String(mode),
      at: Number.isFinite(now) ? now : Date.now(),
      turns,
      cost: Number.isFinite(cost) ? cost : 0,
    });
    if (state.modes.length > MAX_MODE_ENTRIES) state.modes = state.modes.slice(-MAX_MODE_ENTRIES);
    writeAtomic(driftFile(codexHome), state);
    return true;
  } catch (err) {
    return false;
  }
}

// Turns and observed cost per turn, per mode. Only what was measured: a mode
// nothing has run in is absent rather than shown at zero, because a zero here
// reads as "free" when it means "unknown".
function modeSummary(codexHome) {
  const rows = {};
  for (const entry of read(codexHome).modes || []) {
    if (!entry || !entry.mode || !Number.isFinite(entry.turns)) continue;
    const row = rows[entry.mode] || (rows[entry.mode] = { mode: entry.mode, turns: 0, usd: 0 });
    row.turns += entry.turns;
    row.usd += Number.isFinite(entry.cost) ? entry.cost : 0;
  }
  return Object.keys(rows)
    .map((key) => {
      const row = rows[key];
      return {
        mode: row.mode,
        turns: row.turns,
        usd: row.usd,
        usdPerTurn: row.turns > 0 && row.usd > 0 ? row.usd / row.turns : null,
      };
    })
    .sort((a, b) => b.turns - a.turns);
}

// Same beside-and-rename as reading.js: the pulse and the prompt hook can both
// land here in the same second. A refused rename is retried, and on failure
// the temporary file is removed before this throws: see atomic.js.
function writeAtomic(file, data) {
  atomic.writeFileAtomic(file, JSON.stringify(data));
}

// `previous` and `next` are both entries in reading.js's own shape - see
// reading.record(). Called from there, right before it overwrites the slot,
// so `previous` is what readers were trusting and `next` is what the fresh
// scan just found for the same window.
function record(key, previous, next, now, codexHome) {
  if (!key || !previous || !next) return false;
  if (!Number.isFinite(previous.percentUsed) || !Number.isFinite(next.percentUsed)) return false;
  if (!Number.isFinite(previous.at)) return false;
  const at = Number.isFinite(now) ? now : Date.now();
  // A window that reset between the two readings did not "drift" - it started
  // over, and treating the jump as error would swamp every real measurement.
  if (Number.isFinite(previous.resetsAt) && previous.resetsAt <= next.at) return false;
  try {
    const state = read(codexHome);
    state.entries.push({
      key,
      at,
      // How long the older figure had been sitting in front of readers before
      // this measurement replaced it - a drift found after two minutes and
      // one found after twenty are not the same kind of evidence.
      ageMs: Math.max(0, next.at - previous.at),
      predictedPercentUsed: previous.percentUsed,
      actualPercentUsed: next.percentUsed,
      percentDrift: next.percentUsed - previous.percentUsed,
      predictedTurnsLeft: Number.isFinite(previous.turnsLeft) ? previous.turnsLeft : null,
      actualTurnsLeft: Number.isFinite(next.turnsLeft) ? next.turnsLeft : null,
    });
    if (state.entries.length > MAX_ENTRIES) state.entries = state.entries.slice(-MAX_ENTRIES);
    writeAtomic(driftFile(codexHome), state);
    return true;
  } catch (err) {
    return false;
  }
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// What the ledger has actually shown: the typical gap and the worst one, in
// percentage points, over whatever window filter is asked for (default:
// everything on record). Turns get the same treatment where both sides of a
// pair have a turns figure to compare.
function summary(codexHome, options) {
  const opts = options || {};
  const state = read(codexHome);
  let entries = state.entries;
  if (opts.key) entries = entries.filter((e) => e.key === opts.key);
  if (!entries.length) return { sample: 0, medianAbsPercent: null, worstAbsPercent: null, medianAbsTurns: null, worstAbsTurns: null };

  const percentAbs = entries.map((e) => Math.abs(e.percentDrift));
  const turnsAbs = entries
    .filter((e) => Number.isFinite(e.predictedTurnsLeft) && Number.isFinite(e.actualTurnsLeft))
    .map((e) => Math.abs(e.actualTurnsLeft - e.predictedTurnsLeft));

  // A number of points on its own says nothing: sixty points off is a scandal
  // over two minutes and unremarkable over five hours. The gap the figure was
  // wrong for is what makes it readable, and it is already on every entry.
  const ages = entries.map((e) => e.ageMs).filter((ms) => Number.isFinite(ms));
  const worst = entries.reduce(
    (found, e) => (!found || Math.abs(e.percentDrift) > Math.abs(found.percentDrift) ? e : found),
    null
  );

  return {
    sample: entries.length,
    medianAbsPercent: median(percentAbs),
    worstAbsPercent: percentAbs.length ? Math.max(...percentAbs) : null,
    medianAbsTurns: turnsAbs.length ? median(turnsAbs) : null,
    worstAbsTurns: turnsAbs.length ? Math.max(...turnsAbs) : null,
    medianGapMs: ages.length ? median(ages) : null,
    worstGapMs: worst && Number.isFinite(worst.ageMs) ? worst.ageMs : null,
  };
}

// Minutes, because that is the scale a correction interval lives on and the
// only one anybody compares against the pulse interval.
function gap(ms) {
  if (!Number.isFinite(ms)) return null;
  const minutes = ms / 60000;
  return (minutes >= 10 ? Math.round(minutes) : Math.round(minutes * 10) / 10) + 'm';
}

function describe(codexHome) {
  const stats = summary(codexHome);
  if (!stats.sample) return 'Drift ledger: no corrections measured against an earlier one yet.';
  const lines = [];
  lines.push('Drift ledger: ' + stats.sample + ' measured correction' + (stats.sample === 1 ? '' : 's') + '.');
  const medianGap = gap(stats.medianGapMs);
  const worstGap = gap(stats.worstGapMs);
  lines.push(
    '  Percent used: median ' + fmt(stats.medianAbsPercent) + ' points off' +
      (medianGap ? ' over a typical ' + medianGap + ' gap' : '') + ', worst ' +
      fmt(stats.worstAbsPercent) + ' points off' + (worstGap ? ' over ' + worstGap : '') + '.'
  );
  if (stats.medianAbsTurns !== null) {
    lines.push(
      '  Turns left: median ' + fmt(stats.medianAbsTurns) + ' off, worst ' + fmt(stats.worstAbsTurns) + ' off.'
    );
  }
  return lines.join('\n');
}

function fmt(value) {
  if (!Number.isFinite(value)) return '-';
  return Math.round(value * 10) / 10;
}

function activeCodexHome(argv, env) {
  return host.detect(argv, env) === host.CODEX ? codex.homeDir() : null;
}

function main(argv) {
  const args = argv || [];
  const codexHome = activeCodexHome(args, process.env);
  if (args[0] === '--json') return JSON.stringify(summary(codexHome, {}), null, 2);
  return describe(codexHome);
}

if (require.main === module) {
  process.stdout.write(main(process.argv.slice(2)) + '\n');
  process.exit(0);
}

module.exports = {
  MAX_ENTRIES,
  MAX_MODE_ENTRIES,
  configDir,
  driftFile,
  gap,
  read,
  record,
  recordTurns,
  modeSummary,
  summary,
  describe,
  main,
};
