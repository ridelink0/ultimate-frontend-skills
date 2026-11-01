#!/usr/bin/env node
'use strict';

// Is the network actually usable, and if a run just failed, was the network
// the reason?
//
// This exists because of a real failure. A relay armed overnight woke on time,
// found nothing wrong with itself, started the CLI, and got back
//
//     API Error: Unable to connect to API: SSL certificate hostname mismatch
//
// which is what a laptop says when the wifi is off and something - a captive
// portal, a VPN, a corporate proxy - is answering the TLS handshake in the
// endpoint's place. The relay treated that as a failed run, recorded "failed",
// cleared itself and deleted its own scheduled task. The work was not done, the
// window it had waited for was wide open, and nothing was left to try again.
//
// The rule that follows from it: **a machine that cannot reach the API has not
// failed, it is waiting.** Being offline is a normal state for a laptop at
// three in the morning and it must cost a retry, never the relay.
//
// Nothing here uses a package. `fetch` is in Node 18+, and the only thing that
// matters is telling three cases apart:
//
//   online      the endpoint answered, with anything at all including a 401
//   offline     nothing answered - no DNS, no route, no socket
//   intercepted something answered but it was not the endpoint. This is the
//               nasty one, because a captive portal returns a valid HTTP
//               response and a working TLS session for the wrong certificate,
//               so a naive "did I get bytes back" check says yes.

const MINUTE = 60 * 1000;

// 401 is the correct, healthy answer from an authenticated endpoint hit without
// a key: it proves DNS, routing, TLS and the service. Anything in the 2xx-5xx
// range proves the same thing more loosely. Only a thrown error is offline.
const PROBES = [
  { name: 'api.anthropic.com', url: 'https://api.anthropic.com/v1/models' },
  { name: 'claude.ai', url: 'https://claude.ai/robots.txt' },
  { name: 'github.com', url: 'https://github.com/robots.txt' },
];

// The strings a TLS interception actually produces, across Node, curl and the
// CLIs. Matched case-insensitively against the whole error chain because Node
// buries the real reason in err.cause.
const TLS_INTERCEPTION = /(certificate|self.signed|self_signed|hostname\/ip does not match|hostname mismatch|altname|unable to verify|cert_authority|ERR_TLS|DEPTH_ZERO|CERT_HAS_EXPIRED|UNABLE_TO_GET_ISSUER)/i;

const OFFLINE = /(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ENETDOWN|EPIPE|ETIMEDOUT|ECONNABORTED|socket hang up|network is unreachable|getaddrinfo|fetch failed|Unable to connect|Connection (?:error|closed|reset)|dns)/i;

// Failures that are the service's, not ours, and are worth waiting out rather
// than burning the relay on. A 529 is Anthropic's own overload code.
const TRANSIENT_SERVICE = /(\b429\b|\b500\b|\b502\b|\b503\b|\b504\b|\b529\b|overloaded|rate.?limit|too many requests|temporarily unavailable|service unavailable|internal server error|upstream|gateway|try again|timed? ?out|timeout)/i;

// Failures that will still be failures in five hours. Retrying these is how a
// relay spends a whole window re-running the same refusal.
const PERMANENT = /(\b401\b|\b403\b|invalid.?api.?key|authentication|unauthorized|forbidden|no conversation found|not logged in|please run .?claude .?login|credit balance|billing|quota exceeded|permission denied|ENOENT|command not found|is not recognized)/i;

function chain(err) {
  const seen = [];
  let node = err;
  for (let depth = 0; node && depth < 6; depth++) {
    if (node.message) seen.push(String(node.message));
    if (node.code) seen.push(String(node.code));
    if (node.errno) seen.push(String(node.errno));
    node = node.cause;
  }
  return seen.join(' | ');
}

// One probe. Resolves rather than rejects: a probe that throws is a result.
async function probe(target, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs || 8000));
  const started = Date.now();
  try {
    const response = await fetch(target.url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'manual',
      headers: { 'user-agent': 'usage-limits-relay/1 (connectivity probe)' },
    });
    return { name: target.name, ok: true, status: response.status, ms: Date.now() - started };
  } catch (err) {
    const text = chain(err);
    return {
      name: target.name,
      ok: false,
      ms: Date.now() - started,
      intercepted: TLS_INTERCEPTION.test(text),
      aborted: /abort/i.test(text),
      detail: text.split(' | ')[0] || 'unknown',
    };
  } finally {
    clearTimeout(timer);
  }
}

// The question the wake asks: can this machine reach the service right now.
//
// Probes run together and the first success wins, because one endpoint being
// down is not the same as having no network, and waiting for three timeouts in
// series burns half a minute for an answer the first probe already had.
async function reachable(options) {
  const opts = options || {};
  const timeoutMs = opts.timeoutMs || 8000;
  const targets = opts.targets || PROBES;
  let results = [];
  try {
    results = await Promise.all(targets.map((target) => probe(target, timeoutMs)));
  } catch (err) {
    return { online: false, reason: 'offline', detail: err.message, results: [] };
  }
  const good = results.filter((r) => r.ok);
  if (good.length) {
    return {
      online: true,
      reason: 'ok',
      detail: good.map((r) => r.name + ' ' + r.status + ' in ' + r.ms + 'ms').join(', '),
      results,
    };
  }
  // Nothing answered. Interception is worth naming separately: the fix is not
  // "wait for the network", it is "sign in to the wifi" or "turn the VPN off",
  // and a message that says so saves somebody a morning.
  if (results.some((r) => r.intercepted)) {
    return {
      online: false,
      reason: 'intercepted',
      detail: 'something answered in the endpoint\'s place - a captive portal, a VPN or a TLS-inspecting proxy. ' +
        (results.find((r) => r.intercepted) || {}).detail,
      results,
    };
  }
  return {
    online: false,
    reason: 'offline',
    detail: results.map((r) => r.name + ': ' + (r.aborted ? 'timed out' : r.detail)).join('; '),
    results,
  };
}

// Given the text of a failed run, decide whether trying again later is sensible.
//
//   wait      the network or the service. Retry; do not consume the relay.
//   permanent a key, a login, a missing binary. Retrying wastes the window.
//   unknown   treated as wait once and permanent after that, because an
//             unrecognised error that repeats is not going to fix itself.
function classify(text) {
  const message = String(text || '');
  if (!message.trim()) return { kind: 'unknown', why: 'the run failed without saying why' };
  if (PERMANENT.test(message)) return { kind: 'permanent', why: 'this will still be true after the next reset' };
  if (TLS_INTERCEPTION.test(message)) {
    return {
      kind: 'wait',
      why: 'the TLS handshake did not reach the endpoint - offline, a captive portal, or a VPN in the way',
    };
  }
  if (OFFLINE.test(message)) return { kind: 'wait', why: 'the machine could not reach the network' };
  if (TRANSIENT_SERVICE.test(message)) return { kind: 'wait', why: 'the service was busy or unavailable' };
  return { kind: 'unknown', why: 'an error this has not seen before' };
}

// How long to wait before looking again, given how many times it has already
// looked. Gentle at first because most outages are a router restarting, then
// backing off so an overnight outage is not a thousand wake-ups.
function backoffMinutes(attempt, base) {
  const start = Number.isFinite(base) ? base : 10;
  const steps = [start, start, start * 2, start * 3, start * 6, start * 6];
  return steps[Math.min(Math.max(0, attempt), steps.length - 1)];
}

module.exports = { reachable, probe, classify, backoffMinutes, PROBES, MINUTE };

if (require.main === module) {
  reachable({ timeoutMs: 8000 }).then((result) => {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(result.online ? 0 : 1);
  });
}
