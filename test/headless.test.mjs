// The render check has to start in a cloud container: no system Chrome, only
// Playwright's Chromium, and everything running as root. None of these need a
// browser; the filesystem, the platform and the user id are all injected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { findBrowser, browserCandidates, playwrightChromes, launchFlags, LAUNCH_FLAGS, userHome } from '../scripts/inspect.mjs';
import { browserSkip } from './need-browser.mjs';

/* A fake filesystem: a map of directory -> entries, and a set of files. */
function fakeFs(dirs, files) {
  return {
    readdirSync(p) { if (!(p in dirs)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return dirs[p]; },
    existsSync(p) { return files.has(p) || p in dirs; },
  };
}
const HOME = '/root';
const PW = '/opt/pw-browsers';
// What this container has (2026-09-29): a bare `chromium` symlink, the
// headless shell and ffmpeg beside the one full Chromium.
const containerFs = () => fakeFs(
  { [PW]: ['.links', 'chromium', 'chromium-1194', 'chromium_headless_shell-1194', 'ffmpeg-1011'] },
  new Set([PW + '/chromium-1194/chrome-linux/chrome', PW + '/chromium_headless_shell-1194/chrome-linux/headless_shell']),
);

test('on Linux, Playwright\'s Chromium is found when no system browser is installed', () => {
  const found = findBrowser({ env: {}, platform: 'linux', home: HOME, fs: containerFs() });
  assert.equal(found, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome');
});

test('the newest revision wins, and the roots are read in order: PLAYWRIGHT_BROWSERS_PATH, ~/.cache/ms-playwright, /opt/pw-browsers', () => {
  const bin = (root, rev) => `${root}/chromium-${rev}/chrome-linux/chrome`;
  const custom = '/srv/pw', cache = HOME + '/.cache/ms-playwright';
  const fs = fakeFs(
    { [custom]: ['chromium-1100', 'chromium-1200', 'chromium-999'], [cache]: ['chromium-1300'], [PW]: ['chromium-1194', 'chromium-1181'] },
    new Set([bin(custom, 1100), bin(custom, 1200), bin(custom, 999), bin(cache, 1300), bin(PW, 1194), bin(PW, 1181)]),
  );
  // Numeric, not by name: 999 sorts after 1200 as a string.
  assert.deepEqual(playwrightChromes({ env: { PLAYWRIGHT_BROWSERS_PATH: custom }, home: HOME, fs }),
    [bin(custom, 1200), bin(custom, 1100), bin(custom, 999), bin(cache, 1300), bin(PW, 1194), bin(PW, 1181)]);
  assert.equal(findBrowser({ env: { PLAYWRIGHT_BROWSERS_PATH: custom }, platform: 'linux', home: HOME, fs }), bin(custom, 1200));
  assert.equal(findBrowser({ env: {}, platform: 'linux', home: HOME, fs }), bin(cache, 1300));
  // A revision folder with no chrome in it is passed over.
  const partial = fakeFs({ [PW]: ['chromium-1200', 'chromium-1194'] }, new Set([bin(PW, 1194)]));
  assert.equal(findBrowser({ env: {}, platform: 'linux', home: HOME, fs: partial }), bin(PW, 1194));
});

test('ATELIER_BROWSER and a system browser still come first, and UFS_NO_BROWSER still switches it all off', () => {
  const fs = containerFs();
  const withSystem = fakeFs({ [PW]: ['chromium-1194'] }, new Set(['/usr/bin/chromium', PW + '/chromium-1194/chrome-linux/chrome', '/x/chrome']));
  assert.equal(findBrowser({ env: {}, platform: 'linux', home: HOME, fs: withSystem }), '/usr/bin/chromium');
  assert.equal(findBrowser({ env: { ATELIER_BROWSER: '/x/chrome' }, platform: 'linux', home: HOME, fs: withSystem }), '/x/chrome');
  assert.equal(findBrowser({ env: { UFS_NO_BROWSER: '1' }, platform: 'linux', home: HOME, fs }), null);
});

test('the Playwright search is Linux only, and the Windows and macOS lists are unchanged', () => {
  const fs = containerFs();
  assert.equal(findBrowser({ env: {}, platform: 'darwin', home: HOME, fs }), null);
  assert.equal(findBrowser({ env: {}, platform: 'win32', home: HOME, fs }), null);
  const env = { PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' };
  assert.deepEqual(browserCandidates('win32', env), [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ]);
  assert.deepEqual(browserCandidates('darwin', env), [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ]);
  assert.deepEqual(browserCandidates('linux', env), [
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium',
  ]);
});

test('a user with no home directory still gets a browser, instead of a crash', () => {
  // os.homedir() throws when HOME is unset and the uid has no passwd entry.
  const noHome = () => { throw Object.assign(new Error('uv_os_homedir returned ENOENT'), { code: 'ERR_SYSTEM_ERROR' }); };
  assert.equal(userHome(noHome), null);
  assert.equal(findBrowser({ env: {}, platform: 'linux', home: null, fs: containerFs() }), '/opt/pw-browsers/chromium-1194/chrome-linux/chrome');
});

// The same, for real: HOME unset and a uid that has no passwd entry. Only root
// can switch to one, so elsewhere this says so and skips; the test above
// covers the logic everywhere.
const asNobody = process.platform !== 'win32' && process.getuid?.() === 0 ? false : 'needs root on Linux or macOS to switch to a uid with no home';
test('findBrowser() with HOME unset and a uid with no passwd entry returns ATELIER_BROWSER', { skip: asNobody }, () => {
  const url = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'inspect.mjs')).href;
  // Import first, then drop to the uid, so the repository need not be readable by it.
  const code = `import(${JSON.stringify(url)}).then((m) => { process.setuid(2147480001); console.log(JSON.stringify(m.findBrowser())); })`;
  const env = { ...process.env, ATELIER_BROWSER: process.execPath };
  delete env.HOME; delete env.UFS_NO_BROWSER;
  const run = spawnSync(process.execPath, ['-e', code], { env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout), process.execPath);
});

test('root gets --no-sandbox, an ordinary user does not, and UFS_NO_SANDBOX=1 asks for it', () => {
  assert.ok(launchFlags({ uid: 0, env: {} }).includes('--no-sandbox'));
  assert.ok(!launchFlags({ uid: 1000, env: {} }).includes('--no-sandbox'));
  assert.ok(launchFlags({ uid: 1000, env: { UFS_NO_SANDBOX: '1' } }).includes('--no-sandbox'));
  // Windows has no getuid: no uid, no flag.
  assert.ok(!launchFlags({ uid: undefined, env: {} }).includes('--no-sandbox'));
  assert.ok(!LAUNCH_FLAGS.includes('--no-sandbox'), 'the shared list stays sandboxed; only launchFlags adds it');
  for (const f of LAUNCH_FLAGS) assert.ok(launchFlags({ uid: 0, env: {} }).includes(f), f);
});

test('a browser test skips with a reason locally, and fails when the run says it needs the browser', () => {
  const none = () => null, some = () => '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  assert.equal(browserSkip({}, some), false);
  assert.match(browserSkip({}, none), /no Chrome, Edge or Chromium found/);
  assert.match(browserSkip({ CI: 'false' }, none), /no Chrome/);
  assert.throws(() => browserSkip({ UFS_REQUIRE_BROWSER: '1' }, none), /UFS_REQUIRE_BROWSER=1/);
  assert.throws(() => browserSkip({ CI: 'true' }, none), /CI says/);
  // npm run test:fast switches the browser off on purpose, and CI runs it.
  assert.match(browserSkip({ CI: 'true', UFS_NO_BROWSER: '1' }, some), /switched off/);
});

test('every browser test goes through browserSkip, not a bare !findBrowser()', () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.test.mjs'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    assert.doesNotMatch(src, /skip:\s*!\(?[^,}]*findBrowser\(\)|skip\s*=\s*!findBrowser\(\)/, f + ' guards a browser test with !findBrowser(), which skips silently in CI');
  }
});
