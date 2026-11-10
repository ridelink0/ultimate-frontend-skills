// Chromium checks: the things that went wrong on a real web form on
// 2026-09-26, reproduced on tools/web-target.html in an InPrivate Microsoft
// Edge window of a throwaway --user-data-dir (InPrivate, because a fresh
// ordinary profile signs itself in to the Windows account and starts syncing,
// and puts a "Sync your profile" bubble over the page), driven through the MCP
// server the way Claude Code drives it. No real browser session is touched.
// Needs Edge; without it this prints NOT RUN and exits 0. Closes its own
// window at the end.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Driver } from '../server/driver.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'server', 'index.mjs');
const EDGE = [
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
].find((p) => fs.existsSync(p));
const PAGE = 'file:///' + path.join(HERE, 'web-target.html').replace(/\\/g, '/');

let pass = 0, fail = 0; const failures = [];
const check = (n, c, d) => {
  if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; failures.push(n); console.log(`  FAIL ${n}${d ? ' :: ' + String(d).slice(0, 1500) : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const body = (r) => (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
const indexOf = (text, re) => {
  const line = text.split('\n').find((l) => /^[+~-]?\s*\[\d+\]/.test(l.trim()) && re.test(l));
  const m = line && /\[(\d+)\]/.exec(line);
  return m ? Number(m[1]) : null;
};

const TARGET = path.join(HERE, 'make-target.ps1');
const TARGET_TIMEOUT_MS = Number(process.env.COMPUTER_USE_TARGET_TIMEOUT_MS) || 60000;
function spawnTarget(extra = []) {
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', TARGET, ...extra],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    const t = setTimeout(() => { try { p.kill(); } catch {} reject(new Error('target never reported in')); }, TARGET_TIMEOUT_MS);
    createInterface({ input: p.stdout }).on('line', (l) => {
      try { const i = JSON.parse(l.trim()); if (i.title) { clearTimeout(t); resolve({ proc: p, ...i }); } } catch {}
    });
  });
}

class Client {
  constructor() {
    // Not this shell's Claude session: a test must never pick up its grants.
    const env = { ...process.env };
    delete env.CLAUDE_CODE_SESSION_ID;
    this.proc = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'], env });
    this.seq = 0; this.pending = new Map();
    createInterface({ input: this.proc.stdout }).on('line', (l) => {
      let m; try { m = JSON.parse(l); } catch { return; }
      const e = this.pending.get(m.id); if (!e) return;
      this.pending.delete(m.id); clearTimeout(e.timer);
      m.error ? e.reject(new Error(m.error.message)) : e.resolve(m.result);
    });
    this.proc.stderr.on('data', () => {});
  }
  rpc(method, params, ms = 90000) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(method + ' timed out')); }, ms);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  call(name, args = {}) { return this.rpc('tools/call', { name, arguments: args }); }
  stop() { try { this.proc.kill(); } catch {} }
}

async function main() {
  if (process.platform !== 'win32' || !EDGE) {
    console.log('NOT RUN: needs Microsoft Edge on Windows.');
    process.exit(0);
  }
  const c = new Client();
  await c.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'web-test', version: '1' } });
  const probe = new Driver({ onLog: () => {} });
  await probe.start();
  const foreground = async () => Number((await probe.call('presence')).result.foreground_hwnd);

  console.log('\n-- target --');
  const profile = path.join(os.tmpdir(), 'cu-web-test-profile');
  // A run that died before its cleanup leaves its Edge running on this
  // profile, and the next launch is handed to that instance (it opened a
  // blank "Untitled" window). Its windows are this suite's own: closed first.
  try {
    const { execFileSync } = await import('node:child_process');
    const q = `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*cu-web-test-profile*' } | ForEach-Object { $_.ProcessId }`;
    const pids = new Set(String(execFileSync('powershell.exe', ['-NoProfile', '-Command', q], { windowsHide: true })).split(/\s+/).filter(Boolean).map(Number));
    if (pids.size) {
      for (const w of (await probe.call('list_apps', { include_hidden: true })).result.windows) {
        if (pids.has(Number(w.pid))) { try { await probe.call('close_window', { hwnd: w.hwnd, mode: 'take' }); } catch { /* gone */ } }
      }
      await sleep(1500);
    }
  } catch { /* nothing left over */ }
  // Edge pauses the timers and the accessibility updates of a page whose
  // window is covered - measured: with the window opened behind a maximized
  // terminal, every setTimeout on the page stalled and half this suite failed.
  // These switches keep a covered test page running.
  const launch = () => spawn(EDGE, [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--inprivate',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion', PAGE],
    { detached: true, stdio: 'ignore' }).unref();
  launch();
  let hwnd = 0;
  for (let i = 0; i < 120 && !hwnd; i++) {
    // Once in a full run the window never came: the launch went to an Edge
    // of that profile that was still shutting down. Asked once more.
    if (i === 40) launch();
    await sleep(500);
    const line = body(await c.call('computer_apps')).split('\n').find((l) => l.includes('Computer Use Web Target'));
    if (line) hwnd = Number(line.trim().split(/\s+/)[0]);
  }
  check('the web target opened', hwnd > 0);
  if (!hwnd) { c.stop(); await probe.stop(); process.exit(1); }
  await c.call('computer_grant', { hwnd });
  // Until the page itself is in the tree, not just the browser's frame.
  for (let i = 0; i < 20; i++) {
    const ready = body(await c.call('computer_snapshot', { hwnd, find: 'I agree to the terms' }));
    if (/CheckBox "I agree to the terms"/.test(ready)) break;
    await sleep(500);
  }
  // A page that has just appeared in the tree can still drop the first
  // pattern call made on it (seen once on the check box below).
  await sleep(700);

  console.log('\n-- own terminal (issue 11) --');
  const self = await new Promise((resolve) => {
    let out = '';
    const p = spawn(probe.proc.spawnfile, ['--console-window', String(process.pid)], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => { try { resolve(Number(JSON.parse(out.trim()).hwnd) || 0); } catch { resolve(0); } });
  });
  const appsText = body(await c.call('computer_apps'));
  if (self) {
    // The server's parent is this script, whose console is this terminal's.
    check('the terminal running this is not listed', !appsText.split('\n').some((l) => l.trim().startsWith(String(self) + ' ')), appsText);
  } else {
    console.log('     (no console window above this process - not run from a terminal; not verifiable here)');
  }

  console.log('\n-- reading (issues 3, 8, 12, 13) --');
  const full = body(await c.call('computer_snapshot', { hwnd }));
  check('a long paragraph is not cut at 70 characters', full.includes('the end is HERE.'), full);
  check('a long list item is not cut either', full.includes('so its name is cut unless the limit is honoured - END'), full);
  const iSidebar = indexOf(full, /Group "Sidebar"/);
  check('the sidebar landmark has a row', iSidebar != null && /Group "Sidebar" \(navigation\)/.test(full), full.slice(0, 600));
  check('an unnamed main landmark gets a row too', /Group \(main\)|Group #main \(main\)|\(main\) #main/.test(full), full.slice(0, 2000));
  const noSide = body(await c.call('computer_snapshot', { hwnd, full: true, exclude: [iSidebar] }));
  check('exclude leaves the sidebar out', !noSide.includes('Chat number 1"') && noSide.includes('I agree to the terms'), noSide.slice(0, 600));
  const row = body(await c.call('computer_snapshot', { hwnd, find: '/Button "Next/' }));
  check('find matches the printed row', /Button "Next" #next/.test(row), row);
  const radio = body(await c.call('computer_snapshot', { hwnd, find: '/RadioButton "(No|Yes)/' }));
  check('find matches both radio rows', radio.includes('"Yes"') && radio.includes('"No"'), radio);
  const capped = body(await c.call('computer_snapshot', { hwnd, find: 'agree', max_nodes: 60 }));
  check('max_nodes caps rows shown, after find', /CheckBox "I agree to the terms"/.test(capped), capped);
  const lean = body(await c.call('computer_snapshot', { hwnd, interactive_only: true, max_nodes: 20 }));
  check('controls-only + max_nodes still reaches the page', lean.includes('Chat number') && /20 shown of \d+ \(max_nodes\)/.test(lean), lean.slice(0, 400));

  console.log('\n-- clicks report the state after the click (issues 2, 16) --');
  // A row line, never the header (which repeats the find text).
  const st = (t, re) => t.split('\n').find((x) => /^[+~-]?\s*\[\d+\]/.test(x.trim()) && re.test(x)) || '';
  const before = st(body(await c.call('computer_snapshot', { hwnd, find: 'I agree' })), /CheckBox/);
  const wasOn = /toggle=On/.test(before);
  const tog = body(await c.call('computer_click', { hwnd, selector: { name: 'I agree to the terms', role: 'CheckBox' } }));
  const afterTog = st(body(await c.call('computer_snapshot', { hwnd, find: 'I agree' })), /CheckBox/);
  const nowOn = /toggle=On/.test(afterTog);
  check('the check box really toggled', nowOn !== wasOn, before + ' -> ' + afterTog);
  check('the click reported the new state, or said it was unconfirmed',
    tog.includes(`now ${nowOn ? 'On' : 'Off'}`) || tog.includes('unconfirmed'), tog);
  const exp = body(await c.call('computer_click', { hwnd, selector: { name: 'More options', role: 'Button' } }));
  await sleep(400);
  const expRow = st(body(await c.call('computer_snapshot', { hwnd, find: 'More options' })), /More options/);
  const expanded = /expanded/.test(expRow);
  check('the expand click reported the new state, or said it was unconfirmed',
    exp.includes(`now ${expanded ? 'Expanded' : 'Collapsed'}`) || exp.includes('unconfirmed'), exp + ' / ' + expRow);
  const rad = body(await c.call('computer_click', { hwnd, selector: { name: 'No', role: 'RadioButton' } }));
  check('the radio click reports selected', rad.includes('selected=true') && !rad.includes('selected=false'), rad);

  console.log('\n-- disabled and grouped buttons (issue 9) --');
  const dis = await c.call('computer_click', { hwnd, selector: { name: 'Submit', role: 'Button' } });
  check('a disabled button is refused, not clicked for real', dis.isError && body(dis).includes('element_disabled') && !body(dis).includes('via physical'), body(dis));
  const nxt = body(await c.call('computer_click', { hwnd, selector: { name: 'Next', role: 'Button' } }));
  check('the Next button inside a group of the same name is invoked', nxt.includes('invoke_pattern'), nxt);

  console.log('\n-- a re-rendered button keeps its target (issue 6) --');
  const r0 = body(await c.call('computer_snapshot', { hwnd, find: 'Validate' }));
  const iVal = indexOf(r0, /Button "Validate"/);
  await c.call('computer_type', { hwnd, selector: { name: 'Plugin name' }, text: 'web-test', replace: true });
  await sleep(300);
  const val = body(await c.call('computer_click', { hwnd, index: iVal }));
  check('a stale index is re-found by its name and role', !/element_stale/.test(val) && val.includes('had gone stale'), val);
  const log1 = body(await c.call('computer_wait_for', { hwnd, text: 'validated web-test', timeout_ms: 8000 }));
  check('the new Validate button was the one pressed', log1.includes('found'), log1);

  console.log('\n-- scrolling needs no pointer (issue 7) --');
  const sc = body(await c.call('computer_scroll', { hwnd, selector: { name: 'Bottom button', role: 'Button' }, amount: -3 }));
  check('scroll by element uses its container, not the wheel', sc.includes('scroll_pattern') && !sc.includes('wheel'), sc);
  const iv = body(await c.call('computer_scroll', { hwnd, selector: { name: 'Bottom button', role: 'Button' }, into_view: true }));
  check('into_view scrolls the element into view', iv.includes('scroll_into_view'), iv);
  await sleep(300);
  const bottomRow = st(body(await c.call('computer_snapshot', { hwnd, find: 'Bottom button' })), /Bottom button/);
  check('and it is on screen afterwards', bottomRow && !bottomRow.includes('offscreen'), bottomRow);

  console.log('\n-- waits inside a run (issues 4, 5, 15) --');
  const bad = body(await c.call('computer_run', { hwnd, steps: [{ wait_for: { text: 'x' }, timeuot_ms: 1 }] }));
  check('an unknown step field is refused, not ignored', bad.includes('unknown field timeuot_ms'), bad);
  const slow = body(await c.call('computer_run', { hwnd, read_after: false, steps: [
    { click: { selector: { name: 'Start slow check', role: 'Button' } } },
    { wait_for: { text: 'Server validation passed' }, timeout_ms: 15000 },
  ] }));
  check('a step-level timeout_ms outlasts the 5 s default', /2\/2 step\(s\) ran, all ok/.test(slow), slow);
  const chg = body(await c.call('computer_run', { hwnd, steps: [
    { click: { selector: { name: 'Next', role: 'Button' } } },
    { wait_for: { change: true }, timeout_ms: 5000 },
  ] }));
  const waitPart = chg.slice(chg.indexOf('2 wait_for'), chg.indexOf('after the run:') > 0 ? chg.indexOf('after the run:') : undefined);
  check('the run shows the wait\'s whole delta', /next pressed/.test(waitPart) && !/…$/.test(waitPart.split('\n')[0]), chg);
  check('the delta is the page change, not browser chrome', !/TabItem|Address/.test(waitPart), waitPart);

  console.log('\n-- the foreground comes back (issue 1) --');
  // A window of the test's own to be "the user's window": the WinForms
  // target, put in front, so the give-back has somewhere to go.
  // Parked at the right edge, so it does not cover the page's buttons.
  const tgt = await spawnTarget(['-Right']);
  const tline = body(await c.call('computer_apps')).split('\n').find((l) => l.includes(tgt.title));
  const homeHwnd = tline ? Number(tline.trim().split(/\s+/)[0]) : 0;
  if (homeHwnd) {
    await c.call('computer_grant', { hwnd: homeHwnd });
    await c.call('computer_focus', { hwnd: homeHwnd, mode: 'take' });
    await sleep(400);
  }
  const home = await foreground();
  if (home && home !== hwnd && home === homeHwnd) {
    // The page was scrolled to its bottom above; bring the buttons back.
    await c.call('computer_scroll', { hwnd, selector: { name: 'Next', role: 'Button' }, into_view: true });
    await sleep(300);
    const pc = body(await c.call('computer_click', { hwnd, selector: { name: 'Next', role: 'Button' }, physical: true }));
    await sleep(300);
    check('a physical click gives the foreground back', (await foreground()) === home && pc.includes('Foreground given back'), pc);
    const sel = body(await c.call('computer_click', { hwnd, selector: { name: 'Colour' }, physical: true }));
    await sleep(300);
    const fgMenu = await foreground();
    // The physical click has to have opened the list for this to mean
    // anything; once in a run it did not (the page took the click as a
    // window activation), and then giving the foreground back was right.
    if (/expanded/.test(sel)) {
      check('while a dropdown it opened is showing, the window stays in front', fgMenu !== home && sel.includes('menu it opened'), sel);
    } else {
      console.log('     (the click did not open the list this time, so there was no dropdown to wait for; not verifiable now)');
    }
    const esc = body(await c.call('computer_key', { hwnd, keys: 'escape' }));
    await sleep(300);
    check('and after the next action it goes back', (await foreground()) === home, esc);
  } else {
    console.log(`     (could not put the test's own window in front - foreground is ${home}; not verifiable now)`);
  }
  if (homeHwnd) await c.call('computer_close_window', { hwnd: homeHwnd });
  try { tgt.proc.kill(); } catch {}

  console.log('\n-- a find straight after a navigation (issue 14) --');
  await c.call('computer_click', { hwnd, selector: { name: 'Go to page two', role: 'Hyperlink' } });
  let f2 = body(await c.call('computer_snapshot', { hwnd, find: 'Page two ready' }));
  // "still changing ... try again" is the answer for a page that has not
  // settled yet, and trying again is what it asks for.
  if (/still changing/.test(f2)) f2 = body(await c.call('computer_snapshot', { hwnd, find: 'Page two ready' }));
  check('the find waits out a page that is still settling', f2.includes('Button "Page two ready"'), f2);

  console.log('\n-- cleanup --');
  const closed = await c.call('computer_close_window', { hwnd });
  check('closes its window', !closed.isError, body(closed));
  c.stop();
  await probe.stop();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) console.log('failed: ' + failures.join('; '));
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
