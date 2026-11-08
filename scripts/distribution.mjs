#!/usr/bin/env node
// Gev's source-only gate checks shipped files, not fixtures or optional plugins.
// The Claude directory clears a plugin only when a reviewer can read every file
// it ships: no native binaries, bytecode, WebAssembly, archives or minified
// bundles, and nothing fetched and run at install time. auditDistribution()
// walks the package.json files allowlist; auditPack() audits the exact list
// `npm pack --dry-run` reports, so files npm adds or drops are covered too.
import { readFileSync, readdirSync, lstatSync, realpathSync, existsSync } from 'node:fs';
import { resolve, join, relative, extname, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
export const PACKAGES = ['.', 'plugins/usage-limits', 'plugins/image-deep-research'];
const OPAQUE = /\.(?:pyc|pyo|pyd|pyz|whl|egg|wasm|node|exe|dll|so|dylib|a|o|lib|pdb|class|jar|war|aar|apk|ipa|msi|msix|appx|dmg|deb|rpm|vsix|xpi|crx|nupkg|asar|jsc|zip|gz|tgz|tar|bz2|xz|zst|rar|7z|bin|glb|blend|onnx|safetensors|pkl|map)$|\.so\.\d[\d.]*$/i;
// npm compiles a native addon at install time for a package that holds a
// binding.gyp, whatever its package.json says (arborist rebuild.js).
const GYP = /\.gyp$/i;
const MINIFIED_NAME = /[.-]min\.(?:[cm]?js|css)$/i;
const IMAGE = /\.(?:png|jpg|jpeg|gif|webp|ico)$/i;
const CODE = /\.(?:[cm]?[jt]sx?|css|html?|svg|py|sh|ps1|cmd|bat)$/i;
const MANIFEST = /(?:^|\/)(?:hooks|plugin|marketplace|\.?mcp)\.json$/;
// npm install in a package folder runs these seven, in this order, and a git
// install runs that same npm install in its clone (npm lib/commands/install.js,
// pacote lib/git.js), so each one is code run at install time.
const LIFECYCLE = ['preinstall', 'install', 'postinstall', 'prepublish', 'preprepare', 'prepare', 'postprepare'];
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
  ['504b0506', 'zip archive'], ['504b0708', 'zip archive'],
];
// Build output a reviewer cannot read as written. The one-letter classes, as
// above, keep this file from matching its own patterns.
const BUILT = [
  [/__webpack_[r]equire__|\bparcel[R]equire\b|\b__[c]ommonJS\(|\b__[t]oESM\(|\bSystem\.[r]egister\(/, 'carries bundler runtime output; ship the source it was built from'],
  [/[#@]\s*source[M]appingURL=/, 'points at a source map, so it is build output; ship the source'],
  [/[A-Za-z0-9+\/_-]{1000,}/, 'embeds a base64 payload of 1000 or more characters that no reviewer can read'],
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
// A path in front (C:\tools\npx.cmd, /usr/bin/curl) is the same launcher, and
// so is npm.cmd exec; a URL that only ends in one of the names is not. It is
// built from parts so that each part can be read on its own.
const WORD_START = /(?:^|[\s"'`&|;(])(?![^\s"'`&|;()]*:\/\/)(?:[^\s"'`&|;()]*[\\/])?/.source;
const RUNNER = /p?n[p]x|b[u]nx|u[v]x|p[i]px|c[u]rl|w[g]et|i[w]r|i[r]m|Invoke-(?:[W]ebRequest|[R]estMethod)/.source;
const INSTALLER = /(?:p?n[p]m|y[a]rn|b[u]n)(?:\.cmd|\.exe|\.ps1)?\s+(?:dlx|exec|x|install|i|ci|add|create)|u[v](?:\.exe)?\s+(?:tool\s+(?:run|install)|pip\s+install)|p[i]p3?(?:\.exe)?\s+install/.source;
const LAUNCHER = new RegExp(WORD_START + '(?:' + RUNNER + '|' + INSTALLER + ')(?:\\.cmd|\\.exe|\\.bat|\\.ps1)?(?=$|[\\s"\'`])', 'i');
// Claude Code runs !`cmd` (at a line start or after white space) and a block
// fenced by three backticks and ! in a shell each time the slash command or
// skill holding it is used. These are the two patterns it finds them with.
const INLINE_SHELL = [/(?<=^|\s)!`([^`]+)`/gm, /`{3}!\s*\n?([\s\S]*?)\n?`{3}/g];
const SHELL_DOC = /(?:^|\/)(?:commands\/.+\.md|SKILL\.md)$/i;
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
// Leading indentation is not counted, so indenting a minified line hides nothing.
function denseLine(text) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const n = lines[i].length;
    if (n > 2000) return 'line ' + (i + 1) + ' is ' + n + ' characters long, which reads as minified; wrap it';
    const body = lines[i].trim();
    if (body.length > 400 && (body.match(/\s/g) || []).length / body.length < 0.025) return 'line ' + (i + 1) + ' has ' + body.length + ' characters and almost no spaces, which reads as minified; wrap it';
  }
  return null;
}
// Base64 wrapped at 60-76 columns, as encoders and mail write it, escapes the
// one-run rule above. Sixteen or more such lines in a row, 1000 characters in
// all, is a payload. A line counts only when it holds a letter and a digit,
// so a rule of dashes does not, and a run that is all hex in either case (a
// column of sha256 digests) is not a payload. The url-safe alphabet counts too.
const B64_LINE = /^\s*['"`]?([A-Za-z0-9+\/_-]{60,}={0,2})['"`]?\s*[+,]?\s*$/;
function wrappedBase64(text) {
  let run = 0, chars = 0, start = 0, mixed = false;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i <= lines.length; i++) {
    const m = i < lines.length && B64_LINE.exec(lines[i]);
    if (m && /[A-Za-z]/.test(m[1]) && /\d/.test(m[1])) {
      if (!run) start = i;
      run++; chars += m[1].length; mixed ||= /[^0-9a-f]/i.test(m[1]);
      continue;
    }
    if (run >= 16 && chars >= 1000 && mixed) return 'lines ' + (start + 1) + '-' + i + ' are a wrapped base64 payload of ' + chars + ' characters that no reviewer can read';
    run = 0; chars = 0; mixed = false;
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
  if (pkg?.gypfile) out.push(label + ': gypfile makes npm compile a native addon at install time');
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
// A launch is a command and its args read as one line: { command: 'npm',
// args: ['exec', 'x'] } runs npm exec, though neither string does alone.
function launchCommands(value, out = []) {
  if (Array.isArray(value)) { for (const v of value) launchCommands(v, out); return out; }
  if (!value || typeof value !== 'object') return out;
  const words = v => typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter(w => typeof w === 'string') : [];
  const line = [...words(value.command), ...words(value.args)].join(' ');
  if (line) out.push(line);
  for (const [k, v] of Object.entries(value)) if (k !== 'command' && k !== 'args') launchCommands(v, out);
  return out;
}
const parseJson = text => { try { return JSON.parse(text.replace(/^\uFEFF/, '')); } catch { return undefined; } };
export function auditDistribution(root, { paths = null } = {}) {
  root = realpathSync(resolve(root));
  const pkg = parseJson(readFileSync(join(root, 'package.json'), 'utf8'));
  if (!pkg || typeof pkg !== 'object') throw new Error('package.json in ' + root + ' does not parse');
  const errors = [], warnings = [], files = [], seen = new Set();
  errors.push(...packageProblems('package.json', pkg));
  // '..notes.md' is inside; '..' and '../x' are not, nor another drive.
  const inside = p => { const r = relative(root, p); return r === '' || (!/^\.\.(?:[\\/]|$)/.test(r) && !isAbsolute(r)); };
  const visit = path => {
    const abs = resolve(root, path);
    if (!inside(abs)) { errors.push(path + ': path escapes distribution root'); return; }
    if (!existsSync(abs)) { errors.push(path + ': declared file is missing'); return; }
    // A linked folder higher up the path leaves the root even when the file is not a link.
    if (!inside(realpathSync(abs))) { errors.push(path + ': resolves outside the distribution root through a link'); return; }
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
    if (GYP.test(name)) errors.push(name + ': node-gyp build file; npm compiles a native addon at install time for a package that holds one');
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
    const wrapped = wrappedBase64(text);
    if (wrapped) errors.push(name + ': ' + wrapped);
    if (CODE.test(name)) {
      const dense = denseLine(text);
      if (dense) errors.push(name + ': ' + dense);
      for (const [pattern, why] of FETCH_AND_RUN) if (pattern.test(text)) errors.push(name + ': ' + why + '; a shipped file may not fetch code and run it');
    }
    // Inline shell in a slash command or skill runs when it is used, so it is
    // held to the same rule as a hook command.
    if (SHELL_DOC.test(name)) for (const pattern of INLINE_SHELL) for (const m of text.matchAll(pattern)) {
      const command = m[1].trim();
      if (LAUNCHER.test(command) || FETCH_AND_RUN.some(([p]) => p.test(command))) errors.push(name + ': runs "' + command.slice(0, 80) + '" in a shell when it is used, which fetches code when the plugin runs');
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
