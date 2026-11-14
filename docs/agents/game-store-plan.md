# Game store: the plan

The game store lets someone find a game, press **Request**, and come back to it installed and
playable, with nobody touching the server. This file is the brief for the agents building it.
Read [AGENTS.md](../../AGENTS.md) first: its rules apply to everything here.

Branch: `feat/game-store` (from `master` 3.2.8). Some of it is built already (see **State**).

## What it must do, end to end

1. **Browse.** A store of games the server doesn't have: front page, search, filters (genre,
   platform, players), sort, a page per game with details, screenshots and "More like this".
2. **Request.** Like movies, shows and music: one button, with the choice of download (Windows
   installer or Linux build) when there's more than one. Requests respect parental limits.
3. **Download.** By magnet, with the qBittorrent Finesse already runs, **only through the VPN**
   (Docker: inside Gluetun's network; Windows: locked to the VPN app's connection). Progress,
   speed and time left show on the request.
4. **Check.** Verify the download against every checksum it came with (`.md5`, `.sha1`,
   `.sha256`), and against the store's own checksum when there is one (only that one says the
   files are genuine). A mismatch stops the request with a plain reason.
5. **Install, hands-off,** in a sandbox with **no network** and access to nothing but the game's
   folders, trying in order:
   1. **Unpack it ourselves** (innoextract, 7-Zip, msiextract, tar): nothing from the download runs.
   2. **Run the installer silently** with its own switches, answering its questions from the
      **answer sheet**: accept the license, our folder, all optional parts, runtimes yes,
      **drivers and "update your system" no**, no shortcuts, no "launch now", no offers.
   3. **Auto-click** whatever window the switches didn't cover, by button label, from the same
      answer sheet.
   4. **Needs you:** show the installer's window to a person (in the browser where possible) and
      say what it's waiting on ("Waiting for you: 'Choose your region'").
6. **Prove it starts.** Start the game in the sandbox and look at the screen: a real game window
   (a non-blank screenshot) means **Ready**. A message box is answered from the answer sheet; an
   error box means **Didn't work: (its text)**. Keep the screenshot for the request.
7. **Play, two ways, chosen each time.** Every ready game has **Play on the server** (it runs on
   the machine Finesse is on, on that machine's own screen) and **Stream** (it runs on the server
   and streams to the TV, a phone, or Finesse's in-browser player). Pressing **Play** asks which,
   every time; the last choice is pre-selected, and a way that isn't available on this server is
   shown greyed out with the reason ("This server has no screen", "Game streaming is off").
8. **Everything in plain words** at every step, on the request page and the requests list, and
   on the TV.

**Hosts:** Linux (Finesse in Docker, the default) **and** Windows (Finesse as native Windows
programs, `FINESSE_HOST=native`, see [docs/windows.md](../windows.md)). Every workstream says
what differs.

## Rules for this feature

- **Finesse ships no game sources.** Providers are added and configured by whoever runs the server
  (ROADMAP principle 7), like indexers in Prowlarr. Nothing in the repo points at a particular
  download site.
- **Test only with installers that are free to share** (open source games, free games, test
  installers we build). Don't add code aimed at one release group's or repacker's tooling.
- **Installing is sealed off:** nothing from a download runs during install outside the sandbox,
  and never with network access. **Playing** means running the game, so it runs as contained as
  each way allows: in Wolf's container when streamed on Linux; as Finesse's low-privilege games
  account where Windows allows it. The games folder is the only place a game can write to.
- **The server stays dependency-free** (Node built-ins). The sandbox image and the Windows tools
  are separate, pinned, hash-checked artifacts, like the stack's apps.
- **Idempotent and restart-safe:** requests live in sqlite; a restart resumes where it was. Only
  touch containers labelled `finesse.managed=true` (installer jobs also get `finesse.job=install`
  and are cleaned up at start).
- **Words:** say what happened and what to do next, never an error code alone.

## State (what exists on `feat/game-store`)

| Piece | Where | Status |
|---|---|---|
| Store front, Browse, game page, Requests, "Needs you" page | `src/pages/GameStore*.tsx`, `GameRequestsPage.tsx`, `GameInstallerPage.tsx`, `src/components/gamestore/` | Built, tested in a browser on desktop and phone |
| The contract every page uses | `src/api/gameStore.ts` (types, `GameStoreApi`, server client for `/api/games/store/*`) | Built |
| Demo store (40 open source games, pretend downloads through every state) | `src/api/gameStore.demo.ts` | Built; on in `npm run dev` or with `VITE_GAME_STORE=demo` |
| Hooks | `src/api/gameStoreQueries.ts` | Built |
| Request status words | `src/lib/gameRequestStatus.ts` | Built (pure) |
| Installer type from bytes (Inno, NSIS, MSI, WiX, InstallShield, self-extractors, archives, ISO, ELF, AppImage, Makeself) | `server/src/installerSniff.ts` + test | Built, 11 tests |
| Checksum lists (`.md5`/`.sha1`/`.sha256`, subfolders, store hashes) | `server/src/downloadCheck.ts` + test | Built, 5 tests |
| Installer lab: 8 worst-case Inno installers (sources), a stand-in game and runtime, scripts, results | `tools/installer-lab/` | Built and run on the dev NAS; WS8 makes it repo-relative and puts it in CI |
| Prototype sandbox image | `tools/installer-lab/prototype/Dockerfile` | Prototype; replace (WS4) |
| Hands-off prototype (`plan.ts` + `auto-install.sh`, `try-install.sh`) | `tools/installer-lab/src/`, `prototype/` | Prototype; the logic moves into the server (WS3) |

## What the tests showed (build on these)

| Finding | So |
|---|---|
| Unpacking alone gave a working game in 6 of 8 worst-case installers, plus OpenTTD (NSIS) and SuperTux (MSI) | Unpack first. |
| innoextract **1.9** (Debian) can't read Inno 6.3; **git master** can, but not **Inno 6.7** (Warzone 2100) | Build tools from source and pin them; when the installer's version is newer than the tool supports, skip straight to the silent run. |
| p7zip 16.02 couldn't open 0 A.D.'s NSIS installer; OpenTTD's opened fine | Ship the current 7-Zip (7zz), not p7zip. |
| `innoextract` lists files the installer runs as `tmp/` (runtimes, extractors) | `tmp/` present → prefer the silent run (unpacking skips those steps: case 06). |
| Unpacking takes every optional part and skips settings/registry writes (case 04) | Fine for most games; the start check catches the rest. |
| `/CURRENTUSER` fails under Wine 8 (no per-user Programs folder, `autopf`); `/ALLUSERS` works | Linux: always `/ALLUSERS`. Windows: `/CURRENTUSER` is fine and avoids admin. |
| A required input page **hangs** a silent install forever (case 04) | Hang = **no progress** (no files written, no CPU) for 2 min, never a fixed total time. Stop the **whole** sandbox (`wineserver -k`), not just the launcher. |
| Exit codes and the installer's own log explain failures: 1 refused (case 05), 7 with "Couldn't download the extra content" (case 07) | Read the log (`/LOG=` for Inno) and show its reason. |
| "Still running after N s" said **started** for a game sitting on a message box (Warzone 2100) and on a crash box (0 A.D.) | The start check must read the windows on screen (WS3 window helper). |
| 0 A.D. crashed under Wine 8 (firmware query); SuperTux ran with software 3D | Launch-check with the same, newer Wine/Proton that Wolf plays with. |
| Warzone 2100 says "native Linux builds are available" | Prefer the Linux build when a provider offers both. |
| A program can unpack its own `.bin` files; a `.bin` is often a plain 7z/zip/rar | Sniff every big file in the download, not just the `.exe`; unpack standard archives ourselves; private formats need the installer. |

## Workstreams

Agents can take these in parallel. Each lists what it owns, what it needs, and when it's done.
Interfaces between them are TypeScript types in `server/src/gamestore/types.ts` (WS0 writes it
first, everyone imports it).

### WS0 — Contract and skeleton (first, small)
- `server/src/gamestore/types.ts`: server-side types matching `src/api/gameStore.ts`
  (`StoreGame`, `StoreSource`, `GameRequest`, states), plus `Provider`, `Downloader`,
  `InstallPlan`, `SandboxRunner`, `InstallOutcome` (below).
- Route stubs for every `/api/games/store/*` endpoint in `src/api/gameStore.ts`, behind the usual
  sign-in, returning 501 until filled. `features.gameStore` in `/api/finesse` when enabled.
- sqlite tables: `store_game`, `store_source`, `game_request` (+ events log), via `node:sqlite`.
- **Done when** the frontend talks to the stubs without errors and the types compile.

### WS1 — Providers and the catalogue
- `Provider` interface: `search(q)`, `details(id)`, `sources(id)` → magnet, size, platform,
  installer hint, checksum (if the provider has one), version.
- A **configurable provider** the admin sets up in Settings (a site address plus the rules to read
  it: list page, detail page, fields), so no site is hard-coded. Fetches go through Gluetun's HTTP
  proxy on Docker (`HTTPPROXY=on`; a catalog change, so a release decision) and the VPN on Windows.
- **Metadata** from IGDB (optional key, like RomM's) for descriptions, genres, screenshots,
  covers; cached by Finesse, images served through Finesse.
- Catalogue sync into sqlite; `home`, `search`, `facets`, `games/:id` endpoints (counts per
  facet with the other filters applied, like the demo).
- **Done when** a fake provider in tests and a real configured one fill the store, and the demo
  store can be switched off.

### WS2 — Downloads and the request pipeline
- qBittorrent client (`server/src/gamestore/qbit.ts`): login, add magnet (category `games`, save
  path `torrents/games`), progress, pause, remove with files. Docker: `http://qbittorrent:8080`
  inside Gluetun's network. Windows: the native qBittorrent already locked to the VPN.
  Refuse to add when the VPN is down; say so.
- Free-space check before adding (size × 3: download + unpacked + installed).
- The **request state machine** (states in `src/api/gameStore.ts`): queued → downloading →
  checking → installing → needs-you → finishing → ready | failed, persisted, resumed after a
  restart, one install at a time, cancel at any point (stop torrent, stop sandbox, delete files).
- Checksums with `downloadCheck.ts` (store hash + lists in the download).
- Seeding: keep seeding until a ratio/days limit (Settings), then remove the download.
- Endpoints: `requests` list/create/cancel/retry/installer-done.
- **Done when** a fake qBittorrent drives a request from queued to installing in tests, and a
  restart mid-download resumes.

### WS3 — Install engine (shared by both hosts)
- `server/src/gamestore/install.ts`: given a finished download folder, decide and run the tiers.
  - **Survey:** sniff every file (installers *and* big `.bin`/archives); group an installer with
    its sibling files; pick the installer (prefer the provider's hint, then the biggest program).
  - **Plan:** apply the findings table (version vs tool support, `tmp/` → silent first, Linux
    build → no Wine, standard archives → unpack ourselves).
  - **Run** through a `SandboxRunner` (WS4/WS5): `unpack(tool)`, `install(command)`,
    `launch(program)`, each streaming progress and returning logs.
  - **Hang detection** by progress (bytes written, CPU), stop-everything on hang.
  - **Find the game's program** (skip uninstallers, setups, redistributables, crash reporters,
    helpers; prefer the provider's hint, then a name match, then the biggest).
  - **Answer sheet** (`answers.ts`): Inno `/COMPONENTS` `/TASKS` (read from the installer's data
    where innoextract can list them), NSIS `/S /D=`, MSI `/qn` + properties, and the window rules.
- **Window helper** (`tools/winhelper/`, C, built with mingw-w64): a small Windows program that
  lists top-level windows (title, class, text of child controls), clicks a button by its label,
  and screenshots a window. It runs under Wine on Linux and natively on Windows, so one tool
  serves both. The engine uses it for the start check, auto-clicking and "Needs you" titles.
- **Start check:** launch, then within 60 s require a top-level window that isn't a dialog
  (`#32770`) and a non-blank screenshot; answer dialogs from the answer sheet; an error dialog
  ends with its text.
- **Done when** the lab's 8 cases and the 4 real games produce the expected outcome through the
  engine with a fake runner (unit) and a real one (WS8).

### WS4 — Linux sandbox (Docker)
- Image `ghcr.io/coffeecc/finesse-installer`, built in the repo (`docker/installer/`), pinned in
  `catalog.ts`, x86_64: newer Wine (match the Proton Wolf uses; Proton via umu-launcher is the
  better match), Xvfb + Mesa (software 3D for the start check), current 7-Zip built from source,
  innoextract from a pinned commit, msitools, winhelper, x11vnc + websockify for "Needs you",
  common runtimes pre-installed in the base prefix (winetricks: vcrun2022, d3dx9, d3dcompiler_47,
  xact; .NET only if size allows).
- `SandboxRunner` for Docker: one container per job via the orchestrator, `NetworkMode: none`,
  no Docker socket, non-root, memory/CPU limits, read-only download mount, writable install
  folder only, `finesse.managed=true` + `finesse.job=install`, removed when done, leftovers
  cleaned at start.
- "Needs you": x11vnc on the job's screen, proxied by Finesse's existing websocket proxy at
  `/api/games/store/requests/:id/screen`, behind sign-in.
- **Done when** WS8's lab runs through it and an image build is in CI.

### WS5 — Windows host
- Tools as native apps (like `native.ts`): 7-Zip, innoextract (Windows build), lessmsi or msiexec
  `/a` for MSI, winhelper; pinned and hash-checked.
- `SandboxRunner` for Windows:
  - **Unpacking** runs no download code, so it can run as Finesse.
  - **Running an installer or a game:** in **Windows Sandbox** when the edition has it
    (Pro/Enterprise/Education): a `.wsb` with networking off and only the job folders mapped.
    Otherwise a dedicated **low-privilege local account** with write access to the job folders
    only, a Windows Firewall block on the job's programs, and a job object for limits and
    clean-up; this fallback is off until the admin turns it on (it's weaker than a sandbox).
  - Installers run with `/CURRENTUSER` where they support it (no admin prompt), into
    `<root>\media\games\pc\<game>`.
- "Needs you": Finesse runs as a service with no screen. Show the installer on the PC's signed-in
  desktop (a task in that session) and say "Finish it on the server PC", unless WS5 finds a
  reliable way to stream that window to the browser.
- **Done when** the lab's 8 cases and the real games produce the same outcomes as on Linux on a
  Windows 11 machine (and a GitHub `windows-latest` runner for what runs there).

### WS6 — Play (two ways, chosen at launch)
- A `Player` interface with two implementations per host, and `available()` saying whether each
  works on this server right now (and why not, in words):
  - **Play on the server**
    - **Windows:** start the game in the signed-in person's desktop session (Finesse is a service
      with no screen: a task in that session, or `CreateProcessAsUser` with that session's
      token), as the games account where the game allows it. Not available when nobody is
      signed in at the PC.
    - **Linux:** start the game on the host's own display through the same Proton/Wine as the
      sandbox (Linux builds directly). Only available when the host has a desktop session
      (most NAS boxes don't: then it's greyed out).
  - **Stream**
    - **Linux:** the game as a Wolf app, run with the same Proton/Wine as the sandbox, the game
      folder mounted, saves in Finesse's games folder (like `gameSaves.ts`). Check what the pinned
      Wolf version's API allows first (today Finesse only lists apps and pairs devices); if apps
      can't be added by API, write Wolf's config and restart it at a quiet moment.
    - **Windows:** add **Sunshine** (or its fork Apollo) to the native stack, pinned and
      hash-checked like the other apps; register each game as a Sunshine app; pair Moonlight
      devices through Finesse the way it does for Wolf today.
    - Both: stream to Moonlight apps and to Finesse's own in-browser player
      (`/games/stream/:sessionId`, `browserStream.ts`), whichever the person picks.
- Saves and settings live in the games folder either way, so a game started on the server and
  later streamed (or the other way round) carries on where it was.
- Installed store games appear in **Games → Your games** with their screenshot, and the
  request page's **Play** goes to the same choice.
- **Done when** one ready game can be started both ways on Linux (stream to a TV with Moonlight;
  on the server where it has a screen) and on Windows (on the PC; streamed with Sunshine).

### WS7 — Frontend completion
- Switch from the demo to the server when `features.gameStore` is on (already wired); keep the
  demo for `npm run dev`.
- "Needs you" page: the noVNC client against the screen websocket (WS4), or the Windows message
  (WS5). The demo wizard stays for the demo.
- **Play** opens the choice: "Play on <server name>" / "Stream to…" (this device in the browser,
  or a paired Moonlight device), last choice pre-selected, unavailable ways greyed out with the
  reason. Works with a remote and a controller on the TV (D-pad, the A button picks).
- Requests show the start-check screenshot, the installer's reason on failure, and "Waiting for
  you: '<window title>'".
- Settings: provider set-up (WS1), seeding limits (WS2), sandbox options and the Windows fallback
  toggle (WS5), store on/off.
- Games tab on the Request page (link is there), TV pass (`npm run build:webos`, D-pad), plain
  words throughout. A video-tour scene (`tools/tour/`).

### WS8 — The installer lab, in the repo and in CI
- Move the lab to `tools/installer-lab/`: the `.iss` sources, `game.c` / `redist.c`, scripts;
  build the installers in CI (Inno Setup's compiler under Wine on Linux, natively on Windows),
  never commit binaries.
- Add the cases still missing:
  - 09: a program plus `.bin` files that are really 7z, nested, plus one private format;
  - 10: a runtime installer with no silent switch (its own window), then "Update your graphics
    driver? Yes/No";
  - 11: NSIS with components and a required page;
  - 12: an MSI with a dialog;
  - 13: an InstallShield-style installer (if one can be made freely).
- Real-world set by URL + official checksum (downloaded in CI, cached): OpenTTD (NSIS),
  SuperTux (MSI), Warzone 2100 (Inno 6.7), 0 A.D. (NSIS, large), plus the same games' Linux
  builds.
- One command runs everything and prints the outcome table (expected vs actual).
- **Done when** CI runs the lab on Linux and Windows and fails on any changed outcome.

### WS9 — Docs and release
- `docs/game-store.md`: what it does, providers, the sandbox and what it can and can't see, the
  Windows differences, troubleshooting ("Needs you", "Didn't work").
- `setup.schema.json` in sync with `server/src/setup/doc.ts` if the setup document gains
  settings (`server/test/setup.test.ts` enforces it).
- `TODO.md` release section; the catalog pin for the installer image is a release decision.

## Order

1. WS0 (a day). Then WS1, WS2, WS3, WS4, WS5, WS8 in parallel.
2. WS6 after WS3 + WS4 (Linux) or WS5 (Windows) give a ready game. Its Sunshine part can start
   early.
3. WS7 alongside, as endpoints land. WS9 last.

## Decisions for the maintainer

1. **"Play on this device"** (copy the game onto the PC you're browsing from and run it there)
   needs a desktop companion app: later, or not at all? Play on the server and Stream are decided
   (both, chosen at launch; Sunshine on Windows).
2. **Windows without Windows Sandbox** (Home edition): allow the low-privilege-account fallback,
   or require Windows Sandbox for running installers (unpacking still works)?
3. **"Needs you" on Windows:** finishing at the server PC acceptable for a first release?
4. **Installer image size** (Wine + runtimes ≈ 2 GB): download on first game request, not at setup?
5. **Gluetun's HTTP proxy** for provider fetches on Docker (recreates Gluetun and qBittorrent
   once): which release?

## Checks before any push

`npm run build && npm run server:typecheck && npm run server:test`, `npm run build:webos` for UI
changes, and the lab (WS8) for anything that touches installing.
