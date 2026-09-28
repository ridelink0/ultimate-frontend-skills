/* ultimate-frontend-skills/games - checks for a web game before it goes to a
   portal (references/games.md, "Portals").

   portalCheck(dir) measures a built game folder against CrazyGames' published
   limits (docs.crazygames.com/requirements, read 2026-09-28: initial download
   at most 50 MB, total at most 250 MB, at most 1,500 files) and looks for the
   two things Poki's quality requirements refuse (developers.poki.com, same
   date): requests to other hosts, and localStorage used outside a try/catch.

   "Initial" here is index.html and the local files it names directly; assets
   a script fetches later are not counted, and the report says so. */

import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

export const CRAZYGAMES = { initialBytes: 50 * 1024 * 1024, totalBytes: 250 * 1024 * 1024, files: 1500 };
const MB = (b) => (b / 1024 / 1024).toFixed(1) + ' MB';

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

export function portalCheck(dir, limits = CRAZYGAMES) {
  if (!existsSync(join(dir, 'index.html'))) throw new Error('no index.html in ' + dir + ': point at the built game folder');
  const files = walk(dir);
  const size = (f) => statSync(f).size;
  const total = files.reduce((a, f) => a + size(f), 0);
  const index = readFileSync(join(dir, 'index.html'), 'utf8');
  const named = new Set([join(dir, 'index.html')]);
  for (const m of index.matchAll(/\s(?:src|href)\s*=\s*["']([^"'#?]+)/gi)) {
    const ref = m[1];
    if (/^[a-z][\w+.-]*:|^\/\//i.test(ref)) continue;
    const p = join(dir, ref);
    if (existsSync(p) && statSync(p).isFile()) named.add(p);
  }
  const initial = [...named].reduce((a, f) => a + size(f), 0);
  const findings = [];
  if (initial > limits.initialBytes) findings.push({ level: 'error', text: `initial download ${MB(initial)} (CrazyGames: at most ${MB(limits.initialBytes)})` });
  if (total > limits.totalBytes) findings.push({ level: 'error', text: `total ${MB(total)} (CrazyGames: at most ${MB(limits.totalBytes)})` });
  if (files.length > limits.files) findings.push({ level: 'error', text: `${files.length} files (CrazyGames: at most ${limits.files})` });
  const code = files.filter((f) => /\.(html?|m?js)$/i.test(f));
  const hosts = new Set(), unguarded = new Set();
  for (const f of code) {
    const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g, ' ');
    for (const m of text.matchAll(/(?:fetch\(|src\s*=\s*|href\s*=\s*|import\s*\(?\s*|new\s+WebSocket\(|XMLHttpRequest[\s\S]{0,80}?open\([^,]*,\s*)["'`](https?:|wss?:)\/\/([^/"'`\s]+)/gi)) hosts.add(m[2]);
    for (const m of text.matchAll(/\blocalStorage\b/g)) {
      const before = text.slice(Math.max(0, m.index - 400), m.index);
      const lastTry = before.lastIndexOf('try');
      const lastClose = Math.max(before.lastIndexOf('catch'), before.lastIndexOf('finally'));
      if (lastTry < 0 || lastTry < lastClose) unguarded.add(relative(dir, f).split('\\').join('/'));
    }
  }
  if (hosts.size) findings.push({ level: 'warn', text: `requests to other hosts: ${[...hosts].join(', ')} (Poki allows none; ship the files in the build)` });
  if (unguarded.size) findings.push({ level: 'warn', text: `localStorage outside a try/catch in ${[...unguarded].join(', ')} (it throws where storage is blocked, which portals' iframes often are)` });
  return { files: files.length, totalBytes: total, initialBytes: initial, findings,
    note: 'initial = index.html and the local files it names directly; assets a script loads later are not counted' };
}
