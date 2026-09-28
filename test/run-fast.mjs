// npm run test:fast: every test file with the real browser switched off, so
// the browser checks skip and the rest runs in seconds. CI runs this and the
// full suite; the full suite is the one that must not skip anything.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => join(here, f));
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit', env: { ...process.env, UFS_NO_BROWSER: '1' } });
process.exit(r.status ?? 1);
