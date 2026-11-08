// End-to-end exercise of the PowerShell host against a throwaway target window
// that this script creates itself. Never touches a pre-existing app.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Driver } from '../server/driver.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.join(HERE, 'make-target.ps1');

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`); }
}

// The same ceiling as mcp-test.mjs, for the same reason: the PowerShell
// WinForms target appears in about 3 s on an idle machine and took more than
// 15 s on 2026-09-25 with the CPU at 100%, which failed this suite before it
// had tested anything.
const TARGET_TIMEOUT_MS = Number(process.env.COMPUTER_USE_TARGET_TIMEOUT_MS) || 60000;

function spawnTarget() {
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', TARGET],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    const rl = createInterface({ input: p.stdout });
    const t = setTimeout(() => reject(new Error(`target never reported in within ${TARGET_TIMEOUT_MS} ms (COMPUTER_USE_TARGET_TIMEOUT_MS raises it)`)), TARGET_TIMEOUT_MS);
    rl.on('line', (line) => {
      try {
        const info = JSON.parse(line.trim());
        if (info.title) { clearTimeout(t); resolve({ proc: p, ...info }); }
      } catch {}
    });
    p.stderr.on('data', d => console.error('target stderr:', d.toString().trim()));
    p.on('exit', () => clearTimeout(t));
  });
}

const node = (snap, pred) => snap.nodes.find(pred);

async function main() {
  const d = new Driver({ onLog: (m) => console.error('[drv]', m) });

  console.log('\n-- host startup --');
  const info = await d.start();
  check('host reports ready', info.event === 'ready');
  check('DPI awareness engaged', info.dpi_mode && info.dpi_mode !== 'none', `dpi_mode=${info.dpi_mode}`);
  console.log(`     dpi_mode=${info.dpi_mode} hostpid=${info.pid}`);

  const ping = await d.call('ping');
  check('ping responds', ping.result.ok === true);

  console.log('\n-- target app --');
  const target = await spawnTarget();
  console.log(`     "${target.title}" pid=${target.pid}`);
  await new Promise(r => setTimeout(r, 700));

  console.log('\n-- list_apps --');
  const apps = await d.call('list_apps');
  const mine = apps.result.windows.find(w => w.title === target.title);
  check('target window listed', !!mine, `${apps.result.windows.length} windows returned`);
  check('shell furniture filtered out', !apps.result.windows.some(w => w.class === 'Shell_TrayWnd'));
  check('window carries an hwnd', mine && typeof mine.hwnd === 'number' && mine.hwnd > 0);
  check('window carries a rect', mine && Array.isArray(mine.rect) && mine.rect[2] > 0);
  const hwnd = mine.hwnd;

  console.log('\n-- snapshot --');
  const t0 = Date.now();
  const snap = (await d.call('snapshot', { hwnd })).result;
  const snapMs = Date.now() - t0;
  console.log(`     ${snap.node_count} nodes in ${snapMs}ms, id=${snap.snapshot_id}`);
  check('snapshot returns nodes', snap.node_count > 5);
  check('snapshot under 3s', snapMs < 3000, `${snapMs}ms`);

  const button   = node(snap, n => n.name === 'Press Me');
  const status   = node(snap, n => n.name && n.name.startsWith('idle'));
  const nameBox  = node(snap, n => n.name === 'Name field');
  const agree    = node(snap, n => n.name === 'I agree');
  const notes    = node(snap, n => n.name === 'Notes');
  const items    = node(snap, n => n.name === 'Items');
  const disabled = node(snap, n => n.name === 'Disabled');

  check('finds the button', !!button);
  check('finds the status label', !!status);
  check('finds the text field', !!nameBox);
  check('finds the checkbox', !!agree);
  check('finds the notes box', !!notes);
  check('finds the list', !!items);
  check('finds the disabled button', !!disabled);
  check('button exposes Invoke', button && button.patterns && button.patterns.includes('Invoke'));
  check('checkbox exposes Toggle', agree && agree.patterns && agree.patterns.includes('Toggle'));
  check('disabled button marked disabled', disabled && disabled.state && disabled.state.disabled === true,
        JSON.stringify(disabled && disabled.state));
  check('elements carry rects', button && Array.isArray(button.rect));

  // The appshot claim: text scrolled outside the viewport must come back.
  check('notes text captured', notes && typeof notes.text === 'string');
  check('captures text below the fold', notes && notes.text && notes.text.includes('line 40 of hidden'),
        notes && notes.text ? `tail=${JSON.stringify(notes.text.slice(-40))}` : 'no text');

  console.log('\n-- a snapshot always comes back --');
  {
    // A node cap bounds how big a tree is, not how long it takes to read. An
    // Electron window can spend tens of milliseconds per node, and enough of
    // those runs past the caller's timeout with the host still walking. So the
    // walk has a wall clock. Forced to 1ms here, it must return a partial tree
    // and say so, rather than running to completion or failing.
    process.env.CU_SNAPSHOT_MS = '1';
    const slow = new Driver({ onLog: () => {} });
    await slow.start();
    const t = Date.now();
    const s = (await slow.call('snapshot', { hwnd })).result;
    const ms = Date.now() - t;
    delete process.env.CU_SNAPSHOT_MS;
    check('a tight time budget still returns a tree', s.node_count >= 1, String(s.node_count));
    check('it returns fast', ms < 5000, `${ms}ms`);
    check('it is marked truncated', s.truncated === true);
    check('and says the budget is why', s.time_budget_ms === 1, JSON.stringify(s.time_budget_ms));
    check('a budgeted snapshot is still actionable', typeof s.snapshot_id === 'string');
    await slow.stop();
  }

  console.log('\n-- click via Invoke pattern --');
  const clicked = (await d.call('click', { snapshot_id: snap.snapshot_id, index: button.i })).result;
  check('click used the pattern path', clicked.method === 'invoke_pattern', `method=${clicked.method}`);
  await new Promise(r => setTimeout(r, 250));
  const snap2 = (await d.call('snapshot', { hwnd })).result;
  const status2 = node(snap2, n => n.name && n.name.startsWith('pressed:'));
  check('button press actually registered', !!status2, `status now: ${JSON.stringify(node(snap2, n => n.role === 'Text' && n.name)?.name)}`);

  console.log('\n-- set_value --');
  const sv = (await d.call('set_value', { snapshot_id: snap.snapshot_id, index: nameBox.i, text: 'Gerald' })).result;
  check('set_value used ValuePattern', sv.method === 'value_pattern', `method=${sv.method}`);
  const snap3 = (await d.call('snapshot', { hwnd })).result;
  const nb3 = node(snap3, n => n.name === 'Name field');
  check('text landed in the field', nb3 && nb3.text === 'Gerald', `got ${JSON.stringify(nb3 && nb3.text)}`);

  console.log('\n-- toggle --');
  const tog = (await d.call('click', { snapshot_id: snap.snapshot_id, index: agree.i })).result;
  check('toggle path taken', tog.method === 'toggle_pattern', `method=${tog.method}`);
  check('toggle flipped to On', tog.toggle === 'On', `toggle=${tog.toggle}`);

  console.log('\n-- selector targeting --');
  const bySel = (await d.call('click', { hwnd, selector: { name: 'Press Me' } })).result;
  check('selector resolved and clicked', bySel.method === 'invoke_pattern', `method=${bySel.method}`);

  console.log('\n-- wait_for --');
  const w = (await d.call('wait_for', { hwnd, selector: { name: 'Press Me' }, timeout_ms: 2000 })).result;
  check('wait_for finds an existing element', w.found === true);
  let waitErr = null;
  try { await d.call('wait_for', { hwnd, selector: { name: 'Nope Not Here' }, timeout_ms: 900 }); }
  catch (e) { waitErr = e; }
  check('wait_for times out with a typed error', waitErr && waitErr.code === 'wait_timeout', waitErr && waitErr.code);

  console.log('\n-- scroll --');
  const sc = (await d.call('scroll', { snapshot_id: snap.snapshot_id, index: notes.i, amount: -3, mode: 'take' })).result;
  check('scroll returns a method', !!sc.method, JSON.stringify(sc));

  console.log('\n-- screenshot --');
  const shotFull = (await d.call('screenshot', { max_width: 900, quality: 55 })).result;
  check('full screenshot encodes', shotFull.data && shotFull.data.length > 1000);
  console.log(`     full: ${shotFull.width}x${shotFull.height} ${Math.round(shotFull.bytes/1024)}KB -> ~${Math.round(shotFull.data.length/4)} tokens`);
  const shotWin = (await d.call('screenshot', { hwnd, max_width: 900, quality: 55 })).result;
  check('window screenshot encodes', shotWin.data && shotWin.data.length > 1000);
  // Compare captured pixel area, not JPEG byte size: a detailed small window can
  // compress to more bytes than a near-blank large desktop, so byte size is not
  // the invariant. The window region being smaller than the whole screen is.
  check('window shot covers a smaller region than full screen',
        (shotWin.source[2] * shotWin.source[3]) < (shotFull.source[2] * shotFull.source[3]),
        `win=${shotWin.source[2]}x${shotWin.source[3]} full=${shotFull.source[2]}x${shotFull.source[3]}`);
  console.log(`     window: ${shotWin.width}x${shotWin.height} ${Math.round(shotWin.bytes/1024)}KB -> ~${Math.round(shotWin.data.length/4)} tokens`);

  // The core economic claim of the whole design.
  const treeChars = JSON.stringify(snap.nodes).length;
  console.log(`     tree: ${treeChars} chars -> ~${Math.round(treeChars/4)} tokens`);
  check('tree is far cheaper than a screenshot', treeChars * 4 < shotWin.data.length,
        `tree=${treeChars} shot_b64=${shotWin.data.length}`);

  console.log('\n-- typed errors --');
  const cases = [
    ['unknown op',        () => d.call('nonsense_op', {}),                                            'unknown_op'],
    ['bad index',         () => d.call('click', { snapshot_id: snap.snapshot_id, index: 9999 }),      'index_out_of_range'],
    ['missing window',    () => d.call('snapshot', { hwnd: 424242 }),                                 'window_not_found'],
    ['expired snapshot',  () => d.call('click', { snapshot_id: 'sZZZ', index: 0 }),                   'snapshot_expired'],
    ['no target',         () => d.call('click', {}),                                                   'no_target'],
    ['bad selector',      () => d.call('click', { hwnd, selector: {} }),                              'bad_selector'],
    ['unknown key',       () => d.call('key', { keys: 'ctrl+notakey' }),                              'unknown_key'],
    ['element not found', () => d.call('click', { hwnd, selector: { name: 'Ghost Button' } }),        'element_not_found'],
  ];
  for (const [label, fn, expect] of cases) {
    let err = null;
    try { await fn(); } catch (e) { err = e; }
    check(`${label} -> ${expect}`, err && err.code === expect, err ? `got ${err.code}: ${err.message}` : 'no error thrown');
  }

  console.log('\n-- key chord --');
  // mode take: this suite is deliberately driving a window it created itself,
  // and must not fail because the person at the machine happens to be typing.
  // Whether Computer Use waits for them is presence-test's job, not this one's.
  await d.call('focus', { hwnd, mode: 'take' });
  const k = (await d.call('key', { keys: 'ctrl+a', hwnd, mode: 'take' })).result;
  check('key chord sends', k.sent === 'ctrl+a');

  console.log('\n-- close our own target --');
  const closed = (await d.call('close_window', { hwnd })).result;
  check('target window closed', closed.still_open === false, JSON.stringify(closed));

  console.log('\n-- concurrent calls --');
  const many = await Promise.all([
    d.call('ping'), d.call('list_apps'), d.call('ping'),
    d.call('list_apps'), d.call('ping'),
  ]);
  check('five concurrent calls all resolve', many.length === 5 && many.every((m) => m.result));
  check('responses are not cross-wired',
    many[0].result.ok === true && Array.isArray(many[1].result.windows));

  console.log('\n-- host crash recovery --');
  const oldPid = d.info && d.info.pid;
  try { d.proc.kill(); } catch {}
  await new Promise((r) => setTimeout(r, 900));
  // The next call must transparently start a fresh host rather than surfacing
  // the death to the caller.
  const revived = await d.call('ping');
  check('recovers after the host dies', revived.result.ok === true);
  check('recovered host is a new process', d.info && d.info.pid !== oldPid, `${oldPid} -> ${d.info && d.info.pid}`);
  let staleErr = null;
  try { await d.call('click', { snapshot_id: 's1', index: 0 }); } catch (e) { staleErr = e; }
  check('snapshots from the dead host are reported, not silently reused',
    staleErr && (staleErr.code === 'snapshot_expired' || staleErr.code === 'no_snapshot'),
    staleErr && staleErr.code);

  console.log('\n-- shutdown --');
  await d.stop();
  check('driver stopped cleanly', true);

  try { target.proc.kill(); } catch {}

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('failures: ' + failures.join(', ')); process.exit(1); }
}

main().catch((e) => { console.error('\nFATAL', e); process.exit(1); });
