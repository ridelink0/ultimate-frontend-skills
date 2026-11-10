'use strict';
// R8 design (2026-11-10): Claude Code's own continue-at-limit carries an open
// session across the reset in place, so the relay wakes CLOSED sessions only.
// An open session never gets a second window; one that carried on by itself
// raises nothing; one left idle gets exactly one note. The next brief says
// which of those happened, in words.
const test = require('node:test');
const assert = require('node:assert');

const brief = require('../skills/usage-limits/scripts/brief.js');

const base = { binding: { key: 'five_hour', label: '5-hour', percentUsed: 66 }, pressure: 'roomy' };
const withLast = (last) => brief.briefText(Object.assign({}, base, { relay: { last } }));

test('the brief says an open session carried across in place started nothing', () => {
  const text = withLast({ outcome: 'live', detail: 'the session is open in process 4242 and working again; no second window' });
  assert.match(text, /The last relay found this session still open and carried across the previous reset in place, so it started nothing\./);
  assert.doesNotMatch(text, /ended as "live"/);
});

test('the brief says an open idle session got a note and no second window', () => {
  const text = withLast({ outcome: 'open', detail: 'idle' });
  assert.match(text, /The last relay found this session still open but idle after the previous reset, so it opened no second window and left a note\./);
  assert.doesNotMatch(text, /ended as "open"/);
});

test('other outcomes keep their existing wording', () => {
  assert.match(withLast({ outcome: 'notified' }), /left a notification after the previous reset rather than starting anything/);
  assert.match(withLast({ outcome: 'gave-up', detail: 'window still at 90%' }), /ended as "gave-up" - window still at 90%/);
});
