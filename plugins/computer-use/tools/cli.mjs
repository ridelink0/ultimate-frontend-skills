// Drives the MCP server from a shell, the way Claude Code does, and prints what
// each call cost. For checking a change against real windows without a Claude
// session in the loop.
//
//   node tools/cli.mjs apps
//   node tools/cli.mjs snapshot '{"title":"Notepad","interactive_only":true}'
//   node tools/cli.mjs --script steps.json        [{"tool":"computer_apps"}, {"sleep":500}, ...]
//   node tools/cli.mjs --json snapshot '{"hwnd":1234}'   raw MCP result
//
// A bare name is prefixed with computer_. Environment variables reach the
// server unchanged, so CU_OVERLAY=off and friends work.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'server', 'index.mjs');

const tok = (s) => Math.round(String(s).length / 4);

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
    this.proc.stderr.on('data', (d) => { if (process.env.CLI_QUIET !== '1') process.stderr.write('[srv] ' + d); });
  }
  rpc(method, params, ms = 180000) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(method + ' timed out')); }, ms);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  notify(method, params) { this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); }
  call(name, args = {}) { return this.rpc('tools/call', { name, arguments: args }); }
  stop() { try { this.proc.stdin.end(); } catch {} setTimeout(() => { try { this.proc.kill(); } catch {} }, 1500); }
}

const body = (r) => (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');

function toolName(n) { return n.startsWith('computer_') ? n : 'computer_' + n; }

// "hwnd:Notepad" anywhere in the arguments becomes the handle of the first
// window whose title contains that text, from a fresh computer_apps listing.
async function resolveHandles(c, args) {
  let apps = null;
  const lookup = async (title) => {
    if (!apps) apps = body(await c.call('computer_apps'));
    const line = apps.split('\n').find((l) => /^\d+\s/.test(l) && l.toLowerCase().includes(title.toLowerCase()));
    if (!line) throw new Error(`no window titled like "${title}"`);
    return Number(line.trim().split(/\s+/)[0]);
  };
  const walk = async (v) => {
    if (typeof v === 'string' && v.startsWith('hwnd:')) return lookup(v.slice(5));
    if (Array.isArray(v)) { const out = []; for (const x of v) out.push(await walk(x)); return out; }
    if (v && typeof v === 'object') { const out = {}; for (const k of Object.keys(v)) out[k] = await walk(v[k]); return out; }
    return v;
  };
  return walk(args);
}

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const rest = argv.filter((a) => a !== '--json');
  let steps;
  if (rest[0] === '--script') {
    steps = JSON.parse(fs.readFileSync(rest[1], 'utf8'));
  } else if (rest.length) {
    steps = [{ tool: rest[0], args: rest[1] ? JSON.parse(rest[1]) : {} }];
  } else {
    console.error('usage: node tools/cli.mjs <tool> [json-args] | --script file.json');
    process.exit(2);
  }

  const c = new Client();
  await c.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cli', version: '1' } });
  c.notify('notifications/initialized', {});

  let total = 0;
  for (const s of steps) {
    if (s.sleep) { await new Promise((r) => setTimeout(r, s.sleep)); continue; }
    const name = toolName(s.tool);
    let args;
    try { args = await resolveHandles(c, s.args || {}); }
    catch (err) { console.log(`## ${name} -> ${err.message}`); continue; }
    const t0 = Date.now();
    let r;
    try { r = await c.call(name, args); }
    catch (err) { console.log(`## ${name} -> rpc error: ${err.message}`); continue; }
    const ms = Date.now() - t0;
    const text = body(r);
    const images = (r.content || []).filter((x) => x.type === 'image').length;
    total += tok(text);
    if (json) { console.log(JSON.stringify(r)); continue; }
    console.log(`## ${name} ${JSON.stringify(s.args || {})} -> ${ms}ms, ~${tok(text)} tokens${images ? `, ${images} image` : ''}${r.isError ? ', ERROR' : ''}`);
    console.log(text);
    console.log('');
  }
  if (!json) console.log(`== ${steps.length} call(s), ~${total} tokens of text in total`);
  c.stop();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
