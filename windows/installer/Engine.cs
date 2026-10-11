using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.ServiceProcess;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32;

namespace Finesse.Setup
{
    /// <summary>What Finesse Setup does on the PC. Finesse runs as a Windows service (see Service.cs): no Docker, no
    /// WSL, nothing to turn on in the BIOS. Setup puts it in Program Files, picks the media folder, lets phones and TVs
    /// at home in through the firewall, and starts it. Finesse then installs the apps it needs itself.</summary>
    class Engine
    {
        const string Repo = "CoffeeCC/finesse";
        readonly Action<string, object> emit;

        public Engine(Action<string, object> emit) { this.emit = emit; }

        // ---------- running things ----------

        class Result
        {
            public int Code;
            public string Out = "", Err = "";
            public bool Ok => Code == 0;
            public string FirstError => (Err.Length > 0 ? Err : Out).Split('\n').Select(l => l.Trim()).FirstOrDefault(l => l.Length > 0) ?? "";
        }

        static Result Run(string file, string args, int timeoutMs = 60000, Encoding encoding = null)
        {
            var psi = new ProcessStartInfo(file, args)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = encoding ?? Encoding.UTF8,
                StandardErrorEncoding = encoding ?? Encoding.UTF8,
            };
            var o = new StringBuilder();
            var e = new StringBuilder();
            using (var p = new Process { StartInfo = psi })
            {
                p.OutputDataReceived += (s, a) => { if (a.Data != null) lock (o) o.AppendLine(a.Data); };
                p.ErrorDataReceived += (s, a) => { if (a.Data != null) lock (e) e.AppendLine(a.Data); };
                try { p.Start(); }
                catch (Win32Exception ex) { return new Result { Code = -1, Err = ex.Message }; }
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                if (!p.WaitForExit(timeoutMs))
                {
                    try { p.Kill(); } catch { }
                    return new Result { Code = -2, Err = "timed out" };
                }
                p.WaitForExit();
                return new Result { Code = p.ExitCode, Out = o.ToString().Trim(), Err = e.ToString().Trim() };
            }
        }

        static Result Sc(string args)
        {
            var r = Run("sc.exe", args, 30000);
            Log.Write($"sc {args} → {r.Code}{(r.Ok ? "" : ": " + r.FirstError)}");
            return r;
        }

        /// <summary>Opens a page in the person's own browser. Setup runs as administrator, and a browser started from
        /// it would be too; Explorer hands the link to the browser as the signed-in person instead.</summary>
        public static void OpenUrl(string url)
        {
            if (url == null || !(url.StartsWith("http://") || url.StartsWith("https://"))) return;
            try { Process.Start(new ProcessStartInfo("explorer.exe", "\"" + url + "\"") { UseShellExecute = false }); }
            catch (Exception ex) { Log.Write("open failed: " + ex.Message); }
        }

        // ---------- what this PC has ----------

        public object Info()
        {
            var info = new Dictionary<string, object>();
            int build = 0;
            string edition = "Windows", display = "";
            try
            {
                using (var k = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion"))
                {
                    int.TryParse(k?.GetValue("CurrentBuildNumber") as string, out build);
                    edition = (k?.GetValue("ProductName") as string) ?? "Windows";
                    display = (k?.GetValue("DisplayVersion") as string) ?? (k?.GetValue("ReleaseId") as string) ?? "";
                }
            }
            catch { }
            // Windows 11 still calls itself "Windows 10" in the registry.
            if (build >= 22000) edition = edition.Replace("Windows 10", "Windows 11");
            var arch = RuntimeInformation.OSArchitecture;
            info["windows"] = new Dictionary<string, object>
            {
                ["name"] = edition,
                ["version"] = display,
                ["build"] = build,
                ["arch"] = arch.ToString().ToLowerInvariant(),
                // The apps are 64-bit Intel/AMD programs; Windows 11 on Arm runs them too.
                ["supported"] = build >= 17763 && (arch == Architecture.X64 || (arch == Architecture.Arm64 && build >= 22000)),
            };
            info["memoryGB"] = Math.Round(Native.TotalMemory() / 1e9, 1);
            info["cores"] = Environment.ProcessorCount;

            var s = ServiceSettings.Load();
            bool installed = ServiceExists() && File.Exists(Paths.Current);
            var finesse = new Dictionary<string, object> { ["installed"] = installed };
            if (installed)
            {
                finesse["running"] = ServiceRunning();
                finesse["port"] = s?.Port ?? 8080;
                finesse["media"] = s?.Media;
                finesse["version"] = File.ReadAllText(Paths.Current).Trim();
                finesse["code"] = SetupCode();
            }
            info["finesse"] = finesse;
            // Finesse 2 ran in Docker Desktop and registered itself for this person only.
            using (var k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\Finesse")) info["dockerVersion"] = k != null;
            info["drives"] = Drives();
            info["lan"] = LanIp();
            info["networkPublic"] = NetworkIsPublic();
            info["log"] = Log.File;
            return info;
        }

        static string SetupCode()
        {
            try { return File.Exists(Paths.SetupCode) ? File.ReadAllText(Paths.SetupCode).Trim() : null; } catch { return null; }
        }

        static List<Dictionary<string, object>> Drives()
        {
            string system = Path.GetPathRoot(Environment.SystemDirectory);
            var list = new List<Dictionary<string, object>>();
            foreach (var d in DriveInfo.GetDrives())
            {
                try
                {
                    if (d.DriveType != DriveType.Fixed || !d.IsReady) continue;
                    list.Add(new Dictionary<string, object>
                    {
                        ["letter"] = d.Name.Substring(0, 1).ToUpperInvariant(),
                        ["label"] = string.IsNullOrWhiteSpace(d.VolumeLabel) ? (d.Name.Equals(system, StringComparison.OrdinalIgnoreCase) ? "Windows" : "Local Disk") : d.VolumeLabel,
                        ["free"] = d.AvailableFreeSpace,
                        ["total"] = d.TotalSize,
                        ["system"] = d.Name.Equals(system, StringComparison.OrdinalIgnoreCase),
                    });
                }
                catch { /* a drive that went away */ }
            }
            return list;
        }

        static readonly string[] VirtualNics = { "vethernet", "hyper-v", "virtualbox", "vmware", "tailscale", "wsl", "docker", "loopback", "bluetooth", "tap-", "wireguard", "zerotier", "npcap", "vpn", "nordlynx", "mullvad", "proton" };

        /// <summary>The address phones and TVs at home use: the network card with a gateway that isn't virtual (or a VPN).</summary>
        public static string LanIp()
        {
            try
            {
                foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up) continue;
                    if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback || ni.NetworkInterfaceType == NetworkInterfaceType.Tunnel) continue;
                    string d = (ni.Name + " " + ni.Description).ToLowerInvariant();
                    if (VirtualNics.Any(v => d.Contains(v))) continue;
                    var p = ni.GetIPProperties();
                    if (!p.GatewayAddresses.Any(g => g.Address.AddressFamily == AddressFamily.InterNetwork && !g.Address.Equals(IPAddress.Any))) continue;
                    var a = p.UnicastAddresses.FirstOrDefault(u => u.Address.AddressFamily == AddressFamily.InterNetwork);
                    if (a != null) return a.Address.ToString();
                }
            }
            catch { }
            return null;
        }

        /// <summary>A network Windows calls "Public" blocks other devices, whatever the firewall rule says.</summary>
        static bool NetworkIsPublic()
        {
            var r = Run("powershell.exe", "-NoProfile -NonInteractive -Command \"(Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -eq 'Internet' } | Select-Object -First 1).NetworkCategory\"", 15000);
            return r.Ok && r.Out.Trim().Equals("Public", StringComparison.OrdinalIgnoreCase);
        }

        // ---------- the media folder ----------

        public object DefaultMedia()
        {
            var keep = ServiceSettings.Load()?.Media;
            if (!string.IsNullOrEmpty(keep)) return CheckMedia(keep);
            var best = Drives().OrderByDescending(d => (long)d["free"]).FirstOrDefault();
            string letter = best != null ? (string)best["letter"] : "C";
            return CheckMedia(letter + @":\Finesse");
        }

        public Dictionary<string, object> CheckMedia(string path)
        {
            var r = new Dictionary<string, object> { ["path"] = path, ["ok"] = false };
            if (string.IsNullOrWhiteSpace(path) || !Regex.IsMatch(path, @"^[A-Za-z]:\\"))
            {
                r["error"] = "Pick a folder on one of this PC's drives (like D:\\Finesse).";
                return r;
            }
            path = path.TrimEnd('\\');
            if (path.Length == 2) path += "\\";
            r["path"] = path;
            DriveInfo drive;
            try { drive = new DriveInfo(path.Substring(0, 1)); }
            catch { r["error"] = "That drive isn't here."; return r; }
            if (!drive.IsReady) { r["error"] = "That drive isn't ready."; return r; }
            if (drive.DriveType != DriveType.Fixed)
            {
                // Finesse runs as a service, before anyone signs in: mapped network drives aren't there for it.
                r["error"] = drive.DriveType == DriveType.Network
                    ? "Finesse runs before anyone signs in, when network drives aren't connected yet. Pick a drive inside this PC."
                    : "Pick a drive that stays connected (inside this PC), not a removable one.";
                return r;
            }
            if (path.StartsWith(Paths.Install, StringComparison.OrdinalIgnoreCase) || path.StartsWith(Paths.Data, StringComparison.OrdinalIgnoreCase))
            {
                r["error"] = "That's where Finesse keeps its own files. Pick another folder, like D:\\Finesse.";
                return r;
            }
            r["free"] = drive.AvailableFreeSpace;
            r["ok"] = true;
            return r;
        }

        // ---------- the service ----------

        static bool ServiceExists() => ServiceController.GetServices().Any(s => s.ServiceName.Equals(FinesseService.Name, StringComparison.OrdinalIgnoreCase));

        static bool ServiceRunning()
        {
            try { using (var sc = new ServiceController(FinesseService.Name)) return sc.Status == ServiceControllerStatus.Running; }
            catch { return false; }
        }

        static void StopService()
        {
            using (var sc = new ServiceController(FinesseService.Name))
            {
                if (sc.Status == ServiceControllerStatus.Stopped) return;
                Log.Write("stopping the Finesse service");
                try { sc.Stop(); } catch (InvalidOperationException) { }
                try { sc.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromMinutes(3)); }
                catch (System.ServiceProcess.TimeoutException) { throw new FriendlyException("Finesse didn't stop in time. Restart the PC, then run Finesse Setup again."); }
            }
        }

        static void StartService()
        {
            using (var sc = new ServiceController(FinesseService.Name))
            {
                if (sc.Status == ServiceControllerStatus.Running) return;
                sc.Start();
                sc.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(60));
            }
        }

        public object StartFinesse()
        {
            StartService();
            return new Dictionary<string, object> { ["ok"] = true };
        }

        /// <summary>Finesse runs as a service: it starts with Windows (before anyone signs in) and comes back if it stops.</summary>
        static void RegisterService()
        {
            string bin = $"\\\"{Paths.Exe}\\\" --service";
            var r = ServiceExists()
                ? Sc($"config {FinesseService.Name} binPath= \"{bin}\" start= delayed-auto DisplayName= \"Finesse\"")
                : Sc($"create {FinesseService.Name} binPath= \"{bin}\" start= delayed-auto DisplayName= \"Finesse\"");
            if (!r.Ok) throw new FriendlyException("Windows didn't let Finesse set itself up as a service (" + r.FirstError + ").");
            Sc($"description {FinesseService.Name} \"Your own streaming service: Jellyfin, and the apps that find what you ask for.\"");
            Sc($"failure {FinesseService.Name} reset= 86400 actions= restart/5000/restart/30000/restart/60000");
        }

        // ---------- installing ----------

        void Step(string step, double progress = -1, string detail = null)
        {
            emit("install", new Dictionary<string, object> { ["step"] = step, ["progress"] = progress, ["detail"] = detail });
        }

        static int FreePort(int want)
        {
            for (int p = want; p < want + 20; p++)
            {
                try
                {
                    var l = new TcpListener(IPAddress.Any, p);
                    l.Start();
                    l.Stop();
                    return p;
                }
                catch (SocketException) { }
            }
            throw new FriendlyException($"Ports {want}–{want + 19} are all busy on this PC.");
        }

        /// <summary>Installs (or repairs, or updates) Finesse. `bundle`: a finesse-windows-*.zip already on this PC
        /// (testing); otherwise this version's is downloaded and checked.</summary>
        public object Install(string media, string bundle = null)
        {
            var m = CheckMedia(media);
            if (!(bool)m["ok"]) throw new FriendlyException((string)m["error"]);
            media = (string)m["path"];

            Step("prepare");
            Directory.CreateDirectory(media);
            Directory.CreateDirectory(Paths.Install);
            Directory.CreateDirectory(Paths.Data);
            var old = ServiceSettings.Load();
            if (ServiceExists()) StopService();
            int port = old?.Port > 0 ? old.Port : FreePort(8080);

            string zip = bundle ?? DownloadBundle();
            Step("unpack");
            string version = Unpack(zip);
            if (bundle == null) try { File.Delete(zip); } catch { }

            Step("service");
            string me = Assembly.GetEntryAssembly().Location;
            if (!string.Equals(Path.GetFullPath(me), Path.GetFullPath(Paths.Exe), StringComparison.OrdinalIgnoreCase)) File.Copy(me, Paths.Exe, true);
            new ServiceSettings { Port = port, Media = media }.Save();
            string before = File.Exists(Paths.Current) ? File.ReadAllText(Paths.Current).Trim() : "";
            if (before.Length > 0 && before != version) File.WriteAllText(Paths.Previous, before);
            File.WriteAllText(Paths.Current, version);
            RegisterService();

            Step("firewall");
            var fw = (Dictionary<string, object>)Firewall(port);

            Step("start");
            StartService();

            Step("wake");
            var clock = Stopwatch.StartNew();
            while (!Healthy(port))
            {
                if (clock.Elapsed > TimeSpan.FromMinutes(3))
                    throw new FriendlyException("Finesse started but isn't answering yet. Give it a minute, then open http://localhost:" + port + "/finesse/");
                Thread.Sleep(1000);
            }
            string code = null;
            for (int i = 0; i < 20 && (code = SetupCode()) == null; i++) Thread.Sleep(500);

            Step("finish");
            Shortcuts(port);
            Log.Write($"Finesse {version} is running on port {port}");
            string lan = LanIp();
            return new Dictionary<string, object>
            {
                ["port"] = port,
                ["code"] = code,
                ["version"] = version,
                ["url"] = $"http://localhost:{port}/finesse/" + (!string.IsNullOrEmpty(code) ? "setup?code=" + Uri.EscapeDataString(code) : ""),
                ["lan"] = lan == null ? null : $"http://{lan}:{port}/finesse/",
                ["media"] = media,
                ["firewall"] = fw["ok"],
            };
        }

        static bool Healthy(int port)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create($"http://127.0.0.1:{port}/api/health");
                req.Timeout = 3000;
                using (var r = (HttpWebResponse)req.GetResponse()) return (int)r.StatusCode < 400;
            }
            catch { return false; }
        }

        /// <summary>Unpacks the bundle into app\&lt;version&gt; (next to any other version) and returns that version.</summary>
        static string Unpack(string zip)
        {
            string apps = Path.Combine(Paths.Install, "app");
            string tmp = Path.Combine(apps, ".unpacking");
            if (Directory.Exists(tmp)) Directory.Delete(tmp, true);
            Directory.CreateDirectory(tmp);
            try
            {
                ZipFile.ExtractToDirectory(zip, tmp);
                foreach (var need in new[] { "node.exe", @"server\finesse-server.mjs", @"web\index.html", "VERSION" })
                    if (!File.Exists(Path.Combine(tmp, need))) throw new FriendlyException("The Finesse download is incomplete (" + need + " is missing). Try again.");
                string version = File.ReadAllText(Path.Combine(tmp, "VERSION")).Trim();
                if (!Regex.IsMatch(version, @"^\d+\.\d+\.\d+$")) throw new FriendlyException("The Finesse download doesn't say which version it is. Try again.");
                string dest = Path.Combine(apps, version);
                // The running version is stopped by now, so its folder can be replaced (a repair).
                if (Directory.Exists(dest)) Directory.Delete(dest, true);
                Directory.Move(tmp, dest);
                return version;
            }
            finally
            {
                if (Directory.Exists(tmp)) try { Directory.Delete(tmp, true); } catch { }
            }
        }

        /// <summary>This version's finesse-windows zip from GitHub (about 60 MB), carried on after a stall, and checked
        /// against the checksum this exe was built with (or, failing that, the one GitHub keeps for the release).</summary>
        string DownloadBundle()
        {
            string version = Program.Version;
            string name = $"finesse-windows-{version}-x64.zip";
            string url = $"https://github.com/{Repo}/releases/download/v{version}/{name}";
            string expected = BundleSha256() ?? ReleaseDigest(version, name);
            if (expected == null) throw new FriendlyException("Finesse Setup couldn't check the download it needs. Check this PC's internet connection, then try again.");
            string dir = Path.Combine(Path.GetTempPath(), "FinesseSetup");
            Directory.CreateDirectory(dir);
            string file = Path.Combine(dir, name);
            if (File.Exists(file) && Sha256(file) == expected) return file;
            Download(url, file);
            if (Sha256(file) != expected)
            {
                File.Delete(file);
                throw new FriendlyException("The Finesse download didn't match what it should be, so it wasn't used. Try again.");
            }
            return file;
        }

        static string BundleSha256()
        {
            var a = typeof(Engine).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>().FirstOrDefault(x => x.Key == "BundleSha256");
            return string.IsNullOrWhiteSpace(a?.Value) ? null : a.Value.Trim().ToLowerInvariant();
        }

        static string ReleaseDigest(string version, string name)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create($"https://api.github.com/repos/{Repo}/releases/tags/v{version}");
                req.UserAgent = "FinesseSetup/" + version;
                req.Accept = "application/vnd.github+json";
                req.Timeout = 20000;
                using (var r = req.GetResponse())
                using (var s = new StreamReader(r.GetResponseStream()))
                {
                    var rel = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(s.ReadToEnd());
                    foreach (Dictionary<string, object> a in (System.Collections.ArrayList)rel["assets"])
                        if ((string)a["name"] == name && a.ContainsKey("digest") && a["digest"] is string d && d.StartsWith("sha256:")) return d.Substring(7).ToLowerInvariant();
                }
            }
            catch (Exception ex) { Log.Write("release digest: " + ex.Message); }
            return null;
        }

        static string Sha256(string file)
        {
            using (var sha = SHA256.Create())
            using (var f = File.OpenRead(file))
                return BitConverter.ToString(sha.ComputeHash(f)).Replace("-", "").ToLowerInvariant();
        }

        /// <summary>A download that carries on from where it stalled (home Wi-Fi drops now and then).</summary>
        void Download(string url, string file)
        {
            string part = file + ".part";
            if (File.Exists(part) && DateTime.UtcNow - File.GetLastWriteTimeUtc(part) > TimeSpan.FromHours(24)) File.Delete(part);
            Log.Write("downloading " + url);
            const int MaxAttempts = 8;
            long total = 0;
            for (int attempt = 1; ; attempt++)
            {
                long have = File.Exists(part) ? new FileInfo(part).Length : 0;
                try
                {
                    var req = (HttpWebRequest)WebRequest.Create(url);
                    req.UserAgent = "FinesseSetup/" + Program.Version;
                    req.Timeout = 30000;
                    req.ReadWriteTimeout = 30000;
                    if (have > 0) req.AddRange(have);
                    using (var resp = (HttpWebResponse)req.GetResponse())
                    {
                        if (resp.StatusCode != HttpStatusCode.PartialContent) have = 0;
                        if (resp.ContentLength > 0) total = have + resp.ContentLength;
                        using (var s = resp.GetResponseStream())
                        using (var f = new FileStream(part, have > 0 ? FileMode.Append : FileMode.Create, FileAccess.Write))
                        {
                            var buf = new byte[1 << 16];
                            long got = have;
                            var clock = Stopwatch.StartNew();
                            long lastAt = 0;
                            int n;
                            while ((n = s.Read(buf, 0, buf.Length)) > 0)
                            {
                                f.Write(buf, 0, n);
                                got += n;
                                if (clock.ElapsedMilliseconds - lastAt > 250)
                                {
                                    Step("download", total > 0 ? (double)got / total : -1, $"{got / 1000000} of {total / 1000000} MB");
                                    lastAt = clock.ElapsedMilliseconds;
                                }
                            }
                        }
                    }
                    if (total > 0 && new FileInfo(part).Length != total) throw new IOException("the download stopped part-way");
                    break;
                }
                catch (Exception ex)
                {
                    var wr = (ex as WebException)?.Response as HttpWebResponse;
                    if (wr != null && (int)wr.StatusCode == 416 && have > 0) break;
                    long now = File.Exists(part) ? new FileInfo(part).Length : 0;
                    Log.Write($"download attempt {attempt} of {MaxAttempts} failed at {now / 1000000} MB: {ex.Message}");
                    if (attempt >= MaxAttempts)
                        throw new FriendlyException("Downloading Finesse kept stalling, so the connection to github.com is slow or being cut. Press Try again to carry on from where it stopped.");
                    Step("download", total > 0 ? (double)now / total : -1, $"The connection stalled. Carrying on from {now / 1000000} MB…");
                    Thread.Sleep(Math.Min(2000 * attempt, 10000));
                }
            }
            if (File.Exists(file)) File.Delete(file);
            File.Move(part, file);
            Step("download", 1);
        }

        /// <summary>Phones and TVs on your home network may reach Finesse and Jellyfin's own port (its apps for TVs and phones).</summary>
        public object Firewall(int port)
        {
            var r = Run("cmd.exe", $"/c netsh advfirewall firewall delete rule name=\"Finesse\" >nul 2>&1 & netsh advfirewall firewall add rule name=\"Finesse\" dir=in action=allow protocol=TCP localport={port},8096 profile=private,domain", 30000);
            Log.Write("firewall rule → " + r.Code);
            return new Dictionary<string, object> { ["ok"] = r.Ok };
        }

        /// <summary>Start menu and desktop shortcuts for everyone on the PC, and an entry in Settings → Apps.</summary>
        static void Shortcuts(int port)
        {
            string url = $"http://localhost:{port}/finesse/";
            string shortcut = "[InternetShortcut]\r\nURL=" + url + "\r\nIconFile=" + Paths.Exe + "\r\nIconIndex=0\r\n";
            File.WriteAllText(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms), "Finesse.url"), shortcut);
            try { File.WriteAllText(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory), "Finesse.url"), shortcut); } catch { }
            using (var k = Registry.LocalMachine.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\Finesse"))
            {
                k.SetValue("DisplayName", "Finesse");
                k.SetValue("DisplayVersion", File.ReadAllText(Paths.Current).Trim());
                k.SetValue("Publisher", "Finesse");
                k.SetValue("DisplayIcon", Paths.Exe);
                k.SetValue("InstallLocation", Paths.Install);
                k.SetValue("UninstallString", $"\"{Paths.Exe}\" --uninstall");
                k.SetValue("URLInfoAbout", "https://github.com/CoffeeCC/finesse");
                k.SetValue("HelpLink", "https://github.com/CoffeeCC/finesse/blob/master/docs/windows.md");
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                k.SetValue("EstimatedSize", 400 * 1024, RegistryValueKind.DWord);
                k.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
            }
        }

        // ---------- uninstalling ----------

        /// <summary>Stops Finesse (it stops its apps), removes the service and Program Files\Finesse. The media folder
        /// always stays; Finesse's settings and its apps' settings (C:\ProgramData\Finesse) only if asked.</summary>
        public object Uninstall(bool deleteSettings)
        {
            if (ServiceExists())
            {
                StopService();
                Sc($"delete {FinesseService.Name}");
            }
            // SABnzbd runs as a service of its own, registered by Finesse: removed too, but only if it's ours.
            var sab = Run("sc.exe", "qc SABnzbd", 15000);
            if (sab.Ok && sab.Out.IndexOf(Paths.Data, StringComparison.OrdinalIgnoreCase) >= 0)
            {
                Sc("stop SABnzbd");
                Thread.Sleep(3000);
                Sc("delete SABnzbd");
            }
            Run("netsh.exe", "advfirewall firewall delete rule name=\"Finesse\"", 30000);
            foreach (var f in new[] {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms), "Finesse.url"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory), "Finesse.url") })
                try { if (File.Exists(f)) File.Delete(f); } catch { }
            try { Registry.LocalMachine.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\Finesse", false); } catch { }
            if (deleteSettings)
            {
                try { Directory.Delete(Paths.Data, true); } catch (Exception ex) { Log.Write("settings left: " + ex.Message); }
            }
            // This exe may be the one in Program Files: the folder goes a moment after it closes.
            Process.Start(new ProcessStartInfo("cmd.exe", $"/c timeout /t 3 /nobreak >nul & rmdir /s /q \"{Paths.Install}\"") { CreateNoWindow = true, UseShellExecute = false });
            return new Dictionary<string, object> { ["ok"] = true };
        }
    }
}
