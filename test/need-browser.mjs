// The one guard every real-browser test uses: { skip: browserSkip() }.
//
// It used to be { skip: !findBrowser() } in every file, and a machine with no
// browser it could find then reported the whole browser half of the suite as
// skipped and exited 0. That is how a cloud container that had a Chromium
// (Playwright's, at /opt/pw-browsers) and could not use it went unnoticed: 64
// tests skipped and nothing failed (2026-09-29).
//
// So: with a browser, nothing is skipped. Without one, a local run gets a skip
// that says why; a run that has said it needs the browser (UFS_REQUIRE_BROWSER=1,
// or CI set, as every CI service sets it) fails at load instead. UFS_NO_BROWSER=1
// is the explicit switch-off (npm run test:fast, which CI also runs) and wins.
import { findBrowser } from '../scripts/inspect.mjs';

const truthy = (v) => v !== undefined && v !== '' && v !== '0' && v.toLowerCase() !== 'false';

export function browserSkip(env = process.env, find = findBrowser) {
  if (env.UFS_NO_BROWSER === '1') return 'UFS_NO_BROWSER=1: the browser is switched off';
  if (find()) return false;
  const reason = 'no Chrome, Edge or Chromium found (set ATELIER_BROWSER to the executable)';
  if (env.UFS_REQUIRE_BROWSER === '1' || truthy(env.CI)) {
    throw new Error(reason + ', and ' + (env.UFS_REQUIRE_BROWSER === '1' ? 'UFS_REQUIRE_BROWSER=1' : 'CI') + ' says the browser tests must run');
  }
  return reason;
}
