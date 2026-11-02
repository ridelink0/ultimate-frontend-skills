# Gev Usage Limits hardening

Status: implemented and locally verified on isolated branch `gev/usage-hardening-1101` from `8ec2fa0`. Original checkout and installed configuration were left untouched.

Done:
- Removed trust and bypass-acceptance writes from relay arming/waking; startup diagnostics are read-only.
- Removed every plugin-selected Claude permission mode, including legacy saved modes; unattended approval requests are denied by Claude's documented print-mode flag.
- Scoped live freshness/backoff, brief caches, corrected readings and status feeds by account. Discarded in-flight responses when login tokens change and prevented out-of-order view refreshes.
- Added latest-response input/output and separate cache counters with explicit unknowns and provider-specific subset accounting.
- Replaced unconditional fit promises with evidence-based `fits` or literal `it may not fit`; retained measured effort advice.
- Updated safety and user documentation plus focused regressions.

Verification:
- Functional pass: `node --test` — 998 tests, 995 passed, zero failed, three skipped; full output `D:/plugin-work-1101/usage-full2.tap`.
- Adversarial pass: 65 targeted tests, 64 passed, zero failed, one skipped; delayed account-response races, cache partitioning, legacy approval modes, malformed/unknown token fields, stopping matrix and child-process CLI entry points. Output `D:/plugin-work-1101/usage-adversarial.tap`.
- `node --check` passes on each changed runtime module and VS Code extension; `git diff --check` passes.
- Cited findings: `C:/Users/OWNER/research_notes/Frontend plugin release hardening/usage.md` (cache-engineering R2/Q2).

Next release qualification (parent owns): inspect commit, integrate, run GitHub multi-OS CI, publish/install verified release, then developer-portal validation/resubmission. No portal clearance, real account-switch GUI test, actual scheduled Claude wake or deployed release is claimed here. Existing user trust/permission grants were not revoked automatically. Codex's native login-switch behavior remains a separate host qualification item; this patch's identity regression fixtures target Claude.

Independent follow-up:
- Fixed Antigravity non-denial/error paths to request native user permission, following the installed official hook contract; no automatic grant is returned.
- Account-stamped learned estimates and recorded the observed switch boundary, excluding old-account spend even when both accounts have the same plan tier.
- Removed the repository-owned `.claude/settings.json` that automatically installed/updated the old remote plugin when opening a source checkout. No real host settings were edited.
- Tight-budget normal/terse instructions preserve the literal `it may not fit` contract; token details recognize Anthropic thinking and Codex cache-write fields without adding subsets twice.
- Native isolated qualification: Claude2.1.316 manifest validate/add/install/list succeeded (ICON_MISSING warning); Codex0.166.0-alpha.5.1 marketplace/add/list succeeded. Only Usage was installed. Antigravity1.2.6 version/help succeeded. All profiles and receipts are under `D:/plugin-work-1101/qualification-usage`.
- No live model call, live deny prompt, actual account login switch, scheduler launch, portal scan or deployment is claimed. Parent owns canonical privacy documents, release versioning and final imported-source checks.
- Follow-up functional pass: `node --test` — 1001 tests, 998 passed, zero failed, three pre-existing skips (`D:/plugin-work-1101/usage-qualified-full2.tap`). The skips are two POSIX `sh` quoting probes on Windows and the generated VS Code library drift check when no library has been built.
- Follow-up adversarial pass: 246 tests, all passed, zero skips (`D:/plugin-work-1101/usage-independent-adversarial2.tap`); changed-runtime syntax checks and `git diff --check` pass.
