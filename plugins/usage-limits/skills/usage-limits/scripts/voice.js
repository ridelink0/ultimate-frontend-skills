'use strict';

// How the person at the keyboard writes, learned from the prompts they already
// typed, so that text written on their behalf sounds like them.
//
// This exists for one job: when the relay carries a project across a limit
// reset, the prompt that restarts the work is written by the plugin, not by
// the user. A prompt that reads like a form letter produces a reply that reads
// like a form letter. The cheapest way to keep the register is to have watched
// how they actually write.
//
// Three constraints shaped all of it:
//
//   Cheap.   No model call, ever. Counters updated in the prompt hook, a card
//            rendered from those counters. The whole update is microseconds.
//   Private. Nothing leaves the machine, and almost nothing is kept. What is
//            stored is counts, plus at most two short fragments the user can
//            read and delete with one command.
//   Honest.  Style research is clear that a profile from a handful of short
//            messages is noise, so the card says how many prompts it has seen
//            and stays quiet until it has enough to mean something.
//
// One deliberate omission. Misspellings are the most individual thing in
// anyone's writing and the worst thing to put in a prompt: told that someone
// makes mistakes, a model makes mistakes everywhere, and the result is a
// caricature rather than a voice. Only patterns that are choices are recorded -
// dropped apostrophes, lowercase openings, capitals for emphasis - and the card
// says outright not to introduce errors.

const fs = require('fs');
const os = require('os');
const path = require('path');

const host = require('./host.js');
const codex = require('./codex.js');

// Enough for the stable signals - message length, punctuation, openers - to
// stop moving. Short-message authorship work stops gaining accuracy at around
// a hundred and twenty messages, and says very little below a dozen.
const PROVISIONAL = 12;
const SETTLED = 50;

// What is kept of the raw text: two fragments, short, only as long as a chat
// line. Everything else in the file is a number.
const KEEP_SAMPLES = 2;
const SAMPLE_MAX = 140;

// Longer than this is a pasted log or a spec, not the way someone talks, and
// including it would drag every average sideways.
const PROMPT_MAX_WORDS = 400;

const OPENERS_KEPT = 6;

// Every other state-writing script splits on the host so a Codex session
// learns into ~/.codex and a Claude Code one into ~/.claude; this one used to
// hardcode the Claude side, so under Codex the voice profile was written
// somewhere Codex never reads and learned nothing across sessions.
function configDir() {
  return host.detect(process.argv.slice(2), process.env) === host.CODEX
    ? codex.homeDir()
    : process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function voiceFile() {
  return path.join(configDir(), 'usage-limits-voice.json');
}

function empty() {
  return {
    version: 1,
    prompts: 0,
    words: 0,
    updated: null,
    counts: {
      lowercaseStart: 0,
      endsWithStop: 0,
      question: 0,
      exclaim: 0,
      commas: 0,
      capsWords: 0,
      capsMessages: 0,
      contractions: 0,
      apostropheDropped: 0,
      emoji: 0,
      multiSentence: 0,
      runOn: 0,
      hedge: 0,
      imperative: 0,
      firstPerson: 0,
    },
    openers: {},
    samples: [],
    note: null,
    mode: null,
  };
}

function read() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(voiceFile(), 'utf8'));
  } catch (err) {
    return empty();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty();
  const base = empty();
  const state = {
    version: 1,
    prompts: Number.isFinite(parsed.prompts) ? parsed.prompts : 0,
    words: Number.isFinite(parsed.words) ? parsed.words : 0,
    updated: Number.isFinite(parsed.updated) ? parsed.updated : null,
    counts: Object.assign({}, base.counts),
    openers: {},
    samples: Array.isArray(parsed.samples) ? parsed.samples.filter((s) => typeof s === 'string').slice(0, KEEP_SAMPLES) : [],
    note: typeof parsed.note === 'string' ? parsed.note : null,
    mode: typeof parsed.mode === 'string' ? parsed.mode : null,
  };
  if (parsed.counts && typeof parsed.counts === 'object') {
    for (const key of Object.keys(state.counts)) {
      if (Number.isFinite(parsed.counts[key])) state.counts[key] = parsed.counts[key];
    }
  }
  if (parsed.openers && typeof parsed.openers === 'object' && !Array.isArray(parsed.openers)) {
    for (const key of Object.keys(parsed.openers)) {
      if (Number.isFinite(parsed.openers[key])) state.openers[key] = parsed.openers[key];
    }
  }
  return state;
}

function write(state) {
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(voiceFile(), JSON.stringify(state, null, 2) + '\n');
    return true;
  } catch (err) {
    return false;
  }
}

// Slash commands, file paths pasted in, and fenced code are someone else's
// words or a machine's. Strip them before measuring, and if what is left is
// too thin to be a sentence, measure nothing.
function speech(prompt) {
  let text = String(prompt || '');
  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/`[^`\n]*`/g, ' ');
  text = text.replace(/https?:\/\/\S+/g, ' ');
  text = text.replace(/[A-Za-z]:[\\/][^\s"']+/g, ' ');
  text = text.replace(/(^|\s)[~.]{0,2}[\\/][^\s"']{3,}/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

const CONTRACTION = /\b\w+'(?:s|t|re|ve|ll|d|m)\b/gi;
const DROPPED = /\b(?:dont|doesnt|didnt|isnt|arent|wasnt|werent|cant|cannt|wont|couldnt|shouldnt|wouldnt|hasnt|havent|hadnt|im|ive|ill|id|youre|youve|youll|theyre|theyve|thats|whats|whos|theres|heres|its\s+(?:a|the|not|just|been|going|pretty|super)|lets|aint|yall)\b/gi;
// Kept deliberately small and literal. A part-of-speech tagger would be more
// accurate and would also be a dependency and a millisecond budget this does
// not have; in aggregate a fixed lexicon points the same way.
const HEDGE = /\b(?:maybe|perhaps|i think|i guess|kind of|kinda|sort of|sorta|probably|possibly|might|could be|if possible|not sure|somehow|or something|i feel like)\b/gi;
const IMPERATIVE = /^(?:please\s+)?(?:add|make|fix|check|build|do|run|write|change|remove|delete|update|use|put|give|show|find|get|set|keep|try|start|stop|finish|release|push|test|move|rename|open|close|send|create|install|upgrade|refactor|clean|verify)\b/i;
const FIRST_PERSON = /\b(?:i|i'm|im|ive|i've|my|me|mine)\b/i;
// Written as code points rather than as the characters themselves, for two
// reasons: the file stays plain ASCII and cannot be broken by an encoding
// round-trip, and a source file that detects emoji should not contain any.
// The surrogate pairs cover the pictographic planes; the rest is dingbats,
// arrows, and the variation selector that turns a plain glyph into an emoji.
const EMOJI = /[\u203C\u2049\u2600-\u27BF\u2B00-\u2BFF\uFE0F]|[\uD83C-\uD83E][\uDC00-\uDFFF]/g;

function countOf(text, pattern) {
  const found = text.match(pattern);
  return found ? found.length : 0;
}

// A short, typical line: long enough to show a habit, short enough that keeping
// it is not keeping a log. Preferred over a one-word prompt or a paragraph.
function sampleWorth(text, averageWords) {
  const words = text.split(' ').length;
  if (words < 6 || text.length > SAMPLE_MAX) return 0;
  const target = averageWords > 0 ? averageWords : 18;
  return 1 / (1 + Math.abs(words - target) / target);
}

// Fold one prompt into the counters. Never throws and never blocks: this runs
// inside a hook that has to answer in milliseconds.
function observe(prompt, now) {
  const text = speech(prompt);
  if (!text) return null;
  const words = text.split(' ').filter(Boolean);
  if (words.length < 3 || words.length > PROMPT_MAX_WORDS) return null;

  const state = read();
  if (state.mode === 'off') return null;

  const counts = state.counts;
  state.prompts += 1;
  state.words += words.length;
  if (/^[a-z]/.test(text)) counts.lowercaseStart += 1;
  if (/[.!?]$/.test(text)) counts.endsWithStop += 1;
  if (/\?/.test(text)) counts.question += 1;
  if (/!/.test(text)) counts.exclaim += 1;
  counts.commas += countOf(text, /,/g);
  const caps = countOf(text, /\b[A-Z]{2,}\b/g);
  counts.capsWords += caps;
  if (caps) counts.capsMessages += 1;
  counts.contractions += countOf(text, CONTRACTION);
  counts.apostropheDropped += countOf(text, DROPPED);
  counts.emoji += countOf(text, EMOJI);
  const sentences = text.split(/[.!?]+\s/).filter((s) => s.trim().length > 1);
  if (sentences.length > 1) counts.multiSentence += 1;
  // Two or more clauses joined by commas and never closed: the shape of
  // someone thinking out loud rather than drafting.
  if (countOf(text, /,/g) >= 2 && !/[.!?]$/.test(text)) counts.runOn += 1;
  if (HEDGE.test(text)) counts.hedge += 1;
  HEDGE.lastIndex = 0;
  if (IMPERATIVE.test(text)) counts.imperative += 1;
  if (FIRST_PERSON.test(text)) counts.firstPerson += 1;

  const opener = words.slice(0, 2).join(' ').toLowerCase().replace(/[^a-z' ]/g, '').trim();
  if (opener && opener.length > 1) state.openers[opener] = (state.openers[opener] || 0) + 1;
  // Openers are a long tail of things said once. Keep the head; a file that
  // grows a key per prompt is a log by another name.
  const openerKeys = Object.keys(state.openers);
  if (openerKeys.length > 60) {
    const kept = {};
    for (const key of openerKeys.sort((a, b) => state.openers[b] - state.openers[a]).slice(0, 24)) {
      kept[key] = state.openers[key];
    }
    state.openers = kept;
  }

  const average = state.prompts ? state.words / state.prompts : 0;
  const worth = sampleWorth(text, average);
  if (worth > 0) {
    const held = state.samples.map((s) => ({ text: s, worth: sampleWorth(s, average) }));
    held.push({ text, worth });
    held.sort((a, b) => b.worth - a.worth);
    state.samples = [];
    for (const item of held) {
      if (state.samples.length >= KEEP_SAMPLES) break;
      if (!state.samples.includes(item.text)) state.samples.push(item.text);
    }
  }

  state.updated = Number.isFinite(now) ? now : Date.now();
  write(state);
  return state;
}

function pct(part, whole) {
  if (!whole) return 0;
  return (part / whole) * 100;
}

// The traits worth saying out loud, strongest first. Each one is a choice
// somebody makes, phrased so that a reader could follow it.
function traits(state) {
  const n = state.prompts;
  if (!n) return [];
  const counts = state.counts;
  const average = Math.round(state.words / n);
  const out = [];

  out.push('around ' + average + ' words a message');
  if (pct(counts.lowercaseStart, n) >= 40) out.push('starts lowercase');
  if (pct(counts.endsWithStop, n) <= 40) out.push('often no full stop at the end');
  if (counts.commas / n >= 2 && pct(counts.runOn, n) >= 30) out.push('long comma-joined sentences rather than short ones');
  if (pct(counts.apostropheDropped, n) >= 25) out.push("drops the apostrophe in contractions (dont, doesnt, im)");
  // Counted per message, not per word: one prompt shouting three words is
  // one habit, and totals let a single message decide the trait.
  if (pct(counts.capsMessages, n) >= 20) out.push('puts a word in CAPITALS for emphasis');
  if (counts.emoji === 0 && n >= PROVISIONAL) out.push('never emojis');
  else if (counts.emoji / n >= 0.5) out.push('uses emoji');
  if (pct(counts.question, n) >= 50) out.push('asks rather than instructs');
  else if (pct(counts.imperative, n) >= 40) out.push('opens with the verb - do this, fix that');
  if (pct(counts.hedge, n) >= 35) out.push('hedges (maybe, kind of, i think)');
  if (pct(counts.firstPerson, n) >= 50) out.push('speaks in the first person about what they want');
  if (pct(counts.exclaim, n) >= 25) out.push('exclamation marks');

  const openers = Object.keys(state.openers)
    .sort((a, b) => state.openers[b] - state.openers[a])
    .filter((key) => state.openers[key] >= 2)
    .slice(0, OPENERS_KEPT);
  if (openers.length >= 2) out.push('opens with "' + openers.slice(0, 3).join('", "') + '"');
  return out;
}

function confidence(state) {
  if (!state || !state.prompts) return 'none';
  if (state.prompts >= SETTLED) return 'settled';
  if (state.prompts >= PROVISIONAL) return 'provisional';
  return 'thin';
}

// The line that goes into a prompt. Deliberately short: style research finds
// no gain past a few signals, and a long instruction crowds out the work.
//
// `note` is whatever the user typed at /usage-limits:voice set, and it wins
// outright. Being told how to sound beats being guessed at.
function card(state, options) {
  const opts = options || {};
  const held = state || read();
  const parts = [];
  if (held.note) parts.push(held.note);
  const level = confidence(held);
  if (!held.note && level === 'thin') return null;
  if (level !== 'thin') {
    const list = traits(held);
    if (list.length) parts.push('Writes like this: ' + list.join('; ') + '.');
    if (opts.samples !== false && held.samples.length) {
      // One real line does more than any description of one. Style-imitation
      // work is consistent on this: examples beat adjectives.
      parts.push('For example: "' + held.samples[0] + '"');
    }
  }
  if (!parts.length) return null;
  parts.push(
    'Match the register, not the mistakes: do not add typos, and do not exaggerate any of this into a caricature.'
  );
  return parts.join(' ');
}

// What the /usage-limits:voice command prints. Plain, so that "what does it
// know about me" is answered by reading it rather than by trusting a claim.
function describe(state) {
  const held = state || read();
  const lines = [];
  const level = confidence(held);
  lines.push(
    'Voice profile: ' + held.prompts + ' prompt' + (held.prompts === 1 ? '' : 's') + ' seen, ' +
      (level === 'settled' ? 'settled' : level === 'provisional' ? 'provisional - it firms up around ' + SETTLED : 'too thin to use yet - it starts at ' + PROVISIONAL) +
      (held.mode === 'off' ? ', collection is OFF' : '') + '.'
  );
  if (held.note) lines.push('Your instruction: ' + held.note);
  const list = traits(held);
  if (list.length && level !== 'thin') lines.push('Observed: ' + list.join('; ') + '.');
  if (held.samples.length) {
    lines.push('Kept lines (the only raw text stored):');
    for (const sample of held.samples) lines.push('  "' + sample + '"');
  }
  lines.push('File: ' + voiceFile());
  return lines.join('\n');
}

function forget() {
  try {
    fs.unlinkSync(voiceFile());
  } catch (err) {
    // Already gone is the outcome that was asked for.
  }
  return true;
}

function setNote(note) {
  const state = read();
  state.note = note ? String(note).slice(0, 400) : null;
  write(state);
  return state;
}

function setMode(mode) {
  const state = read();
  state.mode = mode === 'off' ? 'off' : null;
  write(state);
  return state;
}

function main(argv) {
  const args = argv || [];
  const command = (args[0] || 'show').toLowerCase();
  if (command === 'show' || command === 'status') return describe();
  if (command === 'card') return card() || 'Not enough prompts yet to describe a voice.';
  if (command === 'forget' || command === 'wipe') {
    forget();
    return 'Voice profile deleted. Nothing of it is left on disk.';
  }
  if (command === 'off') {
    setMode('off');
    return 'Voice learning is off. Existing counts are kept until you run: voice forget';
  }
  if (command === 'on') {
    setMode(null);
    return 'Voice learning is on. It reads only prompts typed in this agent, and stores counts plus at most ' + KEEP_SAMPLES + ' short lines.';
  }
  if (command === 'set') {
    const text = args.slice(1).join(' ');
    if (!text) return 'Give the instruction, for example: voice set "blunt, lowercase, no preamble"';
    setNote(text);
    return 'Voice instruction set. It goes in front of the learned traits whenever the plugin writes as you.';
  }
  if (command === 'clear') {
    setNote(null);
    return 'Voice instruction cleared; the learned traits stand on their own again.';
  }
  return 'usage: voice.js [show|card|set TEXT|clear|off|on|forget]\n\n' + describe();
}

if (require.main === module) {
  try {
    process.stdout.write(main(process.argv.slice(2)) + '\n');
  } catch (err) {
    process.stdout.write('voice: ' + err.message + '\n');
  }
  process.exit(0);
}

module.exports = {
  main,
  PROVISIONAL,
  SETTLED,
  KEEP_SAMPLES,
  SAMPLE_MAX,
  voiceFile,
  empty,
  read,
  write,
  speech,
  observe,
  traits,
  confidence,
  card,
  describe,
  forget,
  setNote,
  setMode,
};
