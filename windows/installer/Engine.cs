using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Management;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using Microsoft.Win32;

namespace Finesse.Setup
{
    /// <summary>What Finesse Setup does on the PC. On Windows, Finesse runs in Docker Desktop:
    ///  - app settings live in a Docker volume ("finesse"), mounted at its own path inside Docker's VM, which is the
    ///    path Finesse hands to the apps it starts (like FINESSE_ROOT on Linux). Their databases stay off Windows
    ///    drives, where SQLite locking is unreliable;
    ///  - movies, shows and downloads live in a Windows folder, which Docker Desktop shows its VM at
    ///    /run/desktop/mnt/host/&lt;drive&gt;/… (FINESSE_DATA).</summary>
    class Engine
    {
        public const string Image = "ghcr.io/coffeecc/finesse:latest";
        const string Name = "finesse", Network = "finesse", Volume = "finesse";
        readonly Action<string, object> emit;

        public Engine(Action<string, object> emit) { this.emit = emit; }

        static string ProgramFiles => Environment.GetEnvironmentVariable("ProgramW6432") ?? Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        static string DockerDir => Path.Combine(ProgramFiles, "Docker", "Docker");
        static string DockerExe => Path.Combine(DockerDir, "resources", "bin", "docker.exe");
        static string DockerDesktop => Path.Combine(DockerDir, "Docker Desktop.exe");
        static string DockerCli => File.Exists(DockerExe) ? DockerExe : "docker";

        // ---------- running things ----------

        class Result
        {
            public int Code;
            public string Out = "", Err = "";
            public bool Ok => Code == 0;
            public string FirstError => (Err.Length > 0 ? Err : Out).Split('\n').Select(l => l.Trim()).FirstOrDefault(l => l.Length > 0) ?? "";
        }

        static Result Run(string file, string args, int timeoutMs = 60000, Action<string> onLine = null, Encoding encoding = null)
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
            psi.EnvironmentVariables["DOCKER_CLI_HINTS"] = "false";
            var o = new StringBuilder();
            var e = new StringBuilder();
            using (var p = new Process { StartInfo = psi })
            {
                p.OutputDataReceived += (s, a) => { if (a.Data == null) return; lock (o) o.AppendLine(a.Data); onLine?.Invoke(a.Data); };
                p.ErrorDataReceived += (s, a) => { if (a.Data == null) return; lock (e) e.AppendLine(a.Data); onLine?.Invoke(a.Data); };
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

        static Result Docker(string args, int timeoutMs = 60000, Action<string> onLine = null)
        {
            var r = Run(DockerCli, args, timeoutMs, onLine);
            Log.Write($"docker {args} → {r.Code}{(r.Ok ? "" : ": " + r.FirstError)}");
            return r;
        }

        static string Q(string s) => s.IndexOfAny(new[] { ' ', '"', '\t' }) >= 0 ? "\"" + s.Replace("\"", "\\\"") + "\"" : s;

        /// <summary>Runs something Windows has to approve (the UAC prompt). Null if the person said no.</summary>
        static int? Elevated(string file, string args, bool hidden = false)
        {
            var psi = new ProcessStartInfo(file, args) { UseShellExecute = true, Verb = "runas" };
            if (hidden) psi.WindowStyle = ProcessWindowStyle.Hidden;
            try
            {
                using (var p = Process.Start(psi))
                {
                    p.WaitForExit();
                    return p.ExitCode;
                }
            }
            catch (Win32Exception ex) when (ex.NativeErrorCode == 1223) { return null; }
        }

        public static void OpenUrl(string url)
        {
            if (url == null || !(url.StartsWith("http://") || url.StartsWith("https://"))) return;
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch (Exception ex) { Log.Write("open failed: " + ex.Message); }
        }

        // ---------- what this PC has ----------

        static bool DockerUp(out string version, out string error)
        {
            var r = Docker("info --format {{.ServerVersion}}", 20000);
            version = r.Out;
            error = r.Err;
            return r.Ok && r.Out.Length > 0;
        }

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
            info["windows"] = new Dictionary<string, object>
            {
                ["name"] = edition,
                ["version"] = display,
                ["build"] = build,
                ["arch"] = RuntimeInformation.OSArchitecture.ToString().ToLowerInvariant(),
                ["supported"] = build >= 19041 && Environment.Is64BitOperatingSystem && RuntimeInformation.OSArchitecture != Architecture.X86,
            };
            info["memoryGB"] = Math.Round(Native.TotalMemory() / 1e9, 1);
            info["cores"] = Environment.ProcessorCount;

            bool? hypervisor = null, firmware = null;
            try { using (var s = new ManagementObjectSearcher("SELECT HypervisorPresent FROM Win32_ComputerSystem")) foreach (ManagementObject o in s.Get()) hypervisor = o["HypervisorPresent"] as bool?; } catch { }
            try { using (var s = new ManagementObjectSearcher("SELECT VirtualizationFirmwareEnabled FROM Win32_Processor")) foreach (ManagementObject o in s.Get()) firmware = o["VirtualizationFirmwareEnabled"] as bool?; } catch { }
            // With Hyper-V or WSL already running, the firmware flag reads false: the hypervisor answers for it.
            info["virtualization"] = hypervisor == true || firmware == true ? "on" : hypervisor == null && firmware == null ? "unknown" : "off";

            var wsl = Run("wsl.exe", "--status", 15000, null, Encoding.Unicode);
            info["wsl"] = wsl.Ok;

            bool dockerInstalled = File.Exists(DockerDesktop) || File.Exists(DockerExe);
            string dockerVersion = null;
            bool dockerUp = dockerInstalled && DockerUp(out dockerVersion, out _);
            info["docker"] = new Dictionary<string, object>
            {
                ["installed"] = dockerInstalled,
                ["running"] = dockerUp,
                ["version"] = dockerUp ? dockerVersion : null,
            };

            var finesse = new Dictionary<string, object> { ["installed"] = false };
            if (dockerUp)
            {
                var ps = Docker($"ps -a --filter name=^/{Name}$ --format {{{{.Status}}}}");
                if (ps.Ok && ps.Out.Length > 0)
                {
                    finesse["installed"] = true;
                    finesse["running"] = ps.Out.StartsWith("Up");
                    var port = Docker($"port {Name} 8080/tcp");
                    var m = Regex.Match(port.Out, @":(\d+)\s*$", RegexOptions.Multiline);
                    finesse["port"] = m.Success ? int.Parse(m.Groups[1].Value) : 8080;
                    if (ps.Out.StartsWith("Up"))
                    {
                        var code = Docker($"exec {Name} finesse setup-code", 20000);
                        finesse["code"] = code.Ok ? code.Out : null;
                    }
                }
            }
            info["finesse"] = finesse;
            info["drives"] = Drives();
            info["lan"] = LanIp();
            info["networkPublic"] = NetworkIsPublic();
            info["log"] = Log.File;
            info["image"] = Image;
            return info;
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

        static readonly string[] VirtualNics = { "vethernet", "hyper-v", "virtualbox", "vmware", "tailscale", "wsl", "docker", "loopback", "bluetooth", "tap-", "wireguard", "zerotier", "npcap", "vpn" };

        /// <summary>The address phones and TVs at home use: the network card with a gateway that isn't virtual.</summary>
        static string LanIp()
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
            if (path.Contains(" ") || path.Any(c => c > 127))
            {
                r["error"] = "Use a folder whose path has no spaces or accents, like D:\\Finesse.";
                return r;
            }
            DriveInfo drive;
            try { drive = new DriveInfo(path.Substring(0, 1)); }
            catch { r["error"] = "That drive isn't here."; return r; }
            if (!drive.IsReady) { r["error"] = "That drive isn't ready."; return r; }
            if (drive.DriveType != DriveType.Fixed)
            {
                r["error"] = drive.DriveType == DriveType.Network
                    ? "Network drives don't work with Docker Desktop. Pick a drive inside this PC."
                    : "Pick a drive that stays connected (inside this PC), not a removable one.";
                return r;
            }
            r["free"] = drive.AvailableFreeSpace;
            r["linux"] = ToDocker(path);
            r["ok"] = true;
            return r;
        }

        /// <summary>D:\Finesse → /run/desktop/mnt/host/d/Finesse (how Docker Desktop's VM sees it).</summary>
        static string ToDocker(string windowsPath)
        {
            string rest = windowsPath.Substring(2).Replace('\\', '/').TrimEnd('/');
            return "/run/desktop/mnt/host/" + char.ToLowerInvariant(windowsPath[0]) + rest;
        }

        // ---------- Docker Desktop ----------

        public object DownloadDocker()
        {
            bool arm = RuntimeInformation.OSArchitecture == Architecture.Arm64;
            string url = $"https://desktop.docker.com/win/main/{(arm ? "arm64" : "amd64")}/Docker%20Desktop%20Installer.exe";
            string dir = Path.Combine(Path.GetTempPath(), "FinesseSetup");
            Directory.CreateDirectory(dir);
            string file = Path.Combine(dir, "Docker Desktop Installer.exe");
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.UserAgent = "FinesseSetup/" + Program.Version;
            req.Timeout = 30000;
            req.ReadWriteTimeout = 60000;
            Log.Write("downloading " + url);
            using (var resp = (HttpWebResponse)req.GetResponse())
            {
                long total = resp.ContentLength;
                if (total > 0 && File.Exists(file) && new FileInfo(file).Length == total)
                {
                    emit("download", new Dictionary<string, object> { ["got"] = total, ["total"] = total, ["speed"] = 0 });
                    return new Dictionary<string, object> { ["file"] = file };
                }
                string part = file + ".part";
                using (var s = resp.GetResponseStream())
                using (var f = File.Create(part))
                {
                    var buf = new byte[1 << 16];
                    long got = 0, lastGot = 0;
                    var clock = Stopwatch.StartNew();
                    long lastAt = 0;
                    int n;
                    while ((n = s.Read(buf, 0, buf.Length)) > 0)
                    {
                        f.Write(buf, 0, n);
                        got += n;
                        if (clock.ElapsedMilliseconds - lastAt > 300)
                        {
                            double speed = (got - lastGot) / ((clock.ElapsedMilliseconds - lastAt) / 1000.0);
                            emit("download", new Dictionary<string, object> { ["got"] = got, ["total"] = total, ["speed"] = speed });
                            lastAt = clock.ElapsedMilliseconds;
                            lastGot = got;
                        }
                    }
                    if (total > 0 && got != total) throw new FriendlyException("The download stopped part-way. Check the internet connection, then try again.");
                }
                if (File.Exists(file)) File.Delete(file);
                File.Move(part, file);
                emit("download", new Dictionary<string, object> { ["got"] = total, ["total"] = total, ["speed"] = 0 });
            }
            return new Dictionary<string, object> { ["file"] = file };
        }

        public object InstallDocker(string file)
        {
            if (file == null || !File.Exists(file)) throw new FriendlyException("The Docker Desktop installer is missing. Press Install again to download it.");
            Log.Write("installing Docker Desktop");
            var code = Elevated(file, "install --quiet --accept-license --backend=wsl-2 --always-run-service");
            if (code == null) throw new FriendlyException("Windows didn't get permission to install Docker Desktop. Press Install again and choose Yes when Windows asks.");
            Log.Write("Docker Desktop installer exited with " + code);
            if (code != 0 && code != 3010)
            {
                string why = "";
                try
                {
                    string log = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Docker", "install-log.txt");
                    if (File.Exists(log)) why = File.ReadLines(log).Reverse().FirstOrDefault(l => l.Contains("rror")) ?? "";
                }
                catch { }
                throw new FriendlyException("Docker Desktop didn't install (code " + code + ")." + (why.Length > 0 ? " It said: " + why.Trim() : "") + " Try again, or install it from docker.com and open Finesse Setup again.");
            }
            // A new install always wants a restart (WSL, and permission to use Docker without asking).
            Resume.Register();
            return new Dictionary<string, object> { ["ok"] = true, ["restart"] = true };
        }

        public object StartDocker()
        {
            if (DockerUp(out var version, out _)) return new Dictionary<string, object> { ["ok"] = true, ["version"] = version };
            if (!File.Exists(DockerDesktop)) throw new FriendlyException("Docker Desktop isn't installed.");
            if (Process.GetProcessesByName("Docker Desktop").Length == 0)
            {
                Log.Write("starting Docker Desktop");
                Process.Start(new ProcessStartInfo(DockerDesktop) { UseShellExecute = true });
            }
            var clock = Stopwatch.StartNew();
            string last = "";
            while (clock.Elapsed < TimeSpan.FromMinutes(6))
            {
                if (DockerUp(out version, out last)) return new Dictionary<string, object> { ["ok"] = true, ["version"] = version };
                // The engine is up but this account may not use it yet: that needs a sign-out.
                if (Regex.IsMatch(last ?? "", "docker-users|access is denied", RegexOptions.IgnoreCase) && clock.Elapsed > TimeSpan.FromSeconds(20))
                    return new Dictionary<string, object> { ["ok"] = false, ["reason"] = "signout" };
                emit("dockerStarting", new Dictionary<string, object> { ["seconds"] = (int)clock.Elapsed.TotalSeconds });
                Thread.Sleep(3000);
            }
            return new Dictionary<string, object> { ["ok"] = false, ["reason"] = "timeout", ["detail"] = last };
        }

        // ---------- Finesse ----------

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

        void Step(string step, double progress = -1, string detail = null)
        {
            emit("install", new Dictionary<string, object> { ["step"] = step, ["progress"] = progress, ["detail"] = detail });
        }

        public object InstallFinesse(string media, int port)
        {
            var m = CheckMedia(media);
            if (!(bool)m["ok"]) throw new FriendlyException((string)m["error"]);
            media = (string)m["path"];
            string lin = (string)m["linux"];
            Directory.CreateDirectory(media);
            if (!DockerUp(out _, out _)) throw new FriendlyException("Docker Desktop isn't running. Start it, then try again.");

            Step("prepare");
            var stale = Docker($"ps -a --filter name=^/{Name}$ --format {{{{.Status}}}}");
            if (stale.Ok && stale.Out.Length > 0) Docker($"rm -f {Name}");
            port = FreePort(port);
            if (!Docker($"volume create {Volume}").Ok) throw new FriendlyException("Docker couldn't make a place for Finesse's settings.");
            string mount = Docker($"volume inspect {Volume} --format {{{{.Mountpoint}}}}").Out.Trim();
            if (!mount.StartsWith("/")) throw new FriendlyException("Docker didn't say where Finesse's settings live (" + mount + ").");
            if (!Docker($"network inspect {Network}").Ok && !Docker($"network create {Network} --label finesse.managed=true").Ok)
                throw new FriendlyException("Docker couldn't create Finesse's network.");

            // Layers: count the ones finished out of the ones seen.
            Step("pull", 0);
            var layers = new HashSet<string>();
            var done = new HashSet<string>();
            var pull = Docker($"pull {Image}", 45 * 60 * 1000, line =>
            {
                var x = Regex.Match(line, @"^([0-9a-f]{12}): (.+)$");
                if (!x.Success) return;
                lock (layers)
                {
                    layers.Add(x.Groups[1].Value);
                    if (x.Groups[2].Value.StartsWith("Pull complete") || x.Groups[2].Value.StartsWith("Already exists")) done.Add(x.Groups[1].Value);
                    Step("pull", layers.Count == 0 ? 0 : (double)done.Count / layers.Count, $"{done.Count} of {layers.Count}");
                }
            });
            if (!pull.Ok && !Docker($"image inspect {Image}").Ok)
                throw new FriendlyException("Couldn't download Finesse (" + pull.FirstError + "). Check the internet connection, then try again.");

            Step("start");
            string lan = LanIp();
            string args = string.Join(" ",
                $"run -d --name {Name} --restart unless-stopped",
                $"--network {Network} --network-alias finesse",
                $"-p {port}:8080",
                "-v /var/run/docker.sock:/var/run/docker.sock",
                $"--mount type=volume,src={Volume},dst={mount}",
                $"-v {Q(lin + ":" + lin)}",
                $"-e FINESSE_ROOT={mount} -e FINESSE_DATA={Q(lin)} -e FINESSE_CONFIG_DIR={mount}/config/finesse",
                // What Finesse shows people as "your media folder" (Add media): the Windows path, not Docker's.
                $"-e FINESSE_DATA_LABEL={Q(media)}",
                // The PC's address at home, for "enter this on your TV" (the browser here only knows localhost).
                lan != null ? $"-e FINESSE_LAN_HOST={lan}" : "",
                $"-e PUID=1000 -e PGID=1000 -e TZ={TimeZones.Local()}",
                "--label finesse.installer=windows",
                Image);
            var run = Docker(args, 120000);
            if (!run.Ok) throw new FriendlyException("Docker couldn't start Finesse: " + run.FirstError);

            Step("wake");
            var clock = Stopwatch.StartNew();
            while (!Healthy(port))
            {
                if (clock.Elapsed > TimeSpan.FromMinutes(3))
                    throw new FriendlyException("Finesse started but isn't answering yet. Give it a minute, then open http://localhost:" + port + "/finesse/");
                Thread.Sleep(1500);
            }
            string code = Docker($"exec {Name} finesse setup-code", 30000).Out.Trim();
            Log.Write($"Finesse is running on port {port}");
            return new Dictionary<string, object>
            {
                ["port"] = port,
                ["code"] = code,
                ["url"] = $"http://localhost:{port}/finesse/" + (code.Length > 0 ? "setup?code=" + Uri.EscapeDataString(code) : ""),
                ["lan"] = lan == null ? null : $"http://{lan}:{port}/finesse/",
                ["media"] = media,
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

        public object StartFinesse()
        {
            var up = (Dictionary<string, object>)StartDocker();
            if (!(bool)up["ok"]) return up;
            var r = Docker($"start {Name}");
            if (!r.Ok) throw new FriendlyException("Finesse didn't start: " + r.FirstError);
            return new Dictionary<string, object> { ["ok"] = true };
        }

        /// <summary>One Windows prompt: phones and TVs on your home network may reach Finesse (and Jellyfin's apps).</summary>
        public object Firewall(int port)
        {
            string cmd = $"/c netsh advfirewall firewall delete rule name=\"Finesse\" >nul 2>&1 & netsh advfirewall firewall add rule name=\"Finesse\" dir=in action=allow protocol=TCP localport={port},8096 profile=private,domain";
            var code = Elevated("cmd.exe", cmd, hidden: true);
            Log.Write("firewall rule → " + (code?.ToString() ?? "declined"));
            return new Dictionary<string, object> { ["ok"] = code == 0, ["declined"] = code == null };
        }

        /// <summary>Start menu and desktop shortcuts, and an entry in Settings → Apps to uninstall.</summary>
        public object Finish(int port)
        {
            string exe = Resume.CopySelf();
            string url = $"http://localhost:{port}/finesse/";
            string shortcut = "[InternetShortcut]\r\nURL=" + url + "\r\nIconFile=" + exe + "\r\nIconIndex=0\r\n";
            string menu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Finesse.url");
            string desk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Finesse.url");
            File.WriteAllText(menu, shortcut);
            try { File.WriteAllText(desk, shortcut); } catch { }
            using (var k = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\Finesse"))
            {
                k.SetValue("DisplayName", "Finesse");
                k.SetValue("DisplayVersion", Program.Version);
                k.SetValue("Publisher", "Finesse");
                k.SetValue("DisplayIcon", exe);
                k.SetValue("UninstallString", $"\"{exe}\" --uninstall");
                k.SetValue("URLInfoAbout", "https://github.com/CoffeeCC/finesse");
                k.SetValue("HelpLink", "https://github.com/CoffeeCC/finesse/blob/master/docs/windows.md");
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                k.SetValue("EstimatedSize", 2 * 1024 * 1024, RegistryValueKind.DWord);
                k.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
            }
            Resume.Clear();
            return new Dictionary<string, object> { ["shortcut"] = menu };
        }

        public object Restart()
        {
            Resume.Register();
            Run("shutdown.exe", "/r /t 5 /c \"Restarting to finish installing Docker for Finesse.\"", 10000);
            return true;
        }

        public object Uninstall(bool deleteSettings)
        {
            var up = (Dictionary<string, object>)StartDocker();
            if (!(bool)up["ok"]) throw new FriendlyException("Docker Desktop needs to be running to remove Finesse's apps. Start it, then try again.");
            int removed = 0;
            var ids = Docker("ps -aq --filter label=finesse.managed=true").Out.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            if (ids.Length > 0 && Docker("rm -f " + string.Join(" ", ids), 180000).Ok) removed = ids.Length;
            if (Docker($"rm -f {Name}").Ok) removed++;
            Docker($"network rm {Network}");
            if (deleteSettings) Docker($"volume rm {Volume}");
            Elevated("cmd.exe", "/c netsh advfirewall firewall delete rule name=\"Finesse\"", hidden: true);
            foreach (var f in new[] {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Finesse.url"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Finesse.url") })
                try { if (File.Exists(f)) File.Delete(f); } catch { }
            try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\Finesse", false); } catch { }
            Resume.Clear();
            // This exe can't delete itself while it runs: a moment after it closes.
            string me = System.Reflection.Assembly.GetEntryAssembly().Location;
            if (string.Equals(Path.GetFullPath(me), Resume.Installed, StringComparison.OrdinalIgnoreCase))
                Process.Start(new ProcessStartInfo("cmd.exe", $"/c timeout /t 3 /nobreak >nul & del /q \"{me}\"") { CreateNoWindow = true, UseShellExecute = false });
            return new Dictionary<string, object> { ["removed"] = removed };
        }
    }

    /// <summary>Picking up after a restart: a copy of this exe in %LOCALAPPDATA%\Finesse, run once at sign-in.</summary>
    static class Resume
    {
        const string RunOnce = @"Software\Microsoft\Windows\CurrentVersion\RunOnce";
        public static string Installed => Path.Combine(Program.Home, "FinesseSetup.exe");

        public static string CopySelf()
        {
            string me = System.Reflection.Assembly.GetEntryAssembly().Location;
            if (!string.Equals(Path.GetFullPath(me), Path.GetFullPath(Installed), StringComparison.OrdinalIgnoreCase))
                File.Copy(me, Installed, true);
            return Installed;
        }

        public static void Register()
        {
            CopySelf();
            using (var k = Registry.CurrentUser.CreateSubKey(RunOnce)) k.SetValue("FinesseSetup", $"\"{Installed}\" --resume");
        }

        public static void Clear()
        {
            try { using (var k = Registry.CurrentUser.OpenSubKey(RunOnce, true)) k?.DeleteValue("FinesseSetup", false); } catch { }
        }
    }
}
