# Questions people ask

## Why does Finesse need the Docker socket?

Because installing and looking after the other apps is its job. Finesse creates Jellyfin, the
*arr apps, SABnzbd, qBittorrent and the VPN as containers, recreates any that stop, and applies
updates. It does that through the Docker Engine API, and that API is the socket.

Access to the socket is equivalent to root on the host, so it's guarded:

- Finesse only touches containers labelled `finesse.managed=true`. Anything else you run is left
  alone.
- Everything that changes the stack (setup, Settings → Server, restarts, updates, backups) needs a
  Jellyfin administrator. Before setup, it needs the one-time code the installer printed.
- The server has no npm dependencies, only Node's own modules, so there's no package supply chain
  to trust. You can read all of it in [`server/`](../server).

If you'd rather not give it the socket, use [adopt mode](adopt.md). Finesse then sits in front of
the Jellyfin and *arr apps you already run and never touches Docker.

## Who can do what?

| | Administrators | Everyone else you invite |
|---|---|---|
| Watch, My List, profiles | ✅ | ✅ |
| Search and **Request** | ✅ | ✅ (into your library folders only) |
| See downloads, pause, retry, cancel, cap the speed | ✅ | ✅ |
| Take back a request | ✅ | ✅ while nothing is downloaded yet |
| Play games | ✅ | ✅ |
| Settings → Server, invites, updates, backups | ✅ | — |
| Anything else in Sonarr, Radarr, Lidarr, SABnzbd or RomM (settings, keys, deleting files) | ✅ | — |

API keys never leave the server: Finesse adds them to requests itself.

## Is it safe to open to the internet?

That's what **Watch away from home** is for (Tailscale Funnel or Cloudflare Tunnel, both with
HTTPS). Only Finesse and Jellyfin are reachable that way, never the other apps. Before anything
is shown, people sign in with their Jellyfin account; preview clips need a sign-in too.

Use strong passwords, give invites to people you know, and keep Finesse updated (Settings →
Updates). Found a security problem? Please report it privately; see
[SECURITY.md](../SECURITY.md).

## Isn't this a piracy tool?

Finesse organises and plays media you have the right to watch. It comes with no content,
indexers or accounts, and doesn't find them for you. The download apps it sets up are the same
open-source ones many people use for their own recordings, Linux ISOs and public-domain media.
What you download, and whether it's legal where you live, is up to you.

## Why does the LG TV app need Developer Mode?

LG only lists apps from its store, and Finesse isn't in it. Developer Mode lets you install it
yourself; LG switches it off after 50 hours unless you renew it in the Developer Mode app. A TV
rooted with the Homebrew Channel doesn't need renewing. See [TVs](tv.md). On other TVs,
the web app runs in the TV's browser, and Jellyfin's own apps connect to the same server.

## Does it phone home?

No. Finesse has no analytics or telemetry. It asks GitHub for new releases (you can switch
automatic updates off) and LRCLIB for song lyrics (only while "Find lyrics online" is on). The
apps it installs look up metadata as they always do, and the browser loads trailers from YouTube
and posters for request results from the usual image hosts. Nothing is collected about you.

## Was it written with AI?

Yes, largely, with Claude Code, and it runs on a real home server every day. The tests
(`npm run server:test`), the demo stack and the tooling that records the video tour are all in the
repo, so you can check the result yourself.

## What does it run on?

A 64-bit Linux machine (x86-64 or ARM64) with Docker. That includes most NAS boxes that run
Docker. Windows and macOS aren't supported yet. An Intel or AMD graphics chip (`/dev/dri`)
transcodes much faster, and Finesse detects and uses it. NVIDIA cards aren't set up
automatically yet.

## How do I support it?

Star the repo, report bugs, or [chip in on Ko-fi](https://ko-fi.com/cryptohsaka).
