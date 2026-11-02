'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const voice = require('../skills/usage-limits/scripts/voice.js');
const host = require('../skills/usage-limits/scripts/host.js');
const tempdirs = require('../tools/test-tempdirs.js');

const NOW = Date.parse('2026-09-08T12:00:00.000Z');

test('voiceFile writes under the Codex home when running as Codex, not ~/.claude', () => {
  const codexDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-voice-codex-'));
  const beforeHost = process.env.USAGE_LIMITS_HOST;
  const beforeCodexHome = process.env.CODEX_HOME;
  const beforeConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.USAGE_LIMITS_HOST = 'codex';
  process.env.CODEX_HOME = codexDir;
  // A Claude-shaped config dir still set alongside it: under Codex this must
  // be ignored, the way every other state-writing script ignores it too.
  process.env.CLAUDE_CONFIG_DIR = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-voice-claude-'));
  try {
    assert.strictEqual(host.detect(process.argv.slice(2), process.env), host.CODEX);
    assert.strictEqual(voice.voiceFile(), path.join(codexDir, 'usage-limits-voice.json'));
  } finally {
    if (beforeHost === undefined) delete process.env.USAGE_LIMITS_HOST;
    else process.env.USAGE_LIMITS_HOST = beforeHost;
    if (beforeCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = beforeCodexHome;
    if (beforeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = beforeConfigDir;
    fs.rmSync(codexDir, { recursive: true, force: true });
  }
});

function withConfigDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-voice-'));
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// A voice built from what somebody actually types, in the shape a chat prompt
// really arrives in: lowercase, unpunctuated, one long clause.
const TYPICAL = [
  'finish the map fix first, then the theme one, i dont mind which order after that',
  'can you check the build again, i think its still failing on the release step',
  'make the widget look exactly like the rideout nearby one, thats the canonical look',
  'also add the badge for the play testers, and dont forget the notification',
  'do it now please, i want ALL of it done this session not tomorrow',
  'the feedback board should always be the website webview, NEVER rebuild it native',
  'check for EVERYTHING, renderclipping overlapping bugs ui and ux fixes',
  'upload the new build to drive and trash the old ones so only the newest is there',
  'i really like how that turned out, keep that style for the rest of it',
  'why does the panel keep flipping between the two efforts, thats a bug',
  'release everything to my github when your done with the whole thing',
  'the login lockout should be thirty minutes, not five, thats too short',
];

function feed(lines) {
  for (const line of lines || TYPICAL) voice.observe(line, NOW);
}

test('speech strips what somebody did not write themselves', () => {
  assert.strictEqual(voice.speech('look at ```const a = 1;``` and fix it'), 'look at and fix it');
  assert.strictEqual(voice.speech('open C:/Users/OWNER/thing.js please'), 'open please');
  assert.strictEqual(voice.speech('see https://example.com/x for it'), 'see for it');
  assert.strictEqual(voice.speech('the `foo` helper'), 'the helper');
});

test('a prompt too short or too long to be speech is not counted', () =>
  withConfigDir(() => {
    assert.strictEqual(voice.observe('ultrathink', NOW), null);
    assert.strictEqual(voice.observe('', NOW), null);
    assert.strictEqual(voice.observe(new Array(600).fill('word').join(' '), NOW), null);
    assert.strictEqual(voice.read().prompts, 0);
  }));

test('below a dozen prompts it says nothing at all', () =>
  withConfigDir(() => {
    feed(TYPICAL.slice(0, 5));
    assert.strictEqual(voice.confidence(voice.read()), 'thin');
    assert.strictEqual(voice.card(), null);
  }));

test('it reads the habits that are choices, not the content', () =>
  withConfigDir(() => {
    feed();
    const card = voice.card();
    assert.match(card, /starts lowercase/);
    assert.match(card, /often no full stop/);
    assert.match(card, /drops the apostrophe/);
    assert.match(card, /CAPITALS for emphasis/);
    assert.match(card, /never emojis/);
    // The whole point of the card: it must not license invented mistakes.
    assert.match(card, /do not add typos/);
    assert.match(card, /caricature/);
  }));

test('capitals are counted per message, so one shouty prompt is not a habit', () =>
  withConfigDir(() => {
    const quiet = TYPICAL.map((line) => line.replace(/[A-Z][A-Z]+/g, (word) => word.toLowerCase()));
    feed(quiet);
    assert.doesNotMatch(String(voice.card()), /CAPITALS/);
  }));

test('at most two short lines of raw text are ever kept', () =>
  withConfigDir(() => {
    feed();
    feed();
    const state = voice.read();
    assert.strictEqual(state.samples.length, voice.KEEP_SAMPLES);
    for (const sample of state.samples) assert.ok(sample.length <= voice.SAMPLE_MAX);
    // Everything else on disk is a number or a count, not a transcript.
    const raw = fs.readFileSync(voice.voiceFile(), 'utf8');
    assert.ok(!raw.includes('renderclipping'), 'an unkept prompt must not survive on disk');
  }));

test('the card carries one real example, because a description is not one', () =>
  withConfigDir(() => {
    feed();
    assert.match(voice.card(), /For example: "/);
    assert.doesNotMatch(String(voice.card({ samples: false })), /For example/);
  }));

test('an instruction the user typed wins and is shown first', () =>
  withConfigDir(() => {
    feed();
    voice.setNote('blunt, lowercase, no preamble');
    const card = voice.card();
    assert.ok(card.startsWith('blunt, lowercase, no preamble'), card);
    // And it speaks even before there is anything learned.
    voice.forget();
    voice.setNote('blunt');
    assert.match(voice.card(), /^blunt/);
  }));

test('learning can be switched off and the profile deleted outright', () =>
  withConfigDir(() => {
    feed();
    const before = voice.read().prompts;
    voice.setMode('off');
    voice.observe('this should not be counted at all, not one bit of it', NOW);
    assert.strictEqual(voice.read().prompts, before);
    voice.forget();
    assert.strictEqual(fs.existsSync(voice.voiceFile()), false);
    assert.strictEqual(voice.read().prompts, 0);
  }));

test('describe shows the kept lines, so nothing is stored the user cannot see', () =>
  withConfigDir(() => {
    feed();
    const text = voice.describe();
    assert.match(text, /prompts seen/);
    assert.match(text, /Kept lines/);
    for (const sample of voice.read().samples) assert.ok(text.includes(sample));
  }));

test('the opener list cannot grow into a log of every prompt', () =>
  withConfigDir(() => {
    for (let i = 0; i < 120; i++) voice.observe('word' + i + ' opening line number ' + i + ' here', NOW);
    assert.ok(Object.keys(voice.read().openers).length <= 60);
  }));

test('the command line reports, sets and forgets', () =>
  withConfigDir(() => {
    feed();
    assert.match(voice.main([]), /prompts seen/);
    assert.match(voice.main(['card']), /Writes like this/);
    assert.match(voice.main(['set', 'be', 'blunt']), /instruction set/);
    assert.match(voice.main(['card']), /^be blunt/);
    assert.match(voice.main(['clear']), /cleared/);
    assert.match(voice.main(['forget']), /deleted/);
  }));
