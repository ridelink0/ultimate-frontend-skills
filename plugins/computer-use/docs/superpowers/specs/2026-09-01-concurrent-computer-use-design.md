# Concurrent, low-token computer use (0.3.0)

## Goal

Stop the snapshot -> look -> act -> snapshot cadence from costing a model turn and a
full tree read per step, and let Claude drive a window while the user keeps working
in another one, on Windows, without a second desktop.

## What changes

1. **Stable indices.** The host keys every element by its UI Automation RuntimeId
   and hands out one index per element per window, for the life of the window. An
   index seen once stays valid until the element is destroyed. `snapshot_id` is
   still accepted but no longer needed to act.
2. **Delta reads.** A second `computer_snapshot` of a window returns only the rows
   that changed since the last read (`+` added, `~` changed, `-` removed) plus a
   count of unchanged rows. `full:true` forces a listing; a listing is also forced
   when the filters differ, the last read is stale, or most of the tree changed.
3. **Scoped reads.** `computer_snapshot { index }` reads one subtree;
   `computer_snapshot { find }` returns only rows whose name, text, id or role
   match a string or `/regex/`.
4. **Waits that watch.** `computer_wait_for` accepts `text`, `gone`, `change:true`
   and `new_window:true` as well as `selector`. `change` returns the delta the
   moment the tree differs from what Claude last saw.
5. **Batched runs.** `computer_run { hwnd, steps }` executes a list of click / type
   / key / scroll / wait_for / snapshot / sleep / focus steps host-side, one MCP
   round trip, stops at the first failure, and ends with the delta since the run
   began. `background:true` returns a task id at once; `computer_task` reports
   progress or waits.
6. **Posted input.** `computer_type` on a window that is not in front posts
   WM_CHAR to the control instead of raising the window, verifies by reading the
   control back, and only falls back to real keystrokes when the control ignored
   the post. `background:true` on click posts mouse messages for controls with no
   pattern. Neither touches the cursor, the focus or the window stack.
7. **New-window notes.** Every action reports a window that appeared during it,
   so dialogs are seen without a listing call.

## Invariants kept

Grants, tiers, consequential-control confirmation, the presence gate, the session
input lease, the STA host thread, the 30 s call timeout and overlay exclusion are
untouched. Batched steps go through the same handlers as single calls.

## Tests

`tools/batch-test.mjs`: stable indices across reads, delta output, find, subtree,
each wait mode, run stop-on-error, background task, posted typing on a window
behind another. Added to `tools/test-all.mjs`. `tools/cli.mjs` drives the server
from a shell for real-app checks.
