'use strict';

const test = require('node:test');
const assert = require('node:assert');

const installer = require('../skills/usage-limits/scripts/install-codex-hook.js');

// The installer edits two files a user may already be keeping their own things
// in, so what matters is that it only ever touches its own marked region and
// that running it twice is the same as running it once.

test('the AGENTS.md block is delimited by its own markers', () => {
  const block = installer.agentsBlock();
  assert.ok(block.startsWith(installer.AGENTS_START));
  assert.ok(block.trimEnd().endsWith(installer.AGENTS_END));
  assert.ok(block.indexOf('--host codex') !== -1, 'it names the host outright');
  assert.ok(
    block.indexOf('usage.js') !== -1,
    'it points at the report, not at the hook script, which is not run by hand'
  );
});

test('stripping the block leaves everything else exactly as it was', () => {
  const mine = '# My own notes\n\nAlways prefer pnpm.\n';
  const withBlock = mine + '\n' + installer.agentsBlock() + '\n';
  assert.strictEqual(installer.stripAgents(withBlock).trimEnd(), mine.trimEnd());
});

test('stripping is a no-op when the block is not there', () => {
  const mine = '# Notes\n\nNothing to do with usage.\n';
  assert.strictEqual(installer.stripAgents(mine), mine);
});

test('a block written twice is still one block', () => {
  const once = installer.stripAgents('') + installer.agentsBlock();
  const twice = installer.stripAgents(once + '\n') + installer.agentsBlock();
  const starts = twice.split(installer.AGENTS_START).length - 1;
  const ends = twice.split(installer.AGENTS_END).length - 1;
  assert.strictEqual(starts, 1);
  assert.strictEqual(ends, 1);
});

test('a half-written block is not mistaken for a whole one', () => {
  // An end marker with no start, or the other way round, must not cause a slice
  // that eats the surrounding file.
  const orphanEnd = 'keep me\n' + installer.AGENTS_END + '\nkeep me too\n';
  assert.strictEqual(installer.stripAgents(orphanEnd), orphanEnd);
  const orphanStart = 'keep me\n' + installer.AGENTS_START + '\nkeep me too\n';
  assert.strictEqual(installer.stripAgents(orphanStart), orphanStart);
});

// Codex will not take hooks from a plugin, so the entry is written into its own
// config instead - and it does run them from there: the build measured on this
// machine (ChatGPT extension 26.5903.61454) carries PreToolUse, PostToolUse,
// UserPromptSubmit, SessionStart, SessionEnd, PreCompact and PostCompact, and
// its PostToolUse output takes additionalContext the same way Claude Code's
// does. So an entry has to be recognisable as ours however it was written, in
// order to be replaced rather than duplicated.
test('our hook entries are recognised by the script they run', () => {
  assert.ok(installer.isOurs({ command: 'node "/x/skills/usage-limits/scripts/brief.js" --host codex' }));
  assert.ok(installer.isOurs({ command: 'node "C:\\x\\skills\\usage-limits\\scripts\\pulse.js"' }));
  assert.ok(!installer.isOurs({ command: 'echo someone-elses-hook' }));
  assert.ok(!installer.isOurs({ command: 'node /x/other/brief.js' }));
  assert.ok(!installer.isOurs(null));
  assert.ok(!installer.isOurs({}));
});

test('removing our entries leaves other peoples hooks alone', () => {
  const groups = [
    { hooks: [{ command: 'echo someone-elses-hook' }] },
    { hooks: [{ command: 'node "/x/skills/usage-limits/scripts/brief.js" --host codex' }] },
    {
      hooks: [
        { command: 'node "/x/skills/usage-limits/scripts/pulse.js"' },
        { command: 'echo keep-me' },
      ],
    },
  ];
  const left = installer.withoutOurs(groups);
  const commands = left.flatMap((group) => group.hooks.map((one) => one.command));
  assert.deepStrictEqual(commands, ['echo someone-elses-hook', 'echo keep-me']);
  assert.strictEqual(left.length, 2, 'a group emptied of our hooks is dropped, not left blank');
});

test('the command names an absolute node, not whatever is on PATH', () => {
  // A hook that cannot start is silent: no error, no budget line, nothing to
  // say why. Hooks do not reliably inherit a PATH with node on it.
  const command = installer.command('brief.js');
  assert.ok(command.startsWith('"'), 'the executable is quoted, so a space in it survives');
  assert.ok(command.indexOf(' --host codex') !== -1);
  assert.ok(command.indexOf('\\') === -1, 'forward slashes only, so nothing needs escaping');
});
