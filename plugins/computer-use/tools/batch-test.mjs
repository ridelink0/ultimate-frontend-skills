// The 0.3.0 surface: stable indices, delta reads, find and subtree reads,
// waits on text / change / gone / new window, batched runs, background tasks,
// and posted input into a window that is behind another. Drives the MCP
// server from source against two throwaway targets; never touches a
// pre-existing app.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'server', 'index.mjs');
const TARGET = path.join(HERE, 'make-target.ps1');

let pass = 0, fail = 0; const failures = [];
const check = (n, c, d) => {
  if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; failures.push(n); console.log(`  FAIL ${n}${d ? ' :: ' + String(d).slice(0, 400) : ''}`); }
};
const tok = (s) => Math.round(s.length / 4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor() {
    this.proc = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.seq = 0; this.pending = new Map();
    createInterface({ input: this.proc.stdout }).on('line', (l) => {
      if (!l.trim()) return;
      let m; try { m = JSON.parse(l); } catch { return; }
      const e = this.pending.get(m.id);
      if (!e) return;
      this.pending.delete(m.id); clearTimeout(e.timer);
      m.error ? e.reject(new Error(m.error.message)) : e.resolve(m.result);
    });
    this.proc.stderr.on('data', (d) => { if (process.env.CU_TEST_VERBOSE) process.stderr.write('[srv] ' + d); });
  }
  rpc(method, params, ms = 60000) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(method + ' timed out')); }, ms);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  notify(method, params) { this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); }
  call(name, args = {}, ms) { return this.rpc('tools/call', { name, arguments: args }, ms); }
  stop() { try { this.proc.kill(); } catch {} }
}

// The same ceiling as mcp-test.mjs, for the same reason: the PowerShell
// WinForms target appears in about 3 s on an idle machine and took more than
// 15 s on 2026-09-25 with the CPU at 100%, which failed this suite before it
// had tested anything.
const TARGET_TIMEOUT_MS = Number(process.env.COMPUTER_USE_TARGET_TIMEOUT_MS) || 60000;

function spawnTarget(extra = []) {
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', TARGET, ...extra],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    const t = setTimeout(() => reject(new Error(`target never reported in within ${TARGET_TIMEOUT_MS} ms (COMPUTER_USE_TARGET_TIMEOUT_MS raises it)`)), TARGET_TIMEOUT_MS);
    createInterface({ input: p.stdout }).on('line', (l) => {
      try { const i = JSON.parse(l.trim()); if (i.title) { clearTimeout(t); resolve({ proc: p, ...i }); } } catch {}
    });
    p.stderr.on('data', (d) => console.error('target stderr:', d.toString().trim()));
  });
}

const body = (r) => (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');

// The stable index of the first ROW whose text matches (the header can name
// the focused control too, and is not a row).
function indexOf(snapText, re) {
  const line = snapText.split('\n').find((l) => /^[+~]?\s*\[\d+\]/.test(l.trim()) && re.test(l));
  const m = line && /^[+~]?\s*\[(\d+)\]/.exec(line.trim());
  return m ? Number(m[1]) : null;
}

async function main() {
  const c = new Client();
  await c.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  c.notify('notifications/initialized', {});

  console.log('\n-- surface --');
  const { tools } = await c.rpc('tools/list');
  const names = tools.map((t) => t.name);
  check('computer_run is a tool', names.includes('computer_run'));
  check('computer_task is a tool', names.includes('computer_task'));
  const schemaTokens = tok(JSON.stringify(tools));
  console.log(`     ${tools.length} tools, schema ~${schemaTokens} tokens`);
  // 0.5.0 added computer_recap and computer_turn_ended; 0.6.0 computer_drag
  // and computer_appshot (~300 tokens for the four); 0.8.0 computer_paste and
  // the paste/drag steps in computer_run (~50). The bound moves only when a
  // tool is added, never for a description that merely grew.
  // The same ceiling lives in astra-test.mjs, where the reason for every raise
  // is written down. Two copies of one number is how a budget drifts, so this
  // one only tracks that one: raise it there, with the argument, first.
  check('always-on schema cost stays under 4,030 tokens', schemaTokens <= 4030, String(schemaTokens));
  const snapTool = tools.find((t) => t.name === 'computer_snapshot');
  check('snapshot schema has index, find, full', ['index', 'find', 'full'].every((k) => snapTool.inputSchema.properties[k]));
  const waitTool = tools.find((t) => t.name === 'computer_wait_for');
  check('wait_for no longer requires selector', !(waitTool.inputSchema.required || []).includes('selector'));

  console.log('\n-- errors before any state --');
  const noTask = await c.call('computer_task', {});
  check('task with nothing started -> no_task', noTask.isError && body(noTask).includes('no_task'), body(noTask));

  console.log('\n-- target --');
  const target = await spawnTarget();
  await sleep(700);
  const apps = body(await c.call('computer_apps'));
  const line = apps.split('\n').find((l) => l.includes('Computer Use Test Target'));
  const hwnd = line && Number(line.trim().split(/\s+/)[0]);
  check('target listed', Number.isFinite(hwnd) && hwnd > 0, apps.slice(0, 200));

  const badWait = await c.call('computer_wait_for', { hwnd });
  check('wait_for with nothing to wait for -> bad_wait', badWait.isError && body(badWait).includes('bad_wait'), body(badWait));
  const noSteps = await c.call('computer_run', { hwnd, steps: [] });
  check('run with no steps -> no_steps', noSteps.isError && body(noSteps).includes('no_steps'), body(noSteps));

  console.log('\n-- stable indices and delta reads --');
  const s1 = body(await c.call('computer_snapshot', { hwnd }));
  const fullTokens = tok(s1);
  check('first read is a full listing', s1.includes('Press Me') && s1.includes('shown'), s1.slice(0, 200));
  const iPress = indexOf(s1, /Button "Press Me"/);
  const iStatus = indexOf(s1, /Text "idle"/);
  const iName = indexOf(s1, /Edit "Name field"/);
  const iAgree = indexOf(s1, /CheckBox "I agree"/);
  const iList = indexOf(s1, /List "Items"/);
  check('indices parsed', [iPress, iStatus, iName, iAgree, iList].every((x) => Number.isInteger(x)), JSON.stringify({ iPress, iStatus, iName, iAgree, iList }));

  const s2 = body(await c.call('computer_snapshot', { hwnd }));
  check('unchanged window reads as "no change"', /no change since s\d+/.test(s2), s2.slice(0, 200));
  check('a no-change read is tiny', tok(s2) < 60, String(tok(s2)));
  console.log(`     full ~${fullTokens} tokens, no-change read ~${tok(s2)} tokens`);

  await c.call('computer_grant', { hwnd });
  const click1 = await c.call('computer_click', { hwnd, index: iPress });
  check('click by stable index with no snapshot_id', !click1.isError && body(click1).includes('invoke_pattern'), body(click1));
  const s3 = body(await c.call('computer_snapshot', { hwnd }));
  check('delta shows the changed status row', new RegExp(`~ \\[${iStatus}\\].*pressed:1`).test(s3), s3);
  check('delta header counts changes', /changes since s\d+: \+\d+ ~\d+ -\d+/.test(s3), s3.split('\n')[0]);
  const rowsOf = (t) => t.split('\n').filter((l) => /^[+~-]?\s*\[\d+\]/.test(l.trim()));
  check('delta does not repeat unchanged rows', !rowsOf(s3).some((l) => l.includes('Press Me')), s3);
  console.log(`     delta read ~${tok(s3)} tokens`);

  const click2 = await c.call('computer_click', { hwnd, index: iPress });
  check('same index still valid after a delta read', !click2.isError, body(click2));
  const s4 = body(await c.call('computer_snapshot', { hwnd }));
  check('status keeps its index across reads', new RegExp(`~ \\[${iStatus}\\].*pressed:2`).test(s4), s4);

  const full = body(await c.call('computer_snapshot', { hwnd, full: true }));
  check('full:true forces the listing', full.includes('Press Me') && full.includes('pressed:2'), full.slice(0, 200));
  check('the listing keeps the same indices', indexOf(full, /Button "Press Me"/) === iPress && indexOf(full, /pressed:2/) === iStatus);

  const lean = body(await c.call('computer_snapshot', { hwnd, interactive_only: true }));
  check('different filters give a listing, not a delta', lean.includes('Press Me') && !/changes since/.test(lean), lean.slice(0, 120));

  console.log('\n-- find and subtree --');
  const found = body(await c.call('computer_snapshot', { hwnd, find: 'agree' }));
  check('find returns matching rows', found.includes('I agree') && /find "agree" in \d+ elements: 1 shown/.test(found), found);
  check('find leaves the rest out', !found.includes('Press Me'), found);
  const regex = body(await c.call('computer_snapshot', { hwnd, find: '/^(alpha|bravo)$/' }));
  check('find accepts a regex', regex.includes('Alpha') && regex.includes('Bravo') && !regex.includes('Charlie'), regex);
  const none = body(await c.call('computer_snapshot', { hwnd, find: 'zzzz-nothing' }));
  check('find with no hits says so', none.includes('no element matches'), none);
  const sub = body(await c.call('computer_snapshot', { hwnd, index: iList }));
  check('subtree read shows only the list', sub.includes('Alpha') && sub.includes('Delta') && !sub.includes('Press Me'), sub);
  check('subtree header names its root', sub.includes(`subtree of [${iList}]`), sub.split('\n')[0]);
  const badSub = await c.call('computer_snapshot', { hwnd, index: 99999 });
  check('subtree of an unknown index -> index_out_of_range', badSub.isError && body(badSub).includes('index_out_of_range'), body(badSub));

  console.log('\n-- waits --');
  const wt = body(await c.call('computer_wait_for', { hwnd, text: 'pressed:2' }));
  check('wait_for text finds it at once', /found "pressed:2" after \d+ms in \[\d+\]/.test(wt), wt);
  const wto = await c.call('computer_wait_for', { hwnd, text: 'never-there', timeout_ms: 600 });
  check('wait_for text times out', wto.isError && body(wto).includes('wait_timeout'), body(wto));
  const wg = body(await c.call('computer_wait_for', { hwnd, text: 'never-there', gone: true }));
  check('wait_for text gone:true returns when absent', wg.includes('is gone'), wg);
  const wsg = body(await c.call('computer_wait_for', { hwnd, selector: { automation_id: 'nope' }, gone: true }));
  check('wait_for selector gone:true returns when absent', wsg.includes('gone'), wsg);
  const wnc = await c.call('computer_wait_for', { hwnd, change: true, timeout_ms: 700 });
  check('wait_for change times out on a still window', wnc.isError && body(wnc).includes('did not change'), body(wnc));

  // Something changes the window while we wait for a change.
  const bg = body(await c.call('computer_run', { hwnd, background: true, read_after: false, steps: [{ sleep: 600 }, { click: { index: iPress } }] }));
  check('background run returns a task id', /task t\d+ started/.test(bg), bg);
  const wc = body(await c.call('computer_wait_for', { hwnd, change: true, timeout_ms: 6000 }));
  check('wait_for change returns the delta when it happens', /changed after \d+ms/.test(wc) && wc.includes('pressed:3'), wc);
  const tk = body(await c.call('computer_task', { wait_ms: 4000 }));
  check('task reports done', /status: done|: done,/.test(tk) || tk.includes('done, 2/2'), tk);
  check('task lists its step lines', /2 click \[\d+\]: clicked via/.test(tk), tk);

  console.log('\n-- new window --');
  // As long as the target itself may take to appear on a busy machine.
  const waiter = c.call('computer_wait_for', { hwnd, new_window: true, timeout_ms: TARGET_TIMEOUT_MS }, TARGET_TIMEOUT_MS + 15000);
  await sleep(400);
  // Parked top-centre so it is in front of the first target without covering
  // that target's buttons: a posted click on a covered spot is dropped by
  // frameworks that check the pointer's window, and that is tested separately.
  const second = await spawnTarget(['-CenterTop']);
  const nw = body(await waiter);
  check('wait_for new_window sees the second target', nw.includes('new window after') && nw.includes('Computer Use Test Target'), nw);
  const secondLine = body(await c.call('computer_apps')).split('\n').find((l) => l.includes(second.title));
  const hwnd2 = secondLine && Number(secondLine.trim().split(/\s+/)[0]);
  check('second target listed', Number.isFinite(hwnd2) && hwnd2 > 0 && hwnd2 !== hwnd);

  console.log('\n-- posted input into the window behind --');
  // The second target was activated on show, so the first is behind it.
  await c.call('computer_grant', { hwnd: hwnd2 });
  await c.call('computer_focus', { hwnd: hwnd2, mode: 'take' });
  await sleep(300);
  const typed = await c.call('computer_type', { hwnd, index: iName, text: 'posted hello' });
  check('typing into the window behind uses the posted path', !typed.isError && /via posted/.test(body(typed)), body(typed));
  const after = body(await c.call('computer_snapshot', { hwnd, find: 'Name field' }));
  check('the posted text is in the field', after.includes('posted hello'), after);
  // Checked HERE, after the typing and before the click. Posted typing is the
  // one input path that provably leaves the stacking order alone; a click does
  // not, even posted - WinForms focuses the control it is about to press, and
  // focusing a control activates its window. tools/fg-probe.mjs measures which
  // is which per toolkit.
  const fgQuiet = body(await c.call('computer_apps')).split('\n').find((l) => l.includes('[foreground]')) || '';
  if (fgQuiet.includes(String(hwnd2)) || fgQuiet.includes(String(hwnd))) {
    check('posted typing left the window behind', fgQuiet.includes(String(hwnd2)), fgQuiet);
  } else {
    // Windows would not give a test target the foreground: the user is at the
    // machine. Nothing to compare against, and their foreground is not a bug.
    console.log('     (the user holds the foreground; stacking not verifiable)');
  }
  const st1 = body(await c.call('computer_status'));
  const pc = body(await c.call('computer_click', { hwnd, index: iPress, physical: true, background: true }));
  check('background:true physical click is posted', pc.includes('posted_click'), pc);
  const after2 = body(await c.call('computer_snapshot', { hwnd, find: 'pressed' }));
  if (/under another window/.test(pc)) {
    // Something of the user's covers the button; WinForms drops a posted
    // click there, and the result said so. Not a verdict on the click path.
    console.log('     (the button is covered by another window right now; press not verifiable)');
  } else {
    check('posted click pressed the button', after2.includes('pressed:4'), after2 + '\n' + pc);
  }
  console.log('\n-- runs --');
  // The run section is about run mechanics, so it starts from a known
  // foreground. Leaving the previous section's window in front made step 4
  // (a key chord, which needs the window in front) race the foreground and
  // fail for reasons that say nothing about runs.
  await c.call('computer_focus', { hwnd, mode: 'take' });
  await sleep(300);
  const runFg = body(await c.call('computer_apps')).split('\n').find((l) => l.includes('[foreground]')) || '';
  // The last step is a key chord, and a chord needs the window in front. If
  // the user is at the machine Windows will not grant that, and the failure
  // would be theirs, not the run's - so drop the chord and test the rest.
  const chord = runFg.includes(String(hwnd)) ? [{ key: 'tab' }] : [];
  if (!chord.length) console.log('     (the user holds the foreground; testing the run without its key step)');
  const run1 = body(await c.call('computer_run', { hwnd, steps: [
    { type: { index: iName, text: 'from a run', replace: true } },
    { click: { index: iAgree } },
    { wait_for: { text: 'from a run' } },
    ...chord,
  ] }));
  const wanted = 3 + chord.length;
  check('run executes every step', new RegExp(`${wanted}/${wanted} step\\(s\\) ran, all ok`).test(run1), run1);
  check('run lines are compact', run1.split('\n').filter((l) => /^\d+ /.test(l)).every((l) => l.length < 260), run1);
  check('run ends with what changed', run1.includes('after the run:') && run1.includes('from a run'), run1);
  // The Disabled button never changes, so it appears only in a full listing.
  const closing = run1.slice(run1.indexOf('after the run:'));
  check('the closing read is a delta, not a listing', closing.includes('changes since') && !closing.includes('"Disabled"'), closing);

  const run2 = body(await c.call('computer_run', { hwnd, read_after: false, steps: [
    { click: { selector: { automation_id: 'nope' } } },
    { click: { index: iPress } },
  ] }));
  check('run stops at the first failure', run2.includes('FAILED') && /Not executed: an earlier computer action/.test(run2), run2);
  const run3 = body(await c.call('computer_run', { hwnd, read_after: false, stop_on_error: false, steps: [
    { click: { selector: { automation_id: 'nope' } } },
    { click: { index: iPress } },
  ] }));
  check('stop_on_error:false keeps going', /2\/2 step\(s\) ran, 1 failed/.test(run3), run3);
  const run4 = body(await c.call('computer_run', { hwnd, read_after: false, steps: [{ bogus: 1 }] }));
  check('an invalid step is reported, not thrown', run4.includes('INVALID'), run4);

  const run5 = body(await c.call('computer_run', { hwnd, read_after: false, steps: [{ click: { selector: { name: 'Send Payment' } } }] }));
  check('a consequential step needs confirmation inside a run too', run5.includes('needs_confirmation'), run5);
  const run6 = body(await c.call('computer_run', { hwnd, read_after: false, steps: [{ click: { selector: { name: 'Send Payment' } }, confirmed: true }] }));
  check('confirmed:true on the step lets it through', /all ok/.test(run6), run6);

  const many = Array.from({ length: 41 }, () => ({ sleep: 1 }));
  const run7 = await c.call('computer_run', { hwnd, steps: many });
  check('more than 40 steps is refused', run7.isError && body(run7).includes('too_many_steps'), body(run7));

  // A whole sequence must be able to run on a window that is not in front.
  // Batching would be worth much less if it cost the user their foreground:
  // set_value writes through the value pattern and a checkbox toggles through
  // its own pattern, so neither needs focus, a cursor, or a raise.
  console.log('\n-- a run works behind another window --');
  await c.call('computer_focus', { hwnd: hwnd2, mode: 'take' });
  await sleep(300);
  const foreground = async () => {
    const line = body(await c.call('computer_apps')).split('\n').find((l) => l.includes('[foreground]'));
    return line || '';
  };
  const fgBefore = await foreground();
  // The two quiet paths only: posted typing (no replace) and a click that goes
  // through the element's own toggle pattern. replace:true is deliberately not
  // here - WinForms focuses a text box when its value is set through the value
  // pattern, which activates the window, for a single call just as much as for
  // a step in a run.
  const behind = body(await c.call('computer_run', { hwnd, read_after: false, steps: [
    { type: { index: iName, text: 'behind you' } },
    { click: { index: iAgree } },
    { snapshot: { find: 'behind you' } },
  ] }));
  check('every background-safe step ran', /3\/3 step\(s\) ran, all ok/.test(behind), behind);
  check('nothing was typed with real keystrokes', !/waited \d+ms for the user/i.test(behind), behind);
  const landed = body(await c.call('computer_snapshot', { hwnd, find: 'Name field' }));
  check('the text landed in the window behind', landed.includes('behind you'), landed);
  // Whether the foreground moved is REPORTED, not asserted, and the reason is
  // worth knowing. WinForms' own UIA provider focuses a control when it is
  // toggled or has its value set, and focusing a control activates its window.
  // That is the provider, not this plugin: a single computer_click on the same
  // checkbox raises exactly as much as the same click inside a run. Asserting
  // here would be asserting something about WinForms. The plugin's own quiet
  // guarantee - no cursor moved, no keystrokes sent, the text delivered to a
  // window that is not in front - is what the three checks above establish.
  const fgAfter = await foreground();
  if (fgBefore && fgAfter !== fgBefore) {
    console.log('     (note: the target app took the foreground during the run;');
    console.log('      WinForms focuses a control on toggle/set-value, single calls do the same)');
  } else if (fgBefore) {
    console.log('     (the foreground did not move)');
  }

  console.log('\n-- shell doors stay shut --');
  const winKey = await c.call('computer_key', { hwnd, keys: 'win+r' });
  check('a Windows-key chord is refused', winKey.isError && body(winKey).includes('key_blocked'), body(winKey));
  const metaKey = await c.call('computer_key', { hwnd, keys: 'Meta+d' });
  check('so is meta', metaKey.isError && body(metaKey).includes('key_blocked'), body(metaKey));
  const shellLaunch = await c.call('computer_launch', { app: 'cmd' });
  check('launching a shell is refused', shellLaunch.isError && body(shellLaunch).includes('app_blocked'), body(shellLaunch));
  const blockedLaunch = await c.call('computer_launch', { app: 'C:\\tools\\keepass.exe' });
  check('launching a blocked app is refused', blockedLaunch.isError && body(blockedLaunch).includes('app_blocked'), body(blockedLaunch));
  const syntaxLaunch = await c.call('computer_launch', { app: 'notepad & calc' });
  check('shell syntax in a launch is refused', syntaxLaunch.isError && body(syntaxLaunch).includes('app_blocked'), body(syntaxLaunch));
  const noApp = await c.call('computer_launch', { app: '' });
  check('launch needs an app', noApp.isError && body(noApp).includes('no_app'), body(noApp));

  console.log('\n-- launch --');
  // Paint opens a fresh window per launch (Notepad and Calculator reuse the
  // one already open), with an empty canvas that closes without a prompt.
  const launched = body(await c.call('computer_launch', { app: 'mspaint', timeout_ms: 20000 }));
  check('launch waits for the new window', /launched "mspaint" after \d+ms: "/.test(launched), launched);
  const lh = (/hwnd (\d+)/.exec(launched) || [])[1];
  if (lh) {
    await c.call('computer_grant', { hwnd: Number(lh) });
    const closedNp = await c.call('computer_close_window', { hwnd: Number(lh) });
    check('the launched window closes', !closedNp.isError, body(closedNp));
  }

  console.log('\n-- cancel --');
  const long = body(await c.call('computer_run', { hwnd, background: true, read_after: false, steps: [{ sleep: 400 }, { sleep: 400 }, { sleep: 400 }, { sleep: 400 }, { sleep: 400 }] }));
  const id = (/task (t\d+)/.exec(long) || [])[1];
  const cancelled = body(await c.call('computer_task', { id, cancel: true, wait_ms: 4000 }));
  check('cancel stops a background run early', cancelled.includes('cancelled') && !cancelled.includes('5/5'), cancelled);
  const st2 = body(await c.call('computer_status'));
  check('status counts deltas and runs', /returned as changes only\), runs: [1-9]/.test(st2), st2);

  console.log('\n-- cleanup --');
  const closed1 = await c.call('computer_close_window', { hwnd: hwnd2 });
  const closed2 = await c.call('computer_close_window', { hwnd });
  check('closes both targets', !closed1.isError && !closed2.isError, body(closed1) + body(closed2));

  c.stop();
  try { target.proc.kill(); } catch {}
  try { second.proc.kill(); } catch {}

  console.log(`\n== cost summary ==`);
  console.log(`  always-on schemas : ~${schemaTokens} tokens`);
  console.log(`  full read         : ~${fullTokens} tokens`);
  console.log(`  no-change read    : ~${tok(s2)} tokens`);
  console.log(`  one-change read   : ~${tok(s3)} tokens`);
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('failures: ' + failures.join(', ')); process.exit(1); }
}

main().catch((e) => { console.error('\nFATAL', e); process.exit(1); });
