using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace Finesse.Setup
{
    /// <summary>Where Finesse lives on Windows.
    ///  - C:\Program Files\Finesse: Finesse.exe (this program: setup, the service and uninstall) and app\&lt;version&gt;
    ///    (Node, the server and the web app), with current.txt naming the version to run;
    ///  - C:\ProgramData\Finesse: everything Finesse and its apps keep (FINESSE_ROOT), service.json (port and media
    ///    folder) and logs;
    ///  - the media folder the person picked (FINESSE_DATA).</summary>
    static class Paths
    {
        public static string Install => Path.Combine(Environment.GetEnvironmentVariable("ProgramW6432") ?? Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Finesse");
        public static string Exe => Path.Combine(Install, "Finesse.exe");
        public static string Data => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Finesse");
        public static string Settings => Path.Combine(Data, "service.json");
        public static string Logs => Path.Combine(Data, "logs");
        public static string Current => Path.Combine(Install, "current.txt");
        public static string Previous => Path.Combine(Install, "previous.txt");
        public static string SetupCode => Path.Combine(Data, "config", "finesse", "setup-code");
    }

    /// <summary>service.json: what the installer chose.</summary>
    class ServiceSettings
    {
        public int Port = 8080;
        public string Media = "";

        public static ServiceSettings Load()
        {
            try
            {
                var d = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(Paths.Settings));
                return new ServiceSettings { Port = Convert.ToInt32(d["port"]), Media = Convert.ToString(d["media"]) };
            }
            catch { return null; }
        }

        public void Save()
        {
            Directory.CreateDirectory(Paths.Data);
            File.WriteAllText(Paths.Settings, new JavaScriptSerializer().Serialize(new Dictionary<string, object> { ["port"] = Port, ["media"] = Media }));
        }
    }

    /// <summary>The Finesse service: runs Finesse (Node) and keeps it running. Finesse in turn runs its apps, all
    /// inside one job object, so stopping the service (or the service dying) ends every one of them.</summary>
    class FinesseService : ServiceBase
    {
        public const string Name = "Finesse";
        /// <summary>Finesse exits with this when a new version is in place (server/src/stack/winupdate.ts).</summary>
        const int NewVersion = 75;

        Thread loop;
        Process node;
        IntPtr job;
        volatile bool stopping;
        readonly object gate = new object();

        public FinesseService()
        {
            ServiceName = Name;
            CanStop = true;
            CanShutdown = true;
            AutoLog = false;
        }

        protected override void OnStart(string[] args)
        {
            Directory.CreateDirectory(Paths.Logs);
            Log.Open(Path.Combine(Paths.Logs, "service.log"));
            Log.Write($"Finesse service {Program.Version} starting");
            job = Native.KillOnCloseJob();
            loop = new Thread(Supervise) { IsBackground = true, Name = "finesse" };
            loop.Start();
        }

        protected override void OnStop() => Stop("stop");
        protected override void OnShutdown() => Stop("shutdown");

        /// <summary>Finesse stops its apps first (each through its own API), then exits. It's asked by closing its input.</summary>
        void Stop(string why)
        {
            stopping = true;
            RequestAdditionalTime(120000);
            Log.Write($"service {why}: asking Finesse to stop");
            Process p;
            lock (gate) p = node;
            if (p != null && !p.HasExited)
            {
                try { p.StandardInput.WriteLine("stop"); p.StandardInput.Close(); } catch { }
                if (!p.WaitForExit(100000)) Log.Write("Finesse didn't stop in time: ending it");
            }
            Native.EndJob(job);
            loop?.Join(5000);
        }

        void Supervise()
        {
            int quickFailures = 0;
            while (!stopping)
            {
                var started = DateTime.UtcNow;
                int code;
                try { code = RunOnce(); }
                catch (Exception ex)
                {
                    Log.Write("couldn't start Finesse: " + ex.Message);
                    code = -1;
                }
                if (stopping) break;
                if (code == NewVersion)
                {
                    Log.Write("Finesse updated itself: starting the new version");
                    quickFailures = 0;
                    continue;
                }
                bool quick = DateTime.UtcNow - started < TimeSpan.FromSeconds(90);
                quickFailures = quick ? quickFailures + 1 : 0;
                // A new version that won't stay up: back to the one before it.
                if (quickFailures >= 3 && File.Exists(Paths.Previous))
                {
                    string back = File.ReadAllText(Paths.Previous).Trim();
                    if (back.Length > 0 && Directory.Exists(AppDir(back)))
                    {
                        Log.Write($"Finesse keeps stopping right after it starts: going back to {back}");
                        File.WriteAllText(Paths.Current, back);
                        File.Delete(Paths.Previous);
                        quickFailures = 0;
                    }
                }
                int wait = Math.Min(60, 2 << Math.Min(quickFailures, 5));
                Log.Write($"Finesse stopped (exit {code}); starting it again in {wait}s");
                for (int i = 0; i < wait * 10 && !stopping; i++) Thread.Sleep(100);
            }
        }

        static string AppDir(string version) => Path.Combine(Paths.Install, "app", version);

        int RunOnce()
        {
            string version = File.ReadAllText(Paths.Current).Trim();
            string dir = AppDir(version);
            var s = ServiceSettings.Load() ?? throw new InvalidOperationException("service.json is missing: run Finesse Setup again");
            var psi = new ProcessStartInfo(Path.Combine(dir, "node.exe"), $"--disable-warning=ExperimentalWarning \"{Path.Combine(dir, "server", "finesse-server.mjs")}\"")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = dir,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            foreach (var kv in EnvironmentFor(s, dir)) psi.EnvironmentVariables[kv.Key] = kv.Value;
            var log = new FinesseLog(Path.Combine(Paths.Logs, "finesse.log"));
            var p = new Process { StartInfo = psi };
            p.OutputDataReceived += (o, e) => { if (e.Data != null) log.Line(e.Data); };
            p.ErrorDataReceived += (o, e) => { if (e.Data != null) log.Line(e.Data); };
            p.Start();
            Native.AddToJob(job, p);
            lock (gate) node = p;
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            Log.Write($"Finesse {version} started (pid {p.Id}) on port {s.Port}");
            p.WaitForExit();
            lock (gate) node = null;
            int code = p.ExitCode;
            p.Dispose();
            return code;
        }

        /// <summary>What Finesse is told about this PC (server/src/config.ts, setup/apply.ts).</summary>
        public static Dictionary<string, string> EnvironmentFor(ServiceSettings s, string dir)
        {
            return new Dictionary<string, string>
            {
                ["FINESSE_HOST"] = "native",
                ["NODE_ENV"] = "production",
                ["PORT"] = s.Port.ToString(),
                ["FINESSE_ROOT"] = Paths.Data,
                ["FINESSE_DATA"] = s.Media,
                ["FINESSE_CONFIG_DIR"] = Path.Combine(Paths.Data, "config", "finesse"),
                ["FINESSE_WEB_DIR"] = Path.Combine(dir, "web"),
                ["FINESSE_SAMPLES_DIR"] = Path.Combine(dir, "samples"),
                ["FINESSE_INSTALL_DIR"] = Paths.Install,
                ["FINESSE_LAN_HOST"] = Engine.LanIp() ?? "",
                ["TZ"] = TimeZones.Local(),
            };
        }
    }

    /// <summary>Finesse's own output, kept to about 20 MB (the current file and one before it).</summary>
    class FinesseLog
    {
        readonly string file;
        readonly object gate = new object();
        public FinesseLog(string file) { this.file = file; }

        public void Line(string text)
        {
            lock (gate)
            {
                try
                {
                    var f = new FileInfo(file);
                    if (f.Exists && f.Length > 10_000_000)
                    {
                        File.Delete(file + ".1");
                        File.Move(file, file + ".1");
                    }
                    File.AppendAllText(file, text + System.Environment.NewLine);
                }
                catch { }
            }
        }
    }
}
