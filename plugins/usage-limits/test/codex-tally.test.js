'use strict';

// The end-of-reply and closing cost lines under Codex. Before this, Codex ran
// the plugin's hooks with CLAUDE_PLUGIN_ROOT set, the hooks took that for
// Claude Code, read the rollout with the Claude reader, found no turns, and
// printed nothing: no cost line at the end of a reply or a session.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const tempdirs = require('../tools/test-tempdirs.js');

const SCRIPTS = path.join(__dirname, '..', 'skills', 'usage-limits', 'scripts');
const ROOT = path.join(__dirname, '..');

const row = (type, payload, at) => JSON.stringify({ timestamp: new Date(at).toISOString(), type, payload });
const T0 = Date.parse('2026-11-25T10:00:00.000Z');
const RESET = Math.floor(T0 / 1000) + 3 * 3600;
const WEEK = Math.floor(T0 / 1000) + 5 * 86400;

function meter(fivePct, weekPct) {
  return {
    primary: { used_percent: fivePct, window_minutes: 300, resets_at: RESET },
    secondary: { used_percent: weekPct, window_minutes: 10080, resets_at: WEEK },
  };
}

function tokenCount(at, last, total, rate) {
  return row('event_msg', {
    type: 'token_count',
    info: {
      last_token_usage: last,
      total_token_usage: { input_tokens: 0, output_tokens: 0, total_tokens: total },
    },
    rate_limits: rate,
  }, at);
}

const call = (input, cached, output) => ({
  input_tokens: input, cached_input_tokens: cached, output_tokens: output,
  reasoning_output_tokens: 0, total_tokens: input + output,
});

function sandbox() {
  const dir = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-codex-tally-'));
  const codexHome = path.join(dir, '.codex');
  const sessions = path.join(codexHome, 'sessions', '2026', '11', '25');
  fs.mkdirSync(sessions, { recursive: true });
  const rollout = path.join(sessions, 'rollout-2026-11-25T10-00-00-0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b.jsonl');
  return { dir, codexHome, rollout };
}

function runHook(script, box, input, extraEnv) {
  const env = Object.assign({}, process.env, {
    HOME: box.dir, USERPROFILE: box.dir, CODEX_HOME: box.codexHome,
    CLAUDE_CONFIG_DIR: path.join(box.dir, '.claude'),
    // What Codex sets for a plugin's hooks: both names of the plugin folder.
    PLUGIN_ROOT: ROOT, CLAUDE_PLUGIN_ROOT: ROOT,
  }, extraEnv || {});
  delete env.USAGE_LIMITS_HOST;
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CLAUDECODE;
  return spawnSync(process.execPath, [path.join(SCRIPTS, script)], {
    input: JSON.stringify(input), env, encoding: 'utf8', timeout: 30000,
  });
}

const firstTurn = [
  row('session_meta', { id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', cwd: '/work/shop' }, T0),
  row('turn_context', { model: 'gpt-test', effort: 'medium' }, T0 + 1),
  row('event_msg', { type: 'user_message', message: 'add a cart page' }, T0 + 2),
  tokenCount(T0 + 1000, call(20000, 15000, 1200), 21200, meter(10, 30)),
  // Codex repeats a token_count when only the meter changed: not a turn.
  tokenCount(T0 + 1100, call(20000, 15000, 1200), 21200, meter(11, 30)),
  tokenCount(T0 + 5000, call(26000, 20000, 900), 48100, meter(12, 30)),
];
const secondTurn = [
  row('event_msg', { type: 'user_message', message: 'now the checkout' }, T0 + 60000),
  tokenCount(T0 + 65000, call(30000, 26000, 2000), 80100, meter(15, 31)),
];

test('Stop under Codex prints a cost line, as JSON, from the rollout', () => {
  const box = sandbox();
  fs.writeFileSync(box.rollout, firstTurn.join('\n') + '\n');
  const base = { session_id: 'thread-1', transcript_path: box.rollout, cwd: '/work/shop', hook_event_name: 'Stop', turn_id: 't1', stop_hook_active: false };

  const first = runHook('stop.js', box, base);
  assert.strictEqual(first.status, 0, first.stderr);
  const one = JSON.parse(first.stdout.trim());
  assert.match(one.systemMessage, /This session: 1 prompt, 2 turns/);
  assert.doesNotMatch(one.systemMessage, /\$/, 'no dollar figure for Codex models');

  fs.appendFileSync(box.rollout, secondTurn.join('\n') + '\n');
  const second = runHook('stop.js', box, Object.assign({}, base, { turn_id: 't2' }));
  assert.strictEqual(second.status, 0, second.stderr);
  const two = JSON.parse(second.stdout.trim()).systemMessage;
  assert.match(two, /this reply: 1 turn, 32k tokens; the 5-hour window moved 3 points/);
  assert.match(two, /This session: 2 prompts, 3 turns/);
  // 10 -> 15 on the 5-hour window, 30 -> 31 on the weekly.
  assert.match(two, /the 5-hour window moved 5 points, the weekly window moved 1 point while it ran/);
  assert.match(two, /Context is now about 30k tokens/);
});

test('SessionEnd under Codex closes the session with its total, as JSON', () => {
  const box = sandbox();
  fs.writeFileSync(box.rollout, firstTurn.concat(secondTurn).join('\n') + '\n');
  // SessionEnd carries no turn_id; the rollout's name is what says Codex.
  const result = runHook('sessionend.js', box, { session_id: 'thread-2', transcript_path: box.rollout, cwd: '/work/shop', hook_event_name: 'SessionEnd', reason: 'other' });
  assert.strictEqual(result.status, 0, result.stderr);
  const line = JSON.parse(result.stdout.trim()).systemMessage;
  assert.match(line, /^\[usage-limits\] session closed after/);
  assert.match(line, /2 prompts, 3 turns/);
  // The state lives under Codex's home, not Claude's.
  assert.ok(fs.existsSync(path.join(box.codexHome, 'usage-limits-sessions.json')));
});

test('the plugin ships Codex hooks that name the host and cover the cost lines', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.codex-plugin', 'plugin.json'), 'utf8'));
  assert.strictEqual(manifest.hooks, './hooks/codex-hooks.json');
  const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'codex-hooks.json'), 'utf8')).hooks;
  for (const event of ['UserPromptSubmit', 'PostToolUse', 'PreToolUse', 'Stop', 'SessionEnd']) {
    assert.ok(hooks[event], event + ' is missing');
    for (const group of hooks[event]) {
      for (const one of group.hooks) {
        assert.match(one.command, /--host codex$/);
        const script = /scripts\/([a-z]+\.js)/.exec(one.command)[1];
        assert.ok(fs.existsSync(path.join(SCRIPTS, script)), script);
      }
    }
  }
  assert.ok(hooks.SessionEnd[0].hooks[0].timeout <= 3, 'Codex caps SessionEnd at 3 seconds');
});

test('the user-level Codex install covers Stop and SessionEnd, and defers to the plugin', () => {
  const box = sandbox();
  const env = { HOME: box.dir, USERPROFILE: box.dir, CODEX_HOME: box.codexHome };
  const saved = {};
  for (const key of Object.keys(env)) { saved[key] = process.env[key]; process.env[key] = env[key]; }
  try {
    const modPath = path.join(SCRIPTS, 'install-codex-hook.js');
    delete require.cache[require.resolve(modPath)];
    const installer = require(modPath);
    const events = installer.EVENTS.map((one) => one.event);
    assert.ok(events.includes('Stop') && events.includes('SessionEnd'));

    // Without the plugin: hooks.json gets every event.
    const plain = installer.enable();
    assert.ok(plain.ok, plain.text);
    const written = JSON.parse(fs.readFileSync(path.join(box.codexHome, 'hooks.json'), 'utf8')).hooks;
    assert.ok(written.Stop && written.SessionEnd);
    assert.strictEqual(written.SessionEnd[0].hooks[0].timeout, 3);

    // With the plugin installed and on: the copy in hooks.json comes out.
    fs.mkdirSync(path.join(box.codexHome, 'plugins', 'cache', 'ufs', 'usage-limits', '1.46.0'), { recursive: true });
    const deferred = installer.enable();
    assert.ok(deferred.ok, deferred.text);
    assert.strictEqual(deferred.plugin, 'usage-limits@ufs');
    const after = JSON.parse(fs.readFileSync(path.join(box.codexHome, 'hooks.json'), 'utf8')).hooks;
    assert.ok(!after.Stop && !after.UserPromptSubmit, 'nothing of ours left to run twice');

    // Switched off in config.toml: back to writing hooks.json.
    fs.writeFileSync(path.join(box.codexHome, 'config.toml'), '[plugins."usage-limits@ufs"]\nenabled = false\n');
    const again = installer.enable();
    assert.ok(!again.plugin);
  } finally {
    for (const key of Object.keys(saved)) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
});
