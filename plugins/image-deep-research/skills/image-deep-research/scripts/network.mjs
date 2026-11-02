/* Public collection responses are untrusted. Resolve every redirect, reject
   private destinations, and pin the checked address for the actual socket. */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2))))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) !== 6) return false;
  const first = Number.parseInt(address.split(':')[0], 16);
  const second = Number.parseInt(address.split(':')[1] || '0', 16);
  // Only global unicast; exclude documentation, transition and special-use ranges.
  return first >= 0x2000 && first < 0x3fff && first !== 0x2002
    && !(first === 0x2001 && (second < 0x200 || second === 0xdb8));
}

export function checkUrl(value) {
  const u = new URL(value);
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password)
    throw new Error('image URL must use HTTP(S) without credentials');
  const hostname = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname) && !publicAddress(hostname)) throw new Error('private or special-use image destination blocked');
  if (hostname === 'localhost' || /\.(?:localhost|local|internal)$/i.test(hostname))
    throw new Error('private image destination blocked');
  return u;
}

export async function publicFetch(value, { method = 'GET', headers = {}, signal,
  lookupImpl = lookup, requestImpl, maxRedirects = 5 } = {}) {
  let u = checkUrl(value);
  for (let redirects = 0; ; redirects++) {
    signal?.throwIfAborted();
    const hostname = u.hostname.replace(/^\[|\]$/g, '');
    let onAbort;
    const aborted = signal && new Promise((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    let addresses;
    try {
      const resolving = isIP(hostname) ? Promise.resolve([{ address: hostname, family: isIP(hostname) }])
        : lookupImpl(hostname, { all: true, verbatim: true });
      addresses = await (aborted ? Promise.race([resolving, aborted]) : resolving);
    } finally { if (onAbort) signal.removeEventListener('abort', onAbort); }
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
      throw new Error('private or special-use image destination blocked');
    const chosen = addresses[0];
    const request = requestImpl || (u.protocol === 'https:' ? httpsRequest : httpRequest);
    const res = await new Promise((resolve, reject) => {
      const req = request(u, { method, headers, signal, agent: false,
        lookup: (_host, options, cb) => cb(null, options?.all ? [chosen] : chosen.address, chosen.family) }, resolve);
      req.once('error', reject);
      req.end();
    });
    const responseHeaders = new Headers();
    for (const [name, val] of Object.entries(res.headers)) {
      if (val !== undefined) responseHeaders.set(name, Array.isArray(val) ? val.join(', ') : String(val));
    }
    const status = res.statusCode;
    const location = responseHeaders.get('location');
    if ([301, 302, 303, 307, 308].includes(status) && location) {
      res.destroy();
      if (redirects >= maxRedirects) throw new Error('too many image redirects');
      u = checkUrl(new URL(location, u).href);
      continue;
    }
    const response = new Response(method === 'HEAD' || [204, 205, 304].includes(status) ? null : Readable.toWeb(res),
      { status, headers: responseHeaders });
    if (method === 'HEAD') res.destroy();
    Object.defineProperty(response, 'url', { value: u.href });
    return response;
  }
}

export async function readLimited(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (declared > maxBytes) {
    await response.body?.cancel();
    throw new Error(`response exceeds ${maxBytes} bytes`);
  }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error(`response exceeds ${maxBytes} bytes`);
      parts.push(Buffer.from(value));
    }
    return Buffer.concat(parts, size);
  } finally { await reader.cancel().catch(() => {}); }
}
