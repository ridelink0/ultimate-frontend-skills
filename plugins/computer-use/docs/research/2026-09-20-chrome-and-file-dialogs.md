# Chrome integration + the three file gaps — research for computer-use

Date: 2026-09-20. Scope: (1) Claude in Chrome / Claude Code Chrome integration, (2) what
the plugin's own docs already say about it, (3) the three named gaps — file paste, file
open, file-dialog driving — with exact Windows APIs/automation ids, (4) how other agents
(Codex, Operator, Anthropic's own reference computer-use, Open Interpreter, UFO, Windows
Agent Arena, PyAutoGUI agents) handle the same three gaps.

All facts below are sourced; anything I could not confirm from a primary source is marked
**UNVERIFIED**. Two specific files the task asked me to read — the `chrome-browser` and
`built-in-browser` SKILL.md files from the "anthropic-skills" marketplace — are **not
present on this machine** (checked `C:\Users\OWNER\.claude\plugins\cache\` and
`...\plugins\marketplaces\`; only `computer-use`, `ecc`, `claude-plugins-official`,
`ultimate-website-skills`, `usage-limits`, `web-designer-marketplace` are installed) and
are **not in the public `anthropics/skills` GitHub repo** either (checked via GitHub API —
that repo's `skills/` directory has: academy-guide, algorithmic-art, brand-guidelines,
canvas-design, claude-api, discernment-nudge, doc-coauthoring, docx, frontend-design,
internal-comms, mcp-builder, pdf, pptx, skill-creator, slack-gif-creator, theme-factory,
web-artifacts-builder, webapp-testing, xlsx — no chrome-browser, no built-in-browser).
So section 1 is built entirely from code.claude.com/docs, support.claude.com, the Chrome
Web Store listing, and GitHub issues/community writeups, not from those two SKILL.md files.

---

## 1. Claude in Chrome + Claude Code's Chrome integration

### 1.1 What it is, and the two integration paths

- **Claude in Chrome** is a Chrome extension (Chrome Web Store id
  `fcoeoabgfenejglbffodgkkbkcdhcgfn`, listed version **1.0.94**, updated 2026-09-19) that
  lets Claude read and act on web pages in a visible Chrome window.
  Source: https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn
- **Claude Code's Chrome integration** ("Claude Code in Chrome", `claude --chrome`) is
  Claude Code connecting to that same extension over **native messaging**, exposed to the
  model as an MCP server named `claude-in-chrome`.
  Primary source: https://code.claude.com/docs/en/chrome (fetched in full below)

### 1.2 Enabling it per session

- CLI: `claude --chrome` — first launch shows a one-time explainer dialog (press Enter to
  continue).
- `/chrome` at any time: check connection status, manage permissions, reconnect the
  extension, choose which connected browser to use (if more than one is connected).
  Status is "working" when it shows **`Status: Enabled`** and **`Extension: Installed`**.
- **Enable by default**: `/chrome` → "Enabled by default" — skips needing `--chrome` every
  session, but costs context (browser tools' schemas are always loaded).
- **Auto-prompt**: if Claude needs the browser in an interactive session and doesn't detect
  the extension, Claude Code shows "Claude wants to use your browser" — asks **at most once
  per session**; "Don't ask again" stops it permanently (still recoverable via `/chrome`).
- **VS Code**: no flag needed — available whenever the extension is installed.
- Works with Google Chrome and Microsoft Edge; Claude Code also detects the extension in
  other Chromium browsers — Brave, Arc, Vivaldi, Opera. **Not supported in WSL.**
- **Auth gate**: requires `/login`. If you authenticate via API key or a long-lived token
  from `claude setup-token`, Chrome integration stays **off even with `--chrome`** — the
  extension can't authenticate with those credentials. (Before Claude Code v2.1.216 these
  sessions instead failed every connection attempt with an HTTP 403.)
- **Not available** through third-party providers (Bedrock, Google Cloud Agent Platform,
  Microsoft Foundry) — needs a separate claude.ai account in that case.
- Version floor: extension **v1.0.36+**, Claude Code **v2.0.73+** (WebSearch result); direct
  doc confirms the extension-version floor.

### 1.3 How a plugin/hook can detect it's connected

There is no dedicated "is Chrome connected" hook event documented. The supported way is:
- Run **`/chrome`** and read the status panel (`Status: Enabled`, `Extension: Installed`).
- Run **`/mcp`**, select `claude-in-chrome`, then "View tools" to see the live tool list —
  this only lists tools if the connection is live.
- Programmatically: the presence of a working MCP server named `claude-in-chrome` in the
  session's tool list is the signal; Claude Code injects/removes those tool schemas based on
  connection state (this is *inferred* from the docs' description of "browser tools are
  always loaded" when default-enabled — I found no documented hook/event API for this;
  **UNVERIFIED** whether a plugin hook can query it besides shelling `/chrome`-equivalent
  state files).
- The native-messaging host config file's existence is a filesystem-level signal of *install*,
  not *connection*: on Windows, check registry `HKCU\Software\Google\Chrome\NativeMessagingHosts\`
  (or the Edge/Brave/etc. equivalent) for
  `com.anthropic.claude_code_browser_extension.json`. Presence means the host is registered;
  it does not mean the extension is currently reachable (service worker can still be idle).

### 1.4 Tool names it exposes

**Two different tool surfaces exist and should not be conflated:**

**(a) Official Claude API "browser use tool"** (`platform.claude.com`) — this is the
first-party Anthropic tool spec, used by the API/Claude Code integration and by Anthropic's
own reference agents. Fetched in full from
https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool — **27 tools
on by default + 4 disabled by default = 31**:

| Group | Tools |
|---|---|
| Navigation/capture | `navigate`, `screenshot`, `zoom` |
| Pointer | `left_click`, `right_click`, `middle_click`, `double_click`, `triple_click`, `hover`, `left_click_drag`, `left_mouse_down`, `left_mouse_up`, `mouse_move`, `scroll` |
| Keyboard/timing | `type`, `key`, `hold_key`, `wait` |
| Page reading | `read_page` (accessibility tree, `[ref_N]` tags, filters `interactive`/`all`, depth 1-15), `find` (NL element search, ≤20 matches), `get_page_text` |
| Forms/files | `form_input` (set value directly), **`file_upload`** (disabled by default — sets files on an `<input type="file">` from `paths` or staged `document_ids`, takes a `RefTarget` only, not coordinates) |
| Tabs | `new_tab`, `list_tabs`, `switch_tab`, `close_tab` |
| Diagnostics/scripting (all disabled by default) | `read_console`, `read_network`, `javascript_exec` |

Key line from that doc, verbatim in substance: **the browser use tool does not drive native
OS file dialogs at all — `file_upload` sets the file input's files directly/programmatically,
bypassing the OS file chooser entirely**, and the doc explicitly warns not to point `paths`
at the browser's download directory (every downloaded file would become uploadable).

**(b) The actual Claude-in-Chrome extension MCP tools**, as documented by
`code.claude.com/docs/en/chrome` (official) plus names visible only in GitHub issue text and
a reverse-engineered write-up (**not primary source, mark UNVERIFIED for exact names**):
- Officially named in code.claude.com/docs/en/chrome text: `tabs_context_mcp`,
  `tabs_create_mcp` (its `createIfEmpty` triggers a permission prompt), `browser_batch`
  (batches several actions; also prompts if it contains tab-creating actions).
- A reverse-engineered internals writeup (gist by sshh12, "Claude for Chrome Extension
  Internals v1.0.56", https://gist.github.com/sshh12/e352c053627ccbe1636781f73d6d715b —
  **UNVERIFIED, community reverse-engineering, not an Anthropic source**) lists a longer,
  overlapping set: `computer`, `navigate`, `read_page`, `form_input`, `find`,
  `get_page_text`, `javascript_tool`, `tabs_context`, `tabs_create`,
  `read_console_messages`, `read_network_requests`, `upload_image`, `file_upload`,
  `resize_window`, `gif_creator`, `update_plan`, `shortcuts_list`, `shortcuts_execute`,
  `turn_answer_start`. A related project, `noemica-io/open-claude-in-chrome`
  (https://github.com/noemica-io/open-claude-in-chrome), advertises itself as exposing "the
  same 18 MCP tools" as the real extension — consistent count, but still a third-party claim,
  not confirmed by Anthropic.
- Given (a) and (b) overlap heavily (`navigate`, `read_page`, `find`, `get_page_text`,
  `form_input`, `file_upload`, tab tools), the Chrome extension is almost certainly a thin
  wrapper that surfaces the same browser-use-tool member set through native messaging, plus
  Chrome-specific extras (`gif_creator`/session recording, `shortcuts_*`, `update_plan` for
  the plan-approval flow, `resize_window`). Treat the exact wrapper name list as UNVERIFIED;
  treat the **capability list** (navigate/click/type/read page/screenshot/tabs/forms/file
  upload — all present) as confirmed by the official doc.

### 1.5 File uploads specifically (official, confirmed)

From code.claude.com/docs/en/chrome, verbatim in substance:
> Claude can attach files from your machine to upload fields on a page. Claude Code reads
> the file and sends its contents to the browser, so uploads work in both local and remote
> sessions. Requires Claude Code v2.1.211 or later.

Three restrictions, stated directly:
1. **Permissions** — Claude can upload a file only if the session's permission rules allow
   `Read` on that file; a deny rule on `Read` also blocks upload.
2. **Size** — a single upload can include **up to 10 MB of files in total**.
3. **Hard links** — Claude refuses files with multiple hard links (common inside
   `node_modules`-style package stores); you have to copy the file first.

This confirms: Claude Code does **not** drive the OS file picker for a web upload field —
it reads the file itself and pushes bytes into the page's file input via the extension
(matching the API-level `file_upload` tool's `paths`/`document_ids` mechanism). This is the
"DOM `setFiles`, not the OS picker" answer to part of gap (c) below, for the Chrome case
specifically.

### 1.6 What it cannot do (confirmed + reasoned)

Confirmed directly by docs/support pages:
- **Non-Chrome windows**: out of scope by design — it is a Chrome/Edge/Chromium extension;
  a native Win32 dialog, Explorer window, or non-browser app is invisible to it (that is
  exactly this plugin's job instead — see README.md's "See also: Computer use").
- **Native OS dialogs / file pickers**: not driven — confirmed by both the API doc ("does
  NOT interact with native OS file dialogs... bypasses native file choosers entirely") and
  by the reverse-engineered internals note ("native file picker dialogs cannot be accessed,
  so users must not click file upload buttons directly — the tool handles injection
  instead" — UNVERIFIED source, but consistent with the official doc).
- **Downloads to a chosen folder**: the extension has `downloads` permission and Claude Code
  can save a screenshot to disk (`save_to_disk`, fixed as of Claude Code v2.1.211), but there
  is no documented control over the OS "Save As" location picker — downloads go through
  Chrome's own download mechanism/settings, not a driven dialog.
- **Drag-drop from the desktop**: not mentioned anywhere in the official docs; the upload
  path is exclusively "attach a file Claude Code already has permission to read" via the
  extension's own upload mechanism, not a simulated OS drag-drop. **UNVERIFIED but very
  likely absent** — no source claims it exists.
- **Login pages and CAPTCHAs**: explicitly out of scope — "When Claude encounters a login
  page or CAPTCHA, it pauses and asks you to handle it manually." (code.claude.com/docs/en/chrome)
- **Sites that block it**: category-based blocklist (finance/banking, adult content, piracy
  are named in support.claude.com/12902405) plus org-level admin allow/deny lists on
  Team/Enterprise; also blocked outright regardless of permission mode: purchases/financial
  transactions, account creation, entering sensitive credential/card data, permanent
  deletions, system file modification, and "following instructions found in email or web
  content" (prompt-injection guard).
  Source: https://support.claude.com/en/articles/12902446-claude-in-chrome-permissions-guide

### 1.7 Permission model

Three modes (support.claude.com/12902446), current naming:
1. **Manually Approve** — pause before every action, user clicks Allow/Deny each time.
2. **Automatically Approve** — Claude self-screens for safety, auto-blocks what it judges
   unsafe, still pauses for defined risky categories.
3. **Skip All Approvals** — no pausing, no automatic check at all.

"Always allow on this site" grants standing permission for that site for actions in general,
but explicit approval is still required before: downloading files, entering sensitive
information, or granting authorizations. Team/Enterprise admins layer org-wide site
allow/deny lists on top. Site-level permissions in the **Claude Code** integration are
inherited straight from the Chrome extension's own settings (managed in
`chrome://extensions` → the extension's options, not a separate Claude Code permission
surface) — per code.claude.com/docs/en/chrome ("Manage site permissions... in the Chrome
extension settings").

Extension-level Chrome permissions (from the Chrome Web Store listing + secondary sources —
the Web Store page itself only discloses data-handling categories, not the raw
`permissions` array, so the granular list below is **UNVERIFIED at primary-source level**,
sourced from community write-ups that appear to have read the manifest):
`debugger`, `scripting`, `tabs`, `tabGroups`, `downloads`, `alarms`, `nativeMessaging`,
`webNavigation`, plus host permissions for active-tab content. `debugger` is called out
repeatedly as the permission that lets it truly click/type/screenshot (i.e., it's driving
Chrome via **Chrome DevTools Protocol**, attached through the `debugger` permission — this
matches "computer" tool in the reverse-engineered list being CDP-backed).
Web Store listing's own disclosed data categories: personally identifiable information,
personal communications, location, web history, user activity, website content.
Source: https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn

### 1.8 Known problems (GitHub issues, community)

All from `github.com/anthropics/claude-code/issues` unless noted; issue numbers as returned
by search, not independently re-verified by opening each one beyond the search snippet —
treat specifics as reported-by-title, mark UNVERIFIED where snippet is thin:

- **Focus stealing** — `#39696` "Chrome extension steals system-wide focus on every tool
  interaction (macOS)"; `#39558` "[BUG] Chrome extension steals focus and hijacks keyboard
  input during concurrent Cowork tasks (post-March 24 computer use update)"; `#89148`
  "Claude in Chrome: no background-tab option — every tool call steals OS focus (regression
  ~2026-03-25)". Reported mechanism: the extension forces its tab/window to the foreground on
  *every* interaction (not just switching Chrome tabs — it yanks whole-OS focus away from
  whatever app the user was in), which is exactly the problem this plugin's presence-tracking
  and posted-input design (README.md "It gets out of your way") is built to avoid for
  non-Chrome apps. A suggested fix mentioned in the issue text: an `active: false` default
  param on `tabs_create`/`navigate` so Cowork background tasks don't steal focus — not shipped
  as of this research.
- **Disconnects that don't self-heal** — `#83680` "claude-in-chrome: extension disconnects
  mid-session (after file download) and never reconnects"; `#26449` "browser extension
  frequently [disconnects]"; a third-party blog (dassi.ai, "Claude Code's Chrome Extension
  Keeps Disconnecting. I Dug Into Why.") attributes part of this to the extension's **service
  worker going idle** during long sessions (matches the official troubleshooting doc's own
  "Connection drops during long sessions" section, which says exactly this and recommends
  `/chrome` → "Reconnect extension").
- **A single blocking JS dialog kills the channel** — reported mechanism (from search
  synthesis, consistent with the official troubleshooting page): a page's `alert()`/
  `confirm()`/`prompt()` blocks Chrome's event loop, so native-messaging commands queue up
  silently with no error/timeout surfaced to Claude Code — it just looks hung. Official fix:
  dismiss the dialog manually, then continue.
- **Windows-specific** (`code.claude.com/docs/en/chrome`, "Windows-specific issues" section,
  primary source):
  - **Named pipe conflicts (`EADDRINUSE`)** — another process holding the same named pipe;
    fix is to restart Claude Code / close other sessions using Chrome.
  - **Native messaging host crashes on startup** — reinstall Claude Code to regenerate the
    host config.
  - **Setup pages fail to open** — fixed in v2.1.211+ (previously the "connect the
    extension" tab could fail to open on Windows at all).
  - Also documented: the native-messaging host config is a **registry key** on Windows
    (`HKCU\Software\<Vendor>\<Browser>\NativeMessagingHosts\`), not a JSON file on disk the
    way macOS/Linux use — meaning "restart Chrome to pick up new config" matters differently
    on Windows than on the other two platforms.
- **Requiring the window to be visible / foregrounded**: not stated as an explicit hard
  requirement in the primary docs, but strongly implied — "Browser actions run in a visible
  Chrome window in real time" (code.claude.com/docs/en/chrome) and the focus-stealing issues
  above collectively show the extension actively brings its tab to the front rather than
  operating on a backgrounded/covered window the way this plugin's own accessibility-tree
  approach does. **No documented background/headless mode.**
- `#38811` "Claude in Chrome: 18 of 20 MCP tools blocked by enabledMcpTools despite connector
  being enabled" — corroborates the "~18-20 tools" count from the reverse-engineered list
  and shows enterprise `enabledMcpTools` policy can silently mask most of the tool surface.

---

## 2. What the plugin (axon / computer-use) already says about Chrome

Read directly, so this is not repeated in recommendations:

- `skills/computer-use/SKILL.md` lines 178-184 (the only Chrome-specific lines in that
  window):
  > **Web pages count.** A browser or Electron app reads like anything else: the snapshot
  > shows the page's links, buttons and fields by name, the URL in its header, and the tabs.
  > The browser's own toolbar and sidebar are hidden unless you pass `chrome: true`. Fill a
  > field with `computer_type { index, replace: true }` and click with `computer_click`;
  > neither needs the window in front. **If Claude in Chrome is set up in this session,
  > prefer its tools for a page in Chrome; the tree here is the path when it is not, and for
  > every other browser.**
  - So the plugin already has an explicit, correct hand-off rule: prefer the real
    Claude-in-Chrome extension for Chrome pages when it's connected, and fall back to its own
    UIA-tree reading for Chrome-when-not-connected and for every non-Chrome browser (Edge
    without the extension, Firefox, Opera without extension, etc). It does **not** currently
    have any logic to *detect* whether Claude in Chrome is connected — that's on the model to
    infer from context/tool availability, matching my finding in §1.3 that there's no
    documented hook for this.
- `README.md`: no dedicated Chrome section. The only browser-adjacent content is the generic
  `chrome: true` snapshot parameter (to reveal the browser's own toolbar/sidebar controls,
  demonstrated against **Opera**, not Chrome — showing the plugin's own read path is
  browser-agnostic UIA, unrelated to the Claude-in-Chrome extension) and the cost-comparison
  table showing "A live web page in Opera, read as a tree (0.2.0) | ~500 [tokens]". No mention
  of `--chrome`, `/chrome`, native messaging, or file uploads via a browser.
- `docs/research/*.md` — five files matched a `chrome` grep
  (`2026-09-02-codex-parity-research.md`, `2026-09-04-why-claude-did-not-batch.md`,
  `2026-09-05-astra-computer-use-parity.md`, `2026-09-08-computer-use-parity-and-beyond.md`,
  `2026-09-14-uia-detail-and-what-users-ask-for.md`) — matched because the plugin's own
  README text (quoted above, re: Opera/`chrome: true` param) is itself reproduced/discussed
  in those research docs, not because they contain independent Claude-in-Chrome-the-extension
  research. I did not find prior research there specifically on the Claude-in-Chrome
  extension's tool names, permission model, or GitHub issues — so §1 above is new ground for
  this plugin's research corpus, not a duplicate.

**Conclusion for Gev**: the plugin's Chrome story today is exactly one line of hand-off logic
and a `chrome: true` visibility flag. It has never researched the extension's own tool
surface, limits, or bugs before this file.

---

## 3. The three named gaps

### 3.1 Gap (a) — pasting a *file* onto the clipboard (not text) so Ctrl+V attaches it

**The clipboard format**: Windows represents "files on the clipboard" as **`CF_HDROP`**
(`Shell Clipboard Formats`, Microsoft Learn:
https://learn.microsoft.com/en-us/windows/win32/shell/clipboard). It's a global memory block
holding a `DROPFILES` struct followed by the file paths; consumers read it with
`DragQueryFile`. This is the *same* format used for a drag-drop of files, and Explorer's own
Ctrl+C on a selection produces it — so "copy a file, then Ctrl+V it into a chat box" already
works today for a human, via this format.

**How to put it there programmatically:**

- **.NET / WPF**: `System.Windows.Clipboard.SetFileDropList(StringCollection filePaths)` —
  clears the clipboard and writes the FileDrop format from a `StringCollection` of absolute
  paths.
  https://learn.microsoft.com/en-us/dotnet/api/system.windows.clipboard.setfiledroplist
- **.NET / WinForms**: `System.Windows.Forms.Clipboard.SetFileDropList(StringCollection)`
  (equivalent WinForms API) and its read counterpart `Clipboard.GetFileDropList()`.
  https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.clipboard.setfiledroplist
  https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.clipboard.getfiledroplist
- **C# minimal snippet** (WinForms clipboard API is usable from a console/WPF app by adding
  the `System.Windows.Forms` reference — this is what `AxonHost.cs` would call):
  ```csharp
  using System.Collections.Specialized;
  using System.Windows.Forms;

  var files = new StringCollection();
  files.Add(@"C:\Users\OWNER\Documents\report.pdf");
  Clipboard.SetFileDropList(files);   // sets CF_HDROP; Ctrl+V now "pastes" the file
  ```
- **The DropEffect gap**: `SetFileDropList` alone does not let you say "this is a *cut*, not
  a *copy*" — Explorer distinguishes cut vs. copy via a second clipboard format,
  `CFSTR_PREFERREDDROPEFFECT` (a `DWORD` of `DROPEFFECT_MOVE`/`DROPEFFECT_COPY`). To set both
  formats together you need the lower-level `DataObject`/`IDataObject` route instead of the
  one-line helper:
  ```csharp
  var data = new DataObject();
  data.SetFileDropList(files);                     // CF_HDROP
  var dropEffect = new MemoryStream(BitConverter.GetBytes((int)DragDropEffects.Copy));
  data.SetData("Preferred DropEffect", dropEffect); // CFSTR_PREFERREDDROPEFFECT
  Clipboard.SetDataObject(data, true);
  ```
  (Pattern confirmed by CodeProject "Setting the Clipboard File DropList with DropEffect in
  VB.Net" — https://www.codeproject.com/Articles/32718/ — and the Metadata Consulting blog
  on getting/setting DropEffect in C# —
  https://metadataconsulting.blogspot.com/2020/05/CSharp-How-to-get-Clipboard-incoming-DragDropEffects-for-FileDrop-and-set-in-back.html).
  For "paste a file into a chat box" this distinction rarely matters — CF_HDROP alone is
  what every consuming app actually keys off.
- **The DragDrop alternative**: instead of the clipboard, `Control.DoDragDrop` /
  `IDropTarget` can simulate an actual OS drag-and-drop of a `DataObject` carrying
  `CF_HDROP`, landing on a drop target's `OnDragEnter`/`OnDragDrop`. This is heavier
  (needs to synthesize real pointer-down/move/up over the target, similar to this plugin's
  existing `computer_drag`) and is the fallback for apps that accept drag-drop but not
  clipboard-paste of files (some Electron apps only wire the `drop` DOM event, not the
  `paste` event, for file attachment).
- **What actually accepts a file *paste* (Ctrl+V of CF_HDROP)**, from research/community
  knowledge (general Windows-developer knowledge, cross-checked against the shell clipboard
  docs; **mark UNVERIFIED per-app since none of these are Microsoft/Anthropic primary
  sources for "does app X's paste handler check CF_HDROP"**):
  - **Windows Explorer** — always (it's the canonical CF_HDROP consumer/producer).
  - **Outlook (desktop, Win32)** — pasting into a new-mail body inserts the file as an
    attachment (long-standing Outlook behavior; this is why "copy file in Explorer, Ctrl+V
    in Outlook" is common advice in MS forums, e.g. the social.msdn.microsoft.com thread
    found above about DataObject + Outlook messages).
  - **Microsoft Word** — pasting CF_HDROP into a document typically inserts it as an
    embedded/linked object rather than a plain attachment (different code path than Outlook).
  - **Teams / Slack / Discord (web-based Electron clients)** — these generally listen for the
    HTML5 `paste` clipboard event and check `event.clipboardData.files`; whether Chromium
    (Electron) surfaces `CF_HDROP` through that as `DataTransfer.files` is inconsistent across
    versions and is the most likely single point of failure for this gap — **UNVERIFIED,
    needs an on-machine test against each app's current build**, not confirmed in any source
    fetched today.
  - **Chrome `<input type="file">`** — a real user Ctrl+V paste of CF_HDROP into a file input
    is **not the standard browser file-attach path**; browsers instead fire a `paste` event
    with clipboard *image/text* items, and `<input type=file>` specifically is populated by
    the OS picker or the `DataTransfer.files` of a genuine **drag-drop**, not clipboard-paste,
    in most Chromium builds — **UNVERIFIED specifics, but this is why gap (c) below (driving
    the OS picker) matters even when gap (a)'s CF_HDROP trick works elsewhere.**

### 3.2 Gap (b) — opening a document in its default app, then finding the window

- **Launch**: `ShellExecute`/`ShellExecuteEx` with verb `"open"` is the shell-level primitive
  (Microsoft Learn: https://learn.microsoft.com/en-us/windows/win32/shell/launch and
  https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shellexecutea).
  For a document path (not an .exe), `"open"` resolves to whatever app is registered as the
  default handler (e.g. a `.txt` → Notepad/registered editor, per the Microsoft doc's own
  example).
- **.NET equivalent**: `System.Diagnostics.Process.Start(new ProcessStartInfo { FileName =
  path, UseShellExecute = true })` — `UseShellExecute = true` routes through the same shell
  verb-open mechanism as `ShellExecute`, which is why it can open a *document* (not just an
  .exe) and why the .NET docs describe it as "using the shell" specifically to open documents
  and let the OS choose the associated app.
  https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.processstartinfo.useshellexecute
- **The "openwith" verb** — instead of `"open"`, passing verb `"openas"`/using the "Open
  with..." dialog forces the chooser UI rather than the registered default; useful when you
  want the human (or the agent) to pick an app rather than trust the file association.
  (Consistent with SHELLEXECUTEINFO's documented `lpVerb` field accepting arbitrary
  registered verbs, of which `openas`/"Open with" is one — Microsoft Learn
  SHELLEXECUTEINFO page.)
- **Finding the window it opened — the hard part**:
  - `ShellExecute` (the plain function) returns **no process information at all**.
  - `ShellExecuteEx` with `SEE_MASK_NOCLOSEPROCESS` set in `SHELLEXECUTEINFO.fMask` fills in
    `hProcess` — **a process *handle*, not a PID** (community Q&A confirms: "ShellExecuteEx
    only gives you an HPROCESS (not the process id)"). To get the PID from that handle, call
    `GetProcessId(hProcess)`.
  - If you need the PID directly and don't strictly need shell verb resolution, use
    `CreateProcess` instead — it hands back both a process handle *and* a PID up front, but
    only works when you already know the exact target executable (not "whatever app is
    registered for .pdf").
  - Either way, having a PID is not the same as having the right **window**. The documented
    pattern (Microsoft debugger docs + general Win32 practice, and explicitly recommended in
    the search results above): call `WaitForInputIdle(hProcess, timeout)` to let the new
    process finish its startup message pump, then enumerate top-level windows with
    `EnumWindows`, and for each one call `GetWindowThreadProcessId(hwnd, out pid)`
    (https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowthreadprocessid)
    to find the window(s) owned by that PID.
  - **The DDE-handoff trap** (exactly the case Gev flagged): many "open with default app"
    launches for a document type where the app is *already running* don't spawn a new process
    at all — the shell finds the existing instance and hands the open request to it via
    **DDE** (Dynamic Data Exchange) or an equivalent single-instance IPC, so
    `ShellExecuteEx`'s returned handle/PID can point at a short-lived launcher stub that exits
    immediately, while the *real* window belongs to the pre-existing process. This is a
    well-documented Acrobat/Office failure mode — "Acrobat failed to send/connect to a DDE
    command" is a long-running, still-current Adobe support topic (community.adobe.com
    threads found above; a common root cause cited is >1 Acrobat process already running, or
    the Office PDFMaker add-in conflicting). **Practical implication for this plugin**: after
    a `computer_launch`-style open of a document, PID-based window-finding is not reliable
    for single-instance apps like Word/Acrobat/Excel — the robust approach has to be
    "enumerate windows across the whole desktop by *title substring* (the filename) and
    *class name*, taking the newest/foreground one that appeared after the open call," the
    same class of technique the plugin already uses for `window: "new"` in `computer_run`
    steps (README.md, "A sequence is one call, not four" section) — that existing mechanism
    is very likely already robust to this because it watches for *any* new window appearing
    during the run rather than trusting a PID.

### 3.3 Gap (c) — driving the Windows Open/Save common dialog, and Explorer→clipboard

**Three dialog generations, and why they matter for automation:**

1. **Classic dialog** (`GetOpenFileName`/`GetSaveFileName`, `comdlg32`, pre-Vista design still
   used by some older/simple apps) — a plain Win32 dialog template. Filename edit control has
   long been documented/observed at **control ID `1148`** (hex `0x47C`), historically exposed
   as a **ComboBox** (`cmb13`) containing an edit child — this is the "1148" the task named.
   Community-sourced confirmation (a KerfDesk CI PR fixing dialog automation, found above):
   *"the common file dialog's filename ComboBox classically reports control ID 1148 (cmb13);
   on modern Windows this may report ID 0 instead... recognized either by control ID 1148 or
   by being hosted directly by a FloatNotifySink in the dialog's DUIView, with the address
   band being a ComboBoxEx32 under the progress control."* — **UNVERIFIED beyond that PR's
   own text**, no Microsoft primary source states "1148" explicitly; treat 1148 as a
   long-standing convention/observed constant, not a documented contract.
2. **Vista-and-later Common Item Dialog** (`IFileDialog`, its concrete classes
   `FileOpenDialog`/`FileSaveDialog`) — a COM interface, not a callable function; this is
   the dialog every modern Win32 app (Notepad, Paint, most non-Office apps) shows today.
   Microsoft Learn: https://learn.microsoft.com/en-us/windows/win32/shell/common-file-dialog
   — "the legacy `GetOpenFileName`/`GetSaveFileName` should not be used in new applications";
   `IFileDialog` supports the Shell namespace via `IShellItem`, and richer customization
   without a Win32 dialog template/hook procedure.
   - **Filename edit box**: hosted in a `ComboBoxEx32`; UI Automation exposes it as an `Edit`
     control that's still commonly targeted at automation id **`1148`** in current Windows 11
     builds too (this is the one concrete number the task named that I could not find
     independently re-confirmed by a primary Microsoft source in today's research — treat as
     **UNVERIFIED-but-widely-used-in-practice**, and verify empirically against a live dialog
     with `computer_snapshot` before relying on it, exactly per this plugin's own
     "read the tree, not pixels" philosophy).
   - **Address bar**: a `ToolBar` with automation id **`1001`**, name **"Address"** in the
     Open/Save dialog's breadcrumb bar — task-provided detail, **not independently
     re-confirmed against Microsoft docs today** (Microsoft's own `common-file-dialog.md`
     page, fetched via GitHub mirror, documents the *interfaces* `IFileDialog`/
     `IFileDialogEvents`/customization via `IFileDialogCustomize`, not raw automation ids —
     Microsoft does not publish automation-id numbers for its own dialog chrome). Same
     UNVERIFIED status for **Open button = automation id `1`**.
   - **Alt+D address-bar trick**: in Explorer *and* in the common Open/Save dialog (which
     shares Explorer's navigation chrome), **Alt+D** jumps focus straight to the address bar,
     letting you type a path and press Enter to navigate there directly — this is standard,
     long-documented Explorer/common-dialog keyboard behavior (general Windows UX knowledge;
     not separately re-confirmed by a fetched primary source today, but extremely
     well-established and low-risk to state as fact).
   - **Is the dialog a top-level window owned by the app?** Yes — `IFileDialog` shows as a
     genuine top-level `#32770`-class (or similar) window, owned (in the Win32 sense —
     `GetWindow(hwnd, GW_OWNER)`) by the app's main window, not a child window embedded in it.
     This matters for this plugin's `hwnd`-based targeting: `computer_apps` should see it as
     its own window (likely flagged the way the plugin already flags `[popup]`/`[dropdown
     list]`/`[menu]` per README's "Menus, popups and dialogs" section, or possibly needs a
     `new_window: true` `wait_for` the same way any spawned dialog does — this is exactly the
     `window: "new"` mechanism already in `computer_run`).
   - **Typing a path + Enter**: works directly in the filename edit box for *both* an
     existing-file "Open" (navigates into/selects that path) and picking a save name — this
     is standard `IFileDialog` behavior (typing a full path with a filename resolves and,
     on Enter, is equivalent to clicking Open/Save), independent of automation ids — i.e.
     even without confirming automation id `1148`, `computer_run`-style steps of "click into
     the dialog, `ctrl+a`, type full path, Enter" should work by keyboard alone as a
     fallback that doesn't depend on any control id being right.
3. **Office's dialog** — modern Word/Excel/PowerPoint (2007 and later) use the **same**
   Windows common `IFileDialog`-based Open/Save dialog as everything else, not a bespoke
   Office-only dialog (this supersedes the old Office 97-2003 "custom" dialog the task
   flagged as a distinct case) — **UNVERIFIED against a fetched primary source today**
   (my searches for "Office custom dialog automation id" returned only VBA `FileDialog`
   object documentation, which is a *scripting* API for Office add-ins, not evidence either
   way about the dialog's own UI Automation shape). Practical guidance: don't assume Office's
   dialog is special: read it with `computer_snapshot` first and compare its automation ids
   to a plain Notepad Open dialog before writing Office-specific logic.

**Copying a file from Explorer to the clipboard** (for the "retrieve a document from File
Explorer" half of gap (c)):
- The human-equivalent gesture is: select the item in Explorer, press **Ctrl+C** — Explorer
  sets `CF_HDROP` for the selection (Microsoft Learn shell clipboard doc, §3.1 above).
  Reading it back: `DragQueryFile(hDrop, iFile, ...)`, with `iFile = 0xFFFFFFFF` first to get
  the count, then once per index for each path — confirmed by the community sources found
  today (no single MS page enumerates this exact call pattern, but `DragQueryFile`'s own
  Microsoft Learn reference documents the 0xFFFFFFFF-for-count convention).
  .NET convenience wrapper: `System.Windows.Forms.Clipboard.GetFileDropList()` — returns a
  `StringCollection` of paths directly (Microsoft Learn:
  https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.clipboard.getfiledroplist).
- **Programmatic alternative that skips clicking Explorer at all** — COM-automate Explorer's
  own Shell windows (`SHDocVw.ShellWindows`, `Shell32.IShellFolderViewDual2.SelectedItems()`)
  to read what's currently selected in a live Explorer window, without needing to send a
  keystroke to it. Example (fetched raw from a public gist,
  https://gist.github.com/CheetahChrome/5cf7b831c26f66a791f1276feb1e946a):
  ```csharp
  // Add COM refs: Microsoft Shell Controls And Automation, Microsoft Internet Controls
  foreach (SHDocVw.InternetExplorer window in new SHDocVw.ShellWindows())
  {
      var filename = Path.GetFileNameWithoutExtension(window.FullName).ToLower();
      if (filename == "explorer")
      {
          Shell32.FolderItems items =
              ((Shell32.IShellFolderViewDual2)window.Document).SelectedItems();
          foreach (Shell32.FolderItem item in items)
          {
              Clipboard.SetText(item.Path);   // or SetFileDropList for a real file-paste
              break;
          }
      }
  }
  ```
  This reads the *currently selected* item's path from a live Explorer window (any of them,
  via `ShellWindows`) without simulating Ctrl+C at all — potentially more reliable than a
  synthesized keystroke, and it composes naturally with `Clipboard.SetFileDropList` (§3.1) to
  go straight from "what's selected in Explorer" to "a real file-paste clipboard payload,"
  in one step, no physical click required. This is COM/`SHDocVw`, which is old but still
  present and supported on Windows 11 (Internet Explorer's automation surface persisted
  after the browser itself was retired, specifically because Explorer still hosts it for
  Explorer-window automation).

**Chrome file inputs, resolved**: per §1.5 above, the Chrome extension (and the API-level
`file_upload` browser-use tool) sets `<input type="file">` **programmatically via the
extension/DOM**, not by opening the OS picker at all — Claude Code reads the file itself and
pushes it into the page. When *this* plugin drives a `<input type="file">` in a browser that
does **not** have the Claude-in-Chrome extension connected (Edge without it, Firefox, Opera,
or Chrome when the extension isn't set up this session — exactly the fallback case the
plugin's own SKILL.md line 183 describes), clicking the file input's own "Choose file" /
"Browse" button opens the **real OS common dialog** (`IFileDialog`), because there is no
extension present to intercept it with a DOM-level `setFiles` — at that point gap (c)'s
dialog-driving technique is exactly what's needed, confirming the task's framing that the
extension can bypass the OS picker only when it's actually connected and actually the active
handler for that tab.

---

## 4. How other agents solve these same three gaps

### Codex (OpenAI) — computer use / browser automation

- **File upload regression, confirmed live bug**: "Codex Computer Use regression: Custom GPT
  file upload no longer emits `filechooser` event" — `github.com/openai/codex/issues/46585`
  (dated around 2026-09-18 per the issue text) — shows Codex's browser automation is built on
  the Playwright convention of listening for the browser's `filechooser` event (fired when a
  page's file input is activated) and responding with `setInputFiles`, and that this recently
  broke for at least one target.
- **The underlying gap, explicitly acknowledged in-repo**: "Browser Use cannot upload files
  because file chooser / setInputFiles is not exposed in Codex Desktop IAB" —
  `github.com/openai/codex/issues/20785` — states plainly that Codex Desktop's in-app browser
  (IAB) can *see* real `<input type="file">` elements but its `PlaywrightLocator` runtime does
  not expose `setInputFiles(...)`, i.e. Codex has the same DOM-level capability Playwright has
  upstream, but the desktop app hasn't wired the call through.
  https://github.com/openai/codex/issues/20785
- **Documented workaround**: enabling the Chrome extension's "allow access to file URLs"
  option so Codex can reference local files by `file://` URL for upload flows (from the
  WebSearch synthesis of the above issues — matches a common Playwright/browser-extension
  workaround pattern, not independently re-fetched from a single page today).
- **OS-level (non-browser) computer use, Windows**: per this plugin's own README.md (already
  quoting Codex's docs): *"On Windows, the model is simpler and more constrained: Codex takes
  over the foreground, and you cannot use the same desktop session while a Computer Use task
  runs."* — meaning Codex's OS-level file-dialog driving (if any) would be screenshot+coordinate
  based like the rest of its computer use, not accessibility-tree/automation-id based; I found
  no Codex documentation describing dialog-specific automation ids, consistent with a
  vision-first approach that doesn't need them.

### OpenAI Operator (now folded into "ChatGPT agent")

- Operator's own public documentation (per Wikipedia's summary, found today) describes it as
  performing browser tasks — filling forms, ordering, scheduling — via browser interaction; I
  found no Operator-specific documentation of file-dialog or file-paste handling distinct from
  the general Codex/ChatGPT-agent browser tooling above. Treat Operator as **superseded by
  ChatGPT agent** for current behavior; no separate primary source on file handling located.
  https://en.wikipedia.org/wiki/OpenAI_Operator

### Anthropic's own reference "Computer Use" implementation (`computer-use-demo`)

- Repo: `anthropics/claude-quickstarts` (formerly `anthropic-quickstarts`), directory
  `computer-use-demo/`. https://github.com/anthropics/claude-quickstarts/tree/main/computer-use-demo
- It is a **Linux/Docker reference** — the `ComputerTool` shells out to **`xdotool`** for
  mouse/keyboard, and file-adjacent capability comes from a separate **bash tool** (one
  command: run a shell command) and a **text-editor tool** (`view`, `create`, `str_replace`,
  `insert`, `undo_edit`) — i.e. Anthropic's own reference agent never drives a *native OS file
  dialog* at all, because on Linux/X11 the reference stack, it just uses the bash tool to
  read/write files directly on disk rather than going through any GUI file picker. This is a
  fundamentally different approach from this plugin's Windows/macOS UIA/AX approach: Anthropic's
  reference implementation sidesteps gaps (a)/(b)/(c) entirely by having filesystem access as a
  first-class tool, rather than needing to fake a human using a dialog.
  https://github.com/anthropics/claude-quickstarts/blob/main/computer-use-demo/computer_use_demo/tools/bash.py
  https://github.com/anthropics/claude-quickstarts/blob/main/computer-use-demo/computer_use_demo/loop.py

### Open Interpreter

- Its `Computer API` / OS Mode (`--os` flag) documents keyboard/mouse/clipboard/OCR-based
  click-on-text-or-icon primitives (docs.openinterpreter.com/code-execution/computer-api), but
  I found **no documented file-dialog-specific method** in the fetched material — its approach
  looks like general OCR/vision-based clicking (find text/icon on screen, click it), which
  would drive a file dialog the same way it drives anything else (locate the filename field
  by OCR, click, type), rather than via automation ids. No file-paste (CF_HDROP) capability is
  documented. **UNVERIFIED beyond what the docs page listing showed** — worth a deeper read of
  the full Computer API reference if this project wants a real comparison; today's fetch only
  surfaced the summary/capability list, not dialog-specific code.
  https://docs.openinterpreter.com/code-execution/computer-api

### UFO / UFO² (Microsoft Research)

- UFO explicitly uses the **Windows UI Automation API** as its backend for "robust support in
  UI inspection and interaction through code" — the same technology family this plugin uses
  (UIA) rather than pixel/OCR-based clicking. UFO² is described as going further: combining
  GUI actions with **native API calls** for faster/more robust execution ("Desktop AgentOS").
  https://github.com/microsoft/UFO , https://arxiv.org/html/2402.07939v1 ,
  https://arxiv.org/pdf/2504.14603 (UFO2 paper)
- I did not find a specific published automation-id list for file dialogs in UFO's own docs
  (its documentation is task/framework-level, not a catalog of Windows dialog control ids) —
  no evidence UFO has solved gap (c) more precisely than "drive it via UIA generically," which
  is the same strategy this plugin already has available (`computer_snapshot`/`computer_click`
  against whatever ids the tree reports) — UFO does not appear to add anything beyond what
  this plugin's existing generic UIA driving already provides for file dialogs specifically.

### Windows Agent Arena (Microsoft)

- A benchmark, not an agent: 154 tasks across 15 Windows apps including **File Explorer**,
  running in Docker-packaged Windows 11 VMs with snapshot restore and a deterministic
  Python evaluator per task. It exists to *score* agents (any agent, via a shared action
  interface) on tasks that likely include file open/save flows, but the repo itself doesn't
  ship a file-dialog-driving *technique* beyond whatever the agent-under-test brings — so it's
  a useful *evaluation target* for this plugin (a good self-test source: "can computer-use
  complete WAA's File-Explorer tasks") rather than a source of new automation technique.
  https://github.com/microsoft/WindowsAgentArena , https://microsoft.github.io/WindowsAgentArena/

### PyAutoGUI-based agents (generic pattern, multiple sources)

- The consistent community pattern, confirmed by multiple independent write-ups found today:
  **coordinate/keystroke-blind, not automation-id-aware** — click the upload/save trigger,
  then `pyautogui.write(path)` to type the full path into whatever has focus (assumed to be
  the filename field), then `pyautogui.press('enter')`. No targeting by control id, no
  reading of the dialog's structure at all — it is pure "type into wherever focus already
  landed," which only works because typing a full path + Enter is accepted by the filename
  edit box regardless of its automation id (matching the "works by keyboard alone" fallback
  noted in §3.3 above). This is strictly weaker than this plugin's UIA-tree approach (no
  verification that the dialog is even the expected one, no id-based targeting, blind to
  whether a dialog opened at all) — useful mainly as a baseline showing that even the
  most primitive approach relies on the same underlying Windows behavior (path + Enter in the
  filename box) that a UIA-targeted approach would use more reliably.
  Sources: https://medium.com/@robinclick/automate-upload-file-dialog-in-web-automation-b94349db9db1 ,
  general corroborating write-ups from the same search.

---

## Summary of exact identifiers for implementation (quick reference)

| Item | Value | Confidence |
|---|---|---|
| Clipboard file format | `CF_HDROP` | Confirmed (MS Learn) |
| Set files on clipboard (.NET) | `Clipboard.SetFileDropList(StringCollection)` | Confirmed (MS Learn) |
| Get files from clipboard (.NET) | `Clipboard.GetFileDropList()` | Confirmed (MS Learn) |
| Cut-vs-copy clipboard flag | `CFSTR_PREFERREDDROPEFFECT` via `IDataObject`/`DataObject.SetData("Preferred DropEffect", ...)` | Confirmed pattern (CodeProject/Metadata Consulting) |
| Launch doc in default app | `ShellExecute`/`ShellExecuteEx` verb `"open"`; .NET `Process.Start(ProcessStartInfo{UseShellExecute=true})` | Confirmed (MS Learn) |
| Force app chooser | verb `"openas"` / "Open with" | Confirmed by SHELLEXECUTEINFO verb model |
| Get PID after ShellExecuteEx | `SEE_MASK_NOCLOSEPROCESS` → `hProcess` → `GetProcessId(hProcess)` | Confirmed (MS API + community) |
| Find new window after launch | `WaitForInputIdle` then `EnumWindows` + `GetWindowThreadProcessId` | Standard pattern, confirmed by multiple sources |
| Single-instance DDE handoff risk | Word/Excel/Acrobat may hand off to an existing process instead of spawning one; PID becomes unreliable | Confirmed as a real, recurring Adobe/Office support issue |
| Classic dialog filename control | automation/control id `1148` (ComboBox `cmb13`), may be `0` on modern builds | Community-observed, **not MS-documented** |
| Modern (`IFileDialog`) filename edit | commonly still targetable at id `1148` | **UNVERIFIED today**, verify empirically with `computer_snapshot` |
| Address bar | ToolBar, automation id `1001`, name "Address" | Task-supplied, **not independently confirmed today** |
| Open button | automation id `1` | Task-supplied, **not independently confirmed today** |
| Address-bar keyboard shortcut | Alt+D | Standard Explorer/common-dialog behavior, well-established |
| Copy file from Explorer to clipboard | Select + Ctrl+C → sets `CF_HDROP`; read via `DragQueryFile` (count first with `iFile=0xFFFFFFFF`) | Confirmed (MS Learn + community) |
| Read Explorer selection without keystroke | COM: `SHDocVw.ShellWindows` → `IShellFolderViewDual2.SelectedItems()` | Confirmed working code (public gist) |
| Chrome file input, extension connected | Extension/Claude Code sets file bytes directly on `<input type=file>` (`file_upload` tool, `paths`/`document_ids`) — **no OS picker involved** | Confirmed (code.claude.com/docs/en/chrome, platform.claude.com browser-use-tool doc) |
| Chrome file input, extension NOT connected | Real OS `IFileDialog` opens — must be driven like any other Open dialog | Inferred from above (no extension = no interception) |

---

## Sources (all URLs used)

Official Anthropic:
- https://code.claude.com/docs/en/chrome
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool
- https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome
- https://support.claude.com/en/articles/12902446-claude-in-chrome-permissions-guide
- https://support.claude.com/en/articles/12902405-claude-in-chrome-troubleshooting
- https://claude.com/claude-in-chrome
- https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn
- https://github.com/anthropics/claude-quickstarts (computer-use-demo)
- https://github.com/anthropics/skills (public skills repo — confirmed chrome-browser/built-in-browser NOT present)

GitHub issues (anthropics/claude-code):
- #39696, #39558, #89148 (focus stealing)
- #83680, #26449 (disconnects)
- #22885 (Windows reconnect fails)
- #95158 (phantom tab state)
- #38811 (enabledMcpTools blocking tools)
- #31119 (tab cleanup)

Third-party / community (marked UNVERIFIED in text where used):
- https://gist.github.com/sshh12/e352c053627ccbe1636781f73d6d715b (extension internals, reverse-engineered)
- https://github.com/noemica-io/open-claude-in-chrome
- https://www.dassi.ai/blog/why-claude-code-chrome-extension-keeps-disconnecting/
- https://gist.github.com/CheetahChrome/5cf7b831c26f66a791f1276feb1e946a (Explorer→clipboard C#)
- https://www.codeproject.com/Articles/32718/Setting-the-Clipboard-File-DropList-with-DropEffec
- https://metadataconsulting.blogspot.com/2020/05/CSharp-How-to-get-Clipboard-incoming-DragDropEffects-for-FileDrop-and-set-in-back.html
- https://github.com/cisgz3a-hub/KerfDesk/pull/804 (dialog automation id observation)

Microsoft Learn (Win32/.NET):
- https://learn.microsoft.com/en-us/windows/win32/shell/clipboard
- https://learn.microsoft.com/en-us/dotnet/api/system.windows.clipboard.setfiledroplist
- https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.clipboard.setfiledroplist
- https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.clipboard.getfiledroplist
- https://learn.microsoft.com/en-us/windows/win32/shell/launch
- https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shellexecutea
- https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.processstartinfo.useshellexecute
- https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowthreadprocessid
- https://learn.microsoft.com/en-us/windows/win32/shell/common-file-dialog
- https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/finding-the-process-id

Other agents surveyed:
- https://github.com/openai/codex/issues/46585
- https://github.com/openai/codex/issues/20785
- https://en.wikipedia.org/wiki/OpenAI_Operator
- https://docs.openinterpreter.com/code-execution/computer-api
- https://github.com/microsoft/UFO
- https://arxiv.org/html/2402.07939v1
- https://arxiv.org/pdf/2504.14603
- https://github.com/microsoft/WindowsAgentArena
- https://microsoft.github.io/WindowsAgentArena/
- https://medium.com/@robinclick/automate-upload-file-dialog-in-web-automation-b94349db9db1
