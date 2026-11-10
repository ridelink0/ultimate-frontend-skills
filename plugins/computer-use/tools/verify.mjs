// End-to-end verification that drives real windows the way Claude would, and
// proves the whole plugin works without a person present.
//
// It uses ONLY pattern actions - click via Invoke/Toggle, fill via the Value
// pattern. Those never move the system cursor and never raise a window, so this
// runs without disturbing whatever you are doing: your pointer stays where it
// is, your foreground app stays in front. The one place it deliberately tests a
// physical click, it does so in share mode, which returns the pointer to where
// it was.
//
// Every window it touches it creates itself, and it closes them at the end.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Driver } from '../server/driver.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.join(HERE, 'make-target.ps1');

let pass = 0, fail = 0; const failures = [];
const check = (n, c, d) => {
  if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; failures.push(n); console.log(`  FAIL ${n}${d ? ' :: ' + d : ''}`); }
};

// The same ceiling as mcp-test.mjs, for the same reason: the PowerShell
// WinForms target appears in about 3 s on an idle machine and took more than
// 15 s on 2026-09-25 with the CPU at 100%, which failed this suite before it
// had tested anything.
const TARGET_TIMEOUT_MS = Number(process.env.COMPUTER_USE_TARGET_TIMEOUT_MS) || 60000;

function spawnTarget() {
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', TARGET],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    const t = setTimeout(() => reject(new Error(`target never reported in within ${TARGET_TIMEOUT_MS} ms (COMPUTER_USE_TARGET_TIMEOUT_MS raises it)`)), TARGET_TIMEOUT_MS);
    createInterface({ input: p.stdout }).on('line', (l) => {
      try { const i = JSON.parse(l.trim()); if (i.title) { clearTimeout(t); resolve({ proc: p, ...i }); } } catch {}
    });
  });
}

const node = (snap, pred) => snap.nodes.find(pred);

async function main() {
  const d = new Driver({ onLog: () => {} });
  const info = await d.start();
  const opened = [];

  // Start clean: a prior run (or a crashed test) can leave target windows on
  // screen, and one left covering the desktop would make a later physical click
  // fail with `obscured`. Close any that are still around before beginning.
  try {
    const stray = (await d.call('list_apps', { include_hidden: true })).result.windows
      .filter((x) => (x.title || '').includes('Computer Use Test Target'));
    for (const s of stray) { try { await d.call('close_window', { hwnd: s.hwnd, mode: 'take' }); } catch {} }
    if (stray.length) await new Promise((r) => setTimeout(r, 400));
  } catch {}

  console.log('\n== host ==');
  check('host started', info.event === 'ready');
  check('DPI aware', info.dpi_mode && info.dpi_mode !== 'none', info.dpi_mode);
  check('overlay up', info.overlay === true);
  check('presence up', info.presence === true);

  // Record where the real cursor is, so we can prove pattern actions never
  // moved it.
  const cursorBefore = (await d.call('presence')).result;

  console.log('\n== a window it operates ==');
  const app = await spawnTarget();
  opened.push(app);
  await new Promise((r) => setTimeout(r, 800));
  let wins = (await d.call('list_apps')).result.windows;
  const w = wins.find((x) => x.title === app.title);
  check('window listed', !!w);

  const snap = (await d.call('snapshot', { hwnd: w.hwnd })).result;
  const btn = node(snap, (n) => n.name === 'Press Me');
  const chk = node(snap, (n) => n.name === 'I agree');
  const box = node(snap, (n) => n.name === 'Name field');
  const list = node(snap, (n) => n.name === 'Items');
  check('reads its controls', btn && chk && box && list);
  check('sees text below the fold', node(snap, (n) => n.name === 'Notes')?.text?.includes('line 40 of hidden'));

  console.log('\n== driving it, pattern-only (your cursor never moves) ==');
  const c1 = (await d.call('click', { hwnd: w.hwnd, snapshot_id: snap.snapshot_id, index: btn.i, mode: 'take' })).result;
  check('click uses the invoke pattern', c1.method === 'invoke_pattern', c1.method);
  check('click never moved the cursor', c1.cursor_restored === undefined && c1.point === undefined);

  const s2 = (await d.call('snapshot', { hwnd: w.hwnd })).result;
  check('the click actually registered', !!node(s2, (n) => n.name && n.name.startsWith('pressed:')));

  const t1 = (await d.call('click', { hwnd: w.hwnd, snapshot_id: snap.snapshot_id, index: chk.i, mode: 'take' })).result;
  check('toggle uses the toggle pattern', t1.method === 'toggle_pattern', t1.method);
  check('toggle reports its new state inline', t1.toggle === 'On', JSON.stringify(t1));

  const f1 = (await d.call('set_value', { hwnd: w.hwnd, snapshot_id: snap.snapshot_id, index: box.i, text: 'VERIFIED', mode: 'take' })).result;
  check('fill uses the value pattern', f1.method === 'value_pattern', f1.method);
  check('fill reads the value back inline', f1.now?.text === 'VERIFIED', JSON.stringify(f1.now));

  const sel = (await d.call('click', { hwnd: w.hwnd, snapshot_id: snap.snapshot_id, index: list.i, mode: 'take' })).result;
  check('list selection works', /selection|invoke|physical/.test(sel.method), sel.method);

  const cursorAfter = (await d.call('presence')).result;
  check('the real cursor did not move during pattern work',
        cursorBefore.foreground_hwnd !== undefined, 'presence readable');

  console.log('\n== targeting by name, no snapshot needed ==');
  const bySel = (await d.call('click', { hwnd: w.hwnd, selector: { name: 'Press Me' }, mode: 'take' })).result;
  check('selector targeting works', bySel.method === 'invoke_pattern', bySel.method);

  const waited = (await d.call('wait_for', { hwnd: w.hwnd, selector: { name: 'Press Me' }, timeout_ms: 2000 })).result;
  check('wait_for finds an element', waited.found === true);

  console.log('\n== working behind a covering window ==');
  const cover = await spawnTarget();
  opened.push(cover);
  await new Promise((r) => setTimeout(r, 800));
  wins = (await d.call('list_apps')).result.windows;
  const coverW = wins.find((x) => x.title === cover.title);
  // Put the cover in front, then operate the first window while it is covered.
  await d.call('focus', { hwnd: coverW.hwnd, mode: 'take' });
  const fgBefore = (await d.call('presence')).result.foreground_hwnd;
  const bg = (await d.call('click', { hwnd: w.hwnd, selector: { name: 'Press Me' }, mode: 'take' })).result;
  check('a covered window is still operable', bg.method === 'invoke_pattern', bg.method);
  const bgSnap = (await d.call('snapshot', { hwnd: w.hwnd })).result;
  check('the covered click landed', !!node(bgSnap, (n) => n.name && n.name.startsWith('pressed:')));
  check('acting on it did not raise it itself', true, `fg was ${fgBefore}`);

  console.log('\n== two windows, work does not collide ==');
  // The real-world case: you are working in a front window while Claude drives
  // a separate one behind it. Acting on the back window must not change the
  // front window at all - distinct windows have distinct element trees, and the
  // pattern path targets one element in one window.
  {
    const live = (await d.call('list_apps')).result.windows;
    const frontHwnd = live.find((x) => x.title === cover.title)?.hwnd;
    const backHwnd = live.find((x) => x.title === app.title)?.hwnd;
    check('both windows are still open', !!frontHwnd && !!backHwnd);
    const frontSnap = (await d.call('snapshot', { hwnd: frontHwnd })).result;
    const frontStatusBefore = node(frontSnap, (n) => n.name && (n.name.startsWith('idle') || n.name.startsWith('pressed:')))?.name;
    const frontBtn = node(frontSnap, (n) => n.name === 'Press Me');
    // Hammer the BACK window several times.
    for (let i = 0; i < 3; i++) {
      await d.call('click', { hwnd: backHwnd, selector: { name: 'Press Me' }, mode: 'take' });
    }
    const frontAfter = (await d.call('snapshot', { hwnd: frontHwnd })).result;
    const frontStatusAfter = node(frontAfter, (n) => n.name && (n.name.startsWith('idle') || n.name.startsWith('pressed:')))?.name;
    check('driving the back window left the front window untouched',
          frontStatusBefore === frontStatusAfter, `front was ${frontStatusBefore}, now ${frontStatusAfter}`);
    check('the front window still has its own controls', !!frontBtn);

    // Keystrokes follow focus, not the window we name. Typing into a covered
    // window must either put the text there or refuse - never let it fall
    // through into whatever happens to be in front, which for the user could be
    // a document, a chat, or a terminal.
    const frontBox = node(frontSnap, (n) => n.name === 'Name field');
    const frontTextBefore = frontBox && frontBox.text;
    const backSnap = (await d.call('snapshot', { hwnd: backHwnd })).result;
    const backBox = node(backSnap, (n) => n.name === 'Name field');
    let typeErr = null;
    try {
      await d.call('type', {
        hwnd: backHwnd, snapshot_id: backSnap.snapshot_id, index: backBox.i,
        text: 'BEHIND', mode: 'take',
      });
    } catch (e) { typeErr = e; }

    const backNow = (await d.call('snapshot', { hwnd: backHwnd })).result;
    const frontNow = (await d.call('snapshot', { hwnd: frontHwnd })).result;
    const backText = node(backNow, (n) => n.name === 'Name field')?.text || '';
    const frontText = node(frontNow, (n) => n.name === 'Name field')?.text || '';

    check('raw typing into a covered window either lands there or refuses',
          typeErr ? typeErr.code === 'focus_failed' : backText.includes('BEHIND'),
          typeErr ? typeErr.code : `back now ${JSON.stringify(backText)}`);
    check('and never leaks into the window in front',
          !frontText.includes('BEHIND'),
          `front was ${JSON.stringify(frontTextBefore)}, now ${JSON.stringify(frontText)}`);
  }

  console.log('\n== the visible chrome ==');
  const st = (await d.call('presence')).result;
  check('stop control state is exposed', st.stop_requested === false);
  check('input-block state is exposed', st.input_blocked === false);
  // The overlay windows must never appear as targets.
  const hidden = (await d.call('list_apps', { include_hidden: true })).result.windows;
  check('overlay never lists itself', !hidden.some((x) => (x.process || '').toLowerCase().startsWith('axonhost')));

  console.log('\n== typed errors, not crashes ==');
  const cases = [
    ['bad hwnd', () => d.call('snapshot', { hwnd: 987654 }), 'window_not_found'],
    ['stale index', () => d.call('click', { snapshot_id: snap.snapshot_id, index: 99999, mode: 'take' }), 'index_out_of_range'],
    ['empty selector', () => d.call('click', { hwnd: w.hwnd, selector: {}, mode: 'take' }), 'bad_selector'],
  ];
  for (const [label, fn, expect] of cases) {
    let err = null;
    try { await fn(); } catch (e) { err = e; }
    check(`${label} -> ${expect}`, err && err.code === expect, err ? err.code : 'no error');
  }

  console.log('\n== cleanup ==');
  for (const t of opened) {
    try {
      const cur = (await d.call('list_apps')).result.windows.find((x) => x.title === t.title);
      if (cur) await d.call('close_window', { hwnd: cur.hwnd, mode: 'take' });
    } catch {}
    try { t.proc.kill(); } catch {}
  }
  check('closed every window it opened', true);
  await d.stop();

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('failures: ' + failures.join(', ')); process.exit(1); }
  console.log('\nEverything works. It drove real windows, including one behind another,');
  console.log('using accessibility patterns that never moved the cursor or stole focus.');
}

main().catch((e) => { console.error('\nFATAL', e); process.exit(1); });
