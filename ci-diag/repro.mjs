// Repro for the Windows CI flat-fill reading: launch the same browser the suite
// uses with different GPU flag sets, load the GAME fixture's WebGL part, and read
// the canvas two ways: drawImage into a 2D canvas (what canvasProbe does) and
// gl.readPixels on the page's own context.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const UFS = process.env.UFS_INSPECT || 'C:/Users/OWNER/cinematic-web-design/scripts/inspect.mjs';
const { findBrowser, Session, CANVAS_INIT } = await import(pathToFileURL(resolve(UFS)).href);

const HTML = `<!doctype html><html><body style="margin:0;background:#0b0f18">
<canvas id="gl" style="position:fixed;inset:0;width:100vw;height:100vh;display:block"></canvas>
<script>
  const c = document.getElementById('gl');
  const gl = c.getContext('webgl');
  window.__glnull = !gl; window.__lost = 0; c.addEventListener('webglcontextlost', () => { window.__lost++; });
  if (gl) {
  c.width = innerWidth; c.height = innerHeight;
  gl.viewport(0, 0, c.width, c.height);
  gl.enable(gl.SCISSOR_TEST);
  gl.clearColor(0.05, 0.07, 0.12, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.scissor(0, 0, c.width >> 1, c.height >> 1); gl.clearColor(0.9, 0.3, 0.2, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  }
</script></body></html>`;

const PROBE = `(() => {
  const c = document.getElementById('gl');
  const out = { glnull: window.__glnull, ctx: c.__inspectContext || null, w: c.width, h: c.height };
  const gl = c.getContext('webgl');
  if (gl) {
    out.attrs = gl.getContextAttributes();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    out.renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const px = new Uint8Array(4);
    gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); out.rpLowLeft = [...px];
    gl.readPixels(c.width - 2, c.height - 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); out.rpTopRight = [...px];
    out.glError = gl.getError(); out.isLost = gl.isContextLost(); out.lostEvents = window.__lost;
  }
  const n = 16, copy = document.createElement('canvas'); copy.width = copy.height = n;
  const ctx = copy.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(c, 0, 0, n, n);
  const d = ctx.getImageData(0, 0, n, n).data;
  out.diLowLeft = [...d.slice((n - 1) * n * 4, (n - 1) * n * 4 + 4)];
  out.diTopRight = [...d.slice((n - 1) * 4, n * 4)];
  return out;
})()`;

const server = createServer((q, s) => { s.setHeader('content-type', 'text/html'); s.end(HTML); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = 'http://127.0.0.1:' + server.address().port + '/';
const bin = process.env.BIN || findBrowser();
const sets = JSON.parse(process.env.SETS || JSON.stringify([
  [], ['--disable-gpu'], ['--use-angle=swiftshader'], ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  ['--disable-gpu', '--enable-unsafe-swiftshader'], ['--use-angle=d3d11-warp'], ['--disable-gpu', '--disable-software-rasterizer'],
]));
console.log('browser', bin);
for (const extra of sets) {
  const udd = mkdtempSync(join(tmpdir(), 'ufs-repro-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(bin, ['--headless=new', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', `--user-data-dir=${udd}`, `--remote-debugging-port=${port}`, ...extra, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  let ok = false;
  for (let i = 0; i < 100 && !ok; i++) {
    try { ok = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
    if (!ok) await new Promise((r) => setTimeout(r, 100));
  }
  let result;
  try {
    const session = await Session.open(port);
    await session.send('Page.enable');
    await session.send('Page.addScriptToEvaluateOnNewDocument', { source: CANVAS_INIT });
    await session.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 1000, deviceScaleFactor: 1, mobile: false });
    await session.send('Page.navigate', { url });
    await session.waitForEvent('Page.loadEventFired');
    await new Promise((r) => setTimeout(r, 300));
    const r = await session.send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
    result = { at300: r.result?.value || r.exceptionDetails };
    await new Promise((res) => setTimeout(res, 2000));
    const r2 = await session.send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
    result.at2300 = r2.result?.value || r2.exceptionDetails;
    try {
      const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      const info = await new Promise((res, rej) => {
        const ws = new WebSocket(v.webSocketDebuggerUrl);
        ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 1, method: 'SystemInfo.getInfo' })));
        ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id === 1) { ws.close(); d.error ? rej(new Error(d.error.message)) : res(d.result); } });
        ws.addEventListener('error', () => rej(new Error('ws error')));
        setTimeout(() => rej(new Error('timeout')), 5000);
      });
      result.gpu = { devices: info.gpu?.devices?.map((d) => d.deviceString + ' / ' + d.driverVendor + ' ' + d.driverVersion), featureStatus: info.gpu?.featureStatus && { webgl: info.gpu.featureStatus.webgl, gpu_compositing: info.gpu.featureStatus.gpu_compositing, rasterization: info.gpu.featureStatus.rasterization } };
    } catch (err) { result.gpu = 'SystemInfo failed: ' + err.message; }
    try { await session.send('Browser.close'); } catch {}
    session.close();
  } catch (err) { result = 'error: ' + err.message; }
  console.log(JSON.stringify(extra), JSON.stringify(result));
  await new Promise((r) => setTimeout(r, 800));
  try { rmSync(udd, { recursive: true, force: true }); } catch {}
}
server.close();
