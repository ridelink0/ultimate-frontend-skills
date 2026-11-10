'use strict';

// "Be token efficient": the short rule set the brief adds to the prompt that
// asks for it, so Claude already knows how instead of guessing. Every rule is
// sourced in references/token-efficient.md; keep the two in step.

// Whole words, hyphen or space, either word order of the common phrasings.
// "token efficient", "token-efficiency", "tokens efficiently", "save tokens",
// "fewer tokens", "cheap on tokens". A prompt that only mentions tokens in
// passing ("count the tokens") does not match.
const PHRASE =
  /\btokens?[- ]?(?:efficien(?:t|cy|tly)|thrifty|frugal)\b|\b(?:save|saving|fewer|less|spare|conserve)\s+tokens\b|\bcheap(?:ly)?\s+on\s+tokens\b/i;

const THRIFT_RULES =
  'Token efficiency was asked for: same quality, fewer tokens. ' +
  '(1) Keep the cache prefix stable: do not switch model, effort level or fast mode mid-session, and do not ' +
  'pause past five minutes between steps; cached input bills at a tenth of the fresh rate and each change ' +
  'or lapse rebuilds it. ' +
  '(2) Read ranges, not files: grep or outline first, then read only the lines you need, and never reread ' +
  'what is already in context. ' +
  '(3) Batch independent tool calls into one turn instead of one per turn. ' +
  '(4) Answer short: no preamble, no restated plan, no recap of the diff; give the result and the check you ran. ' +
  'Output bills at five times input, and thinking is output. ' +
  '(5) Use low or medium effort for mechanical work and keep high for decisions that are hard to undo; set it ' +
  'at the start, not mid-session. ' +
  '(6) Keep verbose output out of context: filter test logs to the failures, or send log and doc digging to a ' +
  'subagent on a smaller model that returns a summary. ' +
  '(7) API work that need not answer now goes through the Message Batches API at half price. ' +
  'Quality does not drop: still run the real check before calling it done. ' +
  'Sources: references/token-efficient.md in the usage-limits skill.';

function asksForThrift(prompt) {
  return typeof prompt === 'string' && PHRASE.test(prompt);
}

// Adds the rules to whatever the brief says, or says them alone when the brief
// had nothing new to say this prompt: the ask is per prompt, so the answer is.
function withThrift(text, prompt) {
  if (!asksForThrift(prompt)) return text || '';
  return text ? text + ' ' + THRIFT_RULES : THRIFT_RULES;
}

module.exports = { PHRASE, THRIFT_RULES, asksForThrift, withThrift };
