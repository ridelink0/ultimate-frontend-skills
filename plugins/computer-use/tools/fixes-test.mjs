// Logic checks for the 0.9.7 fixes - the issues found on 2026-09-26 while
// filling a web form with Computer Use. Pure logic over the render, run,
// session and policy modules: no host, no window. What needs a real browser
// is in web-test.mjs.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message)); }
}
async function checkAsync(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message)); }
}

const { buildRows, renderSnapshot, findMatcher, nodeMatches, excludeSubtrees, printedRow } = await import('../server/render.mjs');
const { Tasks, validateSteps } = await import('../server/tasks.mjs');
const { Sessions } = await import('../server/sessions.mjs');
const { Policy } = await import('../server/policy.mjs');

const long = 'This validation message is deliberately much longer than seventy characters, so a cut shows: the end is HERE.';
const snap = {
  snapshot_id: 's1', title: 'Form', hwnd: 1, web: true,
  nodes: [
    { i: 0, role: 'Window', depth: 0, name: 'Form' },
    { i: 1, role: 'Document', depth: 1, name: 'Form', text: 'https://example.com/form' },
    { i: 2, role: 'Group', depth: 2, name: 'Sidebar', landmark: 'navigation' },
    { i: 3, role: 'Hyperlink', depth: 3, name: 'Chat one', patterns: ['Invoke'] },
    { i: 4, role: 'Hyperlink', depth: 3, name: 'Chat two', patterns: ['Invoke'] },
    { i: 5, role: 'Group', depth: 2, landmark: 'main' },
    { i: 6, role: 'Text', depth: 3, name: long },
    { i: 7, role: 'Group', depth: 3, name: 'Next' },
    { i: 8, role: 'Button', depth: 4, name: 'Next', patterns: ['Invoke'] },
    { i: 9, role: 'RadioButton', depth: 3, name: 'Yes', patterns: ['SelectionItem'] },
    { i: 10, role: 'RadioButton', depth: 3, name: 'No', patterns: ['SelectionItem'] },
    { i: 11, role: 'Button', depth: 3, name: 'A button whose label runs on and on past seventy characters for no good reason', patterns: ['Invoke'] },
  ],
};

console.log('names (issue 3)');
check('a Text node\'s name is shown whole by default', () => {
  const rows = buildRows(snap).rows.map((r) => r.line).join('\n');
  assert.ok(rows.includes('the end is HERE.'), rows);
});
check('a button\'s long name is still cut at 70, and says how long it was', () => {
  const row = buildRows(snap).rows.find((r) => r.i === 11).line;
  assert.match(row, /… \[\d+ chars\]"/);
});
check('text_limit applies to names too', () => {
  const row = buildRows(snap, { textLimit: 400 }).rows.find((r) => r.i === 11).line;
  assert.ok(row.includes('for no good reason'), row);
  const cut = buildRows(snap, { textLimit: 30 }).rows.find((r) => r.i === 6).line;
  assert.ok(!cut.includes('HERE') && /\[\d+ chars\]/.test(cut), cut);
});

console.log('landmarks and exclude (issue 12)');
check('an unnamed main landmark gets a row', () => {
  const row = buildRows(snap).rows.find((r) => r.i === 5);
  assert.ok(row && row.line.includes('Group (main)'), row && row.line);
});
check('the named sidebar says it is navigation', () => {
  assert.ok(buildRows(snap).rows.find((r) => r.i === 2).line.includes('Group "Sidebar" (navigation)'));
});
check('exclude drops a subtree and nothing else', () => {
  const kept = excludeSubtrees(snap.nodes, [2]).map((n) => n.i);
  assert.deepEqual(kept, [0, 1, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(excludeSubtrees(snap.nodes, []).length, snap.nodes.length);
});

console.log('find (issue 13)');
check('find matches the printed row', () => {
  const m = findMatcher('/Button "Next/');
  assert.deepEqual(snap.nodes.filter((n) => nodeMatches(n, m)).map((n) => n.i), [8]);
  const r = findMatcher('/RadioButton "(No|Yes)/');
  assert.deepEqual(snap.nodes.filter((n) => nodeMatches(n, r)).map((n) => n.i), [9, 10]);
});
check('find on a plain word still matches fields', () => {
  const m = findMatcher('chat');
  assert.deepEqual(snap.nodes.filter((n) => nodeMatches(n, m)).map((n) => n.i), [3, 4]);
});
check('the printed row carries flags', () => {
  assert.equal(printedRow({ role: 'CheckBox', name: 'I agree', state: { toggle: 'On', disabled: true } }), 'CheckBox "I agree" {disabled toggle=On}');
});

console.log('max_nodes (issue 8)');
check('max_nodes caps the rows shown, and says so', () => {
  const out = renderSnapshot(snap, { maxRows: 3 });
  const rows = out.split('\n').filter((l) => /^\[\d+\]/.test(l));
  assert.equal(rows.length, 3);
  assert.match(out, /3 shown of \d+ \(max_nodes\)/);
});

console.log('runs (issues 4, 5)');
check('timeout_ms on a step is accepted and reaches the wait', () => {
  const v = validateSteps([{ wait_for: { text: 'x' }, timeout_ms: 30000 }]);
  assert.equal(v.errors.length, 0, v.errors.join());
  assert.equal(v.plan[0].args.timeout_ms, 30000);
});
check('an unknown step field is refused, not ignored', () => {
  const v = validateSteps([{ wait_for: { text: 'x' }, timeuot_ms: 30000 }]);
  assert.equal(v.errors.length, 1);
  assert.match(v.errors[0], /unknown field timeuot_ms/);
});
check('the fields a step always took are still accepted', () => {
  const v = validateSteps([{ click: { index: 1 }, optional: true, repeat: 2, confirmed: true, mode: 'take', hwnd: 5 }]);
  assert.equal(v.errors.length, 0, v.errors.join());
});
await checkAsync('a wait for change keeps its whole delta in the run lines', async () => {
  const t = new Tasks();
  const delta = 'changed after 300ms\ns9 "Form" | changes since s8: +3 ~0 -0\n\n+ [40] Text "next pressed"\n+ [41] Text "a second new row"\n+ [42] Text "a third new row that is long enough to be cut in one line"';
  const v = validateSteps([{ click: { index: 8 } }, { wait_for: { change: true } }]);
  const r = await t.runSteps(v.plan, { hwnd: 1, title: 'Form' }, async (kind) => (kind === 'wait_for' ? { text: delta, isError: false } : { text: 'clicked via invoke_pattern.', isError: false }), {});
  const all = r.lines.join('\n');
  assert.ok(all.includes('a third new row that is long enough to be cut in one line'), all);
});
await checkAsync('an action followed by a wait for change asks for a before picture first', async () => {
  const t = new Tasks();
  const seen = [];
  const v = validateSteps([{ click: { index: 8 } }, { wait_for: { change: true } }, { click: { index: 9 } }]);
  await t.runSteps(v.plan, { hwnd: 1, title: 'Form', beforeAction: async (h) => { seen.push(`before ${h}`); } },
    async (kind) => { seen.push(kind); return { text: 'ok', isError: false }; }, {});
  assert.deepEqual(seen, ['before 1', 'click', 'wait_for', 'click']);
});

console.log('a resumed conversation (issue 10)');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-fixes-'));
check('a peer of the same conversation is named as such, not as another Claude', () => {
  const dir = path.join(tmp, 'sessions');
  const alive = () => true;
  const old = new Sessions({ dir, pid: 5001, sessionId: 'conv-1', isAlive: alive });
  old.register();
  const other = new Sessions({ dir, pid: 5002, sessionId: 'conv-2', isAlive: alive });
  other.register();
  const now = new Sessions({ dir, pid: 5003, sessionId: 'conv-1', isAlive: alive });
  now.register();
  const note = now.note(null, { always: true });
  assert.match(note, /earlier process of this same conversation is still running \(pid 5001/);
  assert.match(note, /\[1 other Claude session shares this desktop: session \d \(pid 5002/);
  assert.ok(!/5001\): /.test(note.split('\n')[0]), note);
});
check('a server started without the id learns it from the Stop hook', () => {
  const s = new Sessions({ dir: path.join(tmp, 's2'), pid: 6001, isAlive: () => true });
  s.register();
  s.setSessionId('conv-9');
  const rec = JSON.parse(fs.readFileSync(path.join(tmp, 's2', '6001.json'), 'utf8'));
  assert.equal(rec.session_id, 'conv-9');
});
check('grants survive into the next process of the same conversation', () => {
  const store = path.join(tmp, 'grants-conv-1.json');
  const w = { hwnd: 7, pid: 70, process: 'notepad', title: 'Untitled', class: 'Notepad', path: 'C:\\Windows\\notepad.exe' };
  const first = new Policy({ store });
  assert.equal(first.grant(w).ok, true);
  const second = new Policy({ store });
  assert.deepEqual(second.restore(), ['notepad']);
  assert.equal(second.checkAct(w).ok, true);
});
check('a Stop (revokeAll) clears the saved grants too', () => {
  const store = path.join(tmp, 'grants-conv-2.json');
  const w = { hwnd: 8, pid: 80, process: 'mspaint', title: 'Paint', class: 'MSPaintApp', path: 'C:\\Windows\\mspaint.exe' };
  const p = new Policy({ store });
  p.grant(w);
  p.revokeAll();
  assert.equal(fs.existsSync(store), false);
  assert.deepEqual(new Policy({ store }).restore(), []);
});
check('another conversation\'s grants are not restored', () => {
  const store = path.join(tmp, 'grants-conv-3.json');
  assert.deepEqual(new Policy({ store }).restore(), []);
});
check('the terminal a session is drawn in is its own window', () => {
  const p = new Policy();
  p.markSelfWindow(1181486);
  assert.equal(p.isSelf({ hwnd: 1181486, pid: 1 }), true);
  assert.equal(p.checkRead({ hwnd: 1181486, pid: 1, process: 'WindowsTerminal' }).code, 'self_window');
  assert.equal(p.isSelf({ hwnd: 42, pid: 1 }), false);
});

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(`\nfixes-test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
