// Owns the long-lived host process and the line-delimited JSON protocol that
// runs over its stdio. One host per Computer Use session keeps AutomationElement
// references alive between calls, which is what makes a tree lookup cost
// milliseconds instead of re-walking from the desktop root every action.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { ensureHost } from './build.mjs';

export class HostError extends Error {
  constructor(code, message, hint) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

export class Driver {
  constructor({ timeoutMs = 30000, onLog = () => {}, env = null, onEvent = null } = {}) {
    this.timeoutMs = timeoutMs;
    this.onEvent = onEvent;
    this.onLog = onLog;
    // Extra environment for the host - which overlay slot this session owns, and
    // what to call it on screen when more than one Claude is running.
    this.env = env;
    this.proc = null;
    this.seq = 0;
    this.pending = new Map();
    this.ready = null;
    this.info = null;
    this.stderr = [];
    this.starting = null;
  }

  async start() {
    if (this.starting) return this.starting;
    if (this.proc && !this.proc.killed && this.info) return this.info;
    // Defer launch until the shared promise is assigned, even for sync failures.
    const attempt = Promise.resolve().then(() => this._launch());
    this.starting = attempt;
    try { return await attempt; }
    finally { if (this.starting === attempt) this.starting = null; }
  }

  _launch() {
    return new Promise((resolve, reject) => {
      let exe;
      try { exe = ensureHost({ log: this.onLog }).exe; }
      catch (err) { reject(new HostError(err.code || 'build_failed', err.message, err.hint)); return; }
      const proc = spawn(exe, [], {
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
        env: this.env ? { ...process.env, ...this.env } : process.env,
      });
      this.proc = proc;
      let settled = false;
      let bootTimer;
      const fail = (err) => {
        clearTimeout(bootTimer);
        if (this.proc === proc) {
          this.proc = null; this.info = null; this.ready = null;
          this._failAll(err);
        }
        if (!settled) { settled = true; reject(err); }
      };
      createInterface({ input: proc.stdout }).on('line', line => { if (this.proc === proc) this._onLine(line); });
      proc.stdin.on('error', err => this.onLog('host stdin: ' + err.message));
      proc.stderr.on('data', d => {
        this.stderr.push(d.toString());
        if (this.stderr.length > 50) this.stderr.shift();
        this.onLog('host stderr: ' + d.toString().trim());
      });
      proc.on('error', err => fail(new HostError('host_spawn_failed', err.message,
        'Try a forced rebuild: node server/build.mjs --force')));
      proc.on('exit', (code, signal) => fail(new HostError('host_exited',
        'Host process exited (code=' + code + ' signal=' + signal + ').',
        'The next call will start a fresh host.')));
      // 45 s, not 20: on 2026-09-28, with the CPU near 85%, a host that is
      // normally ready in under a second took more than 20 s about one start
      // in five, and every one of those failed its first call.
      bootTimer = setTimeout(() => {
        fail(new HostError('host_timeout', 'Host did not report ready within 45s.',
          this.stderr.join('').slice(-500) || 'Try a forced rebuild: node server/build.mjs --force'));
        try { proc.kill(); } catch {}
      }, 45000);
      this.ready = info => {
        if (settled || this.proc !== proc) return;
        settled = true; clearTimeout(bootTimer);
        this.info = info; this.ready = null;
        resolve(info);
      };
    });
  }

  _onLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      // Stray host output (a PowerShell warning, a progress line) is logged
      // rather than dropped, so a protocol break is diagnosable.
      this.onLog('unparseable host line: ' + trimmed.slice(0, 300));
      return;
    }
    if (msg.event === 'ready') {
      if (this.ready) this.ready(msg);
      return;
    }
    // Anything else the host volunteers - an appshot hotkey, say - goes to
    // the server's event handler and never touches the request queue.
    if (msg.event) {
      try { if (this.onEvent) this.onEvent(msg); }
      catch (e) { this.onLog('event handler: ' + (e && e.message ? e.message : e)); }
      return;
    }
    const entry = this.pending.get(msg.id);
    if (!entry) {
      this.onLog('response for unknown id: ' + msg.id);
      return;
    }
    this.pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.ok) {
      entry.resolve({ result: msg.result, ms: msg.ms });
    } else {
      const e = msg.error || {};
      entry.reject(new HostError(e.code || 'host_error', e.message || 'Unknown host error', e.hint));
    }
  }

  _failAll(err) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }

  async call(op, args = {}, { timeoutMs } = {}) {
    await this.start();
    const id = ++this.seq;
    const payload = JSON.stringify({ id, op, args }) + '\n';
    const limit = timeoutMs || this.timeoutMs;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HostError('op_timeout', `Operation '${op}' exceeded ${limit}ms.`,
          'The target app may be busy or showing a modal dialog.'));
      }, limit);

      this.pending.set(id, { resolve, reject, timer });

      try {
        this.proc.stdin.write(payload);
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new HostError('host_write_failed', err.message));
      }
    });
  }

  async stop() {
    if (!this.proc) return;
    const p = this.proc;
    try {
      // Ask the host to leave on its own before forcing it.
      await Promise.race([
        this.call('shutdown', {}, { timeoutMs: 1500 }).catch(() => {}),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
    } catch {}
    // Computer Use never terminates a process it did not spawn. This is its own host.
    try { if (!p.killed) p.kill(); } catch {}
    this.proc = null;
    this.info = null;
  }
}
