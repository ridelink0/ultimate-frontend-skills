/* ultimate-frontend-skills/verify - one command, one verdict.
   audit, debug/quality and security each print their own ad-hoc format with
   their own exit code, and "is this page done" today means running all three
   and reconciling them by hand. This runs them, folds every finding into one
   set of severities, and returns a single object a human or a script can act
   on without knowing the shape of any of the underlying checkers. */

import { existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { runAudit } from './audit.mjs';
import { debugSite } from './debug.mjs';
import { securityAudit, formatSecurity } from './security.mjs';

// The render/quality checkers already print in the "  TAG  message" shape
// (formatReport and formatQuality both use it - see inspect.mjs/measure.mjs).
// Reading that back into structured findings means verify does not need to
// change either checker's return shape to get one out of it.
function classifyLines(text) {
  const findings = [];
  for (const raw of text.split('\n')) {
    const m = raw.match(/^\s*(ERROR|warn|note)\s+(.*)$/);
    if (!m) continue;
    findings.push({
      severity: m[1] === 'ERROR' ? 'error' : m[1] === 'warn' ? 'warning' : 'note',
      text: m[2].trim(),
    });
  }
  return findings;
}

export async function runVerify(target, opts = {}) {
  const isUrl = /^https?:\/\//i.test(target);
  const resolved = isUrl ? target : resolve(target);
  if (!isUrl && !existsSync(resolved)) throw new Error(`no such path: ${resolved}`);

  const sections = {};

  // Source-only checks need files on disk; a URL target skips them rather
  // than fetching and reconstructing a tree it was never given.
  if (isUrl) {
    sections.audit = { skipped: 'a URL target has no source files to audit' };
    sections.security = { skipped: 'a URL target has no source files to scan' };
  } else {
    try {
      const r = runAudit(resolved);
      sections.audit = {
        errors: r.errors, warns: r.warns,
        findings: r.findings.map((f) => ({ severity: f.level === 'error' ? 'error' : 'warning', text: f.text })),
      };
    } catch (e) {
      // no .html found, or an unreadable path - not a crash, a skipped section.
      sections.audit = { skipped: e.message };
    }
    try {
      const sec = securityAudit(resolved);
      const shown = formatSecurity(sec, relative(process.cwd(), resolved) || '.');
      sections.security = {
        errors: shown.high, warns: shown.medium, low: shown.low, note: shown.note,
        findings: sec.findings.map((f) => ({
          severity: f.level === 'high' ? 'error' : f.level === 'medium' ? 'warning' : f.level,
          text: (f.file ? `${f.file}${f.line ? ':' + f.line : ''}: ` : '') + f.text,
        })),
      };
    } catch (e) {
      // Same reasoning as the audit above: one checker refusing a target is a
      // skipped section, not a reason to lose the other two checkers' work.
      sections.security = { skipped: e.message };
    }
  }

  // Render + quality are one browser pass: formatReport already folds the
  // frame-rate/script-weight/type-scale judge in whenever `measured` is on
  // (see inspect.mjs formatReport), so this is audit+debug+quality's browser
  // half in a single navigation per width instead of three.
  const debugResult = await debugSite(target, {
    widths: opts.widths || [1440, 390],
    wait: opts.wait ?? 1800,
    motion: 'both',
    scrolls: 'auto',
    measured: true,
  });
  sections.render = {
    errors: debugResult.errors, warns: debugResult.warns,
    findings: classifyLines(debugResult.text),
    reviewFile: debugResult.file,
  };

  // Design parity only runs when a reference was supplied, because without
  // one there is nothing to be faithful to. When it does run it is the check
  // that makes "preserve a supplied design, do not rebuild it in the house
  // style" measurable instead of merely instructed: a design that was
  // overwritten shows up as a type scale and a palette that are both absent
  // from the reference.
  if (opts.design) {
    try {
      const { runParity } = await import('./parity.mjs');
      const parity = await runParity(target, opts.design, {
        width: (opts.widths && opts.widths[0]) || 1440,
        wait: opts.wait ?? 2500,
      });
      sections.design = {
        errors: parity.errors, warns: parity.warns,
        reference: parity.reference, referenceKind: parity.referenceKind,
        designFrame: parity.design.frame,
        findings: parity.findings,
      };
    } catch (e) {
      // A missing browser, an unreadable reference or a bare .dc.html is a
      // section that could not run. Reporting that is honest; inventing a
      // parity verdict from a check that never happened is not.
      sections.design = { skipped: e.message };
    }
  }

  const totals = { error: 0, warning: 0, low: 0, note: 0 };
  for (const s of Object.values(sections)) {
    if (!s.findings) continue;
    for (const f of s.findings) totals[f.severity] = (totals[f.severity] || 0) + 1;
  }
  // Exactly what already exits 1 today: audit errors, a render/quality ERROR,
  // and a high-severity security finding. Nothing new is being made fatal.
  const exitCode = totals.error ? 1 : 0;
  return { target: isUrl ? target : relative(process.cwd(), resolved) || '.', sections, totals, exitCode };
}

const SEVERITIES = [
  ['error', 'ERROR', 'fix before this ships'],
  ['warning', 'warn ', 'decide deliberately'],
  ['low', 'low  ', 'worth knowing'],
  ['note', 'note ', 'for information'],
];

// Grouped by SEVERITY rather than by which checker happened to produce it -
// the whole point of one verdict is reading the worst thing first without
// having to know that contrast comes from the renderer and a leaked key comes
// from the security scan. Each line still names its section, so a finding can
// be traced back to the command that would reproduce it on its own.
export function formatVerify(result) {
  const lines = [];
  lines.push(`\nwebdesign verify  ${result.target}`);
  lines.push(`  ${result.totals.error} error(s), ${result.totals.warning} warning(s), ${result.totals.low} low, ${result.totals.note} note(s)`);
  // Which frame the design was read from belongs in the header, not the
  // footnotes: a canvas whose artboard frame was never found reports the
  // editor chrome, and every design finding below would then be about the
  // wrong document.
  const design = result.sections.design;
  if (design && !design.skipped) {
    lines.push(`  design reference: ${design.reference}${design.referenceKind === 'canvas' ? ' (Claude Design canvas)' : ''}, read from ${design.designFrame}`);
    if (design.referenceKind === 'canvas' && design.designFrame === 'document') {
      lines.push('  warn  no artboard frame was found in that canvas - the design findings describe the editor page');
    }
  }

  const skipped = Object.entries(result.sections).filter(([, s]) => s.skipped);
  const ran = Object.entries(result.sections).filter(([, s]) => !s.skipped);
  for (const [name, s] of skipped) lines.push(`  skipped ${name}: ${s.skipped}`);

  let printed = 0;
  for (const [severity, tag, gloss] of SEVERITIES) {
    const hits = ran.flatMap(([name, s]) => (s.findings || []).filter((f) => f.severity === severity).map((f) => [name, f]));
    if (!hits.length) continue;
    lines.push(`\n  ${hits.length} ${severity}${hits.length === 1 ? '' : 's'} - ${gloss}`);
    for (const [name, f] of hits) lines.push(`  ${tag} [${name}] ${f.text}`);
    printed += hits.length;
  }
  // Naming the sections that came back empty is not decoration: grouped by
  // severity, a section with nothing to say disappears from the report
  // entirely, and "the security scan found nothing" and "the security scan
  // never ran" then look exactly alike.
  const clean = ran.filter(([, s]) => !(s.findings || []).length).map(([n]) => n);
  if (clean.length) lines.push(`\n  ok    nothing found in ${clean.join(', ')}`);
  if (!printed && !clean.length) lines.push('\n  ok    nothing ran');

  if (result.sections.render?.reviewFile) lines.push(`\n  visual review: ${result.sections.render.reviewFile}`);
  return lines.join('\n');
}
