# Finesse — TODO

## Done (2026-06-26)
- [x] **Request feature (Jellyseerr-style)** — search + add movies/shows to the library
      from inside Finesse. Radarr/Sonarr proxied through the app's nginx with keys
      held server-side, gated by an nginx `auth_request` against Jellyfin. See
      `src/api/arr.ts`, `src/pages/RequestPage.tsx`, `nginx.conf`.
- [x] **TV-remote / D-pad navigation** — global arrow-key spatial navigation for
      couch/TV-browser use. See `src/lib/spatialNav.ts`. Also the foundation for the
      native TV apps below.
- [x] **Play on TV / cast (#3)** — "Play on…" device picker on the detail page pushes
      playback to another device via the Jellyfin Sessions remote-control API
      (`getCastTargets` / `playOnSession` in client.ts, `src/components/CastMenu.tsx`).
      The pull direction ("Continue here" from another device) already existed in
      HandoffBanner. NOTE: casting targets need to support remote control — native
      Jellyfin apps (TV/phone) do; casting TO another *Finesse* browser would need a
      remote-control receiver (websocket command handler) — see follow-up below.

- [x] **Watchlist (#4)** — server-synced watchlist (separate from Favorites), stored
      per-user in Jellyfin DisplayPreferences `CustomPrefs` so it syncs across devices
      (Playlists were unusable — they explode a Series into episodes). Bookmark toggle on
      the detail page (`src/components/WatchlistButton.tsx`), a `/watchlist` page + nav
      entry, and a "Your Watchlist" row on Home. ("Up Next rail" half was already covered
      by the existing Continue Watching + Next Up rows.)

## Done (2026-06-27)
- [x] **Request status / "Downloading now"** — live Radarr/Sonarr queue inside Finesse
      (`DownloadsSection.tsx`, `arrQueue()`), progress bars polling every 15s, per-result
      badges (Downloading X% / Importing…), + a "Coming Soon" row on Home.
- [x] **Per-series audio/subtitle memory** — the player remembers the audio + subtitle
      language you pick for a series and applies it to every episode. Stored per-user in
      DisplayPreferences (`finesse-trackprefs`, syncs devices). `getTrackPrefs`/`saveTrackPref`
      in client.ts, apply + remember logic in `PlayerPage.tsx`. Verified: seeded Japanese
      audio + English subs for Kill la Kill → player auto-applied both over the English default.

- [x] **Accent color picker (per account)** — 8 presets in Settings → Appearance, applied by
      overriding the `--color-accent-*` CSS vars on `<html>` (Tailwind v4 utilities read the vars,
      so it re-themes live). Stored per-user in DisplayPreferences (`finesse-ui` → `accent`) for
      cross-device sync + mirrored to localStorage for instant no-flash apply. `src/lib/accent.ts`.

## A steadier Home, a friendlier setup — v2.5.10 (2026-10-04)

- **Play stays put.** The Home banner keeps the same height from title to title, so the Play
  button doesn't jump when the story is longer or a title has no progress bar.
- **Sweeping the mouse along the row doesn't flip the banner.** Rest on a tile for a moment to pick it.
- **Customize Home explains empty rows.** Rows like Favorites, Anime or "Throwback: the '90s" hide
  when there's nothing in them; Customize now says so and what makes them appear. The list is
  narrower, so the controls sit next to the row names.
- **Preview clips on new servers.** The clips folder is handed to the apps' user, so Jellyfin
  can make clips (it couldn't write to a folder Finesse had made). A server with no clips yet
  answers with an empty list instead of an error, and the clip list asks with a header, not your
  sign-in in the address (twice).
- **No download-queue errors when downloads are off.** Home no longer asks Radarr, Sonarr or
  Lidarr when they aren't set up.
- **Lossless music on Auto.** On Auto quality, music plays as the original file (FLAC included);
  pick a cap in Settings → Playback to convert to MP3.
- **Setup:**
  - "Passwords don't match" waits until you've typed in the second box.
  - The build time estimate depends on what you picked (streaming alone takes under a minute).
  - Lo-Finessa: optional lo-fi music while you set up (original music, made for Finesse). It
    starts on your first click, loops without a gap, fades out when you start watching, and
    remembers if you turn it off. It only appears once its files are in place.
- **Installer:** memory and disk space are in GB, like the setup wizard (they were GiB), and the
  printed setup link uses this machine's home-network address, not a Docker or Tailscale one.

## FLAC songs play again — v2.5.9 (2026-10-04)

- **Lossless songs play.** FLAC songs over the streaming limit were converted to an empty
  file, so they sat silent at 0:00 (on shuffle, that was over half of a typical library).
  They now convert to MP3 properly.
- **A song that never starts gets skipped.** If no sound arrives within 10 seconds, the
  player moves on, and it still stops after 3 broken songs in a row instead of skipping forever.

## Controllers that stay on track, music that keeps going — v2.5.8 (2026-10-04)

- **Fixed: a controller could kick you out of browser play.** Finesse's own controller
  navigation kept running on the game page, so B meant Back (leaving the game) and the d-pad
  moved around the page instead of reaching the emulator. The controller now belongs to the game.
- **Fixed: the selection kept disappearing with a remote or controller.** Coming back from a
  title, or when a row refreshed, the card you were on was replaced and nothing stayed selected.
  Focus now moves to its replacement, so you carry on where you were.
- **Jump between rows:** the triggers (LT/RT, L2/R2, ZL/ZR) go to the previous or next row,
  onto the card nearest where you were; in a grid they jump about a screen. In the player they
  still rewind and fast-forward.
- **Music moves on to the next song reliably.** A song that stalls just before its end (converted
  streams can), a phone that blocks the next song from starting, or a file that won't load used
  to leave the player stuck. Now it moves on, tries again when you're back, or skips the broken
  file.
- **Fixed: reloading the video player said "Unauthorized".** Browser play had taken the player's
  address; its sessions now live at their own address.
- **Fixed: some RomM box art didn't load,** and the Games page asked SteamGridDB for art on every
  game even without a key.
- **Fixed: Jellyfin couldn't start on servers with a graphics card** (full installs): its
  container was added to the "render" group by name, which Jellyfin's image doesn't have. It's
  now added by the group's number. Jellyfin restarts once after the update.
- **Two Finesse servers on one machine no longer close each other's browser games** when one
  starts.

## Emulators at full speed, touch controls, working buttons — v2.5.7 (2026-10-03)

- **Fixed: games ran in slow motion in the browser with an Nvidia card.** The emulators couldn't
  find Nvidia's Vulkan driver in the player and drew on the processor instead. Finesse now puts the
  driver where they look, and with Nvidia the browser player uses Selkies' Wayland desktop, which
  the card can draw to. Emulators now run on the graphics card.
- **Fixed: Eden couldn't read the Switch firmware** (it opens it read-write, and the firmware folder
  is read-only), so games misbehaved or stopped. Each profile gets its own copy the first time.
- **Fixed: PS2 face buttons did nothing** (Cross, Circle, Square, Triangle), in Moonlight and the
  browser. PCSX2 2.x renamed them; the controller mapping now uses the new names. A mapping you
  made yourself is left alone.
- **Touch controls on phones and tablets.** In browser play, the on-screen controller comes up with
  the game, and **Controls** hides or shows it. Games see it as an Xbox controller.
- When a game won't start, administrators see the emulator's own log (which graphics card it
  uses, controllers, errors) with the player's.

## GameCube games in a gc folder — v2.5.6 (2026-10-03)

- **GameCube games filed under `gc` play too.** RomM keeps a folder named `gc` as its own console;
  Dolphin only matched `ngc` and `gamecube`, so those games showed "Browse only". Now all three
  names play in Dolphin, in Moonlight and in the browser.

## Games look like the rest of Finesse, and the console filter works — v2.5.5 (2026-10-03)

- **Fixed: picking a console under Games showed every game.** RomM 4.1 and newer filter by
  `platform_ids`; Finesse asked with the old `platform_id`, which RomM ignores. Now a console shows
  only its games.
- **A game's page is laid out like a movie's:** its art, the title in the serif, a line of
  details (console, year, rating, genres), a white **Play**, and round buttons with labels:
  **Moonlight** (the steps) and **Play on TV** (start it in an open Moonlight session). The file
  name is gone, and a game whose files went missing says so instead of offering Play.
- **One look across the app.** Every page's title is the serif (Movies, Music, Games, Settings,
  My List, Friends…). The current choice in a row of chips or tabs is the white pill, like the
  top bar (Games' consoles, Request's Movies/Shows/Music, Settings). Search boxes on pages are
  rounded glass, like the top bar's. Games' "How to play" folds away until you open it.

## Games in folders — v2.5.4 (2026-10-03)

- **A game that's a folder opens its disc image.** RomM lists some games as folders (a download
  with notes beside the `.iso`). Finesse handed the emulator the folder, which it can't open. Now
  it picks the file each emulator opens (PS2 `.iso`/`.chd`/`.cso`, GameCube and Wii `.rvz`/`.iso`,
  Wii U `.wua`/`.wud`/`.rpx`, Switch `.xci`/`.nsp`), in Moonlight and in the browser. PS3 game
  folders still open as folders.
- **When there's no game in it, it says so** before starting anything: "There's no game file here
  that PCSX2 can open (it has .mds, .jpg, .exe)", with a tip for MDS disc images.

## Browser play over https — v2.5.3 (2026-10-03)

- **Finesse can serve https itself.** Browser play needs a secure page (browsers only decode the
  stream on https), so a plain `http://` address said the player "requires https". Set
  `FINESSE_HTTPS_PORT` and Finesse also serves https there, with a certificate it makes for
  itself. The first time, the browser warns that it doesn't know it: continue, sign in, play.
- **On a plain http page, the game's page says so** and links to the https address, instead of
  starting a player that can't show anything.

## Browser play starts with an Nvidia card — v2.5.2 (2026-10-03)

- **Fixed: with an Nvidia card, browser play never showed a picture.** 2.5.1 asked the card to
  draw the player's desktop too, which Nvidia's driver can't do there, so the desktop never
  started. Now the card only encodes the video; Intel and AMD cards still do both.
- **Fixed: emulators couldn't make their own folders** (BIOS, settings) next to your saves, in
  the browser and in Wolf. The folders Docker made for the saves belonged to root; Finesse now
  hands them to the player before the emulator starts.

## Browser play on the graphics card — v2.5.1 (2026-10-03)

- **Browser play encodes on the graphics card.** The player streamed with the processor's
  encoder; now it's handed the server's graphics card for drawing and encoding (NVENC or VA-API),
  so the picture is smoother and the server works less.
- **When a game won't start, administrators see why:** the player's log now includes the
  emulator's own output and what's running.

## Play in the browser — v2.5.0 (2026-10-03)

- **PS2, GameCube, Wii, PS3, Wii U and Switch games play in the browser, as Beta.** On a game's
  page, **Play in the browser** starts its emulator on the server and streams it into Finesse
  with Selkies: picture, sound, controllers, keyboard and mouse. No Moonlight needed. Saves are the
  same ones Moonlight uses, per profile. Moonlight is still the low-latency way for the TV.
- Each game runs in a player of its own (LinuxServer's Selkies image, pinned), on Finesse's
  network, reached only through Finesse with your sign-in. Leaving the page ends it, and one
  nobody's watching for five minutes closes. One game per person, two at once per house
  (`FINESSE_PLAY_MAX`).
- Installs that connect to their own apps share Docker's socket with Finesse for it
  (`/var/run/docker.sock`).

## PS2, GameCube, PS3, Wii U and Switch on Moonlight — v2.4.0 (2026-10-03)

- **Emulators as Wolf apps.** With game streaming on, Finesse can add **PCSX2** (PS2),
  **Dolphin** (GameCube and Wii), **RPCS3** (PS3), **Cemu** (Wii U), **Ryujinx or Eden** (Switch)
  and **ES-DE** (every console in one menu) to Wolf. They run on the server's graphics card and
  stream to Moonlight like Steam, with no extra delay. They run on Games on Whales' ES-DE image,
  pinned like the other apps, with the emulators' AppImages from your own folder.
- **Your folders, by path.** RomM's library, the emulators, a firmware folder and a keys folder per
  emulator (all read-only), and saves per Wolf profile (read-write). Set them in **Settings →
  Server → Game streaming → Emulators**, in the setup document (`emulators`), or with
  `finesse emulators set -`. Installs that connect to their own apps point at the folders they
  already have.
- **What each emulator still needs.** The emulators panel (and `finesse emulators`) shows, for each
  emulator, whether its program, firmware (PS2 BIOS, PS3UPDAT.PUP, Switch firmware) and keys
  (prod.keys, keys.txt) are there. It checks by file name only: Finesse never opens, copies or
  shows them.
- **Games: "Play on Moonlight".** Consoles the browser can't play no longer say "Browse only" when
  an emulator app plays them. The game's page names the app and lists the steps (Moonlight → Wolf
  UI → your profile → the app). With Moonlight already open on a TV, **Start it in Moonlight from
  here** starts that game there.
- **Smoother video on TVs that play in the browser.** The player's panels (Stats for nerds, the
  menus) blurred the video behind them. On TV-class graphics that made the picture drop frames
  while they were open. They're solid glass now. Stats for nerds shows dropped frames over the
  last 10 seconds next to the total.

## Play on your TV from anywhere, foldables and tablets — v2.3.0 (2026-10-03)

- **"Play on…" where you are.** Send what's on the home stage to your TV straight from the
  stage. In the player, the new cast button moves what you're watching to the TV: it carries on
  from where you are, and this screen steps back. It used to be only on a title's page. The device
  list is glass and floats above everything, so nothing clips it.
- **The top bar fits tablets, unfolded phones and small windows.** Between 768 and 1023 px it
  needed 949 px, and your avatar slid off the edge. Now Music, Games and Friends sit under More
  below 1024 px, search is a round button below 1280 px, and the buttons on the right never shrink
  or leave the screen.
- **Phones and foldables: the home stage fits what's visible.** It used to be sized for the
  screen with the browser's toolbars hidden, so the row and the live line could hide behind the tab
  bar. On short, wide screens (an unfolded Fold) the story is two lines and the gaps are tighter.
- **Search is glass,** like the Quick menu. It never runs past the bottom of the screen, and its
  results scroll without a bar riding the edge.
- **Update checks say what went wrong.** If the server can't reach GitHub, or GitHub is limiting
  checks from your network (60 an hour for everything at home), "Check for updates" says so, and
  when to try again. It used to say "You're on the latest version".

## Your Wolf's games on the Games page — v2.2.3 (2026-10-03)

- **Games shows what you can actually stream.** With Wolf UI (Wolf's default setup), Moonlight
  lists only Wolf UI, and the games live in its profiles. Finesse used to show just "Wolf UI" and
  "Test ball". Now it reads Wolf's profiles and shows their apps (Steam, RetroArch,
  EmulationStation, Kodi…), with their icons. The steps say which to pick in Moonlight: Wolf UI,
  then your profile, then the app. Profiles' PINs and settings never leave the server.
- Wolf's "Test ball" test pattern is no longer listed.

## Menus that read well on phones — v2.2.2 (2026-10-03)

- **The account menu is readable over any artwork.** It used to sit inside the glass top bar,
  where its blur couldn't reach the page, so the page showed straight through. Now it floats on
  its own, with darker glass, icons and bigger touch targets.
- **The Quick menu fits the screen.** It used to be sized for the screen with the browser's
  toolbars hidden, so the top got cut off. Now it sizes to what's actually visible. Its title stays
  put while the cards scroll, and the scroll bar no longer rides the glass edge (hidden on touch,
  thin and inset with a mouse).
- **The Server card tells the truth on your-own-apps installs.** Finesse doesn't watch or back up
  apps you run yourself, so "OK" and "Backup: never" meant nothing there. It now shows the
  Finesse version, your apps and preview progress.

## 3DS and Intellivision (Beta) — v2.2.1 (2026-10-03)

- **3DS and Intellivision play in the browser, as Beta.** They come from EmulatorJS's preview
  build, which loads from its website rather than RomM. 3DS needs a fast computer and Chrome,
  Edge or Firefox. Intellivision needs its BIOS (`exec.bin` + `grom.bin`) as a zip in RomM's
  firmware.

## More consoles play, smoother cards — v2.2.0 (2026-10-03)

- **Games: more consoles play in the browser.** Finesse now matches the names RomM 5 gives
  its consoles. Some (the 32X, WonderSwan, Neo Geo Pocket, PC Engine CD, Neo Geo…) showed
  "Browse only" even though they could play. New in the browser: **PSP**, **DOS**, **Amiga**,
  PC-FX and the Commodore family.
- **Your firmware goes to the emulator.** BIOS files you add to a console in RomM (PlayStation,
  Sega CD, Saturn, 3DO, Lynx, Neo Geo…) now start that console's games. Finesse picks the file
  the emulator expects.
- **The emulator comes from your RomM.** Finesse loads the emulator from RomM's own copy on
  your network: faster, and the version RomM tested. If RomM has none, it uses the EmulatorJS
  CDN.
- The game player page is cross-origin isolated (threads for the PSP and DOS emulators).
  Reloading a game's page or the player no longer says "Not found".
- Game covers load faster: RomM's small copy on your server comes first, not the full-size
  original from the internet.
- **Smoother card hover.** The glow under a hovered poster is now its own layer that only
  fades. The lift runs on the GPU at your display's refresh rate (120 Hz and up), without
  repainting the poster every frame.

## Check for updates that sees the server's update — v2.1.1 (2026-10-03)

- **Check for updates tells admins about a new release.** In Settings → Updates, "Check for
  updates" only compared this browser with what the server serves. On a server that hadn't
  updated, both matched, so it said "You're on the latest version" while a new release was out.
  For admins it now also asks GitHub right away, through the server, skipping its 5-minute
  cache. When there's a release, it says so and points to **Update everyone** just below.

## Controllers, and 2.0 on the TV — v2.1.0 (2026-10-03)

- **Game controllers drive the whole app.** Xbox, PlayStation, Switch Pro and most others,
  in the browser and on the TV: the stick or D-pad moves (hold to keep going), **A** selects,
  **B** goes back, **Y** searches, **Menu** opens the quick menu, **LB/RB** switch between
  Home, Movies, Shows, Music, Games and Friends, and in the player the triggers skip back and
  forward. Pick one up and a note shows its buttons, named the way your controller names
  them (✕ ○ △ on PlayStation). The retro-games player still reads the controller itself.
- **The TV gets the 2.0 home.** The Now row, the stage with the title's art, logo and
  details, the live line, the new top bar and the quick menu, built for the remote and for
  the LG CX's older browser: one screen, plain fades, no blur or glow it can't draw.
- Moving the mouse is now the only way the mouse picks a title: scrolling the page under a
  resting pointer no longer changes the stage while you use the keyboard or a controller.

## Finesse 2.0: a home that's alive — v2.0.0 (2026-10-03)

A new look for phones and computers. The TV app keeps its own home for now.

- **One row for everything that's "now".** What you're in the middle of, the next episode,
  what's playing on your other devices (with **Continue here**), your games, a friend's pick and
  what just arrived.
- **The stage.** Rest on a title and its art fills the screen, slowly drifting. A moment later
  its preview clip plays behind it. The whole app takes on the title's colour, and the title
  rises in with its logo (or a big serif title when the logo is too dark to read), the details,
  and **Resume** / **Play**.
- **A live line.** Under the row: who's watching what, downloads, what was added, what friends
  shared.
- **The quick menu.** The grid button at the top: who's playing what and where, the server's
  health (for administrators), downloads, game streaming and friends.
- **A new top bar.** Glass, with Music, Games and Friends as their own tabs. On phones the tab
  bar floats.
- **New type.** Geist for everything you read, Geist Mono for labels, and the serif for titles.
- **Fixed:** preview clips (on cards and the stage) didn't play until a few minutes after you
  signed in.

## Finesse sets up game streaming — v1.4.0 (2026-10-02)

- **One switch for Steam on the TV.** On a full install, **Settings → Server → Game streaming**
  has **Turn on game streaming**. Finesse downloads [Wolf](https://games-on-whales.github.io/wolf/),
  runs it, and keeps it up to date with the other apps. **Games** then lists what you can play,
  and you pair TVs, phones and computers with Moonlight's PIN, as in 1.3. See
  [Game streaming](docs/streaming.md).
- **It checks the server first.** Before you turn it on, Finesse shows what the server has: an
  Nvidia, Intel or AMD graphics card, virtual controllers, and PlayStation controller extras.
  Anything missing comes with the commands that fix it, and a **Copy** button.
- **Turn it off** in the same place. Wolf's folder stays, so devices and installed games are
  there when you turn it back on.
- **For terminals and AI agents:** `finesse streaming` shows the same check, and
  `finesse streaming on` / `off` waits until it's done.
- **Backups keep Wolf's settings and paired devices** (not the games).
- Already run Wolf yourself? Keep connecting it with `WOLF_SOCKET`; Finesse won't offer a second one.
- **Fixed:** turning Games on or off in Settings sometimes took half a minute to show it was done.
  Game covers that don't load show the game's tile instead of a broken image.

## Request page fixes — v1.3.1 (2026-10-02)

- **Artist pictures show up.** Many music requests showed the browser's broken-image icon: when
  Lidarr had no web address for a picture, Finesse used a path only Lidarr itself can serve.
  Pictures now come from Lidarr (or Radarr/Sonarr) through Finesse, then from the web, and
  otherwise show the name's initials. Artists are round; films and shows keep their posters.
- **Fits wide screens.** Requested, downloading and search results fit as many cards in a row as
  the screen allows, instead of two stretched columns.
- **Search results come first.** They used to sit below every download and request. A long
  **Requested** list now shows two rows, with **Show all**.

## Game streaming with Wolf — v1.3.0 (2026-10-02)

- **Steam on the TV.** Already run [Wolf](https://games-on-whales.github.io/wolf/), which streams
  Steam and other apps from your server to Moonlight? Point Finesse at it (`WOLF_SOCKET`) and
  **Games** shows what you can stream, with how to start in Moonlight. See
  [Game streaming](docs/streaming.md).
- **Pair devices in Finesse.** When Moonlight shows a PIN, the device appears under
  **Settings → Server → Game streaming** within seconds. Name it, type the PIN, done. No more
  digging the pairing link out of Wolf's logs. Remove devices there too.
- **Safe by design.** Wolf's API has no password and can do far more than pairing, so Finesse makes
  only its own few calls and passes nothing else through. Only administrators pair devices, and
  Wolf's pairing secrets and app settings never reach the browser.
- With game streaming on, **Games** has streaming first and the games library (with its search)
  below it. Servers with only Wolf get **Games** too.

## Groups share music — v1.2.0 (2026-09-28)

- **Share your music with friends, and listen to theirs.** Tick Music when you share under
  **Settings → Server → Groups**. Friends find your albums on their **Music** page, in a
  "From *your server*" row with Shuffle, and on the **Friends** page. Albums, the player, synced
  lyrics and Shuffle work just like their own music.
- **Music** appears in the menu when a friend shares theirs, even if you have no music library
  of your own.
- Home's "From *their server*" row sticks to films and shows. Their albums are on the Music page.
- Playlists, photos, books and live TV still aren't offered when sharing: they belong to one
  person, or the app has no page for them.

## Groups polish and a new tour chapter — v1.1.1 (2026-09-28)

- **Groups only offers what friends can watch.** Music and playlists no longer appear when you
  pick libraries to share. A friend's server shows films and shows, so sharing music did nothing.
- **The tour has a Groups chapter**, and there's a new episode, *Groups*: making a code, a
  friend's films on Home and under **Friends**, and playing one straight from their server.
- Row titles with **See all** are now headings, so screen readers can jump from row to row.

## Groups: share with friends who run Finesse — v1.1.0 (2026-09-28)

- **Groups.** Households that each run Finesse can share libraries with each other, watch-only.
  Make a code under **Settings → Server → Groups**, pick what your friend can watch, and send
  them the code with your address. They add your server, and everyone in their household finds
  your films under **Friends**, in a "From *your server*" row on Home, and in search. Share back
  with one click. See [Groups](docs/groups.md).
  - Nobody gets an account on anyone else's server, and nobody can request, download or delete
    anything there.
  - Everyone keeps their own watch progress.
  - Keys and file locations never leave the server that has them.
  - Stop sharing, or change what's shared, and it applies at once.
- Setting up an older Jellyfin under `/jellyfin` could catch it on its old address right after
  the restart. Fixed.

## TrueNAS and backups you choose — v1.0.3 (2026-09-28)

- **Finesse on TrueNAS's Apps page.** TrueNAS SCALE 24.10+ can install Finesse from Apps → Install
  via YAML, so it's listed with your other apps. There are two ready-made files: one in front of
  the Jellyfin and download apps you already run, and one for a full install. See
  [Finesse on TrueNAS](docs/truenas.md). Updates from inside Finesse and TrueNAS's own buttons
  work together.
- **The installer is TrueNAS-safe.** On TrueNAS it keeps everything on a pool, never on the
  system drive that TrueNAS updates replace, and runs the apps as TrueNAS's `apps` user.
- **Choose what goes in a backup.** **Settings → Server → Back up now** can add watch history
  and accounts, requests and download history, and the games library with saves. Each part shows
  its size, and backups download straight to your computer. Databases are copied safely while
  the apps keep running.
- **Restore brings it all back.** `finesse restore <file>` puts back every part, databases
  included, on the same machine or a new one. `--only watch` restores a single part.
- The setup-code message in the logs no longer shows the container's internal port as the
  address.

## Fixes — v1.0.2 (2026-09-28)

Found by requesting a movie, a show and an artist on a brand-new server, end to end.

- **The first movie, show or album on a new server now appears within a couple of minutes.**
  Jellyfin ignores a library folder that was empty at its last scan, so the first download into
  each library stayed invisible until its nightly scan. Finesse now notices files arriving in a
  library Jellyfin still shows as empty and asks it to scan.
- **Search puts the exact title first.** In "Not in your library", a show you typed exactly could
  sit below a loosely matching film.
- **Sign-in and invite forms work better with screen readers.** Their labels are now attached to
  the fields.

## Fixes — v1.0.1 (2026-09-28)

- **Setup no longer stops at "Setting up Games" when Games is off.** 1.0.0 tried to start the
  games database on every install and gave up after 3 minutes. Steps a setup doesn't need are
  now skipped. If it happened to you: run the install command with `--uninstall`, run the
  install command again (your folders are kept), then go through setup with the same account.
  What was already done is skipped, so it takes under a minute.

## Finesse 1.0 — your own streaming service, set up for you — v1.0.0 (2026-09-28)

Finesse is now a complete, self-hosted streaming service: one command on a Linux machine, a
setup page in the browser, and Finesse installs, connects and looks after everything else.

**Watch the [8-minute tour](https://github.com/CoffeeCC/finesse/blob/master/docs/media/finesse-tour.mp4)** · [Install](https://github.com/CoffeeCC/finesse/blob/master/docs/install.md) ·
[TVs](https://github.com/CoffeeCC/finesse/blob/master/docs/tv.md) · [For AI agents](https://github.com/CoffeeCC/finesse/blob/master/docs/agents/INSTALL.md)

### Install and set up
- [x] **One-command installer** (`install.sh`): checks the machine, installs Docker if you agree,
      asks where your media should live (showing the roomiest disks), starts Finesse and prints a
      setup link. Re-running it is safe; `--uninstall` keeps your files.
- [x] **The setup page** walks through your account, libraries, Usenet (pick your provider; the
      server fills in), your VPN (17 providers, or paste a WireGuard config), indexers, quality,
      watching away from home and invite emails. **Test** buttons log in, search and open a real
      VPN tunnel before anything is built. Then it builds and wires Jellyfin, Sonarr, Radarr,
      Lidarr, Prowlarr, SABnzbd and qBittorrent (VPN-only) in about ten minutes.
- [x] **Setup for AI agents and scripts:** one JSON document ([schema](https://github.com/CoffeeCC/finesse/blob/master/setup.schema.json),
      [examples](https://github.com/CoffeeCC/finesse/tree/master/examples/setup)) applied with `finesse setup apply`, a `finesse setup check`
      that tests credentials for real, and a [step-by-step runbook](https://github.com/CoffeeCC/finesse/blob/master/docs/agents/INSTALL.md).
- [x] **Already have Jellyfin or the *arr apps?** Adopt mode puts Finesse in front of them
      ([guide](https://github.com/CoffeeCC/finesse/blob/master/docs/adopt.md)), including moving from the pre-1.0 nginx deployment.

### It looks after itself
- [x] Every minute: checks each app, the VPN and the disks; recreates or restarts anything that
      stopped; reconnects torrents when the VPN restarts.
- [x] Every night: backs up each app's settings and database. Restore with `finesse restore`.
- [x] **Update in one click**, with a backup first and an automatic roll-back if the new version
      doesn't start. Newer tested app versions install overnight.
- [x] **Settings → Server:** each app's health, logs, Restart and Pause; the VPN's public address;
      storage; backups to download; automatic updates; preview clips.

### Games
- [x] **An optional Games library.** Pick **Games** during setup and Finesse installs
      [RomM](https://romm.app) with its database, signs itself in and adds **Games** to the
      menu. Retro games play right in the browser. Drop games into `media/games/roms/<system>`:
      they appear within minutes, with box art from free sources (IGDB/SteamGridDB optional).
      Its database is backed up nightly.
      ([guide](https://github.com/CoffeeCC/finesse/blob/master/docs/games.md))

### New in the app
- [x] **Requested:** requests waiting for a release are listed on the Request page, with
      **Search again** and **Take back**, so a request never just disappears.
- [x] **Preview clips made for you:** Finesse makes hover previews and spoiler-light episode
      teasers itself, quietly in the background.
- [x] **Invites by email** (any SMTP account), plus links and QR codes that use your public
      address. Remote access through Tailscale Funnel or Cloudflare Tunnel.
- [x] **Sign-in knows the server:** no server address to type on the web; the TV asks once.
- [x] Anime and Games only appear in the menu when there's something there.
- [x] **Downloads in the right language:** a title's original language or yours, never one
      nobody at home speaks; the original or dual audio wins a tie. Anime is added to Sonarr as
      anime, so episodes are found by their absolute numbers.
- [x] **Support Finesse:** a button in Settings → About (a QR code on the TV).

### Security
- [x] **People you invite get the app, not the admin keys.** Searching, requesting, following
      downloads and playing games work for everyone; settings, API keys, deleting files and
      anything else in Sonarr, Radarr, Lidarr, SABnzbd or RomM need an administrator.
- [x] **Preview clips need a sign-in**, like everything else in your library.
- [x] Guessing invite codes is slowed down, a single-use invite can only be used once even by
      two people at the same moment, and other sites can't frame Finesse.

### Fixed
- [x] **Subtitles stay on.** On MKV files (nearly all anime) they could vanish after switching
      audio, a long seek, or reopening an episode. The next episode could also pick a
      "Signs & Songs" track over the full dialogue. Finesse now remembers the exact track.
- [x] **Subtitles are never cut off.** Two-line subtitles could hang off the bottom of the
      screen, or vanish while the controls were up. They now sit clear of the edge, move above
      the controls, and step aside for the pause screen.
- [x] Trailers only appear once they're playing, so a blocked or unavailable trailer never
      shows YouTube's error box.
- [x] The thin dark line under the top bar is gone.

### Docs
- [x] New README, [install guide](https://github.com/CoffeeCC/finesse/blob/master/docs/install.md), [TV guide](https://github.com/CoffeeCC/finesse/blob/master/docs/tv.md) (LG app install with
      Dev Manager, other TVs, Jellyfin apps), [SECURITY.md](https://github.com/CoffeeCC/finesse/blob/master/SECURITY.md) and
      [CONTRIBUTING.md](https://github.com/CoffeeCC/finesse/blob/master/CONTRIBUTING.md).
- [x] An [FAQ](https://github.com/CoffeeCC/finesse/blob/master/docs/faq.md): the Docker socket, who can do what, opening it to the
      internet, LG Developer Mode and more.
- [x] `npm run dev` can point at any Finesse server with `FINESSE_SERVER` in `.env.local`.
- [x] The TV app's `.ipk` is attached to each release.

## TV remote + layout fixes, Top 10 ranks in the posters — v0.13.2 (2026-09-27)
- [x] **D-pad navigation (TV)** (`lib/spatialNav.ts`) — audited press-by-press on every page, on the
      LG CX's real engine (Chromium 68): 70 misfires before, 1 (expected) after.
      - Pressing the opposite direction goes straight back where you came from.
      - Moves pick the nearest row, not the nearest thing lined up: Up from a detail page's tabs
        reaches Play (not the navbar), Down from the navbar reaches an album's Play/Shuffle.
      - Entering a tab row lands on the selected tab.
      - The navbar is its own layer: Up inside it no longer jumps back into the page, and a row
        tucked under it isn't skipped.
      - Menus, dialogs and Now Playing keep the D-pad inside them.
      - Focus is kept clear of the navbar and off the bottom edge. The scroll maths now accounts
        for the TV's 130% zoom (Chromium 68 measures unzoomed), which left focus under the navbar
        or hero and Library cards off-screen.
      - Rows don't snap or smooth-scroll while you use the remote (the focused card crept off the
        right edge), and Right at a row's end stays put instead of jumping to another row.
      - If a re-render drops focus, the next press carries on from where it was.
- [x] **Request → Upgrade / quality (TV)** — focus moves into the dialog and back to the button
      when it closes; the full-screen backdrop is no longer a (invisible) D-pad stop; force-grabbing
      a rejected release asks in-app ("Grab anyway?") instead of `window.confirm`.
- [x] **Nothing runs off the TV screen** — `zoom` scales vh/vw too, so "90vh" was 130% of the
      screen: dialogs, heroes, panels and the A–Z rail ran off the edges. Layout now sizes with
      `--vh`/`--vw` (1% of the real screen at any zoom); the TV hero is a true third of the screen.
- [x] **Centring, sliders and switches on the TV** (`webos/downlevel-css.mjs`) — Tailwind's
      `translate:`/`scale:`/`rotate:` properties need Chromium 104; the TV build now lowers them to
      one composed `transform`. Settings switches slide again (they all looked "off" on the TV) and
      centred things (A–Z rail, toasts, trailer backdrop) are centred.
- [x] **Top 10 at home** is a regular poster row again: the big numerals beside each poster are
      gone, and each poster carries its rank in a bold numeral in its lower-left corner over a soft
      shade (it steps aside while a hover preview plays).

## Lyrics that sync more often — v0.13.1 (2026-09-26)
- [x] **Plain lyrics no longer hide synced ones** — many music files carry untimed lyrics in their
      tags; Finesse used those and never asked LRCLIB, so the lyric video had nothing to follow.
      Now untimed library lyrics are only used when LRCLIB has no synced ones for the song.
- [x] **A hiccup isn't "no lyrics"** — if LRCLIB can't be reached, the lookup is retried (opening
      the lyric video or tapping "Try again") instead of being remembered as none until a reload.
- [x] **Says why** — the lyric video's title card explains a missing sync (lyrics aren't timed,
      the lookup failed, online lyrics are off, or none were found); untimed lyrics are labelled
      "Not timed" in the Lyrics panel.

## Music: lyrics, lyric video, a proper player — v0.13.0 (2026-09-26)
- [x] **Lyrics everywhere** (`lib/lyrics.ts`) — the library's own lyrics first, else synced lyrics
      from **LRCLIB** (free, CORS-open; exact match, then a search that prefers synced lyrics of
      the right length). Only song/artist/album/length are sent, and only while Settings → Sound →
      "Find lyrics online" is on. Instrumentals are marked; the next song's lyrics prefetch.
- [x] **Lyric video visualizer** (`components/LyricVideo.tsx`) — the song's synced lyrics as
      kinetic type over generative visuals in the album's palette: drifting colour fields, a bass
      glow with shockwave rings on the beat, rising light motes. Each line gets a layout (centred,
      stacked, one giant ghost word) and words reveal as they're sung; a title card opens the song
      and a ♪ holds instrumental breaks. Controls fade while you watch. Works on the LG CX.
- [x] **Now Playing** — display-font title, album link, shuffle + repeat (all / one), a Lyrics /
      Up next panel (tap a lyric to seek; tap a queued song to jump), the room in the album's
      colour; phones swap the artwork for lyrics or the queue. Lock-screen / media-key controls
      (Media Session).
- [x] **Album page** — artwork hero washed in the album's colour, Play/Pause + Shuffle, an
      equalizer on the playing track, disc headers, "More by <artist>". **Music home** — Shuffle
      all, Recently added, sortable album grid; album tiles have a hover Play button.
- [x] Fixed on the LG CX: the music Now Playing threw on open (canvas `roundRect` is Chromium
      99+) — polyfilled. CSS `clamp()`/`min()`/`max()` (Chromium 79+) replaced where they sized
      things (menu height caps, artwork, lyric type).
- [ ] Word-level timing when LRCLIB has it (`hasWordSync`) instead of spreading words across the
      line.
- [ ] Artist pages.

## TV fixes, Top 10 at home, audio button — v0.12.1 (2026-09-26)
- [x] **LG CX / webOS 5 (Chromium 68)** — the TV focus hero now takes a third of the screen
      (at the TV's 130% zoom it was eating over half, so poster rows were cut off beneath it),
      and remote focus is kept below its measured edge (the old maths ignored the zoom, so
      focus could land on a row hidden behind it). Library posters have proper gaps again
      (the virtualized grid set flex `gap` inline, which Chromium <84 ignores). In-app
      polyfills (`lib/polyfills.ts`, ships over the air) add what the launcher's don't —
      `Promise.allSettled` broke search's Request results on the TV. The harness now drives
      a real Chromium 68 over CDP to check the TV bundle.
- [x] **Top 10 at home** — ranks what the household actually watches: hours played per title
      across every profile (admins read everyone's history; others count their own), series
      summing their episodes. Numerals stand beside each poster at full height, and cards line
      up whether or not they have a year.
- [x] **Player** — the audio/subtitle button is a speech bubble showing the current language
      ("Japanese", plus CC when subtitles are on) instead of a bare CC icon that hid the
      audio-language switch.
- [x] **No more mouse-follow** — cards no longer tilt toward the pointer and heroes no longer
      drift with it; hovered cards get a small fixed lift. (Phone tilt parallax stays opt-in.)
- [ ] TV: scrolling with the Magic Remote's wheel can still slide rows under the pinned hero
      (the D-pad keeps focus clear of it).

## Front-to-back flow + polish — v0.12.0 (2026-09-26)
- [x] **Foundations** — Instrument Serif display face for titles and row headings; a computed
      `--color-accent-fill` (`fillFor` in `lib/accent.ts`) so white text on accent buttons stays
      ≥4.6:1 for every accent (sky/teal/emerald/amber failed before); one shared popover menu
      (`components/Menu.tsx`: SelectMenu / MultiSelectMenu / ActionMenu — portalled, D-pad and
      Back aware) replaces native selects and ad-hoc dropdowns; card captions stay quiet until
      hover/focus (always on for touch).
- [x] **Navigation** — desktop/TV bar is Home · Movies · Shows · More ▾ (Anime, Music, Games,
      Collections, Requests) with Search and **My List** on the right; phones get four tabs
      (Home, Search, Library, My List) and a `/libraries` hub. `/watchlist` → `/mylist`.
- [x] **Curated Home** — "Up next for you" merges resume + next up (one per series), Top 10 with
      outlined rank numerals, "Because you watched …", genre tiles, one Recently added row with
      All / Movies / Shows, sparse rows hidden, and a ⋯ on every row (hide, move, customize).
- [x] **Universal search** — `/` or ⌘K opens an overlay anywhere (the Search tab on phones/TV):
      ranked top result with Play/Resume, library matches, people, and "Not in your library"
      Radarr/Sonarr results with Request / downloading status. Recent searches + genre tiles
      when empty.
- [x] **Detail page** — Resume with a progress bar and time left (or "Resume S1:E3"), labelled
      actions (My List, Favorite, Trailer, Play on…, More), mark watched/unwatched and the admin
      tools (Fix match, Refresh metadata, File info) in the More menu, and tabs for Episodes /
      More like this / Cast and details.
- [x] **Library browsing** — All / Unwatched / In progress / Favorites, a multi-genre filter, a
      sort menu (incl. Runtime), grid ↔ list toggle, result count, "Surprise me" scoped to the
      library, and a real empty state with Clear filters.
- [x] **Player** — a pause screen (title, episode, synopsis) after 1.5s paused, chapter ticks and
      intro/credits bands on the scrubber, and the chapter name under the scrub preview.
- [x] **Settings + profiles** — sections with a sticky sidebar (chips on phones), every toggle
      labelled "Your account · syncs everywhere" or "This device", live accent preview; profile
      picker shows the connection state (home / away / unreachable + Try again) and puts the
      last-used profile first.
- [x] **TV home** — a focus-driven hero: the top of the screen describes whatever the remote is
      resting on, rows scroll beneath it (spatial nav keeps focus below the panel).
- [x] Empty and error states: server unreachable on Home, empty My List, empty Browse.
- [x] **In-app updates** (`deploy/README.md`) — merging a version bump publishes a GitHub release
      (web build + TV bundle) via `.github/workflows/release.yml`; admins press **Update Finesse**
      (avatar menu or Settings → Updates) and the invite service installs it on the NAS (verified,
      assets before index.html, dir inode kept); everyone else gets a **Finesse X.Y is ready ·
      Update** pill; TVs pull the OTA bundle themselves. One-time: copy the new invite service to
      the NAS.
- [ ] Updates: one-click rollback to the previous release; prune hashed assets older than two
      releases from the served dist.
- [ ] Search: link "Not in your library" through to the Requests page for more than the top 5
      Radarr/Sonarr matches.
- [ ] Detail tabs on TV: Down from the right-hand actions (More) lands on the grid, not the tab
      strip (Down from Play reaches it) — consider a spatial-nav hint for the tab row.

## Continuous motion, depth + mood — v0.11.0 (2026-09-26)
- [x] **Continuous motion** (`lib/motion.ts`) — the poster you tap grows into the detail page
      (its poster on wide screens, the backdrop on phones), the backdrop grows into the player,
      and Back plays it all in reverse into the card you came from (scrolling its row back to
      it if needed). Driven by `document.startViewTransition` directly — react-router's
      `viewTransition` prop only works with data routers, so the old poster morph never ran.
      Detail pages open instantly from cached list data (`useItem` placeholder) so the morph
      has somewhere to land. Off on TV and for reduced motion.
- [x] **Scroll depth** — rows rise out of the page as they scroll in and recede as they leave;
      hero art sinks behind the page while its title lifts away. Pure CSS scroll-driven
      animations (compositor-only), skipped where unsupported, on TV and for reduced motion.
- [x] **Ambient player glow** — a tiny canvas samples the video ~12×/s and blooms its colours
      into the letterbox bars (Settings → Ambient glow, or the player's settings panel).
- [x] **Physical depth** — layered parallax on heroes (backdrop drifts against the pointer, the
      title rides a nearer plane; opt-in phone tilt in Settings), a light sheen sweeps across a
      card as you land on it, and on TV the focused card leans in from the direction you came.
- [x] **The app wears the film** (`lib/mood.ts`, `MoodWash`) — resting on a card (hover or
      D-pad) tints the room in that poster's colour; detail pages take their film's colour;
      loading placeholders and the navbar edge pick it up; nav sounds are pitched by hue.
- [x] Fixed: the detail page's blurred "ambilight" was always hidden behind the opaque body
      background (and the hero ended on a hard seam); it now shows, and the hero melts into it.
- [x] Phones / the installed PWA (no browser Back) get a Back button on detail pages.
- [ ] Morph on the OS back gesture too (Android predictive back / iOS swipe run their own
      animation, so only in-app Back / Escape plays the reverse morph today).
- [ ] AirPlay / Chromecast from the player via the Remote Playback API (needs a native-HLS
      path on Safari; can't be tested headless).

## Up Next previews + casting — v0.10.0 (2026-09-26)
- [x] **Up Next preview card** — at the credits the player shows the next episode's teaser
      clip (still image on TV: no second video decode), title, runtime, synopsis, and Play
      now (countdown fills it) / Cancel. The clip is warmed ~30s early; landscape phones get a
      compact card with no clip. Episodes only (movie sequels deliberately skipped).
- [x] **Episode teasers on the NAS** — `deploy/genclips.sh` now builds episodes as a 4-cut
      montage from the first half (12/24/36/48%, spoiler-light, quick fades) instead of one
      20s chunk; falls back to the single cut if the montage fails (e.g. no audio). Existing
      clips are kept (the script skips files that exist) — delete an episode's
      `previews/<id>*.mp4` to regenerate it as a teaser. Failed encodes no longer leave
      0-byte "clips" that the manifest then advertised.
- [x] **Casting TO Finesse (remote-control receiver)** — Finesse now reports session
      capabilities and keeps Jellyfin's websocket open (`lib/remoteControl.ts`), so the TV
      app appears in every "Play on…" menu (Finesse's and the Jellyfin apps') and obeys
      Play / Pause / Seek / Stop / next-previous episode / volume / audio + subtitle track /
      messages. Before, it never registered as controllable, so casting to it couldn't work.
- [x] **Mini remote** (`components/CastRemote.tsx`) — after "Play on…", the phone shows
      what's playing on the TV with ±10s, play/pause, stop and tap-to-seek; closes itself
      when playback there ends.
- [x] Devices now name themselves ("LG TV", "Safari on iPhone", "Chrome on Windows"…) —
      every Finesse used to be "Web", so targets were indistinguishable.
- [x] Live sync: the websocket's UserDataChanged/LibraryChanged refresh Continue
      Watching / Next Up / lists without a reload.

## Polish pass — v0.9.0 (2026-09-26)
Tested end-to-end against a mock Jellyfin in headless Chromium at phone, desktop and
TV sizes, plus the real webOS bundle booted from file://.
- [x] **Next episode kept your audio/subs? No — fixed.** Auto-next silently dropped the
      per-series track memory (the "apply tracks" effect ran against the *previous*
      episode's stream while the next item loaded, then never again). Per-item state now
      resets during render and streams are tagged with their item. Also: no phantom Skip
      Intro from the last episode, no double-advance, missing (virtual) episodes and
      Specials skipped in the prev/next chain, next episode resumes if part-watched,
      video end → next episode or back out (no black frame), countdown pauses when paused.
- [x] **Swapped ±10s icons** — "Back 10s" drew a clockwise arrow and vice versa.
- [x] **Phone player** — controls overflowed off-screen (subs/quality/fullscreen unreachable).
      Now: centre transport, tap to show/hide, double-tap sides ±10s, audio/subtitles +
      quality/stats in bottom sheets, subtitle cues lift above the bar.
- [x] **TV player** — ←/→ scrub with one accumulated seek (+ time bubble / trickplay),
      focusable seekbar, same-row focus movement, Back closes panels first, Up Next / Skip
      Intro take focus without stealing it mid-scrub, Pause (19) / Play (415) keys.
- [x] **TV Back button** — appinfo now `disableBackHistoryAPI: true` (reinstall the .ipk
      once); the app guards against the old double-back either way and exits at Home.
      Menus/sheets/dialogs close on Back before it navigates (`lib/back.ts`).
- [x] **Focus + scroll memory** (`lib/routeMemory.ts`) — Back returns to the same card at
      the same scroll position (TV focus, web/phone scroll); new pages land focus on their
      primary action instead of the navbar logo. Hero no longer rotates out from under a
      focused button. webOS Pause key no longer moves focus up.
- [x] **Layout** — Continue Watching / Next Up are landscape play-now tiles (were cropped
      16:9 stills in 2:3 posters); hero Play works for shows (started a Series id → dead
      player) and resumes movies; series pages open on the season you're watching with the
      up-next episode marked; 3-column grids on phones; Customize moved to the bottom.
- [x] **Phone shell** — PWA manifest pointed at `/` (opened Jellyfin's UI from the home
      screen) → relative to /finesse/; Watchlist/Anime/Music reachable on phones (avatar
      menu); toasts no longer cover the tab bar; safe-area padding; no tap flash.
- [x] **TV CSS** — named-group variants (`group-hover/cast:` etc.) were unparseable on TV
      Chromium and silently dropped; `downlevel-css.mjs` rewrites them now.

## Next up
- [ ] **Subtitle styling (Part B of the subtitles idea)** — size, background/shadow, position
      controls in Settings, applied via `::cue` (works for external-delivered subs; burned-in
      transcoded subs can't be restyled). The "remember themselves" half is done above.
- [ ] **Idea pipeline** (keep a steady flow): Skip Credits + smarter auto-next; Watch
      history + dismiss-from-Continue-Watching; Kids mode (per-profile rating gate); in-player
      subtitle search (OpenSubtitles); "Wrapped" stats; keyboard-shortcut help overlay;
      accent/theme picker; late-night audio-compression mode.

- [x] **Home customization (per account)** — Customize mode on Home: hide, collapse
      (title-chip that expands inline), reorder (↑/↓), and add genre categories. Each row is
      a self-contained component (`src/components/HomeRows.tsx`) so rows can be reordered/added
      without breaking hook rules; HomePage is data-driven. Layout stored per-user in
      DisplayPreferences (`finesse-home` → `layout` = {hidden,collapsed,order,added}), synced
      across devices, debounced save. Verified: hide/collapse/reorder/add all persist.
- [ ] **Personal collections (per account)** — user-created named lists (next big one).

## Native apps (targets: Samsung/LG smart TV + Fire/Android TV)
Depends on D-pad navigation (done). High Finesse reuse on all three.
- [ ] **Samsung TV (Tizen)** — package the web app as a Tizen app (Tizen apps are HTML/JS).
- [x] **LG TV (webOS)** — packaged as a sideloadable webOS app with an in-app OTA
      self-updater (Settings → App updates, pulls bundles from GitHub Releases). See
      `webos/` + `webos/README.md`. Build: `npm run package:webos`. The webOS build is
      a single iife bundle on a relative base (HashRouter); `src/lib/contentOrigin.ts`
      points the *arr proxy + preview clips at the deployed Finesse origin. Verified
      booting + rendering in Chromium. TODO: test on the actual TV; set `GITHUB_REPO`.
- [ ] **Fire TV / Android TV** — wrap with Capacitor → APK, sideload, leanback/D-pad polish.
- Per-platform: remote Back-key handling, focus-on-launch, 10-foot type scaling, app icon/splash.

## TV player — FIXED v0.3.1 (2026-07-05)
- [x] **TV playback has no controls/UI** — auto-hide effect only revealed controls on
      mousemove/touchstart; D-pad keydown never fired the reveal, so the chrome vanished after
      the first 3.2s timeout forever. Fix: keydown also reveals (+ 5s hide on TV), and OK/Enter
      maps to play/pause (a remote has no spacebar).
- [x] **Buffering spinner never clears on TV** — cleared only by `playing`/`canplay`, which
      Chromium 68 fires unreliably after a mid-stream stall. Fix: clear buffering on
      `timeupdate` while not paused (a firing timeupdate = time advanced = playing).
- [x] FOLLOW-UP DONE (v0.3.2): D-pad moves focus between player control buttons by geometry
      (arrows navigate, OK activates); first press lands on Play/Pause. spatialNav player-skip
      now checks location.hash too (TV HashRouter). Custom TV cursor + native cursor hidden.

## Beauty / polish roadmap (approved 2026-07-03; do 1+2+6 first)
- [x] 1. **Living backdrop (lean-back mode)** — DONE v0.3.0 (`FocusBackdrop.tsx`): rest focus/
      pointer on a card ~1.5s → page background crossfades to that title's dimmed backdrop.
- [x] 2. **Per-title color grading** — DONE v0.4.0: `shadesFromRgb`/`vividRgb` in `lib/accent.ts`
      grade the poster's sampled color (HSL, saturation punched up) into an accent ladder;
      ItemPage overrides `--color-accent-*` on the page root so buttons/pills/progress/rings/
      cast-hover all adopt the film's palette. Poster glow now uses the vivid color too.
- [x] 6. **Time-of-day ambience** — DONE v0.3.0 (`lib/timeAmbience.ts`): aurora hues +
      splash greeting shift with the clock (morning blues → evening ambers → late violets).
- [ ] 3. **Marquee screensaver** — idle on TV → drift through library backdrops with title
      logos + taglines, slow crossfades.
- [x] 4. **UI sound design** — DONE v0.4.0: `lib/sound.ts` — pure-WebAudio oscillator blips,
      nav tick fired from spatialNav on focus move, select confirm via a global click listener.
      Opt-in `uiSounds` pref + "Interface sounds" toggle in Settings; silenced while media plays.
- [ ] 5. **Trickplay memory strips** — Continue Watching cards cycle real frames from the
      resume point on focus (trickplay tiles already exist server-side).
- [x] 7. **Poster light-spill** — DONE v0.4.0: MediaCard samples the poster's dominant color
      (`vividRgb`, cheap cached 4×4 decode) into a `--spill` var; `.spill-card` in index.css
      casts a soft colored box-shadow on hover/focus. Replaced the old flat black hover shadow.
- [x] 8. **Editorial row headers** — DONE v0.3.0: row titles now render in the brand serif
      italic (`.row-title` in index.css / MediaRow). Editorial subtext ("12 new this week")
      still TODO if wanted.
- Also shipped v0.3.0: per-launch hero shuffle (fresh billboard each app start).
- [x] 9. **Card hover-preview** — DONE v0.4.0: mouse over a movie poster → its short muted
      clip plays over the card, looping; leaves on pointer-out. Web + mouse only (TV/reduced-
      motion opt out). Added a dev-only Vite proxy for `/finesse/previews` so `npm run dev`
      shows real previews (was NAS-nginx-only before).
- [x] 10. **Preview quality overhaul** — DONE v0.4.0 (client). Fixes the "blurry = feels
      cheap" complaint + follow-up asks:
      • Per-account **Preview quality** setting (Low 480 / Medium 720 / High 1080), synced via
        DisplayPreferences like accent; default High. `lib/preview.ts` resolves the clip URL to
        the best tier ≤ the pref, falling back down the ladder.
      • **Single preview at a time** — `claimPreview`/`releasePreview` lock shared by cards +
        hero; starting one stops the other (verified: hover A→B leaves exactly 1 video playing).
      • **Prefetch** — clips warm as cards scroll into view (shared IntersectionObserver), so
        hover is instant. Video reveals only on `onPlaying` (no half-decoded flash).
      • Manifest v2: `manifest.json` (base ids) + `manifest-hd.json` ({id:[720,1080]}), merged
        by `useClipManifest`. Back-compatible — old array manifest still works as 480-only.
      • Poster requests bumped 360→480px on web for crispness.
      • **NEEDS SERVER RUN:** `deploy/genclips.sh` rewritten to v2 — 480/720/1080 tiers, movies
        AND episodes, writes `manifest-hd.json`. Until it runs on the NAS, High just serves the
        existing 480 base (graceful). Re-encode is the long pole; run `sudo bash genclips.sh`.

## Backlog
- [x] **Games (RomM)** — shipped in 1.0: optional Games library (RomM + MariaDB) that setup
      installs, played in the browser with EmulatorJS. Later: RetroAchievements sign-in (RomM
      supports it) and a TV-friendly game picker (the CX handles 8/16-bit systems best).
- [ ] **SyncPlay "watch together" (#5)** — synced playback via Jellyfin SyncPlay API.
- [ ] Offline PWA downloads (direct-play titles to device).
- [ ] Year-in-review "wrapped" stats page.
- [ ] Per-profile content-rating limits (kids profiles).

## Request feature — follow-ups
- [ ] **Admin approval gate / quotas** — right now any logged-in user adds directly to
      Radarr/Sonarr (no approval step). Add an approve-before-download flow + per-user caps
      if the family server needs it.
- [ ] Season selection for shows (currently monitors *all* seasons on add).
- [x] Surface request/download status in the UI — "Downloading now" section on the Request
      page (live Radarr/Sonarr queue, aggregated per movie/series, progress bars, polls every
      15s) + per-result badges (Downloading X% / Importing…). `src/components/DownloadsSection.tsx`,
      `arrQueue()` in arr.ts, `useArrQueue()` in queries.ts. TODO: optional "Coming Soon" row on Home.
- [ ] Quality-profile picker in Settings (defaults to HD-1080p + first root folder).

## Cast — follow-ups
- [x] Remote-control *receiver*: Finesse is a castable target (v0.10.0, `lib/remoteControl.ts`).
- [x] Mini remote UI for the device you cast to (v0.10.0, `components/CastRemote.tsx`).

## Spatial-nav — follow-ups
- [ ] Virtualized library grid (LibraryPage A-Z): off-screen items aren't in the DOM, so
      arrow nav is limited to the rendered window + nudge-scroll. Wire focus into the
      virtualizer for full grid traversal.
- [x] Map the remote Back button to in-app back navigation (v0.9.0, `lib/back.ts`).
