'use strict';

// Whether Claude is working right now, as told by the hooks that already run.
//
// The panel wants to animate while Claude works and sit still while it waits,
// and the hooks are the cheapest honest signal there is: the prompt hook
// fires when a turn starts, the tool hook fires after every tool call, and the
// Stop hook fires when the reply is done. Each one writes a few bytes here.
//
// One slot per session, because two windows can be in different states at
// once and a Stop in one must not make the other look idle.

const fs = require('fs');
const os = require('os');
const path = require('path');

const atomic = require('./atomic.js');

const KEEP_SESSIONS = 8;
// A session that has said nothing for this long is not working, whatever its
// last word was: a crash never sends Stop.
const STALE_MS = 15 * 60 * 1000;

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function activityFile() {
  return path.join(configDir(), 'usage-limits-activity.json');
}

function read() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(activityFile(), 'utf8'));
  } catch (err) {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const slots = {};
  for (const key of Object.keys(parsed)) {
    const value = parsed[key];
    if (value && typeof value === 'object' && Number.isFinite(value.at)) slots[key] = value;
  }
  return slots;
}

function trim(all, keep) {
  const ordered = Object.keys(all).sort((a, b) => (all[b].at || 0) - (all[a].at || 0));
  const kept = {};
  for (const key of ordered.slice(0, keep || KEEP_SESSIONS)) kept[key] = all[key];
  return kept;
}

// Record a state for a session. Never throws: this runs inside hooks, and a
// hook that fails over a status file would be far worse than a panel that
// animates a little late.
function mark(state, sessionId, extra, now) {
  try {
    const all = read();
    const previous = all[sessionId || '_'] || {};
    const entry = {
      at: Number.isFinite(now) ? now : Date.now(),
      state: state === 'working' ? 'working' : 'idle',
      // The keyword is per prompt, so a Stop keeps what the prompt said and the
      // next prompt says again.
      ultracode: extra && typeof extra.ultracode === 'boolean' ? extra.ultracode : Boolean(previous.ultracode),
      ultrathink: extra && typeof extra.ultrathink === 'boolean' ? extra.ultrathink : Boolean(previous.ultrathink),
    };
    if (extra && extra.model) entry.model = String(extra.model);
    else if (previous.model) entry.model = previous.model;
    all[sessionId || '_'] = entry;
    // A rename Windows refused leaves nothing behind: see atomic.js.
    return atomic.tryWriteFileAtomic(activityFile(), JSON.stringify(trim(all)));
  } catch (err) {
    return false;
  }
}

// The picture across every session: is anything working, and is the most
// recently active working session in ultracode.
function summarise(all, now) {
  const at = Number.isFinite(now) ? now : Date.now();
  let working = null;
  let newest = null;
  for (const key of Object.keys(all || {})) {
    // A mark with no session id cannot be attributed, so it is nobody's: the
    // summary and the sessions list must agree about who is working.
    if (key === '_') continue;
    const entry = all[key];
    if (!entry || !Number.isFinite(entry.at)) continue;
    if (at - entry.at > STALE_MS) continue;
    if (!newest || entry.at > newest.at) newest = entry;
    if (entry.state === 'working' && (!working || entry.at > working.at)) working = entry;
  }
  return {
    working: Boolean(working),
    ultracode: Boolean(working ? working.ultracode : newest && newest.ultracode),
    ultrathink: Boolean(working ? working.ultrathink : newest && newest.ultrathink),
    model: (working && working.model) || (newest && newest.model) || null,
    at: newest ? newest.at : null,
  };
}

// Every Claude on this machine that has been heard from lately, one row per
// session, from all the places the plugin hears about them: the hook marks
// (working or idle), the status line feed (model, effort, directory), the
// Stop hook's tally (project, cost, turns) and the prompt hook's cache (when
// it last prompted). A session is listed if any of them saw it within the
// window; it is "working" only if its own mark says so and is fresh.
function combine(sources, now, windowMs) {
  const at = Number.isFinite(now) ? now : Date.now();
  const within = Number.isFinite(windowMs) ? windowMs : STALE_MS;
  const src = sources || {};
  const rows = new Map();

  const touch = (id, seenAt) => {
    if (!id || id === '_') return null;
    let row = rows.get(id);
    if (!row) {
      row = {
        sessionId: id,
        lastAt: 0,
        state: 'idle',
        stateAt: null,
        ultracode: false,
        ultrathink: false,
        model: null,
        modelName: null,
        effort: null,
        cwd: null,
        project: null,
        cost: null,
        turns: null,
      };
      rows.set(id, row);
    }
    if (Number.isFinite(seenAt) && seenAt > row.lastAt) row.lastAt = seenAt;
    return row;
  };

  for (const id of Object.keys(src.marks || {})) {
    const m = src.marks[id];
    if (!m || !Number.isFinite(m.at)) continue;
    const row = touch(id, m.at);
    if (!row) continue;
    row.stateAt = m.at;
    row.state = m.state === 'working' && at - m.at <= within ? 'working' : 'idle';
    row.ultracode = Boolean(m.ultracode);
    row.ultrathink = Boolean(m.ultrathink);
    if (m.model && !row.model) row.model = m.model;
  }
  for (const id of Object.keys(src.feed || {})) {
    const s = src.feed[id];
    if (!s || !Number.isFinite(s.at)) continue;
    const row = touch(id, s.at);
    if (!row) continue;
    if (s.model) row.model = s.model;
    if (s.modelName) row.modelName = s.modelName;
    if (s.effort) row.effort = s.effort;
    if (s.cwd) row.cwd = s.cwd;
  }
  for (const s of Array.isArray(src.tally) ? src.tally : []) {
    if (!s || !s.sessionId) continue;
    const row = touch(s.sessionId, s.lastAt);
    if (!row) continue;
    if (s.project) row.project = s.project;
    if (Number.isFinite(s.cost)) row.cost = s.cost;
    if (Number.isFinite(s.turns)) row.turns = s.turns;
  }
  for (const id of Object.keys(src.brief || {})) {
    const b = src.brief[id];
    if (b && Number.isFinite(b.at)) touch(id, b.at);
  }

  return [...rows.values()]
    .filter((row) => at - row.lastAt <= within)
    .sort((a, b) => b.lastAt - a.lastAt);
}

module.exports = {
  KEEP_SESSIONS,
  STALE_MS,
  activityFile,
  read,
  mark,
  trim,
  summarise,
  combine,
};
