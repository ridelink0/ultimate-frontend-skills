# Gev plugin hardening and consolidation

Status: active, 2026-11-01. No completion or directory clearance claimed.

Latest steering: at least TEN newly added integrations, including Remotion as a UFS video skill/plugin. Also ship link-preview and deep-research skills; connect link-preview work to image research. Separate image-origin provenance from visual quality: appearance cannot establish AI origin.

Verified parent work: baseline UFS fast suite 191 passed, 69 browser checks explicitly skipped, zero failures. Suite integrity fixture checks pass 4/4 including image hash drift, duplicates/version drift, traversal/extra payloads and directory junction escape. Edge is available for full headless checks. Parent commits 3b30c89 and b057d96 save the suite checker and cross-platform CI; real combined suite validation awaits imports.

Live shared allowance reached 94% used. Gev's standing below-ten-percent rule requires stopping new work and preserving this handoff. UFS agent was instructed to save its current source, notes and explicit gaps immediately. Do not call any unfinished skill, upstream qualification, full-browser sweep or directory submission complete.

## Reset continuation checkpoint

- Suite HEAD before this handoff: 18d2f1b, with image and usage histories imported through git subtree (no squash).
- Image source commit: 88c9f7ad0500edec0eec911185bd3a9f57c256de, local tag v1.2.0 in D:/plugin-work-1101/image; source branch clean. Full 57/57 tests, zero skips; separate adversarial network 5/5. Captures inspected by its agent. Local-only tag, no remote release or push.
- Bundled UFS image skill synced via syncFrom with explicit canonical DEFAULT_REPO and v1.2.0; commit 6ba29c8. First sync exposed a .git URL mismatch; corrected through sync tool. Parent image-lock plus suite fixture tests now 11/11 passed. New network.mjs is included.
- Usage source commit: 9e0ca364e0357bdb9d382f3b2ee729ac4e65553b, source branch clean. Full 995 passed / zero failed / three skipped, adversarial 64 passed / zero failed / one skipped. Native GUI account switches, scheduled wake and portal not verified. Imported at plugins/usage-limits. Release version remains 1.43.2 and needs a coherent bump before publishing.
- UFS additions are in D:/plugin-work-1101/ufs on gev/ufs-hardening-1101. At last read this branch was not yet committed; check its HEAD, status and WORK-PLAN before merging. Do not lose uncommitted source. Agent asked to save immediately at94%.
- No remote push, PR, public merge, package publish, host installation, developer portal validation/resubmission, or Atlias compatibility qualification has occurred in this session.

## Exact next steps

1. Check live usage, all four worktrees and research notes. Preserve original dirty UFS tree. Read final UFS agent result if present, then merge its saved branch into suite; inspect before accepting.
2. Complete and verify the latest scope: ten NEW integrations including Remotion, link-preview/deep-research skills, terminal/sound/dashboard/motion workflows, truthful provenance and component coverage. Inspect UFS tests and the actual downloaded source/license pins. Do not label source-inspected upstream repositories as clean-built functional repositories.
3. Root .claude-plugin/marketplace.json still needs explicit independently selectable usage-limits -> ./plugins/usage-limits and image-deep-research -> ./plugins/image-deep-research entries with their actual versions. UFS entry remains first. Root test/commands.test.mjs scans every generic version field in that marketplace as a UFS version; adapt that test to check UFS only while suite-check validates each child against its own manifests.
4. Bump Usage Limits release coherently using its tools/sync-version.js; update child marketplace if required. Review release metadata and preserve all licenses/provenance. Add source commit mapping and consolidation/install docs. Standalone image skill overlaps with UFS; document choosing one rather than automatically disabling unrelated plugins.
5. Run node scripts/suite-check.mjs on real imported tree, then functional/full browser tests and independent adversarial checks. Edge and ffmpeg are installed. Parent .github/workflows/plugin-suite.yml is committed for usage/image multi-OS coverage, but has not run on GitHub. Root original UFS CI already covers its browser suite.
6. Atlias audit remains pending. Before ANY Atlias proposal/review read D:/harness-work/atlias-evolve/RESEARCH-FIRST.md completely, WORK-PLAN top block and atlias-work skill, then run its status script. Parent read was truncated, so it does not qualify as full research-first. Never touch live loop or reinstall removed brand band.
7. Coordinate final cited report writer from notes after gaps are closed, and write the improved implementation prompt. Research notes image.md/usage.md exist; ufs.md may be pending.
8. Review exact commits, use GitHub connector or CLI to push ready branches, inspect CI, create/merge only own ready PRs using tested SHA lease. Update canonical single repository. Public release/install, directory submission, deployed behavior and native-host tests must be verified independently. Do not claim done until completed.

## Scope and ownership

- Canonical destination: ridelink0/ultimate-frontend-skills, preserving UFS at root.
- Integrate Usage Limits under plugins/usage-limits and standalone image research under plugins/image-deep-research. Preserve histories, licenses and existing entry points; do not delete old repositories.
- Parent integration worktree: D:/plugin-work-1101/suite, branch gev/plugin-suite-1101, baseline eaad5f2.
- UFS worktree: D:/plugin-work-1101/ufs, branch gev/ufs-hardening-1101.
- Usage worktree: D:/plugin-work-1101/usage, branch gev/usage-hardening-1101, baseline 8ec2fa0.
- Image worktree: D:/plugin-work-1101/image, branch gev/image-hardening-1101, baseline 1dbe2cb.
- Original C:/Users/OWNER/cinematic-web-design has extensive concurrent uncommitted work. Preserve it. Do not modify original Usage Limits runtime configuration.

## Current findings and next work

1. Usage agent confirmed relay trust/bypass writes. Remove plugin-granted permissions, preserve native prompts; fix accounting, identity refresh and fit contract; add regression checks.
2. UFS agent confirmed tracked bytecode and Node floor mismatch. Ship readable source; add package gate, five useful integrations and terminal/sound/dashboard/motion skills plus practical reference diagnostics.
3. Image agent confirmed unbounded downloads, redirect/private-host exposure, permissive rights booleans and misleading capture measurements. Fix upstream with adversarial tests, then sync via released tag and lock.
4. Parent: review all diffs; consolidate tested commits preserving history; add combined CI/package/install checks; verify compatibility without touching live Atlias loop; prepare improved implementation prompt and cited report.
5. Run functional pass, then independent adversarial hunt. Never tsc. Browser results count only when actual images are opened. Never claim 500/1000 concurrent agents: this session has four slots total.
6. Push/merge only the exact tested ready PR SHA after checking current remote state. Native-host discovery, directory resubmission and deployment remain unverified until executed.

## Research and relay

Notes: C:/Users/OWNER/research_notes/Frontend plugin release hardening/.
Final report: C:/Users/OWNER/reports/Frontend plugin release hardening.md (not yet written).
Source checkpoint: C:/Users/OWNER/.codex/attachments/042c9388-9020-43fd-9fbe-66b7a1eb063d/Pasted text.txt.
Heartbeat: continue-gev-plugin-hardening, same chat, 13:14:59 America/Chicago daily; first wake is seven minutes after measured 2026-11-01 13:07:59 CST reset. Read saved automation.toml after every reschedule. Preserve any existing daily 21:20 wake.

C:/Users/OWNER/WORK-PLAN.md is unrelated older Atlias work. Do not use it as this task's handoff.
