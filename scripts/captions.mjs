/* ultimate-frontend-skills/captions - read, check and write captions.

   The reading rules are Netflix's English Timed Text Style Guide (read
   2026-09-28, partnerhelp.netflixstudios.com, article 215758617): at most 42
   characters per line and two lines per event, at most 20 characters per
   second for adult content, and an event on screen between 5/6 of a second
   and 7 seconds. They are the best-documented rules there are for text a
   viewer has to read while a picture moves, which is why they are used for
   on-screen copy in a motion piece as well as for subtitles. */

export const RULES = { maxLine: 42, maxLines: 2, maxCps: 20, minSeconds: 5 / 6, maxSeconds: 7 };

const stamp = (s) => {
  const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/.exec(s);
  if (!m) return NaN;
  return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
};

/* SRT or WebVTT text -> [{ start, end, lines }]. Cue settings, identifiers and
   NOTE/STYLE blocks are skipped; tags inside a cue (<i>, <b>, <v Name>) are
   removed from the text a viewer reads. */
export function parseCues(text) {
  const cues = [];
  for (const block of String(text).replace(/\r/g, '').replace(/^﻿/, '').split(/\n{2,}/)) {
    const rows = block.split('\n').filter((l) => l.trim() !== '');
    const at = rows.findIndex((l) => l.includes('-->'));
    if (at < 0) continue;
    const [a, b] = rows[at].split('-->');
    const start = stamp(a), end = stamp(b);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const lines = rows.slice(at + 1).map((l) => l.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
    cues.push({ start, end, lines });
  }
  return cues;
}

/* One finding per broken rule per cue: { level, rule, cue, text }. Too many
   characters on a line or too many lines cannot be read at all (error); too
   fast, too short or too long is a pace problem (warning). */
export function checkCaptions(cues, rules = RULES) {
  const out = [];
  cues.forEach((c, i) => {
    const n = i + 1;
    const dur = c.end - c.start;
    const chars = c.lines.join(' ').length;
    const long = c.lines.find((l) => l.length > rules.maxLine);
    if (c.lines.length > rules.maxLines) out.push({ level: 'error', rule: 'captions-rules', cue: n, text: `cue ${n} has ${c.lines.length} lines (at most ${rules.maxLines})` });
    if (long) out.push({ level: 'error', rule: 'captions-rules', cue: n, text: `cue ${n} has a line of ${long.length} characters (at most ${rules.maxLine}): "${long}"` });
    if (dur <= 0) { out.push({ level: 'error', rule: 'captions-rules', cue: n, text: `cue ${n} ends before it starts` }); return; }
    const cps = chars / dur;
    if (cps > rules.maxCps) out.push({ level: 'warn', rule: 'captions-rules', cue: n, text: `cue ${n} asks for ${cps.toFixed(1)} characters per second (at most ${rules.maxCps})` });
    if (dur < rules.minSeconds - 1e-9) out.push({ level: 'warn', rule: 'captions-rules', cue: n, text: `cue ${n} is on screen ${dur.toFixed(2)} s (at least 5/6 s)` });
    if (dur > rules.maxSeconds + 1e-9) out.push({ level: 'warn', rule: 'captions-rules', cue: n, text: `cue ${n} is on screen ${dur.toFixed(2)} s (at most ${rules.maxSeconds} s)` });
  });
  return out;
}

/* Timed words [{ word, start, end }] (a transcriber's output) -> cues that
   keep every rule: a new cue at a sentence end, at a pause of 0.6 s or more,
   or before a line would pass 42 characters or the cue two lines or 7 s.
   Then each cue is held on screen long enough to be read (5/6 s, and 20
   characters a second) where the next cue leaves room. */
export function splitCaptions(words, rules = RULES) {
  const cues = [];
  let cur = null;
  const text = (c) => c.lines.join(' ');
  const close = () => { if (cur && cur.lines.length) cues.push(cur); cur = null; };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const token = String(w.word).trim();
    if (!token) continue;
    if (cur) {
      const last = cur.lines[cur.lines.length - 1];
      const gap = w.start - cur.end;
      const wouldLine = (last ? last + ' ' : '') + token;
      const lines = wouldLine.length > rules.maxLine ? cur.lines.length + 1 : cur.lines.length;
      if (/[.!?]["')\]]*$/.test(last || '') || gap >= 0.6 || lines > rules.maxLines || w.end - cur.start > rules.maxSeconds) close();
    }
    if (!cur) { cur = { start: w.start, end: w.end, lines: [token] }; continue; }
    const last = cur.lines[cur.lines.length - 1];
    if ((last + ' ' + token).length > rules.maxLine) cur.lines.push(token);
    else cur.lines[cur.lines.length - 1] = last + ' ' + token;
    cur.end = w.end;
  }
  close();
  // Hold each cue until it can be read, up to the next cue and never past 7 s.
  cues.forEach((c, i) => {
    const next = cues[i + 1];
    const need = Math.max(rules.minSeconds, text(c).length / rules.maxCps);
    if (c.end - c.start < need) c.end = Math.min(c.start + need, next ? next.start : c.start + need, c.start + rules.maxSeconds);
  });
  return cues;
}

const two = (n, w = 2) => String(n).padStart(w, '0');
// Whole milliseconds first, so 1.9996 s is 00:00:02,000 and never ",1000".
const srtTime = (s) => {
  const ms = Math.round(s * 1000);
  return `${two(Math.floor(ms / 3600000))}:${two(Math.floor(ms / 60000) % 60)}:${two(Math.floor(ms / 1000) % 60)},${two(ms % 1000, 3)}`;
};
export function toSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.lines.join('\n')}\n`).join('\n');
}
