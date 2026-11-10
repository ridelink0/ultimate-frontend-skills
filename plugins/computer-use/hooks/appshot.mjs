// UserPromptSubmit hook. If an appshot was taken since the last prompt - both
// Ctrl keys with a window in front - its text goes in front of Claude with
// this prompt, the way the ChatGPT desktop app's both-Command-keys appshot
// lands in the chat. The picture is a computer_appshot call away.
//
// Reads a file the server wrote; never talks to the server. Silent unless
// there is a fresh, unconsumed appshot, and never fails.

import fs from 'node:fs';
import path from 'node:path';

const MAX_CHARS = 8000;
const FRESH_MS = 30 * 60_000;

async function main() {
  let dir = String(process.argv[2] || '').trim();
  if (!dir || dir.includes('${')) {
    const { dataDir } = await import('../server/build.mjs');
    dir = dataDir();
  }
  dir = path.join(dir, 'appshots');
  const metaFile = path.join(dir, 'latest.json');
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch { return; }
  if (!meta || meta.consumed || !meta.t || Date.now() - meta.t > FRESH_MS) return;
  let body;
  try { body = fs.readFileSync(path.join(dir, 'latest.md'), 'utf8'); } catch { return; }
  if (body.length > MAX_CHARS) body = body.slice(0, MAX_CHARS) + `\n[... ${body.length - MAX_CHARS} more chars; computer_appshot returns all of it]`;
  try { fs.writeFileSync(metaFile, JSON.stringify({ ...meta, consumed: true })); } catch { /* shown once anyway */ }
  const secs = Math.max(1, Math.round((Date.now() - meta.t) / 1000));
  process.stdout.write(
    `The user took an appshot ${secs}s ago (both Ctrl keys) of the window they had in front. ` +
    `It is what they are looking at and probably what the prompt is about. Handle ${meta.hwnd} is live for computer_snapshot and computer_run.` +
    (meta.image ? ' The picture of it: computer_appshot.' : '') + '\n\n' + body + '\n');
}

main().catch(() => { /* silent by design */ });
