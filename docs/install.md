# Install Finesse

Finesse turns a Linux computer into your own streaming service. One installer starts Finesse. A
setup page in your browser then installs and connects the rest:

| App | Job |
|---|---|
| **Jellyfin** | Streams your library to every screen. Finesse is the app people use; Jellyfin runs behind it. |
| **Sonarr · Radarr · Lidarr** | Find new shows, movies and music when someone presses **Request**. |
| **Prowlarr** | Keeps your indexers (search sites) and shares them with the three above. |
| **SABnzbd** | Downloads from Usenet. |
| **qBittorrent + Gluetun** | Downloads torrents, **only** through your VPN, with a kill switch. |
| **Tailscale / Cloudflare Tunnel** | Optional: reach Finesse away from home without opening router ports. |
| **RomM + MariaDB** | Optional: a library of retro games you play in the browser. See [Games](games.md). |

Each app runs in its own Docker container, pinned to a version tested with this Finesse release.
Finesse watches them, repairs them, backs them up and updates them.

> Using Jellyfin, Sonarr and friends already? See [Use your existing setup](adopt.md). Finesse
> can sit in front of what you have instead of installing it.

---

## What you need

- **A 64-bit Linux computer** (x86-64 or ARM64) that stays on: a mini PC, an old laptop, a NAS
  that runs Docker, or a Raspberry Pi 4/5 with 4 GB+. Ubuntu, Debian, Linux Mint, Pop!_OS,
  Fedora, Arch, openSUSE, Raspberry Pi OS (64-bit), Bazzite and the other Fedora Atomic systems,
  Unraid and Synology all work. On **TrueNAS SCALE**, install it from the Apps page instead: see
  [Finesse on TrueNAS](truenas.md).
- **4 GB of memory** or more, and **disk space for your media**. Movies are 2–60 GB each, so
  plan for a big disk.
- **Docker.** The installer can install it for you.
- *For downloads (optional):*
  - **Usenet**: a Usenet provider (about $3–10/month) and an indexer account (about
    $10–20/year).
  - **Torrents**: a VPN subscription. Finesse never runs torrents without one.

On **Windows**, use [Finesse Setup](windows.md) instead: a download that installs Docker Desktop and
Finesse for you. macOS isn't supported yet.

## 1. Run the installer

On the Linux computer:

```bash
curl -fsSL https://raw.githubusercontent.com/CoffeeCC/finesse/master/install.sh | bash
```

Nessa, the Finesse mascot, says hi and walks you through it. It asks two things:

1. **May it install Docker**, if Docker is missing. It uses get.docker.com where that works and
   your system's own Docker package elsewhere (Linux Mint, Arch, openSUSE…). On Bazzite and other
   image-based systems, Docker is added as a layer and the computer restarts once; on a desktop, a
   window opens by itself when you sign in again and carries on.
2. **Where your media should live.** It lists your disks with the most free space. Pick the big one.

On a desktop it also offers to play Lo-Finessa (original lo-fi made for Finesse) while it works.
Then it starts Finesse and prints something like:

```
  All set!  Finesse is running. Open the link below on any phone or computer at home to finish setting up.

  ──────────────────────────────────────────────────────────
     http://192.168.1.50:8080/finesse/setup?code=K7QM-3XPD
  ──────────────────────────────────────────────────────────
    Setup code K7QM-3XPD
```

Open that address from any computer or phone on the same network: there's a QR code under it for
your phone, and on a desktop it offers to open the page in your browser.

<details>
<summary>Installer options</summary>

| Option | What it does |
|---|---|
| `--data /mnt/media` | Media & downloads folder (skips the question) |
| `--root /opt/finesse` | Where app settings live (default `/opt/finesse`) |
| `--port 8080` | Port for Finesse (the next free one is used if it's taken) |
| `--version 1.0.0` | Install a specific version |
| `--setup setup.json` | Build everything from a setup file, with no browser. See [For AI agents](agents/INSTALL.md) |
| `--yes` | Accept every default (installs Docker if missing) |
| `--plain` | No colours or pictures, for logs and screen readers (`NO_COLOR=1` does the same) |
| `--uninstall` | Remove Finesse and its apps. **Your files are kept.** |

To pass options through the pipe: `curl -fsSL …/install.sh | bash -s -- --data /mnt/media`.
</details>

## 2. The setup page

The setup page walks through everything in about ten minutes. You can go back and change any
answer before you press **Build**.

| Step | What to have ready |
|---|---|
| **Setup code** | The code the installer printed. Lost it? `sudo docker exec finesse finesse setup-code` |
| **This machine** | Nothing. Finesse checks Docker, disk space, VPN support and graphics. Red items tell you what to fix. |
| **Your account** | A username and password for you, the administrator. Time zone, country and language are guessed from your browser. The language is also what downloads come in, besides each title's original language. |
| **Libraries** | Movies, TV shows, music and (optionally) games: pick what you'll collect. |
| **Downloads** | Usenet, torrents, both or neither. **Neither** just streams files you add yourself. |
| **Usenet** | Pick your provider (the server address fills in), then your username, password and connection limit. **Test connection** checks the login. |
| **VPN** | Pick your provider. It tells you where to find your WireGuard key or OpenVPN login. You can paste a WireGuard config file whole. **Test the VPN** starts a real tunnel and shows the address torrents will use. |
| **Indexers** | Add your indexer with its API key (usually on its profile or API page). **Test** runs a real search. |
| **Quality** | 720p, 1080p, 4K or anything. This is only the default; each request can choose its own. |
| **Away from home** | Optional. Tailscale Funnel (free) or Cloudflare Tunnel (your own domain). Each option lists its steps. |
| **Invite emails** | Optional. Any email account that allows SMTP: Gmail with an app password, iCloud, Fastmail, Resend… |
| **Review** | Check it all, then **Build my server**. |

Building is mostly downloading about 3 GB of apps: under a minute when they're already on the machine, up to about 15 minutes on a slow connection. You can close the page and
come back. When it's done, press **Start watching** and you're signed in.

## 3. After setup

- **Add what you already have.** In Finesse, open the account menu → **Add media**, or just drag
  files onto any page. Single files or whole folders, from your computer, a USB drive or a network
  share: Finesse sorts them into Movies, TV shows, Music and Games and lists where each will go;
  fix any that are wrong, then press **Add**. Big files resume if the connection drops, Jellyfin
  picks them up within a minute or two, and **Remove** takes a file back for a day. On the
  server itself you can also copy files into `…/media/movies`, `…/media/tv` and `…/media/music`
  inside your media folder (name movies `Title (Year)`, and put shows in `Show Name/Season 01/`).
- **Delete something.** On a movie, show, season or episode, **More → Delete from library…**; on
  an album, **Delete album…**. Finesse says how much space comes back, tells Radarr, Sonarr or
  Lidarr not to download it again, deletes the files and takes it out of the library.
- **Request something.** Search for any title and press **Request**. It downloads, is renamed,
  and appears in your library on its own.
- **Watch on the TV.** See [Watch on your TV](tv.md).
  - **LG TVs:** install the Finesse app and enter your server's address (e.g. `192.168.1.50:8080`).
  - **Other TVs:** open `http://<server>:8080/finesse/` in the TV's browser, or use any Jellyfin
    app with server `http://<server>:8096`. The setup-complete page shows the exact port.
- **Invite people.** **Settings → Server → Invites** creates a link or QR code, or emails it. Each
  person creates their own account and only sees the libraries you choose.
- **Check on things.** **Settings → Server** shows every app's health, the VPN, disk space,
  backups and logs, with Restart and Pause buttons. From a terminal, run
  `sudo docker exec finesse finesse doctor`.

## Change your setup

**Games** has its own switch: **Settings → Server → Games**. For anything else (adding downloads
to a streaming-only server, a new VPN, a new Tailscale key), describe the setup you want in a
[setup document](../setup.schema.json) and apply it:

```bash
sudo docker exec -i finesse finesse setup check - < my-setup.json   # optional: test logins first
sudo docker exec -i finesse finesse setup apply - < my-setup.json
```

Use your current administrator username and password in `admin`. [`examples/setup/`](../examples/setup)
has documents to start from. Applying only changes what's different: your library, watch
history, users and invites stay as they are, and apps you already have keep their settings.
Describe everything you want to keep: apps the document leaves out (downloads, Games, remote
access) are turned off. Their settings stay in their folders, so turning them back on later picks
up where they left off.

## Keeping it running

Finesse looks after itself:

- **Every minute** it recreates any app that went missing and restarts any that stopped (unless
  you paused it). It reconnects qBittorrent when the VPN restarts. It also checks the VPN, disk
  space and each app's health.
- **Every night** each app snapshots its database. Finesse also saves its own settings and every
  app's settings to `…/config/finesse/backups` (it keeps the last 14). See [Backups](#backups).
- **Updates.** When a new Finesse is out, admins see an **Update** dot on their avatar. The update:
  1. backs up;
  2. downloads the new version;
  3. restarts Finesse.

  If the new version doesn't start, Finesse **rolls back by itself**. New releases also bring
  newer tested versions of Jellyfin and the other apps. With **Update apps automatically** on
  (the default), those install overnight after a backup.

### Backups

**Settings → Server → Backups → Back up now** lets you choose what goes in, with the size of
each part:

| Part | What it holds |
|---|---|
| **Finesse settings & invites** | Always included. |
| **App settings** | Keys, download clients, indexers and quality profiles for each app. |
| **Watch history & accounts** | Jellyfin's database: accounts, what everyone watched and where they stopped. |
| **Requests & download history** | Everything Sonarr, Radarr and Lidarr follow, plus Prowlarr's indexers. |
| **Games library & saves** | RomM's library and collections, save games and save states. |

Databases are copied safely while the apps keep running. **Download** saves the file to your
computer, so a copy lives off the server. Finesse keeps the newest three backups that include
databases or games (they can be big), plus the nightly ones.

Movies, shows and music are never in a backup: they're far too big. Copy the media folder to
another disk, or snapshot it if your NAS can.

From the command line: `sudo docker exec finesse finesse backup --all`, or pick parts with
`--with watch,requests`.

### Restoring a backup

On the same machine, or a new one:

1. **On a new machine,** install Finesse with the same `--root` and `--data` paths as before.
2. Copy the backup into `…/config/finesse/backups/` (or give its full path in the next step).
3. Run `sudo docker exec finesse finesse restore finesse-backup-<date>.tar.gz`.
   - Add `--only watch` (or `settings`, `apps`, `requests`, `games`, comma-separated) to bring
     back only some parts.
   - Each app is stopped while its database goes back, then started again.
4. If it restored settings, run `sudo docker restart finesse`. Finesse recreates any missing apps
   with their old settings, keys and databases. RomM's games library is imported a minute
   later, once its database is running.

## Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/CoffeeCC/finesse/master/install.sh | bash -s -- --uninstall
```

This removes Finesse and every app it installed. **Your media, downloads and settings stay** in
the folders you chose. Delete them yourself if you want them gone.

---

## Troubleshooting

Start with `sudo docker exec finesse finesse doctor`. It names what's wrong.

| Problem | Fix |
|---|---|
| **Bazzite, Bluefin, Silverblue…: "image-based system"** | Docker is layered in with `rpm-ostree install moby-engine`. Restart, then run the installer again. It carries on from there. |
| **"This computer's docker command is Podman"** | Finesse needs Docker itself. Fedora: `sudo dnf swap podman-docker moby-engine`. Image-based systems: `sudo rpm-ostree override remove podman-docker --install moby-engine`, then restart. |
| **"This Docker comes from the Snap Store"** | Snap's Docker can't reach folders outside your home. `sudo snap remove docker`, then run the installer again and it installs the regular Docker. |
| **"Docker can't start inside this container"** (Proxmox) | In the container's **Options → Features**, turn on **Nesting** (and **keyctl** for unprivileged containers), then restart it. For torrents, also pass `/dev/net/tun` through. |
| **Windows (WSL)** | Turn on systemd (`[boot]` `systemd=true` in `/etc/wsl.conf`, then `wsl --shutdown`). For phones and TVs to reach it, set `networkingMode=mirrored` under `[wsl2]` in `%UserProfile%\.wslconfig`. |
| **Raspberry Pi: "32-bit system"** | Install the 64-bit Raspberry Pi OS. Finesse's apps are 64-bit only. |
| **Raspberry Pi 5: an app won't start** | Pi 5 kernels use 16K memory pages, which a few apps don't support. Add `kernel=kernel8.img` to `/boot/firmware/config.txt` and restart. |
| **Fedora/RHEL: apps can't open their folders** | That's SELinux. Finesse turns labels off for its own apps on SELinux systems. If you installed by hand, add `--security-opt label=disable` to the Finesse container. |
| **Other devices can't open the address** | Check the computer's firewall lets the port through (the installer does this for firewalld), and that the device is on the same network. |
| **Alpine: "bash: not found"** | `apk add bash curl`, then run the installer again. |
| **"Finesse can't reach Docker"** | Finesse needs `/var/run/docker.sock`. Reinstall with the installer, or add `-v /var/run/docker.sock:/var/run/docker.sock` to your `docker run`. |
| **"No /dev/net/tun"** | The VPN needs the TUN device. Run `sudo modprobe tun`, and add `tun` to `/etc/modules` so it loads at boot. On Proxmox LXC, allow `/dev/net/tun` in the container config. |
| **The media folder "isn't writable"** | Finesse runs its apps as the user who ran the installer. `sudo chown -R $(id -u):$(id -g) /your/media/folder`. |
| **Port 8080 or 8096 is in use** | The installer and setup pick the next free port and tell you which. |
| **Usenet: "The username or password was rejected"** | Some providers use a separate *news* username. Check the provider's account page. |
| **Usenet: "Too many connections"** | Lower **Connections** to your plan's limit. |
| **Indexer: "The API key is wrong"** | Copy the key again from the indexer's API/profile page (not the RSS link). |
| **VPN: "The provider rejected the credentials"** | For WireGuard, generate a *new* key in your provider's dashboard. Keys are often tied to one device. For OpenVPN, use the service username, not your email. |
| **VPN: "didn't connect within 90 seconds"** | Try another country, or leave countries empty. |
| **Tailscale: "the auth key was rejected"** | Keys expire. Create a new one, put it in your setup document and re-apply it (`finesse setup apply`, see [Change your setup](#change-your-setup)). |
| **Setup stopped halfway** | Fix what it says, then press **Try again**. Finished steps are skipped. |
| **"Setup was interrupted"** | Finesse restarted mid-setup. Open the setup page and run it again. |
| **An update "went back to the previous version"** | The new version failed its health check and Finesse rolled back. Nothing changed. Check `sudo docker logs finesse` and [report it](https://github.com/CoffeeCC/finesse/issues). |
| **Lost the setup code** | `sudo docker exec finesse finesse setup-code` |
| **Anything else** | `sudo docker logs finesse` (and **Settings → Server → Logs** for each app). Please include them when you [open an issue](https://github.com/CoffeeCC/finesse/issues). |

## Security notes

- Finesse controls Docker through `/var/run/docker.sock`. It only ever touches containers labelled
  `finesse.managed`, but anything with that socket is effectively root on the machine. Don't
  expose Finesse's port to the internet directly. Use Tailscale, Cloudflare Tunnel or a reverse
  proxy with HTTPS.
- Until setup is finished, every setup call needs the one-time **setup code**, so a neighbour on
  the same network can't claim a fresh install. The code stops working 30 minutes after setup.
- The apps' API keys and passwords stay on the server. Browsers only ever talk to Finesse, which
  adds the keys itself.
- Torrents only run inside the VPN container's network (Gluetun's kill switch). If the VPN drops,
  torrents stop; they never fall back to your normal connection.
- **Household members** (people you invite) can browse, play, request and steer downloads. Deleting
  files, settings and API keys need an administrator: what the apps receive on their behalf is
  written by Finesse, not passed on from the browser.
- **If Jellyfin is briefly unreachable** (restarting, updating), a sign-in it confirmed in the last
  six hours keeps working, so admins can watch it come back. Signing someone out, or removing an
  account, takes full effect once Jellyfin answers again.
- **Open invite links** make at most a few accounts an hour from any one address. Prefer single-use
  invites for people you don't know well.
- **Groups:** a friend's server only reaches what you share, through a short allow-list. Narrowing
  what you share takes effect on their accounts before Finesse says it's saved (if Jellyfin can't
  be reached, their access pauses until it can). Friends' addresses must be `https://` unless
  they're on your home network or Tailscale.
- **Preview clips** are for signed-in people who can see that title, and are never cacheable by a
  shared proxy.
