// Presence - tells Computer Use when the human is actually using the machine.
//
// The whole point of Computer Use coexisting on one desktop is knowing the difference
// between input the user produced and input Computer Use produced. Windows answers that
// exactly: the kernel stamps every synthetic event with an injected flag that
// the injecting process cannot clear, and low-level hooks can read it.
//
//   MSLLHOOKSTRUCT.flags  bit 0 (0x01) LLMHF_INJECTED
//   KBDLLHOOKSTRUCT.flags bit 4 (0x10) LLKHF_INJECTED
//
// So Computer Use's own SendInput calls never register as the user being busy, and a
// real hand on the mouse always does.
//
// The callbacks run on the thread that installed the hook and are subject to
// LowLevelHooksTimeout: too slow and Windows silently drops the hook from the
// chain. They therefore do the least possible work - read one int, compare it,
// store a timestamp - and nothing else. GetForegroundWindow is deliberately NOT
// called here; it is read when presence is queried instead.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

namespace Axon
{
    internal static class Presence
    {
        delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        static extern IntPtr SetWindowsHookExW(int idHook, HookProc lpfn, IntPtr hMod, uint threadId);
        [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hhk);
        [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
        [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandleW(string name);
        [DllImport("user32.dll")] static extern int GetMessageW(out MSG msg, IntPtr hwnd, uint min, uint max);
        [DllImport("user32.dll")] static extern bool PostThreadMessageW(uint threadId, uint msg, IntPtr w, IntPtr l);
        [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
        [DllImport("kernel32.dll")] static extern uint GetTickCount();

        [StructLayout(LayoutKind.Sequential)]
        struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }

        [StructLayout(LayoutKind.Sequential)]
        struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }

        const int WH_KEYBOARD_LL = 13;
        const int WH_MOUSE_LL = 14;
        const int LLMHF_INJECTED = 0x0001;
        const int LLKHF_INJECTED = 0x0010;
        const uint WM_QUIT = 0x0012;
        const uint WM_MOUSEMOVE = 0x0200;
        const uint WM_MOUSEWHEEL = 0x020A;
        const uint WM_MOUSEHWHEEL = 0x020E;

        // Field offsets into the hook structs, so the callback can read the one
        // int it needs without marshalling a whole structure per event.
        const int MOUSE_FLAGS_OFFSET = 12;  // POINT(8) + mouseData(4)
        const int KEY_FLAGS_OFFSET = 8;     // vkCode(4) + scanCode(4)

        // Static so the garbage collector cannot relocate the delegates while
        // Windows holds native pointers to them.
        static HookProc _mouseProc;
        static HookProc _keyProc;
        static IntPtr _mouseHook = IntPtr.Zero;
        static IntPtr _keyHook = IntPtr.Zero;

        static long _lastAnyTicks;      // any real input, movement included
        static long _lastCommitTicks;   // clicks and keystrokes - deliberate acts
        static long _realEvents;
        static long _injectedEvents;
        static int _lastKind;           // 1 = mouse, 2 = keyboard
        static long _commitWindow;      // which window the user last acted IN
        static long _lastClickTicks;    // their last real mouse-button press
        static long _lastSelfInject;    // when Computer Use itself last sent input
        static uint _threadId;
        static volatile bool _hooksOk;
        static volatile bool _started;
        static Thread _thread;

        internal static bool HooksOk { get { return _hooksOk; } }

        internal static void NoteSelfInput() { Interlocked.Exchange(ref _lastSelfInject, DateTime.UtcNow.Ticks); }

        // Raised when the user presses Escape. The host wires this to release any
        // input block and halt the run - the guaranteed way to take the machine
        // back, whatever else is going on.
        internal static Action OnPanic;

        // Both Ctrl keys held together - the Windows counterpart of the
        // ChatGPT desktop app's both-Command-keys appshot. Fires once per
        // press; releasing either key re-arms it.
        internal static Action OnAppshot;
        static bool _lctrlDown, _rctrlDown, _appshotFired;

        // A freshly compiled, unsigned binary that installs global keyboard
        // hooks looks exactly like a keylogger, and Windows security tooling can
        // let the install succeed while quietly delivering nothing. So hooks
        // count as usable only once they have actually delivered something.
        internal static bool HooksLive
        {
            get { return _hooksOk && Interlocked.Read(ref _realEvents) + Interlocked.Read(ref _injectedEvents) > 0; }
        }

        // GetLastInputInfo needs no hook. It counts synthetic input too, so
        // anything arriving right after one of Computer Use's own injections is treated
        // as Computer Use's rather than the user's.
        static int FallbackIdleMs()
        {
            LASTINPUTINFO lii = new LASTINPUTINFO();
            lii.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
            if (!GetLastInputInfo(ref lii)) return int.MaxValue;
            long idle = (long)unchecked(GetTickCount() - lii.dwTime);
            if (idle < 0) idle = 0;
            long selfAgo = (DateTime.UtcNow.Ticks - Interlocked.Read(ref _lastSelfInject)) / TimeSpan.TicksPerMillisecond;
            if (Interlocked.Read(ref _lastSelfInject) != 0 && Math.Abs(selfAgo - idle) < 400) return int.MaxValue;
            return idle > int.MaxValue ? int.MaxValue : (int)idle;
        }

        internal static void Start()
        {
            if (_started) return;
            _started = true;
            long now = DateTime.UtcNow.Ticks;
            Interlocked.Exchange(ref _lastAnyTicks, now);
            Interlocked.Exchange(ref _lastCommitTicks, now);

            _thread = new Thread(Pump);
            _thread.IsBackground = true;
            _thread.Name = "computer-use-presence";
            _thread.Start();

            // Give the hooks a moment to install so the first presence query is
            // not answered before monitoring actually began.
            for (int i = 0; i < 40 && !_hooksOk; i++) Thread.Sleep(25);
        }

        static void Pump()
        {
            _threadId = GetCurrentThreadId();
            _mouseProc = MouseCallback;
            _keyProc = KeyCallback;
            IntPtr mod = GetModuleHandleW(null);

            _mouseHook = SetWindowsHookExW(WH_MOUSE_LL, _mouseProc, mod, 0);
            _keyHook = SetWindowsHookExW(WH_KEYBOARD_LL, _keyProc, mod, 0);
            _hooksOk = _mouseHook != IntPtr.Zero && _keyHook != IntPtr.Zero;

            // Low-level hooks are delivered to this thread's message queue, so
            // it has to keep pumping or Windows will stop calling us.
            MSG msg;
            while (GetMessageW(out msg, IntPtr.Zero, 0, 0) > 0) { }

            if (_mouseHook != IntPtr.Zero) UnhookWindowsHookEx(_mouseHook);
            if (_keyHook != IntPtr.Zero) UnhookWindowsHookEx(_keyHook);
            _hooksOk = false;
        }

        internal static void Stop()
        {
            if (!_started) return;
            if (_threadId != 0) PostThreadMessageW(_threadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
            _started = false;
        }

        static IntPtr MouseCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                int flags = Marshal.ReadInt32(lParam, MOUSE_FLAGS_OFFSET);
                if ((flags & LLMHF_INJECTED) != 0)
                {
                    Interlocked.Increment(ref _injectedEvents);
                }
                else
                {
                    long now = DateTime.UtcNow.Ticks;
                    Interlocked.Exchange(ref _lastAnyTicks, now);
                    Interlocked.Increment(ref _realEvents);
                    _lastKind = 1;
                    // Movement means "present"; a click means "doing something".
                    if ((uint)wParam != WM_MOUSEMOVE)
                    {
                        Interlocked.Exchange(ref _lastCommitTicks, now);
                        Interlocked.Exchange(ref _commitWindow, (long)GetForegroundWindow());
                        // A button press, not a wheel turn: where they chose to be.
                        if ((uint)wParam != WM_MOUSEWHEEL && (uint)wParam != WM_MOUSEHWHEEL)
                            Interlocked.Exchange(ref _lastClickTicks, now);
                    }
                }
            }
            return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
        }

        static IntPtr KeyCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                int flags = Marshal.ReadInt32(lParam, KEY_FLAGS_OFFSET);
                if ((flags & LLKHF_INJECTED) != 0)
                {
                    Interlocked.Increment(ref _injectedEvents);
                }
                else
                {
                    long now = DateTime.UtcNow.Ticks;
                    Interlocked.Exchange(ref _lastAnyTicks, now);
                    Interlocked.Exchange(ref _lastCommitTicks, now);
                    Interlocked.Exchange(ref _commitWindow, (long)GetForegroundWindow());
                    Interlocked.Increment(ref _realEvents);
                    _lastKind = 2;
                    // Escape is the way out, checked before anything else so it
                    // works when nothing else does. This still fires while
                    // physical input is blocked: BlockInput stops input reaching
                    // other applications, but the thread that blocked it keeps
                    // seeing it, and that thread is this one.
                    int vk = Marshal.ReadInt32(lParam, 0);
                    if (vk == 0x1B && OnPanic != null)
                    {
                        try { OnPanic(); } catch { }
                    }
                    uint km = (uint)wParam;
                    bool keyDown = km == 0x0100 || km == 0x0104;   // WM_KEYDOWN, WM_SYSKEYDOWN
                    bool keyUp = km == 0x0101 || km == 0x0105;     // WM_KEYUP, WM_SYSKEYUP
                    if (vk == 0xA2) { if (keyDown) _lctrlDown = true; else if (keyUp) { _lctrlDown = false; _appshotFired = false; } }
                    if (vk == 0xA3) { if (keyDown) _rctrlDown = true; else if (keyUp) { _rctrlDown = false; _appshotFired = false; } }
                    if (_lctrlDown && _rctrlDown && !_appshotFired && OnAppshot != null)
                    {
                        _appshotFired = true;
                        try { OnAppshot(); } catch { }
                    }
                }
            }
            return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
        }

        internal static int IdleMs
        {
            get
            {
                if (!HooksLive) return FallbackIdleMs();
                long t = Interlocked.Read(ref _lastAnyTicks);
                long delta = DateTime.UtcNow.Ticks - t;
                if (delta < 0) delta = 0;
                long ms = delta / TimeSpan.TicksPerMillisecond;
                return ms > int.MaxValue ? int.MaxValue : (int)ms;
            }
        }

        internal static int CommitIdleMs
        {
            get
            {
                if (!HooksLive) return FallbackIdleMs();
                long t = Interlocked.Read(ref _lastCommitTicks);
                long delta = DateTime.UtcNow.Ticks - t;
                if (delta < 0) delta = 0;
                long ms = delta / TimeSpan.TicksPerMillisecond;
                return ms > int.MaxValue ? int.MaxValue : (int)ms;
            }
        }

        // With no working hooks Computer Use cannot tell the user apart from itself, so
        // it reports "not active" and degrades to acting immediately - the way
        // it behaved before coexistence existed. That is a real loss of
        // courtesy, so computer_status says so loudly rather than quietly pretending
        // the desktop is free.
        internal static bool Available { get { return true; } }

        internal static bool Active(int thresholdMs) { return IdleMs < thresholdMs; }

        // The window the user last clicked or typed in. Lets Computer Use tell "they are
        // busy somewhere" apart from "they are busy in the window I want", which
        // is the difference between coexisting and getting in their way.
        internal static long CommitWindow { get { return Interlocked.Read(ref _commitWindow); } }

        // When the user last pressed a mouse button themselves, in UTC ticks (0
        // for never). A click is a choice of window, which the foreground
        // give-back respects rather than undoes.
        internal static long LastUserClickTicks { get { return Interlocked.Read(ref _lastClickTicks); } }

        internal static bool Busy(int thresholdMs)
        {
            // Without live hooks there is no per-window attribution, so the
            // same-window rule cannot be applied and must not guess.
            if (!HooksLive) return false;
            return CommitIdleMs < thresholdMs;
        }

        // Blocks until the user has been quiet for idleMs, or gives up after
        // budgetMs. Returns true if a quiet gap was found.
        internal static bool WaitForQuiet(int idleMs, int budgetMs)
        {
            int waited = 0;
            const int step = 100;
            while (waited < budgetMs)
            {
                if (IdleMs >= idleMs) return true;
                Thread.Sleep(step);
                waited += step;
            }
            return IdleMs >= idleMs;
        }

        internal static Dictionary<string, object> Report()
        {
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["monitoring"] = true;
            d["source"] = HooksLive ? "hooks" : "last-input";
            d["hooks_delivering"] = HooksLive;
            d["idle_ms"] = IdleMs;
            d["commit_idle_ms"] = CommitIdleMs;
            d["last_input"] = _lastKind == 2 ? "keyboard" : (_lastKind == 1 ? "mouse" : "none");
            d["real_events"] = Interlocked.Read(ref _realEvents);
            d["injected_events"] = Interlocked.Read(ref _injectedEvents);
            d["user_window"] = (long)(int)CommitWindow;
            return d;
        }
    }
}
