/* Security and disclosure check for a built static site.
 *
 * What the audit reads for taste, this reads for harm: secrets that should
 * never have left a laptop, forms that mail personal data over GET, scripts
 * pulled from a CDN with nothing pinning what they contain, a header
 * configuration that leaves the page embeddable by anyone, and the small
 * disclosures - a build machine's username in a comment, a font request that
 * hands every visitor's address to a third party - that add up.
 *
 * Everything here runs offline over the files that would be deployed. The
 * research behind it (references/security.md) splits the problem in two: what
 * can be known from source, which is this file, and what can only be known
 * once the site is served - the real response headers, whether /.git/HEAD
 * resolves - which is a short list of curl commands the reference spells out.
 *
 * Severity is stated on every finding and the command exits 1 only on high.
 * A checker that fails the build over a console.log is a checker people turn
 * off, and then it catches nothing.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative, basename } from 'node:path';

/* Files never to deploy. Presence in the site directory is the finding. */
const NEVER_SHIP = [
  { test: (name) => /^\.env(\..+)?$/.test(name), level: 'high', text: 'environment file in the site directory', fix: 'keep .env files out of the publish directory and in .gitignore; a deploy copies what is there' },
  { test: (name) => name === '.git', level: 'high', text: 'a .git directory inside the site directory', fix: 'publish a build directory, not the repository root; with .git served, every secret ever committed is downloadable from /.git/' },
  { test: (name) => /\.map$/.test(name), level: 'medium', text: 'source map shipped', fix: 'keep maps out of production or upload them to the error tracker instead; a map carries original paths and unminified logic' },
  { test: (name) => name === '.DS_Store' || name === 'Thumbs.db' || name === 'desktop.ini', level: 'low', text: 'operating-system litter file', fix: 'delete it; it leaks directory listings and nothing else' },
  { test: (name) => /\.(pem|key|p12|pfx|jks|keystore)$/.test(name), level: 'high', text: 'key or certificate file', fix: 'remove it and rotate whatever it protected' },
  // Notes are not pages. HQ's build brief sat in docs/ and would have been
  // served at /docs/LAB-BRIEF.md, project ids and all, because the ignore file
  // listed bridge/ and tests/ but not docs/ (caught by hand, 2026-09-24).
  { test: (name) => /\.(md|markdown|log)$/i.test(name), level: 'low', text: 'a notes or log file would be served as plain text', fix: 'move it out of the publish directory or list it (or its folder) in .vercelignore; nothing links it, but anyone who guesses the path reads it' },
];

/* .vercelignore, read the way the Vercel CLI reads it for the common cases:
 * a name matches at any depth, a leading slash anchors it to the root, a
 * trailing slash means a folder, * and ** are globs. Negation (!) is not
 * supported and such lines are skipped, so this can only ever check MORE
 * files than Vercel deploys, never fewer. */
export function vercelIgnore(dir) {
  let text = '';
  try { text = readFileSync(join(dir, '.vercelignore'), 'utf8'); } catch { return () => false; }
  const rules = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const anchored = line.startsWith('/');
    const folder = line.endsWith('/');
    const pattern = line.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!pattern) continue;
    const source = pattern.split('**').map((part) => part.split('*').map((s) => s.replace(/[.+^${}()|[\]\\?]/g, '\\$&')).join('[^/]*')).join('.*');
    rules.push({ re: new RegExp('^' + source + '$', 'i'), anchored: anchored || pattern.includes('/'), folder });
  }
  return (rel) => {
    const parts = rel.split(/[\\/]+/).filter(Boolean);
    return rules.some((r) => {
      if (r.anchored) {
        for (let n = 1; n <= parts.length; n++) {
          if (r.folder && n === parts.length) break;
          if (r.re.test(parts.slice(0, n).join('/'))) return true;
        }
        return false;
      }
      return parts.some((part, i) => (!r.folder || i < parts.length - 1) && r.re.test(part));
    });
  };
}

/* The secret shapes worth a regex. Prefixed formats first: those are exact.
 * The generic assignment rule is the workhorse for everything without a
 * prefix, and the one most likely to be right about a hand-written config. */
const SECRETS = [
  { re: /\bAKIA[0-9A-Z]{16}\b/g, level: 'high', text: 'AWS access key id' },
  { re: /\b(?:sk|rk)_live_[0-9a-zA-Z]{20,}\b/g, level: 'high', text: 'Stripe live secret key' },
  { re: /\bsk_test_[0-9a-zA-Z]{20,}\b/g, level: 'medium', text: 'Stripe test secret key (still a secret)' },
  { re: /\bghp_[0-9A-Za-z]{36}\b|\bgithub_pat_[0-9A-Za-z]{22}_[0-9A-Za-z]{59}\b|\bgh[ousr]_[0-9A-Za-z]{36,}\b/g, level: 'high', text: 'GitHub token' },
  { re: /\bxox[baprs]-[0-9A-Za-z-]{10,72}\b/g, level: 'high', text: 'Slack token' },
  { re: /\bnfp_[A-Za-z0-9]{20,}\b/g, level: 'high', text: 'Netlify personal access token' },
  { re: /\bvcp_[A-Za-z0-9]{20,}\b/g, level: 'high', text: 'Vercel token' },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/g, level: 'medium', text: 'Google API key (public by design, but must be referrer-restricted in the console)' },
  { re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----/g, level: 'high', text: 'private key block' },
  // The optional quote before the colon is what makes this work on JSON and
  // YAML as well as JavaScript. Without it, "apiKey": "..." in a config file
  // fell through to the entropy note - the weakest finding there is - while
  // the same secret in a .js file was reported properly.
  { re: /\b(?:api[_-]?key|apikey|secret|client[_-]?secret|auth[_-]?token|access[_-]?token|password|passwd)\b['"]?\s*[:=]\s*['"][A-Za-z0-9\-_./+=]{16,}['"]/gi, level: 'medium', text: 'a secret-shaped value assigned in source' },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, level: 'low', text: 'a JWT in source (fine if short-lived and scoped; check its claims)' },
];

/* Public tracking ids. Not secrets, but each one obliges the page to say
 * what it collects. */
const TRACKERS = [
  { re: /\bG-[A-Z0-9]{8,12}\b/g, text: 'Google Analytics 4 measurement id' },
  { re: /\bGTM-[A-Z0-9]{6,8}\b/g, text: 'Google Tag Manager container' },
  { re: /\bUA-\d{4,10}-\d{1,4}\b/g, text: 'legacy Universal Analytics id' },
  { re: /fbq\(\s*['"]init['"]\s*,\s*['"]\d{15,16}['"]/g, text: 'Meta pixel' },
];

const SOURCE_EXT = new Set(['.html', '.htm', '.js', '.mjs', '.css', '.json', '.toml', '.txt', '.xml', '.svg', '.webmanifest']);

function walk(dir, out = [], depth = 0) {
  if (depth > 12) return out;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e.name);
    const rule = NEVER_SHIP.find((r) => r.test(e.name));
    if (rule) out.push({ never: rule, file: full });
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      walk(full, out, depth + 1);
    } else if (SOURCE_EXT.has(extname(e.name).toLowerCase())) {
      out.push({ file: full });
    }
  }
  return out;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

// The attribute being present is not the same as the subresource being pinned.
// integrity="" and integrity="notahash" both leave the browser verifying
// nothing, and a presence-only test called both of them safe.
function pinned(tag) {
  const found = /\bintegrity\s*=\s*["']([^"']*)["']/i.exec(tag);
  return Boolean(found && /\bsha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}/.test(found[1]));
}

/* Shannon entropy in bits per character. A content hash, a base64 image and
 * a real key all score high, so this is a note, never a failure. */
function entropy(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) || 0) + 1);
  let h = 0;
  for (const n of counts.values()) { const p = n / s.length; h -= p * Math.log2(p); }
  return h;
}

export function headersConfig(dir) {
  const found = {};
  for (const name of ['netlify.toml', '_headers', 'vercel.json']) {
    const file = join(dir, name);
    if (existsSync(file)) found[name] = readFileSync(file, 'utf8');
  }
  const all = Object.values(found).join('\n');
  const has = (name) => new RegExp(name.replace(/-/g, '[-_]?'), 'i').test(all);
  return {
    any: Boolean(all.trim()),
    files: Object.keys(found),
    csp: has('Content-Security-Policy'),
    hsts: has('Strict-Transport-Security'),
    nosniff: /X-Content-Type-Options/i.test(all) && /nosniff/i.test(all),
    referrer: has('Referrer-Policy'),
    permissions: has('Permissions-Policy'),
    framing: /frame-ancestors/i.test(all) || /X-Frame-Options/i.test(all),
    raw: all,
  };
}

/* ------------------------------------------------ CSP against the code ---- */
/* A Content-Security-Policy that refuses the page's own code is not a
 * security finding, it is a dead feature - and the one an offline suite can
 * never see, because it runs without the served headers. Doodle Voyager
 * shipped exactly that on 2026-09-25: net.js did import('https://esm.sh/...')
 * and createClient(PROJECT) under a policy that allowed neither, while every
 * check drove multiplayer through a fake transport. So: collect every
 * absolute URL the code loads, work out which directive governs it, and say
 * when no configured policy lets it through.
 *
 * Deliberately narrow, so that what it says is true. Only URLs it can resolve
 * exactly are judged: string literals, a simple string constant named in the
 * same file, and template literals made of those. Per-path policies are not
 * matched to pages; a URL is reported only when EVERY policy refuses it. A
 * policy with 'strict-dynamic' in script-src is not judged for scripts. */

// Every Content-Security-Policy value in the header files, as raw strings.
export function cspPolicies(dir) {
  const out = [];
  const read = (name) => { try { return readFileSync(join(dir, name), 'utf8'); } catch { return null; } };
  const vercel = read('vercel.json');
  if (vercel) {
    try {
      const walkJson = (node) => {
        if (Array.isArray(node)) { node.forEach(walkJson); return; }
        if (!node || typeof node !== 'object') return;
        if (typeof node.key === 'string' && /^content-security-policy$/i.test(node.key) && typeof node.value === 'string') out.push(node.value);
        Object.values(node).forEach(walkJson);
      };
      walkJson(JSON.parse(vercel));
    } catch { /* an unparseable vercel.json is Vercel's error to report */ }
  }
  const headers = read('_headers');
  if (headers) for (const m of headers.matchAll(/^[ \t]*Content-Security-Policy[ \t]*:[ \t]*(.+)$/gim)) out.push(m[1].trim());
  const toml = read('netlify.toml');
  if (toml) for (const m of toml.matchAll(/Content-Security-Policy\s*=\s*(?:"""([\s\S]*?)"""|'''([\s\S]*?)'''|"([^"\n]*)"|'([^'\n]*)')/gi)) out.push((m[1] || m[2] || m[3] || m[4] || '').replace(/\s+/g, ' ').trim());
  return out.filter(Boolean);
}

export function parseCsp(value) {
  const map = new Map();
  for (const part of value.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const name = tokens[0].toLowerCase();
    if (!map.has(name)) map.set(name, tokens.slice(1));
  }
  return map;
}

// CSP3 scheme-part match: an expression's scheme also covers its secure form.
function schemeMatches(expr, url) {
  return expr === url || (expr === 'http' && url === 'https') || (expr === 'ws' && ['wss', 'http', 'https'].includes(url)) || (expr === 'wss' && url === 'https');
}

// Does one source expression allow this absolute URL? 'self' never matches
// here: only URLs on another origin are ever checked.
function sourceAllows(expr, url, self = new Set()) {
  const e = expr.toLowerCase();
  const scheme = url.protocol.replace(':', '');
  // 'self' is the page's own origin, and in CSP3 also its ws/wss twin.
  if (e === "'self'") return self.has(url.origin) || self.has(url.origin.replace(/^ws(s?):/, 'http$1:'));
  if (e === '*') return ['http', 'https', 'ws', 'wss'].includes(scheme);
  if (/^[a-z][a-z0-9+.-]*:$/.test(e)) return schemeMatches(e.slice(0, -1), scheme);
  if (e.startsWith("'")) return false;
  const m = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|\*\.[^/:]+|[^/:*]+)(?::(\d+|\*))?(\/.*)?$/.exec(e);
  if (!m) return false;
  const [, s, host, port, path] = m;
  if (s ? !schemeMatches(s, scheme) : !['http', 'https', 'ws', 'wss'].includes(scheme)) return false;
  const h = url.hostname.toLowerCase();
  if (host === '*') { /* any host */ }
  else if (host.startsWith('*.')) { if (!h.endsWith(host.slice(1))) return false; }
  else if (host !== h) return false;
  if (port && port !== '*') {
    const actual = url.port || ({ http: '80', https: '443', ws: '80', wss: '443' })[scheme];
    if (port !== actual) return false;
  }
  if (path && path !== '/') {
    let p = url.pathname;
    try { p = decodeURIComponent(p); } catch { /* keep it encoded */ }
    if (path.endsWith('/') ? !p.startsWith(path) : p !== path) return false;
  }
  return true;
}

// The directive that governs a fetch of this kind, and whether it allows it.
// Returns null when the policy says nothing about that kind of fetch.
export function cspAllows(policy, kind, href, self = new Set()) {
  const url = new URL(href);
  const chain = kind === 'script' ? ['script-src-elem', 'script-src', 'default-src'] : ['connect-src', 'default-src'];
  const directive = chain.find((d) => policy.has(d));
  if (!directive) return { directive: null, allowed: true };
  const sources = policy.get(directive);
  if (kind === 'script' && sources.some((s) => s.toLowerCase() === "'strict-dynamic'")) return { directive, allowed: true, strictDynamic: true };
  return { directive, allowed: sources.some((s) => sourceAllows(s, url, self)) };
}

// Every absolute URL a file loads, with the kind of fetch it is.
export function loadedUrls(text) {
  // Only a const declared once, and never also a parameter, is trusted: a
  // name declared in two functions, or shadowed by an argument, could be
  // either value at the call, and a wrong guess here is a false error.
  const consts = new Map();
  const twice = new Set();
  for (const m of text.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])([^'"\n]*)\2/g)) {
    if (consts.has(m[1])) twice.add(m[1]);
    consts.set(m[1], m[3]);
  }
  for (const name of [...consts.keys()]) {
    const esc = name.replace(/\$/g, '\\$&');
    const param = new RegExp('(?:\\(|,)\\s*' + esc + '\\s*(?:=[^,)]*)?(?:,[^()]*)?\\)\\s*(?:=>|\\{)|\\b' + esc + '\\s*=>');
    if (twice.has(name) || param.test(text)) consts.delete(name);
  }
  // A template literal is resolved only when every ${...} is a known constant.
  const resolve = (arg) => {
    arg = arg.trim();
    let m = /^(['"])([^'"\n]*)\1$/.exec(arg);
    if (m) return m[2];
    m = /^`([^`]*)`$/.exec(arg);
    if (m) {
      let ok = true;
      const v = m[1].replace(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (_, name) => (consts.has(name) ? consts.get(name) : (ok = false, '')));
      return ok && !/\$\{/.test(v) ? v : null;
    }
    if (/^[A-Za-z_$][\w$]*$/.test(arg)) return consts.get(arg) ?? null;
    return null;
  };
  const ARG = String.raw`(\s*(?:'[^'\n]*'|"[^"\n]*"|` + '`[^`]*`' + String.raw`|[A-Za-z_$][\w$]*)\s*)`;
  const found = [];
  const add = (kind, raw, index, how) => {
    // A call on a commented-out line loads nothing.
    const lead = text.slice(text.lastIndexOf('\n', index) + 1, index).trim();
    if (lead.startsWith('//') || lead.startsWith('*') || lead.startsWith('/*') || lead.startsWith('<!--')) return;
    const value = resolve(raw);
    if (!value || !/^(https?|wss?):\/\//i.test(value)) return;
    try { found.push({ kind, url: new URL(value).href, line: lineOf(text, index), how }); } catch { /* not a URL */ }
  };
  const scan = (re, kind, how) => { for (const m of text.matchAll(re)) add(kind, m[1], m.index, how); };
  scan(new RegExp(String.raw`\bimport\s*\(` + ARG + String.raw`[,)]`, 'g'), 'script', 'import()');
  scan(/\bfrom\s*((['"])https?:\/\/[^'"\n]+\2)/g, 'script', 'import');
  scan(/^\s*import\s*((['"])https?:\/\/[^'"\n]+\2)/gm, 'script', 'import');
  scan(new RegExp(String.raw`\bimportScripts\s*\(` + ARG + String.raw`[,)]`, 'g'), 'script', 'importScripts()');
  scan(new RegExp(String.raw`\bfetch\s*\(` + ARG + String.raw`[,)]`, 'g'), 'connect', 'fetch()');
  scan(new RegExp(String.raw`\bnew\s+(?:WebSocket|EventSource)\s*\(` + ARG + String.raw`[,)]`, 'g'), 'connect', 'socket');
  scan(new RegExp(String.raw`\bsendBeacon\s*\(` + ARG + String.raw`[,)]`, 'g'), 'connect', 'sendBeacon()');
  // A Supabase client talks REST over https and Realtime over wss to the
  // same host; the second one is needed only if the file opens a channel.
  for (const m of text.matchAll(new RegExp(String.raw`\bcreateClient\s*\(` + ARG + String.raw`[,)]`, 'g'))) {
    add('connect', m[1], m.index, 'createClient()');
    const value = resolve(m[1]);
    if (value && /^https:\/\//i.test(value) && /\.channel\s*\(/.test(text)) {
      try { found.push({ kind: 'connect', url: 'wss://' + new URL(value).host + '/', line: lineOf(text, m.index), how: 'Realtime channel' }); } catch { /* not a URL */ }
    }
  }
  // Markup: script tags, and every URL an import map can hand to import().
  scan(/<script\b[^>]*\bsrc\s*=\s*((['"])https?:\/\/[^'"\s]+\2)/gi, 'script', '<script src>');
  const map = /<script\b[^>]*type\s*=\s*["']importmap["'][^>]*>([\s\S]*?)<\/script>/i.exec(text);
  if (map) for (const m of map[1].matchAll(/("https?:\/\/[^"\s]+")/g)) add('script', m[1], map.index, 'the import map');
  return found;
}

export function securityAudit(dir) {
  const root = dir;
  // What the host would not deploy is not a finding about the deploy.
  const ignored = vercelIgnore(root);
  const entries = walk(root).filter((e) => !ignored(relative(root, e.file)));
  const findings = [];
  const add = (level, file, line, text, fix) => findings.push({ level, file: file ? relative(root, file) || basename(file) : null, line: line || null, text, fix });

  for (const e of entries.filter((x) => x.never)) add(e.never.level, e.file, null, e.never.text, e.never.fix);

  const pages = [];
  const loaders = [];
  for (const e of entries.filter((x) => !x.never)) {
    let text;
    try { text = readFileSync(e.file, 'utf8'); } catch { continue; }
    const ext = extname(e.file).toLowerCase();
    const isHtml = ext === '.html' || ext === '.htm';
    const isJs = ext === '.js' || ext === '.mjs';
    if (isHtml) pages.push({ file: e.file, text });
    if (isHtml || isJs) loaders.push({ file: e.file, text });

    // Secrets, in anything textual. A data: URI or an integrity hash is not a
    // key, and the generic rule would otherwise fire on every inline SVG.
    const scrubbed = text.replace(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]+/g, 'data:...').replace(/integrity="[^"]*"/g, 'integrity=""');
    for (const rule of SECRETS) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(scrubbed))) {
        add(rule.level, e.file, lineOf(scrubbed, m.index), rule.text + ': ' + m[0].slice(0, 12) + '...', rule.level === 'high' ? 'remove it from the source and ROTATE it now - it is already in the deploy history' : 'move it out of client-side source; if it must be public, restrict it at the provider');
      }
    }
    // Long high-entropy literals, as a note. Real keys hide here; so do hashes.
    const literal = /['"`]([A-Za-z0-9+/=_-]{32,})['"`]/g;
    let lm;
    while ((lm = literal.exec(scrubbed))) {
      if (/^sha(256|384|512)-/.test(lm[1])) continue;
      if (entropy(lm[1]) > 4.6 && !/^[0-9a-f]+$/i.test(lm[1])) add('note', e.file, lineOf(scrubbed, lm.index), 'high-entropy string literal (' + lm[1].slice(0, 10) + '...) - a key, or a hash', 'if it is a credential, remove and rotate it; if it is a hash, ignore this');
    }
    // A developer's machine, named in the shipped files.
    const local = /(?:[A-Za-z]:\\Users\\[^\\\s"'<>]+|\/Users\/[A-Za-z0-9_-]+\/|\/home\/[A-Za-z0-9_-]+\/)/g;
    let pm;
    while ((pm = local.exec(text))) add('low', e.file, lineOf(text, pm.index), 'local machine path in shipped file: ' + pm[0].slice(0, 40), 'it names a person and an operating system; usually a source map or a bundler embedding __dirname');

    if (isJs || isHtml) {
      const code = text;
      const at = (re, level, msg, fix, opts = {}) => {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(code))) {
          if (opts.skip && opts.skip(m, code)) continue;
          add(level, e.file, lineOf(code, m.index), msg, fix);
          if (opts.once) break;
        }
      };
      // The lookahead excludes whitespace too, or \s* backtracks one space and
      // the quote check is skipped - which flagged every literal assignment.
      at(/\.(?:innerHTML|outerHTML)\s*=\s*(?![\s'"`])/g, 'high', 'innerHTML assigned from a non-literal', 'use textContent, or sanitise before assigning; anything from a URL, a form or a fetch is an injection here');
      // A backtick was treated as a literal and skipped, so the most common
      // way anyone actually writes an injection - `<div>${name}</div>` - was
      // the one form the check could not see.
      at(/\.(?:innerHTML|outerHTML)\s*=\s*`[^`]*\$\{/g, 'high', 'innerHTML assigned from a template literal with interpolation', 'the interpolated value is written as markup; use textContent for the value, or build the node and set its text');
      at(/document\.write\s*\(\s*(?![\s'"`)])/g, 'high', 'document.write with a non-literal', 'build nodes instead; this is both an injection and a CSP blocker');
      at(/postMessage\s*\([^)]*['"]\*['"]/g, 'high', 'postMessage to any origin ("*")', 'name the target origin');
      at(/addEventListener\s*\(\s*['"]message['"]/g, 'high', 'message listener with no origin check', 'compare event.origin against an allowlist before trusting event.data', { skip: (m, s) => /\.origin\b/.test(s.slice(m.index, m.index + 600)) });
      at(/\beval\s*\(|new\s+Function\s*\(/g, 'medium', 'eval or new Function', 'remove it; it also forces unsafe-eval into any CSP');
      at(/\bDEBUG\s*=\s*true\b|__DEBUG__\s*=\s*true/g, 'low', 'debug flag left on', 'turn it off for production');
      const logs = (code.match(/console\.log\s*\(/g) || []).length;
      if (logs >= 3) add('note', e.file, null, logs + ' console.log calls in shipped code', 'strip them; anything printed is visible to every visitor');
    }

    if (isHtml) {
      const h = text;
      const at = (re, level, msg, fix, opts = {}) => {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(h))) {
          if (opts.skip && opts.skip(m, h)) continue;
          add(level, e.file, lineOf(h, m.index), msg, fix);
          if (opts.once) break;
        }
      };
      at(/\son[a-z]+\s*=\s*["']/gi, 'medium', 'inline event handler', 'move it to a script file; a real Content-Security-Policy blocks it outright');
      at(/href\s*=\s*["']\s*javascript:/gi, 'medium', 'javascript: URL', 'use a button with a listener');
      // Mixed content: only a real fetch is one. Namespaces are not fetched.
      at(/(?:src|href|action)\s*=\s*["']http:\/\/(?!localhost|127\.0\.0\.1|www\.w3\.org|schema\.org|ogp\.me)[^"']+/gi, 'high', 'plain-http resource on a page that will be served over https', 'use https:// - active mixed content is blocked by every browser, passive marks the page insecure');
      at(/<a\b[^>]*target\s*=\s*["']_blank["'][^>]*>/gi, 'low', 'target="_blank" without rel="noopener"', 'add rel="noopener noreferrer"; evergreen browsers imply it, embedded webviews do not', { skip: (m) => /rel\s*=\s*["'][^"']*noopener/i.test(m[0]) });

      // Third-party scripts and styles, and what pins them.
      const scripts = [...h.matchAll(/<script\b[^>]*\bsrc\s*=\s*["'](https?:)?\/\/([^"'/]+)[^"']*["'][^>]*>/gi)];
      for (const m of scripts) {
        const tag = m[0];
        if (!pinned(tag)) add('medium', e.file, lineOf(h, m.index), 'cross-origin script from ' + m[2] + ' without a usable integrity hash', 'pin the exact version and add the integrity hash the CDN publishes, plus crossorigin="anonymous"');
        else if (!/\bcrossorigin\b/.test(tag)) add('medium', e.file, lineOf(h, m.index), 'integrity without crossorigin on ' + m[2], 'add crossorigin="anonymous" or the browser cannot verify the hash');
      }
      const styles = [...h.matchAll(/<link\b[^>]*rel\s*=\s*["']stylesheet["'][^>]*href\s*=\s*["'](https?:)?\/\/([^"'/]+)[^"']*["'][^>]*>/gi)];
      for (const m of styles) {
        // Font CSS is generated per user agent and cannot carry a stable hash.
        if (/fonts\.(googleapis|bunny)\.net|fonts\.googleapis\.com|fontshare|typekit/i.test(m[2])) continue;
        if (!pinned(m[0])) add('low', e.file, lineOf(h, m.index), 'cross-origin stylesheet from ' + m[2] + ' without a usable integrity hash', 'pin and add integrity, or self-host it');
      }
      const map = h.match(/<script\b[^>]*type\s*=\s*["']importmap["'][^>]*>([\s\S]*?)<\/script>/i);
      if (map && /https?:\/\//.test(map[1]) && !/"integrity"\s*:/.test(map[1])) {
        add('medium', e.file, lineOf(h, map.index), 'import map pulls modules from a CDN with no "integrity" block', 'add an "integrity" map keyed by URL - Chrome 127+, Firefox 138+ and Safari 18.4+ enforce it - or self-host the modules');
      }
      if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(h)) {
        add('note', e.file, null, 'fonts served from Google', 'every visitor\'s IP goes to Google before the page paints (Munich Regional Court, Jan 2022); self-host the woff2 files or use a same-origin mirror');
      }

      // Forms.
      const forms = [...h.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)];
      const hasPrivacy = /href\s*=\s*["'][^"']*privacy/i.test(h);
      for (const f of forms) {
        const attrs = f[1], body = f[2];
        const line = lineOf(h, f.index);
        const personal = /type\s*=\s*["'](?:email|tel|password)["']|<textarea\b/i.test(body);
        const method = (attrs.match(/method\s*=\s*["']?(\w+)/i) || [])[1];
        if (personal && (!method || method.toLowerCase() === 'get')) add('high', e.file, line, 'form sends personal data with GET', 'method="post" - GET puts the submission in the URL, the history, the logs and the referrer');
        if (/action\s*=\s*["']http:\/\//i.test(attrs)) add('high', e.file, line, 'form posts to plain http', 'use an https action');
        if (/data-netlify\s*=\s*["']true["']/i.test(attrs) && !/netlify-honeypot/i.test(attrs)) add('medium', e.file, line, 'Netlify form without a honeypot', 'add netlify-honeypot="bot-field" and a hidden input named bot-field; Akismet runs regardless, the honeypot is the cheap second layer');
        if (personal && !hasPrivacy) add('medium', e.file, line, 'form collects personal data and the page links no privacy policy', 'link a privacy page near the submit button and say what the data is for');
      }

      // Trackers oblige a notice.
      for (const t of TRACKERS) {
        t.re.lastIndex = 0;
        if (t.re.test(h)) add(hasPrivacy ? 'note' : 'medium', e.file, null, t.text + ' present' + (hasPrivacy ? '' : ' and no privacy policy is linked'), 'a tracker needs a notice, and for EEA visitors on Google tags a consent signal (Consent Mode v2)');
      }
    }
  }

  // Headers: the configuration is source too, and it is where clickjacking
  // and sniffing are decided.
  const cfg = headersConfig(root);
  if (pages.length) {
    if (!cfg.any) {
      add('medium', null, null, 'no header configuration (netlify.toml [[headers]], _headers or vercel.json)', 'add a baseline: Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options: nosniff, Referrer-Policy, Permissions-Policy, frame-ancestors');
    } else {
      // A real path, so the report line reads netlify.toml and not a relative
      // walk up to wherever the command was run from.
      const src = join(root, cfg.files[0]);
      if (!cfg.csp) add('medium', src, null, 'no Content-Security-Policy in the header configuration', 'start with Content-Security-Policy-Report-Only and tighten; allowlist the exact CDN hosts the page uses');
      if (!cfg.hsts) add('medium', src, null, 'no Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload (Vercel sets a default; Netlify and Cloudflare Pages do not)');
      if (!cfg.nosniff) add('medium', src, null, 'no X-Content-Type-Options: nosniff', 'add it; there is no reason to omit it on a static site');
      if (!cfg.referrer) add('low', src, null, 'no Referrer-Policy', 'strict-origin-when-cross-origin');
      if (!cfg.permissions) add('low', src, null, 'no Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=() unless the page uses them');
      if (!cfg.framing) add('medium', src, null, 'nothing forbids framing (no frame-ancestors, no X-Frame-Options)', "Content-Security-Policy: frame-ancestors 'none' - this is the clickjacking gap");
      if (cfg.csp && pages.some((p) => /\son[a-z]+\s*=|<script\b(?![^>]*\bsrc=)[^>]*>\s*[^\s<]/i.test(p.text))) {
        add('note', src, null, 'a CSP is configured and the pages carry inline scripts or handlers', "they will be blocked unless the policy carries 'unsafe-inline' or a nonce; test with the policy in report-only first");
      }
    }
  }

  // The policy against what the code loads (see cspPolicies above).
  const policies = cspPolicies(root).map(parseCsp);
  if (policies.length) {
    const seen = new Set();
    // An absolute URL on the site's own domain is 'self'. The source does not
    // know the domain, but a canonical link or og:url states it.
    const self = new Set();
    for (const { text } of pages) {
      for (const m of text.matchAll(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>|<meta\b[^>]*property\s*=\s*["']og:url["'][^>]*>/gi)) {
        const u = /(?:href|content)\s*=\s*["'](https?:\/\/[^"']+)["']/i.exec(m[0]);
        if (u) { try { self.add(new URL(u[1]).origin); } catch { /* not a URL */ } }
      }
    }
    for (const { file, text } of loaders) {
      // Serverless functions run on the host, where no page policy applies
      // (HQ's api/google.js talks to Google's token endpoint from Vercel).
      if (/^(api|functions|netlify\/functions|server)\//.test(relative(root, file).replace(/\\/g, '/'))) continue;
      for (const use of loadedUrls(text)) {
        const origin = new URL(use.url).origin;
        const key = file + '|' + use.kind + '|' + origin;
        if (seen.has(key)) continue;
        const verdicts = policies.map((policy) => cspAllows(policy, use.kind, use.url, self));
        if (verdicts.some((v) => v.allowed)) continue;
        seen.add(key);
        const directive = verdicts[0].directive;
        const into = directive === 'default-src' ? (use.kind === 'script' ? 'script-src' : 'connect-src') : directive;
        add('high', file, use.line,
          `Content-Security-Policy ${directive} refuses ${origin}, which this file loads with ${use.how}: the browser blocks it in production, and a suite that runs without the served headers never sees it`,
          `add ${origin} to ${into}, or load it from a host the policy already allows; then load the page once under its real headers and assert zero securitypolicyviolation events`);
      }
    }
  }

  // The deploy link. A build step that empties the folder deletes .vercel/,
  // and the next `vercel deploy` creates a new project named after the
  // folder - "dist" - instead of updating the real one (Doodle Voyager, twice,
  // 2026-09-25). A link to a project named like a build folder is that.
  let vercelProject = null;
  try { vercelProject = JSON.parse(readFileSync(join(root, '.vercel', 'project.json'), 'utf8')).projectName || null; } catch { vercelProject = null; }
  if (vercelProject && /^(dist|build|out|public|site|www|_site)$/i.test(vercelProject)) {
    add('medium', join(root, '.vercel', 'project.json'), null, 'the deploy link points at a Vercel project named "' + vercelProject + '", which is the name of a build folder, not of a site', 'a stage or build step deleted the real link and the last deploy made a new project; relink with vercel link --project <real name>, keep .vercel/ when the folder is cleared, and delete the stray project');
  }

  const order = { high: 0, medium: 1, low: 2, note: 3 };
  findings.sort((a, b) => order[a.level] - order[b.level] || String(a.file).localeCompare(String(b.file)) || (a.line || 0) - (b.line || 0));
  return { findings, pages: pages.length, files: entries.filter((x) => !x.never).length, headers: cfg, vercelProject };
}

export function formatSecurity(result, target) {
  const lines = [];
  const counts = { high: 0, medium: 0, low: 0, note: 0 };
  lines.push(`\nwebdesign security  ${target}`);
  lines.push(`  ${result.pages} page(s), ${result.files} file(s) read, headers config: ${result.headers.any ? result.headers.files.join(', ') : 'none'}${result.vercelProject ? ', deploys to Vercel project ' + result.vercelProject : ''}\n`);
  for (const f of result.findings) {
    counts[f.level]++;
    const tag = f.level === 'high' ? 'ERROR' : f.level === 'medium' ? 'warn ' : f.level === 'low' ? 'low  ' : 'note ';
    const where = f.file ? f.file + (f.line ? ':' + f.line : '') + '  ' : '';
    lines.push(`  ${tag} ${where}${f.text}`);
    lines.push(`         fix: ${f.fix}`);
  }
  if (!result.findings.length) lines.push('  ok    nothing found from source; the live checks below still apply');
  lines.push('');
  lines.push(`  ${counts.high} error(s), ${counts.medium} warning(s), ${counts.low} low, ${counts.note} note(s)`);
  lines.push('  Once deployed, three things only the server can answer:');
  lines.push('    curl -sI https://<site>/ | grep -iE "content-security|strict-transport|x-content-type|referrer|permissions|frame"');
  lines.push('    curl -s -o /dev/null -w "%{http_code}\\n" https://<site>/.git/HEAD      (must be 404)');
  lines.push('    curl -s -o /dev/null -w "%{http_code}\\n" https://<site>/.env           (must be 404)');
  return { text: lines.join('\n'), ...counts };
}
