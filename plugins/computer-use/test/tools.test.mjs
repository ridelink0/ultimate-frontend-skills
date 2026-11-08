// Names every tool the server lists and runs the live tools/list suite against them (run: npm test).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = [
  "computer_apps",
  "computer_launch",
  "computer_snapshot",
  "computer_screenshot",
  "computer_grant",
  "computer_focus",
  "computer_click",
  "computer_type",
  "computer_key",
  "computer_scroll",
  "computer_drag",
  "computer_appshot",
  "computer_wait_for",
  "computer_run",
  "computer_task",
  "computer_close_window",
  "computer_clipboard",
  "computer_paste",
  "computer_open",
  "computer_file_dialog",
  "computer_status",
  "computer_recap",
  "computer_turn_ended"
];
const source = fs.readFileSync(path.join(ROOT, 'server', 'index.mjs'), 'utf8');
for (const tool of TOOLS) assert.ok(source.includes(tool), tool + ' is defined by the server');
const run = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'annotations-test.mjs')], { encoding: 'utf8', timeout: 120000 });
assert.equal(run.status, 0, run.stdout + run.stderr);
for (const tool of TOOLS) assert.ok(fs.readFileSync(path.join(ROOT, 'tools', 'annotations-test.mjs'), 'utf8').includes(tool), tool + ' has its hints pinned');
console.log('ok: ' + TOOLS.length + ' tools named and their hints checked against the live server');
