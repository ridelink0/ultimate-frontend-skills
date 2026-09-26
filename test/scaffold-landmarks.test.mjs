import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { findBrowser, launch, closeBrowser, Session } from '../scripts/inspect.mjs';
import { startServer } from '../scripts/preview-server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const PRESETS = ['fable', 'bone', 'ink', 'cinema'];

function scaffold(dir, ...args) {
  const made = spawnSync(process.execPath, [join(root, 'scripts', 'webdesign.mjs'), 'new', dir, '--name', 'Landmark Test', ...args], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  return {
    index: readFileSync(join(dir, 'index.html'), 'utf8'),
    notFound: readFileSync(join(dir, '404.html'), 'utf8'),
  };
}

// The skip link has to come before the main landmark it jumps to, and the
// primary nav has to sit outside it too: a skip link inside the element it
// targets skips nothing, and a nav and footer inside <main> leave a screen
// reader with no navigation or contentinfo landmark outside the content.
function assertLandmarks(html, label, skipHref) {
  const count = (re) => (html.match(re) || []).length;
  assert.equal(count(/<main\b/g), 1, label + ': one <main>');
  const skip = html.indexOf(`<a class="sr-skip" href="${skipHref}">`);
  const nav = html.indexOf('<nav class="nav"');
  const navEnd = html.indexOf('</nav>', nav);
  const main = html.indexOf('<main id="main">');
  const mainEnd = html.indexOf('</main>');
  const footer = html.indexOf('<footer');
  assert.ok(skip > -1, label + ': skip link with href="' + skipHref + '"');
  assert.ok(nav > -1 && main > -1 && footer > -1, label + ': nav, main and footer are all present');
  assert.ok(skip < nav, label + ': the skip link comes before the nav');
  assert.ok(navEnd > -1 && navEnd < main, label + ': the primary nav ends before <main id="main">');
  assert.ok(mainEnd < footer, label + ': the footer follows </main>');
  assert.equal(count(/<footer\b/g), 1, label + ': one footer');
}

test('scaffolder: skip link and nav precede <main id="main">, the footer follows it, in every preset', () => {
  const temp = mkdtempSync(join(tmpdir(), 'ufs-landmarks-'));
  try {
    for (const preset of PRESETS) {
      const { index, notFound } = scaffold(join(temp, preset), '--preset=' + preset);
      assertLandmarks(index, preset + ' index.html', '#main');
      // The 404 is its own document: its skip link jumps to its own main,
      // not to the home page's.
      assertLandmarks(notFound, preset + ' 404.html', '#main');
      assert.ok(!notFound.includes('./#main'), preset + ' 404.html: no skip link to the home page');
      // Every other in-page link on the 404 still points back at the index.
      assert.ok(notFound.includes('href="./#top"'), preset + ' 404.html: the brand link still goes home');
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('scaffolder: the landmark order holds when --sections lists the nav late and the footer early', () => {
  const temp = mkdtempSync(join(tmpdir(), 'ufs-landmarks-order-'));
  try {
    const { index } = scaffold(join(temp, 'site'), '--sections', 'hero-photo,footer,index,nav,faq');
    assertLandmarks(index, 'reordered index.html', '#main');
    // The contents list is a <nav> too, and it is content: it stays inside main.
    const contents = index.indexOf('aria-label="Contents"');
    assert.ok(contents > index.indexOf('<main id="main">') && contents < index.indexOf('</main>'), 'the contents nav stays inside <main>');
    // Nothing the user asked for was dropped on the way.
    for (const marker of ['class="hero"', 'aria-label="Contents"', '<details', 'class="sr-skip"', '<footer'])
      assert.ok(index.includes(marker), 'kept: ' + marker);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

const TAB = { windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, key: 'Tab', code: 'Tab' };
const ENTER = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };

// What a keyboard user actually gets: Tab to "Skip to content", Enter, Tab.
// The second Tab has to land on the first focusable thing after the nav, on
// the same page the key was pressed on.
test('scaffolded pages in a real browser: Skip to content moves the next Tab past the nav, on the index and on the 404', { skip: !findBrowser(), timeout: 120000 }, async () => {
  const temp = mkdtempSync(join(tmpdir(), 'ufs-skip-'));
  let server, browser, s;
  try {
    const dir = join(temp, 'site');
    scaffold(dir, '--preset=bone');
    server = startServer(dir, 0);
    await once(server, 'listening');
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await launch(findBrowser());
    s = await Session.open(browser.port);
    const ev = async (expression) => {
      const r = await s.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
      return r.result.value;
    };
    const press = async (key, down = 'rawKeyDown', extra = {}) => {
      await s.send('Input.dispatchKeyEvent', { type: down, ...key, ...extra });
      await s.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
    };
    await s.send('Page.enable');
    // A headless page is not the focused window; without this Tab goes nowhere.
    await s.send('Emulation.setFocusEmulationEnabled', { enabled: true });

    for (const path of ['/', '/404.html']) {
      await s.send('Page.navigate', { url: origin + path });
      assert.ok(await s.waitForEvent('Page.loadEventFired', 30000), path + ': the page loaded');
      await ev('document.activeElement && document.activeElement.blur(), 1');
      await press(TAB);
      assert.equal(await ev('document.activeElement.className'), 'sr-skip', path + ': the first Tab reaches the skip link');
      await press(ENTER, 'keyDown', { text: '\r' });
      let hash = '';
      for (let i = 0; i < 40 && hash !== '#main'; i++) {
        await new Promise((r) => setTimeout(r, 50));
        hash = await ev('location.hash');
      }
      assert.equal(await ev('location.pathname'), path, path + ': Enter on the skip link stayed on this page');
      assert.equal(hash, '#main', path + ': Enter on the skip link went to #main');
      await press(TAB);
      const got = JSON.parse(await ev(`(() => {
        const nav = document.querySelector('nav.nav');
        const sel = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"])';
        const first = [...document.querySelectorAll(sel)].find((el) =>
          (nav.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) && !nav.contains(el) && el.checkVisibility());
        const at = document.activeElement;
        const say = (el) => el ? el.outerHTML.slice(0, 90) : String(el);
        return JSON.stringify({ same: !!first && at === first, inMain: !!at.closest('main'), got: say(at), want: say(first) });
      })()`));
      assert.ok(got.same, path + ': after Skip to content, Tab focused ' + got.got + ' instead of ' + got.want);
      assert.ok(got.inMain, path + ': the focused element is inside <main>');
    }

    // The landmarks a screen reader lists, read from the browser's own
    // accessibility tree rather than from the markup.
    await s.send('Page.navigate', { url: origin + '/' });
    await s.waitForEvent('Page.loadEventFired', 30000);
    await s.send('Accessibility.enable');
    const { nodes } = await s.send('Accessibility.getFullAXTree');
    const roles = nodes.filter((n) => !n.ignored).map((n) => n.role && n.role.value);
    for (const role of ['main', 'navigation', 'contentinfo'])
      assert.ok(roles.includes(role), 'the accessibility tree has a ' + role + ' landmark (roles seen: ' + [...new Set(roles)].filter((r) => r && r !== 'generic' && r !== 'StaticText' && r !== 'InlineTextBox').join(', ') + ')');
  } finally {
    s?.close();
    // Never assert in a finally: it would mask the failure that got us here.
    await closeBrowser(browser);
    if (server) await new Promise((r) => server.close(r));
    rmSync(temp, { recursive: true, force: true });
  }
});
