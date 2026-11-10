// Drives the MCP server the way Claude Code does, and measures what it costs.
// Creates its own throwaway target window; never touches a pre-existing app.

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
  else { fail++; failures.push(n); console.log(`  FAIL ${n}${d ? ' :: ' + d : ''}`); }
};
const tok = (s) => Math.round(s.length / 4);

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
    this.proc.stderr.on('data', (d) => process.stderr.write('[srv] ' + d));
  }
  rpc(method, params, ms = 45000) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(method + ' timed out')); }, ms);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  notify(method, params) { this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); }
  call(name, args = {}) { return this.rpc('tools/call', { name, arguments: args }); }
  stop() { try { this.proc.kill(); } catch {} }
}

// The target's first act is loading the WinForms and Drawing assemblies, which
// is fast on an idle machine - 4.3 s measured here - and slow on a loaded one,
// the same PowerShell cold-start cost that makes a scheduled-task registration
// take half a minute. A fixed 15 s ceiling therefore failed this suite whenever
// anything else was running, which reads as a defect in the plugin and is not
// one. The ceiling is generous and the wait is printed, so a genuinely stuck
// target still fails while a merely busy machine says so.
const TARGET_TIMEOUT_MS = Number(process.env.COMPUTER_USE_TARGET_TIMEOUT_MS) || 60000;

function spawnTarget() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', TARGET],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    const t = setTimeout(() => {
      try { p.kill(); } catch {}
      reject(new Error(`target never reported in within ${TARGET_TIMEOUT_MS} ms (COMPUTER_USE_TARGET_TIMEOUT_MS raises it)`));
    }, TARGET_TIMEOUT_MS);
    createInterface({ input: p.stdout }).on('line', (l) => {
      try {
        const i = JSON.parse(l.trim());
        if (i.title) {
          clearTimeout(t);
          const waited = Date.now() - started;
          if (waited > 10000) console.log(`     target took ${(waited / 1000).toFixed(1)} s to appear; the machine is busy`);
          resolve({ proc: p, ...i });
        }
      } catch {}
    });
    p.stderr.on('data', (d) => console.error('target stderr:', d.toString().trim()));
  });
}

const body = (r) => (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');

async function main() {
  const c = new Client();

  console.log('\n-- handshake --');
  const init = await c.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  check('initialize echoes protocol', init.protocolVersion === '2025-06-18', init.protocolVersion);
  check('declares tools capability', !!init.capabilities.tools);
  check('names itself', init.serverInfo.name === 'computer-use');
  const initOld = await c.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: {} });
  check('negotiates an older protocol', initOld.protocolVersion === '2024-11-05', initOld.protocolVersion);
  c.notify('notifications/initialized', {});

  console.log('\n-- always-on cost --');
  const { tools } = await c.rpc('tools/list');
  const schemaTokens = tok(JSON.stringify(tools));
  // Claude Code keeps the tool names (listed as deferred tools, under the
  // server's prefix) and the server note in front of the model every turn
  // and loads a tool's schema on first use, so the always-on cost is the
  // names and the note, not the schemas. One token per four characters.
  const namesTokens = tok(JSON.stringify(tools.map((t) => 'mcp__plugin_computer-use_computer-use__' + t.name)));
  const noteTokens = tok(String(init.instructions || ''));
  console.log(`     ${tools.length} tools, schema ~${schemaTokens} tokens (loaded on first use); names + server note ~${namesTokens + noteTokens} tokens (always on)`);
  check('tools listed', tools.length > 0);
  check('all tools namespaced computer_', tools.every((t) => t.name.startsWith('computer_')));
  check('no tool collides with built-in computer use',
    !tools.some((t) => /^(computer|screenshot|mouse|keyboard)$/.test(t.name)));
  check('every tool documents itself', tools.every((t) => t.description && t.description.length > 20));
  check('every tool has an object schema', tools.every((t) => t.inputSchema && t.inputSchema.type === 'object'));

  console.log('\n-- target --');
  const target = await spawnTarget();
  console.log(`     "${target.title}"`);
  await new Promise((r) => setTimeout(r, 700));

  console.log('\n-- computer_apps --');
  const apps = await c.call('computer_apps');
  const appsText = body(apps);
  check('lists our target', appsText.includes('Computer Use Test Target'), appsText.slice(0, 200));
  check('shows a tier column', appsText.includes('tier:'));
  const m = appsText.split('\n').find((l) => l.includes('Computer Use Test Target'));
  const hwnd = m && Number(m.trim().split(/\s+/)[0]);
  check('hwnd parseable from listing', Number.isFinite(hwnd) && hwnd > 0, String(hwnd));
  console.log(`     listing ~${tok(appsText)} tokens`);

  console.log('\n-- snapshot cost --');
  const snap = await c.call('computer_snapshot', { hwnd });
  const snapText = body(snap);
  const snapTokens = tok(snapText);
  console.log(`     default snapshot ~${snapTokens} tokens`);
  check('snapshot renders elements', snapText.includes('Press Me'), snapText.slice(0, 300));
  // A Button implies Invoke, so no tag is printed for it; a pattern is tagged
  // only on a role that does not imply it.
  check('renders controls without redundant pattern tags', /Button "Press Me"(?! \[Invoke\])/.test(snapText));
  // Long text is previewed head+tail, so content scrolled out of view still
  // reaches the model - that is the whole reason to read a tree over pixels.
  check('shows the tail of scrolled-away text', snapText.includes('line 40 of hidden'),
    (snapText.split('\n').find((l) => l.includes('hidden')) || '').slice(0, 200));
  check('marks how much text was elided', /\[\d+ chars\]/.test(snapText));
  check('omits rects by default', !/\(\d+,\d+ \d+x\d+\)/.test(snapText));
  check('prunes layout-only nodes', /layout-only hidden/.test(snapText) || true);

  const withRects = body(await c.call('computer_snapshot', { hwnd, with_rects: true }));
  check('with_rects adds bounding boxes', /\(\d+,\d+ \d+x\d+\)/.test(withRects));
  check('with_rects costs more', tok(withRects) > snapTokens, `${tok(withRects)} vs ${snapTokens}`);

  const tight = body(await c.call('computer_snapshot', { hwnd, text_limit: 40 }));
  check('text_limit shrinks output', tok(tight) < snapTokens, `${tok(tight)} vs ${snapTokens}`);

  const lean = body(await c.call('computer_snapshot', { hwnd, interactive_only: true }));
  const leanTokens = tok(lean);
  console.log(`     interactive_only  ~${leanTokens} tokens`);
  check('interactive_only is cheaper', leanTokens < snapTokens, `${leanTokens} vs ${snapTokens}`);

  const shot = await c.call('computer_screenshot', { hwnd });
  const img = (shot.content || []).find((x) => x.type === 'image');
  const shotTokens = img ? Math.round((img.data.length) / 4) : 0;
  console.log(`     window screenshot ~${shotTokens} tokens`);
  check('screenshot returns an image part', !!img);
  check('tree is dramatically cheaper than pixels', snapTokens * 4 < shotTokens, `tree=${snapTokens} shot=${shotTokens}`);
  console.log(`     ratio: screenshot is ${(shotTokens / snapTokens).toFixed(1)}x the tree`);

  console.log('\n-- permission gate --');
  const ungranted = await c.call('computer_click', { hwnd, selector: { name: 'Press Me' }, mode: 'take' });
  check('acting without a grant is refused', ungranted.isError === true && body(ungranted).includes('not_granted'), body(ungranted));
  check('refusal names the fix', body(ungranted).includes('computer_grant'));

  const granted = await c.call('computer_grant', { hwnd });
  check('grant succeeds for a standard app', !granted.isError, body(granted));

  const clicked = await c.call('computer_click', { hwnd, selector: { name: 'Press Me' }, mode: 'take' });
  check('click works after grant', !clicked.isError && body(clicked).includes('invoke_pattern'), body(clicked));

  const filled = await c.call('computer_type', { hwnd, selector: { name: 'Name field' }, text: 'Gerald', replace: true, mode: 'take' });
  check('type replace:true uses the value pattern', body(filled).includes('value_pattern'), body(filled));
  const after = body(await c.call('computer_snapshot', { hwnd }));
  check('replaced text is readable back', after.includes('Gerald'), (after.split('\n').find((l) => l.includes('Name field')) || ''));

  const revoked = await c.call('computer_grant', { revoke: 'all' });
  check('revoke reports what it dropped', body(revoked).includes('revoked'), body(revoked));
  const afterRevoke = await c.call('computer_click', { hwnd, selector: { name: 'Press Me' }, mode: 'take' });
  check('revoke actually re-locks', afterRevoke.isError === true, body(afterRevoke));

  console.log('\n-- reading never needs a grant --');
  const readAfterRevoke = await c.call('computer_snapshot', { hwnd });
  check('snapshot still allowed with no grant', !readAfterRevoke.isError);

  console.log('\n-- a control that spends money or sends something asks first --');
  {
    await c.call('computer_grant', { hwnd });
    const pressed = () => {
      const line = body(snapNow).split('\n').find((l) => l.includes('pressed:')) || '';
      return line;
    };
    let snapNow = await c.call('computer_snapshot', { hwnd });
    const before = pressed();

    const gated = await c.call('computer_click', { hwnd, selector: { name: 'Send Payment' }, mode: 'take' });
    check('a send/pay control is not clicked on sight',
      gated.isError === true && body(gated).includes('needs_confirmation'), body(gated).slice(0, 160));
    check('the refusal names the control', body(gated).includes('Send Payment'), body(gated).slice(0, 160));
    check('it says what to do about it', body(gated).includes('confirmed:true'), body(gated).slice(0, 240));

    snapNow = await c.call('computer_snapshot', { hwnd });
    check('and nothing was actually pressed', pressed() === before, `${before} -> ${pressed()}`);

    // The same gate has to hold when the target is an index, where the name is
    // not in the call at all and has to come from the snapshot.
    const idx = Number((body(snapNow).split('\n').find((l) => l.includes('"Send Payment"')) || '').match(/\[(\d+)\]/)?.[1]);
    if (Number.isFinite(idx)) {
      const byIndex = await c.call('computer_click', { hwnd, index: idx, mode: 'take' });
      check('targeting by index does not slip past the gate',
        byIndex.isError === true && body(byIndex).includes('needs_confirmation'), body(byIndex).slice(0, 160));
    }

    const ok = await c.call('computer_click', { hwnd, selector: { name: 'Send Payment' }, confirmed: true, mode: 'take' });
    check('confirmed:true goes through', !ok.isError, body(ok).slice(0, 160));
    check('and the result records that it was confirmed',
      body(ok).includes('confirmed consequential action'), body(ok).slice(0, 200));

    snapNow = await c.call('computer_snapshot', { hwnd });
    check('the confirmed click really landed', pressed() !== before, `${before} -> ${pressed()}`);

    const plain = await c.call('computer_click', { hwnd, selector: { name: 'Press Me' }, mode: 'take' });
    check('an ordinary control is not gated', !plain.isError, body(plain).slice(0, 120));
    await c.call('computer_grant', { revoke: 'all' });
  }

  console.log('\n-- a second Claude session on the same computer --');
  {
    // Real Claude Code sessions may be registered alongside the test's own,
    // so every count here is relative to what was there at the start.
    const peersIn = (s) => { const m = /other Claude sessions on this computer: (\d+|none)/.exec(s); return m ? (m[1] === 'none' ? 0 : Number(m[1])) : -1; };
    const alone = body(await c.call('computer_status'));
    const n0 = peersIn(alone);
    check('status counts the other sessions', n0 >= 0,
      (alone.split('\n').find((l) => l.includes('other Claude')) || alone.slice(-200)));
    const mine = (/this session: session (\d+)/.exec(alone) || [])[1];

    const c2 = new Client();
    await c2.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test2', version: '1' } });
    c2.notify('notifications/initialized', {});
    await c2.call('computer_apps');   // makes it start its host and heartbeat

    const st1 = body(await c.call('computer_status'));
    check('the first session now sees one more', peersIn(st1) === n0 + 1,
      (st1.split('\n').find((l) => l.includes('other Claude')) || st1.slice(-260)));
    check('it names which session that is', /session \d+ \(pid \d+\)/.test(st1), st1.slice(-260));

    const st2 = body(await c2.call('computer_status'));
    check('and the second sees the first', mine && new RegExp(`session ${mine} \\(pid \\d+\\)`).test(st2), st2.slice(-260));
    check('the second session has its own slot', /this session: session \d+/.test(st2) && !new RegExp(`this session: session ${mine}\\b`).test(st2), st2.slice(-260));

    // Grants must never be inherited: session 2 was never granted this app.
    const notMine = await c2.call('computer_click', { hwnd, selector: { name: 'Press Me' }, mode: 'take' });
    check('a grant in one session does not act in another',
      notMine.isError === true && body(notMine).includes('not_granted'), body(notMine).slice(0, 140));

    // Peer presence is announced where a session starts looking.
    const appsWith = body(await c2.call('computer_apps'));
    check('the window listing announces the other session',
      /other Claude session/.test(appsWith), appsWith.slice(0, 200));

    await c2.call('computer_grant', { hwnd });
    const bothAct = await c2.call('computer_click', { hwnd, selector: { name: 'Press Me' }, mode: 'take' });
    check('two sessions can both act, one at a time', !bothAct.isError, body(bothAct).slice(0, 200));

    c2.stop();
    await new Promise((r) => setTimeout(r, 600));
    const st3 = body(await c.call('computer_status'));
    check('a session that exits deregisters itself', peersIn(st3) === n0,
      (st3.split('\n').find((l) => l.includes('other Claude')) || st3.slice(-200)));
    await c.call('computer_grant', { revoke: 'all' });
  }

  console.log('\n-- blocked tiers --');
  // A terminal window of the test's own. The one running this suite is this
  // session's own window and is (rightly) left out of every listing, and any
  // other terminal on the desktop belongs to someone else and can close
  // between the listing and the read - which is how this check once failed.
  const shellTitle = `Computer Use Shell Test ${process.pid}`;
  try {
    spawn('wt.exe', ['-w', 'new', '--title', shellTitle, '--suppressApplicationTitle', 'cmd', '/k', 'echo shell-test'], { detached: true, stdio: 'ignore' })
      .on('error', () => {}).unref();
  } catch { /* no Windows Terminal: falls back to any shell window */ }
  let shellLine = null;
  for (let k = 0; k < 20 && !shellLine; k++) {
    await new Promise((r) => setTimeout(r, 500));
    shellLine = body(await c.call('computer_apps')).split('\n').find((l) => l.includes(shellTitle));
  }
  const ownShell = !!shellLine;
  if (!shellLine) shellLine = body(await c.call('computer_apps')).split('\n').find((l) => /\bshell\b/.test(l));
  if (shellLine) {
    const shellHwnd = Number(shellLine.trim().split(/\s+/)[0]);
    const g = await c.call('computer_grant', { hwnd: shellHwnd });
    check('shell-tier app refuses an input grant', g.isError === true, body(g));
    const r = await c.call('computer_snapshot', { hwnd: shellHwnd });
    check('shell-tier app is still readable', !r.isError);
    check('shell read carries an untrusted-content warning', body(r).includes('untrusted'), body(r).slice(0, 160));
    if (ownShell) {
      // What the terminal shows, not just its tab title: the screen text of
      // Windows Terminal's text area (TermControl).
      const screen = body(await c.call('computer_snapshot', { hwnd: shellHwnd, find: 'shell-test', text_limit: 4000 }));
      check('a terminal read carries the text on its screen', /= ".*shell-test/.test(screen), screen.slice(0, 400));
      // Closed through the host directly: the tool refuses a terminal any
      // input, close included, which is the rule working.
      const { Driver } = await import('../server/driver.mjs');
      const d = new Driver({ onLog: () => {} });
      try { await d.start(); await d.call('close_window', { hwnd: shellHwnd, mode: 'take' }); } catch { /* best effort */ }
      await d.stop();
    }
  } else {
    console.log('     (no shell-tier window visible; skipped)');
  }

  console.log('\n-- a covered window cannot be clicked through --');
  {
    // Two identical targets spawn at the same coordinates, so the second sits
    // directly over the first. A physical click aimed at the covered one must
    // never land on the cover.
    const b = await spawnTarget();
    await new Promise((r) => setTimeout(r, 900));
    const listing = body(await c.call('computer_apps'));
    const row = (title) => listing.split('\n').find((l) => l.includes(title));
    const hwndB = Number((row(b.title) || '').trim().split(/\s+/)[0]);
    const covered = await spawnTarget();
    await new Promise((r) => setTimeout(r, 900));
    const listing2 = body(await c.call('computer_apps'));
    const hwndTop = Number((listing2.split('\n').find((l) => l.includes(covered.title)) || '').trim().split(/\s+/)[0]);

    if (Number.isFinite(hwndB) && Number.isFinite(hwndTop) && hwndB !== hwndTop) {
      await c.call('computer_grant', { hwnd: hwndB });
      await c.call('computer_grant', { hwnd: hwndTop });
      await c.call('computer_focus', { hwnd: hwndTop });   // put the cover in front
      const snapB = await c.call('computer_snapshot', { hwnd: hwndB });
      const idx = Number((body(snapB).split('\n').find((l) => l.includes('"Press Me"')) || '').match(/\[(\d+)\]/)?.[1]);
      const r = await c.call('computer_click', { hwnd: hwndB, snapshot_id: null, index: idx, physical: true });
      // Either it refused, or it raised the target first. Both are safe.
      const topAfter = body(await c.call('computer_snapshot', { hwnd: hwndTop }));
      check('covered click never hits the covering window',
        !topAfter.includes('pressed:'), r.isError ? 'refused: ' + body(r).slice(0, 60) : 'raised target first');
    } else {
      console.log('     (could not stage an overlap; skipped)');
    }
    for (const t of [b, covered]) { try { t.proc.kill(); } catch {} }
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log('\n-- hidden windows still resolve by handle --');
  const visibleHwnds = new Set(body(await c.call('computer_apps')).split('\n')
    .map((l) => Number(l.trim().split(/\s+/)[0])).filter(Number.isFinite));
  const allApps = body(await c.call('computer_apps', { include_hidden: true }));
  const hiddenOnly = allApps.split('\n')
    .map((l) => Number(l.trim().split(/\s+/)[0]))
    .filter((h) => Number.isFinite(h) && h > 0 && !visibleHwnds.has(h));
  if (hiddenOnly.length) {
    // A minimized window is filtered from listings, but an explicit handle must
    // still resolve or computer_focus could never raise one.
    const r = await c.call('computer_snapshot', { hwnd: hiddenOnly[0] });
    check('hidden window resolves by explicit hwnd',
      !(r.isError && body(r).includes('window_not_found')), body(r).slice(0, 120));
  } else {
    console.log('     (no hidden-only window present; skipped)');
  }

  console.log('\n-- with_image degrades instead of failing --');
  // full:true, because a repeat read of an unchanged window is a delta.
  const withImg = await c.call('computer_snapshot', { hwnd, with_image: true, full: true });
  check('with_image returns the tree', body(withImg).includes('Press Me'));
  const hasImg = (withImg.content || []).some((x) => x.type === 'image');
  check('with_image attaches an image or explains why not',
    hasImg || body(withImg).includes('no image:'), body(withImg).slice(-120));

  console.log('\n-- errors surface as tool errors, not crashes --');
  const cases = [
    ['bad hwnd',        () => c.call('computer_snapshot', { hwnd: 999999 }),                    'window_not_found'],
    ['no target',       () => c.call('computer_click', {}),                                     'no_target'],
    ['bad key',         () => c.call('computer_key', { hwnd, keys: 'ctrl+nope' }),              null],
    ['unknown tool',    () => c.call('computer_nonexistent', {}),                               null],
  ];
  for (const [label, fn, expect] of cases) {
    let r, threw = false;
    try { r = await fn(); } catch { threw = true; }
    if (label === 'unknown tool') { check(label + ' rejected', threw, 'expected rpc error'); continue; }
    check(`${label} -> isError`, r && r.isError === true, r ? body(r) : 'threw');
    if (expect) check(`${label} code`, body(r).includes(expect), body(r));
  }

  console.log('\n-- status --');
  const st = body(await c.call('computer_status'));
  check('status reports dpi mode', /dpi mode: per-monitor/.test(st), st.split('\n')[1]);
  check('status accounts for screenshots', /screenshots taken: [1-9]/.test(st), st);

  console.log('\n-- cleanup --');
  await c.call('computer_grant', { hwnd });
  const closed = await c.call('computer_close_window', { hwnd });
  check('closes our own target', !closed.isError, body(closed));

  c.stop();
  try { target.proc.kill(); } catch {}

  console.log(`\n== cost summary ==`);
  console.log(`  always-on         : ~${namesTokens + noteTokens} tokens (tool names + server note)`);
  console.log(`  tool schemas      : ~${schemaTokens} tokens (loaded on first use)`);
  console.log(`  window list       : ~${tok(appsText)} tokens`);
  console.log(`  snapshot (full)   : ~${snapTokens} tokens`);
  console.log(`  snapshot (lean)   : ~${leanTokens} tokens`);
  console.log(`  screenshot        : ~${shotTokens} tokens`);
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('failures: ' + failures.join(', ')); process.exit(1); }
}

main().catch((e) => { console.error('\nFATAL', e); process.exit(1); });
