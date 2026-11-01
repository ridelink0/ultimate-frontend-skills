'use strict';
const test = require('node:test');
const assert = require('node:assert');
const relay = require('../skills/usage-limits/scripts/relay.js');

test('the hand-off asks for two bug passes unless told not to', () => {
  const text = relay.compose({ continuation: 'finish the audit' });
  assert.ok(text.includes('check it for bugs twice'), 'asked for by default');
  assert.ok(text.includes(relay.BUGCHECK_LINE));
  assert.ok(!relay.compose({ continuation: 'x', bugcheck: 'off' }).includes('bugs twice'));
  assert.ok(!relay.compose({ continuation: 'x', bugcheck: false }).includes('bugs twice'));
  assert.ok(relay.compose({ continuation: 'x', bugcheck: 'on' }).includes('bugs twice'));
});

test('the voice card rides in the hand-off when given, and the settings default both on', () => {
  const text = relay.compose({ continuation: 'x', voice: 'Writes like this: short.' });
  assert.ok(text.includes('this is how they write'));
  assert.ok(text.indexOf('bugs twice') < text.indexOf('this is how they write'), 'the bug passes come before the voice card');
  const config = relay.settings({ config: {} });
  assert.strictEqual(config.voice, true);
  assert.strictEqual(config.bugcheck, 'on');
  assert.strictEqual(relay.settings({ config: { voice: false, bugcheck: 'off' } }).voice, false);
  assert.strictEqual(relay.settings({ config: { voice: false, bugcheck: 'off' } }).bugcheck, 'off');
  assert.strictEqual(relay.settings({ config: { bugcheck: 'nonsense' } }).bugcheck, 'on', 'an unknown value falls back');
});
