// SessionStart hook (matcher: compact|resume). Prints this session's Computer
// Use journal so the notes come back into context after a compaction, the way
// Codex keeps notes across context windows. Plain text on stdout is what Claude
// Code adds as context; nothing on stdout means nothing to say.
//
// Never fails: a hook that errors would show up on every compaction of every
// session, including ones that never touched the desktop.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  let input = '';
  try {
    input = await new Promise((resolve) => {
      let s = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (d) => { s += d; });
      process.stdin.on('end', () => resolve(s));
      process.stdin.on('error', () => resolve(s));
      setTimeout(() => resolve(s), 1500).unref();
    });
  } catch { /* no input */ }
  let hook = {};
  try { hook = JSON.parse(input || '{}'); } catch { /* not json */ }
  const sessionId = String(hook.session_id || '').trim();
  const cwd = String(hook.cwd || '').trim();

  const { renderRecap, readJournal } = await import('../server/journal.mjs');
  let dir = String(process.argv[2] || '').trim();
  if (!dir || dir.includes('${')) {
    const { dataDir } = await import('../server/build.mjs');
    dir = dataDir();
  }
  dir = path.join(dir, 'sessions');

  let names;
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.journal.jsonl')); } catch { return; }
  if (!names.length) return;

  const candidates = [];
  for (const n of names) {
    const file = path.join(dir, n);
    const entries = readJournal(file);
    if (!entries.length) continue;
    const pid = Number(n.split('.')[0]);
    const ids = entries.filter((e) => e.kind === 'session').map((e) => e.summary);
    let reg = null;
    try { reg = JSON.parse(fs.readFileSync(path.join(dir, `${pid}.json`), 'utf8')); } catch { /* gone */ }
    candidates.push({ file, pid, entries, ids, reg, mtime: fs.statSync(file).mtimeMs });
  }
  if (!candidates.length) return;

  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return !!(e && e.code === 'EPERM'); } };

  // Best match first: the journal that names this session id; else a live
  // session started from this working directory; else nothing (a guess would
  // put another session's notes in front of this one).
  let pick = null;
  if (sessionId) {
    const named = candidates.filter((c) => c.ids.includes(sessionId));
    // A resume starts a new server pid with a fresh journal, and once its
    // first Stop hook fires both it and the dead pid's old journal carry the
    // same session id. readdirSync order is alphabetical by pid, not by
    // time, so the live process's journal - the one "the server is still
    // running" is actually true of - has to be preferred explicitly rather
    // than taking whichever sorts first.
    pick = named.find((c) => alive(c.pid)) || named.sort((a, b) => b.mtime - a.mtime)[0] || null;
  }
  if (!pick && cwd) {
    const same = candidates.filter((c) => c.reg && String(c.reg.cwd || '') === cwd && alive(c.pid));
    // Exactly one live session at this cwd is a safe guess. More than one -
    // not uncommon, several sessions often share a project directory - leaves
    // no way to tell which is actually this one before its own first Stop
    // hook writes the id, and a guess would put another session's notes in
    // front of this one, so nothing is printed rather than risking that.
    if (same.length === 1) pick = same[0];
  }
  if (!pick) return;
  const acts = pick.entries.filter((e) => e.kind !== 'session');
  if (!acts.length) return;

  // A resume always starts a fresh server process, even when the one we
  // picked is (of course) alive - its grants and the host's snapshots do not
  // carry over from before the resume. Say so instead of claiming state that
  // is not there.
  const stale = hook.source === 'resume' || !alive(pick.pid);
  const head = stale
    ? 'Computer Use journal for this session, restored after the compaction. The server has restarted since this was written: '
      + 'grants, window handles and element indices are gone and must be re-established. Call computer_recap for the live state or to search further back.'
    : 'Computer Use journal for this session, restored after the compaction. The server is still running: '
      + 'grants, window handles and element indices are intact. Call computer_recap for the live state or to search further back.';
  process.stdout.write(renderRecap(pick.entries, { last: 25, head }) + '\n');
}

main().catch(() => { /* silent by design */ });
