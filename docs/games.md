# Games

Finesse can host a library of retro games that everyone plays right in the browser: NES, SNES,
Game Boy, Genesis, Nintendo 64, PlayStation and more. It uses [RomM](https://romm.app) to keep
the library, and [EmulatorJS](https://emulatorjs.org) to play the games on your own device.

Games is **off by default**. Finesse doesn't come with any games: you add games you own.

## Turn it on

- **New install:** on the setup page's **Libraries** step, pick **Games**.
- **Existing install:** **Settings → Server → Games → Add Games** (or re-apply your setup
  document with `"libraries": { "games": true }`). Nothing else changes.

To turn it off again, use **Remove Games** in the same place. Your games and RomM's data stay in
their folders, so adding Games back later picks up where you left off.

Finesse installs RomM and its database, creates an account for itself in RomM and adds **Games**
to everyone's menu.

## Add games

Put games in your media folder, one folder per system:

```
<media folder>/media/games/
├── roms/
│   ├── nes/        Super Mario Bros. (USA).nes
│   ├── snes/       Chrono Trigger (USA).sfc
│   ├── gba/        …
│   └── psx/        Final Fantasy VII (USA)/  ← multi-disc games in a folder
└── bios/
    └── psx/        scph5501.bin              ← some systems need BIOS files
```

New games show up under **Games** within a few minutes, and there's a full rescan every night.
Folder names are RomM's system names: `nes`, `snes`, `n64`, `gb`, `gbc`, `gba`, `nds`,
`genesis`, `sms`, `gamegear`, `psx`, `pce`, `atari2600`, `arcade` and
[many more](https://docs.romm.app/latest/Getting-Started/Folder-Structure/).

## Box art

Covers and descriptions come from free sources (LaunchBox, Hasheous, libretro) with no setup. For
more, add these optional keys on the setup page, or in your setup document under `games`:

| Key | Where to get it |
|---|---|
| **SteamGridDB API key** | Free account at [steamgriddb.com](https://www.steamgriddb.com) → Preferences → API |
| **IGDB Client ID + Secret** | Free Twitch developer app at [dev.twitch.tv](https://dev.twitch.tv/console/apps) |
| **ScreenScraper** username + password | Free account at [screenscraper.fr](https://www.screenscraper.fr) (setup document only) |

## Playing

Open a game and press **Play**. It runs on your device, not the server, so a phone or laptop
from the last few years handles everything up to PlayStation and PSP. Finesse uses the emulator
that comes with RomM and hands it the console's BIOS from RomM's firmware (scanned from `bios/`
or uploaded in RomM). PSP and DOS games need Chrome, Edge or Firefox. 3DS and
Intellivision are Beta: they use EmulatorJS's preview build, and 3DS needs a fast computer.

Consoles that need a PC emulator show **Browse only**: Switch, PS2 and PS3, GameCube, Wii and
Wii U, Xbox and Dreamcast. With [game streaming](streaming.md), Finesse can add their emulators
to Wolf (PCSX2, Dolphin, RPCS3, Cemu, Ryujinx or Eden, and ES-DE): those consoles then show
**Play on Moonlight**, with the app that plays them. See [Emulators](emulators.md). Plug in a controller, or use the
keyboard. On a TV, lighter systems (8- and 16-bit) play best. In-game saves are kept by the
browser on the device you play on.

Want Steam and PC games on the TV too? They stream from the server with Wolf and Moonlight. See
[Game streaming](streaming.md).

## Where things are kept

| What | Where |
|---|---|
| Your games | `<media folder>/media/games` |
| RomM's artwork and uploads | `<config folder>/config/romm/resources` and `…/assets` |
| RomM's settings | `<config folder>/config/romm/config/config.yml` |
| Library database (MariaDB) | `<config folder>/config/romm-db` |
| Nightly database backups (last 7) | `<config folder>/config/romm/backups` |

## Using your own RomM

Already run RomM? Point Finesse at it instead (in the Finesse container's environment):

```
ROMM_URL=http://romm:8080
ROMM_USERNAME=finesse
ROMM_PASSWORD=…            # an admin or viewer account in your RomM
STEAMGRIDDB_API_KEY=…      # optional
```
