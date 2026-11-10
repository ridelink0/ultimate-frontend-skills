import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const source = readFileSync(new URL('../server/driver.mjs', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/export class /g, 'class ') + '\nthis.Driver = Driver;';
function setup(ensureHost) {
  const children = [];
  const sandbox = { ensureHost, process, setTimeout, clearTimeout,
    createInterface: ({ input }) => input,
    spawn: () => {
      const p = new EventEmitter();
      p.stdin = new PassThrough(); p.stdout = new EventEmitter(); p.stderr = new PassThrough();
      p.kill = () => { p.killed = true; p.emit('exit', 0, null); };
      children.push(p); return p;
    } };
  vm.runInNewContext(source, sandbox);
  return { driver: new sandbox.Driver(), children };
}
test('sync build failure retries rather than retaining a rejected startup promise', async () => {
  let builds = 0;
  const { driver } = setup(() => { builds++; throw new Error('build failure'); });
  await assert.rejects(driver.start(), /build failure/);
  await assert.rejects(driver.start(), /build failure/);
  assert.equal(builds, 2); assert.equal(driver.starting, null);
});
test('concurrent callers share startup and both wait for readiness', async () => {
  const { driver, children } = setup(() => ({ exe: 'fixture' }));
  let resolved = false;
  const a = driver.start(), b = driver.start().then(x => { resolved = true; return x; });
  await new Promise(setImmediate);
  assert.equal(children.length, 1); assert.equal(resolved, false);
  children[0].stdout.emit('line', '{"event":"ready","version":1}');
  assert.equal((await a).version, 1); assert.equal((await b).version, 1);
  children[0].kill();
});
test('exit before readiness rejects promptly and a fresh host can start', async () => {
  const { driver, children } = setup(() => ({ exe: 'fixture' }));
  const a = driver.start();
  await new Promise(setImmediate); children[0].emit('exit', 1, null);
  await assert.rejects(a, /exited/);
  const b = driver.start();
  await new Promise(setImmediate);
  children[0].emit('exit', 1, null); // stale child must not clear its replacement
  children[1].stdout.emit('line', '{"event":"ready"}');
  await b; assert.equal(driver.proc, children[1]); children[1].kill();
});
