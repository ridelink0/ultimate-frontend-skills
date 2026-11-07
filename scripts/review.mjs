import { writeFileSync, mkdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { formatReport } from './inspect.mjs';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function writeReview(results, out, target) {
  mkdirSync(out, { recursive: true });
  const summary = formatReport(results);
  const cards = results.map(r => {
    const src = r.file ? relative(out, r.file).split(/[\\/]/).map(encodeURIComponent).join('/') : '';
    const caption = r.width + 'px / ' + (r.step ? 'interaction ' + r.step : 'scroll ' + r.scroll) + ' / ' + (r.reducedMotion ? 'reduced motion' : 'normal motion');
    return '<article data-width="' + r.width + '"><h2>' + escape(caption) + '</h2>' +
      (src ? '<a href="' + escape(src) + '"><img loading="lazy" src="' + escape(src) + '" alt="' + escape(caption) + '"></a>' : '<p>No screenshot captured.</p>') +
      '<details><summary>Findings and page state</summary><pre>' + escape(JSON.stringify({ action: r.action, actionErrors: r.actionErrors, visual: r.visual, network: r.network, overlaps: r.overlaps, overflow: r.overflow, broken: r.broken, console: r.console }, null, 2)) + '</pre></details></article>';
  }).join('');
  const html = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Website visual review</title><style>' +
    'body{margin:0;background:#ece9e2;color:#242321;font:16px system-ui}' +
    'header,main{padding:24px;max-width:1500px;margin:auto}' +
    'h1{font-size:36px}h2{font-size:16px}' +
    'main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px}' +
    'article{background:#faf9f6;padding:16px;min-width:0}' +
    'img{display:block;width:100%;height:auto}' +
    'pre{white-space:pre-wrap;overflow-wrap:anywhere}' +
    'select{font:inherit;padding:8px}article[hidden]{display:none}</style>' +
    '<header><h1>Website visual review</h1><p>' + escape(target) + '</p><p>' + summary.errors + ' errors · ' + summary.warns + ' warnings · ' + results.length + ' captured states</p>' +
    '<p>Inspect the screenshots before accepting the page. Automated checks cannot certify visual quality or reference fidelity.</p><label>Viewport <select id="width"><option value="">All widths</option>' +
    [...new Set(results.map(r => r.width))].map(w => '<option>' + w + '</option>').join('') +
    '</select></label></header><main>' + cards + '</main><script>document.querySelector("#width").onchange=e=>{for(const card of document.querySelectorAll("article"))card.hidden=!!e.target.value&&card.dataset.width!==e.target.value}</script></html>';
  const file = resolve(out, 'review.html');
  writeFileSync(file, html, 'utf8');
  writeFileSync(resolve(out, 'review.json'), JSON.stringify({ target, summary: { errors: summary.errors, warnings: summary.warns }, results }, null, 2) + '\n', 'utf8');
  return { file, ...summary };
}
