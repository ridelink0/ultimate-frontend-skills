#!/usr/bin/env node
'use strict';

// The closing line.
//
// Runs as the SessionEnd hook. Brings the session's total up to date one last
// time, marks it closed, and prints one line saying how long it ran and what
// it cost. SessionEnd shows plain stdout to the user and gives hooks a short
// shared budget, which the incremental read fits inside comfortably.

const usage = require('./usage.js');
const host = require('./host.js');
const tally = require('./tally.js');
const activity = require('./activity.js');
const mode = require('./mode.js');

async function run(now, hookInput) {
  const sessionId = hookInput && hookInput.session_id ? hookInput.session_id : null;

  // The same rule as the Stop hook, for the same reason: `off` promises the
  // hooks return before reading anything, and this one read the whole
  // transcript one last time and printed a closing line. See stop.js.
  const budget = mode.forSession({ sessionId });
  if (budget.policy.briefStyle === 'none') return '';

  // The session is over, so as far as the panel is concerned it is idle.
  activity.mark('idle', sessionId, null, now);

  if (String(process.env.USAGE_LIMITS_TALLY || '').toLowerCase() === 'off') return '';
  usage.setHost(host.detect(process.argv.slice(2), process.env));

  const transcript = hookInput && hookInput.transcript_path ? hookInput.transcript_path : null;
  if (!sessionId || !transcript) return '';

  const all = tally.readState();
  const { session } = tally.update(all, sessionId, transcript, now, { cwd: hookInput.cwd || null });
  session.endedAt = now;
  session.reason = typeof hookInput.reason === 'string' ? hookInput.reason : null;
  tally.writeState(tally.trim(all));

  return tally.formatClosed(session, now);
}

if (require.main === module) {
  tally
    .readHookInput()
    .then((input) => run(Date.now(), input))
    .then(
      (text) => {
        if (text) process.stdout.write(text + '\n');
        process.exit(0);
      },
      () => {
        process.exit(0);
      }
    );
}

module.exports = { run };
