/* ultimate-frontend-skills/sections - the section library and the order the
   scaffolder uses when nobody passes --sections.

   Both live here rather than in webdesign.mjs because the rendered tells
   (tells-render.mjs) need them too: the section-waterfall feature asks whether
   a page still runs in exactly DEFAULT_SECTIONS, and it recognises each
   rendered block by the classes and ids its library block carries. */
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'ultimate-frontend-skills', 'assets');

export const DEFAULT_SECTIONS = ['nav', 'hero-photo', 'manifesto', 'services', 'stats', 'faq', 'contact', 'footer'];

export function loadSections() {
  const src = readFileSync(join(ASSETS, 'sections.html'), 'utf8');
  const out = new Map();
  const re = /<!--\s*@section\s+([\w-]+)\s*\|\s*([\s\S]*?)\s*-->\s*([\s\S]*?)\s*<!--\s*@end\s*-->/g;
  let m;
  // [[ ]] marks the library's scaffold copy for the audit (audit.mjs reads the
  // marks back out of this file). The page gets the copy without them.
  while ((m = re.exec(src))) out.set(m[1], { note: m[2].trim(), body: m[3].replace(/\[\[([\s\S]*?)\]\]/g, '$1') });
  return out;
}
