# Emulators: PS2, GameCube, Wii, PS3, Wii U and Switch on Moonlight

Some consoles are too much for a browser, so **Games** marks them "Browse only". With
[game streaming](streaming.md) on, Finesse adds their emulators to Wolf as apps. They run on
the server's graphics card and stream to Moonlight like Steam does, with no extra delay.

| App in Wolf | Plays | RomM folder |
|---|---|---|
| **PCSX2 (PS2)** | PlayStation 2 | `ps2` |
| **Dolphin (GameCube & Wii)** | GameCube, Wii | `ngc` (or `gc`, `gamecube`), `wii` |
| **RPCS3 (PS3)** | PlayStation 3 | `ps3` |
| **Cemu (Wii U)** | Wii U | `wiiu` |
| **Ryujinx (Switch)** or **Eden (Switch)** | Switch | `switch` |
| **ES-DE (all your games)** | Every console in one menu, using the emulators above (add RetroArch's AppImage for older consoles) | all of them |

Finesse doesn't come with emulators, firmware, keys or games, and never asks you to upload
them. They stay in your folders on the server. Finesse hands Wolf the folders by path, and the
readiness check looks at **file names only**. Nothing is copied, opened or sent anywhere.

## What you need

- **Game streaming on**: a full install with **Turn on game streaming**, or your own Wolf
  connected with `WOLF_SOCKET`. See [Game streaming](streaming.md).
- **Your games in RomM.** The apps read RomM's library (`roms/<console>`).
- **The emulators, as AppImages from their official sites**, in one folder. Names as they come
  are fine: Finesse finds `pcsx2…AppImage`, `rpcs3…AppImage`, `Cemu…AppImage`,
  `Ryujinx…AppImage` (or a `Ryujinx…` folder) or `Eden…AppImage`, and `Dolphin…AppImage`. Make them
  executable (`chmod +x`); otherwise each start copies them first, which is slower.
- **Firmware and keys you dumped from your own consoles**, one folder per emulator:

```
<firmware folder>/
├── pcsx2/     a PS2 BIOS (.bin)                    needed
├── rpcs3/     PS3UPDAT.PUP                          needed (installed the first time RPCS3 starts)
├── cemu/      otp.bin, seeprom.bin                  only for online play
└── switch/    the firmware's .nca files (or .zip)   needed
<keys folder>/
├── cemu/      keys.txt                              for encrypted .wud/.wux discs
├── switch/    prod.keys, title.keys                 prod.keys needed
└── rpcs3/     .rap licences                         only for digital (PSN) games
<saves folder>/                                      Finesse makes one folder per Wolf profile
```

Dolphin needs no firmware. ES-DE uses the other emulators' folders.

## Set it up

1. **Share the folders with Finesse, at the same path.** Wolf gets the paths, but Finesse
   checks what's in them, so it needs to see them too. Add them to Finesse's container:
   read-only, except saves (Finesse makes each profile's saves folder):

   ```yaml
       volumes:
         - /srv/games/emulators:/srv/games/emulators:ro
         - /srv/games/firmware:/srv/games/firmware:ro
         - /srv/games/keys:/srv/games/keys:ro
         - /srv/games/saves:/srv/games/saves
         - /srv/romm/library:/srv/romm/library:ro
   ```

   (Use your own paths. On a full install, RomM's library is already there:
   `<media folder>/media/games`.)

2. **Settings → Server → Game streaming → Emulators.** Tick the apps, pick Ryujinx or Eden for
   the Switch, fill in the five folders and press **Save emulators**. Finesse adds the apps to
   every Wolf profile (or the ones you tick), and shows what each emulator has and still needs.

   From a terminal, or for an AI agent:

   ```bash
   docker exec -i finesse finesse emulators set - <<'EOF'
   { "apps": ["pcsx2", "dolphin", "rpcs3", "cemu", "switch", "esde"],
     "switchEmulator": "ryujinx",
     "paths": { "roms": "/srv/romm/library", "emulators": "/srv/games/emulators",
                "firmware": "/srv/games/firmware", "keys": "/srv/games/keys", "saves": "/srv/games/saves" } }
   EOF
   docker exec finesse finesse emulators        # what each emulator has, and what it still needs
   ```

   On a new install, put the same object under `"emulators"` in the
   [setup document](../setup.schema.json).

3. **Switch with Ryujinx:** the first time, install the firmware in Ryujinx: **Tools → Install
   Firmware → Install a firmware from a directory** → `/finesse/firmware/switch`. Eden reads the
   `.nca` files as they are.

A firmware or keys folder somewhere else? Under **Profiles, and a different folder for one
emulator**, give that emulator its own folder (`folders` in the document).

## Playing

- **From Moonlight:** open Moonlight → **Wolf UI** → your profile → the emulator → the game. A
  game's page in **Games** shows the same steps, with the app's name.
- **From Finesse:** open Moonlight on the TV first (Wolf UI is fine). Then, on the game's page,
  press **Start it in Moonlight from here**, pick the TV and press **Play here**. Wolf starts the
  emulator with that game on the TV.
- **Saves are per person:** each Wolf profile gets its own folder (`<saves>/<profile>/<emulator>`).
  The emulator's app and ES-DE share them.

## Play in the browser (Beta)

No Moonlight on this screen? On the game's page, press **Play in the browser**. Finesse starts
the emulator with that game in a player of its own and streams it into the page with
[Selkies](https://github.com/selkies-project/selkies): picture and sound, controllers (plug one
in and press a button), keyboard and mouse. Saves are the same as in Moonlight: pick whose, if
there's more than one profile.

- **It needs a secure (https) page.** Browsers only decode the stream on https. Behind your own
  reverse proxy or Tailscale HTTPS it just works. Otherwise give Finesse its own https port:
  `FINESSE_HTTPS_PORT=30543` (publish the same port), and optionally `FINESSE_HTTPS_NAMES` with
  the server's address. Finesse makes a certificate for itself; the first time, the browser
  warns that it doesn't know it. Continue to the page, sign in, and play. On a plain http page,
  the game's page links to the https address.
- **It needs Docker.** Full installs have it already. If you run your own apps, share Docker's
  socket with Finesse (`/var/run/docker.sock:/var/run/docker.sock`). That lets Finesse run
  containers on the server; it only makes its own (labelled `finesse.managed`).
- **One game per person, two at once for the whole house** (they share the graphics card). Set
  `FINESSE_PLAY_MAX` for more.
- **Leaving the page ends the game,** and a game no one's watching for five minutes is closed.
- **The first time downloads the player** (about 1 GB, LinuxServer's Selkies image, pinned like
  Finesse's other apps).
- **Moonlight is still the low-latency way.** The browser has more delay, so use Moonlight on
  the TV. Browser play isn't in the LG TV app.

The player is a container on Finesse's own network, made from the same settings as the Wolf
apps: games, emulators, firmware and keys read-only, the profile's saves read-write, and the
emulator's settings in a Docker volume per profile and emulator (`finesse-play-<profile>-<emulator>`).
Nothing reaches it except through Finesse, which checks the person's sign-in for the page and its
video connection.

## Controllers

- **In Moonlight and in the browser, the controller belongs to the game.** Finesse's own
  controller navigation steps aside while a game streams, so B doesn't leave the game and the
  d-pad doesn't move around the page.
- **PCSX2 is mapped for you:** Player 1 is the first controller. If you've mapped your own, it's
  left alone.
- **Eden, RPCS3, Cemu and Dolphin need a one-time mapping** in their own controller settings
  (pick the Xbox controller as the input device). It's saved with your profile.
- **On a phone or tablet,** the touch controller comes up with the game in the browser, and
  **Controls** hides or shows it. Moonlight has its own: turn on "Show on-screen controls" in
  Moonlight's settings.

## How it's put together

- Every app runs on Games on Whales' ES-DE image (Sway, controllers, audio, AppImage support),
  pinned like Finesse's other apps. The emulator's AppImage comes from your emulators folder.
- In the app, the folders are: games at `/finesse/roms`, emulators at `/finesse/emulators`,
  firmware at `/finesse/firmware/<emulator>`, keys at `/finesse/keys/<emulator>` (all
  read-only), and saves where the emulator keeps them (read-write). At start, Finesse links the
  firmware and keys by name to where each emulator looks.
- Finesse adds the apps through Wolf's API. Wolf keeps them in its settings file. Saving the same
  settings again changes nothing. If Wolf loses them (a reset, a new Wolf), Finesse puts them back
  when it starts. Removing an app in Finesse takes it out of every profile; your other apps and
  your profiles' PINs stay as they are.

## Problems

| What you see | What to do |
|---|---|
| **"Finesse can't see …"** | Share that folder with Finesse at the same path (step 1), then restart Finesse. |
| **"… isn't in the emulators folder"** (Wolf's log) | The AppImage's name doesn't start the way Finesse looks for (see above). Rename it. |
| **The game page still says "Browse only"** | Its console has no emulator app yet. Tick it and save. |
| **A black screen when the app starts** | The first start downloads the image (about 1 GB). Give it a few minutes. |
| **"Start it in Moonlight from here" finds no session** | Open Moonlight on the device first, and leave it on Wolf UI. |
| **"Finesse can't reach Docker"** (browser play) | Share Docker's socket with Finesse (see [Play in the browser](#play-in-the-browser-beta)). |
| **A PS3 game says the firmware is missing** | Put `PS3UPDAT.PUP` in `<firmware>/rpcs3` and start RPCS3 once. |
