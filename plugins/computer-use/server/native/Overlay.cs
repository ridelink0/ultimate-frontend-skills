// Overlay - everything Computer Use puts on screen.
//
// Four windows in one colour - and one colour per Claude. A second session on
// the same desktop draws its own cursor, marker, ring and banner in the next
// hue along, so two agents working at once are two things you can tell apart
// rather than one thing behaving strangely:
//   - a ring around the whole desktop while it is working (click-through)
//   - a banner reading "Claude is using your computer", with Stop
//   - a Claude-coloured cursor showing where it is, alongside yours
//   - a marker naming each control as it is touched
//
// Rendering is per-pixel alpha via UpdateLayeredWindow, not a colour key. A
// TransparencyKey knocks out one exact colour, so every antialiased edge blends
// toward that colour and leaves a fringe of it around curves and text - with a
// magenta key that is a visible purple halo on everything, the cursor included.
// Real alpha has no such edge, and it hit-tests for free: fully transparent
// pixels pass clicks through without needing WS_EX_TRANSPARENT.
//
// The ring and the banner are separate windows on purpose. A painted ring on a
// clickable window would put a live 4px band around every screen edge, eating
// clicks meant for the taskbar, corner hot zones and window resize handles.
//
// This never calls SetCursor, ShowCursor, or SetSystemCursor. Your pointer is
// never touched, so it cannot be left in a bad state - which is the standing
// Codex bug on Windows (openai/codex#25200), where users are asking for exactly
// this: an overlay cursor instead of hijacking the system one.

using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace Axon
{
    internal static class Overlay
    {
        [DllImport("user32.dll")] static extern bool SetWindowDisplayAffinity(IntPtr hwnd, uint affinity);
        [DllImport("user32.dll")] static extern bool GetCursorPos(out NPOINT p);
        [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hwnd);
        [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);
        [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr hdc);
        [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr hdc);
        [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);
        [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
        [DllImport("user32.dll", SetLastError = true)]
        static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, ref NPOINT pptDst, ref NSIZE psize,
                                               IntPtr hdcSrc, ref NPOINT pptSrc, int crKey,
                                               ref BLENDFUNCTION pblend, int dwFlags);

        [StructLayout(LayoutKind.Sequential)] internal struct NPOINT { public int X, Y; public NPOINT(int x, int y) { X = x; Y = y; } }
        [StructLayout(LayoutKind.Sequential)] internal struct NSIZE { public int W, H; public NSIZE(int w, int h) { W = w; H = h; } }
        [StructLayout(LayoutKind.Sequential)]
        internal struct BLENDFUNCTION { public byte BlendOp, BlendFlags, SourceConstantAlpha, AlphaFormat; }

        const uint WDA_EXCLUDEFROMCAPTURE = 0x00000011;
        const int ULW_ALPHA = 0x02;
        const byte AC_SRC_OVER = 0x00, AC_SRC_ALPHA = 0x01;

        // Anthropic's own palette. One accent, everywhere - ring, banner, cursor
        // and marker all draw from it, so this reads as one thing rather than as
        // a colour scheme.
        internal static readonly Color Claude = Color.FromArgb(217, 119, 87);   // #D97757

        // With two Claudes on one desktop there are two cursors, two markers and
        // two banners, and they are all the same shape. Colour is what tells
        // them apart - the same thing a shared document does for two people
        // editing it. Session one keeps Claude's own colour, so a single session
        // looks exactly as it always did; later sessions take the next hue.
        // Whichever colour a cursor is, the banner and marker of that session
        // match it, so "who just clicked that" is answerable at a glance.
        static readonly Color[] Accents = new Color[]
        {
            Color.FromArgb(217, 119, 87),    // #D97757  Claude
            Color.FromArgb( 61, 152, 173),   // #3D98AD  teal
            Color.FromArgb(139, 111, 196),   // #8B6FC4  violet
            Color.FromArgb( 90, 158, 106),   // #5A9E6A  green
            Color.FromArgb(198, 133, 61),    // #C6853D  amber
            Color.FromArgb(190, 96, 122),    // #BE607A  rose
        };

        internal static Color Accent
        {
            get
            {
                int i = _slot;
                if (i < 0) i = 0;
                return Accents[i % Accents.Length];
            }
        }

        internal static string AccentHex
        {
            get
            {
                Color c = Accent;
                return "#" + c.R.ToString("X2") + c.G.ToString("X2") + c.B.ToString("X2");
            }
        }
        internal static readonly Color Ink = Color.FromArgb(20, 20, 19);        // #141413
        internal static readonly Color Paper = Color.FromArgb(250, 249, 245);   // #FAF9F5

        static Thread _thread;
        static MarkerForm _marker;
        static RingForm _ring;
        static BannerForm _banner;
        static CursorForm _cursor;
        static System.Windows.Forms.Timer _idleTimer;
        static volatile bool _stopRequested;
        static volatile bool _enabled = true;
        static volatile bool _ready;
        static IntPtr _markerHwnd, _ringHwnd, _bannerHwnd, _cursorHwnd;
        static string _fontName;

        // Which banner row this session owns, and what to call it. Two Claude
        // Code sessions on one desktop would otherwise draw the same banner in
        // the same place, hiding one Stop button behind the other - so each
        // session gets its own row, and says which one it is.
        static int _slot;
        static string _sessionLabel;
        static int _peers;

        // What Claude is doing right now, in a few words, after the banner's
        // message: "typing in notepad", "thinking". Codex's preview window
        // shows the activity; a banner that says what it is doing is the same
        // reassurance at a fraction of the screen.
        static string _status = "";

        internal static void Status(string s)
        {
            _status = s ?? "";
            if (!Enabled || _banner == null) return;
            try
            {
                _banner.BeginInvoke((MethodInvoker)delegate
                {
                    try { _banner.Relayout(); } catch { }
                });
            }
            catch { }
        }

        internal static void Configure(int slot, string label, int peers)
        {
            _slot = slot < 0 ? 0 : (slot > 8 ? 8 : slot);
            _sessionLabel = label;
            _peers = peers < 0 ? 0 : peers;
            if (!Enabled || _banner == null) return;
            try
            {
                _banner.BeginInvoke((MethodInvoker)delegate
                {
                    try { _banner.Relayout(); } catch { }
                });
            }
            catch { }
        }

        internal static bool Enabled { get { return _enabled && _ready; } }
        internal static bool StopRequested { get { return _stopRequested; } }

        internal static bool IsOwnWindow(IntPtr h)
        {
            if (h == IntPtr.Zero) return false;
            return h == _markerHwnd || h == _ringHwnd || h == _bannerHwnd || h == _cursorHwnd;
        }

        // Every overlay window carries a window property naming it as ours, so
        // ANY Computer Use host can recognise ANY other one's chrome. Without
        // this, a second Claude session's banner is just an unexplained window
        // to the first: listable, targetable, and clickable. A window property
        // is readable across processes and dies with the window, so there is
        // nothing to clean up and nothing to get out of date.
        const string MarkerProp = "ComputerUseOverlayWindow";

        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool SetPropW(IntPtr h, string name, IntPtr data);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetPropW(IntPtr h, string name);
        [DllImport("user32.dll")] static extern int GetWindowLongW(IntPtr h, int index);
        [DllImport("user32.dll")] static extern int SetWindowLongW(IntPtr h, int index, int value);
        [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out NRECT r);

        [StructLayout(LayoutKind.Sequential)] internal struct NRECT { public int Left, Top, Right, Bottom; }

        const int GWL_EXSTYLE = -20;
        const int WS_EX_TRANSPARENT = 0x00000020;

        internal static bool IsAnyOverlayWindow(IntPtr h)
        {
            if (h == IntPtr.Zero) return false;
            if (IsOwnWindow(h)) return true;
            try { return GetPropW(h, MarkerProp) != IntPtr.Zero; }
            catch { return false; }
        }

        static void Mark(IntPtr h)
        {
            try { SetPropW(h, MarkerProp, new IntPtr(1)); } catch { }
        }

        // The banner is the one overlay window that accepts clicks - Stop has to
        // be pressable - which means it also swallows a real click aimed at
        // whatever is underneath it. A control near the top of the screen is a
        // perfectly ordinary thing to click. So for the length of one injected
        // click the banner is made transparent to the mouse: it stays visible,
        // it just stops being in the way. Returns true if that was needed.
        internal static bool BeginClickThrough(int x, int y)
        {
            return BeginClickThroughRect(x, y, 1, 1);
        }

        // Takes the whole control, not just the point, because the banner does
        // more than swallow the click: while it covers part of a control, the
        // provider's own idea of where that control is clickable shifts to the
        // sliver still showing, which puts the click on the element's edge and
        // often misses it entirely. Stepping aside before the point is worked
        // out is what makes a real click on a control near the top of the
        // screen land where it should.
        internal static bool BeginClickThroughRect(int x, int y, int w, int h_)
        {
            IntPtr h = _bannerHwnd;
            if (h == IntPtr.Zero) return false;
            try
            {
                NRECT r;
                if (!GetWindowRect(h, out r)) return false;
                if (x >= r.Right || x + w <= r.Left || y >= r.Bottom || y + h_ <= r.Top) return false;
                int ex = GetWindowLongW(h, GWL_EXSTYLE);
                if ((ex & WS_EX_TRANSPARENT) != 0) return false;
                SetWindowLongW(h, GWL_EXSTYLE, ex | WS_EX_TRANSPARENT);
                return true;
            }
            catch { return false; }
        }

        internal static void EndClickThrough()
        {
            IntPtr h = _bannerHwnd;
            if (h == IntPtr.Zero) return;
            try
            {
                int ex = GetWindowLongW(h, GWL_EXSTYLE);
                SetWindowLongW(h, GWL_EXSTYLE, ex & ~WS_EX_TRANSPARENT);
            }
            catch { }
        }

        internal static bool ConsumeStop()
        {
            if (!_stopRequested) return false;
            _stopRequested = false;
            return true;
        }

        internal static void RequestStop() { _stopRequested = true; }

        // OpenAI Sans and Söhne are licensed faces that cannot ship inside a
        // plugin, so this resolves the closest grotesque actually installed
        // rather than pretending to be either.
        internal static string UiFont
        {
            get
            {
                if (_fontName != null) return _fontName;
                string[] wanted = { "Segoe UI Variable Text", "Inter", "Segoe UI", "Arial" };
                foreach (string want in wanted)
                {
                    try
                    {
                        foreach (FontFamily f in FontFamily.Families)
                            if (string.Equals(f.Name, want, StringComparison.OrdinalIgnoreCase))
                            {
                                _fontName = want;
                                return _fontName;
                            }
                    }
                    catch { }
                }
                _fontName = "Segoe UI";
                return _fontName;
            }
        }

        internal static void Start(bool enabled)
        {
            _enabled = enabled;
            if (!enabled) return;
            try
            {
                _thread = new Thread(Run);
                _thread.IsBackground = true;
                _thread.SetApartmentState(ApartmentState.STA);
                _thread.Name = "computer-use-overlay";
                _thread.Start();
                for (int i = 0; i < 60 && !_ready; i++) Thread.Sleep(25);
            }
            catch { _enabled = false; }
        }

        static void Run()
        {
            try
            {
                _marker = new MarkerForm(); _marker.CreateControl(); _markerHwnd = _marker.Handle; Exclude(_markerHwnd); Mark(_markerHwnd);
                _ring = new RingForm(); _ring.CreateControl(); _ringHwnd = _ring.Handle; Exclude(_ringHwnd); Mark(_ringHwnd);
                _banner = new BannerForm(); _banner.CreateControl(); _bannerHwnd = _banner.Handle; Exclude(_bannerHwnd); Mark(_bannerHwnd);
                _cursor = new CursorForm(); _cursor.CreateControl(); _cursorHwnd = _cursor.Handle; Exclude(_cursorHwnd); Mark(_cursorHwnd);

                _idleTimer = new System.Windows.Forms.Timer();
                _idleTimer.Interval = 2200;
                _idleTimer.Tick += delegate
                {
                    _idleTimer.Stop();
                    try { _ring.Vanish(); } catch { }
                    try { _banner.Vanish(); } catch { }
                    try { _cursor.Vanish(); } catch { }
                };

                _ready = true;
                Application.Run(_marker);
            }
            catch { _enabled = false; }
            finally
            {
                _ready = false;
                _markerHwnd = _ringHwnd = _bannerHwnd = _cursorHwnd = IntPtr.Zero;
            }
        }

        static void Exclude(IntPtr h)
        {
            try { SetWindowDisplayAffinity(h, WDA_EXCLUDEFROMCAPTURE); } catch { }
        }

        // When Computer Use last began doing something. Escape reads this to tell
        // "stop what you are doing" from an Escape the user pressed in their own
        // application while nothing of ours was running.
        static long _lastActiveTicks;

        internal static bool ActiveWithin(int ms)
        {
            long t = System.Threading.Interlocked.Read(ref _lastActiveTicks);
            if (t == 0) return false;
            return (DateTime.UtcNow.Ticks - t) / TimeSpan.TicksPerMillisecond < ms;
        }

        // ------------------------------------------------------------------
        // Virtual desktops.
        //
        // A window belongs to the desktop it was created on. So the banner that
        // says "Claude is using your computer", and the Stop button on it, are
        // invisible the moment the user switches to another virtual desktop -
        // which is precisely when they are most entitled to know that something
        // is still driving their machine. Windows exposes a documented way for a
        // process to move its OWN windows between desktops, so the chrome
        // follows the person rather than staying where it was born.
        //
        // On a Windows without the interface, every call here is a no-op and
        // nothing else changes.
        [ComImport, Guid("AA509086-5CA9-4C25-8F95-589D3C07B48A")]
        class VirtualDesktopManagerClass { }

        [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("A5CD92FF-29BE-454C-8D04-D82879FB3F1B")]
        interface IVirtualDesktopManager
        {
            [PreserveSig] int IsWindowOnCurrentVirtualDesktop(IntPtr hwnd, out int onCurrent);
            [PreserveSig] int GetWindowDesktopId(IntPtr hwnd, out Guid desktopId);
            [PreserveSig] int MoveWindowToDesktop(IntPtr hwnd, ref Guid desktopId);
        }

        static IVirtualDesktopManager _desktops;
        static bool _desktopsTried;
        static int _lastFollowTick;

        static IVirtualDesktopManager Desktops
        {
            get
            {
                if (!_desktopsTried)
                {
                    _desktopsTried = true;
                    try { _desktops = (IVirtualDesktopManager)new VirtualDesktopManagerClass(); }
                    catch { _desktops = null; }
                }
                return _desktops;
            }
        }

        // 1 = on the desktop the user is looking at, 0 = on another one,
        // -1 = this Windows cannot say.
        internal static int OnCurrentDesktop(IntPtr h)
        {
            IVirtualDesktopManager vdm = Desktops;
            if (vdm == null || h == IntPtr.Zero) return -1;
            try
            {
                int on;
                if (vdm.IsWindowOnCurrentVirtualDesktop(h, out on) != 0) return -1;
                return on != 0 ? 1 : 0;
            }
            catch { return -1; }
        }

        // Is this session's banner - the thing carrying the Stop button - on the
        // desktop the user is actually looking at? The whole accountability
        // story depends on the answer being yes.
        internal static int OverlayHere() { return OnCurrentDesktop(_bannerHwnd); }

        static void FollowToCurrentDesktop()
        {
            IVirtualDesktopManager vdm = Desktops;
            if (vdm == null || _bannerHwnd == IntPtr.Zero) return;
            // Cheap, but not free, and this runs on every action.
            int now = Environment.TickCount;
            if (now - _lastFollowTick < 1000 && _lastFollowTick != 0) return;
            _lastFollowTick = now;
            try
            {
                if (OnCurrentDesktop(_bannerHwnd) != 0) return;

                // Which desktop is current? Ask a window that is already on it.
                IntPtr fg = Native.GetForegroundWindow();
                if (fg == IntPtr.Zero || IsAnyOverlayWindow(fg)) return;
                Guid id;
                if (vdm.GetWindowDesktopId(fg, out id) != 0 || id == Guid.Empty) return;

                IntPtr[] all = new IntPtr[] { _markerHwnd, _ringHwnd, _bannerHwnd, _cursorHwnd };
                foreach (IntPtr h in all)
                {
                    if (h == IntPtr.Zero) continue;
                    try { vdm.MoveWindowToDesktop(h, ref id); } catch { }
                }
            }
            catch { }
        }

        internal static void MarkActive()
        {
            FollowToCurrentDesktop();
            System.Threading.Interlocked.Exchange(ref _lastActiveTicks, DateTime.UtcNow.Ticks);
            if (!Enabled || _banner == null) return;
            try
            {
                _banner.BeginInvoke((MethodInvoker)delegate
                {
                    try
                    {
                        _ring.Appear();
                        _banner.Appear();
                        if (_idleTimer != null) { _idleTimer.Stop(); _idleTimer.Start(); }
                    }
                    catch { }
                });
            }
            catch { }
        }

        // rect is screen coordinates; label says what happened and to what.
        internal static void Flash(int[] rect, string label)
        {
            if (!Enabled || rect == null || _marker == null) return;
            try
            {
                _marker.BeginInvoke((MethodInvoker)delegate
                {
                    try
                    {
                        Rectangle r = new Rectangle(rect[0], rect[1], rect[2], rect[3]);
                        _marker.Flash(r, label);
                        if (_cursor != null) _cursor.MoveTo(r.Left + r.Width / 2, r.Top + r.Height / 2);
                    }
                    catch { }
                });
            }
            catch { }
        }

        internal static void Stop()
        {
            try { if (_marker != null) _marker.BeginInvoke((MethodInvoker)delegate { Application.ExitThread(); }); }
            catch { }
        }

        internal static GraphicsPath RoundRect(RectangleF r, float radius)
        {
            GraphicsPath p = new GraphicsPath();
            float d = radius * 2;
            if (d > r.Height) d = r.Height;
            if (d > r.Width) d = r.Width;
            if (d <= 0) { p.AddRectangle(r); return p; }
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        internal static Color Shade(Color c, float amount)
        {
            return Color.FromArgb(c.A,
                (int)Math.Max(0, Math.Min(255, c.R * (1 - amount))),
                (int)Math.Max(0, Math.Min(255, c.G * (1 - amount))),
                (int)Math.Max(0, Math.Min(255, c.B * (1 - amount))));
        }

        // ------------------------------------------------------------------
        // Shared base: layered, topmost, never activating, per-pixel alpha.
        // ------------------------------------------------------------------
        abstract class GhostForm : Form
        {
            IntPtr _hBitmap = IntPtr.Zero;
            Size _cached = Size.Empty;
            byte _alpha = 255;
            System.Windows.Forms.Timer _anim;
            Action _animDone;

            protected GhostForm(bool clickThrough)
            {
                ClickThrough = clickThrough;
                FormBorderStyle = FormBorderStyle.None;
                ShowInTaskbar = false;
                TopMost = true;
                StartPosition = FormStartPosition.Manual;
                // No TransparencyKey and no background painting: the entire
                // surface comes from UpdateLayeredWindow.
                SetStyle(ControlStyles.Opaque, true);
            }

            protected bool ClickThrough;
            protected override bool ShowWithoutActivation { get { return true; } }

            protected override CreateParams CreateParams
            {
                get
                {
                    CreateParams cp = base.CreateParams;
                    cp.ExStyle |= 0x00000080    // WS_EX_TOOLWINDOW  - out of alt-tab
                               |  0x08000000    // WS_EX_NOACTIVATE  - never takes focus
                               |  0x00080000;   // WS_EX_LAYERED
                    if (ClickThrough) cp.ExStyle |= 0x00000020;  // WS_EX_TRANSPARENT
                    return cp;
                }
            }

            protected override void OnPaintBackground(PaintEventArgs e) { }
            protected override void OnPaint(PaintEventArgs e) { }

            // Subclasses draw onto a fully transparent surface.
            protected abstract void Render(Graphics g);

            protected void Redraw()
            {
                if (!IsHandleCreated || Width <= 0 || Height <= 0) return;
                ReleaseBitmap();
                using (Bitmap bmp = new Bitmap(Width, Height, PixelFormat.Format32bppArgb))
                {
                    using (Graphics g = Graphics.FromImage(bmp))
                    {
                        g.Clear(Color.Transparent);
                        g.SmoothingMode = SmoothingMode.AntiAlias;
                        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
                        Render(g);
                    }
                    _hBitmap = bmp.GetHbitmap(Color.FromArgb(0));
                    _cached = new Size(Width, Height);
                }
                Push();
            }

            // Blits the cached surface at the current position and alpha. No
            // allocation and no repaint, which is what makes fading a window the
            // size of the desktop affordable.
            protected void Push()
            {
                if (_hBitmap == IntPtr.Zero || !IsHandleCreated) return;
                IntPtr screenDc = GetDC(IntPtr.Zero);
                IntPtr memDc = CreateCompatibleDC(screenDc);
                IntPtr old = SelectObject(memDc, _hBitmap);
                try
                {
                    NSIZE size = new NSIZE(_cached.Width, _cached.Height);
                    NPOINT src = new NPOINT(0, 0);
                    NPOINT dst = new NPOINT(Left, Top);
                    BLENDFUNCTION blend = new BLENDFUNCTION();
                    blend.BlendOp = AC_SRC_OVER;
                    blend.BlendFlags = 0;
                    blend.SourceConstantAlpha = _alpha;
                    blend.AlphaFormat = AC_SRC_ALPHA;
                    UpdateLayeredWindow(Handle, screenDc, ref dst, ref size, memDc, ref src, 0, ref blend, ULW_ALPHA);
                }
                finally
                {
                    SelectObject(memDc, old);
                    DeleteDC(memDc);
                    ReleaseDC(IntPtr.Zero, screenDc);
                }
            }

            void ReleaseBitmap()
            {
                if (_hBitmap != IntPtr.Zero) { DeleteObject(_hBitmap); _hBitmap = IntPtr.Zero; }
            }

            protected float Alpha
            {
                get { return _alpha / 255f; }
                set
                {
                    byte a = (byte)Math.Max(0, Math.Min(255, (int)(value * 255)));
                    if (a == _alpha) return;
                    _alpha = a;
                    Push();
                }
            }

            protected void PlaceAt(int x, int y) { Location = new Point(x, y); Push(); }

            // Entering elements ease out: quick to arrive, gentle to settle.
            protected void Animate(int durationMs, Action<float> step, Action done)
            {
                StopAnimation();
                DateTime start = DateTime.UtcNow;
                _animDone = done;
                _anim = new System.Windows.Forms.Timer();
                _anim.Interval = 16;
                _anim.Tick += delegate
                {
                    double elapsed = (DateTime.UtcNow - start).TotalMilliseconds;
                    float t = durationMs <= 0 ? 1f : (float)Math.Min(1.0, elapsed / durationMs);
                    float e = 1f - (float)Math.Pow(1 - t, 3);
                    try { step(e); } catch { }
                    if (t >= 1f)
                    {
                        Action d = _animDone;
                        StopAnimation();
                        if (d != null) { try { d(); } catch { } }
                    }
                };
                _anim.Start();
            }

            protected void StopAnimation()
            {
                _animDone = null;
                if (_anim != null) { _anim.Stop(); _anim.Dispose(); _anim = null; }
            }

            protected static float Lerp(float a, float b, float t) { return a + (b - a) * t; }

            protected override void Dispose(bool disposing)
            {
                if (disposing) { StopAnimation(); ReleaseBitmap(); }
                base.Dispose(disposing);
            }
        }

        // ------------------------------------------------------------------
        sealed class RingForm : GhostForm
        {
            const int RingW = 4;

            internal RingForm() : base(true) { Bounds = SystemInformation.VirtualScreen; }

            protected override void Render(Graphics g)
            {
                using (Pen pen = new Pen(Accent, RingW))
                {
                    pen.Alignment = PenAlignment.Inset;
                    g.DrawRectangle(pen, new Rectangle(0, 0, Width - 1, Height - 1));
                }
            }

            internal void Appear()
            {
                if (Visible) return;
                Bounds = SystemInformation.VirtualScreen;
                Alpha = 0;
                Redraw();
                Show();
                TopMost = true;
                Animate(220, delegate(float t) { Alpha = t; }, null);
            }

            internal void Vanish()
            {
                if (!Visible) return;
                float from = Alpha;
                Animate(180, delegate(float t) { Alpha = from * (1 - t); }, delegate { Hide(); });
            }
        }

        // ------------------------------------------------------------------
        // The banner. The only surface here that accepts a click, because Stop
        // has to be pressable. With per-pixel alpha the transparent corners pass
        // clicks through on their own.
        sealed class BannerForm : GhostForm
        {
            const string BaseMessage = "Claude is using your computer";
            const string Action_ = "Stop";

            // Only says which session it is when there is another one to be
            // confused with. One Claude on the machine needs no qualifier.
            static string MessageText()
            {
                string m = BaseMessage;
                if (_peers > 0 && !string.IsNullOrEmpty(_sessionLabel))
                    m = m + " (" + _sessionLabel + " of " + (_peers + 1).ToString(System.Globalization.CultureInfo.InvariantCulture) + ")";
                if (!string.IsNullOrEmpty(_status))
                    m = m + " 00B7 " + _status;
                return m;
            }

            // Which monitor the banner belongs on. Centring it on the virtual
            // screen looks right on one display and is wrong on two: the middle
            // of the virtual screen is the seam between them, so the banner ends
            // up split down the gap, or on whichever monitor happens to own the
            // midpoint. It belongs on the screen the person is looking at, which
            // is the one holding the window they are working in.
            static Rectangle HostScreen()
            {
                try
                {
                    IntPtr fg = Native.GetForegroundWindow();
                    if (fg != IntPtr.Zero && !IsAnyOverlayWindow(fg))
                        return Screen.FromHandle(fg).Bounds;
                }
                catch { }
                try { return Screen.PrimaryScreen.Bounds; }
                catch { return SystemInformation.VirtualScreen; }
            }

            // Held for as long as the banner is up, so a change of foreground
            // mid-run does not make it hop between monitors.
            Rectangle _screen = Rectangle.Empty;

            // Row for this session, one banner height apart, on its own monitor.
            int RestY()
            {
                Rectangle sc = _screen.IsEmpty ? HostScreen() : _screen;
                return sc.Y + 14 + _slot * (H + 10);
            }
            const int H = 54, PadL = 20, PadR = 8, Gap = 16, StopH = 38, StopPadX = 20;
            const int DotSize = 8, DotGap = 12;

            Rectangle _stopRect;
            bool _hover, _pressed;
            readonly System.Windows.Forms.Timer _pulse;
            float _phase;

            internal BannerForm() : base(false)
            {
                _pulse = new System.Windows.Forms.Timer();
                _pulse.Interval = 66;
                _pulse.Tick += delegate
                {
                    _phase += 0.06f;
                    if (_phase > 1f) _phase -= 1f;
                    Redraw();
                };
            }

            static int Measure(string text, float size, FontStyle style)
            {
                using (Bitmap b = new Bitmap(1, 1))
                using (Graphics g = Graphics.FromImage(b))
                using (Font f = new Font(UiFont, size, style))
                    return (int)Math.Ceiling(g.MeasureString(text, f).Width);
            }

            static int MeasureWidth()
            {
                return PadL + DotSize + DotGap + Measure(MessageText(), 11f, FontStyle.Regular)
                     + Gap + (Measure(Action_, 10.5f, FontStyle.Bold) + StopPadX * 2) + PadR;
            }

            // The label can change while the banner is up - another session
            // starts, or the last one leaves - so it can be re-measured in place.
            internal void Relayout()
            {
                if (!Visible) return;
                int w = MeasureWidth();
                Rectangle sc = _screen.IsEmpty ? HostScreen() : _screen;
                Bounds = new Rectangle(sc.X + (sc.Width - w) / 2, RestY(), w, H);
                LayoutStop();
                Redraw();
            }

            void LayoutStop()
            {
                int w = Measure(Action_, 10.5f, FontStyle.Bold) + StopPadX * 2;
                _stopRect = new Rectangle(Width - PadR - w, (H - StopH) / 2, w, StopH);
            }

            internal void Appear()
            {
                if (Visible) return;
                int w = MeasureWidth();
                // Pick the monitor once, as it appears, and keep it.
                _screen = HostScreen();
                int restY = RestY();
                Bounds = new Rectangle(_screen.X + (_screen.Width - w) / 2, restY - 8, w, H);
                LayoutStop();
                Alpha = 0;
                Redraw();
                Show();
                TopMost = true;
                _pulse.Start();
                Animate(180, delegate(float t)
                {
                    Alpha = t;
                    PlaceAt(Left, (int)Lerp(restY - 8, restY, t));
                }, null);
            }

            internal void Vanish()
            {
                if (!Visible) { _pulse.Stop(); return; }
                _pulse.Stop();
                _hover = _pressed = false;
                float from = Alpha;
                int restY = Top;
                Animate(150, delegate(float t)
                {
                    Alpha = from * (1 - t);
                    PlaceAt(Left, (int)Lerp(restY, restY - 6, t));
                }, delegate { Hide(); PlaceAt(Left, restY); });
            }

            protected override void OnMouseMove(MouseEventArgs e)
            {
                bool over = _stopRect.Contains(e.Location);
                if (over != _hover)
                {
                    _hover = over;
                    Cursor = over ? Cursors.Hand : Cursors.Default;
                    Redraw();
                }
                base.OnMouseMove(e);
            }

            protected override void OnMouseLeave(EventArgs e)
            {
                if (_hover || _pressed) { _hover = _pressed = false; Cursor = Cursors.Default; Redraw(); }
                base.OnMouseLeave(e);
            }

            protected override void OnMouseDown(MouseEventArgs e)
            {
                if (_stopRect.Contains(e.Location)) { _pressed = true; Redraw(); }
                base.OnMouseDown(e);
            }

            protected override void OnMouseUp(MouseEventArgs e)
            {
                bool fire = _pressed && _stopRect.Contains(e.Location);
                _pressed = false;
                if (fire)
                {
                    RequestStop();
                    Vanish();
                    try { _ring.Vanish(); _cursor.Vanish(); } catch { }
                }
                else Redraw();
                base.OnMouseUp(e);
            }

            protected override void Render(Graphics g)
            {
                RectangleF body = new RectangleF(0, 0, Width, H);
                using (SolidBrush bg = new SolidBrush(Accent))
                using (GraphicsPath path = RoundRect(body, H / 2f))
                    g.FillPath(bg, path);

                // Status dot: breathes while working. The only motion that says
                // something true - it is still going, and it leaves when done.
                float t = (float)((Math.Sin(_phase * Math.PI * 2) + 1) / 2);
                int a = (int)(110 + 145 * t);
                float grow = 1f + 0.25f * t;
                float ds = DotSize * grow;
                using (SolidBrush dot = new SolidBrush(Color.FromArgb(a, Paper)))
                    g.FillEllipse(dot, PadL + (DotSize - ds) / 2f, (H - ds) / 2f, ds, ds);

                using (Font f = new Font(UiFont, 11f, FontStyle.Regular))
                using (SolidBrush fg = new SolidBrush(Paper))
                using (StringFormat sf = new StringFormat())
                {
                    sf.LineAlignment = StringAlignment.Center;
                    sf.FormatFlags = StringFormatFlags.NoWrap;
                    float x = PadL + DotSize + DotGap;
                    g.DrawString(MessageText(), f, fg, new RectangleF(x, 0, _stopRect.Left - Gap - x, H), sf);
                }

                Color fill = _pressed ? Shade(Paper, 0.12f) : (_hover ? Color.White : Paper);
                using (SolidBrush sb = new SolidBrush(fill))
                using (GraphicsPath sp = RoundRect(_stopRect, _stopRect.Height / 2f))
                    g.FillPath(sb, sp);

                using (Font af = new Font(UiFont, 10.5f, FontStyle.Bold))
                using (SolidBrush at = new SolidBrush(Ink))
                using (StringFormat sf = new StringFormat())
                {
                    sf.Alignment = StringAlignment.Center;
                    sf.LineAlignment = StringAlignment.Center;
                    g.DrawString(Action_, af, at, _stopRect, sf);
                }
            }
        }

        // ------------------------------------------------------------------
        sealed class CursorForm : GhostForm
        {
            readonly System.Windows.Forms.Timer _hover;
            bool _showLabel;
            const int ArrowW = 22, ArrowH = 32, LabelGap = 6;

            internal CursorForm() : base(true)
            {
                Size = new Size(220, 64);
                // Polling beats hit-testing: this window stays click-through, so
                // it can never swallow a click meant for an app underneath.
                _hover = new System.Windows.Forms.Timer();
                _hover.Interval = 120;
                _hover.Tick += delegate { UpdateHover(); };
            }

            internal void MoveTo(int x, int y)
            {
                // Two sessions acting on the same control would put two cursors
                // in exactly the same place, and the top one would be the only
                // one you ever saw. A few pixels of stagger per session keeps
                // both visible without moving either far from what it touched.
                x += _slot * 11;
                y += _slot * 7;
                if (!Visible)
                {
                    Location = new Point(x, y);
                    Alpha = 0;
                    Redraw();
                    Show();
                    TopMost = true;
                    _hover.Start();
                    Animate(160, delegate(float t) { Alpha = t; }, null);
                    return;
                }
                Point from = Location;
                // A short glide beats a jump: you can follow where it went.
                Animate(200, delegate(float t)
                {
                    PlaceAt((int)Lerp(from.X, x, t), (int)Lerp(from.Y, y, t));
                }, null);
            }

            internal void Vanish()
            {
                _hover.Stop();
                _showLabel = false;
                if (!Visible) return;
                float from = Alpha;
                Animate(180, delegate(float t) { Alpha = from * (1 - t); }, delegate { Hide(); });
            }

            void UpdateHover()
            {
                NPOINT p;
                if (!GetCursorPos(out p)) return;
                Rectangle near = new Rectangle(Left - 24, Top - 24, ArrowW + 48, ArrowH + 48);
                bool want = near.Contains(p.X, p.Y);
                if (want != _showLabel) { _showLabel = want; Redraw(); }
            }

            static GraphicsPath ArrowPath()
            {
                PointF[] pts = {
                    new PointF(0f,    0f),    new PointF(0f,    23.5f), new PointF(6.2f,  18f),
                    new PointF(9.7f,  26.3f), new PointF(13.8f, 24.3f), new PointF(10.4f, 16f),
                    new PointF(16.6f, 16f),
                };
                GraphicsPath p = new GraphicsPath();
                p.AddPolygon(pts);
                return p;
            }

            protected override void Render(Graphics g)
            {
                using (GraphicsPath arrow = ArrowPath())
                using (SolidBrush fill = new SolidBrush(Accent))
                using (Pen edge = new Pen(Paper, 1.6f))
                {
                    edge.LineJoin = LineJoin.Round;
                    g.DrawPath(edge, arrow);
                    g.FillPath(fill, arrow);
                }

                if (!_showLabel) return;

                // Named for its session once there is another one to confuse it
                // with, so the colour has a caption rather than being a code.
                string label = (_peers > 0 && !string.IsNullOrEmpty(_sessionLabel))
                    ? "Claude - " + _sessionLabel
                    : "Claude Cursor";
                using (Font f = new Font(UiFont, 9f, FontStyle.Regular))
                {
                    SizeF sz = g.MeasureString(label, f);
                    RectangleF tag = new RectangleF(ArrowW + LabelGap, ArrowH * 0.45f, sz.Width + 18, sz.Height + 10);
                    using (SolidBrush bg = new SolidBrush(Accent))
                    using (GraphicsPath path = RoundRect(tag, tag.Height / 2f))
                        g.FillPath(bg, path);
                    using (SolidBrush fg = new SolidBrush(Paper))
                        g.DrawString(label, f, fg, tag.X + 9, tag.Y + 5);
                }
            }
        }

        // ------------------------------------------------------------------
        // Names the control as it is touched, so what is happening is readable
        // at a glance instead of being an unexplained rectangle.
        sealed class MarkerForm : GhostForm
        {
            readonly System.Windows.Forms.Timer _timer;
            string _label = "";
            Rectangle _target;
            const int TagH = 26;

            internal MarkerForm() : base(true)
            {
                Bounds = new Rectangle(-10000, -10000, 10, 10);
                _timer = new System.Windows.Forms.Timer();
                _timer.Interval = 620;
                _timer.Tick += delegate
                {
                    _timer.Stop();
                    if (!Visible) return;
                    float from = Alpha;
                    Animate(240, delegate(float t) { Alpha = from * (1 - t); }, delegate { Hide(); });
                };
            }

            internal void Flash(Rectangle target, string label)
            {
                StopAnimation();
                _label = label ?? "";
                _target = target;
                int w = Math.Max(target.Width + 8, TagWidth() + 8);
                Bounds = new Rectangle(target.X - 4, target.Y - TagH - 4, w, target.Height + TagH + 8);
                Alpha = 1;
                Redraw();
                if (!Visible) Show();
                TopMost = true;
                _timer.Stop();
                _timer.Start();
            }

            int TagWidth()
            {
                if (_label.Length == 0) return 0;
                using (Bitmap b = new Bitmap(1, 1))
                using (Graphics g = Graphics.FromImage(b))
                using (Font f = new Font(UiFont, 8.5f, FontStyle.Regular))
                    return (int)Math.Ceiling(g.MeasureString(_label, f).Width) + 18;
            }

            protected override void Render(Graphics g)
            {
                Rectangle box = new Rectangle(4, TagH + 4, _target.Width, _target.Height);
                using (Pen pen = new Pen(Accent, 2f))
                {
                    pen.Alignment = PenAlignment.Inset;
                    g.DrawRectangle(pen, box);
                }

                if (_label.Length == 0) return;
                using (Font f = new Font(UiFont, 8.5f, FontStyle.Regular))
                {
                    SizeF sz = g.MeasureString(_label, f);
                    RectangleF tag = new RectangleF(4, 2, sz.Width + 18, TagH - 2);
                    using (SolidBrush bg = new SolidBrush(Accent))
                    using (GraphicsPath path = RoundRect(tag, (TagH - 2) / 2f))
                        g.FillPath(bg, path);
                    using (SolidBrush fg = new SolidBrush(Paper))
                        g.DrawString(_label, f, fg, tag.X + 9, tag.Y + 4);
                }
            }
        }
    }
}
