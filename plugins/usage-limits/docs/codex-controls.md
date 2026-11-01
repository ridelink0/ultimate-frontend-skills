# Codex usage and controls

Usage Limits reads Codex account windows and estimates remaining turns from local measurements. Refresh with `node bin/cli.js --host codex --refresh --status`. Readings are account-wide; other tasks and review activity can consume the same allowance. Estimates are not reservations or a guarantee that a long job will fit.

`node bin/cli.js lowpower status --host codex` reads top-level defaults.
`node bin/cli.js lowpower on --host codex --effort low` saves a lower effort.
Add `--model <supported-model-id>` to set an explicit model. Use an ID and effort supported by your host/account; this offline editor does not establish model availability.
`node bin/cli.js lowpower off --host codex` restores the previous settings.
`--dry-run` previews on/off without writing.

Only top-level `model` and `model_reasoning_effort` in `CODEX_HOME/config.toml` are managed. Other tables remain intact. A restore file and first-change backup support recovery. Manual edits to managed keys are detected before further changes. Multiline TOML is deliberately refused by the small editor: use the host controls for that config.

These defaults apply to new sessions. They cannot switch an active task's model or effort. Profiles, environment and CLI overrides can take precedence. Use the running host's model/effort controls for the current task. Recommendations under Codex do not suggest Claude model families or Claude slash commands.

Explicit `--host codex` selects Codex; `--host claude` retains Claude settings support. Automatic host detection uses the same rules as the usage reader. No usage-reset credit or paid overage is consumed by these controls, and no panel/statusline behavior was changed in this release.

Verification uses isolated homes, explicit models and on/off round trips, leaving the auditor's live defaults untouched.
