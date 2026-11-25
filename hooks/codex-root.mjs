#!/usr/bin/env node
/* ultimate-frontend-skills, Codex SessionStart hook.
   The skills and commands write their script paths as ${CLAUDE_PLUGIN_ROOT}.
   Claude Code fills that in; Codex does not, so a command copied from a skill
   ran `node "/scripts/webdesign.mjs"` and failed, and nothing in the plugin
   worked. Codex gives a plugin's hooks the plugin folder as PLUGIN_ROOT, and a
   SessionStart hook's plain output reaches the model, so this says once, at
   the start of the session, which folder to put in its place.
   Prints one short paragraph. Never blocks, never fails the session. */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fromEnv = process.env.PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT || '';
const root = (fromEnv && existsSync(resolve(fromEnv, 'scripts', 'webdesign.mjs')) ? resolve(fromEnv) : here)
  .replace(/\\/g, '/');

// Drain stdin so Codex never sees a broken pipe; the payload is not needed.
process.stdin.on('data', () => {});
process.stdin.on('error', () => {});

process.stdout.write(
  `ultimate-frontend-skills is installed at ${root}. Its skills and commands write ` +
    '`${CLAUDE_PLUGIN_ROOT}` in their commands; Codex leaves that empty, so put ' +
    `${root} in its place every time (for example: node "${root}/scripts/webdesign.mjs" tools). ` +
    `The image-deep-research scripts are in ${root}/skills/image-deep-research/scripts.\n`,
);
process.exit(0);
