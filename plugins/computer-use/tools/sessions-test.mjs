// Two Claudes on one desktop.
//
// Everything here runs against a temporary registry directory with injected
// time and liveness, so the awkward cases - a session that died holding the
// lease, a clock that has moved on, two sessions claiming at the same instant -
// are tested directly instead of being hoped for.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Sessions, LeaseBusy } from '../server/sessions.mjs';

let pass = 0, fail = 0; const failures = [];
const check = (n, c, d) => {
  if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; failures.push(n); console.log(`  FAIL ${n}${d ? ' :: ' + d : ''}`); }
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-sessions-'));

// Pids we control: 1001 and 1002 are "alive", 1003 died.
const LIVE = new Set([1001, 1002]);
let clock = 1_000_000;
const mk = (pid, opts = {}) => new Sessions({
  dir: root,
  pid,
  now: () => clock,
  isAlive: (p) => LIVE.has(Number(p)),
  sleep: async (ms) => { clock += ms; },
  ...opts,
});

console.log('\n-- registration and slots --');
const a = mk(1001);
a.register();
check('first session takes slot 0', a.slot === 0, String(a.slot));
check('first session is called session 1', a.label === 'session 1', a.label);
check('it can see no peers', a.peers().length === 0);

const b = mk(1002);
b.register();
check('second session takes slot 1', b.slot === 1, String(b.slot));
check('second session is called session 2', b.label === 'session 2', b.label);
check('each session sees the other', a.peers().length === 1 && b.peers().length === 1);
check('a session never lists itself', a.peers().every((p) => p.pid !== 1001));

console.log('\n-- two sessions starting at the same instant --');
{
  // Both see slot 1 free and both take it. Without a tie-break that is two
  // banners drawn on top of each other, which is the failure slots exist to
  // prevent. The lower pid keeps it.
  LIVE.add(2001); LIVE.add(2002);
  const hi = mk(2002);
  hi.register();
  check('an ordinary new session takes the next free slot', hi.slot === 2, String(hi.slot));

  // Stage the race itself: this session's first look finds an empty directory,
  // exactly as it would if it read a moment before anyone else had written.
  const lo = mk(2001);
  const realPeers = lo.peers.bind(lo);
  let blind = true;
  lo.peers = () => { if (blind) { blind = false; return []; } return realPeers(); };
  lo.register();

  check('a session that claimed a taken slot moves off it', lo.slot !== 0, String(lo.slot));
  check('no two live sessions share a slot',
    new Set([a.slot, b.slot, hi.slot, lo.slot]).size === 4,
    JSON.stringify([a.slot, b.slot, hi.slot, lo.slot]));
  check('and its label follows its slot', lo.label === 'session ' + (lo.slot + 1), lo.label);
  hi.close(); lo.close();
  LIVE.delete(2001); LIVE.delete(2002);
}

console.log('\n-- a session that died is pruned, not believed --');
const dead = mk(1003);
dead.register();
check('a dead pid is dropped from peers', a.peers().length === 1, JSON.stringify(a.peers().map((p) => p.pid)));
check('its registration file is removed', !fs.existsSync(path.join(root, '1003.json')));

console.log('\n-- a quiet session is idle, not gone --');
LIVE.add(1004);
const quiet = mk(1004);
quiet.register();
check('a fresh live session is seen', a.peers().length === 2);
clock += 120_000;   // past STALE_MS, nothing has heartbeat
const quietPeers = a.peers();
check('a live session that has gone quiet keeps its registration', quietPeers.length === 2,
  JSON.stringify(quietPeers.map((p) => p.pid)));
check('and is reported as idle rather than active', quietPeers.every((p) => p.idle === true),
  JSON.stringify(quietPeers.map((p) => p.idle)));
check('its slot is not handed to a new session', (() => {
  LIVE.add(1005);
  const n = mk(1005);
  n.register();
  const got = n.slot;
  n.close();
  LIVE.delete(1005);
  return got === 3;
})(), 'slots 0-2 are taken, so a fourth session must get slot 3');
b.heartbeat();
check('a heartbeat clears idle', a.peers().find((p) => p.pid === 1002).idle === false);

console.log('\n-- but a pid quiet for half an hour has been reused, and is let go --');
clock += 31 * 60_000;
b.heartbeat();
check('the abandoned record is dropped', !a.peers().some((p) => p.pid === 1004),
  JSON.stringify(a.peers().map((p) => p.pid)));
check('the one still breathing is kept', a.peers().some((p) => p.pid === 1002));
LIVE.delete(1004);

console.log('\n-- the input lease is exclusive --');
let bRan = false;
let released = null;
const holding = a.withInput('click', { hwnd: 7, title: 'T' }, async () => {
  // While a holds it, b must not get in.
  const t0 = clock;
  let err = null;
  try {
    await b.withInput('type', { hwnd: 7 }, async () => { bRan = true; }, { waitMs: 500 });
  } catch (e) { err = e; }
  released = { err, waited: clock - t0 };
  return 'a-done';
});
const aResult = await holding;
check('the holder runs', aResult.valueOf() === 'a-done' || aResult === 'a-done', String(aResult));
check('the other session is refused while it is held', released.err instanceof LeaseBusy,
  released.err ? released.err.code : 'no error');
check('the refusal carries a code the model can branch on',
  released.err && released.err.code === 'another_session_busy');
check('the other session never ran its action', bRan === false);
check('it waited for the whole budget first', released.waited >= 500, String(released.waited));

console.log('\n-- and it is released afterwards --');
let ran2 = false;
await b.withInput('type', { hwnd: 7 }, async () => { ran2 = true; });
check('the next session gets the lease once it is free', ran2 === true);
check('no lease file is left behind', !fs.existsSync(path.join(root, 'input.lease')));

console.log('\n-- a lease held by a session that died is taken, not waited on --');
fs.writeFileSync(path.join(root, 'input.lease'),
  JSON.stringify({ pid: 1003, label: 'session 9', op: 'click', at: clock }));
let stolen = false;
await a.withInput('click', null, async () => { stolen = true; }, { waitMs: 1000 });
check('a dead holder loses the lease', stolen === true);

console.log('\n-- and one held impossibly long expires --');
fs.writeFileSync(path.join(root, 'input.lease'),
  JSON.stringify({ pid: 1002, label: 'session 2', op: 'click', at: clock - 60_000 }));
let expired = false;
await a.withInput('click', null, async () => { expired = true; }, { waitMs: 1000 });
check('a lease older than any real action expires', expired === true);
try { fs.unlinkSync(path.join(root, 'input.lease')); } catch {}

console.log('\n-- releasing never drops a lease that is not ours --');
fs.writeFileSync(path.join(root, 'input.lease'),
  JSON.stringify({ pid: 1002, label: 'session 2', op: 'click', at: clock }));
a._release();
check('another session\'s live lease survives our release', fs.existsSync(path.join(root, 'input.lease')));
try { fs.unlinkSync(path.join(root, 'input.lease')); } catch {}

console.log('\n-- two calls from ONE session queue instead of racing --');
const order = [];
const slow = a.withInput('click', null, async () => {
  order.push('first-in');
  await new Promise((r) => setTimeout(r, 60));
  order.push('first-out');
});
const fast = a.withInput('click', null, async () => { order.push('second-in'); });
await Promise.all([slow, fast]);
check('one session never interleaves its own actions',
  order.join(',') === 'first-in,first-out,second-in', order.join(','));

console.log('\n-- a failing action still gives the lease back --');
try {
  await a.withInput('click', null, async () => { throw new Error('boom'); });
} catch { /* expected */ }
check('a thrown action releases the lease', !fs.existsSync(path.join(root, 'input.lease')));
let after = false;
await b.withInput('click', null, async () => { after = true; });
check('the next session is not locked out by it', after === true);

console.log('\n-- a registry it cannot write to never blocks the machine --');
{
  // A read-only volume, a locked-down profile, a directory that is really a
  // file. Serialising between sessions is a courtesy; refusing to act at all
  // because a lock file cannot be created would turn a permissions problem into
  // "another Claude session is busy" on every single action, forever.
  const blocker = path.join(root, 'not-a-directory');
  fs.writeFileSync(blocker, 'this is a file, so nothing can live inside it');
  const stuck = new Sessions({
    dir: path.join(blocker, 'sessions'),
    pid: 1001,
    now: () => clock,
    isAlive: (p) => LIVE.has(Number(p)),
    sleep: async (ms) => { clock += ms; },
  });
  stuck.register();

  let ran = false;
  const t0 = clock;
  await stuck.withInput('click', null, async () => { ran = true; }, { waitMs: 5000 });
  check('the action still runs', ran === true);
  check('and it does not sit out the wait budget first', clock - t0 === 0, `${clock - t0}ms`);
  check('the loss of serialisation is admitted, not hidden',
    stuck.describe().includes('UNAVAILABLE'), stuck.describe());
  check('and it does not claim phantom peers', stuck.peers().length === 0);
}

console.log('\n-- what the model is told --');
a.heartbeat({ last_op: 'click', last_at: clock, last_hwnd: 4242, last_title: 'Inbox' });
const note = b.note(4242);
check('a peer is named', note.includes('session 1'), note);
check('what it last did is named', note.includes('click'), note);
check('the same window is called out as a conflict', note.toUpperCase().includes('WARNING'), note);
check('a different window is not', !b.note(9999).toUpperCase().includes('WARNING'), b.note(9999));
check('with no peers there is nothing to say', mk(1001).note(4242) === '' || a.peers().length > 0);

const desc = b.describe();
check('status names this session', desc.includes('session 2'), desc);
check('status names the other one', desc.includes('session 1'), desc);
check('status says grants are not shared', desc.includes('never shared'), desc);

console.log('\n-- pre-approvals: until the session ends, never on disk --');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-preapprove-'));
  const clockWas = clock;
  const mkp = (pid, sessionId) => new Sessions({ dir, pid, now: () => clock, isAlive: (x) => LIVE.has(Number(x)), sessionId });
  const s = mkp(1001, 'conv-A');
  s.register();
  const e = s.preApprove('outlook', 'send', { source: 'user_typed' });
  check('a pre-approval is kept for the session', s.preApproved('outlook', 'send') === e);
  check('it names the conversation it was given in', e.session_id === 'conv-A', e.session_id);
  check('it covers that control only', s.preApproved('outlook', 'reply all') === null);
  check('and that app only', s.preApproved('thunderbird', 'send') === null);
  clock += 6 * 3600_000;
  s.heartbeat({ last_op: 'click' });
  check('it still holds hours later, while the session lives', !!s.preApproved('outlook', 'send'));
  const onDisk = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  check('it is never written to the registration file', !/outlook|preappro|user_typed/i.test(onDisk), onDisk);
  check('listed for status', s.listPreApprovals().length === 1);

  s.preApprove('slack', 'post', { source: 'user_typed' });
  check('revoking one app ends only that app\'s', s.endPreApprovals('slack') === 1 && !!s.preApproved('outlook', 'send'));

  s.setSessionId('conv-A');
  check('the same conversation id keeps them', !!s.preApproved('outlook', 'send'));
  s.setSessionId('conv-B');
  check('another conversation\'s id ends them', s.preApproved('outlook', 'send') === null);

  const late = mkp(1002, null);
  late.register();
  late.preApprove('outlook', 'send', { source: 'user_typed' });
  late.setSessionId('conv-C');
  check('a server that learns its own id late keeps them', !!late.preApproved('outlook', 'send'));
  late.close();
  check('closing the session ends them', late.preApproved('outlook', 'send') === null && late.listPreApprovals().length === 0);

  s.preApprove('outlook', 'send', { source: 'user_typed' });
  const resumed = mkp(1002, 'conv-B');
  resumed.register();
  check('a resumed conversation (same id, new process) starts with none', resumed.preApproved('outlook', 'send') === null);
  check('while the old process still has its own', !!s.preApproved('outlook', 'send'));
  resumed.close();
  s.close();
  clock = clockWas;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

console.log('\n-- leaving --');
b.close();
check('closing deregisters', !fs.existsSync(path.join(root, '1002.json')));
check('the last session sees an empty machine', a.peers().length === 0);

const solo = mk(1001);
solo.register();
check('a session starting alone reclaims slot 0', solo.slot === 0, String(solo.slot));

a.close();
try { fs.rmSync(root, { recursive: true, force: true }); } catch {}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('failures: ' + failures.join(', ')); process.exit(1); }
