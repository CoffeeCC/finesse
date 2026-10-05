# Finesse on Windows

**[Download Finesse Setup](https://github.com/CoffeeCC/finesse/releases/latest/download/FinesseSetup.exe)**
(about 6 MB), run it, and follow Nessa. It takes about ten minutes, plus one restart if Docker
is new to the PC.

> **"Windows protected your PC"?** Finesse Setup isn't signed with a paid certificate yet, so
> SmartScreen doesn't know it. Choose **More info → Run anyway**. The source is all in this repo
> (`windows/installer/`), and GitHub builds the download from it.

## What it does

1. **Checks the PC**: Windows version, memory, virtualization, free space.
2. **Installs Docker Desktop** if it's missing (download, one Windows permission prompt), then
   restarts. Finesse Setup opens again by itself afterwards and carries on.
3. **Asks where your media lives.** It suggests the drive with the most room
   (`D:\Finesse`, say). Movies, shows, music and downloads all go in its `media` folder
   (`D:\Finesse\media\movies`, `…\tv`, `…\music`).
4. **Installs Finesse**: downloads it, starts it, lets phones and TVs on your home network reach
   it (a second permission prompt), and adds **Finesse** to the Start menu and desktop.
5. **Done**: a button opens the setup page in your browser, and a QR code opens it on your phone.
   From there it's the same as everywhere else: see [the install guide](install.md#2-the-setup-page).

While it works, Lo-Finessa (original lo-fi made for Finesse) plays if you like. The button in
the title bar turns it off, and it remembers.

## What you need

- **Windows 11, or Windows 10 version 2004 or newer**, 64-bit (x64 or ARM).
- **Virtualization turned on** in the PC's BIOS/UEFI ("Intel VT-x" or "AMD SVM"). Most PCs have
  it on; Finesse Setup checks.
- **8 GB of memory** or more is comfortable (4 GB works, slowly).
- **A drive with room for your media**, inside the PC (network drives and USB sticks don't work
  with Docker Desktop).
- **Docker Desktop**, which Finesse Setup installs. It's free for personal use and for small
  businesses; see Docker's terms.

## How it fits together

- Finesse and its apps run in **Docker Desktop**, like on Linux.
- **Your media folder** is an ordinary Windows folder. Docker Desktop shares it with the apps.
- **Finesse's own settings** (accounts, app setup, watch history) live inside Docker, in a volume
  called `finesse`. Their databases aren't safe on Windows folders, so they stay there. Back them
  up from **Settings → Server → Backups** in Finesse.
- **Finesse runs whenever Docker Desktop does**, and Docker Desktop starts when you sign in to
  Windows. On a PC that's mainly a server, let Windows sign you in automatically (or just stay
  signed in) and Finesse is always there.

### Different from Linux

- **No hardware transcoding.** Docker Desktop doesn't pass Intel or AMD graphics through, so
  Jellyfin converts video on the processor. Most phones and TVs play files directly, so this
  matters only for big 4K files on weak devices.
- **Downloads are copied into the library**, not linked (Windows folders shared with Docker can't
  hard-link). Leave room for a file twice while it's being moved.
- **Library scans are a little slower** on Windows folders.

## Adding your movies and shows

In Finesse, open the account menu → **Add media**, or drag files and folders onto any page: they
go into the right library and show up a minute later. Or copy them straight into
`D:\Finesse\media\movies`, `…\tv` and `…\music` in File Explorer.

## Phones and TVs can't reach it?

- **Is the Wi-Fi set to Public?** Windows hides the PC from other devices on Public networks.
  Settings → Network & internet → your Wi-Fi or Ethernet → **Private network**. Finesse Setup warns
  you if it's Public.
- **Did you say no to the firewall prompt?** Run Finesse Setup again and choose **Let them in
  again**, or allow ports 8080 and 8096 yourself in Windows Defender Firewall.
- Use the address Finesse Setup showed (like `192.168.1.50:8080/finesse`), on the same network.

## Troubleshooting

| Problem | What to do |
|---|---|
| **"Virtualization: Off"** | Restart into your BIOS/UEFI (often Del, F2 or F10 at power-on), turn on Intel VT-x / AMD SVM, save, and run Finesse Setup again. |
| **Docker Desktop didn't finish starting** | Look for its window: the first time, it may want you to accept its terms or skip signing in. Then press **Try again**. |
| **"Sign out, sign back in"** | Windows lets your account use Docker only after it signs in again. Restart, and Finesse Setup carries on. |
| **Docker Desktop didn't install** | Install it from docker.com yourself, then run Finesse Setup again. It skips straight past. |
| **Anything else** | The log is at `%LOCALAPPDATA%\Finesse\setup.log`. Please include it when you [open an issue](https://github.com/CoffeeCC/finesse/issues). |

## Updating and uninstalling

- **Updates** happen inside Finesse (Settings → Updates), like on Linux. Finesse Setup isn't
  needed again.
- **Uninstall** from Settings → Apps → Finesse (or run Finesse Setup and choose Uninstall). It
  removes Finesse and the apps it installed; your media folder stays. Tick the box to delete
  Finesse's settings too. Docker Desktop stays installed; remove it separately if you like.
