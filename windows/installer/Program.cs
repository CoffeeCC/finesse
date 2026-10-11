using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace Finesse.Setup
{
    class Options
    {
        public bool Service;     // run as the Finesse service (Windows starts it so)
        public bool Install;     // no window: install with --media (and --bundle), print the result (CI, scripts)
        public bool Quiet;       // with --uninstall: no window
        public bool DeleteSettings;
        public string Media;
        public string Bundle;    // a finesse-windows-*.zip on this PC instead of downloading this version's
        public bool Uninstall;   // from Settings → Apps
        public string SelfTest;  // CI: render each screen to PNGs in this folder, then quit
        public string UiDir;     // development: load the interface from a folder instead of the exe
        public bool Dev;         // development: devtools, reload

        public static Options Parse(string[] args)
        {
            var o = new Options();
            for (int i = 0; i < args.Length; i++)
            {
                switch (args[i].ToLowerInvariant())
                {
                    case "--service": o.Service = true; break;
                    case "--install": o.Install = true; break;
                    case "--quiet": o.Quiet = true; break;
                    case "--delete-settings": o.DeleteSettings = true; break;
                    case "--media": if (i + 1 < args.Length) o.Media = args[++i]; break;
                    case "--bundle": if (i + 1 < args.Length) o.Bundle = Path.GetFullPath(args[++i]); break;
                    case "--uninstall": o.Uninstall = true; break;
                    case "--dev": o.Dev = true; break;
                    case "--selftest": o.SelfTest = i + 1 < args.Length ? args[++i] : "selftest"; break;
                    case "--ui": if (i + 1 < args.Length) o.UiDir = args[++i]; break;
                }
            }
            return o;
        }
    }

    static class Program
    {
        public static string Version = typeof(Program).Assembly.GetName().Version.ToString(3);
        public static readonly string Home = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Finesse");

        [STAThread]
        static int Main(string[] args)
        {
            AppDomain.CurrentDomain.AssemblyResolve += Embedded.Resolve;
            return Run(args);
        }

        // Separate, so nothing from WebView2 loads before the resolver above is in place.
        [MethodImpl(MethodImplOptions.NoInlining)]
        static int Run(string[] args)
        {
            var opt = Options.Parse(args);
            System.Net.ServicePointManager.SecurityProtocol |= System.Net.SecurityProtocolType.Tls12;
            // The service: no window, nothing of WebView2.
            if (opt.Service)
            {
                System.ServiceProcess.ServiceBase.Run(new FinesseService());
                return 0;
            }
            Directory.CreateDirectory(Home);
            Log.Open(Path.Combine(Home, "setup.log"));
            Log.Write($"Finesse Setup {Version} starting ({string.Join(" ", args)}) on {Environment.OSVersion}, {RuntimeInformation.OSArchitecture}");
            if (opt.Install || (opt.Uninstall && opt.Quiet)) return Headless(opt);

            using (var one = new Mutex(true, "Local\\FinesseSetup", out bool first))
            {
                if (!first && opt.SelfTest == null)
                {
                    Native.FocusExisting("Finesse Setup");
                    return 0;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.ThreadException += (s, e) => Log.Write("UI error: " + e.Exception);
                AppDomain.CurrentDomain.UnhandledException += (s, e) => Log.Write("Fatal: " + e.ExceptionObject);
                var shell = new Shell(opt);
                Application.Run(shell);
                return shell.ExitCode;
            }
        }

        /// <summary>Without a window: FinesseSetup.exe --install --media D:\Finesse [--bundle finesse-windows.zip],
        /// or --uninstall --quiet [--delete-settings]. Prints what happened as JSON; exit code 0 when it worked.</summary>
        static int Headless(Options opt)
        {
            var engine = new Engine((ev, data) => Console.WriteLine(new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(new System.Collections.Generic.Dictionary<string, object> { ["event"] = ev, ["data"] = data })));
            try
            {
                object result = opt.Install ? engine.Install(opt.Media ?? (string)((System.Collections.Generic.Dictionary<string, object>)engine.DefaultMedia())["path"], opt.Bundle) : engine.Uninstall(opt.DeleteSettings);
                Console.WriteLine(new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(new System.Collections.Generic.Dictionary<string, object> { ["ok"] = true, ["result"] = result }));
                return 0;
            }
            catch (Exception ex)
            {
                Log.Write("headless failed: " + ex);
                Console.WriteLine(new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(new System.Collections.Generic.Dictionary<string, object> { ["ok"] = false, ["error"] = ex.Message }));
                return 1;
            }
        }
    }

    /// <summary>The WebView2 libraries and the interface live inside the exe.</summary>
    static class Embedded
    {
        public static Assembly Resolve(object sender, ResolveEventArgs e)
        {
            string name = new AssemblyName(e.Name).Name + ".dll";
            using (var s = typeof(Embedded).Assembly.GetManifestResourceStream("lib." + name))
            {
                if (s == null) return null;
                var bytes = new byte[s.Length];
                s.Read(bytes, 0, bytes.Length);
                return Assembly.Load(bytes);
            }
        }

        static string Folder()
        {
            string dir = Path.Combine(Program.Home, "setup", Program.Version);
            Directory.CreateDirectory(dir);
            return dir;
        }

        /// <summary>WebView2Loader.dll for this processor, next to nothing else of ours.</summary>
        public static string Loader()
        {
            string arch = RuntimeInformation.ProcessArchitecture == Architecture.Arm64 ? "arm64" : "x64";
            string dir = Path.Combine(Folder(), arch);
            Directory.CreateDirectory(dir);
            string file = Path.Combine(dir, "WebView2Loader.dll");
            if (!File.Exists(file)) Extract("native." + arch + ".WebView2Loader.dll", file);
            return dir;
        }

        /// <summary>The interface, unpacked once per version.</summary>
        public static string Ui()
        {
            string dir = Path.Combine(Folder(), "ui");
            string stamp = Path.Combine(dir, ".ok");
            if (File.Exists(stamp)) return dir;
            if (Directory.Exists(dir)) Directory.Delete(dir, true);
            using (var s = typeof(Embedded).Assembly.GetManifestResourceStream("ui.zip"))
            using (var zip = new ZipArchive(s, ZipArchiveMode.Read))
            {
                foreach (var entry in zip.Entries)
                {
                    string dest = Path.GetFullPath(Path.Combine(dir, entry.FullName.Replace('\\', '/')));
                    if (!dest.StartsWith(Path.GetFullPath(dir), StringComparison.OrdinalIgnoreCase)) continue;
                    if (entry.FullName.EndsWith("/") || entry.FullName.EndsWith("\\")) { Directory.CreateDirectory(dest); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(dest));
                    entry.ExtractToFile(dest, true);
                }
            }
            File.WriteAllText(stamp, Program.Version);
            return dir;
        }

        public static System.Drawing.Icon Icon()
        {
            using (var s = typeof(Embedded).Assembly.GetManifestResourceStream("finesse.ico"))
                return s == null ? null : new System.Drawing.Icon(s);
        }

        static void Extract(string resource, string file)
        {
            using (var s = typeof(Embedded).Assembly.GetManifestResourceStream(resource))
            using (var f = File.Create(file))
                s.CopyTo(f);
        }
    }

    static class Log
    {
        static readonly object Gate = new object();
        static string file;
        public static string File => file;

        public static void Open(string path)
        {
            file = path;
            try { if (new FileInfo(path).Exists && new FileInfo(path).Length > 2_000_000) System.IO.File.Delete(path); } catch { }
        }

        public static void Write(string line)
        {
            lock (Gate)
            {
                try { System.IO.File.AppendAllText(file, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss ") + line + Environment.NewLine); } catch { }
            }
        }

        public static string Tail(int lines = 40)
        {
            try
            {
                var all = System.IO.File.ReadAllLines(file);
                int from = Math.Max(0, all.Length - lines);
                return string.Join("\n", all, from, all.Length - from);
            }
            catch { return ""; }
        }
    }
}
