/* A stand-in for Chrome or Edge, for the launcher tests in browser.test.mjs.
   launch() runs a launcher that ends in .mjs under Node, so this file can be
   handed to it as the browser. It reads the two flags launch() passes and
   behaves as STUB_MODE says:

   handoff  what Edge 153 does on Windows: start a detached child that owns the
            session, and exit 0 at once. The child serves DevTools on the
            asked port and never writes DevToolsActivePort.
   slow     serve DevTools only after STUB_DELAY ms (a loaded machine).
   never    never serve anything.

   A served stub answers /json/version and /json/list, accepts the DevTools
   WebSocket, and exits on the first message it gets there (Browser.close).
   STUB_PIDFILE, when set, receives the pid of the process that serves. Every
   stub ends itself after two minutes, so a failed test cannot leave one. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const flag = (name) => (process.argv.find((a) => a.startsWith(name + '=')) || '').slice(name.length + 1);
const udd = flag('--user-data-dir');
const port = Number(flag('--remote-debugging-port'));
const mode = process.env.STUB_MODE || 'slow';
setTimeout(() => process.exit(0), 120000).unref();

function serve({ portFile }) {
  if (process.env.STUB_PIDFILE) writeFileSync(process.env.STUB_PIDFILE, String(process.pid));
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/json/version') res.end(JSON.stringify({ Browser: 'stub/1', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/stub` }));
    else if (req.url === '/json/list') res.end('[]');
    else { res.statusCode = 404; res.end('{}'); }
  });
  server.on('upgrade', (req, socket) => {
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    socket.on('data', () => process.exit(0));
    socket.on('error', () => {});
  });
  server.listen(port, '127.0.0.1', () => { if (portFile) writeFileSync(join(udd, 'DevToolsActivePort'), port + '\n/devtools/browser/stub\n'); });
}

if (mode === 'handoff') {
  spawn(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, STUB_MODE: 'child' },
  }).unref();
  process.exit(0);
} else if (mode === 'child') {
  setTimeout(() => serve({ portFile: false }), 300);
} else if (mode === 'slow') {
  setTimeout(() => serve({ portFile: true }), Number(process.env.STUB_DELAY) || 0);
} else {
  setInterval(() => {}, 1000);
}
