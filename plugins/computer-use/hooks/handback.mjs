// Stop hook: the reply is about to be handed back. If it lists a GUI job for
// the user that this plugin can do - read a settings panel, close a window,
// open an app, click a thing - the turn is blocked once with the rule, so the
// job gets done instead of delegated. This is the one moment the failure
// actually happens (2026-09-21: two such items were left "for you" at the end
// of a long task), and a Stop hook costs nothing on every turn that does not
// match. It never blocks twice in a row (stop_hook_active) and at most once
// per session, so it cannot trap a turn or nag.
import fs from 'node:fs';
import path from 'node:path';

const HANDBACK = /(for you to do|left for you|you.ll need to|you will need to|you have to|please (open|close|click|check|confirm|look)|by hand|manually|yourself)/i;
const GUI = /(window|panel|settings|preferences|dialog|desktop|screen|menu|application|browser|tab\b|explorer|notepad|configure)/i;
const CANNOT = /(credential|password|login|log in|sign in|npm publish|macos|a mac|apple|consent|approve|2fa|two.factor)/i;

function lastAssistantText(transcript) {
  let text = '';
  let lines = [];
  try { lines = fs.readFileSync(transcript, 'utf8').split(/\r?\n/); } catch { return ''; }
  for (let i = lines.length - 1; i >= 0 && !text; i--) {
    if (!lines[i]) continue;
    let row = null;
    try { row = JSON.parse(lines[i]); } catch { continue; }
    if (!row || row.type !== 'assistant' || !row.message) continue;
    const parts = Array.isArray(row.message.content) ? row.message.content : [];
    text = parts.filter((p) => p && p.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('\n');
  }
  return text;
}

function offending(text) {
  const hits = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.length > 400) continue;
    if (HANDBACK.test(line) && GUI.test(line) && !CANNOT.test(line)) hits.push(line.trim());
  }
  return hits;
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input = {};
  try { input = JSON.parse(raw || '{}'); } catch { return; }
  if (input.stop_hook_active) return;
  const dataDir = process.argv[2] || '';
  const sid = String(input.session_id || '_').replace(/[^A-Za-z0-9_-]/g, '');
  const memo = dataDir ? path.join(dataDir, 'handback-' + sid) : null;
  if (memo && fs.existsSync(memo)) return;
  const hits = offending(lastAssistantText(String(input.transcript_path || '')));
  if (!hits.length) return;
  if (memo) { try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(memo, new Date().toISOString()); } catch {} }
  const reason =
    'This reply hands the user a job on this computer that the computer-use plugin can do: ' +
    hits.slice(0, 3).map((h) => JSON.stringify(h.slice(0, 160))).join('; ') +
    '. Before any step goes under "for you to do", ask whether computer-use can read it, click it, open it or close it. ' +
    'If yes, do it now and report what happened; a completed action is not a follow-up. ' +
    'Leave a step to the user only when it needs their credentials or consent, or has no GUI or CLI path at all. ' +
    'Do the ones that can be done, then finish.';
  process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n');
}
main().catch(() => {});
