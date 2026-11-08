// Computer Use host - persistent Windows UI Automation driver.
//
// Speaks line-delimited JSON on stdin/stdout. One host per Computer Use session, so
// AutomationElement references stay live between calls and a tree lookup costs
// milliseconds instead of re-walking from the desktop root every time.
//
// This is compiled locally at install time by the csc.exe that ships with
// every Windows .NET Framework install. It is shipped as source, not as a
// binary, so what runs on your machine is exactly what you can read here.
//
// Language level is C# 5 - that is what the in-box compiler supports. No string
// interpolation, no null-conditional operators, no expression-bodied members.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Forms;

namespace Axon
{
    internal static class Native
    {
        [DllImport("user32.dll")] internal static extern bool SetProcessDPIAware();
        [DllImport("user32.dll")] internal static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
        [DllImport("shcore.dll")] internal static extern int SetProcessDpiAwareness(int value);

        [DllImport("user32.dll")] internal static extern bool SetCursorPos(int x, int y);
        [DllImport("user32.dll")] internal static extern bool GetCursorPos(out POINT p);
        [DllImport("user32.dll")] internal static extern IntPtr WindowFromPoint(POINT p);
        [DllImport("user32.dll")] internal static extern IntPtr GetAncestor(IntPtr h, uint flags);
        [DllImport("user32.dll")] internal static extern bool EnumChildWindows(IntPtr parent, EnumChildProc cb, IntPtr lparam);
        [DllImport("user32.dll")] internal static extern bool EnumWindows(EnumChildProc cb, IntPtr lparam);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern int GetWindowTextW(IntPtr h, System.Text.StringBuilder text, int max);
        [DllImport("user32.dll")] internal static extern int GetWindowLongW(IntPtr h, int index);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern int GetClassName(IntPtr h, System.Text.StringBuilder cls, int max);
        [DllImport("oleacc.dll")] internal static extern int AccessibleObjectFromWindow(IntPtr h, int objectId, ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object acc);
        [DllImport("user32.dll")] internal static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
        internal delegate bool EnumChildProc(IntPtr h, IntPtr lparam);
        [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] internal static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] internal static extern bool ShowWindow(IntPtr h, int cmd);
        [DllImport("user32.dll")] internal static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] internal static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
        [DllImport("user32.dll", EntryPoint = "GetWindow")] internal static extern IntPtr GetWindowRel(IntPtr h, uint cmd);

        // True when the window is the topmost thing at its centre and four inset
        // corners - that is, a grab of its screen rectangle shows the window and
        // not something lying over it. Overlay windows of this host do not count.
        internal static bool IsUnobscured(IntPtr h, RECT r)
        {
            int w = r.Right - r.Left, ht = r.Bottom - r.Top;
            if (w <= 0 || ht <= 0) return false;
            int[][] pts = new int[][] {
                new int[] { r.Left + w / 2, r.Top + ht / 2 },
                new int[] { r.Left + 8, r.Top + 8 }, new int[] { r.Right - 8, r.Top + 8 },
                new int[] { r.Left + 8, r.Bottom - 8 }, new int[] { r.Right - 8, r.Bottom - 8 },
            };
            foreach (int[] p in pts)
            {
                IntPtr at = RootWindowAt(p[0], p[1]);
                if (at != h && !Overlay.IsAnyOverlayWindow(at)) return false;
            }
            return true;
        }
        [DllImport("user32.dll")] internal static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] internal static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll")] internal static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
        // Which window, if any, currently has the clipboard open. An app reading
        // the clipboard during a paste holds it for those few milliseconds, which
        // is the only observable sign that the paste has actually been read.
        [DllImport("user32.dll")] internal static extern IntPtr GetOpenClipboardWindow();
        // Bumped by every clipboard WRITE and never by a read, so comparing it
        // across a paste says whether anyone else copied while we were working.
        [DllImport("user32.dll")] internal static extern uint GetClipboardSequenceNumber();
        [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll")] internal static extern bool GetWindowRect(IntPtr h, out RECT r);
        [DllImport("user32.dll")] internal static extern bool AttachThreadInput(uint a, uint b, bool attach);
        [DllImport("kernel32.dll")] internal static extern uint GetCurrentThreadId();
        [DllImport("dwmapi.dll")] internal static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);
        [DllImport("user32.dll", SetLastError = true)] internal static extern uint SendInput(uint n, INPUT[] inputs, int size);
        [DllImport("user32.dll")] internal static extern bool BlockInput(bool block);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern bool PostMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] internal static extern bool GetGUIThreadInfo(uint tid, ref GUITHREADINFO info);
        [DllImport("user32.dll")] internal static extern bool ScreenToClient(IntPtr h, ref POINT p);
        // The console a process is attached to, and through it the terminal
        // window that shows this Claude Code session (see ConsoleWindowOf).
        [DllImport("kernel32.dll")] internal static extern bool AttachConsole(uint pid);
        [DllImport("kernel32.dll")] internal static extern bool FreeConsole();
        [DllImport("kernel32.dll")] internal static extern IntPtr GetConsoleWindow();
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] internal static extern bool Process32FirstW(IntPtr snap, ref PROCESSENTRY32W e);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] internal static extern bool Process32NextW(IntPtr snap, ref PROCESSENTRY32W e);
        [DllImport("kernel32.dll")] internal static extern bool CloseHandle(IntPtr h);
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        internal struct PROCESSENTRY32W
        {
            public uint dwSize; public uint cntUsage; public uint th32ProcessID; public IntPtr th32DefaultHeapID;
            public uint th32ModuleID; public uint cntThreads; public uint th32ParentProcessID; public int pcPriClassBase;
            public uint dwFlags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
        }
        // Which executable the shell would run for a file type's "open" verb -
        // the same association lookup ShellExecute makes, asked without running it.
        [DllImport("shlwapi.dll", CharSet = CharSet.Unicode)] internal static extern int AssocQueryStringW(uint flags, int str, string assoc, string extra, System.Text.StringBuilder outBuf, ref uint outLen);
        [StructLayout(LayoutKind.Sequential)]
        internal struct GUITHREADINFO
        {
            public int cbSize; public int flags;
            public IntPtr hwndActive; public IntPtr hwndFocus; public IntPtr hwndCapture;
            public IntPtr hwndMenuOwner; public IntPtr hwndMoveSize; public IntPtr hwndCaret;
            public RECT rcCaret;
        }

        // Exclusive mode: hold off the user's physical mouse and keyboard for the
        // length of a single action, so their hand cannot land in the middle of
        // one. BlockInput stops physical input only - synthetic input still goes
        // through, which is what makes this usable at all.
        //
        // Four independent ways out, because a tool that can lock you out of your
        // own machine must never be able to do so permanently:
        //   1. Esc. The keyboard hook lives in this same process, and the blocking
        //      thread still receives input, so Esc reaches us and releases.
        //   2. A watchdog releases unconditionally after ReleaseAfterMs.
        //   3. Scope is one action - milliseconds - never a whole run.
        //   4. Windows releases it by itself the moment this process exits, and
        //      Ctrl+Alt+Del can never be blocked by anything.
        const int ReleaseAfterMs = 4000;
        static readonly object _blockLock = new object();
        static bool _blocked;
        static DateTime _blockedAt;
        // Only the thread that blocked input can unblock it, so one thread
        // does both: it blocks, waits to be told to let go (an action ending,
        // Escape, or the deadline), and unblocks.
        static readonly System.Threading.ManualResetEvent _release = new System.Threading.ManualResetEvent(false);

        internal static bool BeginExclusive()
        {
            lock (_blockLock)
            {
                if (_blocked) return true;
                bool ok = false;
                _release.Reset();
                using (System.Threading.ManualResetEvent started = new System.Threading.ManualResetEvent(false))
                {
                    System.Threading.Thread holder = new System.Threading.Thread(delegate()
                    {
                        try
                        {
                            ok = BlockInput(true);
                            try { started.Set(); } catch { }
                            if (!ok) return;
                            // Nothing about a stuck action may leave the machine
                            // unusable: the hold ends by itself after ReleaseAfterMs.
                            _release.WaitOne(ReleaseAfterMs);
                            BlockInput(false);
                        }
                        catch { try { BlockInput(false); } catch { } }
                        finally { lock (_blockLock) { _blocked = false; } }
                    });
                    holder.IsBackground = true;
                    holder.Name = "computer-use-input-hold";
                    holder.Start();
                    started.WaitOne(2000);
                }
                if (ok) { _blocked = true; _blockedAt = DateTime.UtcNow; }
                return ok;
            }
        }

        internal static void EndExclusive()
        {
            lock (_blockLock) { if (!_blocked) return; }
            try { _release.Set(); } catch { }
        }

        internal static bool InputBlocked { get { lock (_blockLock) { return _blocked; } } }

        static void StartWatchdog()
        {
            // Kept for callers; the hold thread now releases itself.
        }

        [StructLayout(LayoutKind.Sequential)] internal struct RECT { public int Left, Top, Right, Bottom; }
        [StructLayout(LayoutKind.Sequential)] internal struct POINT { public int X, Y; }

        // Which top-level window actually owns a screen point.
        internal static IntPtr RootWindowAt(int x, int y)
        {
            POINT p = new POINT();
            p.X = x; p.Y = y;
            IntPtr h = WindowFromPoint(p);
            if (h == IntPtr.Zero) return IntPtr.Zero;
            IntPtr root = GetAncestor(h, 2 /* GA_ROOT */);
            return root == IntPtr.Zero ? h : root;
        }
        [StructLayout(LayoutKind.Sequential)]
        internal struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)]
        internal struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)]
        internal struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }
        [StructLayout(LayoutKind.Explicit)]
        internal struct INPUTUNION
        {
            [FieldOffset(0)] public MOUSEINPUT mi;
            [FieldOffset(0)] public KEYBDINPUT ki;
            [FieldOffset(0)] public HARDWAREINPUT hi;
        }
        [StructLayout(LayoutKind.Sequential)]
        internal struct INPUT { public uint type; public INPUTUNION u; }

        const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
        const uint MOUSEEVENTF_LEFTDOWN = 0x0002, MOUSEEVENTF_LEFTUP = 0x0004;
        const uint MOUSEEVENTF_RIGHTDOWN = 0x0008, MOUSEEVENTF_RIGHTUP = 0x0010;
        const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020, MOUSEEVENTF_MIDDLEUP = 0x0040;
        const uint MOUSEEVENTF_WHEEL = 0x0800, MOUSEEVENTF_HWHEEL = 0x1000;
        const uint KEYEVENTF_KEYUP = 0x0002, KEYEVENTF_UNICODE = 0x0004, KEYEVENTF_EXTENDEDKEY = 0x0001;

        static int InputSize { get { return Marshal.SizeOf(typeof(INPUT)); } }

        static INPUT MouseInput(uint flags, uint data)
        {
            INPUT i = new INPUT();
            i.type = INPUT_MOUSE;
            i.u.mi.dwFlags = flags;
            i.u.mi.mouseData = data;
            return i;
        }

        static INPUT KeyInput(ushort vk, ushort scan, uint flags)
        {
            INPUT i = new INPUT();
            i.type = INPUT_KEYBOARD;
            i.u.ki.wVk = vk;
            i.u.ki.wScan = scan;
            i.u.ki.dwFlags = flags;
            return i;
        }

        internal static void MouseButton(string button, bool down)
        {
            uint f;
            if (button == "right") f = down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP;
            else if (button == "middle") f = down ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP;
            else f = down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP;
            Presence.NoteSelfInput();
            SendInput(1, new INPUT[] { MouseInput(f, 0) }, InputSize);
        }

        internal static void MouseWheel(int delta, bool horizontal)
        {
            Presence.NoteSelfInput();
            SendInput(1, new INPUT[] { MouseInput(horizontal ? MOUSEEVENTF_HWHEEL : MOUSEEVENTF_WHEEL, unchecked((uint)delta)) }, InputSize);
        }

        // Unicode injection is keyboard-layout independent, so text types the
        // same on a Dvorak or AZERTY machine as on QWERTY.
        internal static void TypeUnicode(string text)
        {
            foreach (char c in text)
            {
                if (c == '\r') continue;
                if (c == '\n') { KeyTap(0x0D); continue; }
                if (c == '\t') { KeyTap(0x09); continue; }
                INPUT[] pair = new INPUT[]
                {
                    KeyInput(0, (ushort)c, KEYEVENTF_UNICODE),
                    KeyInput(0, (ushort)c, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)
                };
                Presence.NoteSelfInput();
                SendInput(2, pair, InputSize);
            }
        }

        static bool IsExtended(ushort vk)
        {
            switch (vk)
            {
                case 0x21: case 0x22: case 0x23: case 0x24:
                case 0x25: case 0x26: case 0x27: case 0x28:
                case 0x2C: case 0x2D: case 0x2E:
                case 0x5B: case 0x5C: case 0x5D:
                case 0xA3: case 0xA5:
                    return true;
            }
            return false;
        }

        internal static void KeyDown(ushort vk)
        {
            Presence.NoteSelfInput();
            SendInput(1, new INPUT[] { KeyInput(vk, 0, IsExtended(vk) ? KEYEVENTF_EXTENDEDKEY : 0) }, InputSize);
        }

        internal static void KeyUp(ushort vk)
        {
            uint f = KEYEVENTF_KEYUP | (IsExtended(vk) ? KEYEVENTF_EXTENDEDKEY : 0);
            Presence.NoteSelfInput();
            SendInput(1, new INPUT[] { KeyInput(vk, 0, f) }, InputSize);
        }

        internal static void KeyTap(ushort vk) { KeyDown(vk); KeyUp(vk); }

        // Windows refuses SetForegroundWindow from a thread that does not own
        // the current input queue, so borrow the target's queue for the call.
        internal static bool ForceForeground(IntPtr hwnd)
        {
            if (!IsWindow(hwnd)) return false;
            if (IsIconic(hwnd)) ShowWindow(hwnd, 9); // SW_RESTORE
            IntPtr fg = GetForegroundWindow();
            if (fg == hwnd) return true;

            uint pid;
            uint targetThread = GetWindowThreadProcessId(hwnd, out pid);
            uint self = GetCurrentThreadId();
            uint fgThread = 0;
            if (fg != IntPtr.Zero) fgThread = GetWindowThreadProcessId(fg, out pid);

            bool a1 = false, a2 = false;
            try
            {
                if (targetThread != 0 && targetThread != self) a1 = AttachThreadInput(self, targetThread, true);
                if (fgThread != 0 && fgThread != self) a2 = AttachThreadInput(self, fgThread, true);
                SetForegroundWindow(hwnd);
            }
            finally
            {
                if (a1) AttachThreadInput(self, targetThread, false);
                if (a2) AttachThreadInput(self, fgThread, false);
            }
            return GetForegroundWindow() == hwnd;
        }

        internal static bool IsCloaked(IntPtr hwnd)
        {
            int cloaked = 0;
            int hr = DwmGetWindowAttribute(hwnd, 14 /* DWMWA_CLOAKED */, out cloaked, sizeof(int));
            return hr == 0 && cloaked != 0;
        }
    }

    // Typed failure. Every error the agent can hit carries a stable code so it
    // can branch on the cause instead of pattern-matching English.
    internal class AxonError : Exception
    {
        public string Code;
        public string Hint;
        public AxonError(string code, string message, string hint) : base(message)
        {
            Code = code;
            Hint = hint;
        }
        public AxonError(string code, string message) : this(code, message, null) { }
    }

    internal class Snapshot
    {
        public Dictionary<int, AutomationElement> Elements = new Dictionary<int, AutomationElement>();
        public IntPtr Hwnd;
        public string Title;
        public DateTime Taken;
    }

    // One index per element per window, for the life of the window. UI
    // Automation gives every element a RuntimeId that is unique while it
    // exists; keying the index on it means a control keeps its number from one
    // read to the next, so a second read can say only what changed, and an
    // index Claude saw once can be acted on without a fresh snapshot.
    internal class WalkIds
    {
        public Dictionary<string, int> Seen = new Dictionary<string, int>();
        public HashSet<int> Used = new HashSet<int>();
    }

    internal class StableTable
    {
        public Dictionary<string, int> ByRid = new Dictionary<string, int>();
        public Dictionary<int, AutomationElement> Latest = new Dictionary<int, AutomationElement>();
        public int Next = 0;
        public DateTime Seen;
    }

    internal static class Program
    {
        static Dictionary<string, Snapshot> _snapshots = new Dictionary<string, Snapshot>();
        static Dictionary<long, StableTable> _stable = new Dictionary<long, StableTable>();
        static int _snapSeq = 0;
        const int MaxSnapshots = 16;
        static string _dpiMode = "none";
        // True while an operation is in flight, so Escape can tell "stop this"
        // from "the user pressed Escape in their own app".
        static volatile bool _busy;
        static readonly int _selfPid = System.Diagnostics.Process.GetCurrentProcess().Id;
        static JavaScriptSerializer _js;

        static readonly string[] ShellClasses = new string[]
        {
            "Shell_TrayWnd", "Progman", "WorkerW", "Windows.UI.Core.CoreWindow",
            "Shell_SecondaryTrayWnd", "NotifyIconOverflowWindow",
            "Windows.Internal.Shell.TabProxyWindow", "ForegroundStaging",
            "MultitaskingViewFrame", "XamlExplorerHostIslandWindow",
            // The drop shadow Windows draws under a tooltip or menu: a top-level
            // window of its own, and on 2026-09-28 the "new window" a wait for a
            // browser's file picker reported instead of the picker.
            "SysShadow"
        };

        static int Main(string[] argv)
        {
            // Build-time warm-up: touch the expensive machinery once so the
            // antivirus scan and the JIT are paid for before Claude ever waits
            // on a call, then leave.
            bool warmup = false;
            foreach (string s in argv) if (s == "--warmup") warmup = true;
            // A one-shot helper run, never the long-lived host: which terminal
            // window shows the Claude Code session that started this server.
            for (int ai = 0; ai + 1 < argv.Length; ai++)
                if (argv[ai] == "--console-window") return ConsoleWindowOf(argv[ai + 1]);
            if (warmup)
            {
                try
                {
                    SetDpiAwareness();
                    AutomationElement root = AutomationElement.RootElement;
                    root.FindAll(TreeScope.Children, Condition.TrueCondition);
                    new JavaScriptSerializer().Serialize(new Dictionary<string, object>());
                }
                catch { }
                Console.Out.WriteLine("{\"event\":\"warm\"}");
                return 0;
            }

            SetDpiAwareness();
            if (Environment.GetEnvironmentVariable("CU_PRESENCE") != "off") Presence.Start();
            // Escape means "stop what you are doing to my machine". It only
            // means that while Computer Use is actually doing something -
            // otherwise every Escape the user presses in their own apps would
            // arm a stop that fails Claude's next action minutes later, and
            // withdraws every grant with it. Releasing any input hold is
            // unconditional, because that is never the wrong thing to do.
            // Both Ctrl keys pressed together: an appshot. The host only says
            // which window is in front; the server reads it the way it reads
            // anything and files it for the next prompt (see index.mjs).
            Presence.OnAppshot = delegate
            {
                try
                {
                    IntPtr fg = Native.GetForegroundWindow();
                    if (fg == IntPtr.Zero || Overlay.IsAnyOverlayWindow(fg)) return;
                    Dictionary<string, object> ev = new Dictionary<string, object>();
                    ev["event"] = "appshot";
                    ev["hwnd"] = Hwnd(fg);
                    WriteLine(ev);
                }
                catch { }
            };
            Presence.OnPanic = delegate
            {
                Native.EndExclusive();
                if (_busy || _taskActive || Overlay.ActiveWithin(3000)) Overlay.RequestStop();
            };
            Overlay.Configure(
                EnvInt("CU_SESSION_SLOT", 0),
                Environment.GetEnvironmentVariable("CU_SESSION_LABEL"),
                0);
            Overlay.Start(Environment.GetEnvironmentVariable("CU_OVERLAY") != "off");
            Configure(
                EnvInt("CU_IDLE_MS", 1200),
                EnvInt("CU_WAIT_MS", 6000),
                Environment.GetEnvironmentVariable("CU_MODE"));

            _js = new JavaScriptSerializer();
            _js.MaxJsonLength = 64 * 1024 * 1024;

            try
            {
                Console.OutputEncoding = new UTF8Encoding(false);
                Console.InputEncoding = new UTF8Encoding(false);
            }
            catch { /* redirected pipes can refuse an encoding change; harmless */ }

            Dictionary<string, object> ready = new Dictionary<string, object>();
            ready["event"] = "ready";
            ready["dpi_mode"] = _dpiMode;
            ready["pid"] = System.Diagnostics.Process.GetCurrentProcess().Id;
            ready["clr"] = Environment.Version.ToString();
            ready["presence"] = Presence.HooksOk;
            ready["overlay"] = Overlay.Enabled;
            // Which colour this session's cursor, marker and banner are drawn
            // in. One Claude is always Claude's own colour; a second is not.
            ready["accent"] = Overlay.AccentHex;
            // Indices are keyed on RuntimeId and survive across reads of a
            // window. The server only computes deltas when a host says so; a
            // host without this flag gets a full listing on every read.
            ready["stable"] = true;
            WriteLine(ready);

            while (true)
            {
                string line;
                try { line = Console.In.ReadLine(); }
                catch { break; }
                if (line == null) break;
                line = line.Trim();
                if (line.Length == 0) continue;

                object reqId = null;
                try
                {
                    Dictionary<string, object> req = (Dictionary<string, object>)_js.DeserializeObject(line);
                    reqId = Get(req, "id");
                    string op = Str(Get(req, "op"));
                    Dictionary<string, object> a = Get(req, "args") as Dictionary<string, object>;
                    if (a == null) a = new Dictionary<string, object>();

                    if (op == "shutdown")
                    {
                        Dictionary<string, object> bye = new Dictionary<string, object>();
                        bye["bye"] = true;
                        Native.EndExclusive();
                        Respond(reqId, bye, 0);
                        return 0;
                    }

                    System.Diagnostics.Stopwatch sw = System.Diagnostics.Stopwatch.StartNew();
                    object result;
                    _busy = IsActingOp(op);
                    // Which window the user had in front before this action,
                    // so a foreground the action takes can be handed back.
                    bool tracked = BorrowTracked(op, a);
                    IntPtr fgBefore = tracked ? Native.GetForegroundWindow() : IntPtr.Zero;
                    try { result = Dispatch(op, a); }
                    finally
                    {
                        _busy = false; sw.Stop();
                        if (tracked) { try { NoteBorrow(fgBefore, a); } catch { } }
                    }
                    Respond(reqId, result, sw.ElapsedMilliseconds);
                }
                catch (AxonError ax)
                {
                    RespondError(reqId, ax.Code, ax.Message, ax.Hint);
                }
                catch (Exception ex)
                {
                    RespondError(reqId, "host_error", ex.GetType().Name + ": " + ex.Message, null);
                }
            }
            return 0;
        }

        static void SetDpiAwareness()
        {
            // Per-monitor v2 first. Without real DPI awareness the host sees a
            // virtualised desktop and every coordinate lands offset on any
            // display scaled above 100%.
            try { if (Native.SetProcessDpiAwarenessContext(new IntPtr(-4))) { _dpiMode = "per-monitor-v2"; return; } }
            catch { }
            try { if (Native.SetProcessDpiAwareness(2) == 0) { _dpiMode = "per-monitor"; return; } }
            catch { }
            try { if (Native.SetProcessDPIAware()) { _dpiMode = "system"; return; } }
            catch { }
        }

        static object Dispatch(string op, Dictionary<string, object> a)
        {
            switch (op)
            {
                case "ping": return OpPing();
                case "presence": return OpPresence(a);
                case "session": return OpSession(a);
                case "list_apps": return OpListApps(a);
                case "snapshot": return OpSnapshot(a);
                case "click": return OpClick(a);
                case "type": return OpType(a);
                case "set_value": return OpSetValue(a);
                case "key": return OpKey(a);
                case "scroll": return OpScroll(a);
                case "focus": return OpFocus(a);
                case "close_window": return OpCloseWindow(a);
                case "wait_for": return OpWaitFor(a);
                case "screenshot": return OpScreenshot(a);
                case "clipboard": return OpClipboard(a);
                case "paste": return OpPaste(a);
                case "paste_files": return OpPasteFiles(a);
                case "open": return OpOpen(a);
                case "file_dialog": return OpFileDialog(a);
                case "describe": return OpDescribe(a);
                case "busy": return OpBusy(a);
                case "banner": return OpBanner(a);
                case "drag": return OpDrag(a);
                case "give_back": return OpGiveBack(a);
                default: throw new AxonError("unknown_op", "Unknown operation '" + op + "'.");
            }
        }

        // ---- protocol plumbing ------------------------------------------------

        static void WriteLine(object obj)
        {
            string json = _js.Serialize(obj);
            Console.Out.WriteLine(json);
            Console.Out.Flush();
        }

        static void Respond(object id, object result, long ms)
        {
            Dictionary<string, object> m = new Dictionary<string, object>();
            m["id"] = id;
            m["ok"] = true;
            m["ms"] = ms;
            m["result"] = result;
            WriteLine(m);
        }

        static void RespondError(object id, string code, string message, string hint)
        {
            try
            {
                Dictionary<string, object> err = new Dictionary<string, object>();
                err["code"] = code;
                err["message"] = message;
                if (hint != null) err["hint"] = hint;
                Dictionary<string, object> m = new Dictionary<string, object>();
                m["id"] = id;
                m["ok"] = false;
                m["error"] = err;
                WriteLine(m);
            }
            catch
            {
                // Reporting the failure must never become the failure. If even
                // this cannot be serialised, emit a minimal hand-built reply so
                // the caller gets an answer instead of hanging until timeout.
                try
                {
                    string sid = id == null ? "null" : _js.Serialize(id);
                    Console.Out.WriteLine("{\"id\":" + sid + ",\"ok\":false,\"error\":{\"code\":\"host_error\",\"message\":\"unserialisable error\"}}");
                    Console.Out.Flush();
                }
                catch { }
            }
        }

        static object Get(Dictionary<string, object> d, string k)
        {
            object v;
            if (d != null && d.TryGetValue(k, out v)) return v;
            return null;
        }

        static string Str(object o) { return o == null ? null : Convert.ToString(o, CultureInfo.InvariantCulture); }

        static int Int(object o, int fallback)
        {
            if (o == null) return fallback;
            try { return Convert.ToInt32(o, CultureInfo.InvariantCulture); }
            catch { return fallback; }
        }

        static long Long(object o, long fallback)
        {
            if (o == null) return fallback;
            try { return Convert.ToInt64(o, CultureInfo.InvariantCulture); }
            catch { return fallback; }
        }

        static bool Bool(object o, bool fallback)
        {
            if (o == null) return fallback;
            try { return Convert.ToBoolean(o); }
            catch { return fallback; }
        }

        // ---- element helpers --------------------------------------------------

        static int[] RectOf(AutomationElement el)
        {
            try
            {
                System.Windows.Rect r = el.Current.BoundingRectangle;
                if (r.IsEmpty || double.IsInfinity(r.X) || double.IsNaN(r.X)) return null;
                if (r.Width <= 0 || r.Height <= 0) return null;
                return new int[] { (int)r.X, (int)r.Y, (int)r.Width, (int)r.Height };
            }
            catch { return null; }
        }

        static List<string> PatternsOf(AutomationElement el)
        {
            List<string> names = new List<string>();
            try
            {
                AutomationPattern[] ps = el.GetSupportedPatterns();
                foreach (AutomationPattern p in ps)
                {
                    // ProgrammaticName looks like "InvokePatternIdentifiers.Pattern".
                    // The useful part is the prefix before the dot, minus its
                    // "PatternIdentifiers" suffix, which yields "Invoke".
                    string n = p.ProgrammaticName;
                    if (string.IsNullOrEmpty(n)) continue;
                    int dot = n.IndexOf('.');
                    if (dot >= 0) n = n.Substring(0, dot);
                    if (n.EndsWith("PatternIdentifiers"))
                        n = n.Substring(0, n.Length - "PatternIdentifiers".Length);
                    else if (n.EndsWith("Pattern"))
                        n = n.Substring(0, n.Length - "Pattern".Length);
                    if (n.Length > 0) names.Add(n);
                }
            }
            catch { }
            return names;
        }

        static bool Has(List<string> patterns, string name) { return patterns.Contains(name); }

        // The appshot idea: pull whatever text the control exposes, including
        // content scrolled outside the viewport, which pixels can never show.
        static string TextOf(AutomationElement el, List<string> patterns)
        {
            string outText = null;
            if (Has(patterns, "Value"))
            {
                try
                {
                    ValuePattern vp = el.GetCurrentPattern(ValuePattern.Pattern) as ValuePattern;
                    if (vp != null) outText = vp.Current.Value;
                }
                catch { }
            }
            if (string.IsNullOrEmpty(outText) && Has(patterns, "Text"))
            {
                try
                {
                    TextPattern tp = el.GetCurrentPattern(TextPattern.Pattern) as TextPattern;
                    if (tp != null) outText = tp.DocumentRange.GetText(4000);
                }
                catch { }
            }
            if (string.IsNullOrEmpty(outText)) return null;
            outText = outText.Replace("\r\n", "\n");
            if (outText.Length > 4000) outText = outText.Substring(0, 4000) + "...[truncated]";
            return outText;
        }

        static Dictionary<string, object> StateOf(AutomationElement el, List<string> patterns)
        {
            Dictionary<string, object> st = new Dictionary<string, object>();
            try
            {
                AutomationElement.AutomationElementInformation c = el.Current;
                if (!c.IsEnabled) st["disabled"] = true;
                if (c.IsOffscreen) st["offscreen"] = true;
                if (c.IsKeyboardFocusable) st["focusable"] = true;
                if (c.HasKeyboardFocus) st["focused"] = true;
            }
            catch { }
            if (Has(patterns, "Toggle"))
            {
                try
                {
                    TogglePattern tp = el.GetCurrentPattern(TogglePattern.Pattern) as TogglePattern;
                    if (tp != null) st["toggle"] = tp.Current.ToggleState.ToString();
                }
                catch { }
            }
            if (Has(patterns, "SelectionItem"))
            {
                try
                {
                    SelectionItemPattern sp = el.GetCurrentPattern(SelectionItemPattern.Pattern) as SelectionItemPattern;
                    if (sp != null) st["selected"] = sp.Current.IsSelected;
                }
                catch { }
            }
            if (Has(patterns, "ExpandCollapse"))
            {
                try
                {
                    ExpandCollapsePattern ep = el.GetCurrentPattern(ExpandCollapsePattern.Pattern) as ExpandCollapsePattern;
                    if (ep != null) st["expand"] = ep.Current.ExpandCollapseState.ToString();
                }
                catch { }
            }
            if (Has(patterns, "RangeValue"))
            {
                try
                {
                    RangeValuePattern rp = el.GetCurrentPattern(RangeValuePattern.Pattern) as RangeValuePattern;
                    if (rp != null)
                    {
                        st["value"] = rp.Current.Value;
                        st["min"] = rp.Current.Minimum;
                        st["max"] = rp.Current.Maximum;
                    }
                }
                catch { }
            }
            if (st.Count == 0) return null;
            return st;
        }

        static string RoleOf(AutomationElement el)
        {
            try
            {
                string n = el.Current.ControlType.ProgrammaticName;
                if (n != null && n.StartsWith("ControlType.")) n = n.Substring("ControlType.".Length);
                return n;
            }
            catch { return "Unknown"; }
        }

        static string NameOf(AutomationElement el)
        {
            try { return el.Current.Name; } catch { return null; }
        }

        static string AidOf(AutomationElement el)
        {
            try { return el.Current.AutomationId; } catch { return null; }
        }

        // ---- window discovery -------------------------------------------------

        static bool IsSelfWindow(AutomationElement el)
        {
            try
            {
                if (el.Current.ProcessId == _selfPid) return true;
                IntPtr h = new IntPtr(el.Current.NativeWindowHandle);
                // Another Claude session's banner and marker are Computer Use's
                // own chrome too. Listing them would offer Claude its own UI as
                // something to click.
                return Overlay.IsAnyOverlayWindow(h);
            }
            catch { return false; }
        }

        static bool IsRealWindow(AutomationElement el)
        {
            try
            {
                AutomationElement.AutomationElementInformation c = el.Current;
                IntPtr h = new IntPtr(c.NativeWindowHandle);
                if (h == IntPtr.Zero) return false;
                if (!Native.IsWindow(h)) return false;
                if (!Native.IsWindowVisible(h)) return false;
                if (Native.IsCloaked(h)) return false;
                if (Overlay.IsAnyOverlayWindow(h)) return false;
                foreach (string s in ShellClasses) if (s == c.ClassName) return false;
                int[] r = RectOf(el);
                if (r == null) return false;
                // Hidden helper windows park themselves far off the virtual screen.
                if (r[0] < -30000 || r[1] < -30000) return false;
                if (r[2] < 40 || r[3] < 40) return false;
                return true;
            }
            catch { return false; }
        }

        static object OpListApps(Dictionary<string, object> a)
        {
            bool includeHidden = Bool(Get(a, "include_hidden"), false);
            AutomationElement root = AutomationElement.RootElement;
            AutomationElementCollection wins = root.FindAll(TreeScope.Children, Condition.TrueCondition);
            List<object> list = new List<object>();
            Dictionary<long, bool> seen = new Dictionary<long, bool>();
            IntPtr fg = Native.GetForegroundWindow();

            foreach (AutomationElement w in wins)
            {
                // Computer Use's own windows are never user windows, so they are excluded
                // unconditionally - include_hidden reveals the user's minimized
                // windows, not Computer Use's marker.
                if (IsSelfWindow(w)) continue;
                if (!includeHidden && !IsRealWindow(w)) continue;
                try
                {
                    AutomationElement.AutomationElementInformation c = w.Current;
                    IntPtr h = new IntPtr(c.NativeWindowHandle);
                    Dictionary<string, object> e = new Dictionary<string, object>();
                    e["hwnd"] = (long)c.NativeWindowHandle;
                    e["title"] = c.Name;
                    e["class"] = c.ClassName;
                    e["pid"] = c.ProcessId;
                    string pname, ppath;
                    ProcessInfo(c.ProcessId, out pname, out ppath);
                    e["process"] = pname;
                    e["path"] = ppath;
                    e["rect"] = RectOf(w);
                    e["minimized"] = Native.IsIconic(h);
                    // A window on another virtual desktop is cloaked, and so are
                    // some suspended apps - only ask the desktop manager about
                    // the cloaked ones, and only then is the answer interesting.
                    // It matters because a pattern click still works on such a
                    // window while a real click would land on whatever occupies
                    // those coordinates on the desktop the user is looking at.
                    if (Native.IsCloaked(h) && Overlay.OnCurrentDesktop(h) == 0) e["other_desktop"] = true;
                    e["foreground"] = (h == fg);
                    seen[Hwnd(h)] = true;
                    list.Add(e);
                }
                catch { }
            }

            // Windows the desktop walk cannot see. UIA enumerates the desktop the
            // user is looking at, so everything on another virtual desktop is
            // missing from it entirely - not hidden, absent. Those windows are
            // still perfectly readable and drivable through their patterns, so
            // when the caller has asked to see everything, they are found the
            // way the operating system finds them and added.
            if (includeHidden)
            {
                try
                {
                    Native.EnumWindows(delegate(IntPtr h, IntPtr lp)
                    {
                        try
                        {
                            long key = Hwnd(h);
                            if (seen.ContainsKey(key)) return true;
                            if (!Native.IsWindow(h)) return true;
                            // Cloaking is what marks these: on another desktop, or
                            // a suspended app. An ordinary hidden window is not
                            // interesting and there are hundreds of them.
                            if (!Native.IsCloaked(h)) return true;
                            if (Overlay.IsAnyOverlayWindow(h)) return true;
                            // Tool windows and untitled shells are furniture.
                            if ((Native.GetWindowLongW(h, -20) & 0x00000080) != 0) return true;   // WS_EX_TOOLWINDOW

                            System.Text.StringBuilder sb = new System.Text.StringBuilder(512);
                            Native.GetWindowTextW(h, sb, sb.Capacity);
                            string title = sb.ToString();
                            if (title.Length == 0) return true;

                            Native.RECT rr;
                            if (!Native.GetWindowRect(h, out rr)) return true;
                            int rw = rr.Right - rr.Left, rh = rr.Bottom - rr.Top;
                            if (rw < 40 || rh < 40) return true;

                            uint wpid;
                            Native.GetWindowThreadProcessId(h, out wpid);
                            if ((int)wpid == _selfPid) return true;

                            System.Text.StringBuilder cb2 = new System.Text.StringBuilder(128);
                            Native.GetClassName(h, cb2, cb2.Capacity);
                            string cls = cb2.ToString();
                            foreach (string sh in ShellClasses) if (sh == cls) return true;

                            string pname, ppath;
                            ProcessInfo((int)wpid, out pname, out ppath);

                            Dictionary<string, object> e2 = new Dictionary<string, object>();
                            e2["hwnd"] = key;
                            e2["title"] = title;
                            e2["class"] = cls;
                            e2["pid"] = (int)wpid;
                            e2["process"] = pname;
                            e2["path"] = ppath;
                            e2["rect"] = new int[] { rr.Left, rr.Top, rw, rh };
                            e2["minimized"] = Native.IsIconic(h);
                            e2["foreground"] = false;
                            if (Overlay.OnCurrentDesktop(h) == 0) e2["other_desktop"] = true;
                            seen[key] = true;
                            list.Add(e2);
                        }
                        catch { }
                        return true;
                    }, IntPtr.Zero);
                }
                catch { }
            }

            // Menus, dropdown lists and popups, listed with a stand-in title and
            // the window that owns them, so a context menu that a click just
            // opened shows up as a new window and can be read and clicked by index.
            try
            {
                Native.EnumWindows(delegate(IntPtr h, IntPtr lp)
                {
                    try
                    {
                        long key = Hwnd(h);
                        if (seen.ContainsKey(key)) return true;
                        if (!Native.IsWindowVisible(h) || Native.IsIconic(h)) return true;
                        if (Overlay.IsAnyOverlayWindow(h)) return true;
                        System.Text.StringBuilder cb = new System.Text.StringBuilder(128);
                        Native.GetClassName(h, cb, cb.Capacity);
                        string cls = cb.ToString();
                        if (!IsPopupClass(cls)) return true;
                        Native.RECT rr;
                        if (!Native.GetWindowRect(h, out rr)) return true;
                        int rw = rr.Right - rr.Left, rh = rr.Bottom - rr.Top;
                        // Tooltips share a class with browser menus; height tells them apart.
                        if (rw < 40 || rh < (cls == "Chrome_WidgetWin_2" ? 60 : 24)) return true;
                        uint wpid;
                        Native.GetWindowThreadProcessId(h, out wpid);
                        if ((int)wpid == _selfPid) return true;
                        string pname, ppath;
                        ProcessInfo((int)wpid, out pname, out ppath);
                        System.Text.StringBuilder sb = new System.Text.StringBuilder(256);
                        Native.GetWindowTextW(h, sb, sb.Capacity);
                        string title = sb.ToString();
                        if (title.Length == 0)
                            title = cls == "#32768" ? "[menu]" : (cls == "ComboLBox" ? "[dropdown list]" : "[popup]");

                        Dictionary<string, object> e2 = new Dictionary<string, object>();
                        e2["hwnd"] = key;
                        e2["title"] = title;
                        e2["class"] = cls;
                        e2["pid"] = (int)wpid;
                        e2["process"] = pname;
                        e2["path"] = ppath;
                        e2["rect"] = new int[] { rr.Left, rr.Top, rw, rh };
                        e2["minimized"] = false;
                        e2["foreground"] = false;
                        e2["popup"] = true;
                        long owner = Hwnd(Native.GetWindowRel(h, 4 /* GW_OWNER */));
                        if (owner != 0) e2["owner"] = owner;
                        seen[key] = true;
                        list.Add(e2);
                    }
                    catch { }
                    return true;
                }, IntPtr.Zero);
            }
            catch { }

            // Dialogs the desktop walk leaves out: a browser's Open dialog can run
            // in another process than the window that owns it, and then it is
            // missing from the walk above (measured with Opera on 2026-09-28) -
            // so a wait for the picker found only a drop shadow. Visible, titled,
            // owned dialog-class windows are added from the system's own list.
            try
            {
                IntPtr fgNow = Native.GetForegroundWindow();
                Native.EnumWindows(delegate(IntPtr h, IntPtr lp)
                {
                    try
                    {
                        long key = Hwnd(h);
                        if (seen.ContainsKey(key)) return true;
                        if (!Native.IsWindowVisible(h) || Native.IsIconic(h) || Native.IsCloaked(h)) return true;
                        System.Text.StringBuilder cb = new System.Text.StringBuilder(64);
                        Native.GetClassName(h, cb, cb.Capacity);
                        if (cb.ToString() != "#32770") return true;
                        IntPtr own = Native.GetWindowRel(h, 4 /* GW_OWNER */);
                        if (own == IntPtr.Zero) return true;
                        System.Text.StringBuilder sb = new System.Text.StringBuilder(256);
                        Native.GetWindowTextW(h, sb, sb.Capacity);
                        if (sb.Length == 0) return true;
                        Native.RECT rr;
                        if (!Native.GetWindowRect(h, out rr)) return true;
                        int rw = rr.Right - rr.Left, rh = rr.Bottom - rr.Top;
                        if (rw < 40 || rh < 40) return true;
                        uint wpid;
                        Native.GetWindowThreadProcessId(h, out wpid);
                        if ((int)wpid == _selfPid) return true;
                        string pname, ppath;
                        ProcessInfo((int)wpid, out pname, out ppath);
                        Dictionary<string, object> e2 = new Dictionary<string, object>();
                        e2["hwnd"] = key;
                        e2["title"] = sb.ToString();
                        e2["class"] = "#32770";
                        e2["pid"] = (int)wpid;
                        e2["process"] = pname;
                        e2["path"] = ppath;
                        e2["rect"] = new int[] { rr.Left, rr.Top, rw, rh };
                        e2["minimized"] = false;
                        e2["foreground"] = h == fgNow;
                        e2["owner"] = Hwnd(own);
                        seen[key] = true;
                        list.Add(e2);
                    }
                    catch { }
                    return true;
                }, IntPtr.Zero);
            }
            catch { }

            Dictionary<string, object> res = new Dictionary<string, object>();
            res["windows"] = list;
            res["dpi_mode"] = _dpiMode;
            return res;
        }

        // Process.MainModule is a slow call - tens of milliseconds each - and
        // list_apps used to make one per window every time it ran. Names and
        // paths do not change for the life of a pid, so they are looked up once.
        static Dictionary<int, string[]> _procCache = new Dictionary<int, string[]>();

        static void ProcessInfo(int pid, out string name, out string path)
        {
            string[] hit;
            if (_procCache.TryGetValue(pid, out hit)) { name = hit[0]; path = hit[1]; return; }
            name = null; path = null;
            try
            {
                System.Diagnostics.Process p = System.Diagnostics.Process.GetProcessById(pid);
                name = p.ProcessName;
                try { path = p.MainModule.FileName; } catch { }
            }
            catch { }
            // Bounded, because pids are recycled and a long session sees many.
            if (_procCache.Count > 256) _procCache.Clear();
            _procCache[pid] = new string[] { name, path };
        }

        static AutomationElement ResolveWindow(Dictionary<string, object> a)
        {
            AutomationElement root = AutomationElement.RootElement;
            object hwndArg = Get(a, "hwnd");
            if (hwndArg != null)
            {
                long want = Long(hwndArg, 0);
                AutomationElementCollection wins = root.FindAll(TreeScope.Children, Condition.TrueCondition);
                foreach (AutomationElement w in wins)
                {
                    try { if ((long)w.Current.NativeWindowHandle == want) return w; }
                    catch { }
                }
                // The desktop walk does not include windows on other virtual
                // desktops - switch desktops and a window Claude was working on
                // simply stops existing as far as that scan is concerned. A
                // handle is an explicit request for one particular window, and
                // it resolves whether or not the user is looking at it.
                if (want != 0)
                {
                    try
                    {
                        AutomationElement direct = AutomationElement.FromHandle(new IntPtr(want));
                        if (direct != null) return direct;
                    }
                    catch { }
                }
                return null;
            }
            string title = Str(Get(a, "title"));
            if (!string.IsNullOrEmpty(title))
            {
                AutomationElementCollection wins = root.FindAll(TreeScope.Children, Condition.TrueCondition);
                AutomationElement partial = null;
                foreach (AutomationElement w in wins)
                {
                    if (!IsRealWindow(w)) continue;
                    try
                    {
                        string n = w.Current.Name;
                        if (n == null) continue;
                        if (n == title) return w;
                        if (partial == null && n.ToLowerInvariant().Contains(title.ToLowerInvariant())) partial = w;
                    }
                    catch { }
                }
                return partial;
            }
            return null;
        }

        static AutomationElement RequireWindow(Dictionary<string, object> a)
        {
            AutomationElement w = ResolveWindow(a);
            if (w == null)
                throw new AxonError("window_not_found", "No window matched hwnd/title.",
                    "Call list_apps and pass an hwnd from its result.");
            return w;
        }

        // ---- snapshot ---------------------------------------------------------

        class Frame
        {
            public AutomationElement El;
            public int Depth;
            public Frame(AutomationElement el, int depth) { El = el; Depth = depth; }
        }

        static readonly string[] InteractivePatterns = new string[]
        { "Invoke", "Toggle", "Value", "SelectionItem", "ExpandCollapse", "Scroll", "RangeValue" };

        // Chromium browsers (Chrome, Edge, Opera, Brave, Vivaldi) do not expose
        // their web page to the accessibility tree until an assistive-technology
        // client asks for it - a memory optimisation. Without this, a snapshot of
        // a browser sees only the toolbar and tabs, never the page. Sending the
        // render widget a WM_GETOBJECT for the client accessible object is the
        // signal Chromium waits for: it turns the web tree on. We then wait
        // briefly for it to build. This makes reading a web page as seamless as
        // reading any native window.
        const uint WM_GETOBJECT = 0x003D;
        static readonly IntPtr OBJID_CLIENT = new IntPtr(unchecked((int)0xFFFFFFFC));
        const int UiaRootObjectId = -25;
        const uint SMTO_ABORTIFHUNG = 0x0002;
        // The screen-reader honeypot, and the half of the handshake this was
        // missing. Chromium's own design note is explicit: "Chrome calls
        // NotifyWinEvent with EVENT_SYSTEM_ALERT and the custom object id of 1.
        // If it subsequently receives a WM_GETOBJECT call for that custom object
        // id, it assumes that assistive technology is running."
        //
        // Asking for OBJID_CLIENT or the UIA root alone does NOT trip it. Worse,
        // current Chromium no longer trusts the honeypot on its own either -
        // ax_platform.cc says outright that it "has been abused", and now waits
        // for a NAME property to be read as well before it will build the web
        // tree. Both halves are needed, in either order:
        //
        //   OnScreenReaderHoneyPotQueried()  <- this message
        //   OnMinimalPropertiesUsed(name)    <- the snapshot walk, which reads Name
        //
        // So this poke is what makes the walk that follows count for something.
        // Reading BoundingRectangle, IsEnabled, RuntimeId or ProcessId never
        // will: they are on Chromium's explicit no-escalation list, because
        // ordinary non-screen-reader UIA clients touch them constantly.
        static readonly IntPtr ScreenReaderHoneyPotId = new IntPtr(1);

        static bool IsChromiumWindow(AutomationElement win)
        {
            try
            {
                string cls = win.Current.ClassName ?? "";
                if (cls.StartsWith("Chrome_WidgetWin")) return true;   // all Chromium browsers
                string proc = "";
                try { proc = System.Diagnostics.Process.GetProcessById(win.Current.ProcessId).ProcessName.ToLowerInvariant(); }
                catch { }
                foreach (string b in new string[] { "chrome", "msedge", "opera", "brave", "vivaldi", "chromium" })
                    if (proc == b || proc.StartsWith(b)) return true;
            }
            catch { }
            return false;
        }

        static void EnableWebAccessibility(IntPtr topHwnd)
        {
            if (topHwnd == IntPtr.Zero) return;
            System.Collections.Generic.List<IntPtr> widgets = new System.Collections.Generic.List<IntPtr>();
            try
            {
                Native.EnumChildWindows(topHwnd, delegate(IntPtr h, IntPtr lp)
                {
                    System.Text.StringBuilder sb = new System.Text.StringBuilder(128);
                    Native.GetClassName(h, sb, sb.Capacity);
                    string c = sb.ToString();
                    // The window that hosts the page's accessibility tree.
                    //
                    // Chrome_RenderWidgetHostHWND is the LEGACY render-widget
                    // window, and modern Chromium may not create it at all now
                    // that native UIA is on by default - which would leave this
                    // walk with nothing to poke. So any Chrome_* child counts,
                    // and the top window is added below as a further fallback.
                    if (c.StartsWith("Chrome_")) widgets.Add(h);
                    return true;
                }, IntPtr.Zero);
            }
            catch { }
            // Poke the top window too, in case the render widget is not a direct
            // child or has not been created yet.
            widgets.Add(topHwnd);
            foreach (IntPtr w in widgets)
            {
                try
                {
                    IntPtr res;
                    // Honeypot first: it is the one Chromium actually watches
                    // for, and the other two do not substitute for it.
                    Native.SendMessageTimeout(w, WM_GETOBJECT, IntPtr.Zero, ScreenReaderHoneyPotId, SMTO_ABORTIFHUNG, 300, out res);
                    Native.SendMessageTimeout(w, WM_GETOBJECT, IntPtr.Zero, OBJID_CLIENT, SMTO_ABORTIFHUNG, 300, out res);
                    Native.SendMessageTimeout(w, WM_GETOBJECT, IntPtr.Zero, new IntPtr(UiaRootObjectId), SMTO_ABORTIFHUNG, 300, out res);
                }
                catch { }
            }
        }

        // ---- snapshot: one batched fetch, not one call per property ---------
        //
        // Every AutomationElement property read is a cross-process call, and the
        // old walk made about thirty of them per node - a 200-node browser
        // window took two to five seconds. A CacheRequest with TreeScope.Subtree
        // asks the provider for every property of every element in one call;
        // the provider gathers them in-process and marshals the lot back at
        // once. Measured on the same Opera window: 724ms -> 47ms for the walk
        // alone, and the pattern-state and text reads that used to follow it are
        // now free. Elements come back in Full mode, so they are still live
        // references that can be invoked and typed into later.

        static CacheRequest _snapReq;

        // A terminal screen as text: every row is padded to the width of the
        // window, and most of the screen can be blank. Rows lose their trailing
        // spaces, runs of blank rows become one, and blank rows at either end go.
        static string ScreenLines(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return null;
            string[] rows = raw.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
            StringBuilder sb = new StringBuilder();
            bool blank = false;
            foreach (string row in rows)
            {
                string r = row.TrimEnd();
                if (r.Length == 0) { blank = sb.Length > 0; continue; }
                if (blank) sb.Append('\n');
                if (sb.Length > 0) sb.Append('\n');
                sb.Append(r);
                blank = false;
            }
            string t = CleanText(sb.ToString());
            return t;
        }

        static readonly string[] Landmarks = new string[]
        { "main", "navigation", "complementary", "banner", "contentinfo", "content information", "region", "search", "form" };

        static CacheRequest SnapRequest()
        {
            if (_snapReq != null) return _snapReq;
            CacheRequest cr = new CacheRequest();
            cr.TreeScope = TreeScope.Subtree;
            cr.AutomationElementMode = AutomationElementMode.Full;
            cr.TreeFilter = Automation.ControlViewCondition;
            cr.Add(AutomationElement.ControlTypeProperty);
            cr.Add(AutomationElement.NameProperty);
            cr.Add(AutomationElement.AutomationIdProperty);
            cr.Add(AutomationElement.BoundingRectangleProperty);
            cr.Add(AutomationElement.IsEnabledProperty);
            cr.Add(AutomationElement.IsOffscreenProperty);
            cr.Add(AutomationElement.HasKeyboardFocusProperty);
            cr.Add(AutomationElement.IsKeyboardFocusableProperty);
            cr.Add(AutomationElement.NativeWindowHandleProperty);
            cr.Add(AutomationElement.RuntimeIdProperty);
            cr.Add(AutomationElement.IsInvokePatternAvailableProperty);
            cr.Add(AutomationElement.IsTogglePatternAvailableProperty);
            cr.Add(AutomationElement.IsValuePatternAvailableProperty);
            cr.Add(AutomationElement.IsSelectionItemPatternAvailableProperty);
            cr.Add(AutomationElement.IsExpandCollapsePatternAvailableProperty);
            cr.Add(AutomationElement.IsScrollPatternAvailableProperty);
            cr.Add(AutomationElement.IsRangeValuePatternAvailableProperty);
            cr.Add(AutomationElement.IsTextPatternAvailableProperty);
            cr.Add(TogglePattern.ToggleStateProperty);
            cr.Add(ValuePattern.ValueProperty);
            cr.Add(SelectionItemPattern.IsSelectedProperty);
            cr.Add(ExpandCollapsePattern.ExpandCollapseStateProperty);
            cr.Add(RangeValuePattern.ValueProperty);
            cr.Add(RangeValuePattern.MinimumProperty);
            cr.Add(RangeValuePattern.MaximumProperty);
            // Chromium names a page landmark (main, navigation, ...) here, and
            // an unnamed landmark would otherwise be an invisible wrapper.
            cr.Add(AutomationElement.LocalizedControlTypeProperty);
            // Windows Terminal's text area is a Text element of class TermControl.
            cr.Add(AutomationElement.ClassNameProperty);
            _snapReq = cr;
            return cr;
        }

        // Text that is not text: the object-replacement character a browser
        // puts in an empty input, zero-width joiners, byte-order marks. Reported
        // as a name they look like content; stripped they are nothing.
        static string CleanText(string s)
        {
            if (s == null) return null;
            StringBuilder sb = null;
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                bool junk = c == (char)0xFFFC || c == (char)0xFEFF || (c >= (char)0x200B && c <= (char)0x200F) || c == (char)0x2060;
                if (junk)
                {
                    if (sb == null) { sb = new StringBuilder(s.Length); sb.Append(s, 0, i); }
                    continue;
                }
                if (sb != null) sb.Append(c);
            }
            string t = (sb != null ? sb.ToString() : s).Trim();
            return t.Length == 0 ? null : t;
        }

        static bool CachedBool(AutomationElement el, AutomationProperty p)
        {
            try
            {
                object o = el.GetCachedPropertyValue(p, true);
                if (o == null || o == AutomationElement.NotSupported) return false;
                return Convert.ToBoolean(o);
            }
            catch { return false; }
        }

        static object CachedProp(AutomationElement el, AutomationProperty p)
        {
            try
            {
                object o = el.GetCachedPropertyValue(p, true);
                if (o == AutomationElement.NotSupported) return null;
                return o;
            }
            catch { return null; }
        }

        static int[] CachedRect(AutomationElement el)
        {
            try
            {
                object o = CachedProp(el, AutomationElement.BoundingRectangleProperty);
                if (o == null || !(o is System.Windows.Rect)) return null;
                System.Windows.Rect r = (System.Windows.Rect)o;
                if (r.IsEmpty || double.IsInfinity(r.X) || double.IsNaN(r.X)) return null;
                if (r.Width <= 0 || r.Height <= 0) return null;
                return new int[] { (int)r.X, (int)r.Y, (int)r.Width, (int)r.Height };
            }
            catch { return null; }
        }

        static readonly AutomationProperty[] PatternAvail = new AutomationProperty[]
        {
            AutomationElement.IsInvokePatternAvailableProperty,
            AutomationElement.IsTogglePatternAvailableProperty,
            AutomationElement.IsValuePatternAvailableProperty,
            AutomationElement.IsSelectionItemPatternAvailableProperty,
            AutomationElement.IsExpandCollapsePatternAvailableProperty,
            AutomationElement.IsScrollPatternAvailableProperty,
            AutomationElement.IsRangeValuePatternAvailableProperty,
            AutomationElement.IsTextPatternAvailableProperty,
        };
        static readonly string[] PatternNames = new string[]
        { "Invoke", "Toggle", "Value", "SelectionItem", "ExpandCollapse", "Scroll", "RangeValue", "Text" };

        static List<string> CachedPatterns(AutomationElement el)
        {
            List<string> names = new List<string>();
            for (int i = 0; i < PatternAvail.Length; i++)
                if (CachedBool(el, PatternAvail[i])) names.Add(PatternNames[i]);
            return names;
        }

        static string CachedRole(AutomationElement el)
        {
            try
            {
                object o = CachedProp(el, AutomationElement.ControlTypeProperty);
                ControlType ct = o as ControlType;
                if (ct == null) return "Unknown";
                string n = ct.ProgrammaticName;
                if (n != null && n.StartsWith("ControlType.")) n = n.Substring("ControlType.".Length);
                return n;
            }
            catch { return "Unknown"; }
        }

        // The whole subtree in one call, on a worker so a provider that never
        // answers cannot wedge the host. Null when it did not arrive in time.
        static AutomationElement FetchSubtree(AutomationElement win, int budgetMs)
        {
            AutomationElement got = null;
            Exception failure = null;
            using (System.Threading.ManualResetEventSlim done = new System.Threading.ManualResetEventSlim(false))
            {
                System.Threading.ThreadPool.QueueUserWorkItem(delegate
                {
                    try { got = win.GetUpdatedCache(SnapRequest()); }
                    catch (Exception ex) { failure = ex; }
                    finally { try { done.Set(); } catch { } }
                });
                if (!done.Wait(budgetMs)) return null;
            }
            if (failure != null) return null;
            return got;
        }

        static bool HasDocument(AutomationElement cached, int limit)
        {
            Stack<AutomationElement> st = new Stack<AutomationElement>();
            st.Push(cached);
            int n = 0;
            while (st.Count > 0 && n < limit)
            {
                AutomationElement el = st.Pop();
                n++;
                if (CachedRole(el) == "Document") return true;
                AutomationElementCollection kids = null;
                try { kids = el.CachedChildren; } catch { }
                if (kids == null) continue;
                foreach (AutomationElement k in kids) st.Push(k);
            }
            return false;
        }

        static object OpSnapshot(Dictionary<string, object> a)
        {
            AutomationElement win = RequireWindow(a);
            bool web = IsChromiumWindow(win);

            // A web page's accessibility tree is much deeper and wider than a
            // native window's - the form fields on a page sit 20-30 levels down.
            // So a browser gets a deeper, roomier default; native windows keep
            // the tight one. An explicit max_depth / max_nodes always wins.
            bool hasDepth = Get(a, "max_depth") != null;
            bool hasNodes = Get(a, "max_nodes") != null;
            int maxNodes = hasNodes ? Int(Get(a, "max_nodes"), 400) : (web ? 1500 : 400);
            int maxDepth = hasDepth ? Int(Get(a, "max_depth"), 14) : (web ? 45 : 14);
            bool interactiveOnly = Bool(Get(a, "interactive_only"), false);
            // A poll (wait_for change / text) reads the tree without keeping
            // it, so it neither bumps the snapshot sequence nor evicts a
            // snapshot Claude is still acting on.
            bool register = Bool(Get(a, "register"), true);
            long hkey = 0;
            try { hkey = (long)win.Current.NativeWindowHandle; } catch { }
            StableTable table = StableFor(hkey);
            WalkIds usedIdx = new WalkIds();

            System.Diagnostics.Stopwatch walkClock = System.Diagnostics.Stopwatch.StartNew();
            int walkBudgetMs = EnvInt("CU_SNAPSHOT_MS", 8000);

            if (web)
            {
                try
                {
                    // Ask the browser to expose its page to accessibility (it
                    // keeps it off until an assistive-tech client asks).
                    IntPtr h = new IntPtr(win.Current.NativeWindowHandle);
                    EnableWebAccessibility(h);
                }
                catch { }
            }

            // A window on another virtual desktop is not being drawn anywhere, so
            // every element in it reports an empty rectangle. Dropping rect-less
            // elements is right for a window on screen - they are the invisible
            // scaffolding - and completely wrong here, where it would throw away
            // the entire contents of a window that reads and drives perfectly
            // well through its patterns.
            bool offDesktop = false;
            try
            {
                IntPtr wh = new IntPtr(win.Current.NativeWindowHandle);
                offDesktop = Overlay.OnCurrentDesktop(wh) == 0;
            }
            catch { }

            // Fetch. A browser that has only just been asked to build its page
            // tree answers with the toolbar alone for a few hundred
            // milliseconds; a read with no Document in it is re-taken until one
            // appears or a second and a half has gone, so the first read of a
            // page is as complete as the second.
            AutomationElement cached = null;
            int webWaitMs = 0;
            for (int attempt = 0; attempt < 12; attempt++)
            {
                int remaining = walkBudgetMs - (int)walkClock.ElapsedMilliseconds;
                // A batched fetch of an ordinary window takes well under a
                // quarter of a second, so even a caller with a tiny budget is
                // given that much: a whole tree in 120ms beats a partial one
                // walked slowly.
                if (attempt > 0 && remaining < 200) break;
                cached = FetchSubtree(win, Math.Max(remaining, 250));
                if (cached == null) break;
                if (!web) break;
                if (HasDocument(cached, 4000)) break;
                if (walkClock.ElapsedMilliseconds > 1500) break;
                System.Threading.Thread.Sleep(120);
                webWaitMs += 120;
            }

            Dictionary<int, AutomationElement> elements = new Dictionary<int, AutomationElement>();
            List<object> nodes = new List<object>();
            bool truncated = false;
            bool ranOutOfTime = false;
            bool cachedPath = cached != null;
            int liveTextReads = 0;

            if (cachedPath)
            {
                // Everything below is in-memory: no cross-process calls except
                // the bounded TextPattern reads for documents and editors.
                Stack<Frame> stack = new Stack<Frame>();
                stack.Push(new Frame(cached, 0));
                while (stack.Count > 0)
                {
                    if (nodes.Count >= maxNodes) { truncated = true; break; }
                    // The wall clock covers the whole read, fetch included. The
                    // root always goes in, so a tight budget still hands back a
                    // tree rather than nothing.
                    if (nodes.Count > 0 && walkClock.ElapsedMilliseconds > walkBudgetMs)
                    {
                        truncated = true;
                        ranOutOfTime = true;
                        break;
                    }
                    Frame f = stack.Pop();
                    AutomationElement el = f.El;

                    int[] rect = CachedRect(el);
                    List<string> patterns = CachedPatterns(el);
                    bool interactive = false;
                    foreach (string ip in InteractivePatterns) { if (patterns.Contains(ip)) { interactive = true; break; } }

                    bool include = true;
                    if (interactiveOnly && f.Depth > 0 && !interactive) include = false;
                    if (rect == null && f.Depth > 0 && !offDesktop) include = false;

                    if (include)
                    {
                        Dictionary<string, object> node = new Dictionary<string, object>();
                        string role = CachedRole(el);
                        int idx = StableIndex(table, RidOf(el, true), el, usedIdx);
                        node["i"] = idx;
                        node["role"] = role;
                        node["depth"] = f.Depth;
                        string nm = CleanText(CachedProp(el, AutomationElement.NameProperty) as string);
                        if (nm != null) node["name"] = nm;
                        string aid = CachedProp(el, AutomationElement.AutomationIdProperty) as string;
                        if (!string.IsNullOrEmpty(aid)) node["aid"] = aid;
                        if (rect != null) node["rect"] = rect;
                        if (patterns.Count > 0) node["patterns"] = patterns;
                        // A page landmark, so a sidebar or the main content can be
                        // read alone (index) or left out of a read (exclude).
                        if (web && role == "Group")
                        {
                            string lct = CachedProp(el, AutomationElement.LocalizedControlTypeProperty) as string;
                            if (lct != null && Array.IndexOf(Landmarks, lct.ToLowerInvariant()) >= 0) node["landmark"] = lct.ToLowerInvariant();
                        }

                        // Text: the value pattern is cached and free. The text
                        // pattern is a live call, so it is spent only where it
                        // can say something the name does not - a document or
                        // an editor - and only a bounded number of times.
                        string txt = null;
                        if (patterns.Contains("Value")) txt = CleanText(CachedProp(el, ValuePattern.ValueProperty) as string);
                        // Text that was not read is not the same as no text. A
                        // read that skips it (out of budget) or gives up on it
                        // (the app was slow) says so, and the server does not
                        // count its absence as the document having changed:
                        // on a loaded machine the Notes box of the test target
                        // flapped between "text" and "no text" from one read to
                        // the next, and wait_for change reported a still
                        // window as changed.
                        bool textUnread = false;
                        if (txt == null && patterns.Contains("Text") && (role == "Document" || role == "Edit"))
                        {
                            if (liveTextReads < 24 && walkClock.ElapsedMilliseconds < walkBudgetMs / 2)
                            {
                                liveTextReads++;
                                // A live call into the app, so it runs with a deadline:
                                // one wedged editor must not hold the whole read.
                                string got = null;
                                AutomationElement tel = el;
                                bool answered = true;
                                try
                                {
                                    answered = RunPattern(delegate
                                    {
                                        TextPattern tp = tel.GetCurrentPattern(TextPattern.Pattern) as TextPattern;
                                        if (tp != null) got = tp.DocumentRange.GetText(4000);
                                    }, 1500);
                                }
                                catch { }
                                if (answered) txt = CleanText(got);
                                else textUnread = true;
                            }
                            else textUnread = true;
                        }
                        // A terminal's text area: what is on its screen. Its whole
                        // document is the scrollback from the top, whose first
                        // 4000 characters are the oldest output; the screen is
                        // what the session is showing now - a prompt, a reply,
                        // an offer to accept. Without this a terminal read as its
                        // tab title and nothing else.
                        bool screenText = false;
                        if (txt == null && !textUnread && role == "Text" && patterns.Contains("Text")
                            && (CachedProp(el, AutomationElement.ClassNameProperty) as string) == "TermControl")
                        {
                            if (liveTextReads < 24 && walkClock.ElapsedMilliseconds < walkBudgetMs / 2)
                            {
                                liveTextReads++;
                                string got = null;
                                AutomationElement tel = el;
                                bool answered = true;
                                try
                                {
                                    answered = RunPattern(delegate
                                    {
                                        TextPattern tp = tel.GetCurrentPattern(TextPattern.Pattern) as TextPattern;
                                        if (tp == null) return;
                                        StringBuilder sb = new StringBuilder();
                                        foreach (System.Windows.Automation.Text.TextPatternRange r in tp.GetVisibleRanges())
                                        {
                                            sb.Append(r.GetText(20000));
                                            if (sb.Length >= 20000) break;
                                        }
                                        got = sb.ToString();
                                    }, 1500);
                                }
                                catch { }
                                if (answered) { txt = ScreenLines(got); screenText = true; }
                                else textUnread = true;
                            }
                            else textUnread = true;
                        }
                        if (textUnread) node["text_unread"] = true;
                        if (txt != null)
                        {
                            txt = txt.Replace("\r\n", "\n");
                            if (txt.Length > 4000)
                                txt = screenText ? "[...]" + txt.Substring(txt.Length - 4000) : txt.Substring(0, 4000) + "...[truncated]";
                            node["text"] = txt;
                        }

                        Dictionary<string, object> st = new Dictionary<string, object>();
                        if (!CachedBool(el, AutomationElement.IsEnabledProperty)) st["disabled"] = true;
                        if (CachedBool(el, AutomationElement.IsOffscreenProperty)) st["offscreen"] = true;
                        if (CachedBool(el, AutomationElement.IsKeyboardFocusableProperty)) st["focusable"] = true;
                        if (CachedBool(el, AutomationElement.HasKeyboardFocusProperty)) st["focused"] = true;
                        if (patterns.Contains("Toggle"))
                        {
                            object o = CachedProp(el, TogglePattern.ToggleStateProperty);
                            if (o != null) st["toggle"] = o.ToString();
                        }
                        if (patterns.Contains("SelectionItem"))
                        {
                            object o = CachedProp(el, SelectionItemPattern.IsSelectedProperty);
                            if (o != null) st["selected"] = Convert.ToBoolean(o);
                        }
                        if (patterns.Contains("ExpandCollapse"))
                        {
                            object o = CachedProp(el, ExpandCollapsePattern.ExpandCollapseStateProperty);
                            if (o != null) st["expand"] = o.ToString();
                        }
                        if (patterns.Contains("RangeValue"))
                        {
                            object v = CachedProp(el, RangeValuePattern.ValueProperty);
                            object mn = CachedProp(el, RangeValuePattern.MinimumProperty);
                            object mx = CachedProp(el, RangeValuePattern.MaximumProperty);
                            if (v != null) st["value"] = v;
                            if (mn != null) st["min"] = mn;
                            if (mx != null) st["max"] = mx;
                        }
                        if (st.Count > 0) node["state"] = st;
                        nodes.Add(node);
                        elements[idx] = el;
                    }

                    if (f.Depth < maxDepth)
                    {
                        AutomationElementCollection kids = null;
                        try { kids = el.CachedChildren; } catch { }
                        if (kids != null)
                        {
                            List<AutomationElement> ks = new List<AutomationElement>(kids.Count);
                            foreach (AutomationElement k in kids) ks.Add(k);
                            for (int j = ks.Count - 1; j >= 0; j--) stack.Push(new Frame(ks[j], f.Depth + 1));
                        }
                    }
                }
            }
            else
            {
                // The provider would not answer a batched request in time (or at
                // all). Fall back to the one-call-per-property walk, which can
                // at least stop partway and hand back what it has.
                TreeWalker walker = TreeWalker.ControlViewWalker;
                Stack<Frame> stack = new Stack<Frame>();
                stack.Push(new Frame(win, 0));

                while (stack.Count > 0)
                {
                    if (nodes.Count >= maxNodes) { truncated = true; break; }
                    // The root always goes in, so a tight budget still hands
                    // back a tree rather than nothing.
                    if (nodes.Count > 0 && walkClock.ElapsedMilliseconds > walkBudgetMs)
                    {
                        truncated = true;
                        ranOutOfTime = true;
                        break;
                    }
                    Frame f = stack.Pop();
                    AutomationElement el = f.El;

                    int[] rect = RectOf(el);
                    List<string> patterns = PatternsOf(el);
                    bool interactive = false;
                    foreach (string ip in InteractivePatterns) { if (patterns.Contains(ip)) { interactive = true; break; } }

                    bool include = true;
                    if (interactiveOnly && f.Depth > 0 && !interactive) include = false;
                    if (rect == null && f.Depth > 0 && !offDesktop) include = false;

                    if (include)
                    {
                        Dictionary<string, object> node = new Dictionary<string, object>();
                        int idx = StableIndex(table, RidOf(el, false), el, usedIdx);
                        node["i"] = idx;
                        node["role"] = RoleOf(el);
                        node["depth"] = f.Depth;
                        string nm = CleanText(NameOf(el));
                        if (nm != null) node["name"] = nm;
                        string aid = AidOf(el);
                        if (!string.IsNullOrEmpty(aid)) node["aid"] = aid;
                        if (rect != null) node["rect"] = rect;
                        if (patterns.Count > 0) node["patterns"] = patterns;
                        string txt = CleanText(TextOf(el, patterns));
                        if (txt != null) node["text"] = txt;
                        Dictionary<string, object> st = StateOf(el, patterns);
                        if (st != null) node["state"] = st;
                        nodes.Add(node);
                        elements[idx] = el;
                    }

                    if (f.Depth < maxDepth)
                    {
                        List<AutomationElement> kids = new List<AutomationElement>();
                        try
                        {
                            AutomationElement k = walker.GetFirstChild(el);
                            int guard = 0;
                            while (k != null && guard < 500)
                            {
                                kids.Add(k);
                                k = walker.GetNextSibling(k);
                                guard++;
                            }
                        }
                        catch { }
                        for (int j = kids.Count - 1; j >= 0; j--) stack.Push(new Frame(kids[j], f.Depth + 1));
                    }
                }
            }

            Snapshot snap = new Snapshot();
            snap.Elements = elements;
            snap.Taken = DateTime.UtcNow;
            try
            {
                snap.Hwnd = new IntPtr(win.Current.NativeWindowHandle);
                snap.Title = win.Current.Name;
            }
            catch { }
            string sid = null;
            if (register)
            {
                _snapSeq++;
                sid = "s" + _snapSeq.ToString(CultureInfo.InvariantCulture);
                _snapshots[sid] = snap;
            }

            // Bound memory: drop oldest once past the cap.
            while (_snapshots.Count > MaxSnapshots)
            {
                string oldestKey = null;
                DateTime oldest = DateTime.MaxValue;
                foreach (KeyValuePair<string, Snapshot> kv in _snapshots)
                {
                    if (kv.Value.Taken < oldest) { oldest = kv.Value.Taken; oldestKey = kv.Key; }
                }
                if (oldestKey == null) break;
                _snapshots.Remove(oldestKey);
            }

            Dictionary<string, object> res = new Dictionary<string, object>();
            res["snapshot_id"] = sid;
            res["hwnd"] = (long)snap.Hwnd;
            res["title"] = snap.Title;
            res["rect"] = RectOf(win);
            res["node_count"] = nodes.Count;
            res["truncated"] = truncated;
            res["walk_ms"] = walkClock.ElapsedMilliseconds;
            res["batched"] = cachedPath;
            if (ranOutOfTime) res["time_budget_ms"] = walkBudgetMs;
            if (web) res["web"] = true;
            if (webWaitMs > 0) res["web_wait_ms"] = webWaitMs;
            if (offDesktop) res["other_desktop"] = true;
            res["nodes"] = nodes;
            return res;
        }

        // ---- target resolution -------------------------------------------------

        static AutomationElement SnapshotElement(Dictionary<string, object> a)
        {
            string sid = Str(Get(a, "snapshot_id"));
            int idx = Int(Get(a, "index"), -1);
            IntPtr h = HwndArg(a);
            Snapshot snap = null;
            if (!string.IsNullOrEmpty(sid)) _snapshots.TryGetValue(sid, out snap);
            else if (_snapSeq > 0) _snapshots.TryGetValue("s" + _snapSeq.ToString(CultureInfo.InvariantCulture), out snap);
            // The caller's window wins. A snapshot of some other window - the
            // newest one, or a stale id - must never supply the element.
            if (snap != null && h != IntPtr.Zero && snap.Hwnd != h) snap = null;

            AutomationElement el = null;
            if (snap != null && idx >= 0) snap.Elements.TryGetValue(idx, out el);
            if (el == null && idx >= 0)
            {
                // Indices are stable per window, so one seen in any earlier
                // read of this window still names the same control.
                IntPtr th = h != IntPtr.Zero ? h : (snap != null ? snap.Hwnd : IntPtr.Zero);
                StableTable t;
                if (th != IntPtr.Zero && _stable.TryGetValue((long)th, out t)) t.Latest.TryGetValue(idx, out el);
            }
            if (el == null)
            {
                if (_snapSeq == 0 && _stable.Count == 0)
                    throw new AxonError("no_snapshot", "No snapshot has been taken yet.",
                        "Call snapshot on the target window, then act on an index from it.");
                if (idx < 0)
                    throw new AxonError("index_out_of_range", "Index " + idx + " is not valid.", "Re-read the snapshot listing.");
                if (snap == null && !string.IsNullOrEmpty(sid))
                    throw new AxonError("snapshot_expired", "Snapshot " + sid + " is no longer held and index " + idx + " is not known for this window.",
                        "Take a fresh snapshot and use its indices.");
                throw new AxonError("index_out_of_range",
                    "Index " + idx + " is not an element of this window" + (sid != null ? " (snapshot " + sid + ")" : "") + ".",
                    "Indices are stable per window; take a snapshot of the window to see them.");
            }
            // Liveness probe, so a destroyed control fails loudly here instead of
            // silently acting on whatever now occupies its coordinates.
            try { ControlType ignored = el.Current.ControlType; }
            catch
            {
                throw new AxonError("element_stale", "Element " + idx + " from " + sid + " no longer exists.",
                    "The UI changed. Take a fresh snapshot.");
            }
            return el;
        }

        static StableTable StableFor(long hwnd)
        {
            if (_stable.Count > 24)
            {
                List<long> dead = new List<long>();
                foreach (KeyValuePair<long, StableTable> kv in _stable)
                    if (kv.Key != 0 && !Native.IsWindow(new IntPtr(kv.Key))) dead.Add(kv.Key);
                foreach (long d in dead) _stable.Remove(d);
                while (_stable.Count > 64)
                {
                    long oldestKey = 0; DateTime oldest = DateTime.MaxValue;
                    foreach (KeyValuePair<long, StableTable> kv in _stable)
                        if (kv.Value.Seen < oldest) { oldest = kv.Value.Seen; oldestKey = kv.Key; }
                    _stable.Remove(oldestKey);
                }
            }
            StableTable t;
            if (!_stable.TryGetValue(hwnd, out t)) { t = new StableTable(); _stable[hwnd] = t; }
            // A page that has navigated a hundred times has seen thousands of
            // elements come and go; past a point the table starts over.
            if (t.Latest.Count > 6000) { t.ByRid.Clear(); t.Latest.Clear(); }
            t.Seen = DateTime.UtcNow;
            return t;
        }

        static int StableIndex(StableTable t, string rid, AutomationElement el, WalkIds ids)
        {
            int idx;
            if (rid != null)
            {
                // A provider that hands two elements the same RuntimeId gets a
                // distinct key for the second, and the same one on every read.
                int n;
                ids.Seen.TryGetValue(rid, out n);
                ids.Seen[rid] = n + 1;
                if (n > 0) rid = rid + "#" + n.ToString(CultureInfo.InvariantCulture);
                if (t.ByRid.TryGetValue(rid, out idx) && !ids.Used.Contains(idx))
                {
                    t.Latest[idx] = el;
                    ids.Used.Add(idx);
                    return idx;
                }
            }
            idx = t.Next++;
            if (rid != null && !t.ByRid.ContainsKey(rid)) t.ByRid[rid] = idx;
            t.Latest[idx] = el;
            ids.Used.Add(idx);
            return idx;
        }

        static string RidOf(AutomationElement el, bool cached)
        {
            try
            {
                int[] ids = cached ? (CachedProp(el, AutomationElement.RuntimeIdProperty) as int[]) : el.GetRuntimeId();
                if (ids == null || ids.Length == 0) return null;
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < ids.Length; i++)
                {
                    if (i > 0) sb.Append('.');
                    sb.Append(ids[i].ToString(CultureInfo.InvariantCulture));
                }
                return sb.ToString();
            }
            catch { return null; }
        }

        // ---- posted input ------------------------------------------------------
        //
        // A window that is not in front can still be typed into: Windows
        // delivers a posted WM_CHAR to the control it names, and the app
        // handles it exactly as it handles a translated keystroke, with no
        // change of focus, foreground or cursor. That is how Claude types into
        // Notepad behind the document the user is writing. The write is read
        // back before it is believed; a control that ignores posted characters
        // reports nothing changed and the caller falls back to real keys.

        const uint WM_KEYDOWN = 0x0100, WM_KEYUP = 0x0101, WM_CHAR = 0x0102, WM_MOUSEMOVE = 0x0200;
        const uint WM_LBUTTONDOWN = 0x0201, WM_LBUTTONUP = 0x0202, WM_RBUTTONDOWN = 0x0204, WM_RBUTTONUP = 0x0205;
        const uint WM_MBUTTONDOWN = 0x0207, WM_MBUTTONUP = 0x0208;

        static string ReadElementText(AutomationElement el)
        {
            try
            {
                object vp = null;
                try { vp = el.GetCurrentPattern(ValuePattern.Pattern); } catch { }
                if (vp != null) return ((ValuePattern)vp).Current.Value ?? "";
                object tp = null;
                try { tp = el.GetCurrentPattern(TextPattern.Pattern); } catch { }
                if (tp != null) return ((TextPattern)tp).DocumentRange.GetText(8000) ?? "";
            }
            catch { }
            return null;
        }

        static string LongestLine(string text)
        {
            string best = "";
            foreach (string part in text.Replace("\r", "").Split('\n'))
            {
                string t = part.Trim();
                if (t.Length > best.Length) best = t;
            }
            return best.Length > 60 ? best.Substring(0, 60) : best;
        }

        static string TryPostText(AutomationElement el, IntPtr top, string text, bool force)
        {
            int elH = 0; try { elH = el.Current.NativeWindowHandle; } catch { }
            bool elFocused = false; try { elFocused = el.Current.HasKeyboardFocus; } catch { }
            uint pid; uint tid = Native.GetWindowThreadProcessId(top, out pid);
            IntPtr focus = IntPtr.Zero;
            try
            {
                Native.GUITHREADINFO gti = new Native.GUITHREADINFO();
                gti.cbSize = Marshal.SizeOf(typeof(Native.GUITHREADINFO));
                if (Native.GetGUIThreadInfo(tid, ref gti)) focus = gti.hwndFocus;
            }
            catch { }
            IntPtr dest = IntPtr.Zero;
            // A windowed control takes WM_CHAR directly. A child of a framework
            // window (XAML, Chromium) has no handle of its own: characters go
            // to the app's focused control, so only that control can be
            // addressed - anything else would type into the wrong field.
            if (elH != 0 && new IntPtr(elH) != top) dest = new IntPtr(elH);
            else if (focus != IntPtr.Zero && (elFocused || force)) dest = focus;
            if (dest == IntPtr.Zero) return null;

            string before = ReadElementText(el);
            // Unverifiable writes are made only when asked for by name.
            if (before == null && !force) return null;

            Trace(el, "type", top);
            foreach (char c in text)
            {
                if (c == '\r') continue;
                if (c == '\n')
                {
                    Native.PostMessageW(dest, WM_KEYDOWN, new IntPtr(0x0D), new IntPtr(0x001C0001));
                    Native.PostMessageW(dest, WM_CHAR, new IntPtr(0x0D), new IntPtr(0x001C0001));
                    Native.PostMessageW(dest, WM_KEYUP, new IntPtr(0x0D), new IntPtr(unchecked((int)0xC01C0001)));
                    continue;
                }
                if (c == '\t') { Native.PostMessageW(dest, WM_CHAR, new IntPtr(0x09), new IntPtr(1)); continue; }
                Native.PostMessageW(dest, WM_CHAR, new IntPtr(c), new IntPtr(1));
            }
            if (before == null) return "posted_unverified";
            string chunk = LongestLine(text);
            for (int i = 0; i < 20; i++)
            {
                System.Threading.Thread.Sleep(50);
                string after = ReadElementText(el);
                if (after != null && after != before)
                    return after.Contains(chunk) ? "posted" : "posted_changed";
            }
            // Nothing moved in a second: the control ignored posted characters,
            // so nothing was typed and the caller may use real keys.
            return null;
        }

        static object PostedClick(Dictionary<string, object> a, AutomationElement el, string button, int clicks)
        {
            int[] p;
            try { p = ClickPointOf(el); } catch { return null; }
            IntPtr top = HwndArg(a);
            if (top == IntPtr.Zero) top = TopWindowOf(el);
            int elH = 0; try { elH = el.Current.NativeWindowHandle; } catch { }
            IntPtr dest = elH != 0 ? new IntPtr(elH) : top;
            if (dest == IntPtr.Zero) return null;
            Dictionary<string, object> res = new Dictionary<string, object>();
            // Some frameworks (WinForms among them) check the pointer's window
            // before firing a click, so a posted click on a spot another
            // window covers is silently dropped there. Say so.
            try
            {
                IntPtr onTop = Native.RootWindowAt(p[0], p[1]);
                IntPtr topRoot = Native.GetAncestor(top, 2 /* GA_ROOT */);
                if (topRoot == IntPtr.Zero) topRoot = top;
                if (onTop != IntPtr.Zero && !Overlay.IsAnyOverlayWindow(onTop) && onTop != topRoot) res["covered"] = true;
            }
            catch { }
            Native.POINT cp = new Native.POINT();
            cp.X = p[0]; cp.Y = p[1];
            Native.ScreenToClient(dest, ref cp);
            IntPtr lp = new IntPtr((cp.Y << 16) | (cp.X & 0xFFFF));
            uint down = button == "right" ? WM_RBUTTONDOWN : (button == "middle" ? WM_MBUTTONDOWN : WM_LBUTTONDOWN);
            uint up = button == "right" ? WM_RBUTTONUP : (button == "middle" ? WM_MBUTTONUP : WM_LBUTTONUP);
            IntPtr wp = new IntPtr(button == "right" ? 2 : (button == "middle" ? 0x10 : 1));
            Trace(el, "click", top);
            Native.PostMessageW(dest, WM_MOUSEMOVE, IntPtr.Zero, lp);
            for (int i = 0; i < Math.Max(1, clicks); i++)
            {
                Native.PostMessageW(dest, down, wp, lp);
                Native.PostMessageW(dest, up, IntPtr.Zero, lp);
            }
            res["method"] = "posted_click";
            res["point"] = p;
            res["background"] = true;
            System.Threading.Thread.Sleep(80);
            AddNowState(res, el);
            return res;
        }

        static Dictionary<string, ControlType> _controlTypes;

        static ControlType LookupControlType(string role)
        {
            if (_controlTypes == null)
            {
                _controlTypes = new Dictionary<string, ControlType>(StringComparer.OrdinalIgnoreCase);
                ControlType[] all = new ControlType[]
                {
                    ControlType.Button, ControlType.Calendar, ControlType.CheckBox, ControlType.ComboBox,
                    ControlType.Edit, ControlType.Hyperlink, ControlType.Image, ControlType.ListItem,
                    ControlType.List, ControlType.Menu, ControlType.MenuBar, ControlType.MenuItem,
                    ControlType.ProgressBar, ControlType.RadioButton, ControlType.ScrollBar, ControlType.Slider,
                    ControlType.Spinner, ControlType.StatusBar, ControlType.Tab, ControlType.TabItem,
                    ControlType.Text, ControlType.ToolBar, ControlType.ToolTip, ControlType.Tree,
                    ControlType.TreeItem, ControlType.Custom, ControlType.Group, ControlType.Thumb,
                    ControlType.DataGrid, ControlType.DataItem, ControlType.Document, ControlType.SplitButton,
                    ControlType.Window, ControlType.Pane, ControlType.Header, ControlType.HeaderItem,
                    ControlType.Table, ControlType.TitleBar, ControlType.Separator
                };
                foreach (ControlType ct in all)
                {
                    string n = ct.ProgrammaticName;
                    if (n != null && n.StartsWith("ControlType.")) n = n.Substring("ControlType.".Length);
                    _controlTypes[n] = ct;
                }
            }
            ControlType found;
            if (_controlTypes.TryGetValue(role, out found)) return found;
            return null;
        }

        static AutomationElement FindBySelector(Dictionary<string, object> a)
        {
            // Validate the selector before resolving a window. A malformed
            // selector is the caller's mistake either way, and reporting it as
            // window_not_found because the window happened to close as well
            // sends them looking in entirely the wrong place.
            Dictionary<string, object> sel = Get(a, "selector") as Dictionary<string, object>;
            if (sel == null)
                throw new AxonError("bad_selector", "Selector must be an object.", null);
            if (string.IsNullOrEmpty(Str(Get(sel, "automation_id")))
                && string.IsNullOrEmpty(Str(Get(sel, "name")))
                && string.IsNullOrEmpty(Str(Get(sel, "role"))))
                throw new AxonError("bad_selector",
                    "Selector needs at least one of automation_id, name, or role.", null);

            AutomationElement win = RequireWindow(a);

            List<Condition> conds = new List<Condition>();
            string aid = Str(Get(sel, "automation_id"));
            if (!string.IsNullOrEmpty(aid))
                conds.Add(new PropertyCondition(AutomationElement.AutomationIdProperty, aid));
            string name = Str(Get(sel, "name"));
            if (!string.IsNullOrEmpty(name))
                conds.Add(new PropertyCondition(AutomationElement.NameProperty, name));
            string role = Str(Get(sel, "role"));
            if (!string.IsNullOrEmpty(role))
            {
                ControlType ct = LookupControlType(role);
                if (ct == null)
                    throw new AxonError("bad_selector", "Unknown role '" + role + "'.",
                        "Use a role string exactly as it appears in a snapshot, such as Button or Edit.");
                conds.Add(new PropertyCondition(AutomationElement.ControlTypeProperty, ct));
            }
            if (conds.Count == 0)
                throw new AxonError("bad_selector", "Selector needs at least one of automation_id, name, or role.", null);

            Condition cond = conds.Count == 1 ? conds[0] : new AndCondition(conds.ToArray());
            // unique:true is the stale-index fallback: it may only stand in for
            // the element an index named when exactly one element matches.
            if (Bool(Get(sel, "unique"), false))
            {
                AutomationElementCollection all = win.FindAll(TreeScope.Descendants, cond);
                if (all.Count == 0)
                    throw new AxonError("element_not_found", "No element matched the selector.",
                        "Take a snapshot to see what the window actually exposes.");
                if (all.Count > 1)
                    throw new AxonError("ambiguous_selector", all.Count + " elements match that name and role.",
                        "Take a fresh snapshot and act on an index from it.");
                return all[0];
            }
            AutomationElement found = win.FindFirst(TreeScope.Descendants, cond);
            if (found == null)
                throw new AxonError("element_not_found", "No element matched the selector.",
                    "Take a snapshot to see what the window actually exposes.");
            return found;
        }

        class Target
        {
            public AutomationElement El;
            public string Mode;
            public int[] Point;
        }

        static Target ResolveTarget(Dictionary<string, object> a)
        {
            Target t = new Target();
            if (Get(a, "index") != null)
            {
                t.El = SnapshotElement(a);
                t.Mode = "index";
                return t;
            }
            if (Get(a, "selector") != null)
            {
                t.El = FindBySelector(a);
                t.Mode = "selector";
                return t;
            }
            object pt = Get(a, "point");
            if (pt != null)
            {
                object[] arr = pt as object[];
                if (arr == null || arr.Length < 2)
                    throw new AxonError("bad_target", "point must be [x, y].", null);
                t.Mode = "point";
                t.Point = new int[] { Int(arr[0], 0), Int(arr[1], 0) };
                return t;
            }
            throw new AxonError("no_target", "Provide index, selector, or point.",
                "Prefer index from a snapshot. point is a last resort for canvas-drawn UI.");
        }

        static int[] ClickPointOf(AutomationElement el)
        {
            // The provider nominates its own clickable point, which beats a
            // centre-of-rect guess for irregular or partly covered controls.
            try
            {
                System.Windows.Point p = el.GetClickablePoint();
                return new int[] { (int)p.X, (int)p.Y };
            }
            catch { }
            int[] r = RectOf(el);
            if (r == null)
                throw new AxonError("no_click_point", "Element has no clickable point and no on-screen rectangle.",
                    "It may be scrolled out of view. Scroll it into view first.");
            return new int[] { r[0] + r[2] / 2, r[1] + r[3] / 2 };
        }

        // ---- coexistence -------------------------------------------------------
        //
        // Computer Use shares one desktop with a human. Reading a window never touches
        // input, and neither does invoking an accessibility pattern, so most of
        // what Computer Use does is genuinely invisible. Only two things intrude: moving
        // the cursor and taking the foreground. Those are what this gates.

        static int _idleMs = 1200;      // quiet for this long counts as "not using it"
        static int _waitMs = 6000;      // how long to wait for a gap before giving up
        static string _mode = "share";  // share | yield | take

        internal static void Configure(int idleMs, int waitMs, string mode)
        {
            if (idleMs > 0) _idleMs = idleMs;
            if (waitMs >= 0) _waitMs = waitMs;
            string nm = NormMode(mode);
            if (nm != null) _mode = nm;
        }

        // A plugin setting the user never filled in can arrive as the literal
        // "${user_config.coexist_mode}", and a typo'd mode would otherwise be
        // stored and reported as if it meant something. Unknown means default.
        static string NormMode(string m)
        {
            if (string.IsNullOrEmpty(m)) return null;
            string t = m.Trim().ToLowerInvariant();
            if (t == "share" || t == "yield" || t == "take" || t == "exclusive") return t;
            return null;
        }

        static string ModeOf(Dictionary<string, object> a)
        {
            string m = NormMode(Str(Get(a, "mode")));
            return m != null ? m : _mode;
        }

        // Cheap gate on every action: never contend for the window the human is
        // actively typing or clicking in. Cursor movement over a window is not
        // enough to claim it - only deliberate input is.
        // A press of Stop on the banner halts the run. It is consumed here so
        // one press stops one run, and the caller is told plainly.
        static void GuardStopped()
        {
            if (Overlay.ConsumeStop())
                throw new AxonError("stopped_by_user",
                    "The user pressed Stop on the on-screen banner.",
                    "They have taken the machine back. Do not retry: say what you had done so far and ask before continuing.");
        }

        static void GuardSameWindow(Dictionary<string, object> a, IntPtr target)
        {
            GuardStopped();
            Overlay.MarkActive();
            // take and exclusive both mean "go now". exclusive additionally
            // holds the user off, so waiting for a gap would defeat its purpose.
            string m0 = ModeOf(a);
            if (m0 == "take" || m0 == "exclusive") return;
            if (!Presence.HooksOk || target == IntPtr.Zero) return;
            if (!Presence.Busy(_idleMs)) return;
            // Only their own window counts. Being busy elsewhere is exactly the
            // case Computer Use is built for, and a window Computer Use itself just raised is
            // not one the user was working in.
            if (Hwnd(Presence.CommitWindow) != Hwnd(target)) return;
            if (Native.GetForegroundWindow() != target) return;
            throw new AxonError("user_in_window",
                "The user is working in that window right now.",
                "Work somewhere else, wait for them to stop, or pass mode:\"take\" if they asked you to drive this window while they watch.");
        }

        // Gate immediately before anything that moves the cursor or steals the
        // foreground. Returns the number of ms spent waiting, or -1 if none.
        static int GuardDisturb(Dictionary<string, object> a)
        {
            GuardStopped();
            Overlay.MarkActive();
            string mode = ModeOf(a);
            if (mode == "take" || mode == "exclusive") return -1;
            if (!Presence.Available) return -1;
            if (!Presence.Active(_idleMs)) return -1;

            if (mode == "yield")
                throw new AxonError("user_busy",
                    "The user is using the mouse or keyboard, and this step needs the cursor or the foreground.",
                    "Reading and pattern-based actions still work while they are busy. Retry when they pause.");

            int start = Environment.TickCount;
            if (!Presence.WaitForQuiet(_idleMs, _waitMs))
                throw new AxonError("user_busy",
                    "Waited " + _waitMs + "ms but the user is still active, and this step needs the cursor or the foreground.",
                    "Reading and pattern-based actions still work while they are busy. Retry when they pause, or pass mode:\"take\" to interrupt them.");
            int waited = Environment.TickCount - start;
            return waited > 0 ? waited : -1;
        }

        static void NoteWait(Dictionary<string, object> res, int waited)
        {
            if (waited > 0) res["waited_for_user_ms"] = waited;
        }

        // How many other Claude sessions are live right now. The MCP layer owns
        // that count - it is the one that reads the session registry - and pushes
        // it here so the banner can name itself only while it needs to.
        // Two numbers out of a JSON array, or null.
        static int[] Pair(object o)
        {
            if (o == null || o is string) return null;
            System.Collections.IEnumerable list = o as System.Collections.IEnumerable;
            if (list == null) return null;
            List<int> vals = new List<int>();
            foreach (object v in list) vals.Add(Int(v, 0));
            return vals.Count >= 2 ? new int[] { vals[0], vals[1] } : null;
        }

        // A drag: press at one point, move through a few intermediate points,
        // release at another. Canvases, sliders, handwriting, 3D viewports -
        // Codex added it for exactly those. Physical by nature: it needs the
        // pointer and the window in front, and follows the same coexistence
        // rules as a physical click.
        static object OpDrag(Dictionary<string, object> a)
        {
            Dictionary<string, object> res = new Dictionary<string, object>();
            int[] from = Pair(Get(a, "from"));
            int[] to = Pair(Get(a, "to"));
            if (from == null || to == null)
                throw new AxonError("bad_points", "drag needs from:[x,y] and to:[x,y] in screen coordinates.",
                    "Read the window with with_rects:true to find the points.");
            string button = Str(Get(a, "button"));
            if (button == null || button.Length == 0) button = "left";
            int steps = Int(Get(a, "steps"), 12);
            if (steps < 2) steps = 2;
            if (steps > 200) steps = 200;
            int holdMs = Int(Get(a, "hold_ms"), 60);
            if (holdMs < 0) holdMs = 0;
            if (holdMs > 2000) holdMs = 2000;

            AutomationElement win = RequireWindow(a);
            IntPtr expectWindow = new IntPtr(win.Current.NativeWindowHandle);
            NoteWait(res, GuardDisturb(a));
            RequireForeground(expectWindow, a, res);
            IntPtr owner = Native.RootWindowAt(from[0], from[1]);
            if (Overlay.IsAnyOverlayWindow(owner)) owner = expectWindow;
            if (owner != IntPtr.Zero && owner != expectWindow)
                throw new AxonError("obscured", "The start point is over another window, so the drag would begin in the wrong one.",
                    "Move that window, or start from a point of the target that is actually visible.");

            Native.POINT saved;
            bool haveSaved = Native.GetCursorPos(out saved);
            bool held = Exclusive(a) && Native.BeginExclusive();
            bool steppedAside = Overlay.BeginClickThrough(from[0], from[1]);
            try
            {
                Presence.NoteSelfInput();
                Native.SetCursorPos(from[0], from[1]);
                System.Threading.Thread.Sleep(30);
                Native.MouseButton(button, true);
                System.Threading.Thread.Sleep(holdMs);
                for (int i = 1; i <= steps; i++)
                {
                    int x = from[0] + (to[0] - from[0]) * i / steps;
                    int y = from[1] + (to[1] - from[1]) * i / steps;
                    Presence.NoteSelfInput();
                    Native.SetCursorPos(x, y);
                    System.Threading.Thread.Sleep(12);
                }
                System.Threading.Thread.Sleep(holdMs);
                Native.MouseButton(button, false);
                System.Threading.Thread.Sleep(30);
            }
            finally
            {
                if (held) Native.EndExclusive();
                if (steppedAside) Overlay.EndClickThrough();
            }
            if (haveSaved && !held && ModeOf(a) != "take")
            {
                Native.SetCursorPos(saved.X, saved.Y);
                res["cursor_restored"] = true;
            }
            if (held) res["input_held"] = true;
            res["from"] = from;
            res["to"] = to;
            res["button"] = button;
            res["steps"] = steps;
            return res;
        }

        // The banner's live status line. Text only; an empty string clears it.
        static object OpBanner(Dictionary<string, object> a)
        {
            string t = Str(Get(a, "text"));
            if (t == null) t = "";
            if (t.Length > 60) t = t.Substring(0, 60);
            Overlay.Status(t);
            Dictionary<string, object> res = new Dictionary<string, object>();
            res["status"] = t;
            return res;
        }

        static object OpSession(Dictionary<string, object> a)
        {
            Overlay.Configure(
                Int(Get(a, "slot"), 0),
                Str(Get(a, "label")),
                Int(Get(a, "peers"), 0));
            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = true;
            res["accent"] = Overlay.AccentHex;
            return res;
        }

        static object OpPresence(Dictionary<string, object> a)
        {
            Dictionary<string, object> r = Presence.Report();
            r["user_active"] = Presence.Active(_idleMs);
            r["user_busy"] = Presence.Busy(_idleMs);
            r["idle_threshold_ms"] = _idleMs;
            r["stop_requested"] = Overlay.StopRequested;
            r["input_blocked"] = Native.InputBlocked;
            r["mode"] = _mode;
            // Whether this Windows can answer "is that window on the desktop the
            // user is looking at". Reported rather than assumed, because the
            // answer changes what a physical click means.
            IntPtr fgProbe = Native.GetForegroundWindow();
            r["virtual_desktops"] = (fgProbe != IntPtr.Zero && Overlay.OnCurrentDesktop(fgProbe) >= 0)
                ? "available" : "unavailable";
            int here = Overlay.OverlayHere();
            if (here >= 0) r["overlay_on_current_desktop"] = here == 1;
            // Injected events are anything synthetic - this session's input AND
            // any other Claude session's. Never the user's, which is the property
            // that matters, but worth being exact about.
            r["injected_note"] = "injected events are synthetic input from any automation on this desktop, including other Claude sessions";
            IntPtr fg = Native.GetForegroundWindow();
            r["foreground_hwnd"] = Hwnd(fg);
            try
            {
                if (fg != IntPtr.Zero)
                {
                    AutomationElement fe = AutomationElement.FromHandle(fg);
                    if (fe != null)
                    {
                        r["foreground_title"] = fe.Current.Name;
                        uint pid;
                        Native.GetWindowThreadProcessId(fg, out pid);
                        try { r["foreground_process"] = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; }
                        catch { }
                    }
                }
            }
            catch { }
            return r;
        }

        // ---- actions ----------------------------------------------------------

        // Window handles reach Computer Use from two directions: as an int from
        // UIAutomation's NativeWindowHandle, and as an IntPtr from user32. On a
        // handle with the high bit set those sign-extend differently, so every
        // comparison goes through the same 32-bit normalisation.
        internal static long Hwnd(IntPtr h) { return (long)(int)h; }
        internal static long Hwnd(long h) { return (long)(int)h; }

        static IntPtr HwndArg(Dictionary<string, object> a)
        {
            long h = Long(Get(a, "hwnd"), 0);
            return h == 0 ? IntPtr.Zero : new IntPtr(h);
        }

        // Keystrokes go wherever focus is, not to a window we name, so sending
        // them while another app is in front types into that app instead. Raise
        // the intended window first and refuse if it will not come forward.
        static void RequireForeground(IntPtr expect) { RequireForeground(expect, null, null); }

        static void RequireForeground(IntPtr expect, Dictionary<string, object> a, Dictionary<string, object> res)
        {
            if (expect == IntPtr.Zero) return;
            if (Native.GetForegroundWindow() == expect) return;
            if (a != null) NoteWait(res, GuardDisturb(a));
            Native.ForceForeground(expect);
            System.Threading.Thread.Sleep(120);
            if (Native.GetForegroundWindow() != expect)
                throw new AxonError("window_not_focused",
                    "The target window is not in front, so keystrokes would go to whatever is.",
                    "Another app is holding the foreground, often a modal dialog. Resolve that first.");
        }

        // Keystrokes follow the keyboard focus, not a window we name. If focusing
        // the target element did not actually take - a provider that refuses, an
        // element that is not focusable, a window that would not come forward -
        // then typing anyway puts the text into whatever the user has in front:
        // their document, their chat, their terminal. That is the one failure
        // that is worse than doing nothing, so it is checked rather than assumed.
        static void RequireTypingFocus(AutomationElement el, IntPtr expect)
        {
            try { if (el != null && el.Current.HasKeyboardFocus) return; }
            catch { }

            IntPtr fg = Native.GetForegroundWindow();
            if (fg != IntPtr.Zero)
            {
                IntPtr fgRoot = Native.GetAncestor(fg, 2 /* GA_ROOT */);
                if (fgRoot == IntPtr.Zero) fgRoot = fg;

                IntPtr want = expect;
                // No window was named, so find the element's own top-level window.
                if (want == IntPtr.Zero) want = TopWindowOf(el);
                if (want != IntPtr.Zero)
                {
                    IntPtr wantRoot = Native.GetAncestor(want, 2);
                    if (wantRoot == IntPtr.Zero) wantRoot = want;
                    // The right window is in front. The element may simply not
                    // report focus honestly, which many providers do not.
                    if (fgRoot == wantRoot) return;
                }
            }

            throw new AxonError("focus_failed",
                "Could not put the keyboard focus on that element, so the text would have gone to whatever window is in front instead.",
                "Use replace:true, which writes through the element's value pattern and needs no focus at all, or focus the window first.");
        }

        // Nearest ancestor with a real window handle. Child elements report zero.
        static IntPtr TopWindowOf(AutomationElement el)
        {
            try
            {
                TreeWalker w = TreeWalker.ControlViewWalker;
                AutomationElement cur = el;
                for (int i = 0; i < 24 && cur != null; i++)
                {
                    int h = cur.Current.NativeWindowHandle;
                    if (h != 0) return new IntPtr(h);
                    cur = w.GetParent(cur);
                }
            }
            catch { }
            return IntPtr.Zero;
        }

        static int EnvInt(string name, int fallback)
        {
            string v = Environment.GetEnvironmentVariable(name);
            int n;
            if (!string.IsNullOrEmpty(v) && int.TryParse(v, out n) && n >= 0) return n;
            return fallback;
        }

        static bool Exclusive(Dictionary<string, object> a) { return ModeOf(a) == "exclusive"; }

        static void PhysicalClick(Dictionary<string, object> a, int[] point, string button, int clicks, IntPtr expectWindow, Dictionary<string, object> res)
        {
            // This is one of only two things Computer Use does that the user can feel.
            NoteWait(res, GuardDisturb(a));

            // Borrow the pointer, then put it back where they left it.
            Native.POINT saved;
            bool haveSaved = Native.GetCursorPos(out saved);

            // A real click lands on whatever is topmost at that point. If
            // something covers the target, the click would go to the wrong app,
            // so confirm ownership rather than clicking blind.
            if (expectWindow != IntPtr.Zero)
            {
                IntPtr owner = Native.RootWindowAt(point[0], point[1]);
                // Our own chrome is not a cover: the marker, ring and cursor are
                // click-through already, and the banner steps aside below.
                if (Overlay.IsOwnWindow(owner)) owner = expectWindow;
                else if (Overlay.IsAnyOverlayWindow(owner))
                    throw new AxonError("obscured",
                        "Another Claude session's on-screen banner is over that control, so a real click would press their banner instead.",
                        "Target it by index or selector - the pattern path clicks it where it sits, with nothing in the way.");
                if (owner != IntPtr.Zero && owner != expectWindow)
                {
                    // Only take/exclusive may raise a covered window - those are
                    // the modes where the user has said to drive. In share and
                    // yield, raising it would yank the user away from whatever
                    // they are doing in front, so instead refuse and let Claude
                    // use the pattern path, which needs no foreground at all.
                    string m = ModeOf(a);
                    bool mayRaise = (m == "take" || m == "exclusive");
                    if (mayRaise)
                    {
                        Native.ForceForeground(expectWindow);
                        System.Threading.Thread.Sleep(120);
                        owner = Native.RootWindowAt(point[0], point[1]);
                    }
                    if (owner != IntPtr.Zero && owner != expectWindow)
                        throw new AxonError("obscured",
                            "That control is behind another window, so a real click would hit the wrong one.",
                            "Target it by index or selector instead - the pattern path clicks it where it sits, without raising it over what the user is doing.");
                }
            }
            bool held = Exclusive(a) && Native.BeginExclusive();
            // The banner accepts clicks, so it would swallow one aimed at a
            // control underneath it - or worse, press its own Stop button.
            bool steppedAside = Overlay.BeginClickThrough(point[0], point[1]);
            try
            {
                Native.SetCursorPos(point[0], point[1]);
                System.Threading.Thread.Sleep(16);
                for (int n = 0; n < clicks; n++)
                {
                    Native.MouseButton(button, true);
                    System.Threading.Thread.Sleep(12);
                    Native.MouseButton(button, false);
                    if (n < clicks - 1) System.Threading.Thread.Sleep(60);
                }
            }
            finally
            {
                if (held) Native.EndExclusive();
                if (steppedAside) Overlay.EndClickThrough();
            }
            if (held) res["input_held"] = true;
            if (steppedAside) res["banner_stepped_aside"] = true;
            // Always put the pointer back. The click is the action; leaving the
            // cursor parked on the control just makes the user's own pointer
            // appear to jump away. Even in take mode, snapping it back the moment
            // the click lands is what the user expects - a brief flick, not a
            // relocation. Only skip when input is being held (exclusive), where
            // the user's pointer is frozen anyway and cannot be confused.
            //
            // The short settle is load-bearing: the mouse-up above is a queued
            // SendInput event, while SetCursorPos moves the cursor immediately.
            // Restoring with no gap can let the up register at the restored spot
            // instead of the target - down here, up there - which the OS reads as
            // a drag, and the click silently does not fire. A dozen milliseconds
            // lets the button-up dispatch first; it is imperceptible.
            if (haveSaved && !held)
            {
                System.Threading.Thread.Sleep(12);
                Native.SetCursorPos(saved.X, saved.Y);
                res["cursor_restored"] = true;
            }
        }

        // UIA pattern calls block until the target app's message pump reports
        // idle, and an app that never quite does pins the host for seconds. The
        // action still has to complete, so cutting it short would mean reporting
        // a click that never happened. The deadline is therefore generous: it
        // exists to stop a wedged provider hanging the session forever, not to
        // rush a slow one. Anything that hits it is reported as slow_provider
        // so the caller knows the outcome is unconfirmed.
        const int PatternDeadlineMs = 15000;

        static bool RunPattern(Action act) { return RunPattern(act, PatternDeadlineMs); }

        // A Win32 push button or check box pressed through its MSAA default
        // action instead of the UI Automation pattern. The client-side UIA
        // proxy for the BUTTON class gives the button the keyboard focus before
        // pressing it, and when Windows will not let this process take the
        // foreground - which is every time the user is in another app - it sits
        // out its focus timeouts first. Measured on the WinForms test target
        // with the terminal in front: Invoke and Toggle 4.0-4.3 s each, this
        // path 16-70 ms, the press landing either way. It is the same action a
        // screen reader's "press" sends, it needs no focus, and it moves
        // neither the cursor nor the foreground.
        //
        // Only for an element that is itself a BUTTON-class window and says it
        // has a default action; anything else (a windowless control, a browser,
        // WPF, a group box, a disabled button) returns null and takes the UIA path
        // as before.
        // Returns null when not taken, otherwise whether the call finished
        // inside the pattern deadline.
        static bool? MsaaPress(AutomationElement el)
        {
            int h = 0;
            try
            {
                h = el.Current.NativeWindowHandle;
                // A disabled button's default action does nothing and reports
                // nothing; the UIA path refuses it out loud, so it keeps it.
                if (!el.Current.IsEnabled) return null;
            }
            catch { return null; }
            if (h == 0) return null;
            IntPtr hw = new IntPtr(h);
            System.Text.StringBuilder cls = new System.Text.StringBuilder(128);
            Native.GetClassName(hw, cls, cls.Capacity);
            string c = cls.ToString();
            bool button = string.Equals(c, "Button", StringComparison.OrdinalIgnoreCase)
                       || c.StartsWith("WindowsForms10.BUTTON", StringComparison.OrdinalIgnoreCase);
            if (!button) return null;
            object acc = null;
            try
            {
                Guid iid = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71"); // IID_IAccessible
                if (Native.AccessibleObjectFromWindow(hw, unchecked((int)0xFFFFFFFC) /* OBJID_CLIENT */, ref iid, out acc) != 0 || acc == null)
                    return null;
                object action = acc.GetType().InvokeMember("accDefaultAction",
                    System.Reflection.BindingFlags.GetProperty, null, acc, new object[] { 0 });
                if (string.IsNullOrEmpty(action as string)) return null;
            }
            catch { return null; }
            object a2 = acc;
            try
            {
                return RunPattern(delegate
                {
                    a2.GetType().InvokeMember("accDoDefaultAction",
                        System.Reflection.BindingFlags.InvokeMethod, null, a2, new object[] { 0 });
                });
            }
            // A refused default action did nothing, so the UIA path still gets
            // its turn rather than the click falling through to a real one.
            catch { return null; }
        }

        static bool RunPattern(Action act, int deadlineMs)
        {
            Exception failure = null;
            using (System.Threading.ManualResetEventSlim done = new System.Threading.ManualResetEventSlim(false))
            {
                System.Threading.ThreadPool.QueueUserWorkItem(delegate
                {
                    try { act(); }
                    catch (Exception ex) { failure = ex; }
                    finally { try { done.Set(); } catch { } }
                });
                bool finished = done.Wait(deadlineMs);
                if (finished && failure != null) throw failure;
                return finished;
            }
        }

        // What the element looks like now that the action has landed. This is
        // the difference between "clicked" and "clicked, and the label now reads
        // pressed:3" - it saves Claude a whole follow-up snapshot per action,
        // which is the single most common wasted round-trip.
        static void AddNowState(Dictionary<string, object> res, AutomationElement el)
        {
            try
            {
                List<string> patterns = PatternsOf(el);

                // Only elements that carry state have a meaningful "after". A
                // plain button does not, and asking one for its value or text
                // costs two UIA timeouts - four seconds - for nothing.
                bool stateful = Has(patterns, "Value") || Has(patterns, "Toggle")
                             || Has(patterns, "SelectionItem") || Has(patterns, "ExpandCollapse")
                             || Has(patterns, "RangeValue");
                if (!stateful) return;

                Dictionary<string, object> now = new Dictionary<string, object>();
                // Value only. TextPattern is the slow one and adds nothing here.
                string v = null;
                if (Has(patterns, "Value"))
                {
                    try
                    {
                        ValuePattern vp = el.GetCurrentPattern(ValuePattern.Pattern) as ValuePattern;
                        if (vp != null) v = vp.Current.Value;
                    }
                    catch { }
                }
                if (!string.IsNullOrEmpty(v)) now["text"] = v.Length > 200 ? v.Substring(0, 200) + "..." : v;
                Dictionary<string, object> st = StateOf(el, patterns);
                if (st != null)
                {
                    object o;
                    if (st.TryGetValue("toggle", out o)) now["toggle"] = o;
                    if (st.TryGetValue("selected", out o)) now["selected"] = o;
                    if (st.TryGetValue("expand", out o)) now["expand"] = o;
                    if (st.TryGetValue("value", out o)) now["value"] = o;
                    if (st.TryGetValue("disabled", out o)) now["disabled"] = o;
                }
                if (now.Count > 0) res["now"] = now;
            }
            catch { /* the element may have gone; the action still succeeded */ }
        }

        // Draw what just happened, where it happened - but only if the user can
        // actually see the spot. When Computer Use acts on a window behind the
        // one the user is working in, drawing a marker there would paint on top
        // of the user's front window instead: "going over their thing". So the
        // marker and cursor are suppressed when the target control is covered by
        // another window, and the top banner alone signals that work is going on.
        static void Trace(AutomationElement el, string label, IntPtr expectWindow)
        {
            if (!Overlay.Enabled || el == null) return;
            try
            {
                int[] r = RectOf(el);
                if (r == null) return;
                if (IsOccluded(r, expectWindow)) return;

                // Name the control, not just the verb. "click: Save" is
                // readable from across the room; a bare rectangle is not.
                string name = NameOf(el);
                if (!string.IsNullOrEmpty(name))
                {
                    if (name.Length > 34) name = name.Substring(0, 34) + "...";
                    label = label + ": " + name;
                }
                Overlay.Flash(r, label);
            }
            catch { }
        }

        // True only when we are CONFIDENT the control is behind another window:
        // the caller told us which window it belongs to (the MCP layer always
        // does), and the pixel at the control's centre is owned by a different,
        // real application window. If the target window is unknown, or the pixel
        // belongs to the target or to Computer Use's own overlay, it is treated
        // as visible - so the marker and cursor show in the normal foreground
        // case, and are hidden only for genuine behind-another-window work.
        static bool IsOccluded(int[] r, IntPtr expectWindow)
        {
            try
            {
                if (expectWindow == IntPtr.Zero) return false;
                int cx = r[0] + r[2] / 2;
                int cy = r[1] + r[3] / 2;
                IntPtr onTop = Native.RootWindowAt(cx, cy);
                if (onTop == IntPtr.Zero || Overlay.IsAnyOverlayWindow(onTop)) return false;

                IntPtr expRoot = Native.GetAncestor(expectWindow, 2 /* GA_ROOT */);
                if (expRoot == IntPtr.Zero) expRoot = expectWindow;
                return onTop != expRoot;
            }
            catch { return false; }
        }

        static object OpClick(Dictionary<string, object> a)
        {
            GuardSameWindow(a, HwndArg(a));
            Target t = ResolveTarget(a);
            string button = Str(Get(a, "button"));
            if (string.IsNullOrEmpty(button)) button = "left";
            int clicks = Int(Get(a, "clicks"), 1);
            bool forcePhysical = Bool(Get(a, "physical"), false);

            Dictionary<string, object> res = new Dictionary<string, object>();

            if (t.Mode == "point")
            {
                PhysicalClick(a, t.Point, button, clicks, HwndArg(a), res);
                res["method"] = "physical";
                res["point"] = t.Point;
                return res;
            }

            AutomationElement el = t.El;
            List<string> patterns = PatternsOf(el);

            // A disabled control does nothing when clicked. Its pattern refuses
            // (ElementNotEnabled), and falling through to a real click on it
            // - what used to happen - pressed nothing, took the foreground from
            // the user, and came back as "clicked via physical": on 2026-09-26
            // a form's Next button, disabled until the form was valid, went
            // exactly that way. physical:true still sends a real click.
            if (!forcePhysical)
            {
                bool enabled = true;
                try { enabled = el.Current.IsEnabled; } catch { }
                if (!enabled)
                    throw new AxonError("element_disabled",
                        DescribeEl(el) + " is disabled, so clicking it would do nothing.",
                        "Wait for it to become enabled (computer_wait_for, or read the window again once the form is complete), then click it. physical:true sends a real click anyway.");
            }

            // What a click on this control is expected to change - a check
            // mark, a selection, an expansion - read before the click so the
            // state reported after it is the new one or is said to be unconfirmed.
            bool single = button == "left" && clicks == 1;
            ClickState before = single ? ReadClickState(el, patterns) : null;

            // Pattern invoke is the fast deterministic path: no cursor movement,
            // no dependence on the window being unobscured or on top.
            if (!forcePhysical && single)
            {
                string tried = null;
                try
                {
                    if (Has(patterns, "Invoke"))
                    {
                        tried = "Invoke";
                        InvokePattern p = el.GetCurrentPattern(InvokePattern.Pattern) as InvokePattern;
                        if (p != null)
                        {
                            Trace(el, "click", HwndArg(a));
                            InvokePattern ip = p;
                            bool? msaa = MsaaPress(el);
                            bool done;
                            if (msaa == null) done = RunPattern(delegate { ip.Invoke(); });
                            else
                            {
                                done = msaa.Value;
                                res["via"] = "msaa_default_action";
                            }
                            if (!done) res["slow_provider"] = true;
                            res["method"] = "invoke_pattern";
                            // A provider that did not answer in time is not asked
                            // anything else on this thread.
                            if (done)
                            {
                                if (!AwaitClickState(el, patterns, before, SettleMs)) res["state_unconfirmed"] = true;
                                AddNowState(res, el);
                            }
                            return res;
                        }
                    }
                    if (Has(patterns, "Toggle"))
                    {
                        tried = "Toggle";
                        TogglePattern p = el.GetCurrentPattern(TogglePattern.Pattern) as TogglePattern;
                        if (p != null)
                        {
                            Trace(el, "toggle", HwndArg(a));
                            TogglePattern tp2 = p;
                            bool? msaa = MsaaPress(el);
                            bool done;
                            if (msaa == null) done = RunPattern(delegate { tp2.Toggle(); });
                            else
                            {
                                done = msaa.Value;
                                res["via"] = "msaa_default_action";
                            }
                            res["method"] = "toggle_pattern";
                            if (!done) res["slow_provider"] = true;
                            else
                            {
                                // A browser applies the toggle to the page first and
                                // to its accessibility tree a beat later, and a native
                                // check box may take the press as a posted click;
                                // either way the state read at once is the old one.
                                if (!AwaitClickState(el, patterns, before, SettleMs)) res["state_unconfirmed"] = true;
                                try { res["toggle"] = p.Current.ToggleState.ToString(); } catch { }
                            }
                            return res;
                        }
                    }
                    if (Has(patterns, "SelectionItem"))
                    {
                        tried = "SelectionItem";
                        SelectionItemPattern p = el.GetCurrentPattern(SelectionItemPattern.Pattern) as SelectionItemPattern;
                        if (p != null)
                        {
                            Trace(el, "select", HwndArg(a));
                            SelectionItemPattern sp2 = p;
                            bool done = RunPattern(delegate { sp2.Select(); });
                            if (!done) res["slow_provider"] = true;
                            res["method"] = "selection_pattern";
                            if (done)
                            {
                                if (!AwaitClickState(el, patterns, before, SettleMs)) res["state_unconfirmed"] = true;
                                AddNowState(res, el);
                            }
                            return res;
                        }
                    }
                    if (Has(patterns, "ExpandCollapse"))
                    {
                        tried = "ExpandCollapse";
                        ExpandCollapsePattern p = el.GetCurrentPattern(ExpandCollapsePattern.Pattern) as ExpandCollapsePattern;
                        if (p != null)
                        {
                            ExpandCollapsePattern ep2 = p;
                            bool collapsed = before != null && before.Expand == "Collapsed";
                            bool done = RunPattern(delegate { if (collapsed) ep2.Expand(); else ep2.Collapse(); });
                            res["method"] = "expand_collapse_pattern";
                            if (!done) res["slow_provider"] = true;
                            else
                            {
                                if (!AwaitClickState(el, patterns, before, SettleMs)) res["state_unconfirmed"] = true;
                                try { res["state"] = p.Current.ExpandCollapseState.ToString(); } catch { }
                            }
                            return res;
                        }
                    }
                }
                catch (AxonError) { throw; }
                catch (Exception ex)
                {
                    // Fall through to the physical path, and say why: a real
                    // click the caller did not ask for should never be a mystery.
                    Exception root = ex;
                    if (root is System.Reflection.TargetInvocationException && root.InnerException != null) root = root.InnerException;
                    res["pattern_error"] = (tried ?? "pattern") + " failed: " + root.GetType().Name;
                }
            }

            if (Bool(Get(a, "background"), false))
            {
                object posted = PostedClick(a, el, button, clicks);
                if (posted != null) return posted;
            }

            // Focusing an element in a window that is not in front raises that
            // window, which the user feels, so the gate runs before it does.
            NoteWait(res, GuardDisturb(a));
            try { el.SetFocus(); } catch { }
            Trace(el, "click", HwndArg(a));

            // Get our own banner out of the way before working out where to
            // click, not after: while it covers part of a control, the provider
            // reports a clickable point on whatever sliver is still showing,
            // which lands on the control's edge and can miss it altogether.
            int[] box = RectOf(el);
            bool aside = box != null && Overlay.BeginClickThroughRect(box[0], box[1], box[2], box[3]);
            int[] point;
            try
            {
                point = ClickPointOf(el);
                PhysicalClick(a, point, button, clicks, HwndArg(a), res);
            }
            finally { if (aside) Overlay.EndClickThrough(); }
            if (aside) res["banner_stepped_aside"] = true;
            res["method"] = "physical";
            res["point"] = point;
            System.Threading.Thread.Sleep(60);
            if (!AwaitClickState(el, patterns, before, SettleMs)) res["state_unconfirmed"] = true;
            AddNowState(res, el);
            return res;
        }

        // ---- what a click is expected to change -----------------------------
        //
        // A browser applies a click to the page first and to its accessibility
        // tree a moment later, so a state read straight after the pattern call
        // is the state from before it: on 2026-09-26 four web check boxes were
        // reported "now Off" and were On, and an expand button "now Collapsed"
        // that had expanded. The click path reads the state the click should
        // move, then gives it up to SettleMs to move; if it has not, the result
        // says the state is unconfirmed instead of passing the old one off as new.
        const int SettleMs = 700;

        class ClickState
        {
            public string Toggle;
            public bool? Selected;
            public string Expand;
        }

        static ClickState ReadClickState(AutomationElement el, List<string> patterns)
        {
            ClickState s = new ClickState();
            if (Has(patterns, "Toggle"))
            {
                try
                {
                    TogglePattern tp = el.GetCurrentPattern(TogglePattern.Pattern) as TogglePattern;
                    if (tp != null) s.Toggle = tp.Current.ToggleState.ToString();
                }
                catch { }
            }
            if (Has(patterns, "SelectionItem"))
            {
                try
                {
                    SelectionItemPattern sp = el.GetCurrentPattern(SelectionItemPattern.Pattern) as SelectionItemPattern;
                    if (sp != null) s.Selected = sp.Current.IsSelected;
                }
                catch { }
            }
            if (Has(patterns, "ExpandCollapse"))
            {
                try
                {
                    ExpandCollapsePattern ep = el.GetCurrentPattern(ExpandCollapsePattern.Pattern) as ExpandCollapsePattern;
                    if (ep != null)
                    {
                        // A leaf never expands, whatever is clicked.
                        string e = ep.Current.ExpandCollapseState.ToString();
                        if (e != "LeafNode") s.Expand = e;
                    }
                }
                catch { }
            }
            return s;
        }

        // A toggle always moves when clicked; a selection only when it was not
        // already selected; an expansion flips.
        static bool ExpectsChange(ClickState b)
        {
            return b != null && (b.Toggle != null || b.Selected == false || b.Expand != null);
        }

        static bool MovedFrom(ClickState b, ClickState n)
        {
            if (b.Toggle != null && n.Toggle != null && n.Toggle != b.Toggle) return true;
            if (b.Selected == false && n.Selected == true) return true;
            if (b.Expand != null && n.Expand != null && n.Expand != b.Expand) return true;
            return false;
        }

        // True once the state has moved, or when nothing was expected to move;
        // false when it had not moved after maxMs.
        static bool AwaitClickState(AutomationElement el, List<string> patterns, ClickState before, int maxMs)
        {
            if (!ExpectsChange(before)) return true;
            System.Diagnostics.Stopwatch sw = System.Diagnostics.Stopwatch.StartNew();
            while (true)
            {
                ClickState now = ReadClickState(el, patterns);
                if (MovedFrom(before, now)) return true;
                if (sw.ElapsedMilliseconds >= maxMs) return false;
                System.Threading.Thread.Sleep(40);
            }
        }

        static string DescribeEl(AutomationElement el)
        {
            string role = RoleOf(el);
            string name = CleanText(NameOf(el));
            return name != null ? role + " \"" + (name.Length > 60 ? name.Substring(0, 60) + "..." : name) + "\"" : role;
        }

        static object OpSetValue(Dictionary<string, object> a)
        {
            GuardSameWindow(a, HwndArg(a));
            Target t = ResolveTarget(a);
            if (t.Mode == "point")
                throw new AxonError("bad_target", "set_value needs an element, not a point.", "Use index or selector.");
            AutomationElement el = t.El;
            List<string> patterns = PatternsOf(el);
            string text = Str(Get(a, "text"));
            if (text == null) text = "";

            Dictionary<string, object> res = new Dictionary<string, object>();

            if (Has(patterns, "Value"))
            {
                ValuePattern vp = null;
                try { vp = el.GetCurrentPattern(ValuePattern.Pattern) as ValuePattern; }
                catch { }
                if (vp != null)
                {
                    if (vp.Current.IsReadOnly)
                        throw new AxonError("readonly", "That field is read-only.", null);
                    try
                    {
                        // A contenteditable - a web composer, a rich text box -
                        // can expose the value pattern and then quietly ignore
                        // the setter: no exception, no change. Reporting that as
                        // "set field via value_pattern" is the worst kind of
                        // wrong, because the caller goes on believing the text
                        // is there. So the write is read back and checked.
                        string before = null;
                        try { before = vp.Current.Value; } catch { }
                        Trace(el, "type", HwndArg(a));
                        vp.SetValue(text);
                        // A browser's accessibility tree updates a beat after
                        // the page does, so a read-back straight after the
                        // write can still show the old value. Poll briefly
                        // before concluding the setter was ignored - otherwise
                        // a write that worked is followed by keystrokes into a
                        // window the user may be looking at.
                        string after = null;
                        for (int tries = 0; tries < 12; tries++)
                        {
                            try { after = vp.Current.Value; } catch { }
                            if (after == text || after != before) break;
                            System.Threading.Thread.Sleep(50);
                        }

                        bool exact = after == text;
                        // Some providers normalise what they store - a date, a
                        // phone mask, a trimmed string - so a changed value that
                        // is not character-for-character what we asked for still
                        // counts as taken. Only a value that did not move at all
                        // means the setter was ignored.
                        bool moved = before != null && after != before;
                        if (exact || moved)
                        {
                            res["method"] = "value_pattern";
                            res["value"] = after;
                            if (!exact) res["normalised_by_app"] = true;
                            AddNowState(res, el);
                            return res;
                        }
                        // Ignored. Fall through and type it for real.
                        res["value_pattern_ignored"] = true;
                    }
                    catch { /* fall through to typing */ }
                }
            }

            // The value pattern was unavailable, so this falls back to real
            // keystrokes - which the user can feel.
            NoteWait(res, GuardDisturb(a));
            try { el.SetFocus(); }
            catch
            {
                // "Focus the window first" is the wrong advice here and sends the
                // caller round a loop that cannot work: the window is already in
                // front, and this control refuses the focus itself. Browsers are
                // the common case - the outer "Address bar" is a container that
                // takes neither a value nor the focus, while the "Address field"
                // inside it takes both.
                throw new AxonError("focus_failed",
                    "That control refused both a programmatic value and the keyboard focus, so nothing was typed.",
                    "Do not retry this element or re-focus the window - neither will help. Either target the real editable field inside it "
                    + "(in a browser that is \"Address field\", not \"Address bar\"), or focus the field with its own shortcut - ctrl+l for a browser "
                    + "address bar - and then use computer_type with no target and no replace, which types wherever the keyboard focus actually is.");
            }
            System.Threading.Thread.Sleep(40);
            RequireTypingFocus(el, HwndArg(a));
            Native.KeyDown(0x11); Native.KeyTap(0x41); Native.KeyUp(0x11); // ctrl+a
            System.Threading.Thread.Sleep(20);
            Native.TypeUnicode(text);
            res["method"] = "typed";
            return res;
        }

        static object OpType(Dictionary<string, object> a)
        {
            string text = Str(Get(a, "text"));
            if (text == null) text = "";
            Dictionary<string, object> res = new Dictionary<string, object>();
            GuardSameWindow(a, HwndArg(a));
            if (Get(a, "index") != null || Get(a, "selector") != null)
            {
                Target t = ResolveTarget(a);
                IntPtr want = HwndArg(a);
                {
                    IntPtr top = want != IntPtr.Zero ? want : TopWindowOf(t.El);
                    bool force = Bool(Get(a, "background"), false);
                    string m = ModeOf(a);
                    bool inFront = top != IntPtr.Zero && Native.GetForegroundWindow() == top;
                    if (top != IntPtr.Zero && (force || (!inFront && m != "take" && m != "exclusive")))
                    {
                        string how = TryPostText(t.El, top, text, force);
                        if (how != null)
                        {
                            res["method"] = how;
                            res["typed"] = text.Length;
                            res["background"] = true;
                            AddNowState(res, t.El);
                            return res;
                        }
                        // background:true is a promise that the window is left alone.
                        // Falling through to SetFocus + real keystrokes below would
                        // break that promise silently - the caller asked for the
                        // window not to be raised, and it would be raised anyway.
                        // Refuse instead, the way the macOS host refuses with
                        // background_unavailable rather than typing into whatever
                        // is now in front.
                        if (force)
                        {
                            throw new AxonError("background_unavailable",
                                "That control ignored posted text, and background:true means it must not be focused or raised to type into instead.",
                                "Retry without background, or focus the window yourself first, then use computer_type with no target and no replace.");
                        }
                    }
                }
                // Focusing an element in a window that is not in front raises that
                // window, which the user feels, so it goes through the same gate
                // as any other foreground change.
                if (want != IntPtr.Zero && Native.GetForegroundWindow() != want) NoteWait(res, GuardDisturb(a));
                try { t.El.SetFocus(); } catch { }
                System.Threading.Thread.Sleep(40);
                RequireTypingFocus(t.El, want);
            }
            else
            {
                // No element named, so this types into whatever holds focus.
                RequireForeground(HwndArg(a), a, res);
            }
            bool held = Exclusive(a) && Native.BeginExclusive();
            try { Native.TypeUnicode(text); }
            finally { if (held) Native.EndExclusive(); }
            if (held) res["input_held"] = true;
            res["typed"] = text.Length;
            return res;
        }

        static Dictionary<string, ushort> _vk;

        static ushort VkOf(string token)
        {
            if (_vk == null)
            {
                _vk = new Dictionary<string, ushort>(StringComparer.OrdinalIgnoreCase);
                _vk["enter"] = 0x0D; _vk["return"] = 0x0D; _vk["tab"] = 0x09;
                _vk["esc"] = 0x1B; _vk["escape"] = 0x1B; _vk["space"] = 0x20;
                _vk["backspace"] = 0x08; _vk["back"] = 0x08;
                _vk["delete"] = 0x2E; _vk["del"] = 0x2E; _vk["insert"] = 0x2D;
                _vk["home"] = 0x24; _vk["end"] = 0x23; _vk["pageup"] = 0x21; _vk["pagedown"] = 0x22;
                _vk["up"] = 0x26; _vk["down"] = 0x28; _vk["left"] = 0x25; _vk["right"] = 0x27;
                _vk["ctrl"] = 0x11; _vk["control"] = 0x11; _vk["shift"] = 0x10;
                _vk["alt"] = 0x12; _vk["win"] = 0x5B; _vk["meta"] = 0x5B;
                for (int i = 1; i <= 12; i++) _vk["f" + i.ToString(CultureInfo.InvariantCulture)] = (ushort)(0x70 + i - 1);
            }
            string t = token.Trim();
            ushort v;
            if (_vk.TryGetValue(t, out v)) return v;
            if (t.Length == 1)
            {
                char ch = char.ToUpperInvariant(t[0]);
                if ((ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')) return (ushort)ch;
            }
            throw new AxonError("unknown_key", "Unrecognised key '" + token + "'.",
                "Use names like ctrl+s, alt+f4, enter, tab, f5.");
        }

        static object OpKey(Dictionary<string, object> a)
        {
            string chord = Str(Get(a, "keys"));
            if (string.IsNullOrEmpty(chord))
                throw new AxonError("bad_keys", "Empty key chord.", null);
            string[] rawParts = chord.Split('+');
            List<string> parts = new List<string>();
            foreach (string p in rawParts) if (p.Trim().Length > 0) parts.Add(p.Trim());
            if (parts.Count == 0) throw new AxonError("bad_keys", "Empty key chord.", null);

            List<ushort> mods = new List<ushort>();
            for (int i = 0; i < parts.Count - 1; i++) mods.Add(VkOf(parts[i]));
            ushort main = VkOf(parts[parts.Count - 1]);

            Dictionary<string, object> res = new Dictionary<string, object>();
            GuardSameWindow(a, HwndArg(a));
            RequireForeground(HwndArg(a), a, res);

            foreach (ushort m in mods) { Native.KeyDown(m); System.Threading.Thread.Sleep(8); }
            Native.KeyTap(main);
            System.Threading.Thread.Sleep(8);
            for (int i = mods.Count - 1; i >= 0; i--) Native.KeyUp(mods[i]);

            res["sent"] = chord;
            return res;
        }

        static object OpScroll(Dictionary<string, object> a)
        {
            int amount = Int(Get(a, "amount"), -3);
            bool horizontal = Bool(Get(a, "horizontal"), false);
            Dictionary<string, object> res = new Dictionary<string, object>();
            GuardSameWindow(a, HwndArg(a));

            int[] wheelPoint = null;
            if (Get(a, "index") != null || Get(a, "selector") != null)
            {
                Target t = ResolveTarget(a);
                AutomationElement el = t.El;
                List<string> patterns = PatternsOf(el);
                // Bring this element into view, the way a screen reader does:
                // its container scrolls, and nothing touches the pointer.
                if (Bool(Get(a, "into_view"), false))
                {
                    ScrollItemPattern sip = null;
                    if (Has(patterns, "ScrollItem"))
                    {
                        try { sip = el.GetCurrentPattern(ScrollItemPattern.Pattern) as ScrollItemPattern; } catch { }
                    }
                    if (sip == null)
                        throw new AxonError("no_scroll_item", DescribeEl(el) + " cannot scroll itself into view (it has no ScrollItem pattern).",
                            "Scroll its container by amount instead.");
                    ScrollItemPattern sip2 = sip;
                    if (!RunPattern(delegate { sip2.ScrollIntoView(); })) res["slow_provider"] = true;
                    res["method"] = "scroll_into_view";
                    return res;
                }
                if (Has(patterns, "Scroll"))
                {
                    try
                    {
                        ScrollPattern p = el.GetCurrentPattern(ScrollPattern.Pattern) as ScrollPattern;
                        if (p != null)
                        {
                            ScrollBy(p, amount, horizontal);
                            res["method"] = "scroll_pattern";
                            return res;
                        }
                    }
                    catch { }
                }
                // Most controls cannot scroll; the list, pane or page they sit
                // in can, through its own pattern, with no pointer and no
                // foreground. The mouse wheel is only for when nothing can: it
                // needs the cursor, and so it waits for, or refuses on, a user
                // who is moving the mouse.
                {
                    string how;
                    AutomationElement box = ScrollableAncestor(el, amount, horizontal, out how);
                    if (box != null)
                    {
                        res["method"] = "scroll_pattern";
                        res["container"] = how;
                        return res;
                    }
                }
                // No clickable point means no place to scroll: sending the wheel
                // anyway would scroll whatever sits under the user's pointer.
                wheelPoint = ClickPointOf(el);
            }
            else
            {
                object pt = Get(a, "point");
                object[] arr = pt as object[];
                if (arr != null && arr.Length >= 2) wheelPoint = new int[] { Int(arr[0], 0), Int(arr[1], 0) };
            }
            if (wheelPoint == null)
                throw new AxonError("no_target", "Scroll needs an element (index or selector) or a point.",
                    "A wheel event lands wherever the pointer is, so a target is required.");

            // The wheel goes to the window under the point. If that is not the
            // target window, the user's own window would scroll instead.
            {
                IntPtr top = HwndArg(a);
                if (top != IntPtr.Zero)
                {
                    IntPtr under = Native.RootWindowAt(wheelPoint[0], wheelPoint[1]);
                    IntPtr topRoot = Native.GetAncestor(top, 2 /* GA_ROOT */);
                    if (topRoot == IntPtr.Zero) topRoot = top;
                    if (under != IntPtr.Zero && under != topRoot && !Overlay.IsAnyOverlayWindow(under))
                    {
                        string m = ModeOf(a);
                        if (m != "take" && m != "exclusive")
                            throw new AxonError("obscured", "That spot is covered by another window, so a wheel event there would scroll the wrong window.",
                                "Use the element's Scroll pattern if it has one, computer_focus the window first, or pass mode:\"take\".");
                        NoteWait(res, GuardDisturb(a));
                        Native.ForceForeground(top);
                        System.Threading.Thread.Sleep(120);
                    }
                }
            }

            // The gate comes before the pointer moves. Moving it first and asking
            // afterwards means a yield-mode refusal has already yanked the user's
            // cursor onto the target and left it there.
            NoteWait(res, GuardDisturb(a));

            // Where the pointer is NOW - after any wait for the user to pause.
            // Reading it before the wait would restore it to where their cursor
            // was seconds ago, which moves it for them rather than putting it back.
            Native.POINT scrollSaved;
            bool scrollHaveSaved = Native.GetCursorPos(out scrollSaved);

            bool held = Exclusive(a) && Native.BeginExclusive();
            try
            {
                Native.SetCursorPos(wheelPoint[0], wheelPoint[1]);
                System.Threading.Thread.Sleep(16);
                Native.MouseWheel(amount * 120, horizontal);
            }
            finally { if (held) Native.EndExclusive(); }
            if (held) res["input_held"] = true;
            res["method"] = "wheel";
            res["delta"] = amount * 120;
            // Put the pointer back where the user left it, the same courtesy the
            // click path gives. The settle lets the queued wheel dispatch at the
            // target before the cursor moves off it.
            if (scrollHaveSaved)
            {
                System.Threading.Thread.Sleep(12);
                Native.SetCursorPos(scrollSaved.X, scrollSaved.Y);
                res["cursor_restored"] = true;
            }
            return res;
        }

        // One scroll step through the pattern: a page for |amount| of 3 or
        // more, a line below that; negative is down (or right).
        static void ScrollBy(ScrollPattern p, int amount, bool horizontal)
        {
            bool big = Math.Abs(amount) >= 3;
            ScrollAmount unit;
            if (amount < 0) unit = big ? ScrollAmount.LargeIncrement : ScrollAmount.SmallIncrement;
            else unit = big ? ScrollAmount.LargeDecrement : ScrollAmount.SmallDecrement;
            if (horizontal) p.Scroll(unit, ScrollAmount.NoAmount);
            else p.Scroll(ScrollAmount.NoAmount, unit);
        }

        // The nearest ancestor that can scroll in that direction, scrolled.
        // Returns it (with a description in how), or null when none could.
        static AutomationElement ScrollableAncestor(AutomationElement el, int amount, bool horizontal, out string how)
        {
            how = null;
            try
            {
                TreeWalker w = TreeWalker.ControlViewWalker;
                AutomationElement cur = w.GetParent(el);
                for (int i = 0; i < 40 && cur != null; i++)
                {
                    bool can = false;
                    try { can = (bool)cur.GetCurrentPropertyValue(AutomationElement.IsScrollPatternAvailableProperty); } catch { }
                    if (can)
                    {
                        try
                        {
                            ScrollPattern p = cur.GetCurrentPattern(ScrollPattern.Pattern) as ScrollPattern;
                            if (p != null && (horizontal ? p.Current.HorizontallyScrollable : p.Current.VerticallyScrollable))
                            {
                                ScrollBy(p, amount, horizontal);
                                how = DescribeEl(cur);
                                return cur;
                            }
                        }
                        catch { }
                    }
                    // The window itself is as far as a page's scroll container goes.
                    int h = 0;
                    try { h = cur.Current.NativeWindowHandle; } catch { }
                    if (h != 0 && Native.GetAncestor(new IntPtr(h), 2 /* GA_ROOT */) == new IntPtr(h)) break;
                    cur = w.GetParent(cur);
                }
            }
            catch { }
            return null;
        }

        static object OpFocus(Dictionary<string, object> a)
        {
            AutomationElement win = RequireWindow(a);
            IntPtr h;
            string title;
            try
            {
                h = new IntPtr(win.Current.NativeWindowHandle);
                title = win.Current.Name;
            }
            catch { throw new AxonError("window_gone", "The window disappeared while resolving it.", null); }

            Dictionary<string, object> res = new Dictionary<string, object>();
            NoteWait(res, GuardDisturb(a));
            bool ok = Native.ForceForeground(h);
            System.Threading.Thread.Sleep(120);

            res["focused"] = ok;
            res["hwnd"] = (long)h;
            res["title"] = title;
            return res;
        }

        static object OpCloseWindow(Dictionary<string, object> a)
        {
            GuardStopped();
            Overlay.MarkActive();
            AutomationElement win = RequireWindow(a);
            IntPtr h;
            string title;
            try
            {
                h = new IntPtr(win.Current.NativeWindowHandle);
                title = win.Current.Name;
            }
            catch { throw new AxonError("window_gone", "The window disappeared while resolving it.", null); }
            GuardSameWindow(a, h);

            // WM_CLOSE to one specific window. Computer Use has no process-termination
            // op at all: closing a window lets the app run its own save prompts,
            // where killing a process discards unsaved work without asking.
            // Posted, not sent: a window whose thread is busy - or a packaged
            // app behind its frame host - must not hold this host hostage.
            Native.PostMessageW(h, 0x0010, IntPtr.Zero, IntPtr.Zero);
            // Up to three seconds, returning the moment the window is gone. The
            // old ceiling was 800 ms, and a browser closing its last window on
            // another virtual desktop took longer than that: the reply said the
            // app was "probably asking whether to save" while the window was
            // already closing, and the next listing showed it gone.
            for (int i = 0; i < 30 && Native.IsWindow(h); i++) System.Threading.Thread.Sleep(100);

            Dictionary<string, object> res = new Dictionary<string, object>();
            res["closed"] = title;
            res["still_open"] = Native.IsWindow(h);
            return res;
        }

        static object OpWaitFor(Dictionary<string, object> a)
        {
            int timeout = Int(Get(a, "timeout_ms"), 5000);
            DateTime deadline = DateTime.UtcNow.AddMilliseconds(timeout);
            DateTime started = DateTime.UtcNow;

            while (DateTime.UtcNow < deadline)
            {
                // A Stop press or Escape ends the wait now, not at the timeout.
                GuardStopped();
                try
                {
                    AutomationElement found = FindBySelector(a);
                    if (found != null)
                    {
                        Dictionary<string, object> res = new Dictionary<string, object>();
                        res["found"] = true;
                        res["role"] = RoleOf(found);
                        res["name"] = NameOf(found);
                        res["rect"] = RectOf(found);
                        res["waited_ms"] = (long)(DateTime.UtcNow - started).TotalMilliseconds;
                        return res;
                    }
                }
                catch (AxonError ax)
                {
                    // A malformed selector or a vanished window is a real error;
                    // only "not there yet" is worth retrying.
                    if (ax.Code != "element_not_found") throw;
                }
                System.Threading.Thread.Sleep(200);
            }
            throw new AxonError("wait_timeout", "Element did not appear within " + timeout + "ms.",
                "Take a snapshot to see the current state of the window.");
        }

        static object OpScreenshot(Dictionary<string, object> a)
        {
            int maxWidth = Int(Get(a, "max_width"), 1200);
            int quality = Int(Get(a, "quality"), 60);
            if (quality < 20) quality = 20;
            if (quality > 95) quality = 95;

            Rectangle region = Rectangle.Empty;
            bool wantedWindow = Get(a, "hwnd") != null || Get(a, "title") != null;
            IntPtr captureHwnd = IntPtr.Zero;
            Native.RECT captureRect = new Native.RECT();

            if (wantedWindow)
            {
                AutomationElement win = RequireWindow(a);
                IntPtr h = new IntPtr(win.Current.NativeWindowHandle);
                if (Native.IsIconic(h))
                    throw new AxonError("window_minimized", "That window is minimized; there is nothing to capture.",
                        "Call focus on it first.");
                Native.RECT rr;
                if (!Native.GetWindowRect(h, out rr))
                    throw new AxonError("window_rect_failed", "Could not read that window's bounds.",
                        "The window may be closing. Re-list windows and try again.");
                captureHwnd = h;
                captureRect = rr;
                region = new Rectangle(rr.Left, rr.Top, rr.Right - rr.Left, rr.Bottom - rr.Top);
                // Falling back to a full-screen grab here would quietly hand back
                // something the caller never asked for, so it is an error instead.
                if (region.Width <= 0 || region.Height <= 0)
                    throw new AxonError("window_rect_failed", "That window reports a zero-size rectangle.",
                        "It may be minimized or mid-close.");
            }
            else
            {
                Rectangle vs = SystemInformation.VirtualScreen;
                region = new Rectangle(vs.X, vs.Y, vs.Width, vs.Height);
            }
            if (region.Width <= 0 || region.Height <= 0)
                throw new AxonError("bad_region", "Capture region has no area.", null);

            byte[] bytes;
            int nw, nh;
            string capture = "screen";
            // 24-bit on purpose: PrintWindow leaves alpha at zero, and a 32-bit
            // surface would then scale down to black.
            using (Bitmap full = new Bitmap(region.Width, region.Height, PixelFormat.Format24bppRgb))
            {
                bool printed = false;
                if (wantedWindow && captureHwnd != IntPtr.Zero && !Native.IsUnobscured(captureHwnd, captureRect))
                {
                    // Something lies over part of the window, so a screen grab
                    // would photograph the cover. PrintWindow asks the window to
                    // render itself; PW_RENDERFULLCONTENT reaches DirectComposition
                    // surfaces (browsers, WinUI) too. That is what Codex gets from
                    // Windows.Graphics.Capture: a picture of the window behind
                    // whatever is in front of it. Some apps draw nothing that way;
                    // a blank result falls back to the screen grab and says so.
                    try
                    {
                        using (Graphics g = Graphics.FromImage(full))
                        {
                            IntPtr hdc = g.GetHdc();
                            try { printed = Native.PrintWindow(captureHwnd, hdc, 0x00000002 /* PW_RENDERFULLCONTENT */); }
                            finally { g.ReleaseHdc(hdc); }
                        }
                        if (printed && IsBlank(full)) printed = false;
                    }
                    catch { printed = false; }
                    capture = printed ? "window" : "screen_occluded";
                }
                if (!printed)
                {
                    using (Graphics g = Graphics.FromImage(full))
                        g.CopyFromScreen(region.Location, Point.Empty, region.Size);
                }

                double scale = Math.Min(1.0, maxWidth / (double)region.Width);
                nw = Math.Max(1, (int)(region.Width * scale));
                nh = Math.Max(1, (int)(region.Height * scale));

                using (Bitmap small = new Bitmap(nw, nh))
                {
                    using (Graphics g2 = Graphics.FromImage(small))
                    {
                        g2.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                        g2.DrawImage(full, 0, 0, nw, nh);
                    }
                    ImageCodecInfo enc = null;
                    foreach (ImageCodecInfo c in ImageCodecInfo.GetImageEncoders())
                        if (c.MimeType == "image/jpeg") { enc = c; break; }

                    using (MemoryStream ms = new MemoryStream())
                    {
                        if (enc != null)
                        {
                            EncoderParameters ep = new EncoderParameters(1);
                            ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, (long)quality);
                            small.Save(ms, enc, ep);
                        }
                        else
                        {
                            small.Save(ms, ImageFormat.Jpeg);
                        }
                        bytes = ms.ToArray();
                    }
                }
            }

            Dictionary<string, object> res = new Dictionary<string, object>();
            res["mime"] = "image/jpeg";
            res["width"] = nw;
            res["height"] = nh;
            res["source"] = new int[] { region.X, region.Y, region.Width, region.Height };
            res["bytes"] = bytes.Length;
            res["capture"] = capture;
            res["data"] = Convert.ToBase64String(bytes);
            return res;
        }

        // A window that rendered itself as one flat colour drew nothing: some
        // GPU-composited apps answer PrintWindow with a blank surface.
        static bool IsBlank(Bitmap b)
        {
            int w = b.Width, h = b.Height;
            if (w < 2 || h < 2) return true;
            int first = b.GetPixel(w / 2, h / 2).ToArgb();
            int stepX = Math.Max(1, w / 12), stepY = Math.Max(1, h / 12);
            for (int y = 0; y < h; y += stepY)
                for (int x = 0; x < w; x += stepX)
                    if (b.GetPixel(x, y).ToArgb() != first) return false;
            return true;
        }

        // Menus, dropdown lists and popups are top-level windows with no title,
        // which the passes above skip as furniture. They are how an app asks a
        // question, though, and Codex reads them as "related transient UI".
        static bool IsPopupClass(string cls)
        {
            return cls == "#32768" || cls == "Xaml_WindowedPopupClass" || cls == "ComboLBox" || cls == "Chrome_WidgetWin_2";
        }

        // The clipboard is a COM object that wants a single-threaded apartment,
        // which the host's main thread is not, so each access runs on its own
        // STA thread with a short deadline - another app can hold the clipboard
        // open and that must not wedge the host.
        static object OpClipboard(Dictionary<string, object> a)
        {
            string set = Get(a, "text") == null ? null : Str(Get(a, "text"));
            string got = null;
            Exception failure = null;
            System.Threading.Thread t = new System.Threading.Thread(delegate()
            {
                try
                {
                    if (set != null)
                    {
                        if (set.Length == 0) Clipboard.Clear();
                        else Clipboard.SetText(set);
                    }
                    else if (Clipboard.ContainsText()) got = Clipboard.GetText();
                }
                catch (Exception ex) { failure = ex; }
            });
            t.SetApartmentState(System.Threading.ApartmentState.STA);
            t.Start();
            if (!t.Join(3000))
                throw new AxonError("clipboard_busy", "The clipboard did not respond within 3s.",
                    "Another application is holding it open. Retry in a moment.");
            if (failure != null)
                throw new AxonError("clipboard_error", failure.Message, null);
            Dictionary<string, object> res = new Dictionary<string, object>();
            if (set != null) { res["set"] = true; res["length"] = set.Length; }
            else { res["has_text"] = got != null; if (got != null) res["text"] = got; }
            return res;
        }

        // Runs one clipboard access on its own STA thread and waits for it - the
        // clipboard is COM underneath and only usable from an STA thread, which
        // this host's message loop is not. OpPaste's save and restore both go
        // through here so a paste fails the same "another app is holding it
        // open" way a plain clipboard read or write already does.
        static void ClipboardSTA(System.Threading.ThreadStart body)
        {
            Exception failure = null;
            System.Threading.Thread t = new System.Threading.Thread(delegate()
            {
                try { body(); }
                catch (Exception ex) { failure = ex; }
            });
            t.SetApartmentState(System.Threading.ApartmentState.STA);
            // A thread wedged on a clipboard some other app is holding must not
            // keep this host alive after we have given up waiting for it.
            t.IsBackground = true;
            t.Start();
            if (!t.Join(3000))
                throw new AxonError("clipboard_busy", "The clipboard did not respond within 3s.",
                    "Another application is holding it open. Retry in a moment.");
            if (failure != null) throw new AxonError("clipboard_error", failure.Message, null);
        }

        // Everything on the clipboard, not just its text. Saving Clipboard.GetText()
        // and restoring with SetText is the shape of this that looks right and
        // silently destroys data: a user whose clipboard held a copied image, a
        // file they were about to drop into a folder, or formatted spreadsheet
        // cells would get back an empty clipboard and no warning. So every native
        // format is copied out here and put back verbatim.
        //
        // The copy has to happen before our own text goes on, and it has to be a
        // copy: the IDataObject the clipboard hands out is a live view of it, not
        // a snapshot, so reading through it after the clipboard changes returns
        // the new contents. `lost` counts formats the source would not hand over,
        // so the caller can be told a restore was partial rather than told it
        // worked.
        //
        // What comes out here never leaves the host: OpPaste reports counts and
        // nothing else. That matters because a clipboard can hold a password a
        // manager just put there, and the private formats those managers set
        // ride along in the copy and go back untouched, so the paste does not
        // strip the marker that keeps it out of clipboard history.
        static DataObject SaveClipboard(out int kept, out int lost)
        {
            int nKept = 0, nLost = 0;
            DataObject copy = new DataObject();
            ClipboardSTA(delegate()
            {
                IDataObject src = Clipboard.GetDataObject();
                if (src == null) return;
                string[] formats;
                // autoConvert false: the native formats only. Asking for the
                // converted ones as well would save several spellings of the same
                // data and put back more than was there.
                try { formats = src.GetFormats(false); }
                catch { formats = new string[0]; }
                foreach (string f in formats)
                {
                    try
                    {
                        object data = src.GetData(f, false);
                        if (data == null) { nLost++; continue; }
                        copy.SetData(f, false, data);
                        nKept++;
                    }
                    catch { nLost++; }
                }
            });
            kept = nKept;
            lost = nLost;
            return copy;
        }

        static void RestoreClipboard(DataObject saved, int kept)
        {
            ClipboardSTA(delegate()
            {
                // Nothing was there to begin with, so an empty clipboard is the
                // faithful restore.
                if (kept == 0) Clipboard.Clear();
                // copy:true flushes the data to the OLE clipboard, so what the
                // user copied outlives this host process the way it did before.
                else Clipboard.SetDataObject(saved, true);
            });
        }


        // Files on the clipboard, then Ctrl+V - what a person does to attach a
        // document to a mail, a chat or a Word page (a browser upload box on its own is
        // UNVERIFIED), and the
        // paste a text clipboard cannot do. CF_HDROP is what Explorer's own Ctrl+C
        // puts there, so any app that accepts a file pasted from Explorer accepts
        // this. Same save-and-restore as the text paste.
        static object OpPasteFiles(Dictionary<string, object> a)
        {
            List<string> files = new List<string>();
            object raw = Get(a, "files");
            System.Collections.IList list = raw as System.Collections.IList;
            if (list != null) { foreach (object o in list) { string s = Str(o); if (!string.IsNullOrEmpty(s)) files.Add(s); } }
            else { string one = Str(raw); if (!string.IsNullOrEmpty(one)) files.Add(one); }
            if (files.Count == 0) throw new AxonError("bad_files", "paste_files needs files: one path or a list.", null);
            System.Collections.Specialized.StringCollection drop = new System.Collections.Specialized.StringCollection();
            List<string> full = new List<string>();
            foreach (string f in files)
            {
                string p = Path.GetFullPath(f);
                if (!File.Exists(p) && !Directory.Exists(p))
                    throw new AxonError("not_found", "No file or folder at " + p + ".", "Check the path; this pastes real files only.");
                drop.Add(p);
                full.Add(p);
            }
            Dictionary<string, object> res = new Dictionary<string, object>();
            PasteCore(a, res, delegate() { Clipboard.SetFileDropList(drop); });
            res["pasted_files"] = full.ToArray();
            return res;
        }

        // Extensions the shell would execute rather than open in a viewer. open
        // is for documents and folders; an application goes through launch, which
        // has its own checks.
        static readonly HashSet<string> BlockedOpenExt = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
            ".exe", ".com", ".bat", ".cmd", ".ps1", ".psm1", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh",
            ".msi", ".msp", ".scr", ".pif", ".lnk", ".url", ".reg", ".hta", ".cpl", ".jar", ".appx", ".msix", ".inf", ".scf",
            ".rdp", ".kdbx", ".py", ".pyw", ".msc", ".settingcontent-ms", ".xll", ".chm", ".pfx", ".p12", ".iso", ".img", ".vhd", ".vhdx",
            ".application", ".gadget", ".ws", ".sct", ".diagcab", ".theme", ".deskthemepack", ".library-ms", ".search-ms", ".website", ".webloc", ".ps1xml", ".psd1", ".mst", ".msh" };

        // The executable the shell would run for this extension's "open" verb,
        // or null when Windows will not name one. A packaged (Store) app's
        // association answers ERROR_NO_ASSOCIATION to this query even though a
        // double-click opens the file (measured on Windows 11: .png, .jpg, .mp4),
        // so null means "unknown", not "nothing". An unregistered extension
        // resolves to OpenWith.exe, the chooser, which is what would run.
        const uint ASSOCF_NOTRUNCATE = 0x20;
        const uint ASSOCF_REMAPRUNDLL = 0x80;
        const int ASSOCSTR_COMMAND = 1;
        const int ASSOCSTR_EXECUTABLE = 2;

        static string AssociatedExe(string ext)
        {
            if (string.IsNullOrEmpty(ext)) return null;
            string exe = AssocString(ASSOCSTR_EXECUTABLE, ext);
            if (exe != null) return exe;
            // The executable query fails when the command's program is missing
            // from disk (a stale association); the command itself still says
            // what the shell would try to run, and that is what gets judged.
            string cmd = AssocString(ASSOCSTR_COMMAND, ext);
            if (cmd == null) return null;
            cmd = cmd.TrimStart();
            if (cmd.StartsWith("\""))
            {
                int q = cmd.IndexOf('"', 1);
                return q > 1 ? cmd.Substring(1, q - 1) : null;
            }
            int sp = cmd.IndexOf(' ');
            return sp > 0 ? cmd.Substring(0, sp) : cmd;
        }

        static string AssocString(int which, string ext)
        {
            try
            {
                System.Text.StringBuilder sb = new System.Text.StringBuilder(2048);
                uint len = (uint)sb.Capacity;
                int hr = Native.AssocQueryStringW(ASSOCF_NOTRUNCATE | ASSOCF_REMAPRUNDLL, which, ext, "open", sb, ref len);
                if (hr != 0) return null;
                string s = sb.ToString().Trim();
                return s.Length == 0 ? null : s;
            }
            catch { return null; }
        }

        // A document or folder in whatever the user's machine opens it with:
        // ShellExecute "open", the same thing a double-click in Explorer does.
        // probe:true stops after the checks and the association lookup, so the
        // server can judge the handler's tier before anything runs.
        static object OpOpen(Dictionary<string, object> a)
        {
            string path = Str(Get(a, "path"));
            if (string.IsNullOrEmpty(path)) throw new AxonError("bad_path", "open needs path.", null);
            string full;
            try { full = Path.GetFullPath(path); }
            catch (Exception ex) { throw new AxonError("bad_path", "Not a usable path: " + ex.Message, null); }
            bool folder = Directory.Exists(full);
            if (!folder && !File.Exists(full))
                throw new AxonError("not_found", "No file or folder at " + full + ".", "Check the path.");
            string ext = folder ? "" : Path.GetExtension(full);
            if (!folder && BlockedOpenExt.Contains(ext))
                throw new AxonError("open_blocked", "'" + ext + "' files run code; open is for documents and folders.",
                    "Use computer_launch for an application.");
            Dictionary<string, object> res = new Dictionary<string, object>();
            string app = folder ? null : AssociatedExe(ext);
            res["path"] = full;
            res["kind"] = folder ? "folder" : "file";
            res["app"] = app;
            if (Bool(Get(a, "probe"), false)) return res;
            int pid = 0;
            try
            {
                System.Diagnostics.ProcessStartInfo psi = new System.Diagnostics.ProcessStartInfo(full);
                psi.UseShellExecute = true;
                psi.Verb = "open";
                using (System.Diagnostics.Process p = System.Diagnostics.Process.Start(psi))
                {
                    if (p != null) { try { pid = p.Id; } catch { } }
                }
            }
            catch (System.ComponentModel.Win32Exception ex)
            {
                if (ex.NativeErrorCode == 1155 /* ERROR_NO_ASSOCIATION */)
                    throw new AxonError("no_association", "Nothing on this machine is set to open '" + ext + "' files.",
                        "Open it from inside an application instead: computer_launch the app, File > Open, then computer_file_dialog with the path.");
                throw new AxonError("open_failed", ex.Message, null);
            }
            res["pid"] = pid;
            return res;
        }

        // The Windows common Open/Save dialog, driven by its own automation ids:
        // 1148 is the "File name:" box and 1 is the Open/Save button, in every app
        // that uses the shell dialog (Notepad, Chrome, Edge, Outlook, VS Code's
        // native picker, Paint, Explorer). Typing a full path there and confirming
        // is what a person does when the folder tree is too slow to click through.
        // The Office and Adobe custom dialogs are not this dialog; they are driven
        // like any other window, by snapshot.
        static object OpFileDialog(Dictionary<string, object> a)
        {
            string path = Str(Get(a, "path"));
            if (string.IsNullOrEmpty(path)) throw new AxonError("bad_path", "file_dialog needs path.", null);
            string full;
            try { full = Path.GetFullPath(path); }
            catch (Exception ex) { throw new AxonError("bad_path", "Not a usable path: " + ex.Message, null); }
            bool save = string.Equals(Str(Get(a, "action")), "save", StringComparison.OrdinalIgnoreCase);
            if (!save && !File.Exists(full) && !Directory.Exists(full))
                throw new AxonError("not_found", "No file or folder at " + full + ".",
                    "Check the path, or pass action: \"save\" to name a file that does not exist yet.");
            IntPtr owner = HwndArg(a);
            AutomationElement dlg = FindFileDialog(owner);
            if (dlg == null)
                throw new AxonError("no_file_dialog", "No Open or Save dialog is showing" + (owner != IntPtr.Zero ? " for that window" : "") + ".",
                    "Open one first (Ctrl+O, Ctrl+S, an Upload or Browse button), then call again. If the app uses its own picker, snapshot it and drive it with click and type.");
            Dictionary<string, object> res = new Dictionary<string, object>();
            string title = null;
            try { title = dlg.Current.Name; } catch { }
            IntPtr dlgHwnd = IntPtr.Zero;
            try { dlgHwnd = new IntPtr(dlg.Current.NativeWindowHandle); } catch { }
            // probe:true reports the dialog and the label on its confirm button
            // without touching anything, so the server can run that label through
            // the consequence gate before the button is pressed by id: a picker
            // whose Open button reads "Upload" or "Send" is a point of no return.
            AutomationElement okButton = DialogOkButton(dlg);
            string okLabel = null;
            try { if (okButton != null) okLabel = CleanText(okButton.Current.Name); } catch { }
            if (Bool(Get(a, "probe"), false))
            {
                res["dialog"] = title;
                res["button"] = okLabel;
                return res;
            }
            GuardSameWindow(a, dlgHwnd);
            RequireForeground(dlgHwnd, a, res);

            AutomationElement box = FindFileNameBox(dlg);
            if (box == null)
                throw new AxonError("no_filename_box", "The dialog has no File name box - no automation id 1148, and no writable field named for the file name - so it is not a Windows file picker this can drive.",
                    "Snapshot it and drive it with click and type.");
            // A value write that is accepted and then ignored is the common failure
            // of this dialog, so every write is read back before it is believed.
            bool set = false;
            string method = null;
            object vp;
            AutomationElement edit = box.FindFirst(TreeScope.Descendants,
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit));
            foreach (AutomationElement target in new AutomationElement[] { box, edit })
            {
                if (target == null || set) continue;
                if (!target.TryGetCurrentPattern(ValuePattern.Pattern, out vp)) continue;
                try
                {
                    ((ValuePattern)vp).SetValue(full);
                    System.Threading.Thread.Sleep(40);
                    string back = null;
                    try { back = ((ValuePattern)target.GetCurrentPattern(ValuePattern.Pattern)).Current.Value; } catch { }
                    if (back != null && string.Equals(back.Trim().Trim('"'), full, StringComparison.OrdinalIgnoreCase)) { set = true; method = target == box ? "value" : "value (edit)"; }
                }
                catch { }
            }
            if (!set)
            {
                // No control took a value write: focus the box, prove the focus
                // moved, select what is there and type the path as a person would.
                try { (edit ?? box).SetFocus(); } catch { }
                System.Threading.Thread.Sleep(40);
                bool focused = false;
                // The focused element is the box itself, or a child of it, so
                // the walk up is compared against the box that was actually
                // found rather than against the id 1148 alone - a dialog whose
                // box carries another id would otherwise be typed into and then
                // reported as a focus failure.
                int[] boxId = null;
                int[] editId = null;
                try { boxId = box.GetRuntimeId(); } catch { }
                try { if (edit != null) editId = edit.GetRuntimeId(); } catch { }
                try
                {
                    AutomationElement walk = AutomationElement.FocusedElement;
                    for (int i = 0; walk != null && i < 6 && !focused; i++)
                    {
                        string aid = null;
                        int[] rid = null;
                        try { aid = walk.Current.AutomationId; } catch { }
                        try { rid = walk.GetRuntimeId(); } catch { }
                        if (aid == "1148" || SameRuntimeId(rid, boxId) || SameRuntimeId(rid, editId)) focused = true;
                        else walk = TreeWalker.ControlViewWalker.GetParent(walk);
                    }
                }
                catch { }
                if (!focused)
                    throw new AxonError("focus_failed", "The File name box did not take the focus, so nothing was typed into it.",
                        "Snapshot the dialog and click the File name box, then call again.");
                Native.KeyDown(VkOf("ctrl"));
                Native.KeyTap(VkOf("a"));
                Native.KeyUp(VkOf("ctrl"));
                Native.TypeUnicode(full);
                set = true;
                method = "typed";
            }
            System.Threading.Thread.Sleep(60);
            // Confirm with the dialog's own button so a relabelled "Upload" or
            // "Select Folder" is still the right one; Enter in the box is the fallback.
            AutomationElement ok = okButton;
            bool invoked = false;
            object ip;
            if (ok != null && ok.TryGetCurrentPattern(InvokePattern.Pattern, out ip))
            {
                try { ((InvokePattern)ip).Invoke(); invoked = true; } catch { }
            }
            if (!invoked)
            {
                try { box.SetFocus(); } catch { }
                System.Threading.Thread.Sleep(20);
                Native.KeyTap(VkOf("enter"));
            }
            bool closed = false;
            for (int waited = 0; waited < 3000; waited += 50)
            {
                System.Threading.Thread.Sleep(50);
                if (dlgHwnd == IntPtr.Zero || !Native.IsWindow(dlgHwnd) || !Native.IsWindowVisible(dlgHwnd)) { closed = true; break; }
            }
            res["dialog"] = title;
            res["path"] = full;
            res["closed"] = closed;
            res["button"] = okLabel;
            res["method"] = (invoked ? "button \"" + (okLabel ?? "") + "\"" : "enter") + ", path by " + method;
            if (!closed)
            {
                // A dialog that stayed open is usually asking something in a box
                // of its own (Replace? Not found?). Its words are what the caller
                // needs, not a guess.
                try
                {
                    AutomationElementCollection boxes = AutomationElement.RootElement.FindAll(TreeScope.Children,
                        new PropertyCondition(AutomationElement.ClassNameProperty, "#32770"));
                    foreach (AutomationElement b in boxes)
                    {
                        IntPtr bh = IntPtr.Zero;
                        try { bh = new IntPtr(b.Current.NativeWindowHandle); } catch { continue; }
                        if (bh == IntPtr.Zero || bh == dlgHwnd || !Native.IsWindowVisible(bh)) continue;
                        if (Native.GetWindowRel(bh, 4 /* GW_OWNER */) != dlgHwnd) continue;
                        string asking = null;
                        try { asking = b.Current.Name; } catch { }
                        AutomationElement text = b.FindFirst(TreeScope.Descendants,
                            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Text));
                        string body = null;
                        try { if (text != null) body = text.Current.Name; } catch { }
                        res["asking"] = (asking ?? "") + (body != null ? ": " + body : "");
                        res["asking_hwnd"] = Hwnd(bh);
                        break;
                    }
                }
                catch { }
            }
            return res;
        }

        // The dialog's own confirm button: automation id 1 (IDOK), whatever the
        // app has relabelled it - Open, Save, Upload, Select Folder.
        static AutomationElement DialogOkButton(AutomationElement dlg)
        {
            try
            {
                return dlg.FindFirst(TreeScope.Children,
                    new AndCondition(new PropertyCondition(AutomationElement.AutomationIdProperty, "1"),
                                     new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button)));
            }
            catch { return null; }
        }

        // The visible common file dialog (window class #32770 with a File name box)
        // owned by the given window - directly, or through the hidden owner some
        // apps park between themselves and their dialogs - or any one when no
        // owner is given.
        // The File name box is automation id 1148 in the Windows common dialog,
        // and that id is what every published recipe keys on. It is not a
        // contract: the id is the old Win32 control id carried forward, and a
        // host that hands UI Automation a different tree - a packaged app, a
        // localised or reskinned picker, a dialog whose box sits under a sink
        // element of its own - shows a box with another id or none. Keying on
        // 1148 alone turned those into "this is not the Windows common dialog"
        // while the box sat there in plain sight, so the id is tried first and
        // then the box is recognised by what it is: an editable field that
        // takes a value.
        // A UI Automation runtime id is an int array and is only meaningful
        // compared element to element, which is exactly what the focus proof
        // needs: is the thing holding the keyboard the box we found.
        static bool SameRuntimeId(int[] a, int[] b)
        {
            if (a == null || b == null || a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
            return true;
        }

        static AutomationElement FindFileNameBox(AutomationElement dialog)
        {
            if (dialog == null) return null;
            AutomationElement box = null;
            try
            {
                box = dialog.FindFirst(TreeScope.Descendants,
                    new PropertyCondition(AutomationElement.AutomationIdProperty, "1148"));
            }
            catch { }
            if (box != null) return box;
            foreach (ControlType type in new ControlType[] { ControlType.ComboBox, ControlType.Edit })
            {
                AutomationElementCollection found = null;
                try
                {
                    found = dialog.FindAll(TreeScope.Descendants,
                        new PropertyCondition(AutomationElement.ControlTypeProperty, type));
                }
                catch { continue; }
                if (found == null) continue;
                // Named for the file name first - the shape the classic dialog
                // uses - and only then any writable field.
                foreach (AutomationElement e in found)
                {
                    string name = null;
                    bool enabled = true;
                    try { name = e.Current.Name; } catch { }
                    try { enabled = e.Current.IsEnabled; } catch { }
                    if (!enabled || name == null) continue;
                    if (name.IndexOf("file name", StringComparison.OrdinalIgnoreCase) >= 0) return e;
                }
                foreach (AutomationElement e in found)
                {
                    bool enabled = true;
                    try { enabled = e.Current.IsEnabled; } catch { }
                    if (!enabled) continue;
                    object pattern;
                    if (e.TryGetCurrentPattern(ValuePattern.Pattern, out pattern))
                    {
                        try { if (((ValuePattern)pattern).Current.IsReadOnly) continue; } catch { }
                        return e;
                    }
                }
            }
            return null;
        }

        static AutomationElement FindFileDialog(IntPtr owner)
        {
            AutomationElementCollection dialogs = AutomationElement.RootElement.FindAll(TreeScope.Children,
                new PropertyCondition(AutomationElement.ClassNameProperty, "#32770"));
            foreach (AutomationElement d in dialogs)
            {
                IntPtr h = IntPtr.Zero;
                try { h = new IntPtr(d.Current.NativeWindowHandle); } catch { continue; }
                if (h == IntPtr.Zero || !Native.IsWindowVisible(h)) continue;
                if (owner != IntPtr.Zero)
                {
                    IntPtr o = Native.GetWindowRel(h, 4 /* GW_OWNER */);
                    bool mine = o == owner || (o != IntPtr.Zero && Native.GetWindowRel(o, 4) == owner);
                    if (!mine) continue;
                }
                if (FindFileNameBox(d) == null) continue;
                return d;
            }
            // A browser's file picker can live in another process than the
            // window that owns it (Opera, measured on 2026-09-28: the Open dialog
            // in one process, owned by the browser window of another), and the
            // desktop walk above does not return it. The operating system's own
            // list of top-level windows does.
            if (owner != IntPtr.Zero)
            {
                AutomationElement found = null;
                try
                {
                    Native.EnumWindows(delegate(IntPtr h, IntPtr lp)
                    {
                        if (!Native.IsWindowVisible(h)) return true;
                        System.Text.StringBuilder sb = new System.Text.StringBuilder(64);
                        Native.GetClassName(h, sb, sb.Capacity);
                        if (sb.ToString() != "#32770") return true;
                        IntPtr o = Native.GetWindowRel(h, 4 /* GW_OWNER */);
                        if (!(o == owner || (o != IntPtr.Zero && Native.GetWindowRel(o, 4) == owner))) return true;
                        try
                        {
                            AutomationElement d = AutomationElement.FromHandle(h);
                            if (d != null && FindFileNameBox(d) != null) { found = d; return false; }
                        }
                        catch { }
                        return true;
                    }, IntPtr.Zero);
                }
                catch { }
                if (found != null) return found;
            }
            return null;
        }

        // A paste that gives the clipboard back afterwards. computer_clipboard
        // sets the clipboard and leaves it set - fine for reading a value out of
        // an app, but every paste built on it would quietly destroy whatever the
        // user had copied, which is the opposite of the "works while you work"
        // claim this plugin makes. This saves what is already there, writes the
        // given text, sends Ctrl+V, and puts the original back in a finally, so
        // a failure partway through cannot leave the user's clipboard clobbered.
        static object OpPaste(Dictionary<string, object> a)
        {
            string text = Str(Get(a, "text"));
            if (text == null) throw new AxonError("bad_text", "paste needs text.", null);
            Dictionary<string, object> res = new Dictionary<string, object>();
            PasteCore(a, res, delegate()
            {
                if (text.Length == 0) Clipboard.Clear();
                else Clipboard.SetText(text);
            });
            res["pasted"] = text.Length;
            return res;
        }

        // The paste itself, shared by the text and the file paste: save the
        // clipboard, put ours on it, Ctrl+V, watch for the read, put theirs back.
        static void PasteCore(Dictionary<string, object> a, Dictionary<string, object> res, System.Threading.ThreadStart setClipboard)
        {
            // Same gates as key/type with no element named: this types into
            // whatever holds focus, so it goes through the same "is the user
            // already in this window" and "bring it to the foreground" checks.
            GuardSameWindow(a, HwndArg(a));

            int kept, lost;
            DataObject saved = SaveClipboard(out kept, out lost);
            // Something is on the clipboard and none of it could be copied out, so
            // overwriting it now would destroy it with no way back. Refusing is
            // the entire reason this operation exists, so it refuses instead of
            // pasting and apologising afterwards.
            if (kept == 0 && lost > 0)
                throw new AxonError("clipboard_unsafe",
                    "The clipboard holds " + lost.ToString(CultureInfo.InvariantCulture) + " format(s) that could not be copied, so a paste could not put them back.",
                    "Use computer_type to enter the text instead, or ask the user to copy something else first.");

            RequireForeground(HwndArg(a), a, res);

            bool restored = false;
            bool userChanged = false;
            bool readObserved = false;
            try
            {
                ClipboardSTA(setClipboard);
                uint mine = Native.GetClipboardSequenceNumber();

                bool held = Exclusive(a) && Native.BeginExclusive();
                try
                {
                    System.Threading.Thread.Sleep(30);
                    Native.KeyDown(VkOf("ctrl"));
                    System.Threading.Thread.Sleep(8);
                    Native.KeyTap(VkOf("v"));
                    System.Threading.Thread.Sleep(8);
                    Native.KeyUp(VkOf("ctrl"));
                }
                // Released before the wait below, so the user's own keyboard is
                // held for the length of one keystroke and not for however long
                // the target app takes to react to it.
                finally { if (held) Native.EndExclusive(); }

                // Restoring before the target has read the clipboard makes it
                // paste the user's old contents instead - a wrong-content bug that
                // looks like a flaky paste. An app reading the clipboard holds it
                // open for the few milliseconds it takes, which is the only
                // observable sign the paste landed, so that is watched for: seen,
                // restore at once; not seen, wait out the window a slow app
                // (Electron, a remote desktop) can need. The open can fall between
                // two polls, so a miss only costs the extra wait and is never
                // reported as a paste that failed.
                for (int waited = 0; waited < 400; waited += 10)
                {
                    if (Native.GetOpenClipboardWindow() != IntPtr.Zero)
                    {
                        readObserved = true;
                        System.Threading.Thread.Sleep(20);
                        break;
                    }
                    System.Threading.Thread.Sleep(10);
                }

                // Someone wrote to the clipboard while we were pasting - the user
                // copying something of their own. Putting the old contents back
                // over their new copy would be exactly the damage this operation
                // exists to prevent, so it stands down.
                userChanged = Native.GetClipboardSequenceNumber() != mine;
            }
            finally
            {
                try
                {
                    if (!userChanged) { RestoreClipboard(saved, kept); restored = true; }
                }
                // Best-effort: the paste itself already happened by the time this
                // runs, so a restore failure is reported in the result, not
                // thrown over the top of a paste that otherwise succeeded.
                catch { }
            }

            res["clipboard_restored"] = restored;
            if (lost > 0) res["clipboard_formats_lost"] = lost;
            if (userChanged) res["clipboard_changed_by_user"] = true;
            if (readObserved) res["paste_read"] = true;
        }

        // What a target is called, before acting on it - so a click by
        // selector or by point can be judged for consequences by name.
        static object OpDescribe(Dictionary<string, object> a)
        {
            AutomationElement el = null;
            object pt = Get(a, "point");
            if (Get(a, "index") != null || Get(a, "selector") != null) el = ResolveTarget(a).El;
            else if (pt != null)
            {
                object[] arr = pt as object[];
                if (arr != null && arr.Length >= 2)
                {
                    try { el = AutomationElement.FromPoint(new System.Windows.Point(Int(arr[0], 0), Int(arr[1], 0))); }
                    catch { }
                }
            }
            Dictionary<string, object> res = new Dictionary<string, object>();
            if (el == null) { res["found"] = false; return res; }
            res["found"] = true;
            try { res["name"] = CleanText(NameOf(el)); } catch { }
            try { res["role"] = RoleOf(el); } catch { }
            try { res["aid"] = AidOf(el); } catch { }
            return res;
        }

        // True while the server is running a batch of steps, so Escape between
        // two steps still stops the run.
        static volatile bool _taskActive;

        static object OpBusy(Dictionary<string, object> a)
        {
            _taskActive = Bool(Get(a, "on"), false);
            Dictionary<string, object> res = new Dictionary<string, object>();
            res["task_active"] = _taskActive;
            return res;
        }

        static bool IsActingOp(string op)
        {
            switch (op)
            {
                case "click": case "type": case "set_value": case "key": case "scroll":
                case "focus": case "close_window": case "drag": case "paste":
                    return true;
            }
            return false;
        }

        // ---- handing the foreground back -----------------------------------
        //
        // A real click activates the window it lands in, and keystrokes need
        // their window in front, so some actions take the foreground from
        // whatever the user was working in. Putting the pointer back was never
        // enough: on 2026-09-26 a physical click on a browser on the user's
        // second monitor left that browser in front, and the next thing they
        // typed went into it instead of their terminal.
        //
        // So the window that was in front before the first such action in a
        // sequence is remembered, and give_back - which the server calls when a
        // run ends, or straight after a single action - puts it back. It does
        // not when the user has since clicked somewhere themselves (their
        // choice stands), when something unrelated is in front now, while a
        // menu or dropdown the target opened is still showing (it would close
        // the moment its app lost the foreground; the record is kept and the
        // next give_back tries again), or when the action ran in take or
        // exclusive mode, where the user has said to drive. computer_focus is
        // not tracked at all: raising a window is what it was asked to do.
        static IntPtr _fgHome = IntPtr.Zero;
        static readonly HashSet<uint> _fgOurPids = new HashSet<uint>();
        static long _fgBorrowTicks;
        static long _fgLastActTicks;

        static bool BorrowTracked(string op, Dictionary<string, object> a)
        {
            switch (op)
            {
                case "click": case "type": case "set_value": case "key": case "scroll":
                case "drag": case "paste": case "paste_files": case "file_dialog":
                    break;
                default:
                    return false;
            }
            string m = ModeOf(a);
            return m != "take" && m != "exclusive";
        }

        static uint PidOf(IntPtr h)
        {
            uint pid = 0;
            if (h != IntPtr.Zero) Native.GetWindowThreadProcessId(h, out pid);
            return pid;
        }

        static void NoteBorrow(IntPtr fgBefore, Dictionary<string, object> a)
        {
            // A record left over from an earlier sequence - never given back
            // (a menu was still open, or the server went away) - is not this
            // sequence's home once the user has clicked since, or a minute has
            // passed without an action.
            if (_fgHome != IntPtr.Zero)
            {
                long idleMs = (DateTime.UtcNow.Ticks - _fgLastActTicks) / TimeSpan.TicksPerMillisecond;
                if (Presence.LastUserClickTicks > _fgBorrowTicks || idleMs > 60000) ClearBorrow();
            }
            IntPtr fgAfter = Native.GetForegroundWindow();
            if (_fgHome != IntPtr.Zero) _fgLastActTicks = DateTime.UtcNow.Ticks;
            if (fgAfter == IntPtr.Zero || fgBefore == IntPtr.Zero || fgAfter == fgBefore) return;
            if (Overlay.IsAnyOverlayWindow(fgBefore) || Overlay.IsAnyOverlayWindow(fgAfter)) return;
            if (_fgHome == IntPtr.Zero)
            {
                _fgHome = fgBefore;
                _fgOurPids.Clear();
                _fgBorrowTicks = DateTime.UtcNow.Ticks;
            }
            _fgOurPids.Add(PidOf(fgAfter));
            IntPtr target = HwndArg(a);
            if (target != IntPtr.Zero) _fgOurPids.Add(PidOf(target));
            _fgLastActTicks = DateTime.UtcNow.Ticks;
        }

        static void ClearBorrow()
        {
            _fgHome = IntPtr.Zero;
            _fgOurPids.Clear();
        }

        // A menu, dropdown list or browser popup of one of these processes that
        // is showing right now, by class; null when there is none.
        static string OpenPopupOf(HashSet<uint> pids)
        {
            string found = null;
            try
            {
                Native.EnumWindows(delegate(IntPtr h, IntPtr lp)
                {
                    if (!Native.IsWindowVisible(h) || Native.IsCloaked(h)) return true;
                    System.Text.StringBuilder sb = new System.Text.StringBuilder(128);
                    Native.GetClassName(h, sb, sb.Capacity);
                    string cls = sb.ToString();
                    // Chromium draws a <select> list as an owned, non-activating
                    // WS_POPUP of the ordinary window class (measured in Edge:
                    // Chrome_WidgetWin_1, style 0x96000000, exstyle 0x08200000),
                    // not as one of the popup classes the window listing knows.
                    bool transient = IsPopupClass(cls);
                    if (!transient)
                    {
                        const int WS_POPUP = unchecked((int)0x80000000), WS_EX_NOACTIVATE = 0x08000000;
                        transient = Native.GetWindowRel(h, 4 /* GW_OWNER */) != IntPtr.Zero
                            && (Native.GetWindowLongW(h, -16 /* GWL_STYLE */) & WS_POPUP) != 0
                            && (Native.GetWindowLongW(h, -20 /* GWL_EXSTYLE */) & WS_EX_NOACTIVATE) != 0;
                    }
                    if (!transient) return true;
                    Native.RECT rr;
                    if (!Native.GetWindowRect(h, out rr)) return true;
                    int rw = rr.Right - rr.Left, rh = rr.Bottom - rr.Top;
                    // Tooltips share a class with browser menus; height tells them
                    // apart (a tooltip is one line, a list at least two).
                    if (rw < 40 || rh < (cls == "Chrome_WidgetWin_2" ? 60 : IsPopupClass(cls) ? 24 : 40)) return true;
                    if (!pids.Contains(PidOf(h))) return true;
                    found = cls;
                    return false;
                }, IntPtr.Zero);
            }
            catch { }
            return found;
        }

        static object OpGiveBack(Dictionary<string, object> a)
        {
            Dictionary<string, object> res = new Dictionary<string, object>();
            IntPtr home = _fgHome;
            res["given_back"] = false;
            if (home == IntPtr.Zero) return res;
            // A menu the last action opened may take a moment to appear; look
            // for it only once it has had the chance.
            long sinceMs = (DateTime.UtcNow.Ticks - _fgLastActTicks) / TimeSpan.TicksPerMillisecond;
            if (sinceMs >= 0 && sinceMs < 250) System.Threading.Thread.Sleep((int)(250 - sinceMs));

            IntPtr fg = Native.GetForegroundWindow();
            string why = null;
            if (!Native.IsWindow(home) || !Native.IsWindowVisible(home) || Native.IsIconic(home)) why = "home_gone";
            else if (fg == home) why = "already_back";
            else if (Presence.LastUserClickTicks > _fgBorrowTicks) why = "user_moved";
            else if (fg != IntPtr.Zero && !_fgOurPids.Contains(PidOf(fg))) why = "user_moved";
            if (why != null)
            {
                ClearBorrow();
                res["reason"] = why;
                return res;
            }
            string popup = OpenPopupOf(_fgOurPids);
            if (popup != null)
            {
                res["reason"] = "menu_open";
                res["popup"] = popup;
                return res;
            }
            bool ok = Native.ForceForeground(home);
            System.Text.StringBuilder t = new System.Text.StringBuilder(256);
            Native.GetWindowTextW(home, t, t.Capacity);
            res["given_back"] = ok;
            res["hwnd"] = Hwnd(home);
            res["title"] = t.ToString();
            if (!ok) res["reason"] = "refused";
            ClearBorrow();
            return res;
        }

        // ---- which terminal shows this session ------------------------------
        //
        // Run as `AxonHost.exe --console-window <pid>`: a separate short-lived
        // process, never the host itself, because it has to give up its own
        // console to borrow another's. Starting at <pid> (the server's parent,
        // Claude Code) and walking up its parents, it attaches to each one's
        // console and asks for the console window. Windows Terminal owns the
        // hidden pseudo-console window of each of its panes, so the root owner of
        // that window is the terminal window the session is drawn in; a classic
        // console window is itself visible. A process started without a console
        // window answers nothing and the walk moves on to its parent. Prints
        // {"hwnd":N,"via_pid":P}, hwnd 0 when nothing was found.
        static int ConsoleWindowOf(string arg)
        {
            // Bound to the pipe before any console is touched.
            System.IO.TextWriter outw = Console.Out;
            outw.Flush();
            int pid;
            if (!int.TryParse(arg, NumberStyles.Integer, CultureInfo.InvariantCulture, out pid)) pid = 0;
            long hwnd = 0;
            int via = 0;
            Dictionary<int, int> parents = ParentMap();
            HashSet<int> seen = new HashSet<int>();
            int cur = pid;
            for (int depth = 0; depth < 8 && cur > 4 && seen.Add(cur); depth++)
            {
                try
                {
                    Native.FreeConsole();
                    if (Native.AttachConsole((uint)cur))
                    {
                        IntPtr cw = Native.GetConsoleWindow();
                        Native.FreeConsole();
                        if (cw != IntPtr.Zero)
                        {
                            IntPtr owner = Native.GetAncestor(cw, 3 /* GA_ROOTOWNER */);
                            IntPtr pick = IntPtr.Zero;
                            if (owner != IntPtr.Zero && owner != cw && Native.IsWindowVisible(owner)) pick = owner;
                            else if (Native.IsWindowVisible(cw)) pick = cw;
                            if (pick != IntPtr.Zero) { hwnd = Hwnd(pick); via = cur; break; }
                        }
                    }
                }
                catch { }
                int pp;
                if (!parents.TryGetValue(cur, out pp) || pp <= 4) break;
                // A parent id Windows has since given to a younger process is not
                // this process's parent any more.
                if (!StartedBefore(pp, cur)) break;
                cur = pp;
            }
            outw.WriteLine("{\"hwnd\":" + hwnd.ToString(CultureInfo.InvariantCulture) + ",\"via_pid\":" + via.ToString(CultureInfo.InvariantCulture) + "}");
            outw.Flush();
            return 0;
        }

        static Dictionary<int, int> ParentMap()
        {
            Dictionary<int, int> map = new Dictionary<int, int>();
            IntPtr snap = Native.CreateToolhelp32Snapshot(2 /* TH32CS_SNAPPROCESS */, 0);
            if (snap == IntPtr.Zero || snap == new IntPtr(-1)) return map;
            try
            {
                Native.PROCESSENTRY32W e = new Native.PROCESSENTRY32W();
                e.dwSize = (uint)Marshal.SizeOf(typeof(Native.PROCESSENTRY32W));
                if (Native.Process32FirstW(snap, ref e))
                {
                    do { map[(int)e.th32ProcessID] = (int)e.th32ParentProcessID; }
                    while (Native.Process32NextW(snap, ref e));
                }
            }
            finally { Native.CloseHandle(snap); }
            return map;
        }

        static bool StartedBefore(int parent, int child)
        {
            try
            {
                DateTime p = System.Diagnostics.Process.GetProcessById(parent).StartTime;
                DateTime c = System.Diagnostics.Process.GetProcessById(child).StartTime;
                return p <= c;
            }
            catch (ArgumentException) { return false; }   // the parent is gone
            catch { return true; }                        // not ours to inspect: assume it is the parent
        }

        static object OpPing()
        {
            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = true;
            res["dpi_mode"] = _dpiMode;
            res["clr"] = Environment.Version.ToString();
            res["snapshots"] = _snapshots.Count;
            return res;
        }
    }
}
