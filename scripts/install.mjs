#!/usr/bin/env node
/* ultimate-frontend-skills installer - registers the plugin with Claude Code and with Codex.
   node scripts/install.mjs [--source <git-url-or-path>] [--uninstall] [--dry-run]

   Claude Code goes through its own CLI. Codex has no CLI on every platform, so
   its config.toml is edited directly - idempotently, and with a backup. */

import { findClaude, runClaude, removeTables } from './claude-cli.mjs';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const NAME = 'ultimate-frontend-skills';

const argv = process.argv.slice(2);
const has = (f) => argv.includes('--' + f);
const val = (f, d) => {
  const i = argv.indexOf('--' + f);
  return i === -1 || !argv[i + 1] || argv[i + 1].startsWith('--') ? d : argv[i + 1];
};
const UNINSTALL = has('uninstall');
const DRY = has('dry-run');
// Default to this checkout, so a clone works with no arguments.
const SOURCE = val('source', REPO);
const IS_GIT = /^(https?:|git@|ssh:)/.test(SOURCE) || SOURCE.endsWith('.git');

const log = (s) => console.log(s);
const step = (s) => console.log('\n' + s);

/* ------------------------------------------------------------ Claude Code -- */

function doClaude() {
  step('Claude Code');
  const cli = findClaude();
  if (!cli) {
    log('  claude CLI not found. Run these yourself:');
    log(`    claude plugin marketplace add ${JSON.stringify(SOURCE)}`);
    log(`    claude plugin install ${NAME}@${NAME}`);
    return false;
  }
  const run = (args) => {
    if (DRY) { log(`  [dry-run] claude ${args.join(' ')}`); return true; }
    const r = runClaude(cli, args);
    const out = ((r.stdout || '') + (r.stderr || '')).trim().split(/\r?\n/).pop();
    log(`  ${out || (r.status === 0 ? 'ok' : 'failed')}`);
    return r.status === 0;
  };
  if (UNINSTALL) {
    const removed = run(['plugin', 'uninstall', `${NAME}@${NAME}`]);
    const catalog = run(['plugin', 'marketplace', 'remove', NAME]);
    return removed && catalog;
  }
  if (!run(['plugin', 'marketplace', 'add', SOURCE])) return false;
  return run(['plugin', 'install', `${NAME}@${NAME}`]);
}

/* ------------------------------------------------------------------ Codex -- */

const CODEX_DIR = process.env.CODEX_HOME || join(homedir(), '.codex');
const CODEX_CFG = join(CODEX_DIR, 'config.toml');

function doCodex() {
  step('Codex');
  if (!existsSync(CODEX_CFG)) {
    log(`  no ${CODEX_CFG} - Codex does not look installed. Skipped.`);
    return false;
  }
  let cfg = readFileSync(CODEX_CFG, 'utf8');
  const mpHeader = `[marketplaces.${NAME}]`;
  const plHeader = `[plugins."${NAME}@${NAME}"]`;

  if (UNINSTALL) {
    const before = cfg;
    cfg = removeTables(cfg, [mpHeader, plHeader]);
    if (cfg === before) { log('  nothing to remove.'); return true; }
    if (DRY) { log('  [dry-run] would remove both blocks'); return true; }
    copyFileSync(CODEX_CFG, CODEX_CFG + '.bak');
    writeFileSync(CODEX_CFG, cfg, 'utf8');
    log('  removed (backup at config.toml.bak)');
    return true;
  }

  const need = [];
  if (!cfg.includes(mpHeader)) {
    need.push(
      `\n${mpHeader}\n` +
        (IS_GIT
          ? `source_type = "git"\nsource = ${JSON.stringify(SOURCE)}\n`
          : `source_type = "local"\nsource = ${JSON.stringify(SOURCE)}\n`),
    );
  }
  if (!cfg.includes(plHeader)) need.push(`\n${plHeader}\nenabled = true\n`);

  if (!need.length) { log('  already registered.'); return true; }
  if (DRY) { log('  [dry-run] would append:' + need.join('')); return true; }

  copyFileSync(CODEX_CFG, CODEX_CFG + '.bak');
  // Append at the end of the file: TOML tables are order-independent, and this
  // avoids landing inside someone else's table.
  writeFileSync(CODEX_CFG, cfg.replace(/\s*$/, '\n') + need.join(''), 'utf8');
  log('  registered in ~/.codex/config.toml (backup at config.toml.bak)');
  log('  restart Codex to pick it up.');
  return true;
}

/* ------------------------------------------------------------------- main -- */

log(`ultimate-frontend-skills ${UNINSTALL ? 'uninstall' : 'install'}${DRY ? ' (dry run)' : ''}`);
log(`  source: ${SOURCE}`);
const a = doClaude();
const b = doCodex();
step(a || b ? 'Done.' : 'Nothing was changed.');
if (!UNINSTALL && (a || b)) {
  log('Try it with:  /webdesign a landing page for <subject>');
}
