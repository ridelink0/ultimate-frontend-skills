'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const os = require('node:os');

const root = path.join(__dirname, '..', 'skills', 'usage-limits');
const thrift = require(path.join(root, 'scripts', 'thrift.js'));
const brief = require(path.join(root, 'scripts', 'brief.js'));

test('the phrase triggers in its common forms', () => {
  for (const p of [
    'be token efficient',
    'Be token-efficient please',
    'fix the bug, token efficiency matters',
    'work tokens-efficiently',
    'save tokens on this one',
    'use fewer tokens',
    'go cheap on tokens',
    'BE TOKEN EFFICIENT.',
  ]) assert.ok(thrift.asksForThrift(p), p);
});

test('a prompt that only mentions tokens does not trigger', () => {
  for (const p of ['count the tokens in this file', 'tokenize the input', 'efficient token parsing in the lexer', 'the efficiency of tokens', '', null, undefined, 42]) {
    assert.ok(!thrift.asksForThrift(p), String(p));
  }
});

test('the rules cover cache, ranges, batching, short output, effort, verbose output, batches API and quality', () => {
  const r = thrift.THRIFT_RULES;
  for (const w of ['cache prefix', 'Read ranges', 'Batch independent tool calls', 'Answer short', 'effort', 'subagent', 'Message Batches API', 'still run the real check', 'references/token-efficient.md']) {
    assert.ok(r.includes(w), 'missing: ' + w);
  }
  assert.ok(r.length < 1600, 'the rule set must stay short: ' + r.length);
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(r), 'no emoji');
});

test('the reference file exists and cites a primary source for every rule', () => {
  const ref = fs.readFileSync(path.join(root, 'references', 'token-efficient.md'), 'utf8');
  for (let n = 1; n <= 7; n++) assert.match(ref, new RegExp('^\\| ' + n + ' \\|.*\\]\\(https://', 'm'), 'rule ' + n + ' has no linked source');
  for (const u of [
    'https://platform.claude.com/docs/en/build-with-claude/prompt-caching',
    'https://platform.claude.com/docs/en/build-with-claude/effort',
    'https://platform.claude.com/docs/en/build-with-claude/batch-processing',
    'https://platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use',
    'https://code.claude.com/docs/en/costs',
  ]) assert.ok(ref.includes(u), 'missing source ' + u);
  const count = (thrift.THRIFT_RULES.match(/\(\d\)/g) || []).length;
  assert.strictEqual(count, 7, 'rules in thrift.js and rows in the reference must match');
});

test('withThrift appends to the brief, stands alone when the brief is quiet, and is a no-op otherwise', () => {
  assert.strictEqual(thrift.withThrift('the brief', 'be token efficient'), 'the brief ' + thrift.THRIFT_RULES);
  assert.strictEqual(thrift.withThrift('', 'be token efficient'), thrift.THRIFT_RULES);
  assert.strictEqual(thrift.withThrift(undefined, 'save tokens'), thrift.THRIFT_RULES);
  assert.strictEqual(thrift.withThrift('the brief', 'fix the build'), 'the brief');
  assert.strictEqual(thrift.withThrift('', 'fix the build'), '');
  assert.strictEqual(brief.withThriftSafe('x', 'be token efficient'), 'x ' + thrift.THRIFT_RULES);
});

function runHook(input, extraArgs) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ul-thrift-'));
  try {
    const env = Object.assign({}, process.env, {
      CLAUDE_CONFIG_DIR: home,
      HOME: home,
      USERPROFILE: home,
      USAGE_LIMITS_FETCH: 'off',
    });
    return spawnSync(process.execPath, [path.join(root, 'scripts', 'brief.js')].concat(extraArgs || []), {
      input: JSON.stringify(input),
      env,
      encoding: 'utf8',
      timeout: 20000,
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('the UserPromptSubmit hook prints the rules for the phrase and not without it', () => {
  const hit = runHook({ session_id: 'thrift-a', prompt: 'refactor this, and be token efficient', hook_event_name: 'UserPromptSubmit' });
  assert.strictEqual(hit.status, 0, hit.stderr);
  assert.ok(hit.stdout.includes(thrift.THRIFT_RULES), 'rules missing from hook output: ' + hit.stdout.slice(0, 300));
  const miss = runHook({ session_id: 'thrift-b', prompt: 'refactor this', hook_event_name: 'UserPromptSubmit' });
  assert.strictEqual(miss.status, 0, miss.stderr);
  assert.ok(!miss.stdout.includes('Token efficiency was asked for'), 'rules leaked into an unrelated prompt');
});

test('the Gemini hook form carries the rules as an ephemeral message', () => {
  const hit = runHook({ conversationId: 'thrift-g', prompt: 'be token efficient' }, ['--gemini-hook']);
  assert.strictEqual(hit.status, 0, hit.stderr);
  const payload = JSON.parse(hit.stdout.trim().split('\n').pop());
  assert.ok(payload.injectSteps.some((s) => s.ephemeralMessage.includes(thrift.THRIFT_RULES)));
});
