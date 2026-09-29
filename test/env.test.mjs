// The env class: failures that belong to the machine running the check, not
// to the page. In the cloud container a third-party request fails TLS at the
// proxy (net::ERR_CERT_AUTHORITY_INVALID for fonts.gstatic.com, measured
// 2026-09-29) and the browser's own /favicon.ico request 404s on any page
// that declares no icon. Those are reported under their own heading and in
// env[], and never counted. The page's own failures stay errors.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:https';
import { fileURLToPath } from 'node:url';
import { inspect, formatReport, envReason, envHosts, envList } from '../scripts/inspect.mjs';
import { runVerify, formatVerify, renderFindings } from '../scripts/verify.mjs';
import { startServer } from '../scripts/preview-server.mjs';
import { browserSkip } from './need-browser.mjs';
import { selfSigned } from './self-signed.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ORIGIN = 'http://127.0.0.1:4400';

test('env is a TLS or proxy failure to another origin, an undeclared favicon, or a UFS_ENV_HOSTS host, and never the page\'s own origin', () => {
  const hosts = envHosts('fonts.googleapis.com, https://cdn.example.com:8443/x  bad host');
  assert.deepEqual([...hosts].sort(), ['bad', 'cdn.example.com', 'fonts.googleapis.com', 'host'].sort());
  const opts = { origin: ORIGIN, declaresIcon: false, hosts };
  for (const error of ['net::ERR_CERT_AUTHORITY_INVALID', 'net::ERR_CERT_COMMON_NAME_INVALID', 'net::ERR_TUNNEL_CONNECTION_FAILED', 'net::ERR_PROXY_CONNECTION_FAILED']) {
    assert.match(envReason({ url: 'https://fonts.gstatic.com/a.woff2', error }, opts) || '', /another origin/, error);
    // The page's own asset failing the same way is still the page's problem.
    assert.equal(envReason({ url: ORIGIN + '/a.woff2', error }, opts), null, 'same origin: ' + error);
  }
  // Other network failures to another origin are not env.
  assert.equal(envReason({ url: 'https://cdn.jsdelivr.net/x.js', error: 'net::ERR_NAME_NOT_RESOLVED' }, opts), null);
  assert.equal(envReason({ url: 'https://cdn.jsdelivr.net/x.js', error: 'HTTP 404 https://cdn.jsdelivr.net/x.js', status: 404 }, opts), null);
  // UFS_ENV_HOSTS: any failure to a listed host, but not when it is the page's own.
  assert.match(envReason({ url: 'https://cdn.example.com/x.js', error: 'HTTP 500 https://cdn.example.com/x.js', status: 500 }, opts), /UFS_ENV_HOSTS/);
  assert.equal(envReason({ url: ORIGIN + '/x.js', error: 'HTTP 404', status: 404 }, { ...opts, hosts: envHosts('127.0.0.1') }), null);
  // The favicon the browser asked for on its own, and only that.
  assert.match(envReason({ url: ORIGIN + '/favicon.ico', error: 'HTTP 404', status: 404 }, opts), /declares no icon/);
  assert.equal(envReason({ url: ORIGIN + '/favicon.ico', error: 'HTTP 404', status: 404 }, { ...opts, declaresIcon: true }), null);
  assert.equal(envReason({ url: ORIGIN + '/img/favicon.ico', error: 'HTTP 404', status: 404 }, opts), null);
  assert.equal(envReason({ url: ORIGIN + '/img/hero.jpg', error: 'HTTP 404', status: 404 }, opts), null);
  // No origin to compare against: nothing is env.
  assert.equal(envReason({ url: 'https://fonts.gstatic.com/a.woff2', error: 'net::ERR_CERT_AUTHORITY_INVALID' }, { ...opts, origin: null }), null);
  assert.equal(envHosts('').size, 0);
});

test('env findings print under their own heading, and are in neither count', () => {
  const base = { width: 800, scroll: 0, stats: { textElements: 3, scrollHeight: 900 }, overlaps: [], offscreen: [], overflow: [], collapsed: [], contrast: [], tiny: [], console: [] };
  const tls = { error: 'net::ERR_CERT_AUTHORITY_INVALID', type: 'Image', blockedReason: null, url: 'https://fonts.gstatic.com/x.png', reason: 'TLS or proxy failure to another origin' };
  const hero = { error: 'HTTP 404 ' + ORIGIN + '/img/hero.jpg', type: 'Image', blockedReason: null, url: ORIGIN + '/img/hero.jpg' };
  const r = { ...base, network: [hero], env: [tls], broken: ['https://fonts.gstatic.com/x.png', 'img/hero.jpg'] };
  const shown = formatReport([r]);
  // One error: the hero. The third-party image is env, and not also a broken image.
  assert.equal(shown.errors, 1, shown.text);
  assert.match(shown.text, /ERROR network: HTTP 404 .*img\/hero\.jpg/);
  assert.doesNotMatch(shown.text, /ERROR[^\n]*fonts\.gstatic\.com/);
  assert.match(shown.text, /\n {2}1 env - the machine or its network, not the page[^\n]*\n {2}env {3}net::ERR_CERT_AUTHORITY_INVALID https:\/\/fonts\.gstatic\.com\/x\.png \(Image\)/);
  assert.deepEqual(shown.env.map((e) => e.url), [tls.url]);
  // Twice at two widths is one env line.
  assert.equal(envList([r, { ...r, width: 390 }]).length, 1);
  // verify's reading of the report never turns an env line into a finding.
  const findings = renderFindings([r]);
  assert.equal(findings.filter((f) => f.severity === 'error').length, 1);
  assert.ok(!findings.some((f) => /gstatic/.test(f.text)), JSON.stringify(findings));
  // formatVerify prints env[] under the same heading.
  const text = formatVerify({ target: '.', sections: { render: { errors: 1, warns: 0, findings } }, totals: { error: 1, warning: 0, low: 0, note: 0 }, env: [tls], exitCode: 1 });
  assert.match(text, /1 env - the machine or its network[^\n]*\n {2}env {3}net::ERR_CERT_AUTHORITY_INVALID https:\/\/fonts\.gstatic\.com\/x\.png/);
});

test('err.html still reports its three errors at each width, and the favicon it never declared is env', { skip: browserSkip(), timeout: Number(process.env.UFS_TEST_TIMEOUT_MS) || 90000 }, async () => {
  const server = startServer(join(HERE, 'fixtures', 'env'), 0);
  await once(server, 'listening');
  try {
    const results = await inspect('http://127.0.0.1:' + server.address().port + '/err.html', { widths: [1440, 390], wait: 300 });
    assert.deepEqual(results.map((r) => r.width), [1440, 390]);
    const missed = results.flatMap((r) => (r.network || []).map((f) => String(f.error)));
    for (const r of results) {
      const shown = formatReport([r], { missed });
      const errors = shown.text.split('\n').filter((l) => /^\s*ERROR/.test(l));
      assert.equal(shown.errors, 3, r.width + 'px:\n' + shown.text);
      assert.ok(errors.some((l) => /console: err\.html: logged on purpose/.test(l)), shown.text);
      assert.ok(errors.some((l) => /console: .*err\.html: thrown on purpose/.test(l)), shown.text);
      assert.ok(errors.some((l) => /HTTP 404 .*\/missing\.png/.test(l)), shown.text);
    }
    const env = envList(results);
    assert.ok(env.some((e) => /\/favicon\.ico$/.test(e.url) && /declares no icon/.test(e.reason)), JSON.stringify(env));
    assert.ok(!env.some((e) => /missing\.png/.test(e.url)), 'a missing image of the page\'s own is never env');
  } finally { await new Promise((r) => server.close(r)); }
});

test('a third-party request that fails TLS is env: verify exits the same with and without it, and a same-origin 404 stays an error', { skip: browserSkip(), timeout: Number(process.env.UFS_TEST_TIMEOUT_MS) || 180000 }, async () => {
  // A real HTTPS server on another origin whose certificate no browser trusts:
  // what a TLS-intercepting proxy does to every third-party request.
  const tls = createServer(selfSigned('localhost'), (req, res) => { res.writeHead(200, { 'content-type': 'image/gif' }); res.end(Buffer.from('R0lGODlhAQABAAAAACw=', 'base64')); });
  tls.listen(0, '127.0.0.1');
  await once(tls, 'listening');
  const thirdParty = `https://localhost:${tls.address().port}/pixel.gif`;
  const page = (extra) => '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
    + '<title>Env fixture</title><meta name="description" content="A fixture page long enough to pass the meta-description length check comfortably.">'
    + '<link rel="stylesheet" href="styles.css">'
    + '<main><h1>Env fixture</h1><p>Plain text on a plain page.</p>' + extra + '</main></html>';
  const verify = async (extra) => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-env-'));
    try {
      writeFileSync(join(dir, 'index.html'), page(extra));
      writeFileSync(join(dir, 'styles.css'), 'body{margin:24px;font:18px/1.5 system-ui,sans-serif;color:#1a1a1a;background:#fff}\n@media (prefers-reduced-motion: reduce){*{animation:none!important}}\n');
      return await runVerify(dir, { out: join(dir, 'review'), widths: [800], wait: 60 });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  const img = `<img src="${thirdParty}" alt="" width="8" height="8">`;
  try {
    const without = await verify('');
    const withTls = await verify(img);
    assert.equal(without.schema, 'ufs-verify/1');
    assert.equal(withTls.schema, 'ufs-verify/1');
    assert.equal(without.exitCode, 0, formatVerify(without));
    assert.equal(withTls.exitCode, without.exitCode, formatVerify(withTls));
    assert.equal(withTls.totals.error, without.totals.error);
    const failed = withTls.env.find((e) => e.url === thirdParty);
    assert.ok(failed, JSON.stringify(withTls.env));
    assert.match(failed.error, /^net::ERR_CERT_/);
    assert.ok(!withTls.sections.render.findings.some((f) => f.text.includes(thirdParty)), 'the third-party image is env, not also a broken image');
    assert.match(formatVerify(withTls), /env - the machine or its network[\s\S]*env {3}net::ERR_CERT_[A-Z_]+ https:\/\/localhost:\d+\/pixel\.gif/);

    // The chassis's img/hero.jpg, missing, as on a fresh scaffold: the page's own.
    const hero = await verify(img + '<img src="img/hero.jpg" alt="The hero" width="80" height="60">');
    assert.equal(hero.exitCode, 1);
    assert.ok(hero.sections.render.findings.some((f) => f.severity === 'error' && /HTTP 404 \S*\/img\/hero\.jpg/.test(f.text)), formatVerify(hero));
    assert.ok(!hero.env.some((e) => /hero\.jpg/.test(e.url)));
    assert.ok(hero.env.some((e) => e.url === thirdParty));
  } finally { await new Promise((r) => tls.close(r)); }
});
