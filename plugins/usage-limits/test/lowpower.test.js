'use strict';

const test = require('node:test');
const assert = require('node:assert');

const lowpower = require('../skills/usage-limits/scripts/lowpower.js');

test('parseArgs defaults to status', () => {
  assert.strictEqual(lowpower.parseArgs([]).command, 'status');
});

test('parseArgs accepts both flag spellings', () => {
  const spaced = lowpower.parseArgs(['on', '--effort', 'medium', '--model', 'sonnet']);
  assert.deepStrictEqual(
    { command: spaced.command, effort: spaced.effort, model: spaced.model },
    { command: 'on', effort: 'medium', model: 'sonnet' }
  );

  const joined = lowpower.parseArgs(['on', '--effort=low', '--model=haiku', '--dry-run']);
  assert.strictEqual(joined.effort, 'low');
  assert.strictEqual(joined.model, 'haiku');
  assert.strictEqual(joined.dryRun, true);
});

test('capture records an absent key as null so it can be removed later', () => {
  assert.deepStrictEqual(lowpower.capture({ effortLevel: 'xhigh' }), {
    effortLevel: 'xhigh',
    model: null,
  });
});

test('planApply lowers effort and remembers what was there', () => {
  const settings = { effortLevel: 'xhigh', model: 'opus', theme: 'dark' };
  const plan = lowpower.planApply(settings, {}, null);

  assert.strictEqual(plan.settings.effortLevel, 'low');
  assert.strictEqual(plan.settings.theme, 'dark', 'unrelated settings are left alone');
  assert.deepStrictEqual(plan.state.previous, { effortLevel: 'xhigh', model: 'opus' });
  assert.deepStrictEqual(plan.changes, ['effortLevel: xhigh -> low']);
});

test('planApply leaves the model alone unless asked', () => {
  const plan = lowpower.planApply({ effortLevel: 'xhigh', model: 'opus' }, {}, null);
  assert.strictEqual(plan.settings.model, 'opus');

  const swapped = lowpower.planApply(
    { effortLevel: 'xhigh', model: 'opus' },
    { model: 'sonnet' },
    null
  );
  assert.strictEqual(swapped.settings.model, 'sonnet');
  assert.strictEqual(swapped.changes.length, 2);
});

test('planApply run twice keeps the original values', () => {
  const original = { effortLevel: 'xhigh' };
  const first = lowpower.planApply(original, {}, null);
  const second = lowpower.planApply(first.settings, { effort: 'medium' }, first.state);

  assert.deepStrictEqual(
    second.state.previous,
    { effortLevel: 'xhigh', model: null },
    'the second pass must not record low power as the thing to restore'
  );
  assert.strictEqual(second.settings.effortLevel, 'medium');
});

test('planApply rejects an effort level that does not exist', () => {
  assert.throws(() => lowpower.planApply({}, { effort: 'turbo' }, null), /unknown effort/);
});

test("planApply refuses 'max', which settings.json does not accept", () => {
  assert.throws(() => lowpower.planApply({}, { effort: 'max' }, null), /does not accept 'max'/);
});

test('planRestore puts back exactly what was saved', () => {
  const settings = { effortLevel: 'xhigh', model: 'opus', theme: 'dark' };
  const applied = lowpower.planApply(settings, { model: 'haiku' }, null);
  const restored = lowpower.planRestore(applied.settings, applied.state);

  assert.deepStrictEqual(restored.settings, settings);
  assert.strictEqual(restored.restored, true);
});

test('planRestore removes a key that was never set', () => {
  const applied = lowpower.planApply({ theme: 'dark' }, {}, null);
  assert.strictEqual(applied.settings.effortLevel, 'low');

  const restored = lowpower.planRestore(applied.settings, applied.state);
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(restored.settings, 'effortLevel'),
    false
  );
  assert.deepStrictEqual(restored.settings, { theme: 'dark' });
  assert.deepStrictEqual(restored.changes, ['effortLevel: low -> (unset)']);
});

test('planRestore does nothing without saved state', () => {
  const settings = { effortLevel: 'low' };
  const restored = lowpower.planRestore(settings, null);
  assert.strictEqual(restored.restored, false);
  assert.deepStrictEqual(restored.settings, settings);
});

test('planRestore never touches settings outside its own list', () => {
  const settings = { effortLevel: 'low', permissions: { defaultMode: 'default' } };
  const state = { previous: { effortLevel: 'xhigh', model: null } };
  const restored = lowpower.planRestore(settings, state);
  assert.deepStrictEqual(restored.settings.permissions, { defaultMode: 'default' });
});

test('describe reports both states', () => {
  assert.match(lowpower.describe({ effortLevel: 'xhigh' }, null), /Low power {4}off/);
  const state = { savedAt: '2026-08-23T22:00:00.000Z', previous: { effortLevel: 'xhigh', model: null } };
  const text = lowpower.describe({ effortLevel: 'low' }, state);
  assert.match(text, /on since/);
  assert.match(text, /will restore/);
});
