// Tests the local compile step: cold build, idempotence, content addressing,
// concurrent builds, and cleanup of superseded binaries.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This suite deletes the bin directory. A live Claude Code session runs its
// host from the shared one, so the test builds into a directory of its own.
const PRIVATE = path.join(os.tmpdir(), `cu-build-test-${process.pid}`);
process.env.CU_PLUGIN_DATA = PRIVATE;
const { ensureHost, binDir } = await import('../server/build.mjs');
process.on('exit', () => { try { fs.rmSync(PRIVATE, { recursive: true, force: true }); } catch {} });

let pass = 0, fail = 0; const failures = [];
const check = (n, c, d) => {
  if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; failures.push(n); console.log(`  FAIL ${n}${d ? ' :: ' + d : ''}`); }
};
const exes = () => { try { return fs.readdirSync(binDir()).filter((f) => f.endsWith('.exe')); } catch { return []; } };

console.log('\n-- cold build --');
try { fs.rmSync(binDir(), { recursive: true, force: true }); } catch {}
const first = ensureHost({ log: () => {} });
check('builds from nothing', first.rebuilt === true);
check('produces an executable', fs.existsSync(first.exe));
check('binary is content-addressed', /AxonHost-[0-9a-f]{16}\.exe$/.test(first.exe), path.basename(first.exe));

console.log('\n-- idempotence --');
const second = ensureHost({ log: () => {} });
check('second call does not rebuild', second.rebuilt === false);
check('second call returns the same binary', second.exe === first.exe);
check('exactly one binary on disk', exes().length === 1, exes().join(','));

console.log('\n-- concurrent builds --');
try { fs.rmSync(binDir(), { recursive: true, force: true }); } catch {}
const runs = await Promise.all([1, 2, 3, 4].map(() =>
  new Promise((r) => setImmediate(() => r(ensureHost({ log: () => {} }))))));
check('all parallel builds succeed', runs.every((r) => fs.existsSync(r.exe)));
check('all agree on one binary', new Set(runs.map((r) => r.exe)).size === 1);
check('no stray temp files left', !exes().some((f) => f.startsWith('.build-')), exes().join(','));
check('only one binary survives', exes().length === 1, exes().join(','));

console.log('\n-- forced rebuild --');
const forced = ensureHost({ force: true, log: () => {} });
check('force rebuilds', forced.rebuilt === true);
check('force keeps the same content address', forced.exe === first.exe);
check('old binaries are pruned', exes().length === 1, exes().join(','));

console.log('\n-- manifest and marketplace agree --');
{
  // 0.8.2 shipped with the marketplace entry still saying 0.8.1, and 0.9.0
  // with it saying 0.8.2; plugin.json wins at install time and the entry is
  // silently ignored, so the drift shows nowhere but here.
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  const market = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
  const entry = (market.plugins || []).find((p) => p.name === manifest.name);
  check('marketplace lists the plugin', !!entry);
  check('marketplace entry version matches plugin.json', !!entry && entry.version === manifest.version, `${entry && entry.version} vs ${manifest.version}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('failures: ' + failures.join(', ')); process.exit(1); }
