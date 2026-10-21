<div align="center">

# Finesse.

**Your own streaming service.** Movies, shows and music on every screen, installed, connected
and looked after for you.

[![Watch the tour](docs/media/tour-poster.jpg)](https://youtu.be/94vEFzmN3OQ)

**[▶ Watch the tour with Nessa](https://youtu.be/94vEFzmN3OQ)** · [Install](#install) ·
[Features](#what-you-get) · [For AI agents](docs/agents/INSTALL.md) · [Docs](docs/install.md)

</div>

---

Finesse turns any Linux computer into a Netflix-style service for your household. One command
installs it. A setup page in your browser then installs and connects everything else:
[Jellyfin](https://jellyfin.org) for streaming, Sonarr, Radarr and Lidarr for requests,
Prowlarr for indexers, SABnzbd for Usenet and qBittorrent, which only ever runs behind your
VPN. Once it's built, Finesse keeps the whole thing healthy, backed up and up to date.

Everyone at home uses one app, on the web, their phone and the TV: a home that feels more like
a games console than a catalogue, with the art of whatever you rest on filling the screen.

## The tour

A quick 3:25 tour with Nessa, our mascot: installing Finesse on Windows or Linux, the setup
page, and a look around the app on the web, a phone and a TV.
[Watch it on YouTube](https://youtu.be/94vEFzmN3OQ).

The demo library is made of freely licensed and public-domain films and music. See the
[credits](docs/media/CREDITS.md).

## Install

**Windows:** [download Finesse Setup](https://github.com/CoffeeCC/finesse/releases/latest/download/FinesseSetup.exe)
and run it. Finesse installs as a normal Windows program (no Docker) and walks you through the rest ([guide](docs/windows.md)).

**Linux**, on a 64-bit machine (x86-64 or ARM64) that stays on:

```bash
curl -fsSL https://raw.githubusercontent.com/CoffeeCC/finesse/master/install.sh | bash
```

The installer sets up Docker if it's missing, asks where your media should live, starts Finesse
and prints a setup link. Open that link on any device on your network. The setup page takes
about ten minutes, and nothing is installed until you press **Build my server**.

- **[Install guide](docs/install.md)**: requirements, every setup step, troubleshooting and security.
- **[Already run Jellyfin or the *arr apps?](docs/adopt.md)** Finesse can sit in front of what you
  already have.
- **[TrueNAS SCALE](docs/truenas.md)**: install it from the Apps page, listed with your other apps.
- **[Groups](docs/groups.md)**: share libraries with friends who run Finesse too, and watch and listen to theirs.
- **[Watch on your TV](docs/tv.md)**: the LG webOS app, and other TVs.
- **[Android app and Android Auto](docs/android.md)**: Finesse as an app on Android phones, with your
  music in the car next to Maps.
- **[Games](docs/games.md)**: turn on the optional retro-games library.
- **[Game streaming](docs/streaming.md)**: Steam on the TV with Wolf and Moonlight. Finesse sets Wolf up, or works with yours.
- **[Emulators](docs/emulators.md)**: PS2, GameCube, Wii, PS3, Wii U and Switch as Wolf apps, from your RomM library, or in the browser (Beta).
- **[Let an AI agent install it](docs/agents/INSTALL.md)**: a runbook written for coding agents,
  with a [setup document](setup.schema.json) they can fill in and apply without a browser.

## What you get

### Watching

- **A home that's alive.** Everything that's *now* sits in one row: what you're in the middle
  of, the next episode, what's playing in other rooms, your games, a friend's pick and what just
  arrived. Rest on one and its art (then its preview clip) fills the screen, and the whole app
  takes on its colour. A live line underneath says what's happening in the house.
- **The quick menu.** One button for the whole house: who's playing what and where, how the
  server is doing, downloads, game streaming and friends.
- **Pick up a controller.** Xbox, PlayStation and Switch controllers drive everything, in the
  browser and on the TV: move, select, back, search, the quick menu, tabs and the player.
- **Rows that know you.** **My List**, the household's **Top 10**, *Because you watched*, recently
  added and genre rows. Hide, reorder or add rows with **Customize Home**.
- **Previews everywhere.** Hover a poster, or open a title, and a short clip plays. Finesse
  makes the clips itself in the background: spoiler-light four-cut teasers for episodes.
- **A proper player.** Big, clear controls, a preview as you scrub, chapters and intro/credits
  marks, one menu for audio and subtitles, and a pause screen that shows what's on and what's
  next. The audio and subtitle languages you pick are remembered for the whole series.
- **Search everything.** Press <kbd>/</kbd> anywhere for movies, shows, episodes and people as
  you type.
- **Browse your way.** Genre filters, watched/unwatched chips, any sort order, an A–Z rail, and
  **Surprise me**.
- **Music.** Albums and artists, a real music player, synced lyrics (found online when your
  files don't have them) and a full-screen lyric video.
- **Games.** Optional: retro games (NES to PlayStation) that play right in the browser, with the
  library kept by [RomM](https://romm.app). See [Games](docs/games.md).
- **Game streaming.** One switch sets up [Wolf](https://games-on-whales.github.io/wolf/stable/), which
  runs Steam on your server and streams it to Moonlight on TVs, phones and computers. Finesse
  checks the server first, lists what you can play, and pairs devices with Moonlight's PIN.
  Already run Wolf? Connect it instead. See [Game streaming](docs/streaming.md).
- **Friends' libraries.** Friends who run Finesse too can share their films, shows and music with
  you, and you with them: watch- and listen-only, with nobody getting an account on anyone's
  server. See [Groups](docs/groups.md).

### Getting new things

- **Request anything.** If a search finds nothing in your library, press **Request**. Finesse
  finds it, downloads it, renames it and adds it to the library.
- **The right language.** Downloads come in the title's original language or yours (the one
  you pick in setup), never one nobody at home speaks. The original or dual audio wins a tie.
  Anime is added as anime, so episodes are found by their absolute numbers.
- **Follow along.** See requests waiting for a release and live download progress. Pause
  downloads, cap their speed or pick a different quality from inside the app.
- **Safe by default.** Torrents only ever run inside the VPN's network, with a kill switch.
  Every API key stays on the server.

### Every screen

- **Web**, on any computer.
- **Phones**: a touch-first layout with bottom tabs, a full-screen player and double-tap to skip.
  Add it to your home screen like an app.
- **Android and Android Auto**: the [Finesse app for Android](docs/android.md) puts your music on
  the car screen, next to Maps, with the car's controls.
- **TVs**: an **LG webOS app** that updates itself, and full D-pad navigation in any TV browser.
  Everything is reachable with the arrows and OK.
- **Play on another device.** Send what you're watching to the TV, then use your phone as the
  remote. **Continue here** picks up what's playing elsewhere.

### Your household

- **Profiles.** Everyone gets their own account, history, My List and settings, synced across
  their devices.
- **Invites.** Create a link or QR code, or email it. People create their own account and see
  only the libraries you choose.
- **Away from home.** Optional Tailscale Funnel or Cloudflare Tunnel, with no router changes.
- **Make it yours.** Accent colour, display size and interface sounds.

### It looks after itself

- **Every minute** it checks each app, the VPN and your disks. It recreates or restarts anything
  that has stopped.
- **Every night** it backs up every app's settings and database.
- **Updates in one click.** Finesse backs up, updates and rolls back by itself if the new
  version doesn't start. Newer tested versions of Jellyfin and the other apps install
  overnight.
- **Settings → Server** shows each app's health, the VPN's public address, storage, backups
  and logs, with Restart and Pause buttons.

## Screenshots

| | |
|---|---|
| ![Home](docs/media/home.jpg) | ![A title's page](docs/media/detail.jpg) |
| ![The player](docs/media/player.jpg) | ![Requests](docs/media/request.jpg) |
| ![Music with synced lyrics](docs/media/music.jpg) | ![Settings → Server](docs/media/system.jpg) |
| ![The setup page](docs/media/setup.jpg) | ![On a TV](docs/media/tv.jpg) |

<p align="center"><img src="docs/media/phone.jpg" alt="Finesse on a phone" width="300"></p>

## How it's built

Finesse is two things in one Docker image:

- **The app** (`src/`): React 19, TypeScript, Vite and Tailwind. It talks to Jellyfin for media
  and to the Finesse server for everything else. The same code builds the LG TV app, which runs
  on the TV's Chromium 68.
- **The server** (`server/`): Node 22 with no npm dependencies. It serves the app, proxies
  Jellyfin and the *arr APIs (adding their keys itself), runs invites and updates, and
  installs, wires and maintains the stack through the Docker Engine API.

Every app it installs is pinned to a version tested with that Finesse release. Finesse only
touches containers labelled `finesse.managed`, and re-running setup changes nothing that's
already right. See [ROADMAP.md](ROADMAP.md) for the architecture and the reasoning behind it.

## Questions

Why it needs the Docker socket, who can do what, opening it to the internet, the LG Developer Mode
timer and more: see the [FAQ](docs/faq.md).

## Contributing

Bug reports and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and
[AGENTS.md](AGENTS.md) (the working guide for people and AI agents) first. For security issues,
see [SECURITY.md](SECURITY.md).

```bash
npm ci
npm run dev             # the app on http://localhost:5173/finesse/
npm run server:test     # server tests (no Docker needed)
```

## Support Finesse

Finesse is free, and it's made in spare time. If it makes movie night better, you can
[chip in on Ko-fi](https://ko-fi.com/finesseserver). There's a **Support Finesse** button in
Settings → About too.

## Please use it responsibly

Finesse organises media you have the right to watch. It doesn't come with any content,
indexers or accounts, and it doesn't find them for you. What you download, and whether it's
legal where you live, is up to you.

Finesse isn't affiliated with Jellyfin, the Servarr projects, SABnzbd, qBittorrent, Gluetun,
Tailscale or Cloudflare. It installs their official images and relies on their great work.

## License

[MIT](LICENSE). The demo media in the tour and screenshots has its own licenses, listed in
[docs/media/CREDITS.md](docs/media/CREDITS.md).
