'use strict';

// What one session has spent, kept as it goes.
//
// The report answers "how much is left". This answers the other question,
// "how much did that cost", at the moment it is most useful: right after a
// reply lands, and when the session closes. It is fed by the Stop and
// SessionEnd hooks, which run after every reply, so it has to be cheap in the
// common case. It is: each run reads only the bytes of the transcript that
// were written since the last one, and keeps the running totals on disk.
//
// A session's spend includes its subagents. Their transcripts are written
// beside the session's own, under <session id>/subagents/, and they are the
// same budget whichever file they landed in.

const fs = require('fs');
const os = require('os');
const path = require('path');

const usage = require('./usage.js');

const KEEP_SESSIONS = 50;

// Message ids remembered across sessions. A forked session copies the history
// it came from into a new file under a new id, and without these it would be
// billed for turns it never made.
const KEEP_IDS = 3000;

const IDS_KEY = '_ids';

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function stateFile() {
  const dir = usage.isCodex() ? require('./codex.js').homeDir() : configDir();
  return path.join(dir, 'usage-limits-sessions.json');
}

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    return {};
  }
}

// Atomic, because this file is read, changed and written back by the Stop hook
// of every session at once. A torn read here did not just lose one total: the
// reader parsed nothing, then wrote its own slot back as the whole file, and
// every other session's tally went with it.
function writeState(all) {
  // Never throws: losing the total costs one re-read of the transcript, and
  // failing the hook that runs after every reply is not worth avoiding that.
  usage.writeJsonAtomic(stateFile(), all);
}

function isSession(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function emptySession(project, cwd) {
  return {
    project: project || null,
    cwd: cwd || null,
    firstAt: null,
    lastAt: null,
    updatedAt: null,
    endedAt: null,
    reason: null,
    prompts: 0,
    turns: 0,
    subagentTurns: 0,
    tokens: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, reasoning: 0 },
    cost: 0,
    models: {},
    context: null,
    cursors: {},
    lastReply: null,
  };
}

// The complete lines written to a file since `from`, and where the next read
// should start. A line still being written is left for next time, which is
// why the cursor stops at the last newline rather than the end of the file.
function readNewLines(file, from) {
  let size;
  try {
    size = fs.statSync(file).size;
  } catch (err) {
    return { lines: [], next: Number.isFinite(from) && from > 0 ? from : 0, reset: false };
  }

  let start = Number.isFinite(from) && from > 0 ? from : 0;
  let reset = false;
  // Shorter than where we left off means the file was replaced. Read it again
  // from the top; the message ids stop anything being counted twice.
  if (size < start) {
    start = 0;
    reset = true;
  }
  if (size === start) return { lines: [], next: start, reset };

  const buffer = Buffer.alloc(size - start);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, buffer, 0, buffer.length, start);
  } finally {
    fs.closeSync(fd);
  }

  const lastNewline = buffer.lastIndexOf(0x0a);
  if (lastNewline === -1) return { lines: [], next: start, reset };

  const lines = buffer.subarray(0, lastNewline).toString('utf8').split('\n');
  return {
    lines: lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line)),
    next: start + lastNewline + 1,
    reset,
  };
}

// Where Claude Code writes the transcripts of the subagents a session spawned.
// Plain subagents write straight into <session>/subagents/; the agents a
// Workflow runs write under subagents/workflows/<run id>/. Both spend this
// session's budget.
function subagentFiles(transcriptPath, sessionId) {
  const dir = path.join(path.dirname(transcriptPath), sessionId, 'subagents');
  return usage.subagentTranscripts(dir, 0).sort();
}

function apply(session, event, sidechain, delta) {
  if (sidechain) {
    session.subagentTurns += 1;
    delta.subagentTurns += 1;
  } else {
    session.turns += 1;
    delta.turns += 1;
  }
  session.cost += event.cost;
  delta.cost += event.cost;
  delta.tokens += event.tokens;

  const parts = event.parts || {};
  session.tokens.input += parts.input || 0;
  session.tokens.cacheWrite += parts.cacheWrite || 0;
  session.tokens.cacheRead += parts.cacheRead || 0;
  session.tokens.output += parts.output || 0;
  session.tokens.reasoning += parts.reasoning || 0;

  const id = event.model || 'unknown';
  if (!session.models[id]) session.models[id] = { turns: 0, cost: 0 };
  session.models[id].turns += 1;
  session.models[id].cost += event.cost;

  // The context that matters is the main thread's own: that is what every
  // later call in this session re-reads.
  if (!sidechain && Number.isFinite(event.context)) session.context = event.context;

  if (session.firstAt === null || event.at < session.firstAt) session.firstAt = event.at;
  if (session.lastAt === null || event.at > session.lastAt) session.lastAt = event.at;
}

// Brings one session's totals up to date from its transcript and returns both
// the totals and what this call added, which is what the reply just finished
// cost. Mutates `all`, which the caller writes back.
function update(all, sessionId, transcriptPath, now, options) {
  const opts = options || {};
  const project = path.basename(path.dirname(transcriptPath));

  let session = all[sessionId];
  // A session seen for the first time may already have a long transcript
  // behind it, so what this call reads is "so far", not one reply.
  const created = !isSession(session);
  if (created) {
    session = emptySession(project, opts.cwd);
    all[sessionId] = session;
  }
  if (!session.project) session.project = project;
  if (opts.cwd) session.cwd = opts.cwd;
  if (!session.cursors || typeof session.cursors !== 'object') session.cursors = {};

  const seen = new Set(Array.isArray(all[IDS_KEY]) ? all[IDS_KEY] : []);
  const delta = { turns: 0, subagentTurns: 0, tokens: 0, cost: 0 };

  const files = [{ file: transcriptPath, sidechain: false }].concat(
    subagentFiles(transcriptPath, sessionId).map((file) => ({ file, sidechain: true }))
  );

  // Each subagent transcript is priced at the model its own records name. One
  // that names none is priced at this session's model: the newest main-thread
  // turn read here, or failing that the tail of the session transcript, read
  // only if a record actually asks.
  let mainModel = null;
  const readParent = usage.sessionModelReader(transcriptPath);
  const sessionModel = () => mainModel || readParent();

  for (const entry of files) {
    const key = path.resolve(entry.file);
    const read = readNewLines(entry.file, session.cursors[key]);
    for (const line of read.lines) {
      // The prompt that started a subagent was written by Claude, not typed.
      if (!entry.sidechain && usage.promptFrom(line)) {
        session.prompts += 1;
        continue;
      }
      const event = usage.eventFrom(line, seen, project, entry.sidechain ? sessionModel : null);
      if (!event || event.rejected) continue;
      if (!entry.sidechain && !event.sidechain && event.model) mainModel = event.model;
      apply(session, event, entry.sidechain || Boolean(event.sidechain), delta);
    }
    session.cursors[key] = read.next;
  }

  all[IDS_KEY] = [...seen].slice(-KEEP_IDS);
  session.updatedAt = now;
  // Only a reply that spent something replaces the last one, or a quiet stop
  // would report the previous reply as free. The first read of a session is
  // not a reply either.
  if (!created && (delta.turns || delta.subagentTurns)) {
    session.lastReply = {
      turns: delta.turns,
      subagentTurns: delta.subagentTurns,
      tokens: delta.tokens,
      cost: delta.cost,
    };
  }
  return { session, delta, created };
}

// Newest sessions first, and the remembered ids carried across.
function trim(all) {
  const kept = {};
  if (Array.isArray(all[IDS_KEY])) kept[IDS_KEY] = all[IDS_KEY];
  const keys = Object.keys(all || {}).filter((key) => key !== IDS_KEY && isSession(all[key]));
  keys.sort((a, b) => (all[b].lastAt || 0) - (all[a].lastAt || 0));
  for (const key of keys.slice(0, KEEP_SESSIONS)) kept[key] = all[key];
  return kept;
}

// Every session on record, newest last activity first.
function sessions(all) {
  return Object.keys(all || {})
    .filter((key) => key !== IDS_KEY && isSession(all[key]))
    .map((key) => Object.assign({ sessionId: key }, all[key]))
    .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
}

// What a point of the binding short window costs on this plan, so a session's
// spend can be said in the unit the limit is measured in. Absent until the
// report has learned it.
function pricing(now) {
  try {
    const base = usage.collect(now);
    const learned = usage.calibrationForPlan(usage.readCalibration(), base.planId).learned;
    const five = learned && learned.five_hour;
    if (five && Number.isFinite(five.usdPerPercent) && five.usdPerPercent > 0) {
      return { usdPerPercent: five.usdPerPercent, label: '5-hour' };
    }
  } catch (err) {
    // Fall through: the tally reads fine without a price per point.
  }
  return {};
}

// Two places, not the report's three-below-a-dollar: this is a total someone
// reads after every reply, not a per-turn price. Looked up at call time, not
// load time, because usage.js requires this module back.
function money(value) {
  return usage.formatMoney(value);
}

function count(value, noun) {
  const n = value || 0;
  return n + ' ' + noun + (n === 1 ? '' : 's');
}

function turnsPhrase(turns, subagentTurns) {
  return count(turns, 'turn') + (subagentTurns > 0 ? ' (+' + subagentTurns + ' subagent)' : '');
}

function totalTokens(tokens) {
  const t = tokens || {};
  return (t.input || 0) + (t.cacheWrite || 0) + (t.cacheRead || 0) + (t.output || 0);
}

// One line, tokens first because that is the question being answered. Every
// clause whose number is not known is left out rather than shown as a dash.
function formatTally(session, delta, options) {
  const opts = options || {};
  const change = delta || {};
  const parts = [];

  if ((change.turns || 0) + (change.subagentTurns || 0) > 0) {
    parts.push(
      'this reply: ' + turnsPhrase(change.turns, change.subagentTurns) + ', ' +
        usage.formatTokens(change.tokens || 0) + ' tokens, ' + money(change.cost || 0) + '.'
    );
  }

  const tokens = session.tokens || {};
  let line =
    'This session: ' + count(session.prompts, 'prompt') + ', ' +
    turnsPhrase(session.turns, session.subagentTurns) + ', ' +
    usage.formatTokens(totalTokens(tokens)) + ' tokens (' +
    usage.formatTokens(tokens.cacheRead || 0) + ' cache read, ' +
    usage.formatTokens(tokens.output || 0) + ' output), about ' + money(session.cost || 0);
  if (Number.isFinite(opts.usdPerPercent) && opts.usdPerPercent > 0) {
    const points = (session.cost || 0) / opts.usdPerPercent;
    if (points >= 1) {
      line += ', roughly ' + Math.round(points) + ' points of the ' + (opts.label || '5-hour') + ' window';
    }
  }
  parts.push(line + '.');

  if (Number.isFinite(session.context) && session.context > 0) {
    parts.push('Context is now about ' + usage.formatTokens(session.context) + ' tokens.');
  }

  return '[usage-limits] ' + parts.join(' ');
}

function formatClosed(session, now) {
  const end = Number.isFinite(session.endedAt) ? session.endedAt : now;
  const ran = Number.isFinite(session.firstAt) ? usage.formatDuration(Math.max(0, end - session.firstAt)) : null;
  return (
    '[usage-limits] session closed' + (ran ? ' after ' + ran : '') + ': ' +
    count(session.prompts, 'prompt') + ', ' + turnsPhrase(session.turns, session.subagentTurns) + ', ' +
    usage.formatTokens(totalTokens(session.tokens)) + ' tokens, about ' + money(session.cost || 0) + '.'
  );
}

// The hook is handed JSON on stdin. Shared by the two hooks that feed this.
function readHookInput() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve(null);
    let raw = '';
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      try {
        resolve(raw ? JSON.parse(raw) : null);
      } catch (err) {
        resolve(null);
      }
    };
    // Never hang a hook waiting for input that is not coming.
    const timer = setTimeout(done, 500);
    if (timer.unref) timer.unref();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      raw += chunk;
    });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
  });
}

module.exports = {
  KEEP_SESSIONS,
  KEEP_IDS,
  IDS_KEY,
  stateFile,
  readState,
  writeState,
  emptySession,
  readNewLines,
  subagentFiles,
  update,
  trim,
  sessions,
  pricing,
  money,
  totalTokens,
  formatTally,
  formatClosed,
  readHookInput,
};
