'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const pulse = require(path.join(__dirname, '..', 'skills', 'usage-limits', 'scripts', 'pulse.js'));

// On 2026-09-07 a 34-agent workflow ran a five-hour window from 28% to 100% in
// sixteen minutes. The pulse fires on the main thread's tool calls, and a
// workflow makes none, so nothing spoke until the limit did. The line before
// the fan-out is the fix.

test('a fan-out is announced even when the budget is roomy', () => {
  const text = pulse.pulseText({ label: '5-hour', percentUsed: 12, turnsLeft: 90, pressure: 'roomy', fanout: true });
  assert.match(text, /^\[usage-limits\] Before this fan-out: 5-hour now 12%, about 90 turns left\./);
  assert.match(text, /Subagents spend this window too/);
  assert.match(text, /Fewer agents with a fresh context/);
});

test('a fan-out on a tight or spent window says how many, or none', () => {
  assert.match(pulse.pulseText({ label: '5-hour', percentUsed: 80, turnsLeft: 9, pressure: 'tight', fanout: true }), /a handful, not dozens/);
  assert.match(pulse.pulseText({ label: '5-hour', percentUsed: 100, turnsLeft: 0, pressure: 'gone', fanout: true }), /do not launch it/);
});

test('the ordinary pulse is unchanged by the flag being absent', () => {
  const text = pulse.pulseText({ label: '5-hour', percentUsed: 40, turnsLeft: 30, pressure: 'tight' });
  assert.match(text, /^\[usage-limits\] 5-hour now 40%, about 30 turns left\. Keep going/);
});

test('the envelope names the event it answers', () => {
  assert.strictEqual(JSON.parse(pulse.envelope('x', 'PreToolUse')).hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.strictEqual(JSON.parse(pulse.envelope('x', 'PostToolUse')).hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.strictEqual(JSON.parse(pulse.envelope('x')).hookSpecificOutput.hookEventName, 'PostToolUse');
});

test('hooks.json wires the pulse to the calls that fan out, and to Bash for a mid-turn reading', () => {
  const hooks = require(path.join(__dirname, '..', 'hooks', 'hooks.json')).hooks;
  assert.ok(Array.isArray(hooks.PreToolUse));
  // Bash rides the same matcher as the fan-out calls, but pulseText's fanout
  // branch is gated on the tool name, not the matcher, so a plain Bash call
  // still gets the ordinary throttled pulse rather than the "before this
  // fan-out" line.
  assert.strictEqual(hooks.PreToolUse[0].matcher, 'Workflow|Agent|Task|Bash');
  assert.match(hooks.PreToolUse[0].hooks[0].command, /pulse\.js/);
});
