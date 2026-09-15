export function parseArgs(argv) {
  const values = new Set(['preset', 'name', 'sections', 'to', 'port', 'widths', 'scroll', 'out', 'list', 'model', 'actions', 'wait', 'motion', 'frames', 'record', 'travel', 'design', 'frame', 'kind', 'source', 'award', 'year', 'since', 'stack', 'technique', 'limit', 'n', 'pick', 'awards', 'res', 'count', 'prompt', 'concurrency', 'exe', 'only', 'selector', 'width']);
  const flags = new Set(['no-shot', 'alpha-matting', 'measure', 'expect-depth', 'json', 'no-probe', 'build', 'stats', 'techniques', 'verbose', 'urls', 'verified', 'check', 'fix', 'no-draco', 'install', 'dry-run']);
  const options = {}, positional = [];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') { positional.push(...argv.slice(i + 1)); break; }
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const [key, ...rest] = arg.slice(2).split('=');
    if (values.has(key)) {
      const value = rest.length ? rest.join('=') : argv[++i];
      if (!value || value.startsWith('--')) throw new Error('Missing value for --' + key);
      options[key] = value;
    } else if (flags.has(key) && !rest.length) options[key] = true;
    else throw new Error('Unknown option: ' + arg);
  }
  return { positional, flag: (name, fallback = null) => options[name] ?? fallback };
}
