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
