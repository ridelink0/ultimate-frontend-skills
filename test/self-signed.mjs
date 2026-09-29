// A self-signed certificate made at test time, so a test can stand up an
// HTTPS server that a browser refuses (net::ERR_CERT_AUTHORITY_INVALID) with
// no network, no openssl and no private key committed to the repository.
// node:crypto makes the key and the signature; the X.509 around them is a
// few lines of DER.
import { generateKeyPairSync, sign, randomBytes } from 'node:crypto';

const tlv = (tag, body) => {
  const n = body.length;
  const len = n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 255];
  return Buffer.concat([Buffer.from([tag, ...len]), body]);
};
const seq = (...parts) => tlv(0x30, Buffer.concat(parts));
const oid = (dotted) => {
  const [a, b, ...rest] = dotted.split('.').map(Number);
  const out = [40 * a + b];
  for (const v of rest) {
    const bytes = [v & 127];
    for (let x = v >> 7; x; x >>= 7) bytes.unshift((x & 127) | 128);
    out.push(...bytes);
  }
  return tlv(0x06, Buffer.from(out));
};
const utc = (d) => tlv(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));
const name = (cn) => seq(tlv(0x31, seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from(cn)))));

export function selfSigned(host = 'localhost') {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const ecdsaSha256 = seq(oid('1.2.840.10045.4.3.2'));
  const serial = randomBytes(8); serial[0] &= 0x7f;
  const now = Date.now();
  const san = seq(oid('2.5.29.17'), tlv(0x04, seq(tlv(0x82, Buffer.from(host)))));
  const tbs = seq(
    tlv(0xa0, tlv(0x02, Buffer.from([2]))), // v3
    tlv(0x02, serial),
    ecdsaSha256,
    name(host),
    seq(utc(new Date(now - 86400000)), utc(new Date(now + 86400000))),
    name(host),
    publicKey.export({ type: 'spki', format: 'der' }),
    tlv(0xa3, seq(san)),
  );
  const signature = sign('sha256', tbs, privateKey);
  const der = seq(tbs, ecdsaSha256, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])));
  const cert = '-----BEGIN CERTIFICATE-----\n' + der.toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END CERTIFICATE-----\n';
  return { cert, key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}
