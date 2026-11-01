'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const usage = require('../skills/usage-limits/scripts/usage.js');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-09-01T10:00:00.000Z');
const SESSION = 'sess-wire';

function line(at, model) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: new Date(at).toISOString(),
    requestId: 'req_' + at + model,
    sessionId: SESSION,
    message: {
      id: 'msg_' + at + model,
      model,
      usage: { input_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 100 },
    },
  });
}

function harness(settingsModel, transcriptModels) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-wire-'));
  fs.writeFileSync(
    path.join(dir, '.claude.json'),
    JSON.stringify({
      oauthAccount: { organizationType: 'claude_max', userRateLimitTier: 'default_claude_max_5x' },
      cachedUsageUtilization: {
        fetchedAtMs: NOW - MINUTE,
        utilization: {
          five_hour: { utilization: 10, resets_at: new Date(NOW + 4 * HOUR).toISOString() },
          seven_day: { utilization: 5, resets_at: new Date(NOW + 6 * DAY).toISOString() },
          limits: [
            {
              kind: 'weekly_scoped',
              percent: 88,
              resets_at: new Date(NOW + 6 * DAY).toISOString(),
              is_active: true,
              scope: { model: { id: null, display_name: 'Fable' } },
            },
          ],
        },
      },
    })
  );
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ model: settingsModel }));
  const project = path.join(dir, 'projects', 'C--proj');
  fs.mkdirSync(project, { recursive: true });
  const lines = (transcriptModels || []).map((m, i) => line(NOW - (30 - i) * MINUTE, m));
  fs.writeFileSync(path.join(project, SESSION + '.jsonl'), lines.join('\n') + (lines.length ? '\n' : ''));
  return dir;
}

async function reportIn(dir) {
  const previous = process.env.CLAUDE_CONFIG_DIR;
  const prevModel = process.env.ANTHROPIC_MODEL;
  process.env.CLAUDE_CONFIG_DIR = dir;
  delete process.env.ANTHROPIC_MODEL;
  usage.setHost('claude');
  try {
    return await usage.report(NOW, { sessionId: SESSION });
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
    if (prevModel !== undefined) process.env.ANTHROPIC_MODEL = prevModel;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('report marks a scoped weekly the session cannot spend into', async () => {
  const data = await reportIn(harness('opus', ['claude-opus-5']));
  const fable = data.windows.find((w) => w.key === 'seven_day_scoped:fable');
  assert.ok(fable, 'the scoped weekly is listed');
  assert.strictEqual(fable.applies, false, 'an Opus session cannot spend into a Fable weekly');
  assert.strictEqual(data.binding.key !== 'seven_day_scoped:fable', true, 'and it is not binding');
  assert.match(usage.render(data), /not in use/);
});

test('report counts the models this session actually ran, not just the setting', async () => {
  const data = await reportIn(harness('opus', ['claude-opus-5', 'claude-fable-5']));
  const fable = data.windows.find((w) => w.key === 'seven_day_scoped:fable');
  assert.strictEqual(fable.applies, true, 'a Fable turn in this session makes the Fable weekly bite');
});
