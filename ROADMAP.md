# Finesse roadmap — a media server in one install

> **For whoever picks this up next (human or AI):** this file is the plan of record. Read
> "Where things stand" and "How to resume" first. Every phase lists what "done" means, and
> each ticked box points at the code that does it.
>
> **Current release: v3.0.0.** This file holds the plan and the decisions. What shipped in each
> release (v1.0.1 onward) is in [TODO.md](TODO.md), newest first; the build, test and layout
> guide for contributors is [AGENTS.md](AGENTS.md).

## Vision

Install **one thing** — Finesse — on a Linux box and end up with a complete, self-maintaining
home media server:

- **Jellyfin** streams, **Finesse** is the app everyone uses (web, phone, LG TV),
- **Sonarr / Radarr / Lidarr** find shows, movies and music, **Prowlarr** manages indexers,
- **SABnzbd** (Usenet) and **qBittorrent** (torrents, always behind a **Gluetun** VPN tunnel)
  download,
- a **setup wizard** walks a newcomer through Usenet, indexers and VPN with live tests, and
  wires every app to every other app automatically,
- the same setup can be driven **headlessly by an AI agent** from one JSON file,
- afterwards Finesse **keeps it all running**: health checks, updates, backups.

Nobody should ever need to open an *arr settings page.

## Principles (decisions already made)

| # | Decision | Why |
|---|---|---|
| 1 | **Build next to Jellyfin, never fork it.** | Transcoding, codecs, metadata and security fixes are years of work we get for free. Plugins cover anything that must live inside Jellyfin. |
| 2 | **Docker for every service on Linux and NAS installs** (amd64/arm64). **Windows runs the projects' own Windows builds natively** (since v3.0.0), not Docker. | Identical behaviour wherever Docker runs; Gluetun gives torrents a real per-container kill switch. On Windows, native means no Docker Desktop, no WSL, no BIOS changes and no restart, so Finesse locks qBittorrent to the person's own VPN app instead (see 8). |
| 3 | **The Finesse server is TypeScript on Node 22, zero runtime dependencies** (`node:http`, `node:sqlite`, `fetch`), bundled with esbuild. | Same language as the app (shared types), streams proxies well, one small image, nothing to audit but our own code. |
| 4 | **One public port (8080).** Jellyfin is proxied at `/jellyfin` (Jellyfin's BaseUrl), *arr APIs behind Finesse with keys injected server-side. Jellyfin's own 8096 can also be published for native Jellyfin apps. | One URL to remember, one thing to put behind a tunnel, keys never reach a browser. |
| 5 | **Finesse orchestrates the stack itself** through the Docker Engine API (`/var/run/docker.sock`). Managed containers carry `finesse.managed=true` labels and share the `finesse` network. On Windows the same job is done by `NativeHost` (pinned, hash-checked builds started hidden and kept running); both sit behind `StackHost`. | The wizard can install, start, update and heal services without the user touching compose files. |
| 6 | **One data tree** (`data/media`, `data/usenet`, `data/torrents`) mounted at the same path in every container. | Finished downloads are *moved* (hardlink / rename), never copied. |
| 7 | **Bring your own providers.** Finesse ships with zero indexers, trackers or Usenet servers. | Legal hygiene, and it keeps the project hostable on GitHub and in app stores. |
| 8 | **Torrents only run behind the VPN.** qBittorrent shares Gluetun's network namespace; Finesse proves the public IP is the VPN's before it starts the torrent client, and stops it if the tunnel drops. | No leaks, ever, without the user having to understand why. On Windows there is no Gluetun: the person picks their own VPN app's connection in setup, qBittorrent is locked to it, and torrents wait while it is off. |
| 9 | **Setup is one JSON document** (`setup.schema.json`). The wizard builds it step by step; an AI agent can write it directly. Both go through the same `POST /api/setup/apply`. | One code path to test; the agent version can't drift from the human one. |
| 10 | **First-run is protected by a one-time setup code** printed by the installer and the container log; after setup, admin = Jellyfin administrator. | A fresh box on a shared LAN can't be claimed by someone else. |

## Architecture

```
                         ┌──────────────── the host ─────────────────┐
  browser / phone / TV ──► :8080  finesse (container)                  │
                         │   ├─ web app (baked in; OTA web updates)   │
                         │   ├─ /jellyfin/*  ──► jellyfin:8096        │
                         │   ├─ /arr/*       ──► *arrs + SAB, keys added│
                         │   ├─ /api/setup   wizard + headless apply  │
                         │   ├─ /api/system  health, services, updates│
                         │   ├─ /invite-api  invites (Jellyfin users) │
                         │   └─ docker.sock ──► creates/updates the rest
                         │                                            │
                         │  network "finesse":                        │
                         │   jellyfin  sonarr  radarr  lidarr         │
                         │   prowlarr  sabnzbd                        │
                         │   gluetun ◄── qbittorrent (shares its net) │
                         │                                            │
                         │  FINESSE_ROOT/config/<app>   per-app state │
                         │  FINESSE_DATA/{media,usenet,torrents}      │
                         └────────────────────────────────────────────┘
```

This is the Linux / NAS layout. On Windows the same Finesse server runs as a Windows service
and starts the apps natively instead of as containers (`windows/`, `server/src/stack/native.ts`).

## Where things stand

| Phase | Status |
|---|---|
| 0. The app (web, phone, LG webOS TV) | ✅ shipped through v0.13.2 |
| 1. Finesse server (replaces nginx + Python invite service) | ✅ v1.0.0 |
| 2. Stack catalog + orchestrator (Docker Engine API) | ✅ v1.0.0 |
| 3. Auto-wiring (every app connected to every other) | ✅ v1.0.0 |
| 4. Setup: wizard UI + headless apply + CLI + schema | ✅ v1.0.0 |
| 5. Self-maintenance: health, VPN guard, updates, backups | ✅ v1.0.0 |
| 6. Installer (`install.sh`), image on GHCR, docs | ✅ v1.0.0 |
| 7. AI-agent setup path (`AGENTS.md`, `docs/agents/`) | ✅ v1.0.0 |
| 8. Video tutorial of every feature | ✅ v1.0.0 (`docs/media/finesse-tour.mp4`) |
| 9. Public release polish (README, v1.0.0) | ✅ v1.0.0 |
| 10. Windows | ✅ v2.6.0 (Docker Desktop installer), replaced by a native install in v3.0.0 |
| After 1.0: features, by release | ✅ see below and [TODO.md](TODO.md) |

Shipped since 1.0 (each is described in its release section in TODO.md): Groups, sharing films,
shows and music with friends' servers (v1.1–1.2); game streaming with Wolf (v1.3–1.4) and
emulators as Wolf apps (v2.4); the 2.0 home with the stage, Now row and quick menu (v2.0);
controller support (v2.1); browser play for emulated games, Beta (v2.5); drag-in Add media
(v2.6); moments and recommendations (v2.7); the phone Remote (v2.8); Discover on Request (v2.9).

The detailed checklist for each phase follows; boxes are ticked in the PR that does the work.

### Phase 1 — Finesse server (`server/`)
- [x] Static web app with the same caching rules as `deploy/nginx.conf` (hashed assets immutable,
      `index.html` never cached, SPA fallback, `/finesse/` prefix tolerated), gzip, byte ranges
      (preview clips).
- [x] Proxies: `/arr/{radarr,sonarr,lidarr}/…`, `/arr/sab`, ~~`/arr/qbit/…`~~ (not needed: the app follows torrents through the *arr queues), `/games/{api,assets,sgdb}/…`
      — Jellyfin-token gated, keys injected, streamed.
- [x] `/jellyfin/*` reverse proxy incl. WebSockets and range requests.
- [x] Invites + libraries + web update API, drop-in compatible with `deploy/invite-service`
      (same routes, same SQLite schema, same `invites.db`).
- [x] `/api/finesse` discovery document (version, mode, Jellyfin path, features, setup state).
- [x] Contract tests run against both the Python service and the new server.

### Phase 2 — Stack catalog + orchestrator (`server/src/stack/`)
- [x] Docker Engine client over the unix socket (pull with progress, create, start, stop, inspect,
      logs, networks).
- [x] Catalog of services with pinned, tested image tags, ports, volumes, env, health probes.
- [x] Idempotent `reconcile(plan)`: creates/updates only what differs; labels every container.

### Phase 3 — Auto-wiring (`server/src/stack/wire/`)
- [x] Jellyfin: startup wizard (admin user, metadata language), BaseUrl `/jellyfin`, libraries
      for movies / shows / music, API key for Finesse.
- [x] *arr API keys read from each app's `config.xml`; auth set to "external" behind Finesse.
- [x] Root folders, download clients (SAB, qBittorrent), categories, remote path sanity.
- [x] Prowlarr: indexers from setup, synced to Sonarr/Radarr/Lidarr as apps.
- [x] SABnzbd: Usenet servers, categories, folders; qBittorrent: save paths, categories, sane seeding.
- [x] *arr → Jellyfin "library updated" notifications.
- [x] Every step idempotent; re-running setup repairs drift.

### Phase 4 — Setup
- [x] `setup.schema.json` + examples; `POST /api/setup/validate|apply`, `GET /api/setup/status`
      (live progress).
- [x] Wizard UI at `/setup`: welcome → storage → account → downloads (Usenet / torrents / both /
      none) → Usenet provider + indexers with live tests → VPN with live IP proof → quality → review
      → build (live progress) → done.
- [x] `finesse` CLI in the image: `setup apply`, `setup status`, `doctor`, `setup-code`.

### Phase 5 — Self-maintenance
- [x] Health loop: container state, HTTP probes, disk space; restart what died.
- [x] VPN guard: qBittorrent stopped whenever Gluetun is unhealthy.
- [x] Updates: Finesse checks releases; web app OTA (existing), stack images to the catalog's pins,
      Finesse itself via a short-lived helper container.
- [x] Nightly config backups with retention; restore command.
- [x] System page in Settings: services, health, versions, update, logs.

### Phase 6 — Installer + distribution
- [x] `install.sh`: checks OS/arch/ports/space, installs Docker if missing (with consent),
      asks for the data folder, starts Finesse, prints the URL + setup code. `--unattended` flags.
- [x] Release workflow builds and pushes `ghcr.io/coffeecc/finesse` (amd64 + arm64).
- [x] Docs: install, migrate an existing setup ("adopt" mode), troubleshooting, uninstall.

### Phase 7 — AI-agent setup
- [x] `AGENTS.md` (entry point) + `docs/agents/INSTALL.md`: deterministic steps, what to ask the
      human for, what never to invent, verification commands with expected output.
- [x] `llms.txt` summary.

### Phase 8 — Video tutorial
- [x] Record the real flows (install → wizard → every app feature) against a real stack with open
      movies (Blender Foundation, CC-BY), captioned + narrated, chaptered; published with the release.

### Phase 9 — Public release
- [x] README rewrite, screenshots, feature tour, FAQ, SECURITY.md, CONTRIBUTING.md.
- [x] Remove personal defaults (LAN IPs, tailnet names) — server discovered at runtime.
- [x] v1.0.0.

### Phase 10 — Windows
- [x] v2.6.0: Finesse Setup (`windows/installer/`) checked the PC, installed Docker Desktop (WSL2
      backend) if needed and ran the same image. Finesse 2 installs on Windows keep working.
- [x] v3.0.0: a native install replaces it. Finesse runs as a Windows service and starts
      Jellyfin, Sonarr, Radarr, Lidarr, Prowlarr, SABnzbd and qBittorrent as their own Windows
      builds (pinned and SHA-256-checked in `server/src/stack/native.ts`). No Docker Desktop,
      WSL, BIOS change or restart; updates roll back if the new version won't start. See
      [docs/windows.md](docs/windows.md).
- [x] Torrents on Windows go through the person's own VPN app (see principle 8).
- [ ] Not on Windows yet: Games (RomM), and the built-in Tailscale and Cloudflare Tunnel setup
      (the Tailscale app for Windows works instead).
- [ ] Moving a Finesse 2 (Docker Desktop) install to Finesse 3 is manual: settings don't carry
      over.

## How to resume

- **Build / test the app:** `npm ci && npm run build`; TV bundle `npm run build:webos`, then
  `npm run package:webos` for the .ipk / OTA bundle.
- **Server:** `npm run server:typecheck`, `npm run server:test` (fakes for Jellyfin, GitHub and
  SMTP; no Docker needed), `npm run server:build` → `server/dist/`.
- **Whole stack on this machine:** `docker build -t finesse:dev . && ./install.sh --image finesse:dev`
  — see [docs/install.md](docs/install.md) and the "Testing the real stack" section of
  [AGENTS.md](AGENTS.md).
- **CI** (`.github/workflows/ci.yml`) type-checks and tests the server and builds the web app,
  the TV app and the server bundle on every pull request. It does **not** run any UI tests: the
  Playwright/Chromium-68 harness used during development still lives outside the repo, and
  there is no `tests/` directory yet. Moving its important suites into the repo and into CI is
  still open.

## Open questions (for the owner)

Collected here instead of blocking work; each has a default that's already implemented.

- *(none yet)*
