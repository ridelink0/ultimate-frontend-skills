# UIA implementation detail, and what users actually complain about

2026-09-14. Follows the Sept 13 note (Astra is tree-first). This one is the
level below: exact API contracts for the ranked items, plus a survey of what
people actually file issues about across nine agent-control projects.

## Correction to the Sept 8 note

`docs/research/2026-09-08-computer-use-parity-and-beyond.md:72` prescribes
`ToolkitName == "Chromium"` as the blind-tree signal.

**There is no `UIA_ToolkitName` property.** It does not appear anywhere in the
Windows property-identifier list; `ToolkitName` is an IAccessible2/ATK concept.
On Windows the equivalents are:

- `UIA_FrameworkIdPropertyId` (30024) - Learn's own examples are "Win32",
  "WinForm", "DirectUI". Chrome's actual value is UNVERIFIED.
- `UIA_ClassNamePropertyId` (30012) - `Chrome_WidgetWin_1/2`, which
  `IsChromiumWindow` already uses correctly.
- `UIA_ProviderDescriptionPropertyId` (30107) - documented as the "source
  information of the UI Automation provider ... including proxy information",
  which distinguishes a native provider from the MSAA-to-UIA proxy. That is the
  closest thing to a real blind-tree signal.

## The Chromium handshake, and the half that was missing

This is the highest-value finding and it is now fixed in
`server/native/AxonHost.cs`.

Chromium does not have an accessibility on/off switch. It has `AXMode` bits,
and each one escalates on a *specific* API call. The Windows sequence needs
**both** of:

1. `WM_GETOBJECT` with `lParam == 1` - the screen-reader honeypot id. From
   chromium.org: *"Chrome calls NotifyWinEvent with EVENT_SYSTEM_ALERT and the
   custom object id of 1. If it subsequently receives a WM_GETOBJECT call for
   that custom object id, it assumes that assistive technology is running."*
2. An actual **name** property read on a node inside web content.

`ax_platform.cc` is explicit that the honeypot alone is no longer trusted -
it *"has been abused"* - and now also requires `is_name_used_`. Either order
works; both are required.

`EnableWebAccessibility()` was sending `OBJID_CLIENT` (-4) and the UIA root
(-25) and **never the honeypot**, so the handshake never completed. Reading
`BoundingRectangle`, `IsEnabled`, `RuntimeId` or `ProcessId` will never
complete it either - those are on Chromium's explicit no-escalation list,
because ordinary UIA clients touch them constantly.

It also only poked `Chrome_RenderWidgetHostHWND`, the **legacy** render-widget
window, which current Chromium may not create now that native UIA is on by
default.

**MEASURED, 2026-09-14 — and it corrects two claims above.**

A direct UI Automation probe against a live Electron window (VS Code,
`Chrome_WidgetWin_1`), counting descendants before and after each poke:

```
BEFORE any poke      : 13 descendants
AFTER old probes only: 9976 descendants   (OBJID_CLIENT -4, UIA root -25)
AFTER honeypot + name: 9977 descendants   (+1, noise)
```

So:

1. **The blind tree is real.** 13 nodes is a window with its entire contents
   invisible, and that is what a client sees before any probe.
2. **The existing two probes already unblock it on this build.** The claim
   above — that OBJID_CLIENT and the UIA root do not trip Chromium and only
   the honeypot id does — is NOT true here. They were sufficient on their own.
3. **The honeypot changed nothing measurable.** It is kept because it is
   documented, free, and may matter on builds where the other two are ignored,
   but it should not be described as the fix for anything observed.

An earlier draft of this note claimed a measured baseline of 13 nodes for an
Opera window with the page absent. That was wrong: the snapshot in question
reported `TRUNCATED` against a `max_nodes` of 40 that the reader had set. It was
truncation being misread as blindness. The numbers above replace it.

## UIA cache requests: what is legal

The batched fetch in `SnapRequest()` is already right in shape (measured
724ms to 47ms). The corrections are about what may go in it:

- **`TreeScope_Parent` and `TreeScope_Ancestors` are not permitted.** Learn:
  *"It is not possible to set the scope to TreeScope_Parent or
  TreeScope_Ancestors"*, and *"You cannot cache parents or ancestors of the root
  element of the request."* `put_TreeScope` documents no error return, so an
  illegal scope is undefined behaviour, not a testable failure.
- **`TreeScope_Element` must be included** or the root element itself is not
  cached.
- **`AutomationElementMode.Full` must stay.** Under `None` the elements carry no
  reference to the live UI: no current properties, no `GetCurrentPattern`, and
  no `Invoke`. This host invokes and types into the same elements it reads, so
  `None` is not available to it.
- Reading a property that is not in the cache raises
  `InvalidOperationException` ("The requested property is not in the cache"),
  not a null. `TryGetCachedPattern` returns false rather than raising.
- **TreeWalker ignores an ambient cache request** - it caches only when a
  `CacheRequest` is passed as an explicit parameter.
- **An event subscription freezes its cache request at subscribe time.**
  Changes afterwards have no effect.

Worth adding to the existing request, all cheap: `HelpText` (where placeholder
text lives), `IsDialog`, `ClassName`, `FrameworkId`, `ProviderDescription`,
`FullDescription`, `ControllerFor` (the documented auto-suggest mechanism),
`LabeledBy`.

## TextPattern: the traps

- `FindText` returns **NULL in the out-pointer with S_OK** when nothing matches,
  deliberately, *"to avoid confusion with a discovered range versus a degenerate
  range"*. Test the pointer, never the HRESULT.
- The caret **is** a degenerate range. `GetSelection` with no selection returns
  one, and so can `RangeFromChild` and `GetVisibleRanges`.
- Only `Character` and `Document` units are guaranteed. `ExpandToEnclosingUnit`
  and `MoveEndpointByUnit` **silently degrade to the next largest supported
  unit**, so asking for `Word` can quietly get a `Line`.
- `ExpandToEnclosingUnit` is misnamed: it normalises, and will *shorten* a range
  that is longer than the unit.
- Check `SupportedTextSelection` before `GetSelection`/`Select`; `None` means
  they may not be implemented at all. `AddToSelection` needs `Multiple`.
- **TextPattern cannot be cached.** Use `DocumentRange` + `GetText(-1)` once,
  bounded, rather than walking units - each call is a cross-process hit.

## UIA events: why they are ranked last

The threading rules are sharp enough to outweigh the gain:

- Handlers must be registered from an **MTA**, non-UI, window-less thread.
  `Overlay.cs` runs STA, so nothing may be registered from there, and `Main`
  needs an explicit `[MTAThread]` rather than relying on the CLR default.
- Calling back into UIA *from inside* a handler is explicitly **safe** - the
  documented hazard is the reverse, UIA on a UI thread.
- Do not add or remove handlers from more than one thread.
- An event can arrive **after** unsubscribing; the handler object must outlive
  the unsubscribe or it is an access violation.
- **Focus events cannot be scoped.** `AddFocusChangedEventHandler` takes no
  element and no scope - it is system-wide. For a tool built on per-app grants
  and a separate virtual desktop, that is a coexistence and privacy problem, not
  just an implementation detail.
- `UiaDisconnectAllProviders` is **provider-side** and the wrong layer for this
  host. `RemoveAllEventHandlers()` is the client call.

The measured win over the existing 47ms cached walk is small; the failure mode
(a hang in a component meant to be invisible) is severe. Adaptive settle via
repeated cheap cached walks gets most of the benefit at none of the risk.

## Multi-monitor and DPI

The host already does this correctly - PMv2 first, graceful degradation, set
before any UI - and the correctness is load-bearing:

> "Consider two applications, one has a PROCESS_DPI_AWARENESS value of
> PROCESS_DPI_UNAWARE and the other has PROCESS_PER_MONITOR_AWARE ... If both
> apps call GetWindowRect on this window, they will receive different values."

UIA `BoundingRectangle` is **physical** screen coordinates; `GetWindowRect`,
`CopyFromScreen` and `SetCursorPos` are **virtualized** for a non-aware caller.
Mixing the two gives a plausible-looking wrong click on the second monitor and a
correct one on the first - the hardest class of bug to diagnose, and the cause of
the coordinate-drift complaints below.

Two things NOT to do, both of which look like improvements:

- `PhysicalToLogicalPointForPerMonitorDPI` is a **no-op under PMv2** ("logical
  and physical coordinates are identical"). Adding it would introduce a bug.
- `SendInput` with `MOUSEEVENTF_ABSOLUTE` in place of `SetCursorPos`: *"In a
  multimonitor system, the coordinates map to the primary monitor."*
  `SetCursorPos` takes real screen coordinates including negative ones, which is
  why it is right.

The untested gap is the **negative-origin** secondary monitor. Full-desktop
capture already uses `SystemInformation.VirtualScreen` and reports the negative
origin in `source`, which is correct; what is unverified is whether every
consumer re-adds it, and how `PrintWindow` behaves at x = -1920. This is an
ecosystem-wide blind spot - one competing project states publicly that they
could not assemble a rig to test it.

## What users actually complain about

Surveyed across claude-code, playwright-mcp, browser-use, trycua/cua,
Windows-MCP, UI-TARS-desktop, Skyvern, OpenAdapt and computer-use-mcp. Counts
are distinct issues surfaced, not exhaustive.

1. **Permission plumbing that fails outright** (~35). Not prompt fatigue - the
   grant genuinely cannot be obtained. The design lesson: when fine-grained
   consent breaks, users fall back to blanket standing grants. **Broken
   fine-grained permission is worse than none, because it trains people to grant
   everything.**
2. **Coordinate drift** (~20, and present in *every* repo). DPI mismatch between
   the capture path and the input path; stale bounds across a re-render.
3. **Token burn from snapshots and screenshots** (~18). Note the contested
   point: Playwright maintainers *removed* delta snapshots as "inefficient in
   practice". Their users disagree loudly. This host's diffing is a
   differentiator, not a copy.
4. **The element is not in the tree at all** (~16). Canvas, WebGL, and blind
   Chromium trees. Users never say "Electron" - they say "it can't see my app".
5. **Silent success - reported done, nothing happened** (~13).
6. **Screen takeover and focus stealing** (~14). Non-focus-stealing operation is
   this plugin's existing differentiator and the demand for it is documented.
7. **Multi-monitor** (~12), including one project's single most-commented issue.
8. **Capture broken - black, gray, masked** (~10).
9. **Repeating the same failed action** (~5).
10. **Speed** (~7, rarer than expected). INFERENCE: users experience slowness as
    *cost* and as *looping*, not as latency. Do not over-invest in raw speed.

**The meta-finding.** The dominant complaint is not "the model picked the wrong
element". It is **"the plumbing lied to me"** - themes 1, 2, 5 and 8 are all the
same complaint, that the tool's self-report did not match reality with no error
raised. Reporters are measurably angrier about silent success than about
outright failure. That is the bar this host should hold itself to, and it is why
the note above refuses to mark the Chromium fix done before it has been measured.

The top feature request that does not exist anywhere: **automatic vision
fallback when the tree misses**. Nobody wants to choose between tree and
screenshot. Set-of-Marks - numbered marks drawn on the capture using the same
indices the tree uses - is the honest answer to that and to theme 4, and is
literally filed as a feature request against playwright-mcp. Everything needed
to build it is already linked into the host: `Overlay.cs` already measures text
and draws rounded-rect badges. The one trap is draw order - marks must be drawn
*after* the bicubic downscale, or a 9pt number is resampled into mush.
