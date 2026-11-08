// Notes across context windows.
//
// Everything the model learns about the desktop - which window is which, what
// it granted, what it did and whether it worked - lives in a context window
// that compaction throws away. Codex's answer with GPT-6 Astra was to let the
// model keep notes across windows and search the earlier ones. The tool that
// holds the state is the right place to keep those notes: the server survives
// a compaction, so it can hand back what happened.
//
// One JSONL line per call, appended as it happens, in the same shared data dir
// the session registry lives in. `recap()` turns the tail of it into a few
// lines; `find()` searches all of it. The plugin's SessionStart hook prints the
// recap into context after a compaction or a resume, so the model gets its
// notes back without asking.

import fs from 'node:fs';
import path from 'node:path';

const KEEP = 600;
// A journal whose session died more than a week ago is of no use to anyone.
const PRUNE_MS = 7 * 24 * 60 * 60_000;

export function journalFile(dir, pid) {
  return path.join(dir, `${pid}.journal.jsonl`);
}

function clock(t) {
  const d = new Date(t);
  const two = (n) => String(n).padStart(2, '0');
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

function ago(ms) {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`;
  return `${(ms / 3_600_000).toFixed(1)} h ago`;
}

// One journal entry as one line of text. Same shape whether it is read live
// from memory or back off disk by the hook.
export function formatEntry(e) {
  let s = `${clock(e.t)} ${e.kind}`;
  if (e.summary) s += ` ${e.summary}`;
  if (e.title) s += ` in "${e.title}"${e.hwnd ? ` (hwnd ${e.hwnd})` : ''}`;
  else if (e.hwnd) s += ` (hwnd ${e.hwnd})`;
  if (e.ok === false) s += ` - FAILED${e.code ? ` ${e.code}` : ''}`;
  return s;
}

export function matcherFor(pattern) {
  const p = String(pattern || '').trim();
  const m = /^\/(.+)\/([a-z]*)$/i.exec(p);
  if (m) {
    // g and y make test() resume from lastIndex, and one matcher is tested
    // against every entry in turn, so they would skip matching entries.
    const flags = m[2].replace(/[gy]/gi, '');
    try { return new RegExp(m[1], flags.includes('i') ? flags : flags + 'i'); } catch { /* fall through */ }
  }
  const lower = p.toLowerCase();
  return { test: (s) => String(s).toLowerCase().includes(lower) };
}

// Renders entries (already read from wherever) into the recap text. Shared by
// the live tool and the hook, so both say the same thing the same way.
export function renderRecap(entries, { last = 30, find = null, now = Date.now(), head = null, extra = [] } = {}) {
  const lines = [];
  if (head) lines.push(head);
  for (const l of extra) if (l) lines.push(l);

  const notes = entries.filter((e) => e.kind === 'note');
  const acts = entries.filter((e) => e.kind !== 'note' && e.kind !== 'session');

  if (find) {
    const m = matcherFor(find);
    const hits = entries.filter((e) => e.kind !== 'session' && m.test(formatEntry(e)));
    lines.push(`journal entries matching ${JSON.stringify(String(find))}: ${hits.length}`);
    for (const e of hits.slice(-Math.max(last, 30))) lines.push('  ' + formatEntry(e));
    return lines.join('\n');
  }

  // Which windows this session has worked in, newest first, one line each.
  const seen = new Map();
  for (const e of acts) {
    if (!e.hwnd || !e.title) continue;
    seen.set(Number(e.hwnd), e);
  }
  if (seen.size) {
    lines.push('windows worked in (indices are still valid; computer_snapshot { hwnd, find } is the cheap way back):');
    for (const e of [...seen.values()].reverse().slice(0, 12)) {
      lines.push(`  "${e.title}" (${e.app ? e.app + ', ' : ''}hwnd ${e.hwnd}) - last ${e.kind} ${ago(now - e.t)}`);
    }
  }
  if (notes.length) {
    lines.push('notes:');
    for (const e of notes.slice(-20)) lines.push(`  ${clock(e.t)} ${e.summary}`);
  }
  if (acts.length) {
    const tail = acts.slice(-last);
    lines.push(`last ${tail.length} of ${acts.length} actions:`);
    for (const e of tail) lines.push('  ' + formatEntry(e));
  } else {
    lines.push('no actions yet this session.');
  }
  return lines.join('\n');
}

export function readJournal(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* a torn last line */ }
  }
  return out;
}

export class Journal {
  constructor({ dir, pid = process.pid, now = () => Date.now() } = {}) {
    this.dir = dir;
    this.pid = pid;
    this.now = now;
    this.file = journalFile(dir, pid);
    this.entries = [];
    this.sessionId = null;
    this.started = now();
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* append will report */ }
    // A pid reused after a reboot could otherwise inherit a stale journal.
    try { fs.unlinkSync(this.file); } catch { /* none to remove */ }
    this.prune();
  }

  append(e) {
    const entry = { t: this.now(), ...e };
    this.entries.push(entry);
    if (this.entries.length > KEEP) this.entries.shift();
    try { fs.appendFileSync(this.file, JSON.stringify(entry) + '\n'); } catch { /* memory copy still serves */ }
    return entry;
  }

  // Claude Code's session id arrives through the Stop hook. Once known it is
  // written into the journal, so the recap hook can find this file by id.
  identify(sessionId) {
    const id = String(sessionId || '').trim();
    if (!id || this.sessionId === id) return;
    this.sessionId = id;
    this.append({ kind: 'session', summary: id });
  }

  note(s) {
    return this.append({ kind: 'note', summary: String(s).replace(/\s+/g, ' ').trim().slice(0, 2000) });
  }

  find(pattern) {
    const m = matcherFor(pattern);
    return this.entries.filter((e) => e.kind !== 'session' && m.test(formatEntry(e)));
  }

  recap({ last = 30, find = null, extra = [] } = {}) {
    const now = this.now();
    const head = `Computer Use recap for this session (started ${clock(this.started)}, ${ago(now - this.started)})`;
    return renderRecap(this.entries, { last, find, now, head, extra });
  }

  // Journals of sessions long gone. Liveness is not checked here on purpose:
  // a journal is small, and the hook wants the one of a session that may have
  // crashed and been resumed.
  prune() {
    let names;
    try { names = fs.readdirSync(this.dir); } catch { return; }
    const cutoff = this.now() - PRUNE_MS;
    for (const n of names) {
      if (!n.endsWith('.journal.jsonl')) continue;
      const f = path.join(this.dir, n);
      try { if (fs.statSync(f).mtimeMs < cutoff) fs.unlinkSync(f); } catch { /* next time */ }
    }
  }
}
