/* A small flag parser shared by the scripts: `--name value`, `--name=value`
   and bare `--switch`. A value flag with nothing after it is a usage error,
   reported as one line rather than a stack trace. */
export function parseArgs(argv, { switches = [] } = {}) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--') || a === '--') { positional.push(a); continue; }
    const eq = a.indexOf('=');
    const name = a.slice(2, eq === -1 ? undefined : eq);
    if (eq !== -1) { flags[name] = a.slice(eq + 1); continue; }
    if (switches.includes(name)) { flags[name] = true; continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) throw new Error(`--${name} needs a value`);
    flags[name] = next;
    i++;
  }
  return { positional, flags };
}

export const int = (v, fallback, { min = -Infinity, max = Infinity } = {}) => {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`expected a whole number between ${min} and ${max}, got "${v}"`);
  return n;
};
