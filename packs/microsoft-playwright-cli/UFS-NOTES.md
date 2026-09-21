# microsoft/playwright-cli - vendored copy

Upstream: https://github.com/microsoft/playwright-cli at 74354ec
Licence: Apache-2.0 (file kept beside this note)
Copied: 2026-09-21
Skills: playwright-cli

This is the copy packs --install uses when the pack is absent; --upstream installs the original instead.
Everything changed from upstream is listed below so the author can take it back or ask for it out.

## Improvements

Every entry names the file and the reason. Upstream commit 74354ec was cloned and grepped to check each claim; nothing below is guessed.

- `README.md`, "Configuration via env": added a note that the whole table is `PLAYWRIGHT_MCP_*` (the playwright-mcp server's configuration) and that the CLI source at this commit reads only `PLAYWRIGHT_CLI_INSTALLATION_FOR_TEST`. docs/research/2026-09-20-packs.md flagged the table as MCP documentation leaked into the CLI doc; the grep confirmed it (`PLAYWRIGHT_MCP_` occurs in README.md and nowhere else in the repository).
- `playwright-cli/SKILL.md`, Core: `snapshot` and the three `find` examples were listed here and again under Snapshots with the options that matter. Kept the detailed copy; the Core list points at it. Fewer tokens on every load, one place to read.
- `playwright-cli/SKILL.md`, DevTools: removed the `show --annotate` one-liner; the Interactive session example documents the same command and says when to use it.
- `playwright-cli/SKILL.md`: new section "Beside ultimate-frontend-skills" - `show --annotate` as the escalation after a headless `look`/`quality`/`parity` pass, `set-reduced-motion reduce` as the same emulation `debug --motion reduce` uses, `--raw snapshot` diffs as the proof an interaction changed the tree, the PR attach handoff, and a pointer to the Windows `&` section. These are the five improvements the research listed for this pack, written where the model reads them.
- `playwright-cli/references/pr-attachments.md`: the `--attach` examples now open with a `gh --version` precondition. On this machine `gh` 2.98.0 (2026-08-20) has no `--attach` flag; whether 2.99 exists and carries it is UNVERIFIED here, so the upstream claim is kept and attributed rather than removed.
- Not changed: the Windows `&`-in-URL section. The research asked for the gotcha to be repeated wherever a URL is shelled; upstream already carries it in SKILL.md, so the new section links to it instead of duplicating it.
- Not changed: `LICENSE`.
