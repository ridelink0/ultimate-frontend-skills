# Plugin audit and consolidation — 7 September 2026

Two complete verification passes passed after fixing the discovered issues. Each pass ran **770 functional tests**, all **303 loaded Claude plugin/catalog validation targets**, repository-wide JSON/JavaScript/Python/YAML checks, and both fresh-scaffold audits. The scaffold audits intentionally reported only placeholder copy and short example meta descriptions.

[First clean pass](pass-1-final/results.json) · [Second clean pass](pass-2/results.json) · [Original findings and source permalinks](BASELINE.md)

## What changed

- Cinematic Web Design 3.0.0 contains Atelier's 21 sections, all its presets and a compatible command/CLI entry point, with one canonical skill.
- Both design preview servers reject sibling traversal and escaping links, survive malformed URLs and bind only loopback. Installers preserve literal Windows paths, encode TOML paths correctly and remove their own blocks safely. CLI flags no longer become positional paths.
- Toolkit's 120 plugin paths, catalog sources, root author and previously masked hook schema are repaired. Hook scripts resolve from the installed plugin.
- Computer Use startup retries build failures, waits for readiness across concurrent calls and handles early/stale host exits.
- BuildWithClaude correctly classifies commands on Windows; its HUD path and eleven YAML descriptions are repaired.
- Awesome Claude Plugins has five repaired YAML descriptions. Awesome Claude Skills has working root/nested catalogs for 24 and 832 existing skills; stale missing entries are documented.
- Usage Limits 1.12.7 has explicit Codex model/effort default controls, reversible state, dry-run, host isolation and host-appropriate recommendations. The executable's LF shebang is enforced.

## Usage Limits findings

A fresh plugin reading matched the native Codex meter for both account windows. No personal quota snapshots are published. Headroom is a shared estimate; it cannot reserve allowance, guarantee completion or switch the model/effort of an active task. The local audit used the AGENTS fallback because Codex's hooks still needed its one-time trust review. These controls do not redeem credits or enable overages. Visual panels were excluded as requested.

[Codex control details](https://github.com/ridelink0/claude-code-usage-limits/blob/main/docs/codex-controls.md)

## Claude Design

[Connection, sources and handoff workflow](../../skills/ultimate-frontend-skills/references/claude-design.md) (path corrected after the 4.0.0 and 5.0.0 renames; the old `skills/cinematic-web-design/` and `skills/ultimate-website-skills/` paths no longer exist). That reference was rewritten on 8 September 2026 against the running host: the live routes on a current Claude Code build are the built-in `design` canvas skill and the native `DesignSync` tool, and `scripts/design.mjs` now detects rather than registers. Authenticated remote design creation and the quality of a particular generated website were not tested, then or since.

## Reproduce

Use sibling clones named as in the table below, Node 22, Python 3 and Claude Code 2.1.261. Install BuildWithClaude's root validation dependencies without lifecycle scripts. Computer Use's compile test needs Windows with its supported C# build tools; it builds in a private temporary directory.

From the parent of the clones, set PLUGIN_AUDIT_ROOT to that directory and CLAUDE_VALIDATE_CLI to the native Claude executable (or an executable on PATH). Run:

    python -X utf8 cinematic-web-design/tools/plugin-audit/run-pass.py pass-1
    python -X utf8 cinematic-web-design/tools/plugin-audit/run-pass.py pass-2

The harness uses git ls-files: stage intended new files before running it. It preserves the existing generated hook report. Run passes sequentially because the supporting tools share intermediate report filenames. The historical reproducers in tools/plugin-audit/historical target the pre-fix commits and are retained as evidence, not as post-fix assertions. The auxiliary root marketplace.json in Awesome Claude Plugins is display metadata, not a loaded manifest.

## Scope and limits

This combines structural review, targeted source inspection, fault injection and existing regression suites. It does not establish that every third-party integration, generated website or native desktop action is bug-free. Network service operations, browser overlays, live desktop control, authenticated Claude Design and upstream fork synchronization require separate runtime exercises. Historical evidence records failures before the fixes; only the two linked final passes describe the shipped changes.

Baseline commits:

| Repository | Reviewed baseline | Outcome |
| --- | --- | --- |
| atelier | c1387191e0f3 | Fixes or consolidation published |
| awesome-claude-code-toolkit | ebdf1d596d2c | Fixes or consolidation published |
| awesome-claude-plugins | e521f7ada8d8 | Fixes or consolidation published |
| awesome-claude-skills | be2a406907db | Fixes or consolidation published |
| behisecc-acs | e3d2916d0c4f | Reference-only; no executable changes needed |
| buildwithclaude | d16bece4e351 | Fixes or consolidation published |
| cinematic-web-design | 763dc5981d06 | Fixes or consolidation published |
| claude-code-usage-limits | 62ceb7a60a93 | Fixes or consolidation published |
| claude-computer-use | 6126e81d6233 | Fixes or consolidation published |
| jqs-acc | f78e2ee334de | Reference-only; no executable changes needed |
| travisvn-acs | 1da55aa810f2 | Reference-only; no executable changes needed |

Final scan inventory: 11 repositories, 4677 files, 389 JSON, 451 JavaScript, 179 Python, 2329 YAML blocks.
