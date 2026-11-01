'use strict';

// The VS Code extension, activated against a stand-in for the vscode module.
// It cannot prove the views appear where they should (that needs VS Code), but
// it proves the extension activates, reads the plugin's files, paints the
// status bar and produces a webview page, and never throws on the way.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const build = require('../vscode/build.js');
const tempdirs = require('../tools/test-tempdirs.js');

const root = path.join(__dirname, '..');
const HOUR = 60 * 60 * 1000;

function fakeVscode(record) {
  class ThemeColor {
    constructor(id) {
      this.id = id;
    }
  }
  class MarkdownString {
    constructor() {
      this.value = '';
    }
    appendMarkdown(text) {
      this.value += text;
      return this;
    }
  }
  const item = {
    text: '',
    tooltip: null,
    backgroundColor: undefined,
    shown: false,
    show() {
      this.shown = true;
    },
    hide() {
      this.shown = false;
    },
  };
  record.item = item;
  return {
    StatusBarAlignment: { Right: 2 },
    ThemeColor,
    MarkdownString,
    extensions: { getExtension: () => ({ id: 'anthropic.claude-code' }) },
    commands: {
      executeCommand: (name, key, value) => {
        record.commands.push([name, key, value]);
        return Promise.resolve();
      },
      registerCommand: (name, fn) => {
        record.registered[name] = fn;
        return { dispose() {} };
      },
    },
    window: {
      createStatusBarItem: () => item,
      registerWebviewViewProvider: (id, provider) => {
        record.providers[id] = provider;
        return { dispose() {} };
      },
      onDidChangeWindowState: () => ({ dispose() {} }),
    },
    workspace: {
      getConfiguration: () => ({ get: (key, fallback) => (key === 'fetch' ? false : key === 'statusBar' ? true : fallback) }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
    },
  };
}

test('the extension activates, paints the status bar and renders the view', async () => {
  // Built into a scratch directory, never into vscode/lib. Building into
  // vscode/lib would wipe and rewrite the packaged copy in the middle of the
  // suite, which repairs the staleness vscode-lib-drift.test.js exists to
  // catch and races that test's directory read. The requires below are
  // redirected to this copy instead.
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-vscode-lib-'));
  build.copyScripts(libDir, '0.0.0-test');

  const dir = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-vscode-'));
  const now = Date.now();
  fs.writeFileSync(
    path.join(dir, '.claude.json'),
    JSON.stringify({
      oauthAccount: { accountUuid: 'acc', organizationType: 'claude_max' },
      cachedUsageUtilization: {
        fetchedAtMs: now - 1000,
        accountUuid: 'acc',
        utilization: {
          five_hour: { utilization: 85, resets_at: new Date(now + HOUR).toISOString() },
          seven_day: { utilization: 7, resets_at: new Date(now + 24 * HOUR).toISOString() },
        },
      },
    })
  );
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ model: 'claude-opus-5' }));

  const record = { commands: [], registered: {}, providers: {}, item: null };
  const original = Module._load;
  Module._load = function (request) {
    if (request === 'vscode') return fakeVscode(record);
    // extension.js loads the plugin's scripts as './lib/x.js'. Point those at
    // the scratch build; everything they require of each other then resolves
    // inside it on its own.
    if (request.startsWith('./lib/')) {
      return original.call(this, path.join(libDir, request.slice('./lib/'.length)), arguments[1]);
    }
    return original.apply(this, arguments);
  };
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  const setIntervalOriginal = global.setInterval;
  global.setInterval = () => 0;
  try {
    const extension = require(path.join(root, 'vscode', 'extension.js'));
    const disposables = [];
    extension.activate({ subscriptions: disposables });
    // activate() kicks off the first reading without awaiting it.
    await new Promise((resolve) => setTimeout(resolve, 800));

    assert.deepStrictEqual(record.commands[0], ['setContext', 'claudeUsageLimits.hostPresent', true]);
    assert.deepStrictEqual(record.commands[1], ['setContext', 'claudeUsageLimits.standalone', false]);
    assert.ok(record.providers['claudeUsageLimits.panel'], 'the one view, in the right sidebar');
    assert.ok(!record.providers['claudeUsageLimits.underChat'], 'nothing under the chat any more');
    assert.ok(record.commands.some((c) => c[0] === 'workbench.view.extension.claude-usage-limits'), 'opens itself on startup');
    assert.ok(record.registered['claudeUsageLimits.refresh']);
    assert.match(record.item.text, /5h 85%/);
    assert.match(record.item.text, /wk 7%/);
    assert.strictEqual(record.item.shown, true);
    assert.strictEqual(record.item.backgroundColor.id, 'statusBarItem.warningBackground');
    assert.match(record.item.tooltip.value, /Current session/);
    assert.match(record.item.tooltip.value, /network off/);

    // The webview page: a nonce-bound script, the title, and the palette.
    const posted = [];
    const view = {
      webview: {
        options: null,
        html: '',
        postMessage: (message) => posted.push(message),
        onDidReceiveMessage: (fn) => {
          view.receive = fn;
        },
      },
      onDidDispose: () => {},
    };
    record.providers['claudeUsageLimits.panel'].resolveWebviewView(view);
    assert.match(view.webview.html, /Content-Security-Policy/);
    assert.match(view.webview.html, /Claude usage/);
    assert.match(view.webview.html, /rgb\(80,83,112\)/, 'rate_limit_empty paints the track');
    assert.match(view.webview.html, /rgb\(215,119,87\)/, 'the claude colour paints the title');
    assert.strictEqual(view.webview.options.enableScripts, true);
    view.receive({ type: 'ready' });
    assert.strictEqual(posted[0].type, 'view');
    assert.strictEqual(posted[0].view.rows[0].level, 'warning');
    assert.strictEqual(posted[0].view.rows[0].percentText, '85%');
    assert.strictEqual(posted[0].view.rows[0].colour, 'rgb(255,193,7)', 'a warning row is painted yellow');
    assert.strictEqual(posted[0].view.rows[1].colour, 'rgb(177,185,249)', 'a calm row is rate_limit_fill');

    const prepared = extension.prepare(
      {
        now,
        rows: [{ key: 'five_hour', title: 'Current session', percent: 12, percentText: '12%', level: 'fill', msToReset: HOUR, resetsAtMs: now + HOUR }],
        sessionsList: [{ state: 'working', model: null, lastAt: now }],
        state: 'live',
        ageMs: 5000,
        modelLabel: 'Opus 5',
        effort: 'high',
        working: true,
        fetch: true,
      },
      '24h'
    );
    assert.strictEqual(prepared.sessions[0].model, 'Claude');
    assert.strictEqual(prepared.sessionsSummary, '1 working');
    assert.match(prepared.rows[0].sub, /^resets in 1h at /);
    assert.strictEqual(prepared.freshness, 'live, updated 5s ago');
    assert.strictEqual(extension.short(prepared.rows[0]), '5h 12%');
    for (const disposable of disposables) if (disposable && disposable.dispose) disposable.dispose();
  } finally {
    Module._load = original;
    global.setInterval = setIntervalOriginal;
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
    fs.rmSync(libDir, { recursive: true, force: true });
  }
});
