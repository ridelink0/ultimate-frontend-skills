#!/usr/bin/env node
// Gev's source-only gate checks shipped files, not fixtures or optional plugins.
import { readFileSync, readdirSync, lstatSync, realpathSync, existsSync } from 'node:fs';
import { resolve, join, relative, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const OPAQUE = /\.(?:pyc|pyo|wasm|node|exe|dll|so|dylib|class|jar|zip|gz|tgz|7z|bin|glb)$/i;
const IMAGE = /\.(?:png|jpg|jpeg|gif|webp|ico)$/i;
function imageBytes(b, ext) {
  if (ext === '.png') return b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (ext === '.jpg' || ext === '.jpeg') return b[0] === 255 && b[1] === 216 && b[2] === 255;
  if (ext === '.gif') return /^GIF8[79]a$/.test(b.subarray(0, 6).toString('ascii'));
  if (ext === '.webp') return b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP';
  return ext === '.ico' && b.subarray(0, 4).equals(Buffer.from([0,0,1,0]));
}
export function auditDistribution(root, { paths = null } = {}) {
  root = realpathSync(resolve(root));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const errors = [], warnings = [], files = [], seen = new Set();
  for (const name of ['preinstall', 'install', 'postinstall', 'prepare']) if (pkg.scripts?.[name]) errors.push('package.json: remove automatic lifecycle script ' + name);
  const inside = p => { const r = relative(root, p); return r === '' || (!r.startsWith('..') && !/^[A-Za-z]:/.test(r)); };
  const visit = path => {
    const abs = resolve(root, path);
    if (!inside(abs)) { errors.push(path + ': path escapes distribution root'); return; }
    if (!existsSync(abs)) { errors.push(path + ': declared file is missing'); return; }
    const stat = lstatSync(abs);
    if (stat.isSymbolicLink()) { errors.push(path + ': symlink is not self-contained source'); return; }
    if (stat.isDirectory()) {
      for (const e of readdirSync(abs).sort()) {
        if (e === '.git' || e === 'node_modules') { errors.push(path + '/' + e + ': dependency or history payload'); continue; }
        visit(join(path, e));
      }
      return;
    }
    const name = relative(root, abs).replaceAll('\\', '/');
    if (seen.has(name)) return;
    seen.add(name); files.push({ path: name, size: stat.size });
    if (stat.size > 5 * 1024 * 1024) errors.push(name + ': exceeds 5 MiB');
    if (OPAQUE.test(name)) { errors.push(name + ': opaque executable or archive payload'); return; }
    const bytes = readFileSync(abs);
    if (IMAGE.test(name)) { if (!imageBytes(bytes, extname(name).toLowerCase())) errors.push(name + ': image extension does not match bytes'); return; }
    if (stat.size > 256 * 1024) errors.push(name + ': non-image source exceeds 256 KiB; split into readable files');
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { errors.push(name + ': not UTF-8 readable source'); return; }
    if (bytes.includes(0)) errors.push(name + ': binary NUL byte in source');
  };
  const shipped = paths || [...(pkg.files || []), 'package.json', 'README.md', 'LICENSE'];
  if (!paths && !Array.isArray(pkg.files)) errors.push('package.json: files allowlist required');
  for (const path of shipped) {
    if (typeof path !== 'string' || /[*?\[\]{}!]/.test(path)) { errors.push(String(path) + ': use literal distribution paths'); continue; }
    visit(path);
  }
  if (files.length > 10000) errors.push('distribution exceeds 10,000 files');
  if (files.length > 512) warnings.push('over 512 files; manual directory review may be required');
  const unpackedBytes = files.reduce((n, f) => n + f.size, 0);
  if (unpackedBytes > 256 * 1024 * 1024) errors.push('distribution exceeds 256 MiB unpacked');
  return { ok: errors.length === 0, files, unpackedBytes, errors, warnings };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = auditDistribution(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..'));
    console.log(JSON.stringify(result, null, 2)); process.exitCode = result.ok ? 0 : 1;
  } catch (err) { console.error('distribution: ' + err.message); process.exitCode = 1; }
}
