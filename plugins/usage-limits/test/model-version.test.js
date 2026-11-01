'use strict';

// The plugin was version-blind (found 2026-09-25). Three things, all tested
// here:
//
//   1. Opus 5.5 was not in the price table, so it was priced at the Opus
//      family average of $5/$25 with reads at a tenth of that - 25% over on
//      input and output and double on cache reads, which it prices outright at
//      $0.20 (0.05x input; platform.claude.com/docs/en/about-claude/pricing).
//   2. The tier line showed the family only, so claude-opus-5 and
//      claude-opus-5-5 both printed "opus" and a switch between them was
//      invisible.
//   3. The advice only ever said "choose lower". A newer model of the same
//      family at a lower price is a saving with no step down, and it was never
//      mentioned.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPTS = path.join(__dirname, '..', 'skills', 'usage-limits', 'scripts');
const usage = require(path.join(SCRIPTS, 'usage.js'));
const mode = require(path.join(SCRIPTS, 'mode.js'));
const brief = require(path.join(SCRIPTS, 'brief.js'));
const tempdirs = require('../tools/test-tempdirs.js');

const HOUR = 60 * 60 * 1000;

test('Opus 5.5 is priced from its own row: $4 in, $20 out, $0.20 cache reads', () => {
  assert.deepStrictEqual(usage.rateFor('claude-opus-5-5'), { input: 4, output: 20, cacheRead: 0.2 });
  assert.deepStrictEqual(usage.rateFor('claude-opus-5-5[1m]'), usage.rateFor('claude-opus-5-5'));
  assert.strictEqual(usage.isKnownModel('claude-opus-5-5'), true);
  // A million cache-read tokens: $0.20 on 5.5, $0.50 on 5. The tenth rule would
  // have said $0.40 for 5.5, double the published price.
  assert.strictEqual(usage.costOf({ cache_read_input_tokens: 1e6 }, 'claude-opus-5-5'), 0.2);
  assert.strictEqual(usage.costOf({ cache_read_input_tokens: 1e6 }, 'claude-opus-5'), 0.5);
  // Writes keep the standard multipliers on the $4 input: 1.25x and 2x.
  const writes = usage.costOf(
    { cache_creation: { ephemeral_5m_input_tokens: 1e6, ephemeral_1h_input_tokens: 1e6 } },
    'claude-opus-5-5'
  );
  assert.strictEqual(writes, 5 + 8);
  assert.strictEqual(usage.costOf({ input_tokens: 1e6, output_tokens: 1e6 }, 'claude-opus-5-5'), 24);
});

test('model ids come apart into family and version; a bare alias has no version', () => {
  assert.deepStrictEqual(usage.parseModelId('claude-opus-5-5'), { family: 'opus', version: [5, 5] });
  assert.deepStrictEqual(usage.parseModelId('claude-opus-5'), { family: 'opus', version: [5] });
  assert.deepStrictEqual(usage.parseModelId('claude-opus-5-5[1m]'), { family: 'opus', version: [5, 5] });
  assert.deepStrictEqual(usage.parseModelId('us.anthropic.claude-opus-5-v1:0'), { family: 'opus', version: [5] });
  assert.deepStrictEqual(usage.parseModelId('claude-sonnet-4-5-20250929'), { family: 'sonnet', version: [4, 5] });
  assert.deepStrictEqual(usage.parseModelId('opus'), { family: 'opus', version: [] });
  assert.deepStrictEqual(usage.parseModelId('claude-mythos-5-1'), { family: 'mythos', version: [5, 1] });
  assert.strictEqual(usage.parseModelId('gpt-6-astra'), null);
  assert.strictEqual(usage.parseModelId(null), null);
});

test('Sonnet 5.5 is priced from the table, not the family average', () => {
  assert.strictEqual(usage.isKnownModel('claude-sonnet-5-5'), true);
  assert.deepStrictEqual(usage.rateFor('claude-sonnet-5-5'), { input: 2, output: 10 });
  assert.deepStrictEqual(usage.rateFor('claude-sonnet-5-5[1m]'), usage.rateFor('claude-sonnet-5-5'));
  assert.strictEqual(usage.costOf({ input_tokens: 1e6, output_tokens: 1e6 }, 'claude-sonnet-5-5'), 12);
  assert.ok(Math.abs(usage.costOf({ cache_read_input_tokens: 1e6 }, 'claude-sonnet-5-5') - 0.2) < 1e-12);
  assert.deepStrictEqual(usage.parseModelId('claude-sonnet-5-5'), { family: 'sonnet', version: [5, 5] });
});

test('the newer sibling is same family, newer, no dearer on any rate, and cheaper on one', () => {
  const opus5 = usage.newerSibling('claude-opus-5');
  assert.ok(opus5);
  assert.strictEqual(opus5.to, 'claude-opus-5-5');
  assert.deepStrictEqual(opus5.fromRate, { input: 5, output: 25, cacheRead: 0.5 });
  assert.deepStrictEqual(opus5.toRate, { input: 4, output: 20, cacheRead: 0.2 });
  assert.strictEqual(usage.newerSibling('claude-opus-4-8').to, 'claude-opus-5-5');
  assert.strictEqual(usage.newerSibling('us.anthropic.claude-opus-5-v1:0').to, 'claude-opus-5-5');
  // Fable 5 to 5.1 prices input and output the same and reads at a quarter.
  assert.strictEqual(usage.newerSibling('claude-fable-5').to, 'claude-fable-5-1');
  // Mythos stays in its own line: it is priced with Fable, it is not Fable.
  assert.strictEqual(usage.newerSibling('claude-mythos-5').to, 'claude-mythos-5-1');
  // Already the newest, or nothing cheaper beside it.
  assert.strictEqual(usage.newerSibling('claude-opus-5-5'), null);
  assert.strictEqual(usage.newerSibling('claude-fable-5-1'), null);
  assert.strictEqual(usage.newerSibling('claude-haiku-4-5'), null);
  // Across the tokenizer change at 4.7 a per-token price is not like for like,
  // so Sonnet 4.6 is not told Sonnet 5 is cheaper and Opus 4.6 is not pointed
  // at 5.5.
  assert.strictEqual(usage.newerSibling('claude-sonnet-4-6'), null);
  // Sonnet 5.5 prices every rate the same as Sonnet 5, so it is not cheaper.
  assert.strictEqual(usage.newerSibling('claude-sonnet-5'), null);
  assert.strictEqual(usage.newerSibling('claude-opus-4-6'), null);
  // A bare alias names no release, and a model with no row of its own is not
  // compared against a guess.
  assert.strictEqual(usage.newerSibling('opus'), null);
  assert.strictEqual(usage.newerSibling('claude-opus-4-5'), null);
  assert.strictEqual(usage.newerSibling(null), null);
});

test('the tier line shows the version, and a 5 to 5.5 gap is a gap', () => {
  const running55 = mode.tierLine({
    baseline: { model: 'opus', effort: 'xhigh' },
    running: { model: 'claude-opus-5-5', effort: 'xhigh', source: 'this turn' },
  });
  assert.match(running55, /^Running opus 5\.5\/xhigh \(this turn\)\./);
  // A bare alias says nothing about which Opus, so it disagrees with none.
  assert.strictEqual(running55.indexOf('baseline'), -1);

  const behind = mode.tierLine({
    baseline: { model: 'claude-opus-5-5', effort: 'xhigh' },
    running: { model: 'claude-opus-5', effort: 'xhigh', source: 'settings' },
  });
  assert.match(behind, /Running opus 5\/xhigh \(settings\); your baseline is opus 5\.5\/xhigh\./);

  const same = mode.tierLine(
    { baseline: { model: 'claude-opus-5-5', effort: 'xhigh' }, running: { model: 'claude-opus-5-5[1m]', effort: 'xhigh', source: 'this turn' } },
    { terse: true }
  );
  assert.strictEqual(same, 'opus 5.5/xhigh (this turn)');

  assert.strictEqual(mode.modelLabel('claude-opus-5-5'), 'opus 5.5');
  assert.strictEqual(mode.modelLabel('claude-sonnet-4-5-20250929'), 'sonnet 4.5');
  assert.strictEqual(mode.modelLabel('opus'), 'opus');
  assert.strictEqual(mode.modelLabel('gpt-6-astra'), 'gpt-6-astra');
  assert.strictEqual(mode.modelLabel(null), null);
  assert.strictEqual(mode.sameModel('claude-opus-5', 'claude-opus-5-5'), false);
  assert.strictEqual(mode.sameModel('opus', 'claude-opus-5-5'), true);
  assert.strictEqual(mode.sameModel('claude-sonnet-5', 'claude-opus-5'), false);
});

test('the newer-model advice names /model in Claude Code and never outside it', () => {
  const tier = { baseline: { model: 'opus', effort: 'xhigh' }, running: { model: 'claude-opus-5', effort: 'xhigh' } };
  const claude = mode.newerModelAdvice(tier, { host: 'claude' });
  assert.strictEqual(claude.id, 'claude-opus-5->claude-opus-5-5');
  assert.match(claude.text, /^Opus 5\.5 is a newer Opus at a lower price than the Opus 5 running here\./);
  assert.match(claude.text, /\$4\/\$20 per million tokens in and out against \$5\/\$25/);
  assert.match(claude.text, /cache reads \$0\.20 against \$0\.50, 60% less/);
  assert.match(claude.text, /offer `\/model claude-opus-5-5`, which moves this session and saves it as the default for new sessions\./);
  assert.match(claude.text, /Subagents given no model of their own/);
  // (1.25 x $4 - $0.50) / ($0.50 - $0.20) = 15; (2 x $4 - $0.50) / $0.30 = 25.
  assert.match(claude.text, /repay that in about 15 turns \(25 on the one-hour cache\)/);
  assert.doesNotMatch(claude.text, /settings\.json already names it/);

  const pinned = mode.newerModelAdvice({ baseline: { model: 'claude-opus-5-5' }, running: { model: 'claude-opus-5' } }, { host: 'claude' });
  assert.match(pinned.text, /settings\.json already names it/);

  for (const where of ['codex', 'gemini']) {
    const text = mode.newerModelAdvice(tier, { host: where }).text;
    assert.doesNotMatch(text, /\/model/, where + ' has no /model to offer: ' + text);
    assert.doesNotMatch(text, /Subagents/, where);
    assert.doesNotMatch(text, /repay/, where + ' is offered a pin for new sessions only');
  }
  assert.match(mode.newerModelAdvice(tier, { host: 'codex' }).text, /model = "claude-opus-5-5" in config\.toml/);

  // Nothing to say on the newest model, on a bare alias with no reading, or
  // with no tier at all.
  assert.strictEqual(mode.newerModelAdvice({ baseline: {}, running: { model: 'claude-opus-5-5' } }), null);
  assert.strictEqual(mode.newerModelAdvice({ baseline: { model: 'opus' }, running: {} }), null);
  assert.strictEqual(mode.newerModelAdvice(null), null);
  // A ceiling the user set below Opus is never pointed past, even at a cheaper
  // Opus; a ceiling at or above it does not stop the offer.
  const capped = { floor: null, ceiling: { model: 'sonnet', effort: null }, pin: false };
  assert.strictEqual(mode.newerModelAdvice(tier, { host: 'claude', bounds: capped }), null);
  const roomy = { floor: null, ceiling: { model: 'fable', effort: null }, pin: false };
  assert.ok(mode.newerModelAdvice(tier, { host: 'claude', bounds: roomy }));
  // A baseline that names a release is used when nothing has answered yet.
  assert.strictEqual(mode.newerModelAdvice({ baseline: { model: 'claude-opus-5' }, running: {} }).to, 'claude-opus-5-5');
});

function transcript(dir, model) {
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(
    file,
    [
      JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: 'hi' } }),
      JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { model, role: 'assistant', content: [], usage: { input_tokens: 10, output_tokens: 10 } } }),
    ].join('\n') + '\n'
  );
  return file;
}

test('the running model is read from the hook\'s own transcript before the session-id lookup', () => {
  const dir = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-modelver-'));
  const file = transcript(dir, 'claude-opus-5');
  const stub = {
    effortNow: () => ({ effort: 'xhigh', source: 'settings' }),
    collect: () => ({ settings: { model: 'opus', effortLevel: 'xhigh' } }),
    liveModel: () => ({ model: 'claude-haiku-4-5' }),
    transcriptModel: usage.transcriptModel,
  };
  const env = {};
  const tier = mode.tierNow({ env, usage: stub, sessionId: 's', transcriptPath: file });
  assert.strictEqual(tier.running.model, 'claude-opus-5');
  // No path, or a path with nothing in it: the session-id lookup still answers.
  assert.strictEqual(mode.tierNow({ env, usage: stub, sessionId: 's' }).running.model, 'claude-haiku-4-5');
  assert.strictEqual(mode.tierNow({ env, usage: stub, sessionId: 's', transcriptPath: path.join(dir, 'none.jsonl') }).running.model, 'claude-haiku-4-5');
  // An older usage object without transcriptModel is not an exception.
  const older = Object.assign({}, stub);
  delete older.transcriptModel;
  assert.strictEqual(mode.tierNow({ env, usage: older, sessionId: 's', transcriptPath: file }).running.model, 'claude-haiku-4-5');
});

function withSandbox(fn) {
  const dir = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-modelver-'));
  const codexHome = path.join(dir, 'codex');
  fs.mkdirSync(codexHome);
  const now = Date.now();
  fs.writeFileSync(
    path.join(dir, '.claude.json'),
    JSON.stringify({
      oauthAccount: { accountUuid: 'acc', organizationType: 'claude_max' },
      cachedUsageUtilization: {
        fetchedAtMs: now - 60 * 1000,
        accountUuid: 'acc',
        utilization: {
          five_hour: { utilization: 12, resets_at: new Date(now + 2 * HOUR).toISOString() },
          seven_day: { utilization: 20, resets_at: new Date(now + 72 * HOUR).toISOString() },
        },
      },
    })
  );
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ model: 'opus', effortLevel: 'xhigh' }));
  const keys = ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'USAGE_LIMITS_FETCH', 'USAGE_LIMITS_RELAY', 'USAGE_LIMITS_HOST', 'USAGE_LIMITS_MODE', 'CLAUDE_EFFORT'];
  const saved = {};
  for (const key of keys) saved[key] = process.env[key];
  process.env.CLAUDE_CONFIG_DIR = dir;
  process.env.CODEX_HOME = codexHome;
  process.env.USAGE_LIMITS_FETCH = 'off';
  // The relay stays off: arming one registers a real, machine-wide scheduled
  // task whatever the config directory says.
  process.env.USAGE_LIMITS_RELAY = 'off';
  process.env.USAGE_LIMITS_HOST = 'claude';
  delete process.env.USAGE_LIMITS_MODE;
  delete process.env.CLAUDE_EFFORT;
  const restore = () => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };
  return Promise.resolve()
    .then(() => fn(dir, now))
    .then(
      (value) => {
        restore();
        return value;
      },
      (err) => {
        restore();
        throw err;
      }
    );
}

test('the brief names the running version and says the newer, cheaper sibling once a session', () =>
  withSandbox(async (dir, now) => {
    const file = transcript(dir, 'claude-opus-5');
    const input = { session_id: 'mv-1', prompt: 'hello', cwd: dir, transcript_path: file };
    const first = await brief.run(now, input);
    assert.match(first, /Running opus 5\/xhigh/, first);
    assert.match(first, /Opus 5\.5 is a newer Opus at a lower price than the Opus 5 running here/, first);
    assert.match(first, /`\/model claude-opus-5-5`/, first);

    // Said once: the next brief in the same session still names the version
    // but not the advice. The digest cache is cleared so the brief is not
    // suppressed for having nothing new to say.
    fs.rmSync(path.join(dir, 'usage-limits-brief.json'), { force: true });
    const second = await brief.run(now + 60 * 1000, input);
    assert.match(second, /Running opus 5\/xhigh/, second);
    assert.doesNotMatch(second, /is a newer Opus/, second);

    // Once a session, not once ever: another session hears it.
    fs.rmSync(path.join(dir, 'usage-limits-brief.json'), { force: true });
    const other = await brief.run(now + 2 * 60 * 1000, Object.assign({}, input, { session_id: 'mv-2' }));
    assert.match(other, /is a newer Opus/, other);

    // On the newer model there is nothing to offer.
    fs.rmSync(path.join(dir, 'usage-limits-brief.json'), { force: true });
    const newer = transcript(dir, 'claude-opus-5-5');
    const onNewest = await brief.run(now + 3 * 60 * 1000, Object.assign({}, input, { session_id: 'mv-3', transcript_path: newer }));
    assert.match(onNewest, /Running opus 5\.5\/xhigh/, onNewest);
    assert.doesNotMatch(onNewest, /is a newer/, onNewest);
  }));

test('a relay pinned to the older model is named, because a wake passes its own --model', () => {
  // Session and relay both on Opus 5: one offer for the session, and the relay
  // pin named beside it without repeating the prices.
  const both = mode.newerModelAdvice(
    { baseline: { model: 'opus' }, running: { model: 'claude-opus-5' } },
    { host: 'claude', relayModel: 'claude-opus-5' }
  );
  assert.strictEqual(both.id, 'claude-opus-5->claude-opus-5-5|relay:claude-opus-5->claude-opus-5-5');
  assert.match(both.text, /Relay wakes are pinned to claude-opus-5 on their own, so a resumed run starts on the older model/);
  assert.match(both.text, /`\/usage-limits:relay model claude-opus-5-5`/);
  assert.strictEqual(both.text.match(/\$4\/\$20/g).length, 1, 'the prices are said once');

  // The session already moved but the relay did not: the relay alone is news.
  const relayOnly = mode.newerModelAdvice(
    { baseline: { model: 'claude-opus-5-5' }, running: { model: 'claude-opus-5-5' } },
    { host: 'claude', relayModel: 'claude-opus-5' }
  );
  assert.strictEqual(relayOnly.id, '|relay:claude-opus-5->claude-opus-5-5');
  assert.match(relayOnly.text, /^Relay wakes are pinned to claude-opus-5 on their own, and Opus 5\.5 is a newer Opus at a lower price \(\$4\/\$20/);
  assert.doesNotMatch(relayOnly.text, /`\/model /);

  // Nothing to say when the relay is on the newest, on the default, or outside Claude Code.
  const onNewest = { baseline: {}, running: { model: 'claude-opus-5-5' } };
  assert.strictEqual(mode.newerModelAdvice(onNewest, { host: 'claude', relayModel: 'claude-opus-5-5' }), null);
  assert.strictEqual(mode.newerModelAdvice(onNewest, { host: 'claude', relayModel: null }), null);
  assert.strictEqual(mode.newerModelAdvice(onNewest, { host: 'codex', relayModel: 'claude-opus-5' }), null);
});

test('the brief reads the relay pin from the relay\'s own settings', () =>
  withSandbox(async (dir, now) => {
    const relay = require(path.join(SCRIPTS, 'relay.js'));
    relay.configure({ model: 'claude-opus-5' });
    const file = transcript(dir, 'claude-opus-5-5');
    const text = await brief.run(now, { session_id: 'mv-relay', prompt: 'hello', cwd: dir, transcript_path: file });
    assert.match(text, /Running opus 5\.5\/xhigh/, text);
    assert.match(text, /Relay wakes are pinned to claude-opus-5 on their own/, text);
    // Nothing was armed: the pin is read, never acted on.
    assert.strictEqual(relay.read().armed, null);
  }));

test('muted advice mutes the newer-model sentence too', () =>
  withSandbox(async (dir, now) => {
    assert.ok(mode.adviceMute(true));
    const file = transcript(dir, 'claude-opus-5');
    const text = await brief.run(now, { session_id: 'mv-mute', prompt: 'hello', cwd: dir, transcript_path: file });
    assert.match(text, /Running opus 5\/xhigh/, text);
    assert.doesNotMatch(text, /is a newer Opus/, text);
  }));

test('newerModelFor says a pair once per session and a different pair again', () =>
  withSandbox(async (dir, now) => {
    const a = { id: 'claude-opus-5->claude-opus-5-5', text: 'A' };
    const b = { id: 'claude-fable-5->claude-fable-5-1', text: 'B' };
    assert.strictEqual(brief.newerModelFor('s', a, now), 'A');
    assert.strictEqual(brief.newerModelFor('s', a, now + HOUR), null, 'still the same session an hour later');
    assert.strictEqual(brief.newerModelFor('s', b, now + HOUR), 'B');
    assert.strictEqual(brief.newerModelFor('t', a, now + HOUR), 'A');
    assert.strictEqual(brief.newerModelFor('s', null, now), null);
  }));
