---
name: ui-pro-max
description: Refine complex product workflows with task-first states, platform conventions, accessible primitives, original mock UI examples and a controlled UI UX Pro Max handoff. Preserves an existing product's identity.
---

# UI Pro Max workflow layer

This is UFS's original workflow guide, not an Apple product or a fork of UI UX
Pro Max. Read the main UFS `references/workflows.md`. Existing product identity,
platform conventions and a supplied Claude Design canvas take precedence over
house defaults. Do not impose a universal premium template on every subject.

Use installed `apple-design` for platform conventions and the optional
`nextlevelbuilder/ui-ux-pro-max-skill` pack for its domain. Assign one owner to
each decision; do not load conflicting direction packs or change enabled
plugins automatically. `packs --dry-run --only <id>` previews the explicit
source install. Adding a catalog entry never installs a runtime or approves a
tool call.

Build the real happy path, then loading, empty, error, disabled, retry and
permission states. Mock data stays labeled mock; never invent social proof.
`assets/workflow.html` is an original local mock library for a searchable task
table, accessible native dialog and form validation. It makes no network calls
and does not implement a production backend. Serve it to inspect its behaviors.

Ask about the user's role and primary task only if missing. Present concrete
working files, not design reasoning. Test the operation end to end, then hunt
for keyboard traps, race conditions, long labels and clipped narrow screens.
