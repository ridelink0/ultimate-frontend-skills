# Astra parity, round two

2026-09-13. Supersedes the Sept 8 note on one central point.

## The correction

`docs/research/2026-09-08-computer-use-parity-and-beyond.md` concluded that
OpenAI's desktop computer use is "screenshot-and-coordinates", and listed as
unverified "whether OpenAI's desktop computer use reads any accessibility tree".

**That is wrong, and the newest build is accessibility-tree-first.** The evidence
is on this machine, in the bundled plugin cache at build `26.908.40834` (newer
than the `26.901.51231` the Sept 8 note diffed):

- `~/.codex/plugins/cache/openai-bundled/computer-use/26.908.40834/skills/computer-use/SKILL.md`
  says outright: *"It uses SendInput, UI Automation, and Windows.Graphics.Capture
  screenshots that work even when windows are occluded."*
- `docs/api.md` in the same package returns
  `AccessibilityState { tree, focused_element, selected_elements, selected_text, document_text }`,
  and `click`, `set_value` and `perform_secondary_action` all take `element_index`.
- The helper binary `codex-computer-use.exe` imports `uiautomationcore.dll` and
  carries `src/accessibility.rs`, `src/accessibility/monitor.rs`, `cycle`,
  `child_limit`, `max_depth`, and a compact lowercase role vocabulary.
- The next-generation unified API doc is explicit: *"prefer element index based
  actions over coordinate actions whenever an accessibility element is
  available. If AX actions are not available or not working, fall back to using
  screenshots and coordinate actions."*

The earlier permission-split inference (Screen Recording to see, Accessibility to
click) was circumstantial, and their own shipped code contradicts it.

**The strategic consequence is the opposite of the Sept 8 read.** That note said
"do NOT copy them". In fact OpenAI's newest surface, Anthropic's
`browser_toolset_20260801`, and Google's `chrome-devtools-mcp` have all
independently converged on tree-first targeting with coordinates as the
documented fallback. This plugin's architecture was right, and the field moved
onto it. The work now is not to resist the convergence but to close the
remaining gaps inside it.

## Where this plugin is already ahead

- **Stable refs.** Our RuntimeId-keyed indices survive across snapshots. Astra's
  `api.md` warns *"Element indexes are valid only for the accessibility state
  that produced them"* - they re-number every snapshot and force a re-read after
  every action.
- **Diffing.** We already return diffs from the previous tree (~400 tokens first
  read, ~26 on an unchanged re-read). Astra's unified API adopted the same idea
  and made it the default, which is confirmation rather than competition.
- **Popups and menus.** We enumerate `#32768` / `ComboLBox` /
  `Xaml_WindowedPopupClass` / `Chrome_WidgetWin_2` with their `GW_OWNER`. Astra's
  own guidance is weaker: *"If you expect a modal in the target app but
  get_window_state does not show it, call sky.list_windows() to find the modal."*
- **Wrong-window and wrong-desktop guards.** `RootWindowAt()` before every
  click/drag/scroll, plus `DWMWA_CLOAKED` and
  `IVirtualDesktopManager::IsWindowOnCurrentVirtualDesktop`. Astra's binary has a
  bounds check and one virtual-desktop string, for positioning its own overlay.
- **Occlusion capture.** `PrintWindow(PW_RENDERFULLCONTENT)` was the right call
  and should not be re-litigated. Astra uses Windows.Graphics.Capture, which is
  unreachable from in-box `csc.exe`; PW_RENDERFULLCONTENT is documented to cover
  hardware-accelerated Chromium, Electron and UWP, which is the whole reason WGC
  would have been wanted. Chromium's own `ui/snapshot/snapshot_win.cc` uses the
  same flag for the same reason.

## The Electron blind-tree problem, with the actual mechanism

This is the highest-value item, and the folklore about it is mostly wrong.
Verified against current Chromium `main`.

Chromium does not have an accessibility on/off boolean. It has `AXMode` bits, and
each escalates on a *specific* API call. The Windows handshake is **two parts**,
and either half alone does nothing:

1. `WM_GETOBJECT` with `lParam == 1` - the screen-reader honeypot object id.
2. An actual **name** property read on a node inside the web content.

From `ui/accessibility/platform/ax_platform.cc`:

```cpp
void AXPlatform::OnScreenReaderHoneyPotQueried() {
  // We used to trust this as a signal that a screen reader is running, but it's
  // been abused. Now only enable accessibility if we detect that the name is
  // also used.
  if (screen_reader_honeypot_queried_) return;
  screen_reader_honeypot_queried_ = true;
  if (is_name_used_) OnPropertiesUsedInWebContent();
}
```

For a UIA client the cheapest escalation is
`GetPropertyValue(UIA_NamePropertyId)` or `UIA_ControlTypePropertyId` on a web
content node. Reading `BoundingRectangle`, `IsEnabled`, `RuntimeId`,
`ProcessId` or `HasKeyboardFocus` will **never** wake it - they are on an
explicit no-escalation list, because non-screen-reader UIA clients touch them
routinely.

Three holes in our current `EnableWebAccessibility()` (`AxonHost.cs:1125`):

1. It sends `OBJID_CLIENT` (0xFFFFFFFC) and `-25`, but never the documented
   honeypot lParam of `1`.
2. It targets `Chrome_RenderWidgetHostHWND`, the *legacy* render-widget window,
   which modern Chromium may not create at all now that native UIA is on by
   default. Broaden to every `Chrome_*` child plus the top level.
3. Even with the honeypot, nothing follows up by reading a name inside web
   content, so the second half of the handshake never happens.

That combination explains the README's own measurement (VS Code: 1 node without
the flag, 140 with) - the probe is firing and achieving nothing.

`--force-renderer-accessibility` also takes a value
(`basic|form-controls|complete|screen-reader|on-screen`); with no value it grants
`kAXModeComplete | kScreenReader` and leaves changes allowed. Note too that
hidden WebContents get accessibility **auto-disabled after ~5 minutes**, which
matters for an app left backgrounded between turns.

**macOS is a clean, total gap.** `AxonHost.swift` has no `AXManualAccessibility`.
It is an Electron invention (not Chromium), Electron's old `kAXErrorAttributeUnsupported`
bug is fixed, and the attribute is now advertised:

```swift
AXUIElementSetAttributeValue(axApp, "AXManualAccessibility" as CFString, true as CFTypeRef)
```

One call, and every Electron app on the Mac host opens up.

`ELECTRON_FORCE_WINDOW_ACCESSIBILITY` **does not exist** - zero occurrences
anywhere on GitHub. Anything built on it should be deleted.

## Settling

Astra's is a fixed 100 ms post-action deadline (`action_settler.js`: every action
calls `defer()`, the next observation waits to the deadline). We can beat that
outright.

The defensible design is Playwright's, not a pixel diff: *"stable when it has
maintained the same bounding box for at least two consecutive animation frames"* -
diff **geometry from the tree**, which is cheaper than pixels and immune to
cursor blink, spinners and video. No primary source documents a pixel-diff
settling algorithm; it is folklore.

Astra does have real event machinery behind the fixed delay
(`src/accessibility/monitor.rs`: `accessibilityRevision`, `snapshotRevision`,
window-opened readiness, `StructureChanged`, and *targeted* refresh rather than
full re-walks). We have no `StructureChanged` or `SetWinEventHook` at all.

## Ranked, with difficulty

1. **Fix the Chromium/Electron handshake** - add honeypot lParam `1`, broaden the
   target windows, and follow with a name read inside web content. Then measure
   node counts on VS Code before and after. *Low; the cost is the bench test.*
2. **macOS `AXManualAccessibility`** - one call in `AxonHost.swift`. *Low, though
   the Swift host has still never been compiled.*
3. **Adaptive settle** - poll to two identical structural hashes, bounded,
   hashing structure and names only. *Low-medium, pure host logic.*
4. **`selected_text` and `document_text` in the snapshot header** - lets the model
   answer "what did the user select" and "read this document" with no tree walk.
   *Low-medium; the `TextPattern` plumbing exists.*
5. **UIA cache requests (bulk fetch)** - `CreateCacheRequest` + `FindAllBuildCache`
   replaces thousands of cross-process property calls with one. This is the
   direct answer to WindowsAgentArena's complaint that a UIA query "can take from
   a few seconds up to several minutes". *Medium, and the biggest latency win
   available.*
6. **Named secondary actions** - `Expand`, `Collapse`, `Toggle`, and especially
   `ScrollItemPattern.ScrollIntoView`, which reaches an off-screen item without a
   wheel event. We have `ScrollPattern` but not `ScrollItemPattern`. *Low-medium.*
7. **`select_text` with prefix/suffix and cursor placement** - edit existing text
   without select-all-and-retype. *Medium.*
8. **Screenshot-id-bound coordinates** - a coordinate action carries the id of the
   screenshot it was read from, so a stale coordinate fails loudly instead of
   misclicking. *Low.*
9. **Guarded input on user touch** - Astra hard-fails the next action in a window
   a human just touched. Our presence/lease machinery already has the inputs.
   *Low-medium.*
10. **UIA event subscriptions driving a revision counter** - unchanged windows
    skip the walk entirely and `wait_for` stops polling. *Medium-high; needs an
    MTA worker thread.*
11. **Layered screenshots with z-index** - window and each popup as separate
    ordered images with screen origins. *Medium.*
12. **Default screenshot scaling targets** - enforce XGA/WXGA/FWXGA-style
    downscaling rather than relying on `max_width` being passed. Note the
    computer-use trap: the API *rejects* an oversized `tool_result` image instead
    of downscaling it. *Low.*

**Set-of-Marks is a real differentiator but not a free win.** We already have
every rect and index, so the marks cost nothing to draw, and neither Astra nor
Anthropic ships it. But OSWorld measured SoM *below* screenshot+a11y on desktop
(11.77% vs 12.17%), attributing it to desktop screens having far more elements,
and WindowsAgentArena blames errors on "imprecise SoM bounding box boundaries".
Worth building behind a flag and measuring; not worth assuming.

**Explicitly not recommended:** Windows.Graphics.Capture (our PrintWindow choice
is correct), audio capture (Astra has it, undocumented, off by default - a
privacy liability), a CDP or Playwright bridge, and above all **do not ship a JS
eval**. Astra's power comes from a JS REPL against a typed API; copying that
would route every generated step around `policy.mjs`. If we want expressive runs,
they stay declarative (`for_each`, `capture`, `when`) and every step still passes
tier, grant, lease and consequence gates.

## Unverified

- Any published ablation isolating a11y-tree vs screenshot vs hybrid on
  WindowsAgentArena/OSWorld beyond the OSWorld Table 5 numbers quoted above.
- Measured SoM gains for desktop rather than web agents.
- Whether the honeypot lParam of `1` unblocks Electron specifically: Electron PR
  #7611 narrowed its own check to `OBJID_CLIENT` and latches after the first
  probe, so a wrong first probe may poison the window permanently. Needs a bench
  test, not more reading.
- Antigravity's native browser tool schema; Google publishes no tool names.
