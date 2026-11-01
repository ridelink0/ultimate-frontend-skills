#!/usr/bin/env node
// Original dependency-free terminal reference for Gev. ASCII output is portable
// across redirected streams, legacy code pages and terminals with no ANSI support.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function terminalText(value) {
  return String(value ?? '').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[^\x20-\x7e]/g, ' ');
}
export function renderTerminal({ title = 'Tasks', rows = [], selected = 0, columns = 80 } = {}) {
  const width = Number.isFinite(columns) ? Math.min(240, Math.max(8, Math.floor(columns))) : 80;
  const fit = s => { const t = terminalText(s); return t.length <= width ? t : t.slice(0, width - 3) + '...'; };
  const index = Math.max(0, Math.min(rows.length - 1, Number.isInteger(selected) ? selected : 0));
  return [fit(title), '-'.repeat(width), ...(rows.length ? rows.map((r, i) => fit((i === index ? '> ' : '  ') + r)) : ['No tasks.']), fit('Enter: open  Esc: back  Ctrl+C: exit')].join('\n') + '\n';
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(renderTerminal({ title: 'Workflow reference - demo data', rows: ['Review source', 'Verify core flow', 'Inspect failure states'], columns: process.stdout.columns || 80 }));
}
