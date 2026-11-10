// Every tool the server advertises must carry the four MCP annotation
// booleans (readOnlyHint, destructiveHint, idempotentHint, openWorldHint),
// and each one must say something true about the handler it names - not just
// be present. The M8ven trust index that scored 0.10.1 a C (74/100) flagged
// two separate gaps: annotations missing on tools, and no test naming any of
// the 21 tools by name. This file closes both: it names every tool the
// server can list, and pins the annotation booleans it expects for each one
// against the live tools/list response, so a future change to server/index.mjs
// that drops or falsifies an annotation fails here instead of shipping.
//
// The expectations below are hand-reasoned per tool from what its handler in
// server/index.mjs actually does (see EXPECTED_ANNOTATIONS comments), not
// copied from the schema under test - so this catches a wrong annotation,
// not just a missing one.

import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SERVER = path.join(ROOT, 'server', 'index.mjs');

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`); }
};

class Client {
  constructor(env) {
    this.proc = spawn(process.execPath, [SERVER], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.seq = 0; this.pending = new Map();
    createInterface({ input: this.proc.stdout }).on('line', (l) => {
      if (!l.trim()) return;
      let m; try { m = JSON.parse(l); } catch { return; }
      const e = this.pending.get(m.id);
      if (!e) return;
      this.pending.delete(m.id);
      m.error ? e.reject(new Error(m.error.message)) : e.resolve(m.result);
    });
    this.proc.stderr.on('data', () => {});
  }
  rpc(method, params) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  stop() { try { this.proc.kill(); } catch {} }
}

// Truthful, per-handler expectations. Keys are every tool name computer_apps
// through computer_turn_ended, so this list is also the "named in tests"
// inventory: 23 tools on Windows (21 elsewhere, since paste/open/file_dialog
// are Windows-only - see server/index.mjs's platform filter).
const EXPECTED_ANNOTATIONS = {
  // Pure reads: never change a window, an app, or session state.
  computer_apps:         { readOnlyHint: true,  destructiveHint: false, idempotentHint: true,  openWorldHint: true },
  computer_snapshot:      { readOnlyHint: true,  destructiveHint: false, idempotentHint: true,  openWorldHint: true },
  computer_screenshot:    { readOnlyHint: true,  destructiveHint: false, idempotentHint: true,  openWorldHint: true },
  computer_appshot:       { readOnlyHint: true,  destructiveHint: false, idempotentHint: true,  openWorldHint: true },
  computer_wait_for:      { readOnlyHint: true,  destructiveHint: false, idempotentHint: true,  openWorldHint: true },
  computer_status:        { readOnlyHint: true,  destructiveHint: false, idempotentHint: true,  openWorldHint: false },
  // Session-local bookkeeping: mutate this server's own state, not the
  // desktop, so they are not "open world".
  computer_grant:         { readOnlyHint: false, destructiveHint: false, idempotentHint: true,  openWorldHint: false },
  computer_recap:         { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  computer_turn_ended:    { readOnlyHint: false, destructiveHint: false, idempotentHint: true,  openWorldHint: false },
  // Acts on a real window without loss-of-data risk of its own.
  computer_launch:        { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  computer_focus:         { readOnlyHint: false, destructiveHint: false, idempotentHint: true,  openWorldHint: true },
  computer_scroll:        { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  computer_open:          { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  // Can overwrite or lose state that was not the point of the call.
  computer_clipboard:     { readOnlyHint: false, destructiveHint: true,  idempotentHint: true,  openWorldHint: true },
  computer_click:         { readOnlyHint: false, destructiveHint: true,  idempotentHint: false, openWorldHint: true },
  computer_type:          { readOnlyHint: false, destructiveHint: true,  idempotentHint: false, openWorldHint: true },
  computer_key:           { readOnlyHint: false, destructiveHint: true,  idempotentHint: false, openWorldHint: true },
  computer_drag:          { readOnlyHint: false, destructiveHint: true,  idempotentHint: false, openWorldHint: true },
  computer_run:           { readOnlyHint: false, destructiveHint: true,  idempotentHint: false, openWorldHint: true },
  computer_task:          { readOnlyHint: false, destructiveHint: true,  idempotentHint: false, openWorldHint: true },
  computer_close_window:  { readOnlyHint: false, destructiveHint: true,  idempotentHint: true,  openWorldHint: true },
  computer_paste:         { readOnlyHint: false, destructiveHint: true,  idempotentHint: false, openWorldHint: true },
  computer_file_dialog:   { readOnlyHint: false, destructiveHint: true,  idempotentHint: false, openWorldHint: true },
};

const WINDOWS_ONLY = new Set(['computer_paste', 'computer_open', 'computer_file_dialog']);

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-annot-'));
  const c = new Client({ CU_PLUGIN_DATA: dataDir });
  try {
    await c.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'annotations-test', version: '0' } });
    const list = await c.rpc('tools/list', {});
    const byName = new Map(list.tools.map((t) => [t.name, t]));

    const expectedNames = Object.keys(EXPECTED_ANNOTATIONS);
    check(`tools/list returns exactly the expected set (got ${byName.size})`,
      expectedNames.filter((n) => !WINDOWS_ONLY.has(n) || process.platform === 'win32').every((n) => byName.has(n)) &&
      [...byName.keys()].every((n) => expectedNames.includes(n)),
      `list: ${[...byName.keys()].sort().join(', ')}`);

    for (const name of expectedNames) {
      if (WINDOWS_ONLY.has(name) && process.platform !== 'win32') {
        check(`${name}: absent off Windows`, !byName.has(name));
        continue;
      }
      const tool = byName.get(name);
      check(`${name}: is listed`, !!tool);
      if (!tool) continue;
      const a = tool.annotations || {};
      const expected = EXPECTED_ANNOTATIONS[name];
      for (const key of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
        check(`${name}.${key} === ${expected[key]}`, a[key] === expected[key], `got ${JSON.stringify(a[key])}`);
      }
      // readOnlyHint true and destructiveHint true together would be a
      // contradiction in terms (destructiveHint is only meaningful when
      // readOnlyHint is false) - guard against that combination surviving
      // any future edit even if the pinned table above were wrong.
      check(`${name}: readOnly and destructive are not both true`, !(a.readOnlyHint && a.destructiveHint));
    }
  } finally {
    c.stop();
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main();
