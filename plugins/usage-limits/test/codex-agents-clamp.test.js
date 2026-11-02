'use strict';

// The [agents] subagent clamp.
//
// This writes into the user's real Codex config, so the round trip has to be
// exact: `off` must leave the file byte-for-byte as `on` found it, and nothing
// here may touch a table the user wrote themselves.

const test = require('node:test');
const assert = require('node:assert');

const low = require('../skills/usage-limits/scripts/codex-lowpower.js');

const BASE = [
  'model = "gpt-6-astra"',
  'approval_policy = "never"',
  'model_reasoning_effort = "xhigh"',
  '',
  '[marketplaces.openai-bundled]',
  'source_type = "local"',
  '',
].join('\n');

function on(text, state, options) {
  return low.plan(text, Object.assign({ command: 'on', effort: 'low' }, options || {}), state || null);
}

test('on appends the clamp and off removes it exactly', () => {
  const applied = on(BASE, null);
  assert.ok(applied.text.includes('[agents]'), 'the clamp table should be written');
  assert.ok(applied.text.includes('max_concurrent_threads_per_session = 1'));
  assert.ok(applied.text.includes('default_subagent_reasoning_effort = "low"'));
  assert.equal(applied.state.agentsClamp, true);
  // The effort edit landed too.
  assert.ok(/^model_reasoning_effort = "low"$/m.test(applied.text));

  const restored = low.plan(applied.text, { command: 'off' }, applied.state);
  assert.equal(restored.state, null);
  assert.ok(!restored.text.includes('[agents]'), 'the clamp must be gone');
  assert.ok(!restored.text.includes(low.AGENTS_START));
  // Byte-for-byte back to where it started.
  assert.equal(restored.text, BASE);
});

test('the appended block never disturbs the top-level line editor', () => {
  // scan() stops at the first table header, so a block appended at the end is
  // invisible to it. If that ever stopped being true, the effort key would be
  // mis-parsed rather than merely un-clamped.
  const applied = on(BASE, null);
  const parsed = low.scan(applied.text);
  assert.ok(parsed.found.model, 'model should still be found');
  assert.ok(parsed.found.model_reasoning_effort, 'effort should still be found');
});

test('a second on does not write the block twice', () => {
  const once = on(BASE, null);
  const twice = on(once.text, once.state);
  const count = twice.text.split('[agents]').length - 1;
  assert.equal(count, 1, 'exactly one [agents] table');
  // And off from there still restores cleanly.
  const restored = low.plan(twice.text, { command: 'off' }, twice.state);
  assert.equal(restored.text, BASE);
});

test("a user's own [agents] table is refused, not overwritten", () => {
  const mine = BASE + '\n[agents]\nmax_concurrent_threads_per_session = 4\n';
  assert.throws(() => on(mine, null), /already has an \[agents\] table/);
  // Refusing means refusing the whole change: nothing partial was returned.
  const dotted = BASE + '\n[agents.overrides]\nfoo = 1\n';
  assert.throws(() => on(dotted, null), /already has an \[agents\] table/);
});

test('--no-agents leaves the table alone entirely', () => {
  const applied = on(BASE, null, { agents: false });
  assert.ok(!applied.text.includes('[agents]'));
  assert.equal(applied.state.agentsClamp, false);
  // The effort clamp still applies; only the subagent half was declined.
  assert.ok(/^model_reasoning_effort = "low"$/m.test(applied.text));
});

test('off removes a stranded block even with no state file', () => {
  // A crash between writing the config and writing the state file would
  // otherwise leave the clamp in place with nothing able to take it out.
  const stranded = BASE + '\n' + low.agentsBlock('\n');
  const restored = low.plan(stranded, { command: 'off' }, null);
  assert.ok(!restored.text.includes('[agents]'));
});

test('CRLF files stay CRLF', () => {
  const crlf = BASE.replace(/\n/g, '\r\n');
  const applied = on(crlf, null);
  assert.ok(applied.text.includes('\r\n[agents]\r\n'), 'the block should use CRLF');
  assert.ok(!/[^\r]\n/.test(applied.text), 'no bare LF should be introduced');
  const restored = low.plan(applied.text, { command: 'off' }, applied.state);
  assert.equal(restored.text, crlf);
});

test('stripAgentsBlock is a no-op on text that has none', () => {
  assert.equal(low.stripAgentsBlock(BASE), BASE);
  assert.equal(low.hasAgentsTable(BASE), false);
  // Our own block does not count as the user's.
  assert.equal(low.hasAgentsTable(BASE + low.agentsBlock('\n')), false);
});

test('an empty config still produces a valid file', () => {
  const applied = on('', null);
  assert.ok(applied.text.includes('[agents]'));
  assert.ok(/^model_reasoning_effort = "low"$/m.test(applied.text));
  const restored = low.plan(applied.text, { command: 'off' }, applied.state);
  assert.equal(restored.text.includes('[agents]'), false);
});
