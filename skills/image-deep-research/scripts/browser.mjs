/* image-deep-research/browser - find, start and drive a headless Chrome,
   Edge or Chromium over the DevTools protocol, with no dependencies.

   Vendored from Ultimate Frontend Skills scripts/inspect.mjs (MIT, Gev,
   github.com/ridelink0/ultimate-frontend-skills): findBrowser, readPortFile,
   the port handshake in launch() and the Session class are the same code,
   trimmed to what a screenshot needs. The fixes they carry are kept, because
   each one was a real failure there: the half-written DevToolsActivePort file,
   Edge 153 no longer writing that file at all, and the launcher that hands the
   browser to a child and exits.

   The browser runs --headless=new, so it never opens a window on anyone's
   screen. Needs Node 22+ for the built-in WebSocket. */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';

const CANDIDATES = process.platform === 'win32'
  ? [
      `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ]
  : process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
       '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
       '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
       '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium'];

/* IDR_BROWSER names the executable. ATELIER_BROWSER is the variable Ultimate
   Frontend Skills reads, honoured too so one setting serves both. */
export function findBrowser() {
  for (const v of ['IDR_BROWSER', 'ATELIER_BROWSER']) {
    const p = process.env[v];
    if (p && existsSync(p)) return p;
  }
  return CANDIDATES.find((p) => p && existsSync(p)) || null;
}

export const NO_BROWSER = 'no Chrome, Edge or Chromium found.\n'
  + '  Windows: Edge is usually already installed; or winget install Google.Chrome\n'
  + '  macOS:   brew install --cask google-chrome\n'
  + '  Linux:   apt-get install chromium\n'
  + 'Or set IDR_BROWSER to the browser executable.';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Chrome creates DevToolsActivePort before it writes the port into it, so the
   file can exist and be empty, half-written, or (on Windows) locked. All of
   those mean "not yet". Returns the port, or null to keep waiting. */
export function readPortFile(path) {
  let first;
  try { first = readFileSync(path, 'utf8').split('\n')[0].trim(); } catch { return null; }
  const port = Number(first);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  });
}

async function answers(port) {
  try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).ok; }
  catch { return false; }
}

/* Starts the browser and resolves once DevTools answers. The returned close()
   asks the browser to quit over the protocol first, waits for it to stop
   answering, and only then falls back to ending the processes that carry this
   run's own temporary profile - never any other browser the user has open. */
export async function launch(bin = findBrowser()) {
  if (!bin) { const e = new Error(NO_BROWSER); e.code = 'no-browser'; throw e; }
  if (typeof WebSocket === 'undefined') throw new Error('image-deep-research needs Node 22 or newer (built-in WebSocket).');
  const udd = mkdtempSync(join(tmpdir(), 'idr-cdp-'));
  const asked = await freePort();
  const proc = spawn(bin, [
    '--headless=new', '--hide-scrollbars', '--mute-audio',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-sync', '--disable-features=Translate',
    `--user-data-dir=${udd}`, `--remote-debugging-port=${asked}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
  let launchError;
  proc.once('error', (err) => { launchError = err; });

  const portFile = join(udd, 'DevToolsActivePort');
  // 45 s, not 15: the first start of Chrome on a fresh Windows machine (a CI
  // runner, measured 2026-09-25) took longer than 15 s to open its port, while
  // every later start in the same run took about one.
  const deadline = Date.now() + 45000;
  for (let i = 0; Date.now() < deadline; i++) {
    if (launchError || (proc.exitCode !== null && proc.exitCode !== 0)) break;
    const port = readPortFile(portFile) || (i % 3 === 2 && await answers(asked) ? asked : null);
    if (port) return { port, udd, close: () => shutdown(proc, udd, port) };
    await sleep(100);
  }
  await shutdown(proc, udd, asked);
  throw new Error(launchError ? 'browser launch failed: ' + launchError.message : 'browser did not expose a debugging port');
}

async function shutdown(proc, udd, port) {
  try {
    const v = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) })).json();
    await new Promise((res) => {
      const ws = new WebSocket(v.webSocketDebuggerUrl);
      const done = () => { try { ws.close(); } catch {} res(); };
      ws.addEventListener('open', () => { try { ws.send(JSON.stringify({ id: 1, method: 'Browser.close' })); } catch {} setTimeout(done, 300); });
      ws.addEventListener('error', done);
      setTimeout(done, 2000);
    });
  } catch {}
  for (let i = 0; i < 30 && await answers(port); i++) await sleep(100);
  if (proc.exitCode === null) { try { proc.kill(); } catch {} }
  // Helper processes (the crash handler, a utility process) can outlive the
  // browser and hold the profile folder open for seconds. Wait for them first;
  // only if the folder is still locked, end the processes started with this
  // run's own temporary profile on their command line, and no other.
  if (await removeProfile(udd, 3000) || process.platform !== 'win32') return;
  endProfileProcesses(udd);
  await removeProfile(udd, 5000);
}

async function removeProfile(udd, ms) {
  const until = Date.now() + ms;
  for (;;) {
    try { rmSync(udd, { recursive: true, force: true }); } catch {}
    if (!existsSync(udd)) return true;
    if (Date.now() > until) return false;
    await sleep(250);
  }
}

function endProfileProcesses(udd) {
  const q = udd.replace(/'/g, "''");
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${q}') } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }`],
  { stdio: 'ignore', windowsHide: true, timeout: 15000 });
}

export class Session {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.events = []; }
  static async open(port) {
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      } catch {}
      if (!target) await sleep(100);
    }
    if (!target) throw new Error('no page target');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('cdp socket failed')), { once: true });
    });
    const s = new Session(ws);
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && s.waiting.has(msg.id)) {
        const { res, rej, timer } = s.waiting.get(msg.id);
        clearTimeout(timer);
        s.waiting.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method) { s.events.push(msg); if (s.events.length > 2000) s.events.shift(); }
    });
    ws.addEventListener('close', () => s.failPending(new Error('CDP connection closed')));
    return s;
  }
  failPending(error) {
    for (const { rej, timer } of this.waiting.values()) { clearTimeout(timer); rej(error); }
    this.waiting.clear();
  }
  send(method, params = {}, ms = 45000) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        if (this.waiting.has(id)) { this.waiting.delete(id); rej(new Error(method + ' timed out')); }
      }, ms);
      this.waiting.set(id, { res, rej, timer });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (err) { clearTimeout(timer); this.waiting.delete(id); rej(err); }
    });
  }
  async waitForEvent(method, ms = 25000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const i = this.events.findIndex((e) => e.method === method);
      if (i !== -1) return this.events.splice(i, 1)[0];
      await sleep(50);
    }
    return null;
  }
  async evaluate(expression, { awaitPromise = false } = {}) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error('page script failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result?.value;
  }
  close() { this.failPending(new Error('CDP session closed')); try { this.ws.close(); } catch {} }
}

/* One browser for a whole run: starts it, hands fn a page session, and
   always shuts the browser down afterwards, even when fn throws. */
export async function withBrowser(fn) {
  const b = await launch();
  let session;
  try {
    session = await Session.open(b.port);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    return await fn(session);
  } finally {
    if (session) session.close();
    await b.close();
  }
}

/* Loads a URL (or a data: / file: page) at a viewport and waits for it to
   settle: the load event, web fonts, then a fixed pause for entrance motion. */
export async function load(session, url, { width = 1440, height = 900, wait = 3000, timeout = 30000 } = {}) {
  await session.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 });
  session.events.length = 0;
  const nav = await session.send('Page.navigate', { url });
  if (nav.errorText) throw new Error('navigation failed: ' + nav.errorText);
  const loaded = await session.waitForEvent('Page.loadEventFired', timeout);
  await session.evaluate('document.fonts ? document.fonts.ready.then(() => 1) : 1', { awaitPromise: true }).catch(() => {});
  await sleep(wait);
  return { loaded: !!loaded };
}

export async function screenshot(session, { format = 'png', quality, clip } = {}) {
  const params = { format, captureBeyondViewport: !!clip };
  if (format === 'jpeg') params.quality = quality ?? 82;
  if (clip) params.clip = { ...clip, scale: 1 };
  const r = await session.send('Page.captureScreenshot', params);
  return Buffer.from(r.data, 'base64');
}
