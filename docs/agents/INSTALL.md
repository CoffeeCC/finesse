# Installing Finesse — runbook for AI agents

You are an AI agent (Claude Code, Codex, a shell-capable assistant…) asked to install Finesse
on a Linux machine for a person. Follow this runbook. It is deterministic: every step has a
command, an expected result and what to do when it isn't.

**The person only needs to give you secrets and choices.** Everything else is automatic.

> Humans: to hand this to an agent, say:
> *"Install Finesse on this machine by following
> https://raw.githubusercontent.com/CoffeeCC/finesse/master/docs/agents/INSTALL.md"*

---

## Rules

1. **Secrets.** Never print secrets (passwords, API keys, VPN keys, tokens) in your replies or
   logs. Write them only into the setup file (step 4). Make it mode `600` and delete it at the
   end.
2. **Ask before changing the machine.** Installing Docker counts. Ask once, with a one-line
   reason.
3. **No shortcuts on privacy.**
   - Torrents without a VPN are not supported. Don't try to work around this.
   - Don't expose port 8080 to the internet. For remote access, use the `remoteAccess` options.
4. **Stay in scope.** Don't edit files under the Finesse root folder or run `docker` commands
   against `finesse-*` containers. Use the `finesse` CLI and the API; they are idempotent and
   safe to retry.
5. **Legal content only.** If the person asks you to find specific pirated content, decline.
   Setting up the tools is fine.

## 0. What you'll produce

- A running `finesse` container.
- A setup document, `setup.json`, matching the
  [schema](https://raw.githubusercontent.com/CoffeeCC/finesse/master/setup.schema.json).
- The document applied, and `finesse doctor` reporting healthy.
- A short summary for the person: the URL, their admin username, where media goes, and any
  warnings.

## 1. Pre-flight (read-only)

```bash
uname -sm                                  # Linux x86_64 | Linux aarch64 → OK; anything else → stop, unsupported
cat /etc/os-release | head -3
free -g | awk '/Mem:/ {print $2 " GB RAM"}'  # < 2 → warn; ≥ 4 recommended
df -h --output=target,avail -x tmpfs -x devtmpfs -x overlay | sort -k2 -h | tail -5
ls -l /dev/net/tun                         # missing → torrents unavailable (Usenet still fine)
command -v docker && docker info --format '{{.ServerVersion}}'
command -v curl
```

Decide:

- **`DATA`**: the folder for media and downloads. Suggest the mount with the most free space
  (for example `/mnt/storage/media`), then confirm it with the person.
- **`ROOT`**: the folder for app settings. Default `/opt/finesse`.

If `docker ps --filter name=^/finesse$ -q` prints an ID, Finesse is already installed. Skip to
step 5 with `finesse setup status`.

## 2. Collect the person's choices

Ask in **one message**, grouped. Use the defaults when the person doesn't care.

| Question | Default | Maps to |
|---|---|---|
| Admin username + password (8+ chars) | none (must ask) | `admin` |
| Server name | "Finesse" | `server.name` |
| Libraries: movies / shows / music | all three | `libraries` |
| Games: an optional retro-games library played in the browser | off | `libraries.games` (+ optional artwork keys in `games`) |
| Downloads: Usenet, torrents, both, none | none | `downloads` |
| Usenet provider, username, password, connection limit | none | `downloads.usenet.servers[]` |
| Indexer(s) + API key(s) | none | `downloads.indexers[]` |
| VPN provider + WireGuard private key & address (or OpenVPN user/pass) | none | `downloads.torrents.vpn` |
| Default quality: 720p / 1080p / 4k / any | 1080p | `quality.preset` |
| Remote access: none / Tailscale auth key / Cloudflare token + URL | none | `remoteAccess` |
| Invite email (SMTP) | none | `email` |

Time zone, country and language: detect them rather than asking. The language matters beyond
labels: Sonarr and Radarr only download a title in its original language or this one, so if the
household watches dubs in another language, ask which.

```bash
timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone
locale | sed -n 's/^LANG=\([a-z][a-z]\)_\([A-Z][A-Z]\).*/\1 \2/p'
```

Helpful facts for the person:

- **Usenet server addresses:**

  | Provider | Host |
  |---|---|
  | Newshosting | `news.newshosting.com` |
  | Eweka | `news.eweka.nl` |
  | Frugal | `news.frugalusenet.com` |
  | UsenetExpress | `news.usenetexpress.com` |
  | Easynews | `secure.news.easynews.com` |

  All use port 563 with SSL.
- **Indexer URLs:**

  | Indexer | URL |
  |---|---|
  | NZBgeek | `https://api.nzbgeek.info` |
  | DrunkenSlug | `https://api.drunkenslug.com` |
  | NZBPlanet | `https://api.nzbplanet.net` |
  | NZBFinder | `https://nzbfinder.ws` |

  The API key is on the indexer's profile/API page.
- **VPN keys** — where to find them, by provider:
  - **Mullvad:** Account → WireGuard configuration → generate. Copy `PrivateKey` and `Address`.
  - **Proton:** Downloads → WireGuard (enable NAT-PMP). Copy `PrivateKey`.
  - **PIA / Express / CyberGhost:** OpenVPN username + password.
  - **Other providers:** the full list with hints is in `GET /api/setup/info` → `vpnProviders`.

## 3. Install Finesse (starts the container only)

With the person's OK if Docker is missing (the installer installs it with `--yes`):

```bash
curl -fsSL https://raw.githubusercontent.com/CoffeeCC/finesse/master/install.sh -o /tmp/finesse-install.sh
sudo bash /tmp/finesse-install.sh --yes --root "$ROOT" --data "$DATA"
```

**Expected:** the output ends with `Finesse is running` and a `Setup code:`. Exit code 0.

| Error says | Do |
|---|---|
| `Docker is installed but not running` | `sudo systemctl start docker`, then re-run the installer |
| `Couldn't download ghcr.io/…` | Check `curl -sI https://ghcr.io`. Proxy or DNS issue: tell the person. |
| `Port … all in use` | Re-run with `--port 8090` |
| anything else | `sudo docker logs finesse | tail -50`, then stop and report |

## 4. Write and validate the setup document

Write `/root/finesse-setup.json` (mode 600). Minimal example; add only the sections the person
chose:

```json
{
  "$schema": "https://raw.githubusercontent.com/CoffeeCC/finesse/master/setup.schema.json",
  "admin": { "username": "alex", "password": "…" },
  "server": { "name": "The Den", "timezone": "America/New_York", "country": "US", "language": "en" },
  "libraries": { "movies": true, "shows": true, "music": false },
  "downloads": {
    "usenet": { "servers": [ { "name": "Newshosting", "host": "news.newshosting.com", "port": 563, "ssl": true, "username": "…", "password": "…", "connections": 30 } ] },
    "torrents": { "vpn": { "provider": "mullvad", "type": "wireguard", "wireguard": { "privateKey": "…", "addresses": "10.64.1.2/32" }, "countries": ["Netherlands"] } },
    "indexers": [ { "name": "NZBgeek", "kind": "newznab", "url": "https://api.nzbgeek.info", "apiKey": "…" } ]
  },
  "quality": { "preset": "1080p" }
}
```

More examples: [`examples/setup/`](../../examples/setup). Omitted sections mean "off":

- no `downloads` → Jellyfin only;
- `"usenet": null` or `"torrents": null` → off;
- Games → `"libraries": { "games": true }`. Artwork keys are optional:
  `"games": { "steamGridDbKey": "…", "igdb": { "clientId": "…", "clientSecret": "…" } }`
  ([docs/games.md](../games.md) says where to get them).

```bash
umask 077   # before writing the file
sudo docker exec -i finesse finesse setup validate - < /root/finesse-setup.json
```

**Expected:** `✔ The setup document is valid.` Otherwise each problem is printed as
`path: message`. Fix exactly that field and validate again. Unknown or misspelt keys are
rejected by name.

### Test the credentials for real

```bash
sudo docker exec -i finesse finesse setup check - < /root/finesse-setup.json
```

This logs in to each Usenet server and runs a real indexer search. It also starts a temporary
VPN tunnel (up to 90 s) and reports the public IP torrents will use. Each line is `✔`/`✖` plus
a message written for humans, so relay the `✖` ones and fix them with the person before
applying. It exits 0 only when everything passes. Add `--json` for `{ok, results[]}`.

## 5. Apply

```bash
sudo docker exec -i finesse finesse setup apply - < /root/finesse-setup.json
```

It streams progress and takes 5–15 minutes, mostly image downloads. It exits 0 when the server
is ready, or 1 with the reason.

- **Safe to re-run.** Finished steps are skipped and nothing is duplicated. After fixing a
  problem, run the same command again.
- **Your terminal timeout is shorter than that?** Run `finesse setup apply - --no-wait`, then poll
  `sudo docker exec finesse finesse setup status --json` until `.state` is `"done"` or
  `"error"`.
- **Warnings are not failures.** They appear as `!` lines (`.warnings[]` in the JSON), e.g.
  "Port 8096 was taken…" or "Indexer X: …". Pass them on to the person.

| Failure message contains | Meaning / fix |
|---|---|
| `no /dev/net/tun` | Torrents/Tailscale need TUN: `sudo modprobe tun` (and add to `/etc/modules`) or drop `torrents` |
| `isn't managed by Finesse` | A container named `finesse-<app>` already exists. Ask the person before removing or renaming it. |
| `didn't come up within` / `stopped unexpectedly` | `sudo docker logs finesse-<app> | tail -40` shows why (often disk full or permissions). |
| `Couldn't sign in to Jellyfin` | The admin password differs from an earlier run on the same folders. Use the original one. |
| `Pulling … failed` | Network or registry problem. Retry. |
| `The games database didn't start` / `RomM can't sign in to its database` | `sudo docker logs finesse-romm-db \| tail -40`. On a fresh install with no games data yet: `sudo docker rm -f finesse-romm finesse-romm-db`, delete `<ROOT>/config/romm-db` and apply again. Otherwise ask the person first. |

## 6. Verify

```bash
sudo docker exec finesse finesse doctor --json | jq '{services: [.health.services[] | {id, state}], vpn: .health.vpn.connected}'
```

**Healthy** means every service is `running` and `vpn` is `true` (if torrents were set up). The
VPN can need 30–60 s after setup, so re-check once.

Then delete the secrets file:

```bash
shred -u /root/finesse-setup.json 2>/dev/null || rm -f /root/finesse-setup.json
```

## 7. Report to the person

Tell them (never the passwords):

- **Open:** `http://<LAN-IP>:8080`, and sign in as `<admin username>`.
- **Media goes in:**
  - `<DATA>/media/movies`
  - `<DATA>/media/tv`
  - `<DATA>/media/music`
  - Games (if chosen): `<DATA>/media/games/roms/<system>` (e.g. `…/roms/snes`); they appear under
    **Games** within a few minutes.
- **TV:**
  - LG TVs: the Finesse app, address `<LAN-IP>:8080`.
  - Other TVs: any Jellyfin app, server `http://<LAN-IP>:8096` (or the port in the warnings).
- **Invites:** Settings → Server → Invites.
- **Health:** Settings → Server, or `sudo docker exec finesse finesse doctor`.
- **Warnings:** relay any from step 5.

## Reference

| Thing | Where |
|---|---|
| Setup document schema | `GET /api/setup/schema` or [`setup.schema.json`](../../setup.schema.json) |
| Provider hints, indexer suggestions, defaults | `GET /api/setup/info` (setup-code header) |
| Progress | `finesse setup status [--json]` / `GET /api/setup/status` |
| Health | `finesse doctor [--json]` / `GET /api/system/status` (admin) |
| Change the setup later | Edit the document and run `finesse setup apply` again (an admin action after setup). Apps the document leaves out are turned off; their settings are kept. Games also has its own switch in Settings → Server → Games. |
| Human guide | [docs/install.md](../install.md) |
