# Parity with ChatGPT computer use, and what "better" actually means

Research, 8 September 2026. Two passes: OpenAI's shipped code as installed on
this machine, and the public record for OpenAI, Anthropic, Microsoft and the
2026 literature. Supersedes nothing in `2026-09-05-astra-computer-use-parity.md`
- it extends it against a newer bundled build (`26.901.51231`, 6 Sep) and adds
the public half that write-up did not have.

## The finding that reframes the whole question

The brief was "make it exactly like ChatGPT computer use, then better". The
research says the first half is the wrong target, and here is the evidence.

**OpenAI's desktop computer use is screenshot-and-coordinates.** Their own
documentation splits the macOS permissions as Screen Recording *"so ChatGPT can
see the target app"* and Accessibility *"so ChatGPT can click, type, and
navigate"* - vision to perceive, accessibility only to synthesise input. The
API tool is nine actions (`click`, `double_click`, `drag`, `move`, `scroll`,
`keypress`, `type`, `wait`, `screenshot`) and its only observation type is
`computer_screenshot`. There is no tree, DOM or element reference anywhere in
that schema. On this machine, `get_window_state` defaults to
`include_screenshot: true`, `include_text: false`, and returns
`accessibility: null`, with the guidance calling that *"the best default for
desktop apps with weak accessibility trees."*

**Anthropic split the same problem in two on 19 August 2026.**
`computer_toolset_20260801` stayed pixels-only - 17 members, coordinates in
screenshot pixel space. Alongside it shipped `browser_toolset_20260801`, which
reads the accessibility tree and hands out persistent `[ref_N]` handles. The
guidance is unambiguous:

> "Prefer references where the page has a usable accessibility tree. A
> reference survives layout shifts and reflows that make pixel coordinates
> fragile, and lets Claude act on controls that are hard to hit with a
> pointer."

> "A tree read of a typical page often costs fewer input tokens than a
> screenshot while giving Claude references it can act on immediately."

Playwright MCP has said the same for longer, in tighter words: token
efficiency, precision, speed, determinism - *"same structure = same
interaction"*. Microsoft Research published the fusion version in UFO2
(arXiv 2504.14603): UIA metadata and vision parsing in one control-detection
pipeline, plus a picture-in-picture virtual desktop so the agent and the human
work at once.

So this plugin is already on the side of that argument that three vendors
independently arrived at. Copying OpenAI's desktop design would be a
downgrade. Two things follow, and they are the actual plan:

1. Close the gaps where OpenAI genuinely does more (they are specific, listed
   below, and mostly small).
2. Fix the places where a tree-driven design is known to fail. That list is
   short, unforgiving, and is where "better" is really won.

## Where a tree-driven design fails, and what to do about it

This is the most useful part of the research, because these are defects that
look like nothing at all.

**The single worst property**: accessibility is opt-in at both the application
and OS-policy level, and the "off" state looks identical to "this app has no
UI". The API connects, the window is found, the tree is empty, and nothing
reports an error.

- **Electron and Chromium apps expose an `application -> frame` skeleton and
  nothing else** until the process is started with
  `--force-renderer-accessibility`. Measured elsewhere: VS Code reports **1
  node without the flag and 140 with it**. On Windows 1903+ the OS converts
  Chromium's IAccessible2 data into UIA, which is why this bites less here
  than on macOS and Linux - but it still bites.
  *Detection that works*: **CORRECTED 2026-09-14 - there is no UIA ToolkitName property; that was wrong. Use ClassName (Chrome_WidgetWin_*) or ProviderDescription.** Originally written as `ToolkitName == "Chromium"` plus a frame with zero
  filtered children means "the renderer bridge is off", not "no UI". We should
  say that in the result instead of returning an empty snapshot.
- **Canvas, WebGL, DirectX, video and remote-desktop surfaces have no tree at
  all.** Custom-drawn widgets report `ControlType.Custom`, which is
  indistinguishable from unimplemented accessibility.
- **Unnamed controls are present and useless.** An icon button with no
  accessible name is in the tree and cannot be identified.
- Virtualized lists and cross-origin iframes - Anthropic names the same set as
  its coordinate fallback.
- Qt: dialogs register as *separate UIA applications*, so they must be found
  app-wide rather than by walking down from the parent; spin box values cannot
  be set through the value pattern and must be stepped.
- Win32 legacy: `TrackBar` and `NumericUpDown` have no `RangeValuePattern`.

The published consensus for 2026 is that this is **a routing problem, not a
modality choice**: read the tree, detect that it is blind, and fall back
deliberately - saying so - rather than pretending a node was resolved.

## Gap table, against the bundled build 26.901.51231

Only the gaps. Everything not listed is already at parity or ahead.

| Gap | Theirs | Ours |
| --- | --- | --- |
| Adaptive settle before a read | automatic, and the model is told never to sleep | fixed 250-350 ms sleeps |
| `selected_text`, `selected_elements` | in every `WindowState` | absent |
| `document_text` | whole-document field | per-element truncation only |
| `paste` with format, restoring the clipboard | yes (native path restores) | `computer_clipboard` overwrites and does not restore |
| `select_text` with prefix/suffix and cursor placement | yes | absent |
| Named secondary actions | `perform_secondary_action` | folded implicitly into click |
| Batching with data flow | arbitrary JS in a REPL | declarative steps, no loops or captures |
| Keysym-grade key names (`KP_0`, `Return`) | yes | `ctrl+s` style only |
| Client-rendered approval prompts | MCP elicitation with session/always persistence | returns `not_granted` and trusts the model to ask |
| Structured tool output | n/a for them | plain text only |
| Progress notifications | n/a for them | absent |
| Audit trail with the state before each change | browser `getAuditTrail()` | journal has no before-state |
| Secure credential handoff (model never sees) | browser only | hard-blocked by design |

Where we are ahead, and it is not a consolation list:

- **Stable indices.** Their own guidance: *"Element indexes, screenshot IDs,
  and coordinates are valid only for the observation that produced them."*
  Ours are keyed on UIA RuntimeId and live as long as the element does.
- **Tree by default**, with the image as the opt-in - the inverse of theirs.
- **Delta re-reads** (~26 tokens for no change).
- **Coexistence.** Their API states *"input methods activate their target
  window automatically"*, and their error list contains `userIntervened` - it
  errors when the human acts. Ours posts input without raising the window.
- **Multi-session.** They have one (`noActiveSession`); we have leases.
- **Safety in code, not in a prompt.** Their send/pay/delete taxonomy is a
  markdown file the model may ignore; ours is regexes in `policy.mjs` that the
  model cannot talk its way past.
- **Element-level typed errors** (`element_stale`, `index_out_of_range`)
  against their 21 transport-level codes with nothing about elements.

## The plan, in order

Ordered by value per unit of risk, not by size.

1. **Blind-tree detection.** When a window's tree is a bare skeleton, say so
   and say why - Chromium without `--force-renderer-accessibility`, a canvas
   surface, a custom-drawn control - instead of returning an empty snapshot
   that reads as "nothing here". This is the single highest-value item because
   it converts a silent failure into an actionable one, and no competitor
   reports it either.
2. **`computer_paste` that restores the clipboard.** Today `computer_clipboard`
   destroys whatever the user had copied, which directly contradicts the
   coexistence claim. This is a bug, not a feature.
3. **Adaptive settle**: poll until the tree stabilises (two identical structural
   hashes, bounded) instead of sleeping a fixed 300 ms. Hash structure and
   names only, never volatile text, or an animation loops forever.
4. **`selected_text` and `document_text`** in the snapshot header. "What has
   the user selected" is what a prompt is usually about, and `document_text`
   reads a document without walking four hundred rows.
5. **Named secondary actions** - `Expand`, `Toggle`, `ScrollIntoView`,
   `RangeValue`. `ScrollIntoView` in particular scrolls an item into view
   *without moving the user's viewport*, which is a coexistence win their
   design cannot have.
6. **Keysym-grade key names.** Numpad-sensitive apps are undriveable today.
7. **Progress notifications** and **structured output** - both verifiably
   supported by the Claude Code binary (`notifications/progress`,
   `structuredContent`, `outputSchema` all present as strings).
8. **Elicitation-backed approval.** `elicitation/create` appears 39 times in the
   binary alongside the string "An MCP server needs your input". This would
   have the *client* ask the human, closing the hole where a model can re-call
   with `confirmed: true` without anyone being asked. Must degrade to today's
   behaviour when unsupported, and must be unreachable from a background run.
9. **`select_text`** with prefix/suffix, so existing text can be edited without
   select-all and retype.
10. **Expressive runs**: `for_each`, `capture`, `when`, `extract`. This is the
    widest capability gap - their tool is a JS REPL, so "fill thirty rows" is
    one call for them and thirty turns for us. **Do not ship a JS eval**: it
    would bypass `policy.mjs` entirely and is the one change that would make
    this plugin less safe than theirs. Keep it declarative so every generated
    step still passes the tier, grant, lease and consequence gates.
11. **Audit trail with before-state**, describing how to reverse a change
    rather than reversing it.

Deliberately not building: screenshot-by-default; audio loopback capture (off
by default even in their own build, and a privacy liability); Playwright or CDP
bridges (they would break the zero-dependency rule); page-asset export; WebMCP.

**Secure credential handoff** is the one item held back on purpose. It is the
only thing they do that our hard block cannot, and it creates a path where
input reaches a login surface. If it is ever built: non-blocked apps only,
never lifting the blocked tier, an elicitation per use, and item 8 as a
prerequisite. The hard block is a defensible product position and shipping this
badly is worse than not shipping it.

## What could not be verified

- Whether OpenAI's desktop computer use reads any accessibility tree. No
  statement exists either way; the permission split is strong circumstantial
  evidence that it does not.
- Whether Claude Code's `elicitation/create` support is wired for
  *plugin-declared* MCP servers specifically. Binary strings only - verify end
  to end before depending on it.
- Any OpenAI-published WindowsAgentArena score, or a refreshed OSWorld figure
  for GPT-6 Astra. The public Astra claim is "world's best computer use model"
  and "nearly 2x faster" - a speed claim with no accuracy number attached.
- OpenAI's canonical current computer-use model id: three live surfaces give
  three answers (`gpt-5.6-sol`, `gpt-5.4` on Azure,
  `computer-use-preview-2025-03-11` on the model page with no deprecation
  notice).
- The macOS host's real behaviour. It has still never been compiled.
