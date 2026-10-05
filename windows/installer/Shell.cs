using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Net;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Finesse.Setup
{
    /// <summary>The window: borderless, the page draws its own title bar. Messages from the page are
    /// {id, cmd, args}; each gets {id, ok, result | error}. Long jobs also send {event, data}.</summary>
    class Shell : Form
    {
        readonly Options opt;
        readonly WebView2 web;
        readonly Engine engine;
        readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        bool closing, allowClose;
        public int ExitCode;

        public Shell(Options o)
        {
            opt = o;
            Text = "Finesse Setup";
            Icon = Embedded.Icon();
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            AutoScaleDimensions = new SizeF(96F, 96F);
            ClientSize = new Size(1040, 660);
            MinimumSize = new Size(880, 600);
            BackColor = Color.FromArgb(8, 9, 14);
            engine = new Engine(Emit);
            web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(8, 9, 14) };
            Controls.Add(web);
            Load += async (s, e) => await Init();
        }

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ClassStyle |= 0x20000;  // CS_DROPSHADOW: a shadow without a frame
                cp.Style |= 0x20000;       // WS_MINIMIZEBOX: minimize from the taskbar
                return cp;
            }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            Native.Style(Handle);
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            // The page decides: mid-install it asks first, then sends close again with force.
            if (!allowClose && web.CoreWebView2 != null && !closing)
            {
                e.Cancel = true;
                Emit("closeRequested", null);
                return;
            }
            base.OnFormClosing(e);
        }

        async Task Init()
        {
            string data = Path.Combine(Program.Home, "webview");
            CoreWebView2Environment env;
            while (true)
            {
                try
                {
                    CoreWebView2Environment.SetLoaderDllFolderPath(Embedded.Loader());
                    var options = new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required --disable-features=msSmartScreenProtection");
                    env = await CoreWebView2Environment.CreateAsync(null, data, options);
                    await web.EnsureCoreWebView2Async(env);
                    break;
                }
                catch (WebView2RuntimeNotFoundException)
                {
                    if (!await InstallWebView2()) { allowClose = true; Close(); return; }
                }
                catch (Exception ex)
                {
                    Log.Write("WebView2 failed: " + ex);
                    MessageBox.Show(this, "Finesse Setup couldn't open its window (" + ex.Message + ").\n\nDetails are in " + Log.File, "Finesse Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    allowClose = true; Close(); return;
                }
            }

            var cw = web.CoreWebView2;
            cw.Settings.AreDevToolsEnabled = opt.Dev;
            cw.Settings.AreDefaultContextMenusEnabled = opt.Dev;
            cw.Settings.AreBrowserAcceleratorKeysEnabled = opt.Dev;
            cw.Settings.IsZoomControlEnabled = false;
            cw.Settings.IsStatusBarEnabled = false;
            cw.Settings.IsPinchZoomEnabled = false;
            cw.Settings.IsSwipeNavigationEnabled = false;
            cw.Settings.AreDefaultScriptDialogsEnabled = opt.Dev;
            string ui = opt.UiDir != null ? Path.GetFullPath(opt.UiDir) : Embedded.Ui();
            cw.SetVirtualHostNameToFolderMapping("setup.finesse", ui, CoreWebView2HostResourceAccessKind.Allow);
            cw.WebMessageReceived += OnMessage;
            cw.NewWindowRequested += (s, e) => { e.Handled = true; Engine.OpenUrl(e.Uri); };
            cw.NavigationStarting += (s, e) =>
            {
                // Only our own page lives in this window; links open in the browser.
                if (!e.Uri.StartsWith("https://setup.finesse/", StringComparison.OrdinalIgnoreCase)) { e.Cancel = true; Engine.OpenUrl(e.Uri); }
            };
            var q = new List<string> { "v=" + Uri.EscapeDataString(Program.Version) };
            if (opt.Resume) q.Add("resume=1");
            if (opt.Uninstall) q.Add("uninstall=1");
            if (opt.SelfTest != null) q.Add("selftest=1");
            cw.Navigate("https://setup.finesse/index.html?" + string.Join("&", q));
        }

        /// <summary>Old Windows 10 without Edge's WebView2: offer to fetch it (Microsoft's own small installer).</summary>
        async Task<bool> InstallWebView2()
        {
            var answer = MessageBox.Show(this,
                "Finesse Setup needs Microsoft Edge WebView2, a free part of Windows that this PC doesn't have yet.\n\nGet it now? (About 2 MB, from Microsoft.)",
                "Finesse Setup", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
            if (answer != DialogResult.Yes) return false;
            try
            {
                string file = Path.Combine(Path.GetTempPath(), "MicrosoftEdgeWebview2Setup.exe");
                using (var wc = new WebClient()) await wc.DownloadFileTaskAsync("https://go.microsoft.com/fwlink/p/?LinkId=2124703", file);
                var p = System.Diagnostics.Process.Start(file, "/silent /install");
                await Task.Run(() => p.WaitForExit());
                return true;
            }
            catch (Exception ex)
            {
                Log.Write("WebView2 install failed: " + ex);
                MessageBox.Show(this, "That didn't work (" + ex.Message + "). Install \"Microsoft Edge WebView2 Runtime\" from microsoft.com, then open Finesse Setup again.", "Finesse Setup");
                return false;
            }
        }

        void Emit(string evt, object data)
        {
            Post(new Dictionary<string, object> { ["event"] = evt, ["data"] = data });
        }

        void Post(object message)
        {
            if (IsDisposed) return;
            string text = json.Serialize(message);
            try
            {
                if (InvokeRequired) BeginInvoke((Action)(() => web.CoreWebView2?.PostWebMessageAsJson(text)));
                else web.CoreWebView2?.PostWebMessageAsJson(text);
            }
            catch (ObjectDisposedException) { }
            catch (InvalidOperationException) { }
        }

        void Reply(object id, object result, string error = null)
        {
            var m = new Dictionary<string, object> { ["id"] = id, ["ok"] = error == null };
            if (error == null) m["result"] = result; else m["error"] = error;
            Post(m);
        }

        void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            Dictionary<string, object> msg;
            try { msg = json.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson); }
            catch { return; }
            object id = msg.ContainsKey("id") ? msg["id"] : null;
            string cmd = msg.ContainsKey("cmd") ? msg["cmd"] as string : null;
            var args = (msg.ContainsKey("args") ? msg["args"] as Dictionary<string, object> : null) ?? new Dictionary<string, object>();
            string Str(string k, string d = null) => args.ContainsKey(k) && args[k] != null ? Convert.ToString(args[k]) : d;
            int Int(string k, int d) => args.ContainsKey(k) && args[k] != null ? Convert.ToInt32(args[k]) : d;
            bool Bool(string k) => args.ContainsKey(k) && args[k] is bool b && b;

            // Things that touch the window happen here, on the window's thread.
            switch (cmd)
            {
                case "window":
                    switch (Str("action"))
                    {
                        case "drag": Native.DragWindow(Handle); break;
                        case "minimize": WindowState = FormWindowState.Minimized; break;
                        case "close": allowClose = true; closing = true; Close(); break;
                    }
                    Reply(id, true);
                    return;
                case "pickFolder":
                    Reply(id, Native.PickFolder(Handle, "Where should your movies and shows live?", Str("start")));
                    return;
                case "open":
                    Engine.OpenUrl(Str("url"));
                    Reply(id, true);
                    return;
                case "shot":
                    Shot(id, Str("name"));
                    return;
                case "quit":
                    ExitCode = Int("code", 0);
                    allowClose = true; closing = true; Close();
                    return;
            }

            // Everything else may take a while: off the window's thread.
            Task.Run(() =>
            {
                try
                {
                    object result;
                    switch (cmd)
                    {
                        case "info": result = engine.Info(); break;
                        case "log": result = Log.Tail(60); break;
                        case "downloadDocker": result = engine.DownloadDocker(); break;
                        case "installDocker": result = engine.InstallDocker(Str("file")); break;
                        case "startDocker": result = engine.StartDocker(); break;
                        case "installFinesse": result = engine.InstallFinesse(Str("media"), Int("port", 8080)); break;
                        case "firewall": result = engine.Firewall(Int("port", 8080)); break;
                        case "finish": result = engine.Finish(Int("port", 8080)); break;
                        case "startFinesse": result = engine.StartFinesse(); break;
                        case "restart": result = engine.Restart(); break;
                        case "uninstall": result = engine.Uninstall(Bool("deleteSettings")); break;
                        case "defaultMedia": result = engine.DefaultMedia(); break;
                        case "checkMedia": result = engine.CheckMedia(Str("path")); break;
                        default: throw new InvalidOperationException("Unknown command: " + cmd);
                    }
                    Reply(id, result);
                }
                catch (Exception ex)
                {
                    Log.Write($"{cmd} failed: {ex}");
                    Reply(id, null, ex is FriendlyException ? ex.Message : "Something went wrong: " + ex.Message);
                }
            });
        }

        /// <summary>Self-test (CI): saves what the page shows right now as a PNG.</summary>
        async void Shot(object id, string name)
        {
            try
            {
                Directory.CreateDirectory(opt.SelfTest ?? "selftest");
                string file = Path.Combine(opt.SelfTest ?? "selftest", (name ?? "shot") + ".png");
                using (var f = File.Create(file))
                    await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, f);
                Reply(id, file);
            }
            catch (Exception ex) { Reply(id, null, ex.Message); }
        }
    }

    /// <summary>An error whose message is already written for people (shown as is).</summary>
    class FriendlyException : Exception
    {
        public FriendlyException(string message) : base(message) { }
    }
}
