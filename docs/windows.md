# Finesse on Windows

**[Download Finesse Setup](https://github.com/CoffeeCC/finesse/releases/latest/download/FinesseSetup.exe)**
(about 6 MB), run it, and follow Nessa. It takes about five minutes. Finesse is a normal Windows
program: no Docker, no WSL, nothing to turn on in the BIOS, and no restart.

> **"Windows protected your PC"?** Finesse Setup isn't signed with a paid certificate yet, so
> SmartScreen doesn't know it. Choose **More info → Run anyway**. The source is all in this repo
> (`windows/installer/`), and GitHub builds the download from it.

## What it does

Windows asks for permission once, when Finesse Setup opens (it installs a service and lets
phones and TVs through the firewall). Then it:

1. **Checks the PC**: Windows version, memory, free space.
2. **Asks where your media lives.** It suggests the drive with the most room
   (`D:\Finesse`, say). Movies, shows, music and downloads all go in its `media` folder
   (`D:\Finesse\media\movies`, `…\tv`, `…\music`).
3. **Installs Finesse**: downloads it (about 60 MB), sets it up to start with Windows, lets
   phones and TVs on your home network reach it, and adds **Finesse** to the Start menu and
   desktop.
4. **Done**: a button opens the setup page in your browser, and a QR code opens it on your phone.
   From there it's the same as everywhere else: see [the install guide](install.md#2-the-setup-page).
   Finesse downloads the apps your setup needs (Jellyfin, and Sonarr, Radarr, SABnzbd and the
   rest if you want downloads) and connects them for you.

While it works, Lo-Finessa (original lo-fi made for Finesse) plays if you like. The button in
the title bar turns it off, and it remembers.

## What you need

- **Windows 11, or Windows 10 version 1809 or newer**, 64-bit. Windows 11 on Arm works too.
- **4 GB of memory** or more is comfortable (2 GB works, slowly).
- **A drive with room for your media**, inside the PC. Finesse starts before anyone signs in,
  when network drives aren't connected yet, so those (and USB sticks) don't work for the media
  folder.

## How it fits together

- **Finesse runs as a Windows service** called Finesse. It starts with Windows, even before anyone
  signs in, so the TV keeps working after a Windows Update restart.
- **The apps are the real Windows versions** (Jellyfin, Sonarr, Radarr, Lidarr, Prowlarr, SABnzbd,
  qBittorrent), at versions Finesse has tested, checked when they download. Finesse starts them in
  the background (no windows, no tray icons), restarts one if it crashes, and updates them when
  Finesse updates.
- **Your media folder** is an ordinary Windows folder.
- **Finesse's own settings** (accounts, app setup, watch history) and the apps' settings live in
  `C:\ProgramData\Finesse`. Back them up from **Settings → Server → Backups** in Finesse.
- **The program** is in `C:\Program Files\Finesse`.

### Torrents use your VPN app

On Windows, torrents go through the VPN app you already have on the PC (NordVPN, Mullvad,
Proton VPN, Surfshark, WireGuard…). In the setup page you pick its connection, and Finesse locks
qBittorrent to it: when the VPN is off, torrents simply wait, and nothing ever goes out over your
normal connection. **Settings → Server** shows whether the VPN is connected. Usenet doesn't need
a VPN.

### Games

- **Games** works on Windows too: pick it in the setup page, or **Settings → Server → Games →
  Add Games**. Finesse keeps the library itself from your games folder
  (`D:\Finesse\media\games\roms\<console>`, like `snes` or `psx`); there's no RomM to install.
  Box art comes free from libretro's thumbnails (a SteamGridDB key adds more), and games play right
  in the browser. See [Games](games.md).
- **Game streaming** to Moonlight uses [Sunshine](https://github.com/LizardByte/Sunshine) on
  Windows: **Settings → Server → Game streaming** installs it and pairs your devices. Moonlight then
  shows this PC's screen: Steam Big Picture, your games or the desktop. See
  [Game streaming](streaming.md#windows-sunshine).

### Not on Windows yet

- **The streaming emulators** (PCSX2, Dolphin, RPCS3… set up for you inside Wolf) and **browser
  play** of those consoles need Linux. On Windows, install the emulators you like on the PC and
  start them from Steam Big Picture or the desktop in Moonlight.
- **Built-in Tailscale or Cloudflare setup.** For access away from home, install the
  [Tailscale app](https://tailscale.com/download/windows) on the PC and on your phone, and open
  Finesse at the PC's Tailscale address.

## Adding your movies and shows

In Finesse, open the account menu → **Add media**, or drag files and folders onto any page: they
go into the right library and show up a minute later. Or copy them straight into
`D:\Finesse\media\movies`, `…\tv` and `…\music` in File Explorer.

## Phones and TVs can't reach it?

- **Is the Wi-Fi set to Public?** Windows hides the PC from other devices on Public networks.
  Settings → Network & internet → your Wi-Fi or Ethernet → **Private network**. Finesse Setup warns
  you if it's Public.
- **Firewall:** run Finesse Setup again and choose **Let them in again**, or allow ports 8080 and
  8096 yourself in Windows Defender Firewall.
- Use the address Finesse Setup showed (like `192.168.1.50:8080/finesse`), on the same network.

## Troubleshooting

| Problem | What to do |
|---|---|
| **Finesse isn't answering** | Run Finesse Setup and choose **Start Finesse**, or **Repair Finesse** (it reinstalls this version and keeps everything). |
| **Torrents never start** | Turn your VPN app on. If Settings → Server says qBittorrent can't see the VPN's connection, pick it again in Settings → "Change downloads". |
| **Anything else** | Setup's log is `%LOCALAPPDATA%\Finesse\setup.log`; Finesse's are in `C:\ProgramData\Finesse\logs`. Please include them when you [open an issue](https://github.com/CoffeeCC/finesse/issues). |

## Updating and uninstalling

- **Updates** happen inside Finesse (Settings → Updates). Finesse downloads the new version next
  to the one running, restarts on it, and goes back by itself if the new one won't start.
- **Uninstall** from Settings → Apps → Finesse (or run Finesse Setup and choose Uninstall). It
  removes Finesse and the apps it installed; your media folder stays. Tick the box to delete
  Finesse's settings too.
- **Coming from Finesse 2** (the Docker Desktop version)? Install this one, set it up, then
  remove the old one from Settings → Apps. Docker Desktop can go too if nothing else uses it.
