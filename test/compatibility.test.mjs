import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
test('merged library retains all Atelier section IDs and both CLI entry points work', () => {
  const fixture = JSON.parse(readFileSync(new URL('./atelier-compat.json', import.meta.url)));
  const library = readFileSync(new URL('../skills/ultimate-frontend-skills/assets/sections.html', import.meta.url), 'utf8');
  for (const id of fixture.sections) assert.ok(library.includes('@section ' + id + ' '), id);
  const temp = mkdtempSync(join(tmpdir(), 'design-compat-'));
  try {
    for (const cli of ['atelier', 'webdesign']) for (const preset of fixture.presets) {
      const dir = join(temp, cli + '-' + preset);
      const made = spawnSync(process.execPath, [join(root, 'scripts', cli + '.mjs'), 'new', '--name', 'Compatibility', dir, '--preset=' + preset], { encoding: 'utf8' });
      assert.equal(made.status, 0, made.stderr);
      assert.ok(readFileSync(join(dir, 'index.html'), 'utf8').includes('Compatibility'));
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
