'use strict';

// The reading itself, taken the way Claude Code takes it.
//
// /usage in Claude Code is one GET to Anthropic's usage endpoint with the
// login token Claude Code already holds. This file makes that same call, with
// the same headers and the same timeout, and keeps the answer in a small file
// of its own so the rest of the plugin can read it without going anywhere
// near the network.
//
// Two rules that matter more than anything else here:
//
// - The token is read, used for this one request, and sent nowhere else. It is
//   never written to the live file, never printed, never refreshed or rotated.
//   Refreshing it would race Claude Code's own refresh and could sign the user
//   out; if it has expired the endpoint says 401 and Claude Code fixes it on
//   its next call.
// - Every failure is a kind, not an exception. Offline, signed out, busy and
//   broken all need different waits and different words, and the panel has to
//   keep drawing through all of them.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { execFileSync } = require('child_process');

const atomic = require('./atomic.js');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const BETA = 'oauth-2025-04-20';
// Claude Code gives the call five seconds; so does this.
const DEFAULT_TIMEOUT_MS = 5000;
const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const MAX_BODY = 1024 * 1024;
const MINUTE = 60 * 1000;

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function credentialsFile() {
  return path.join(configDir(), '.credentials.json');
}

function liveFile() {
  return path.join(configDir(), 'usage-limits-live.json');
}

function version() {
  try {
    return require('../../../package.json').version;
  } catch (err) {
    return '0';
  }
}

function userAgent() {
  return 'claude-usage-limits/' + version();
}

function parseCredentials(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const oauth = parsed.claudeAiOauth;
  if (!oauth || typeof oauth !== 'object') return { token: null, expiresAt: null };
  return {
    token: typeof oauth.accessToken === 'string' && oauth.accessToken ? oauth.accessToken : null,
    expiresAt: Number.isFinite(oauth.expiresAt) ? oauth.expiresAt : null,
  };
}

function defaultExec(args) {
  return execFileSync('security', args, {
    encoding: 'utf8',
    timeout: 3000,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

// Where Claude Code keeps the login: a file beside the config directory on
// Windows and Linux, the keychain on macOS. The file is checked first on every
// platform because CLAUDE_CONFIG_DIR installs write it there too.
function readToken(options) {
  const opts = options || {};
  const platform = opts.platform || process.platform;
  const file = opts.file || credentialsFile();

  let raw = null;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code !== 'ENOENT') return { token: null, reason: 'unreadable', detail: err.code };
  }
  if (raw !== null) {
    const parsed = parseCredentials(raw);
    if (!parsed) return { token: null, reason: 'unreadable' };
    if (!parsed.token) return { token: null, reason: 'no_credentials' };
    return { token: parsed.token, expiresAt: parsed.expiresAt, source: 'file' };
  }

  if (platform === 'darwin') {
    // The keychain is a child process each time, so a long-lived panel or the
    // VS Code extension remembers the answer for a few minutes.
    const nowMs = Date.now();
    // Only the real keychain is remembered; an injected reader (the tests)
    // is asked every time.
    const remember = opts.cache !== false && !opts.exec;
    if (remember && keychainMemo && nowMs - keychainMemo.at < KEYCHAIN_MEMO_MS) return keychainMemo.result;
    const exec = opts.exec || defaultExec;
    try {
      const out = exec(['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w']);
      const parsed = parseCredentials(String(out || '').trim());
      if (parsed && parsed.token) {
        const result = { token: parsed.token, expiresAt: parsed.expiresAt, source: 'keychain' };
        if (remember) keychainMemo = { at: nowMs, result };
        return result;
      }
    } catch (err) {
      // No keychain entry, or no permission to read it: same answer as no file.
    }
  }

  return { token: null, reason: 'no_credentials' };
}

let keychainMemo = null;
const KEYCHAIN_MEMO_MS = 5 * MINUTE;

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function isLoopback(hostname) {
  return LOOPBACK.has(String(hostname || '').toLowerCase());
}

// Where the login may be sent: Anthropic over https, or this machine (the
// tests run a stub on a loopback port). A project's settings file can put
// anything into the environment of a hook, and USAGE_LIMITS_USAGE_URL must
// not be a way to walk off with the token.
function allowedUrl(raw) {
  if (!raw) return null;
  let url;
  try {
    url = new URL(String(raw));
  } catch (err) {
    return null;
  }
  if (isLoopback(url.hostname)) return url.toString();
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  if (host === 'anthropic.com' || host.endsWith('.anthropic.com')) return url.toString();
  return null;
}

function bad(kind, status, retryAfterMs, message) {
  return {
    ok: false,
    kind,
    status: Number.isFinite(status) ? status : null,
    retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : null,
    message: message || kind,
  };
}

function retryAfterMs(headers) {
  const value = headers && headers['retry-after'];
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

// Every transport failure is "offline" as far as the panel is concerned: there
// is nothing different to do about a DNS failure and a reset connection.
function classify(err) {
  return 'offline';
}

function fetchUsage(options) {
  const opts = options || {};
  return new Promise((resolve) => {
    if (!opts.token) return resolve(bad('no_credentials', null, null, 'no Claude login found'));

    const permitted = allowedUrl(opts.url || USAGE_URL);
    if (!permitted) {
      return resolve(bad('bad_response', null, null, 'refusing to send the login anywhere but Anthropic over https'));
    }
    const url = new URL(permitted);
    const client = url.protocol === 'http:' ? http : https;
    const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;

    let settled = false;
    const done = (outcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    const req = client.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + opts.token,
          'anthropic-beta': BETA,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': opts.userAgent || userAgent(),
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (body.length < MAX_BODY) body += chunk;
        });
        res.on('error', (err) => done(bad('offline', null, null, (err && err.code) || 'read error')));
        res.on('end', () => {
          const status = res.statusCode;
          if (status === 200) {
            let parsed;
            try {
              parsed = JSON.parse(body);
            } catch (err) {
              return done(bad('bad_response', status, null, 'the usage endpoint did not answer with JSON'));
            }
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              return done(bad('bad_response', status, null, 'the usage endpoint answered with something unexpected'));
            }
            return done({ ok: true, status, utilization: parsed, fetchedAtMs: Date.now() });
          }
          if (status === 401) return done(bad('unauthorized', status, null, 'the login has expired'));
          if (status === 403) return done(bad('forbidden', status, null, 'usage is not available for this login'));
          if (status === 429) {
            return done(bad('rate_limited', status, retryAfterMs(res.headers), 'the usage endpoint is busy'));
          }
          if (status >= 500) return done(bad('server', status, null, 'the usage endpoint returned ' + status));
          return done(bad('http', status, null, 'the usage endpoint returned ' + status));
        });
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', (err) => done(bad(classify(err), null, null, (err && err.code) || (err && err.message) || 'offline')));
    req.end();
  });
}

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

// How long to wait before trying again. The shape matters: offline should be
// retried soon and then less often, a busy server told us exactly how long, a
// login problem is something Claude Code fixes on its own next call, and
// server trouble is not helped by hammering it.
function nextDelayMs(outcome, previousMs, options) {
  const opts = options || {};
  const base = finite(opts.baseMs, 60 * 1000);
  const max = finite(opts.maxMs, 120 * 1000);
  const prev = finite(previousMs, 0);
  if (!outcome || outcome.ok) return base;
  switch (outcome.kind) {
    case 'disabled':
      return max;
    case 'rate_limited':
      return Number.isFinite(outcome.retryAfterMs) && outcome.retryAfterMs > 0
        ? Math.min(Math.max(outcome.retryAfterMs, 1000), 10 * MINUTE)
        : 60 * 1000;
    case 'unauthorized':
    case 'expired':
    case 'forbidden':
    case 'no_credentials':
      return 30 * 1000;
    case 'offline':
      return Math.min(Math.max(5 * 1000, prev * 2), 60 * 1000);
    default:
      return Math.min(Math.max(15 * 1000, prev * 2), 120 * 1000);
  }
}

// A few words for a footer.
function describe(outcome) {
  if (!outcome) return '';
  if (outcome.ok) return 'live';
  switch (outcome.kind) {
    case 'disabled':
      return 'network off';
    case 'offline':
      return 'offline';
    case 'unauthorized':
      return 'sign in to Claude Code again';
    case 'expired':
      return 'login expired, Claude Code renews it on its next call';
    case 'forbidden':
      return 'usage not available for this login';
    case 'no_credentials':
      return 'no Claude login found';
    case 'rate_limited':
      return 'usage endpoint busy';
    default:
      return 'usage endpoint error';
  }
}

function sameAccount(snapshot, accountUuid) {
  return Boolean(snapshot) && (!accountUuid || snapshot.accountUuid === accountUuid);
}

function readLive(options) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(liveFile(), 'utf8'));
  } catch (err) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (!Number.isFinite(parsed.fetchedAtMs)) return null;
  if (!parsed.utilization || typeof parsed.utilization !== 'object') return null;
  if (!sameAccount(parsed, options && options.accountUuid)) return null;
  return parsed;
}

// Through a temporary file named for this process, so a reader never sees
// half a reading and two writers never share a temp file. A rename that fails
// (Windows, with the target held open) is retried, and one that still fails
// leaves nothing behind: see atomic.js.
function writeAtomic(file, text) {
  return atomic.tryWriteFileAtomic(file, text);
}

function writeLive(snapshot) {
  return writeAtomic(liveFile(), JSON.stringify(snapshot));
}

function fetchDisabled(env) {
  return String((env || process.env).USAGE_LIMITS_FETCH || '').toLowerCase() === 'off';
}

// Take a reading and keep it. Whatever goes wrong, the previous reading on
// disk comes back so the caller always has something to draw.
async function refresh(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const previous = () => readLive({ accountUuid: opts.accountUuid });
  if (opts.fetch === false || fetchDisabled(env)) {
    return { outcome: bad('disabled', null, null, 'network use is off'), snapshot: previous() };
  }
  const creds = readToken({ file: opts.credentialsFile, platform: opts.platform, exec: opts.exec, cache: false });
  if (!creds.token) {
    return {
      outcome: bad('no_credentials', null, null, creds.reason === 'unreadable' ? 'the login file could not be read' : 'no Claude login found'),
      snapshot: previous(),
    };
  }
  // A token past its expiry gets a 401 and nothing else. Claude Code renews it
  // on its own next call, so do not send it, and say what is being waited for.
  if (Number.isFinite(creds.expiresAt) && creds.expiresAt < (Number.isFinite(opts.now) ? opts.now : Date.now())) {
    return { outcome: bad('expired', null, null, 'the login has expired; Claude Code renews it on its next call'), snapshot: previous() };
  }
  const outcome = await fetchUsage({
    token: creds.token,
    url: allowedUrl(opts.url || env.USAGE_LIMITS_USAGE_URL) || USAGE_URL,
    timeoutMs: opts.timeoutMs,
  });
  // A sign-in can change while the request is in flight. An answer for the
  // old login must never overwrite the new account's reading.
  const after = readToken({ file: opts.credentialsFile, platform: opts.platform, exec: opts.exec, cache: false });
  if (after.token !== creds.token) return { outcome: bad('account_changed', null, null, 'login changed while reading usage'), snapshot: null };
  if (!outcome.ok) return { outcome, snapshot: previous() };
  const snapshot = {
    fetchedAtMs: Number.isFinite(opts.now) ? opts.now : outcome.fetchedAtMs,
    utilization: outcome.utilization,
    accountUuid: opts.accountUuid || null,
    source: 'api',
  };
  const newer = previous();
  if (newer && newer.fetchedAtMs > snapshot.fetchedAtMs) return { outcome, snapshot: newer };
  writeLive(snapshot);
  return { outcome, snapshot };
}

// When the last attempt was, and how long to leave it. Kept apart from the
// reading so a failed attempt never disturbs a good reading.
function attemptFile() {
  return path.join(configDir(), 'usage-limits-fetch.json');
}

function readAttempt() {
  try {
    const parsed = JSON.parse(fs.readFileSync(attemptFile(), 'utf8'));
    return parsed && Number.isFinite(parsed.attemptedAtMs) ? parsed : null;
  } catch (err) {
    return null;
  }
}

function writeAttempt(record) {
  // Atomic, so a concurrent reader never parses half a record and skips the
  // backoff by accident.
  writeAtomic(attemptFile(), JSON.stringify(record));
}

// A reading only when the one on disk has aged. This is what the hooks call:
// the budget line was once seventeen minutes old while eight agents spent half
// a window in parallel, and the plugin said 42 percent as the wall arrived. A
// reading that is younger than maxAgeMs (from this file or from Claude Code's
// own cache, whichever is newer) is left alone, a failed attempt is not
// repeated until its backoff has passed, and the whole thing is skipped when
// the network is off.
async function refreshIfStale(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const maxAgeMs = Number.isFinite(opts.maxAgeMs) ? opts.maxAgeMs : 3 * MINUTE;
  const current = readLive({ accountUuid: opts.accountUuid });
  const stored = readLive();
  const changedAccount = Boolean(opts.accountUuid && stored && !sameAccount(stored, opts.accountUuid));
  if (opts.fetch === false || fetchDisabled(env)) return { outcome: null, snapshot: current, skipped: 'disabled' };

  const newestAt = Math.max(
    current ? current.fetchedAtMs : 0,
    !changedAccount && Number.isFinite(opts.cacheFetchedAtMs) ? opts.cacheFetchedAtMs : 0
  );
  if (newestAt > 0 && now - newestAt < maxAgeMs) return { outcome: null, snapshot: current, skipped: 'fresh' };

  const heldAttempt = readAttempt();
  const attempt = heldAttempt && (!opts.accountUuid || heldAttempt.accountUuid === opts.accountUuid) ? heldAttempt : null;
  // A record from a clock that was ahead would hold the backoff until the
  // wall clock caught up with it; a minute of skew is all that is honoured.
  const sinceAttempt = attempt ? now - attempt.attemptedAtMs : 0;
  if (attempt && Number.isFinite(attempt.delayMs) && sinceAttempt >= -MINUTE && sinceAttempt < attempt.delayMs) {
    return { outcome: null, snapshot: current, skipped: 'backoff' };
  }

  // Claim the attempt before making it, so the other hooks that fire in the
  // same second (parallel agents, several windows) skip rather than each
  // sending its own request and each waiting out its own timeout.
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  writeAttempt({ attemptedAtMs: now, delayMs: timeoutMs, kind: 'inflight', accountUuid: opts.accountUuid || null });

  const result = await refresh({
    now,
    accountUuid: opts.accountUuid,
    env,
    timeoutMs: opts.timeoutMs,
    url: opts.url,
    credentialsFile: opts.credentialsFile,
  });
  // Do not let an old login's late response impose backoff on the new one.
  if (result.outcome.kind !== 'account_changed') writeAttempt({
    attemptedAtMs: now,
    delayMs: nextDelayMs(result.outcome, attempt && attempt.kind !== 'inflight' ? attempt.delayMs : 0, {
      baseMs: maxAgeMs,
      maxMs: 10 * MINUTE,
    }),
    kind: result.outcome.ok ? 'ok' : result.outcome.kind,
    accountUuid: opts.accountUuid || null,
  });
  return { outcome: result.outcome, snapshot: result.snapshot, skipped: null };
}

module.exports = {
  USAGE_URL,
  BETA,
  DEFAULT_TIMEOUT_MS,
  KEYCHAIN_SERVICE,
  credentialsFile,
  liveFile,
  attemptFile,
  allowedUrl,
  isLoopback,
  writeAtomic,
  userAgent,
  readToken,
  fetchUsage,
  nextDelayMs,
  describe,
  readLive,
  sameAccount,
  writeLive,
  fetchDisabled,
  refresh,
  refreshIfStale,
};
