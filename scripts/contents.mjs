#!/usr/bin/env node
/* ultimate-frontend-skills/contents - a contents list at the top of every
   reference over 40 KB, so a build reads the list and then only the section it
   needs (PLAN item 13, 2026-09-28).

   The research proposed splitting each of these files into a folder of one
   file per section. That would break every citation of the form
   `references/games.md`, section "..." (the field records, the tests that
   check them, the README and the other references all use it), so the files
   stay whole and gain the index instead: one line per section heading,
   written between the markers below and kept current by
   `node scripts/contents.mjs` (a test fails when it is not).

   node scripts/contents.mjs          rewrite the contents lists
   node scripts/contents.mjs --check  exit 1 if any is out of date */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REFS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'ultimate-frontend-skills', 'references');
export const THRESHOLD = 40 * 1024;
const OPEN = '<!-- contents: written by scripts/contents.mjs -->';
const CLOSE = '<!-- /contents -->';

export function contentsOf(text) {
  const body = text.replace(/\r/g, '').replace(new RegExp(OPEN + '[\\s\\S]*?' + CLOSE + '\\n*'), '');
  let fence = false;
  const lines = [];
  for (const line of body.split('\n')) {
    if (/^```/.test(line)) fence = !fence;
    if (fence) continue;
    const m = /^(##|###) (.+)$/.exec(line);
    if (m) lines.push((m[1] === '###' ? '  - ' : '- ') + m[2].trim());
  }
  return [OPEN, '', '**Contents.** Read the section you need; search the file for its heading.', '', ...lines, '', CLOSE].join('\n');
}

export function withContents(text) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const plain = text.replace(/\r/g, '');
  const block = contentsOf(plain);
  let out;
  if (plain.includes(OPEN)) out = plain.replace(new RegExp(OPEN + '[\\s\\S]*?' + CLOSE), block);
  else {
    // After the title and the first paragraph under it.
    const lines = plain.split('\n');
    let i = 1;
    while (i < lines.length && lines[i].trim() === '') i++;
    while (i < lines.length && lines[i].trim() !== '') i++;
    out = [...lines.slice(0, i), '', block, ...lines.slice(i)].join('\n');
  }
  return out.replace(/\n/g, nl);
}

export function heavyReferences() {
  return readdirSync(REFS).filter((f) => f.endsWith('.md') && statSync(join(REFS, f)).size > THRESHOLD).map((f) => join(REFS, f));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const f of heavyReferences()) {
    const text = readFileSync(f, 'utf8');
    const next = withContents(text);
    if (next === text) continue;
    stale++;
    if (check) console.log('out of date: ' + f);
    else { writeFileSync(f, next); console.log('wrote contents: ' + f); }
  }
  process.exit(check && stale ? 1 : 0);
}
