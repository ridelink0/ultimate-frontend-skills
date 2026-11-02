import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { publicAddress, checkUrl, publicFetch, readLimited } from '../skills/image-deep-research/scripts/network.mjs';
import { downloadImage, commercialOk, parseAic, parseMetObject, verifyImage } from '../skills/image-deep-research/scripts/images.mjs';

test('public destinations reject private, obfuscated, mapped and special-use addresses', () => {
  for (const ip of ['0.0.0.0', '10.0.0.1', '127.0.0.1', '100.64.0.1', '169.254.169.254', '172.31.255.255',
    '192.168.0.1', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '::1', '::',
    '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2001:0db8::1', '2002:7f00:1::'])
    assert.equal(publicAddress(ip), false, ip);
  for (const ip of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111', '2001:4860:4860::8888']) assert.equal(publicAddress(ip), true, ip);
  for (const url of ['http://2130706433/x', 'http://0177.0.0.1/x', 'http://[::1]/x', 'file:///etc/passwd',
    'https://user:secret@example.com/x', 'http://localhost/x', 'http://x.local/x']) assert.throws(() => checkUrl(url), /blocked|HTTP/);
});

const dns = async () => [{ address: '1.1.1.1', family: 4 }];
function requests(responses, calls) {
  return (url, options, receive) => {
    const req = new EventEmitter();
    req.end = () => {
      calls.push(url.href);
      options.lookup(url.hostname, { all: true }, (error, addresses) => {
        assert.equal(error, null);
        assert.deepEqual(addresses, [{ address: '1.1.1.1', family: 4 }], 'the checked DNS answer reaches the socket');
      });
      const response = new PassThrough();
      Object.assign(response, responses.shift());
      queueMicrotask(() => { receive(response); response.end('ok'); });
    };
    return req;
  };
}

test('redirects are revalidated before another socket opens and DNS answers are pinned', async () => {
  const calls = [];
  const requestImpl = requests([{ statusCode: 302, headers: { location: 'http://169.254.169.254/credentials' } }], calls);
  await assert.rejects(publicFetch('https://images.example.org/a', { lookupImpl: dns, requestImpl }), /blocked/);
  assert.equal(calls.length, 1);
  await assert.rejects(publicFetch('https://images.example.org/a', {
    lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }], requestImpl }), /blocked/);
  assert.equal(calls.length, 1, 'a private DNS answer opened a socket');
  const success = await publicFetch('https://images.example.org/a', { lookupImpl: dns,
    requestImpl: requests([{ statusCode: 302, headers: { location: '/b' } }, { statusCode: 200, headers: {} }], calls) });
  assert.equal(success.url, 'https://images.example.org/b');
  assert.equal(await success.text(), 'ok');
});

test('download rejects lying MIME, active SVG and over-size fixed or chunked bodies', async () => {
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const fetchImpl = (bytes, type, extra = {}) => async () => new Response(bytes, { headers: { 'content-type': type, ...extra } });
  const result = await downloadImage('https://images.example.org/a', { fetchImpl: fetchImpl(image, 'image/png') });
  assert.equal(result.ext, 'png');
  assert.deepEqual(result.bytes, image);
  await assert.rejects(downloadImage('https://images.example.org/a', { fetchImpl: fetchImpl('<html>bad</html>', 'image/png') }), /do not match/);
  await assert.rejects(downloadImage('https://images.example.org/a', { fetchImpl: fetchImpl('<svg/>', 'image/svg+xml') }), /unsupported/);
  await assert.rejects(downloadImage('https://images.example.org/a', { maxBytes: 20, fetchImpl: fetchImpl(image, 'image/png', { 'content-length': '1000' }) }), /exceeds/);
  await assert.rejects(readLimited(new Response(image), 20), /exceeds/);
  assert.equal((await verifyImage('http://127.0.0.1/a')).ok, false);
});

test('rights filters never turn string false or ambiguous license text into permission', () => {
  for (const flag of [false, 'false', 'true', 1]) {
    assert.deepEqual(parseAic({ data: [{ id: 1, image_id: 'a', is_public_domain: flag }] }), []);
    assert.equal(parseMetObject({ primaryImageSmall: 'https://images.example.org/a', isPublicDomain: flag }), null);
  }
  for (const licence of ['not public domain', 'CC BY 4.0; all rights reserved', 'CC0 requires approval', 'CC BY-NC 4.0']) assert.equal(commercialOk(licence), false, licence);
});

test('DNS stalls obey the caller abort signal and redirect loops are bounded', async () => {
  const controller = new AbortController();
  const pending = publicFetch('https://images.example.org/a', { signal: controller.signal, lookupImpl: () => new Promise(() => {}) });
  controller.abort(new Error('test DNS timeout'));
  await assert.rejects(pending, /test DNS timeout/);
  const calls = [];
  await assert.rejects(publicFetch('https://images.example.org/a', { lookupImpl: dns, maxRedirects: 1,
    requestImpl: requests([{ statusCode: 302, headers: { location: '/b' } }, { statusCode: 302, headers: { location: '/a' } }], calls) }), /too many/);
  assert.equal(calls.length, 2);
});
