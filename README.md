# Better Computer Use

[![M8ven Score](https://m8ven.ai/badge/mcp/ridelink0/claude-computer-use)](https://m8ven.ai/mcp/ridelink0/claude-computer-use?s=readme)

Codex-style computer use for Claude Code, on Windows and macOS — the accessibility-tree way, not screenshots.
(The macOS host has never been compiled or run on a Mac: see [About the macOS host](#about-the-macos-host).)

> Install id: `computer-use`.

It reads the accessibility tree, the structured data a screen reader uses, so it
clicks controls by name instead of guessing coordinates from a screenshot. It
can tell your input from its own, so you can keep working while it works.

```
/plugin marketplace add ridelink0/claude-computer-use
/plugin install computer-use@computer-use
```

Windows or macOS, and Node 18+. Read the warning below before you run the
second line. More in [Install](#install).

---

## Read this before you install it

> **WARNING — this plugin lets Claude control your computer. It clicks real
> buttons in your real applications and types into your real documents.**
>
> There is no undo. If Claude clicks Delete, the thing is deleted. If it types
> into the wrong window, that text is in the wrong window. If a web page you
> told it to read contains text designed to fool it, it has been fooled while
> holding your mouse.
>
> **Only install this if all of these are true:**
>
> - You are comfortable with software that moves your cursor and presses keys.
> - You will be at the machine, watching, the first several times you use it.
> - The work you care about is saved, committed, or backed up first.
> - You are the owner of this computer and nobody else's data is on it.
>
> **Do not install this** on a work machine you do not administer, on a machine
> holding anyone else's data, or on anything you would not hand to a careful but
> literal-minded stranger for ten minutes.
>
> Computer Use refuses to touch password managers, UAC prompts and login screens, and it
> has no ability to kill a process. Those limits are real and they are enforced
> in code. They are not a substitute for supervising it.
>
> MIT licensed, which means no warranty. If it breaks something, that is on you.

---

Most computer-use agents look at **pixels**. They take a screenshot, ask a model
to find the button in the picture, and click where it guesses. That is expensive,
it breaks when you change your display scaling, and it cannot see anything that
is scrolled out of view.

This one reads the **accessibility tree** — the same structured data a screen
reader uses. It gets the real name and identity of every control, so it does not
guess coordinates, and it can invoke a button through its own accessibility
action without moving your mouse at all.

That last part is what makes the next bit possible.

## It gets out of your way

You can keep working while it works. Same desktop, same keyboard, same mouse.

Windows stamps every synthetic input event with a flag in the kernel that the
injecting process cannot clear. So Computer Use can tell, exactly and continuously, which
input came from you and which came from itself. macOS gets the same thing a
different way.

It shows you what it touched, too: a small marker in Claude’s colour flashes
around each control as it acts. Computer Use never touches your system cursor, so it
cannot leave it in a bad state, which is the [standing Codex bug on
Windows](https://github.com/openai/codex/issues/25200). The marker is
click-through, never takes focus, stays out of alt-tab, and is excluded from
screen capture so Computer Use never photographs its own UI. `CU_OVERLAY=off` if you
would rather not see it.

Once it knows that, it can behave:

- Reading a window never touches your input at all, so it can look at anything
  any time, including windows that are behind others.
- Pressing a button through its accessibility action does not move your cursor
  or steal your focus, so most of what it does you will never feel.
- When it genuinely needs the pointer, it waits for a gap in your typing, takes
  it, and puts the pointer back where you left it.
- A real click activates the window it lands in, and keystrokes need their
  window in front. When an action takes the foreground from the window you
  were in, it hands it back as soon as that action (or the whole run) ends, so
  what you type next goes where you meant it to. It leaves the window in front
  while a menu or dropdown it opened is still showing (those close the moment
  their app loses the foreground) and gives it back after the next action; it
  does not if you have clicked somewhere yourself since, and never in `take` or
  `exclusive` mode.
- If you are actively typing in a window, it will not touch that window. It goes
  and does something else.

If the input hooks it uses are blocked - security tooling sometimes throttles a
freshly compiled unsigned binary that installs global hooks - it falls back to a
hook-free idle check and says which one it is using in `computer_status`. It never
pretends to know you are there when it does not.

Measured during the test suite: Computer Use fired 36 input events, and the presence
tracker counted **zero** user activity from them.

```
injected +36, real +0, idle now 5395ms
```

That is the whole feature in one line. It knows the difference.

Codex does not do this on Windows. Its own documentation says so:

> "On Windows, the model is simpler and more constrained: Codex takes over the
> foreground, and you cannot use the same desktop session while a Computer Use
> task runs."

There is no idle detection and no user-disturbance prevention there. On macOS it
solves the problem the other way, with a sandboxed second session. Computer Use solves it
on the shared desktop, on both.

## And out of the other Claude's way

You can also run more than one Claude Code session against the same desktop.
That is a different problem from coexisting with a human, and the injected-input
flag cannot solve it: a second Claude's input is flagged synthetic too, so every
session would see the other one's typing as "not the user" and type straight
over it.

So sessions register with each other, in a directory the install shares:

- **Input is serialised.** One session sends input at a time; the others queue
  behind a machine-wide lease and are told they waited. A session that dies
  holding it loses it - liveness is the process, not a timeout.
- **Each session gets its own banner row and its own Stop button**, so a second
  Claude can never hide the first one's way out. Once there are two, each banner
  says which session it is. Escape still stops all of them at once.
- **Each session gets its own cursor, in its own colour.** Session one stays
  Claude's orange, so nothing changes when you run one; a second session draws
  in teal, a third in violet. A session's cursor, marker, banner and ring all
  share that colour, so "which Claude just clicked that" is answerable at a
  glance, and two cursors on the same control are staggered so both stay
  visible. Every session's chrome is invisible to every other session's
  listings, so no Claude can target another Claude's banner.
- **Grants never cross sessions.** Session 2 has to ask for its own.
- **Working in the same window as another session is called out** in the result,
  because that is the one case where two correct agents still produce nonsense.
- **`computer_status` names the other sessions** and what they last touched.

A session that goes quiet keeps its slot - it is idle, not gone. Only a dead
process is pruned.

## More than one desktop

**Several monitors** need nothing from you. Everything is in virtual-screen
coordinates, so rects, clicks and captures are right on any display, including
ones left of or above the primary where coordinates go negative. The banner
picks the monitor holding the window you are working in, rather than centring on
the virtual screen - which on two monitors is the seam between them.

**Windows virtual desktops** are the interesting case, and there is one honest
limit. Windows serves the *frame* of a window on a desktop you are not looking
at - title bar, minimise, maximise, close - and none of its contents. That is
the operating system's decision, not something a plugin can route around. So:

- A window on another desktop is still listed, by `computer_apps
  { include_hidden: true }`, marked `[other virtual desktop]`. It does not
  silently vanish the moment you switch away, which is what happens if you only
  ask the accessibility tree.
- Reading one tells Claude plainly that only the frame is available and why, so
  it reports "that window is on your other desktop" instead of "that app appears
  to be empty".
- **The banner follows you.** Switch desktops mid-run and the "Claude is using
  your computer" banner, and its Stop button, come with you. An agent whose only
  visible stop is on a desktop you are not looking at is an agent you cannot
  stop.
- Set **Virtual desktops Claude may work on** to `current` in the plugin
  settings to confine a session to the desktop you are on: windows elsewhere
  become invisible to it, and naming one by handle is refused. `all`, the
  default, lets it see them and say where they are.

`CU_DESKTOP_TEST=1 node tools/desktop-test.mjs` proves this on your machine. It
creates a second virtual desktop, switches to it, checks all of the above, and
closes it again. Without `CU_DESKTOP_TEST=1` it runs nothing and says so.

## Before it sends, pays, or deletes

A control whose own label reads `Send`, `Pay`, `Place order`, `Delete` or
`Publish` is refused the first time, naming the control. Claude has to tell you
what it is about to do and get an answer before it can press it.

This is the one thing OpenAI's agent got unambiguously right: an agent holding
your real accounts should stop at the point of no return, not after it. Reading
is never gated and ordinary controls click straight through; turn the gate off
in the plugin settings if you would rather it did not.

## The cost difference

| | tokens |
|---|---:|
| Reading a window as a tree | **~478** |
| The same window as a screenshot | **~10,719** |
| A live web page in Opera, read as a tree (0.2.0) | **~500** |

**Twenty-two times.** Run `node tools/mcp-test.mjs`; it prints this at the end
of every run, on your machine, with your windows.

And it is fast. 0.1.0 read a window one property at a time - about thirty
cross-process calls per element, which on a 200-element browser window took
two to five seconds. 0.2.0 asks the provider for the whole subtree in one
batched request and gets every property back at once:

| the same Opera window, 143 elements | 0.1.0 | 0.2.0 |
|---|---:|---:|
| snapshot | 1,700-5,500 ms | **110-250 ms** |
| tokens in the result | ~2,000 | **~500** |

The token cut is the renderer saying less: in a browser it shows the page, the
URL and the tabs and hides the sixty-odd toolbar and sidebar controls (pass
`chrome: true` to see them); a Button no longer carries an `[Invoke]` tag,
because a button that can be pressed is just a button; links show their target
inline, shortened when it stays on the same site; indentation follows the
elements actually shown rather than twenty levels of wrapper divs; and the notes
about an app ride on the grant instead of on every read.

And the tree is not just cheaper, it is better:

| Screenshot | Tree |
| --- | --- |
| Guesses coordinates from pixels | Knows the control's name and id |
| Breaks at 125% display scaling | Scaling makes no difference |
| Sees only what is visible | Includes text scrolled out of view |
| Needs the window in front | Reads windows sitting behind others |
| A wrong guess clicks the wrong thing | A dead element returns `element_stale` |

Pixels still win for canvas apps — image editors, games, charts, design tools —
so `computer_screenshot` is there. It is just not the default any more.

## Reading a window twice costs almost nothing

The expensive part of computer use is not the first read, it is the fifth.
Read, act, read again to see what happened, act, read again: every one of
those reads used to cost the whole tree.

In 0.3.0 every element keeps its index for as long as it exists, keyed on the
accessibility RuntimeId. So a second read of the same window says only what
moved:

```
s7 "Calculator" hwnd=2624072 | changes since s6: +0 ~3 -1, 48 same | 54ms

~ [6]  Text "Display is 25" #CalculatorResults
~ [31] Button "Five" #num5Button {focused}
- [44] Text "Expression is 9 × 6="
```

| read | tokens |
|---|---:|
| first read of a window | ~400 |
| re-read, nothing changed | **~26** |
| re-read, one control changed | **~33** |

And an index seen once can be acted on for the rest of the task, without a
snapshot id and without reading again. `find: "save"` returns only the rows
that match a word or a `/regex/`; `index: 12` reads one subtree; `full: true`
asks for the whole listing again.

## A sequence is one call, not four

Going to a URL is four actions. As four tool calls it is four model turns, and
Claude Code will not stop the sequence when one of them fails - a click that
missed is still followed by the typing that needed it. So it is one call:

```
computer_run { hwnd, steps: [
  { key: "ctrl+l" },
  { type: "https://..." },
  { key: "enter" },
  { wait_for: { change: true } }
] }
```

Five steps on a calculator, one round trip, 822 ms:

```
computer_run { hwnd, steps: [
  { click: { selector: { automation_id: "num9Button" } } },
  { click: { selector: { automation_id: "multiplyButton" } } },
  { click: { selector: { automation_id: "num6Button" } } },
  { click: { selector: { automation_id: "equalButton" } } },
  { wait_for: { text: "Display is 54" } }
] }
```

The result ends with the delta since Claude's last read of that window. Every
step goes through the same gate a single call would - grant, tier, the
send/pay/delete confirmation, the input lease between Claude sessions.

Three things make a run safe to reach for by default:

- **Every step is checked before the first one runs.** A malformed step means
  nothing happened at all, rather than a window left half-changed.
- **It stops at the first failure**, and names the steps it never reached.
- **A step can name its own window.** `window: "new"` is whatever opened during
  the run, so a sequence can follow the Save dialog it just caused instead of
  ending at it. `optional: true` lets a step fail without stopping the run, and
  `repeat: N` runs one step N times.

A `confirmed: true` step is refused in a background run: a send, a payment or a
deletion happens in the foreground, where you are there to answer.

`background: true` returns a task id at once. Claude goes on reading another
window or running a shell command while the desktop side proceeds;
`computer_task` reports progress, waits, or cancels. That is what lets you and
Claude each get on with your own work at the same time.

`computer_wait_for` now waits for what matters: `text` appearing (or going),
`change: true` (the window differs from what Claude last read - the answer is
the delta), `new_window: true` (a dialog opened), or a selector appearing or
`gone`. Every action also reports a window that appeared during it.

## Typing into the window behind yours

`computer_type { index, text }` on a window that is not in front posts the
characters straight to the control - the same messages a keystroke produces
after translation - reads the control back to confirm, and only falls back to
real keystrokes when the control ignored them. No focus change, no raise, no
cursor. `via posted` in the result means your window never moved.

Clicking is the honest exception, and `tools/fg-probe.mjs` measures it. Reading
a window never disturbs anything, and posted typing never does. But a click
through a control's own accessibility pattern - Invoke on a button, Toggle on a
checkbox - and a `replace: true` write both bring the window to the front on
WinForms, because the framework focuses the control it is acting on before
doing the work. That is the framework, not this plugin, and it is the same for
a single call and for a step inside a run; `background: true` does not avoid it
either. Other toolkits route pattern actions differently, so run the probe
against the app you care about rather than assuming. Until then: if your
foreground matters, Claude can read and type behind you all day, and a click
may surface the window.

`computer_launch { app: "notepad" }` starts an app and waits for its window,
the way Codex's `launch_app` does. Shells are refused, Windows-key chords are
refused, and the Run dialog reads as a terminal, because all three are the
command line by another door.

`node tools/cli.mjs snapshot '{"title":"Notepad"}'` drives the server from a
shell against your real windows and prints what each call cost.

## What ChatGPT's computer use gained with GPT-6 Astra, and where it is here

With GPT-6 Astra (September 2026) the ChatGPT desktop app's computer use
gained, as its users see it: **Appshots** (both Command keys send the front
window's picture and text, including text outside the visible area, into the
chat), **Locked use** (a Mac keeps working after it locks), **Remote** (start,
steer and approve from the phone), review pauses when the model may have
misread an instruction, and on Windows a host that captures windows behind
other windows, reads menus and popups, drags, and launches installed apps by
name. 0.6.0 carries the Claude Code versions:

- **Appshots.** Press **both Ctrl keys** while Computer Use is running and
  the window in front is filed - its tree with off-screen text, plus a
  picture. The text lands in front of Claude with your next prompt (a
  UserPromptSubmit hook), and `computer_appshot` shows the picture. Off with
  the "Appshot hotkey" setting.
- **Menus and popups.** Context menus, dropdown lists and popups are listed
  as `[menu]`, `[dropdown list]`, `[popup]` with their owning window, appear
  as `New window:` on the action that opened them, and are read and clicked
  by index like anything else.
- **Windows behind windows.** A screenshot of a window that is partly covered
  is the window rendering itself (PrintWindow with full content), not the
  cover. The caption says when that happened, and when an app refused.
- **Drag.** `computer_drag` and the `drag` step, for canvases, sliders,
  handwriting and 3D viewports.
- **Launch by name.** `computer_launch { app: "Spotify" }` resolves Start-menu
  names, Store apps included; `computer_apps { installed: "spot" }` lists what
  is installed.
- **Remote.** Claude Code's Remote Control already drives this session from
  a phone; the skill tells Claude what that changes (nobody at the keyboard,
  Stop and Esc are for whoever is at the desk).
- **Locked use** is not here: a locked Windows desktop is the secure
  desktop, which UI Automation cannot reach, so it is refused
  (`desktop_locked`) rather than attempted.
- **macOS host, second pass.** Window handles no longer shift with window
  order, Escape stops a run, right and double clicks and point clicks work,
  key chords go to the named window or refuse, drag, clipboard, describe and
  busy exist, screenshots capture the window itself, and typed newlines are
  keys. Still uncompiled on a Mac; `node server/build.mjs --self-test` first.

## Notes across context windows, and what a turn ending means

GPT-6 Astra's computer use (September 2026) added a few things worth having
here, and 0.5.0 has them - built the way Claude Code can actually use them:

- **Notes across context windows.** The server keeps a journal of every call -
  what, where, what came back - and your notes. After a compaction or a resume,
  the plugin's SessionStart hook prints it back into context by itself;
  `computer_recap` gives the live version any time (grants, the windows you
  worked in with their still-valid handles and indices, running tasks, notes,
  the last actions) and `computer_recap { find }` searches all of it.
  `computer_recap { note }` saves a note that survives compaction.
- **The turn ending is a boundary.** Codex's plugin is told when the turn ends
  and stops issuing input. So is this one: a Stop hook calls
  `computer_turn_ended`, a background run stops after its current step, and the
  next result says so. If you would rather let runs finish, the setting
  "Background runs at turn end" does that. A background run nobody has checked
  on for ten minutes stops on its own either way.
- **Async results without polling.** A finished background run is announced at
  the top of the next result, whatever tool that is.
- **Steering.** `computer_task { id, steps }` appends steps to a running
  background run without cancelling it.
- **A safety monitor.** Astra pauses a task when the agent may have taken
  something for an instruction. Here, a read whose rows read like instructions
  to an agent gets one `WARNING:` line naming them, and a run that reads such a
  window halts there so the user hears about it first.
- **Hand-off.** Age verification, CAPTCHAs, "proceed anyway" safety warnings and
  paywall bypasses are refused outright, not confirmable. The confirmation list
  now also covers account creation, saved passwords and cards, API keys,
  browser extensions, "run anyway", sharing and permission changes, bookings,
  and social reactions. The lock screen, the Claude/ChatGPT/Codex desktop apps,
  authenticators and wallets are blocked; remote-desktop clients are sensitive.
- **The banner says what it is doing** - "Claude is using your computer ·
  typing in notepad", "· thinking" - in Claude's own colours, the way Codex's
  preview shows its activity.

**If the internet drops** mid-task: everything here runs locally, so nothing on
the desktop breaks, but Claude's turn ends on the API side. The StopFailure hook
treats that exactly like Stop - background runs stop after their current step -
and the journal has everything up to that moment, so a resumed session picks up
with `computer_recap`. The journal lives in the plugin's data directory beside
the session registry, one file per server process, pruned after a week; typed
text in it is cut to 24 characters and clipboard contents are never written.

## Install

```
/plugin marketplace add ridelink0/claude-computer-use
/plugin install computer-use@computer-use
```

Windows or macOS, and Node 18+. Nothing else. No npm install, no Python, no
native module, no download.

The host is a small program that talks to the OS accessibility API. On first run
it is compiled on your machine by a compiler you already have — `csc.exe` from
the .NET Framework on Windows, `swiftc` from the Xcode tools on macOS.

It ships as **source, not a binary**. What runs on your machine is exactly what
you can read in `server/native/`. Nothing is downloaded.

## Using it

```
computer_apps                                find the window, note its hwnd
computer_snapshot { hwnd }                   read it, every element gets an index
computer_grant { hwnd }                      needed to act, never to read
computer_run { hwnd, steps: [...] }           every stretch of known actions, one call
computer_click { index: 12 }                 one action whose result you must see first
computer_clipboard                           read it; { text } sets it
computer_paste { text }                      ctrl+v, and your clipboard survives
computer_paste { files: [...] }             paste a document as a file drop; { file, as_text } pastes its text
computer_open { path }                       open a document or folder in its default app, wait for the window
computer_file_dialog { hwnd, path }          drive the Open/Save dialog an app showed: path in, confirm
```

In a browser the snapshot is the page: its URL in the header, the tabs, and
every link, button and field by name. `computer_type { replace: true }` on a
web field writes through the value pattern and the page's own `input` handlers
fire - a search box filled that way shows its results - with no keystrokes and
no need for the window to be in front.

Every acting tool takes a `mode`:

| mode | what it does |
| --- | --- |
| `share` | default. Waits for a gap before using your cursor or focus. |
| `yield` | refuses outright while you are active. |
| `take` | interrupts you. For when you asked it to drive and are watching. |
| `exclusive` | like `take`, and also holds your mouse and keyboard off for the length of each action. |

### Working behind you, on a window you can't see

This is the default, and it is the whole point. You can be typing in a document
in front while Claude operates a different app sitting behind it. Clicking a
control through its accessibility action, and filling a field through its value
pattern, **do not raise the window** — the stack stays exactly as you left it,
your foreground app stays in front, and your keystrokes keep going where you are
looking. Reading a window never disturbs anything either.

Only three things need a window in front, and Claude saves them for when you are
idle: raw typing with no target element, keyboard chords, and the rare
physical-click fallback for a control that exposes no accessibility action.

### The two ways to take it back

- **The Stop button** on the "Claude is using your computer" banner. It aborts
  the run and withdraws every input grant, so nothing can act again without a
  fresh grant.
- **Escape.** Always releases everything and halts the run, even mid-action.
  This is the guaranteed escape hatch: the key hook lives in the same process
  that would be holding your input, and that process still sees Escape even while
  everything else is blocked. On top of that, any input hold releases itself
  after a few seconds no matter what, Windows releases it the instant the host
  process exits, and Ctrl+Alt+Del can never be blocked by anything.

### About `exclusive` mode

`exclusive` holds your physical mouse and keyboard off while each action runs, so
your hand cannot land in the middle of a click. It needs Claude Code to be
running **elevated** — Windows refuses to block input from an ordinary process,
and when that happens the action still runs, just without the hold, and the
result says `exclusive_unavailable`. Escape releases it regardless. It is
opt-in and never the default, precisely because a locked-out user cannot reach
the Stop button — Escape is why it is safe to offer at all.

Twenty-three tool names and the server note are the always-on cost, about
**480 tokens**; the schemas load on first use (about 3,430) and again
after a compaction. Both are what `node tools/mcp-test.mjs` measures, on this
machine at 0.9.1: the JSON of `tools/list` for the schemas, and the names as
Claude Code lists a deferred tool (under the server's prefix) plus the server
note for the always-on part, at one token per four characters. One screenshot
you did not take (about 10,000 tokens) pays for the schemas three times over.

### Clipboard

`computer_clipboard` reads the clipboard text, or sets it when given `text`.
That is how text gets out of an app that will not expose it any other way -
select, `ctrl+c`, read. Codex has it; now so does this. It leaves what it set
on the clipboard, so it is a way to read, not a way to paste.

`computer_paste { text }` is the way to paste, and it gives your clipboard
back. It copies out everything that was on it first - an image, a file you were
about to drop somewhere, formatted cells, not only text - sets its own text,
sends `ctrl+v`, and restores the lot. If it cannot copy something out it
refuses to paste at all rather than destroy it, and if you copy something of
your own while it is working it leaves your newer copy alone. That matters
because this plugin's whole claim is that you can keep working while it works,
and a tool that silently emptied your clipboard would make that a lie. Windows
only for now: the macOS host has no paste yet, so the tool is not offered
there. The same goes for `computer_open` and `computer_file_dialog`: on macOS
none of the three is in the tool list, and a `computer_run` step that names
one (`paste`, `open`, `file_dialog`) gets `unsupported_on_macos` from the
host, which says what to do instead.

`computer_paste { files }` puts a real file drop on the clipboard - what
Explorer's own Ctrl+C puts there - which attaches the file in a mail, a chat
or a Word page. Whether a browser's bare upload box takes a pasted file is
UNVERIFIED (no live test yet); a page's Browse button opens the OS picker,
and `computer_file_dialog` drives that.

### When a window's tree is empty

Accessibility is opt-in, at the application and at the OS, and switched off it
looks exactly like an app with no UI: the window is found, the tree comes back
with nothing in it, and nothing reports an error. A read that lands in that
state says **BLIND TREE** and says what it can about why - an Electron or
Chromium app whose renderer bridge is off, which
`--force-renderer-accessibility` on its command line turns on; a page or
surface drawn into a canvas, which no flag will fix; or, when the two causes
are genuinely indistinguishable, that they are, rather than picking one. Every
case ends at `computer_screenshot`. It will not cry blind at a window that
merely has little in it: it fires only when nothing at all in the tree would
have reached you.

### Always-allowed apps

Codex has `always_allowed_app_ids`; this has **Always-allowed apps** in the
plugin settings. An app on that list is granted on first use instead of
refused, and the result says so. Blocked and shell tiers stay ungrantable
whatever the list says.

### Slash commands into another Claude Code terminal (off unless you turn it on)

Terminals are read-only to Computer Use. One narrow exception exists, and it is
off by default: with **Let Claude type slash commands into other Claude Code
terminals** set to `on` in the plugin settings (or
`COMPUTER_USE_ALLOW_SLASH_COMMANDS=1` in Claude Code's environment), a
terminal window whose title says "Claude Code" can be granted **slash commands
only**. The grant is for that one window. Through it Claude can type exactly one
line that is a Claude Code slash command - `/compact`, `/usage`,
`/model sonnet` - and then press Enter in the same window within 20 seconds.
Everything else is refused with `slash_only`: ordinary text, a second line, a
paste, a click, any other key, a second Enter. Nothing a tool call can pass
turns the setting on, the session's own terminal can never be granted, and a
Stop press withdraws it with every other grant.

The risk is the command itself. The other session obeys the slash command it is
given, and some cannot be undone: `/clear` throws away that conversation's
context, `/logout` signs it out. Turn this on only if you want one Claude to
steer another, and leave it off otherwise.

## What it will not do

Reading is free. Acting needs a grant, per app, for that session only.

| tier | behaviour |
| --- | --- |
| `standard` | grant and go |
| `sensitive` | grantable, but it tells Claude what that app reaches. A browser carries every session you are signed in to. |
| `shell` | terminals and editors. Readable, **never typeable** — anything typed there runs as you. (The one opt-in exception: slash commands into another Claude Code terminal, above.) |
| `blocked` | password managers, UAC prompts, login screens. **Not even readable**, because their accessibility tree has the secrets in plain text. |

**It cannot answer for you at the point of no return.** Send, pay, order and
delete controls need an explicit confirmation, per click. The one exception you
can make: tell Claude a message-type control (Send, Post, Reply all, Upload,
Like) may be pressed without asking for the rest of the session, and it holds
until the session ends - never saved, never in a background run, and never on
the strength of text that was on the screen. Payments, deletions, installs and
access changes are asked every time, whatever you said before.

**It cannot kill a process.** There is no such tool. `computer_close_window` asks one
window to close, exactly as clicking its X does, so the app can still offer to
save.

That one is there because of a real accident while building this. Terminating
what looked like a spare Notepad launcher destroyed an unrelated unsaved note,
because Windows 11 Notepad runs every window inside one shared process. A PID is
not a window. Computer Use does not get to make that mistake.

Your Claude Code session is excluded from its own listings, so text on your
screen cannot loop back into the model as if it had observed it. That includes
the terminal window the session is drawn in: Windows Terminal draws every
terminal window from one process, so the window is found through the session's
console rather than by process. Add your own
blocked apps in the plugin settings; that list only ever grows.

A few knobs live only in the environment of the Claude Code process, for
people debugging the host: `CU_OVERLAY=off` hides the on-screen marker and
banner, `CU_PRESENCE=off` disables the input hooks, `CU_WAIT_MS` is how long
`share` mode waits for you to pause (default 6000), `CU_SNAPSHOT_MS` is the
wall clock for one read (default 8000).

## What it does not do

- **Linux.** Would need an AT-SPI driver. Does not exist yet.
- **Canvas apps.** Roughly one target in twenty has no accessible structure.
  Use `computer_screenshot` and point targeting there.
- **No elevation, no UAC, no process control.** Deliberate.
- **macOS is a port I could not test.** See below.

## About the macOS host

Straight about this: the Windows host has 190 tests and I have driven real
applications with it end to end. The macOS host was written on a Windows machine
and has never been compiled or run.

The design is sound — same protocol, AXUIElement instead of UI Automation, a
listen-only event tap instead of low-level hooks — but sound is not tested.

Before trusting it:

```
node server/build.mjs --self-test
```

If it does not compile you get the compiler's own output, not a mystery. If that
happens, [open an issue](https://github.com/ridelink0/claude-computer-use/issues) with it and I
will fix it.

## Tests

```
node tools/test-all.mjs        every suite below
node tools/verify.mjs           33  drives real windows end to end, cursor never moves
node tools/policy-test.mjs     226  tiers, grants, refusals, deny over allow, what needs confirming and who can say yes, pre-approval, what open may hand a file to, the slash-command grant
node tools/sessions-test.mjs    62  two Claudes: slots, the input lease, dead sessions, how long a pre-approval lasts
node tools/presence-test.mjs    32  telling you apart from Computer Use, overlay, banner
node tools/build-test.mjs       15  compile, idempotence, concurrent builds, manifest and marketplace versions agree
node tools/host-test.mjs        57  tree, patterns, input, crash recovery
node tools/mcp-test.mjs         67  the protocol end to end, prints token costs
node tools/batch-test.mjs       69  stable indices, deltas, find, waits, runs, tasks, posted input, launch
node tools/fixes-test.mjs       21  names, landmarks, exclude, find on the printed row, max_nodes, run fields, resumed grants
node tools/annotations-test.mjs 139  every tool in tools/list, named, has true readOnly/destructive/idempotent/openWorld hints
node tools/web-test.mjs         31  a web form in an InPrivate Edge window: click states, disabled and re-rendered
                                    buttons, scrolling without the pointer, waits, the foreground coming back

and one that is deliberately not in that run, because it moves your screen,
and that runs nothing unless asked by name:

CU_DESKTOP_TEST=1 node tools/desktop-test.mjs   11  a real second virtual desktop, created and closed
```

They build their own throwaway window and never touch anything already open.
Past the happy paths they cover stale indices, a host killed mid-session, five
concurrent calls, a window covered by another window, minimized windows, two
sessions compiling at once, a session that died holding the input lease, a
registry that cannot be written to, a window parked under the banner, a tree too
slow to finish reading, typing that would have landed in the wrong window, and
every error code.

## What changed, and when

[CHANGELOG.md](CHANGELOG.md) has every released version with the tag it sits
on, newest first, and says plainly which parts have not been run on real
hardware.

## Where the idea came from

This is a study of what makes Codex's computer use good, rebuilt from scratch.

The lineage runs through **Sky** (Software Applications Incorporated, bought by
OpenAI in October 2025) and before it **Workflow**, which became Apple Shortcuts.
Sky's insight was that an agent should know what actions an app *affords*, not
just what pixels it is showing, and that it should read a window whether or not
that window is in front. Its "Skyshot" — a picture of a window plus a textual
representation of it — became Codex's "Appshot", and is the direct ancestor of
`computer_snapshot`.

No code is shared with any of them.

## License

MIT. No warranty. Read the warning at the top again.
