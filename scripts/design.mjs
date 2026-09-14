#!/usr/bin/env node
/* ultimate-frontend-skills/design - which Claude Design route is actually here?

   There is more than one, they are not interchangeable, and the wrong
   assumption is expensive. This plugin used to assume exactly one: that Claude
   Design arrives as an HTTP MCP server you register. On a current Claude Code
   build that is not how it arrives - the canvas is a BUILT-IN skill and the
   design-system push is a NATIVE tool, and running the old setup would have
   added a redundant user-scoped MCP server shadowing a capability the host
   already has.

   So this reports and never enrols. It reads the filesystem, and optionally
   asks the Claude CLI to list the MCP servers it already has (a read-only
   query), and prints what it found and what it could not see from out here.
   Registering a server, consenting, logging in and publishing all change the
   user's account or environment, and all of them are the user's to run. */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import { findClaude, runClaude } from './claude-cli.mjs';
import { parseArgs } from './args.mjs';

export const MCP_URL = 'https://api.anthropic.com/v1/design/mcp';
export const MCP_COMMAND = `claude mcp add --scope user --transport http claude-design ${MCP_URL}`;

/* The Codex half of the same instruction. `claude mcp add` is the one command
   that cannot help a Codex user - it either is not installed, or it enrols the
   server into the OTHER host, the one that already has the native routes - and
   this plugin ships to both. Codex names its MCP servers in
   ~/.codex/config.toml, and an HTTP server there is a [mcp_servers.<name>]
   table with a url key: that is the shape findCodexDesignServer() below looks
   for, and the shape a real config on this machine already uses for another
   HTTP server. Recent Codex builds also have a `codex mcp` subcommand; that
   was not exercised here, so the file is what is documented. */
export const CODEX_CONFIG_BLOCK = `[mcp_servers.claude-design]\n      url = "${MCP_URL}"`;

/* The canvas skill unpacks itself, per version, into the host's temp dir - not
   into ~/.claude - so the presence of seed-canvas.mjs beside
   payload.template.html is hard evidence that this machine has run it. Its
   ABSENCE proves less: the skill can be present in the host and simply never
   invoked, in which case nothing has been extracted yet. Both are reported as
   what they are. */
export function findCanvasHelper({ tmp = tmpdir(), exists = existsSync, readdir = readdirSync } = {}) {
  const root = join(tmp, 'claude', 'bundled-skills');
  if (!exists(root)) return null;
  let versions = [];
  try { versions = readdir(root); } catch { return null; }
  // Newest version first, so a stale extraction from an older build is not
  // what gets reported as "the" helper.
  for (const version of [...versions].sort().reverse()) {
    let hashes = [];
    try { hashes = readdir(join(root, version)); } catch { continue; }
    for (const hash of hashes) {
      const dir = join(root, version, hash, 'design');
      if (exists(join(dir, 'seed-canvas.mjs')) && exists(join(dir, 'payload.template.html'))) {
        return { dir, version, seed: join(dir, 'seed-canvas.mjs'), template: join(dir, 'payload.template.html') };
      }
    }
  }
  return null;
}

/* Codex has no `claude mcp list`; what it has is a config file that names its
   MCP servers. Reading it is the only way to answer the same question there,
   and a missing file means "not configured", not "not supported". */
export function findCodexDesignServer({ home = homedir(), exists = existsSync, read = readFileSync } = {}) {
  const config = join(home, '.codex', 'config.toml');
  if (!exists(config)) return { configured: false, config: null };
  let text = '';
  try { text = String(read(config, 'utf8')); } catch { return { configured: false, config }; }
  const hit = /(^|\n)\s*\[mcp_servers\.([A-Za-z0-9_.-]*design[A-Za-z0-9_.-]*)\]/i.exec(text)
    || (/v1\/design\/mcp/.test(text) ? [null, null, '(server naming api.anthropic.com/v1/design/mcp)'] : null);
  return { configured: Boolean(hit), name: hit ? hit[2] : null, config };
}

// `claude mcp list` only reads. It is still opt-out (--no-probe) because it
// spawns the host CLI, and a script that reports on your environment should
// not be the surprising part of running it.
export function listClaudeMcp({ cli = findClaude(), run = runClaude } = {}) {
  if (!cli) return { available: false, reason: 'the Claude Code CLI was not found on PATH' };
  let result;
  try { result = run(cli, ['mcp', 'list'], { timeout: 25000 }); }
  catch (err) { return { available: false, reason: err.message }; }
  if (!result || result.status !== 0) return { available: false, reason: (result && (result.stderr || '').trim()) || 'claude mcp list failed' };
  const text = String(result.stdout || '');
  const design = text.split('\n').filter((line) => /design/i.test(line) && !/^\s*$/.test(line));
  return { available: true, text, design };
}

export function detectDesignRoutes(deps = {}) {
  const canvas = findCanvasHelper(deps);
  const codex = findCodexDesignServer(deps);
  const mcp = deps.probeMcp === false ? { available: false, reason: 'not probed (--no-probe)' } : listClaudeMcp(deps);

  return [
    {
      id: 'canvas-skill',
      name: 'Built-in design canvas skill (Claude Code)',
      state: canvas ? 'present' : 'not seen from here',
      evidence: canvas
        ? `the extracted helper is on this machine: ${canvas.seed} (bundled-skills ${canvas.version})`
        : 'no extracted design-canvas helper under the host temp dir. The skill can still exist in the host and simply never have been invoked here - it unpacks on first use',
      use: 'In Claude Code, ask for a design. The skill drafts .dc.html artboards, seeds them into one self-contained canvas page with seed-canvas.mjs, and publishes it with the Artifact tool. That published page is what you hand to `webdesign parity --design`.',
    },
    {
      id: 'design-sync',
      name: 'Native DesignSync tool + /design consent (Claude Code)',
      state: 'only visible inside a session',
      evidence: 'DesignSync is a first-party tool in the host, not an MCP server, so nothing on disk reveals whether this account has consented. Unverified from out here by design - do not assume it is authorised.',
      /* Both commands are real and they are not alternatives. `/design consent`
         grants and revokes on a session that ALREADY has Design access;
         `/design-login` is the authorization command, and the host's own error
         strings name it as the remedy when a login carries no Design access. */
      use: 'In Claude Code, `/design consent` grants access and `/design revoke` undoes it - both available only with a first-party claude.ai login and a policy that permits Design access. On a session without one (an API key, Bedrock or Vertex, or a claude.ai token that carries no Design grant), `/design-login` is the command that authorizes Design; it runs its own browser flow and falls back to pasting a code when the browser cannot reach the local listener. It PUSHES a React/Storybook design system up to claude.ai/design; the target project must have been created as a design-system project. It does not apply to the plain HTML and CSS this plugin builds.',
    },
    {
      id: 'mcp',
      name: 'HTTP MCP server (hosts that use it, Codex among them)',
      /* Both hosts count. Reading only `claude mcp list` told a Codex user who
         was already correctly registered that they had no route - directly
         above evidence saying their Codex config names one - and the page that
         reads this state makes it the gate on registering. Whichever host the
         server is registered in, the state says so and says which. */
      state: mcp.available && mcp.design.length
        ? (codex.configured ? 'registered (Claude Code and Codex)' : 'registered in Claude Code')
        : codex.configured
          ? 'registered in Codex'
          : (mcp.available ? 'not registered' : 'could not be checked'),
      evidence: [
        mcp.available
          ? (mcp.design.length ? mcp.design.map((l) => l.trim()).join('; ') : 'No design server among the registered Claude Code MCP servers.')
          : `Claude Code MCP list unavailable: ${mcp.reason}.`,
        codex.configured
          ? `Codex config names a design server (${codex.name}) in ${codex.config}.`
          : codex.config ? `No design server in ${codex.config}.` : 'No Codex config found either.',
      ].join(' '),
      use: `Register it yourself if your host needs it - this script will not.\n`
        + `    Claude Code:  ${MCP_COMMAND}\n`
        + `    Codex:        add to ~/.codex/config.toml (there is no claude CLI there, and running it would enrol the wrong host):\n`
        + `      ${CODEX_CONFIG_BLOCK}\n`
        + `    On a build that already ships the canvas skill and DesignSync, registering it adds a server that duplicates a native capability.`,
    },
  ];
}

export function formatRoutes(routes) {
  const lines = ['\nClaude Design routes on this machine\n'];
  for (const route of routes) {
    lines.push(`  ${route.name}`);
    lines.push(`    state: ${route.state}`);
    lines.push(`    ${route.evidence}`);
    lines.push(`    ${route.use}`);
    lines.push('');
  }
  lines.push('  This command only reports. It never registers an MCP server, consents, logs in or publishes;');
  lines.push('  those change your account or environment and are yours to run.');
  return lines.join('\n');
}

/* ---------------------------------------------------------------- the CLI -- */

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let parsed;
  try { parsed = parseArgs(process.argv.slice(1)); } catch (err) { console.error(err.message); process.exit(1); }
  const command = parsed.positional[0] || 'detect';
  if (command === 'setup') {
    // Kept as a name people already type, but it prints the command instead of
    // running it. Enrolling a user-scoped MCP server is not something a helper
    // in a website plugin should do on their behalf.
    console.log('Nothing is registered by this script. If your host needs the MCP route:\n');
    console.log('  Claude Code:  ' + MCP_COMMAND + '\n');
    console.log('  Codex:        add to ~/.codex/config.toml -\n\n      ' + CODEX_CONFIG_BLOCK + '\n');
    console.log('Then check what you actually have with:  node scripts/design.mjs detect');
    process.exit(0);
  }
  if (command !== 'detect') {
    console.log('Usage: node scripts/design.mjs [detect] [--json] [--no-probe]\n       node scripts/design.mjs setup     print the MCP registration command (does not run it)');
    process.exit(1);
  }
  const routes = detectDesignRoutes({ probeMcp: !parsed.flag('no-probe') });
  if (parsed.flag('json')) console.log(JSON.stringify(routes, null, 2));
  else console.log(formatRoutes(routes));
}
