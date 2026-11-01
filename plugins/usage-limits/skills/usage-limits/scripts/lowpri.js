'use strict';

// Claude Code's own features at the usage wall, as far as a hook can read them.
//
// There are five of them and they are not equally knowable, so this module
// exists mostly to keep the difference straight. Everything here was verified
// against the installed CLI on 2026-09-25 (@anthropic-ai/claude-code 2.1.283,
// C:/Users/OWNER/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code).
//
//   /low-priority - a hidden toggle offered when the 5-hour session limit is
//   reached: it keeps the session running at lower priority and spends the
//   WEEKLY limit, plus a separate weekly lower-priority allowance. Whether the
//   account is PROVISIONED for it is readable, from one field in the same
//   ~/.claude.json this plugin already parses:
//     cachedGrowthBookFeatures.tengu_toasty_breeze
//   In the bundle: Cj="tengu_toasty_breeze", AKe()=Au().enabled===!0, and the
//   command declares isEnabled:()=>pt()&&(WL()||AKe()).
//
//   Whether it is ON is NOT readable. The state lives in process memory only -
//   WL()=mr().state.phase==="active", phases idle/armed/active/stale - and is
//   written to no file. ~/.claude/state holds only mcp-discover-verdicts.json
//   and skill-runs.jsonl; ~/.claude/usage-limits is empty; the documented hook
//   payload (code.claude.com/docs/en/hooks) carries no usage field on any
//   event; the statusLine payload has no low_priority field. So this module
//   offers three states and never a fourth: absent, offered, and acknowledged
//   by the user in their own words. activeKnown is false in all of them.
//
//   Two further gates sit in front of the offer that nothing here can see: the
//   experiment arm arrives in a response header (ZIe() requires
//   lowPriorityOffer==="treatment"), and the CLI withholds the offer during a
//   cooloff and once the weekly allowance is spent. So every sentence built
//   from this is a possibility, never a promise - and the grant can be
//   withdrawn mid-week (github.com/anthropics/claude-code/issues/95470), which
//   is why the flag is re-read on every brief instead of remembered.
//
//   The wait and retry are per-request, from lowPriorityRetryAfterSeconds and
//   lowPriorityMaxWaitSeconds on the response headers. There is no client-side
//   constant, so no number is printed for them. ($Fn=1800000 in the bundle is a
//   30-minute freshness cutoff on cached window readings, nothing to do with
//   this.)
//
//   /limit-reset - a manual reset, behind two different server flags (see
//   sessionReset below). tengu_nifty_lemur is the once-a-week reset of the
//   5-hour session limit whose work still counts toward the weekly, and THIS
//   ACCOUNT HAS IT (enabled:true). tengu_cedar_ember is a counted grant with a
//   use-by date, absent here, with cachedUsageUtilization.utilization.cedar_ember
//   null. Nothing is spent by the plugin - only the user can type the command -
//   and whether this week's reset is used, or how many grants are left, is
//   served by the API and never a file, so neither is ever claimed.
//
//   The graceful wrap-up note - the CLI injecting "finish up" at the wall. The
//   mechanism is real and the treatment TEXT is provisioned on this machine
//   (tengu_lantern_wick_text), but the gate is the MODE flag, and the bundle's
//   own normalizer keeps only "wrap-up" and "next-steps" and maps everything
//   else to "off":
//     function kuo(e){let n=typeof e==="string"?e.trim().toLowerCase():e;
//       return n==="wrap-up"||n==="next-steps"?n:"off"}
//   tengu_lantern_wick_mode reads "off" here, so the note does not fire on this
//   machine today and the plugin's own near-wall instruction must stay. When
//   the flag flips, hostWrapsUp goes true and the plugin stands down rather
//   than telling the model to wrap up in different words. (tengu_lantern_wick
//   is in the cache but is not a string this build contains at all, so it reads
//   nothing; the near-limit note is a separate flag, tengu_vellum_anchor,
//   T1()=x("tengu_vellum_anchor",!1), which reads false here.)
//
//   Usage credits - blocked at the org level on this account
//   (cachedExtraUsageDisabledReason "org_level_disabled", extra_usage
//   is_enabled false), so nothing should offer /usage-credits here.
//
//   autoContinueAtUsageLimit - documented at
//   code.claude.com/docs/en/settings-reference, shipped in 2.1.234, and
//   DEFAULTED TO TRUE in the bundle (value:r?.autoContinueAtUsageLimit??!0). It
//   waits out the reset and continues the same open session. That is better
//   than a scheduled wake when the terminal stays open, and it is why the relay
//   has to say so rather than presenting its wake as the only route.
//
//   The cloud-session credit - a dollar credit for claude.ai/code sessions, on
//   top of the plan, which the CLI itself advertises AT the limit wall ("While
//   you wait, start a new cloud session with a $250 credit"). Read on
//   2026-09-28 (2.1.284) from cachedGrowthBookFeatures.tengu_swift_lynx,
//   version 2, with endpoint /v1/code/promo/cloud_credit and the claim page at
//   webPath /code/claim-credit. It is not usage credits: this account has those
//   switched off at the org level and still has this. A cloud session on it was
//   seen working with its own server record saying five_hour "rejected", so it
//   is the one lever here that carries work past the 5-hour wall today. The
//   amount is only ever parsed out of the server's own copy, and the balance is
//   served nowhere a file can see, so neither is invented.

const fs = require('fs');
const os = require('os');
const path = require('path');

const atomic = require('./atomic.js');

const FLAG = 'tengu_toasty_breeze';
const RESET_FLAG = 'tengu_cedar_ember';
const SESSION_RESET_FLAG = 'tengu_nifty_lemur';
const WRAPUP_MODE_FLAG = 'tengu_lantern_wick_mode';
const WRAPUP_TEXT_FLAG = 'tengu_lantern_wick_text';
const NEAR_WALL_FLAG = 'tengu_vellum_anchor';
const CLOUD_CREDIT_FLAG = 'tengu_swift_lynx';
const CLAUDE_AI = 'https://claude.ai';

// The only two mode values the CLI's own normalizer keeps.
const WRAPUP_MODES = new Set(['wrap-up', 'next-steps']);

// The client default in the bundle (xj=10), clamped there to 1440 minutes.
const DEFAULT_COOLOFF_MINUTES = 10;
const MAX_COOLOFF_MINUTES = 1440;

// The recommendation rule, in one number so it can be argued with.
//
// /low-priority spends the weekly and draws on a weekly allowance whose size is
// exposed nowhere a hook can read, and one user has reported it burning "almost
// a week of usage in a couple hours"
// (github.com/anthropics/claude-code/issues/92544). So it is worth naming only
// while the weekly still has real room. At or below this it is offered; above
// it the brief says not to, and says why.
const WEEKLY_HEADROOM_MAX = 80;

// Past this the 5-hour window is the wall, which is the only place the CLI
// offers the toggle at all.
const WALL_PERCENT = 90;

// How long an acknowledgement with no readable reset time is allowed to live.
//
// The record is meant to lapse at the reset of the window it belongs to. When
// that reset could not be read - a session with no account snapshot, or a
// snapshot with no five_hour entry - the record used to be written with
// resetsAt null, and readAck only lapsed a FINITE resetsAt. So it never lapsed:
// a record written once went on redirecting the headroom maths at the weekly
// for ever. Probed on 2026-09-26 with an acknowledgement three days old and the
// 5-hour window reading 0 per cent, and the brief still said the 5-hour limit
// "no longer stops this session".
//
// The window the toggle is offered at is five hours long, so an
// acknowledgement made against it cannot honestly outlive five hours from when
// it was made. That is the ceiling, not a guess at when it really ended.
const ACK_MAX_MS = 5 * 60 * 60 * 1000;

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function stateFile() {
  return path.join(configDir(), 'usage-limits-lowpri.json');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return null;
  }
}

// The same choice usage.js and host.js make, for the same reason: a migration
// leaves a small ~/.claude/.claude.json with machine ids and no meter while the
// account state stays in the home file, so pick the one that carries a
// snapshot and only fall back to existence.
function accountFiles() {
  const scoped = path.join(configDir(), '.claude.json');
  const home = path.join(os.homedir(), '.claude.json');
  return scoped === home ? [home] : [scoped, home];
}

function snapshot() {
  const files = accountFiles();
  let fallback = null;
  for (const file of files) {
    const parsed = readJson(file);
    if (!parsed) continue;
    if (parsed.cachedUsageUtilization) return parsed;
    if (!fallback) fallback = parsed;
  }
  return fallback;
}

function features(account) {
  return account && account.cachedGrowthBookFeatures && typeof account.cachedGrowthBookFeatures === 'object'
    ? account.cachedGrowthBookFeatures
    : null;
}

function utilization(account) {
  const cache = account && account.cachedUsageUtilization;
  return cache && cache.utilization && typeof cache.utilization === 'object' ? cache.utilization : null;
}

// A string the server sent, or null. Never a default: the wording is
// Anthropic's and it can change, so a sentence built on a made-up version of it
// would be quoting the plugin to itself.
function copy(value) {
  return typeof value === 'string' && value.trim() ? value : null;
}

// Whether this ACCOUNT is provisioned for /low-priority, plus the copy the
// server shipped with it.
//
// A missing key is "not offered" and known:false - it is the absence of a fact,
// not the fact of an absence, and the difference decides whether the docs can
// say anything about this machine at all.
function offer(account) {
  const gb = features(account);
  const raw = gb && Object.prototype.hasOwnProperty.call(gb, FLAG) ? gb[FLAG] : undefined;
  if (raw === undefined) {
    return {
      known: false,
      offered: false,
      version: null,
      label: null,
      noticeLine: null,
      statusLine: null,
      allowanceNote: null,
      waitBanner: null,
      budgetExhaustedCopy: null,
      cooloffMinutes: DEFAULT_COOLOFF_MINUTES,
    };
  }
  const flag = raw && typeof raw === 'object' ? raw : {};
  const cooloff = Number(flag.cooloffMinutes);
  return {
    known: true,
    offered: flag.enabled === true,
    version: Number.isFinite(Number(flag.version)) ? Number(flag.version) : null,
    label: copy(flag.label),
    noticeLine: copy(flag.noticeLine),
    statusLine: copy(flag.statusLine),
    allowanceNote: copy(flag.allowanceNote),
    waitBanner: copy(flag.waitBanner),
    budgetExhaustedCopy: copy(flag.budgetExhaustedCopy),
    cooloffMinutes: Number.isFinite(cooloff)
      ? Math.round(Math.min(MAX_COOLOFF_MINUTES, Math.max(0, cooloff)))
      : DEFAULT_COOLOFF_MINUTES,
  };
}

// A flag object the way the CLI reads one: a plain object whose `enabled` is
// exactly true. The bundle's own readers are
//   function qae(){let e=x("tengu_nifty_lemur",{});return typeof e==="object"&&e!==null&&!Array.isArray(e)?e:{}}
//   function pme(){return qae().enabled===!0}
// and the same shape for tengu_cedar_ember ($Z()). Truthiness is not enough:
// `{ enabled: false }` is a truthy object, and the first build counted it as a
// reset on offer.
function flagEnabled(gb, key) {
  if (!gb || !Object.prototype.hasOwnProperty.call(gb, key)) return false;
  const value = gb[key];
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && value.enabled === true);
}

// The manual reset behind /limit-reset. Detected, never spent.
//
// There are TWO server flags behind the one command, and they describe
// different things, so the brief must not word one in the other's terms:
//
//   tengu_nifty_lemur - "Reset your session limit now and keep working; once a
//   week, still counts toward your weekly limit" (the command's description
//   when this is the variant). Its notice: "/limit-reset to reset your session
//   limit now · uses weekly limit · 1/week". THIS ACCOUNT HAS IT: enabled:true,
//   version 1, read from ~/.claude.json on 2026-09-25. The first build looked
//   only at tengu_cedar_ember, called the account grant-less, and so never said
//   a word about a reset the account actually holds.
//
//   tengu_cedar_ember - "Use an available limit reset and keep working". A
//   counted grant: "Refills your {limits} now · your weekly reset day stays
//   {week}", "{resets} left · use by {deadline}", and an early-use path ("You
//   haven't reached a limit yet - use your reset anyway?"). Not once a week,
//   not only at a limit, and whether it spends the weekly is not in its copy.
//
// The CLI prefers cedar_ember when both are on (its description reads
// `$Z()?"Use an available limit reset...":"Reset your session limit now..."`),
// so this does too. Whether this week's reset is already spent, and how many
// grants are left, come from the server and appear in no file.
function sessionReset(account) {
  const gb = features(account);
  const util = utilization(account);
  const grantFlag = flagEnabled(gb, RESET_FLAG);
  const weeklyFlag = flagEnabled(gb, SESSION_RESET_FLAG);
  const grant = util && util.cedar_ember ? util.cedar_ember : null;
  const variant = grantFlag || grant ? 'grant' : weeklyFlag ? 'weekly' : null;
  return {
    known: Boolean(gb || util),
    present: variant !== null,
    variant,
    // resets_left is served from /api/organizations/<uuid>/reset_rate_limits,
    // not from any file a hook can read, so it stays unreported.
    resetsLeft: null,
  };
}

// Whether the CLI itself will tell the model to wrap up at the wall.
function wrapUp(account) {
  const gb = features(account);
  const rawMode = gb ? gb[WRAPUP_MODE_FLAG] : undefined;
  const normalised = typeof rawMode === 'string' ? rawMode.trim().toLowerCase() : rawMode;
  const mode = WRAPUP_MODES.has(normalised) ? normalised : 'off';
  return {
    known: Boolean(gb && (Object.prototype.hasOwnProperty.call(gb, WRAPUP_MODE_FLAG) || Object.prototype.hasOwnProperty.call(gb, WRAPUP_TEXT_FLAG))),
    mode,
    hostWrapsUp: mode !== 'off',
    textProvisioned: Boolean(gb && copy(gb[WRAPUP_TEXT_FLAG])),
    nearWallNote: Boolean(gb && gb[NEAR_WALL_FLAG] === true),
  };
}

// Whether usage credits are a lever on this account at all.
function credits(account) {
  const util = utilization(account);
  const extra = util && util.extra_usage ? util.extra_usage : null;
  const reason =
    account && typeof account.cachedExtraUsageDisabledReason === 'string'
      ? account.cachedExtraUsageDisabledReason
      : (extra && typeof extra.disabled_reason === 'string' ? extra.disabled_reason : null);
  if (!extra) return { available: null, reason: reason };
  if (extra.is_enabled === true) return { available: true, reason: null };
  if (extra.is_enabled === false) return { available: false, reason: reason };
  return { available: null, reason: reason };
}

// The first amount of money in a line of the server's copy: "$250" is 250 USD.
const CURRENCY_SIGNS = { $: 'USD', '€': 'EUR', '£': 'GBP' };
function moneyIn(text) {
  const found = typeof text === 'string' ? /([$€£])\s?(\d[\d,]*(?:\.\d+)?)/.exec(text) : null;
  if (!found) return null;
  const amount = Number(found[2].replace(/,/g, ''));
  return Number.isFinite(amount) && amount > 0 ? { amount, currency: CURRENCY_SIGNS[found[1]] } : null;
}

// "$250", from what cloudCredit() read. The sign goes back on the way out.
function creditText(credit) {
  if (!credit || !Number.isFinite(credit.amount)) return null;
  const sign = Object.keys(CURRENCY_SIGNS).find((key) => CURRENCY_SIGNS[key] === credit.currency);
  const amount = Number.isInteger(credit.amount) ? String(credit.amount) : credit.amount.toFixed(2);
  return sign ? sign + amount : amount + ' ' + credit.currency;
}

// The cloud-session credit this account is offered, or null.
//
// Null when the flag is absent, is not a plain object, says enabled:false, or
// carries no amount in any of its lines: an offer this cannot put a number on
// is not one it can repeat. The startup line comes first because it states the
// grant; the wall lines only say "a $250 credit". Whether it has been claimed,
// and what is left of it, are not in any file, so nothing here says either.
function cloudCredit(account) {
  const gb = features(account);
  const flag = gb && Object.prototype.hasOwnProperty.call(gb, CLOUD_CREDIT_FLAG) ? gb[CLOUD_CREDIT_FLAG] : null;
  if (!flag || typeof flag !== 'object' || Array.isArray(flag) || flag.enabled === false) return null;
  const part = (key) => (flag[key] && typeof flag[key] === 'object' && !Array.isArray(flag[key]) ? flag[key] : {});
  const wall = part('limitWall');
  const lines = [part('startup').text, wall.noticeLine, wall.label, wall.claimPageLine, part('startup').claimPageLine, part('ide').text];
  const money = lines.map(moneyIn).find(Boolean);
  if (!money) return null;
  const webPath = typeof flag.webPath === 'string' && /^\/[\w\-/]*$/.test(flag.webPath) ? flag.webPath : null;
  return {
    amount: money.amount,
    currency: money.currency,
    claimUrl: webPath ? CLAUDE_AI + webPath : null,
    // Whether the CLI names it at the wall itself, which is where the report
    // and the brief name it too.
    wallNotice: Boolean(copy(wall.noticeLine) || copy(wall.label)),
    version: Number.isFinite(Number(flag.version)) ? Number(flag.version) : null,
  };
}

// Whether this process runs inside a claude.ai/code cloud container.
//
// From the environment only, because that is all a cloud container has: its
// ~/.claude.json carries no usage snapshot at all (checked 2026-09-28), so
// every reading of the plan's windows there is absent, not zero. The container
// id names the product (container_..--claude_code_remote--..); the pair below
// is the same container seen without it. The session id is the one Claude Code
// hands every command it runs, which is how a report finds its own transcript.
function cloudSession(env) {
  const e = env || process.env;
  const container = String(e.CLAUDE_CODE_CONTAINER_ID || '');
  const cloud =
    container.indexOf('claude_code_remote') !== -1 ||
    (e.CLAUDE_CODE_REMOTE === 'true' && e.CCR_AGENT_PROXY_ENABLED === '1');
  return cloud ? { cloud: true, sessionId: e.CLAUDE_CODE_SESSION_ID || null } : null;
}

function settingsFiles() {
  return [path.join(configDir(), 'settings.local.json'), path.join(configDir(), 'settings.json')];
}

// The CLI's own wait-and-continue. Documented as user-or-managed scope, and the
// bundle defaults it to true, so an absent key is TRUE - the one reading a
// relay must not get wrong, because it decides whether the wake is the only
// route across the reset or a second one.
function autoContinue() {
  for (const file of settingsFiles()) {
    const parsed = readJson(file);
    if (parsed && typeof parsed.autoContinueAtUsageLimit === 'boolean') {
      return { value: parsed.autoContinueAtUsageLimit, source: path.basename(file) };
    }
  }
  return { value: true, source: 'default' };
}

// ---------------------------------------------------------------------------
// The acknowledgement. The plugin's own record that the USER said he turned
// low-priority on, because nothing else can tell it.
//
// It carries the window it belongs to and that window's reset, and it lapses at
// that reset: low-priority ends when the limit does, so a fact that outlived
// its window would go on redirecting the headroom maths at the weekly in a
// session where the 5-hour wall is real again.
// ---------------------------------------------------------------------------

// An array is an object too, and JSON.stringify drops a named property set on
// one: a state file holding `[]` made acknowledge() write `[]` straight back,
// report saved:true, and usage-mode print "Recorded" for a statement that the
// next read could not find. Only a plain object is a state.
function readState() {
  const parsed = readJson(stateFile());
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function writeState(state) {
  try {
    atomic.writeFileAtomic(stateFile(), JSON.stringify(state, null, 2) + '\n');
    return true;
  } catch (err) {
    return false;
  }
}

// `saved` is reported, never assumed. A state path that cannot be written -
// a directory sitting where the file goes, a read-only home - used to return
// the record anyway, so usage-mode printed "Recorded: you have switched
// /low-priority on" and then the very next brief behaved as though nothing had
// been said. Telling somebody their statement was recorded when it was not is
// the one thing this module must not do.
function acknowledge(input) {
  const options = input || {};
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  if (!options.on) {
    const state = readState();
    delete state.ack;
    const saved = writeState(state);
    return { on: false, at: now, saved, file: stateFile() };
  }
  const record = {
    on: true,
    at: now,
    windowKey: options.windowKey || null,
    resetsAt: Number.isFinite(options.resetsAt) ? options.resetsAt : null,
  };
  const state = readState();
  state.ack = record;
  const saved = writeState(state);
  return Object.assign({}, record, { saved, file: stateFile() });
}

// When a record stops being true: the reset of the window it was stamped
// against, or - when that could not be read - ACK_MAX_MS after it was made.
// Both are returned as `expiresAt` so a caller never has to work it out twice
// and get a different answer.
function ackExpiry(ack) {
  if (!ack) return null;
  if (Number.isFinite(ack.resetsAt)) return ack.resetsAt;
  if (Number.isFinite(ack.at)) return ack.at + ACK_MAX_MS;
  return null;
}

function readAck(now) {
  const at = Number.isFinite(now) ? now : Date.now();
  const state = readState();
  const ack = state.ack;
  if (!ack || typeof ack !== 'object' || ack.on !== true) return null;
  // A record with no usable timestamp is not a record. It printed as
  // "acknowledged ... at Invalid Date" before this, off a hand-edited or
  // half-written file, which is the plugin quoting garbage back as fact.
  if (!Number.isFinite(ack.at)) return null;
  // Past the reset of the window it was recorded against - or past the length
  // of that window, when no reset was readable - the fact is spent.
  const expiresAt = ackExpiry(ack);
  if (Number.isFinite(expiresAt) && at >= expiresAt) return null;
  return Object.assign({}, ack, { expiresAt, expiryKnown: Number.isFinite(ack.resetsAt) });
}

// Exactly three states, and activeKnown is false in every one of them.
function stateOf(input) {
  const options = input || {};
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const account = options.account !== undefined ? options.account : snapshot();
  const provisioned = offer(account);
  const ack = readAck(now);
  return {
    state: ack ? 'acknowledged' : provisioned.offered ? 'offered' : 'absent',
    offered: provisioned.offered,
    known: provisioned.known,
    ack,
    // Never readable. Said out loud here so no caller can talk itself into it.
    activeKnown: false,
    offer: provisioned,
  };
}

function weeklyOf(windows) {
  return (windows || []).find((w) => w && w.key === 'seven_day') || null;
}

// Whether to say anything about /low-priority on this prompt, and which way.
//
// Null unless the account is provisioned, the 5-hour window is the binding one,
// it is at the wall, and there is a weekly reading to judge against. A guess at
// any of those would be the plugin recommending a spend it cannot price.
function advise(input) {
  const options = input || {};
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const account = options.account !== undefined ? options.account : snapshot();
  if (!offer(account).offered) return null;
  const binding = options.binding;
  if (!binding || binding.key !== 'five_hour') return null;
  if (binding.stale) return null;
  if (!Number.isFinite(binding.percentUsed) || binding.percentUsed < WALL_PERCENT) return null;
  const weekly = weeklyOf(options.windows);
  if (!weekly || !Number.isFinite(weekly.percentUsed) || weekly.stale) return null;
  const percent = Math.round(weekly.percentUsed);
  return {
    kind: percent <= WEEKLY_HEADROOM_MAX ? 'offer' : 'hold',
    weeklyPercent: percent,
    threshold: WEEKLY_HEADROOM_MAX,
    weeklyLabel: weekly.label || 'weekly',
    now,
  };
}

// Everything the brief needs, in one read of one file.
function forBrief(input) {
  const options = input || {};
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const account = options.account !== undefined ? options.account : snapshot();
  const state = stateOf({ account, now });
  const weekly = weeklyOf(options.windows);
  const five = (options.windows || []).find((w) => w && w.key === 'five_hour') || null;
  return {
    state: state.state,
    activeKnown: false,
    advise: advise({ account, now, binding: options.binding, windows: options.windows }),
    notice: state.offer.noticeLine,
    cooloffMinutes: state.offer.cooloffMinutes,
    budgetExhaustedCopy: state.offer.budgetExhaustedCopy,
    weeklyLabel: weekly ? weekly.label || 'weekly' : 'weekly',
    weeklyPercent: weekly && Number.isFinite(weekly.percentUsed) ? Math.round(weekly.percentUsed) : null,
    fiveHourPercent: five && Number.isFinite(five.percentUsed) ? Math.round(five.percentUsed) : null,
    resetGrant: sessionReset(account).present,
    resetVariant: sessionReset(account).variant,
    credits: credits(account),
    cloudCredit: cloudCredit(account),
    inCloud: Boolean(cloudSession(options.env)),
    autoContinue: autoContinue(),
  };
}

module.exports = {
  FLAG,
  RESET_FLAG,
  SESSION_RESET_FLAG,
  WRAPUP_MODE_FLAG,
  WRAPUP_TEXT_FLAG,
  NEAR_WALL_FLAG,
  CLOUD_CREDIT_FLAG,
  WRAPUP_MODES,
  DEFAULT_COOLOFF_MINUTES,
  MAX_COOLOFF_MINUTES,
  WEEKLY_HEADROOM_MAX,
  WALL_PERCENT,
  ACK_MAX_MS,
  ackExpiry,
  configDir,
  stateFile,
  accountFiles,
  snapshot,
  offer,
  sessionReset,
  flagEnabled,
  wrapUp,
  credits,
  cloudCredit,
  creditText,
  cloudSession,
  autoContinue,
  acknowledge,
  readAck,
  readState,
  stateOf,
  advise,
  forBrief,
  weeklyOf,
};
