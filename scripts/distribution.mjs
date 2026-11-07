#!/usr/bin/env node
// Gev's source-only gate checks shipped files, not fixtures or optional plugins.
// The Claude directory clears a plugin only when a reviewer can read every file
// it ships: no native binaries, bytecode, WebAssembly, archives or minified
// bundles, and nothing fetched and run at install time. auditDistribution()
// walks the package.json files allowlist; auditPack() audits the exact list
// `npm pack --dry-run` reports, so files npm adds or drops are covered too.
import { readFileSync, readdirSync, lstatSync, realpathSync, existsSync } from 'node:fs';
import { resolve, join, relative, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
export const PACKAGES = ['.', 'plugins/usage-limits', 'plugins/image-deep-research'];
const OPAQUE = /\.(?:pyc|pyo|pyd|whl|egg|wasm|node|exe|dll|so|dylib|a|o|lib|class|jar|war|apk|msi|dmg|deb|rpm|vsix|crx|zip|gz|tgz|tar|bz2|xz|zst|rar|7z|bin|glb|blend|onnx|safetensors|pkl|map)$/i;
const MINIFIED_NAME = /[.-]min\.(?:[cm]?js|css)$/i;
const IMAGE = /\.(?:png|jpg|jpeg|gif|webp|ico)$/i;
const CODE = /\.(?:[cm]?[jt]sx?|css|html?|svg|py|sh|ps1|cmd|bat)$/i;
const MANIFEST = /(?:^|\/)(?:hooks|plugin|marketplace|\.?mcp)\.json$/;
const LIFECYCLE = ['preinstall', 'install', 'postinstall', 'prepare'];
const DEPENDENCIES = ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies', 'bundledDependencies'];
// The Claude directory refuses a plugin that approves its own actions or weakens
// the user's permission prompts. Each pattern is one way shipped source can do
// that; reading a setting or returning a deny decision does not match. The
// one-letter classes like [P] match the same text but keep this file, which is
// shipped and audited too, from spelling the names it looks for.
const SELF_APPROVAL = [
  [/skipDangerousMode[P]ermissionPrompt|bypassPermissionsMode[A]ccepted/, 'pre-accepts the bypass-permissions warning'],
  [/hasTrustDialogAccepted['"]?\s*(?::|=(?!=))\s*true/, 'pre-accepts folder trust'],
  [/enableAllProjectMcpServers['"]?\s*(?::|=(?!=))\s*true/, 'pre-approves project MCP servers'],
  [/(?:defaultMode|permissionMode)['"]?\s*[:=,]\s*['"]?bypassPermissions|--permission-mode[\s='",]+bypassPermissions/, 'turns on bypass permissions'],
  [/--dangerously-[s]kip-permissions|--dangerously-[b]ypass-approvals-and-sandbox/, 'launches with permission checks switched off'],
  [/(?:permissionDecision|behavior)['"]?\s*:\s*['"]allow['"]/, 'answers its own permission prompt with allow'],
  [/['"]PermissionRequest['"]\s*:/, 'registers a hook that answers permission prompts'],
  [/permissions\.allow\b|['"]?permissions['"]?\s*:\s*\{\s*['"]?allow['"]?\s*:/, 'adds its own entries to the permission allow list'],
  [/approval_policy\s*=\s*['"]never['"]|sandbox_mode\s*=\s*['"]danger-full-access['"]/, 'switches off Codex approvals or the sandbox'],
];
// Leading bytes of executables and archives, checked whatever the file is called.
const MAGIC = [
  ['0061736d', 'WebAssembly module'], ['7f454c46', 'ELF executable'], ['cafebabe', 'Mach-O or Java class file'],
  ['cffaedfe', 'Mach-O executable'], ['cefaedfe', 'Mach-O executable'], ['feedface', 'Mach-O executable'],
  ['feedfacf', 'Mach-O executable'], ['504b0304', 'zip archive'], ['1f8b', 'gzip archive'], ['28b52ffd', 'zstd archive'],
  ['377abcaf271c', '7z archive'], ['526172211a07', 'rar archive'], ['fd377a585a00', 'xz archive'],
];
// Build output a reviewer cannot read as written. The one-letter classes, as
// above, keep this file from matching its own patterns.
const BUILT = [
  [/__webpack_[r]equire__|\bparcel[R]equire\b|\b__[c]ommonJS\(|\b__[t]oESM\(|\bSystem\.[r]egister\(/, 'carries bundler runtime output; ship the source it was built from'],
  [/[#@]\s*source[M]appingURL=/, 'points at a source map, so it is build output; ship the source'],
  [/[A-Za-z0-9+\/]{1000,}/, 'embeds a base64 payload of 1000 or more characters that no reviewer can read'],
];
// Code that downloads code and runs it. Reading a URL, or printing a command
// for the user to run, does not match.
const FETCH_AND_RUN = [
  [/\b(?:c[u]rl|w[g]et)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/, 'pipes a download into a shell'],
  [/\b(?:i[w]r|i[r]m|Invoke-[W]ebRequest|Invoke-[R]estMethod)\b[^\n|]*\|\s*(?:iex|Invoke-Expression)\b/i, 'pipes a download into Invoke-Expression'],
  [/\b(?:e[v]al|F[u]nction)\s*\(\s*(?:await\s+)?\(?\s*(?:await\s+)?fetch\s*\(/, 'runs code it downloaded'],
  [/\bi[m]port\(\s*['"`]https?:\/\//, 'imports code from the network when it runs'],
];
// A hook or MCP server started through a package runner or a download tool
// fetches its code when the plugin runs, so the reviewed pack is not what runs.
const LAUNCHER = /(?:^|[\s"'`&|;(])(?:n[p]x|b[u]nx|u[v]x|p[i]px|(?:p?n[p]m|y[a]rn|b[u]n)\s+(?:dlx|exec|x|install|i|add|create)|p[i]p3?\s+install|c[u]rl|w[g]et|i[w]r|i[r]m|Invoke-(?:[W]ebRequest|[R]estMethod))(?:\.cmd|\.exe)?(?=$|[\s"'`])/i;
function imageBytes(b, ext) {
  if (ext === '.png') return b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (ext === '.jpg' || ext === '.jpeg') return b[0] === 255 && b[1] === 216 && b[2] === 255;
  if (ext === '.gif') return /^GIF8[79]a$/.test(b.subarray(0, 6).toString('ascii'));
  if (ext === '.webp') return b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP';
  return ext === '.ico' && b.subarray(0, 4).equals(Buffer.from([0,0,1,0]));
}
function payloadKind(b) {
  const head = b.subarray(0, 8).toString('hex');
  for (const [hex, kind] of MAGIC) if (head.startsWith(hex)) return kind;
  if (b[0] === 0x4d && b[1] === 0x5a && b.subarray(0, 512).includes(0)) return 'Windows executable';
  return null;
}
// Minified code: one very long line, or a long line with almost no spaces.
// Hand-written CSS rules and string literals stay under both once wrapped.
function denseLine(text) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const n = lines[i].length;
    if (n > 2000) return 'line ' + (i + 1) + ' is ' + n + ' characters long, which reads as minified; wrap it';
    if (n > 400 && (lines[i].match(/\s/g) || []).length / n < 0.025) return 'line ' + (i + 1) + ' has ' + n + ' characters and almost no spaces, which reads as minified; wrap it';
  }
  return null;
}
// A package root (one of PACKAGES) may declare no dependencies: installing the
// plugin would fetch them. A nested package.json is an example the user installs
// by hand, so it may name dependencies, but only as exact registry versions a
// reviewer can look up - no URL, git, tarball, file or range - and it may not
// bundle packages or run lifecycle scripts.
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
function packageProblems(label, pkg, { nested = false } = {}) {
  const out = [];
  for (const name of LIFECYCLE) if (pkg?.scripts?.[name]) out.push(label + ': remove automatic lifecycle script ' + name);
  for (const field of DEPENDENCIES) {
    const v = pkg?.[field];
    if (v === true || (Array.isArray(v) && v.length)) { out.push(label + ': ' + field + ' bundles packages into the pack; ship readable source instead'); continue; }
    if (!v || typeof v !== 'object' || !Object.keys(v).length) continue;
    if (!nested) { out.push(label + ': ' + field + ' are fetched at install time; ship readable source instead'); continue; }
    for (const [dep, spec] of Object.entries(v)) {
      if (typeof spec !== 'string' || !EXACT_VERSION.test(spec)) out.push(label + ': ' + field + ' ' + dep + ' is "' + String(spec).slice(0, 60) + '", not an exact registry version a reviewer can look up');
    }
  }
  return out;
}
function launchCommands(value, key = '', out = []) {
  if (typeof value === 'string') { if (key === 'command' || key === 'args') out.push(value); }
  else if (Array.isArray(value)) for (const v of value) launchCommands(v, key, out);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) launchCommands(v, k, out);
  return out;
}
const parseJson = text => { try { return JSON.parse(text.replace(/^\uFEFF/, '')); } catch { return undefined; } };
export function auditDistribution(root, { paths = null } = {}) {
  root = realpathSync(resolve(root));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const errors = [], warnings = [], files = [], seen = new Set();
  errors.push(...packageProblems('package.json', pkg));
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
    if (MINIFIED_NAME.test(name)) { errors.push(name + ': minified file; ship the readable source'); return; }
    const bytes = readFileSync(abs);
    const kind = payloadKind(bytes);
    if (kind) { errors.push(name + ': ' + kind + ' bytes; ship readable source'); return; }
    if (IMAGE.test(name)) { if (!imageBytes(bytes, extname(name).toLowerCase())) errors.push(name + ': image extension does not match bytes'); return; }
    if (stat.size > 256 * 1024) errors.push(name + ': non-image source exceeds 256 KiB; split into readable files');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { errors.push(name + ': not UTF-8 readable source'); return; }
    if (bytes.includes(0)) errors.push(name + ': binary NUL byte in source');
    for (const [pattern, why] of SELF_APPROVAL) if (pattern.test(text)) errors.push(name + ': ' + why + '; the directory refuses plugins that approve their own actions');
    for (const [pattern, why] of BUILT) if (pattern.test(text)) errors.push(name + ': ' + why);
    if (CODE.test(name)) {
      const dense = denseLine(text);
      if (dense) errors.push(name + ': ' + dense);
      for (const [pattern, why] of FETCH_AND_RUN) if (pattern.test(text)) errors.push(name + ': ' + why + '; a shipped file may not fetch code and run it');
    }
    if (name !== 'package.json' && /(?:^|\/)package\.json$/.test(name)) {
      const doc = parseJson(text);
      if (doc === undefined) errors.push(name + ': package.json does not parse');
      else errors.push(...packageProblems(name, doc, { nested: true }));
    }
    if (MANIFEST.test(name)) {
      const doc = parseJson(text);
      if (doc === undefined) errors.push(name + ': manifest does not parse');
      else for (const command of launchCommands(doc)) if (LAUNCHER.test(command)) errors.push(name + ': starts "' + command.slice(0, 80) + '", which fetches code when the plugin runs');
    }
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
// The file list npm itself would publish from dir. --ignore-scripts keeps any
// prepack or prepare script from running while the list is taken.
export function npmPackFiles(dir) {
  const r = spawnSync('npm pack --dry-run --json --ignore-scripts', { cwd: dir, shell: true, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('npm pack --dry-run failed in ' + dir + ': ' + String(r.stderr || r.error?.message || '').trim().slice(-400));
  const [report] = JSON.parse(r.stdout.slice(r.stdout.indexOf('[')));
  if (!report || !Array.isArray(report.files)) throw new Error('npm pack --dry-run gave no file list in ' + dir);
  return report.files.map(f => f.path.replaceAll('\\', '/'));
}
export function auditPack(dir) {
  const packed = npmPackFiles(dir);
  return { ...auditDistribution(dir, { paths: packed }), packed: packed.length };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const base = args.find(a => !a.startsWith('--')) || join(dirname(fileURLToPath(import.meta.url)), '..');
    if (args.includes('--pack')) {
      const packs = PACKAGES.map(p => {
        const r = auditPack(join(base, p));
        return { package: p, packed: r.packed, unpackedBytes: r.unpackedBytes, errors: r.errors, warnings: r.warnings };
      });
      const ok = packs.every(p => p.errors.length === 0);
      console.log(JSON.stringify({ ok, packs }, null, 2)); process.exitCode = ok ? 0 : 1;
    } else {
      const result = auditDistribution(base);
      console.log(JSON.stringify(result, null, 2)); process.exitCode = result.ok ? 0 : 1;
    }
  } catch (err) { console.error('distribution: ' + err.message); process.exitCode = 1; }
}
