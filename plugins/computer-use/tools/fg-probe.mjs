// Which actions leave a background window where it is, and which raise it.
//
// Not part of test-all: it answers a question about the UI framework under the
// app, so its answer is different for WinForms, Chromium, WPF and WinUI. Point
// it at a toolkit before promising a user that Claude can work behind their
// window. It also answers, every time it runs, whether a step inside a run
// disturbs more than the same action as a single call - the two columns must
// agree, and if they ever stop agreeing that is this plugin's bug.
//
// Measured on WinForms, 2026-09-04: reads and posted typing stay behind; a
// pattern click (Invoke or Toggle) and a replace:true write raise the window,
// with or without background:true, because WinForms focuses the control it is
// about to act on. Single and run columns agreed on every row.
//
// Two throwaway targets. Target 2 is put in front. Then each action is done on
// target 1 (behind) and the foreground is measured after it. Every action is
// run twice: once as a single call, once as the only step of a run. If both
// columns agree, the run adds nothing; any difference is the run's fault.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'server', 'index.mjs');
const TARGET = path.join(HERE, 'make-target.ps1');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor() {
    this.proc = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.seq = 0; this.pending = new Map();
    createInterface({ input: this.proc.stdout }).on('line', (l) => {
      if (!l.trim()) return;
      let m; try { m = JSON.parse(l); } catch { return; }
      const e = this.pending.get(m.id); if (!e) return;
      this.pending.delete(m.id); e(m.result);
    });
  }
  rpc(method, params) {
    const id = ++this.seq;
    return new Promise((res) => { this.pending.set(id, res); this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  }
  call(name, args = {}) { return this.rpc('tools/call', { name, arguments: args }); }
  stop() { try { this.proc.kill(); } catch {} }
}

const body = (r) => (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');

function spawnTarget() {
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', TARGET], { stdio: ['ignore', 'pipe', 'pipe'] });
    const t = setTimeout(() => reject(new Error('target never reported in')), 15000);
    createInterface({ input: p.stdout }).on('line', (l) => {
      try { const i = JSON.parse(l.trim()); if (i.title) { clearTimeout(t); resolve({ proc: p, ...i }); } } catch {}
    });
  });
}

const c = new Client();
await c.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fg', version: '1' } });

const t1 = await spawnTarget();
const t2 = await spawnTarget();
await sleep(1200);

const apps = body(await c.call('computer_apps'));
const hwndOf = (title) => {
  const line = apps.split('\n').find((l) => l.includes(title));
  return line ? Number(line.trim().split(/\s+/)[0]) : null;
};
const hwnd = hwndOf(t1.title), hwnd2 = hwndOf(t2.title);
if (!hwnd || !hwnd2) { console.log('could not find both targets\n' + apps); process.exit(1); }
console.log(`behind = ${hwnd} ("${t1.title}")   front = ${hwnd2} ("${t2.title}")\n`);

await c.call('computer_grant', { hwnd });
await c.call('computer_grant', { hwnd2 });

const snap = body(await c.call('computer_snapshot', { hwnd }));
const idx = (re) => { const m = snap.split('\n').find((l) => re.test(l)); return m ? Number(/\[(\d+)\]/.exec(m)[1]) : null; };
const iPress = idx(/Button "Press Me"/);
const iName = idx(/Edit "Name field"/);
const iAgree = idx(/CheckBox "I agree"/);
console.log(`controls: button=${iPress} field=${iName} checkbox=${iAgree}\n`);

const foreground = async () => {
  const line = body(await c.call('computer_apps')).split('\n').find((l) => l.includes('[foreground]')) || '';
  return Number(line.trim().split(/\s+/)[0]) || 0;
};

// Each case: a label, the args for the single call, and the same thing as a step.
const cases = [
  ['click a Button   (Invoke pattern)', 'computer_click', { hwnd, index: iPress }, { click: { index: iPress } }],
  ['click a CheckBox (Toggle pattern)', 'computer_click', { hwnd, index: iAgree }, { click: { index: iAgree } }],
  ['type, no replace (posted WM_CHAR)', 'computer_type', { hwnd, index: iName, text: 'x' }, { type: { index: iName, text: 'x' } }],
  ['type, replace    (Value pattern) ', 'computer_type', { hwnd, index: iName, text: 'y', replace: true }, { type: { index: iName, text: 'y', replace: true } }],
  ['snapshot         (pure read)     ', 'computer_snapshot', { hwnd, find: 'Name' }, { snapshot: { find: 'Name' } }],
  ['click Button   background:true    ', 'computer_click', { hwnd, index: iPress, background: true }, { click: { index: iPress }, background: true }],
  ['click CheckBox background:true    ', 'computer_click', { hwnd, index: iAgree, background: true }, { click: { index: iAgree }, background: true }],
  ['type replace   background:true    ', 'computer_type', { hwnd, index: iName, text: 'z', replace: true, background: true }, { type: { index: iName, text: 'z', replace: true }, background: true }],
];

const raised = async (fn) => {
  await c.call('computer_focus', { hwnd: hwnd2, mode: 'take' });
  await sleep(400);
  const before = await foreground();
  if (before !== hwnd2) return 'no-fg';
  const r = await fn();
  await sleep(250);
  const after = await foreground();
  return { moved: after !== before, to: after, err: r && r.isError ? body(r).split('\n')[0].slice(0, 60) : null };
};

console.log('action                              single call        inside a run');
console.log('-'.repeat(72));
for (const [label, tool, args, step] of cases) {
  const one = await raised(() => c.call(tool, args));
  const run = await raised(() => c.call('computer_run', { hwnd, read_after: false, steps: [step] }));
  const say = (x) => x === 'no-fg' ? 'fg unavailable' : (x.err ? 'ERR ' + x.err : (x.moved ? 'RAISED' : 'stayed behind'));
  console.log(`${label}  ${say(one).padEnd(18)} ${say(run)}`);
}

await c.call('computer_close_window', { hwnd });
await c.call('computer_close_window', { hwnd2 });
try { t1.proc.kill(); t2.proc.kill(); } catch {}
c.stop();
