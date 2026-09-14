#!/usr/bin/env node
/* ultimate-frontend-skills UserPromptSubmit hook.
   Prints one line, and only when the prompt is clearly about building or
   restyling a web page. Silent otherwise, so it costs nothing on every other
   turn. Reads stdin, never blocks, never fails the prompt. */

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { raw += d; if (raw.length > 65536) process.exit(0); });
process.stdin.on('end', () => {
  let prompt = '';
  try {
    prompt = String(JSON.parse(raw).prompt || '');
  } catch {
    prompt = raw;
  }
  const p = prompt.toLowerCase();

  // Must name a web surface...
  const surface =
    /\b(website|web ?site|web ?page|webpage|landing ?page|homepage|home ?page|marketing site|microsite|portfolio site|one ?pager|splash page|site for|site about)\b/.test(p) ||
    /\b(index\.html|\.html\b|tailwind|next\.?js|astro|sveltekit|static site)\b/.test(p);
  if (!surface) return;

  // ...and ask for it to be made or changed.
  const intent =
    /\b(build|make|create|design|redesign|restyle|rebuild|generate|scaffold|write|code|put together|spin up|whip up|improve|polish|clean up|modernis|moderniz|revamp|refresh|style|lay ?out|look better|prettier|nicer)\b/.test(p);
  if (!intent) return;

  process.stdout.write(
    'Use the ultimate-frontend-skills skill for this. It is the house art direction plus a ' +
      'copy-in CSS chassis, motion runtime, section library, scaffolder and audit. ' +
      'Follow its rule zero: build the files, keep every word of design reasoning ' +
      'out of the reply.\n',
  );
});
process.stdin.on('error', () => process.exit(0));
