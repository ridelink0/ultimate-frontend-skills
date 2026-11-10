'use strict';

// Preloaded into every test process (package.json: node --require ... --test).
//
// Host detection reads the environment the agent sets for the processes it
// launches. Run from inside Claude Code, Codex or Antigravity, the suite
// inherited those variables and every test that did not set them itself was
// answered for whichever agent happened to start npm test - 20 failures on a
// machine that runs all three. Tests that want a host say so themselves, so
// the inherited ones are removed here and the suite gives the same result
// whoever runs it, with or without USAGE_LIMITS_HOST.
//
// CLAUDE_CONFIG_DIR stays: it only moves where the files are read, and the
// tests that care set it to a sandbox of their own.

const INHERITED = [
  'USAGE_LIMITS_HOST',
  'CLAUDE_PLUGIN_ROOT',
  'CLAUDE_PROJECT_DIR',
  'CLAUDECODE',
  'CODEX_HOME',
  'CODEX_CLI_PATH',
  'ANTIGRAVITY_CLI',
  'GEMINI_CLI',
  'GEMINI_WORKSPACE',
];

for (const key of INHERITED) delete process.env[key];

module.exports = { INHERITED };
