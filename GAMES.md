# Games section (RomM integration) — build plan

Research captured 2026-07-06 so the build is fast next session. **Nothing here is
shipped** — this is a plan + the exact API/proxy details.

## Current state
- RomM **4.8.1** on TrueNAS, container `ix-romm-romm-1`, port **30061** (→8080).
  Backed by postgres + redis (also ix-romm-*).
- ROM library on host: `/mnt/HDDs/Games/roms` (mounted `/romm/library`).
- Config on host: `/mnt/.ix-apps/app_mounts/romm/config/config.yml`.
- Library **cleaned to 358 real games / 23 platforms** (was 1,403 across 226).
  Junk removed via API delete (DB-only, files kept) + 88 exclusion rules added so
  future scans stay clean. Top platforms: N64 144, SNES 55, Switch 33, GBC 30,
  PS2 22, NES 14, GBA 11, PSX 11.
- Auth: user `Zarock69` (HTTP Basic works on the API). **Creds are NOT in this
  repo** — put them in `.env.local` / nginx like the *arr keys.

## RomM API (what Finesse will consume)
Base `http://192.168.1.121:30061`. API requires auth (unauth → 403).
- `GET /api/heartbeat` — no auth; version, enabled metadata sources, `FS_PLATFORMS`.
- `GET /api/platforms` — `{id, slug, name, rom_count, igdb_id, ...}`.
- `GET /api/roms?limit=&offset=` — paginated `{items:[...], total}`. Rom fields:
  - `id, name, fs_name, platform_slug, platform_display_name, platform_id`
  - `md5_hash / sha1_hash`
  - `siblings[]` — versions of the same game are grouped (e.g. `.7z` + `.z64`),
    so browse by primary and offer siblings as alternates.
  - `path_cover_small / path_cover_large`, `url_cover` — **empty for unidentified**.
  - `is_unidentified` — **true for most of Paul's ROMs** (see caveat).
  - `ra_id / ra_hash / merged_ra_metadata` — RetroAchievements (RA is enabled).
- `GET /api/roms/{id}` — full detail.
- `POST /api/roms/delete {roms:[ids], delete_from_fs:[]}` — used in the cleanup.
- `POST /api/config/exclude {exclusion_type, exclusion_value}`, `GET /api/config`.
  Exclusion types: `EXCLUDED_SINGLE_EXT`, `EXCLUDED_SINGLE_FILES`,
  `EXCLUDED_MULTI_FILES`, `EXCLUDED_MULTI_PARTS_EXT`, `EXCLUDED_MULTI_PARTS_FILES`,
  `EXCLUDED_PLATFORMS`.

## Caveat: box art / metadata is sparse
IGDB/Moby/ScreenScraper are **disabled** (heartbeat shows only STEAMGRIDDB + RA).
So most games are `is_unidentified` with empty covers. Before or during the build:
- Enable IGDB (needs IGDB API creds) or SteamGridDB identify in RomM, then run a
  metadata scan to populate covers; **or**
- Finesse Games grid falls back to a name tile (same pattern MediaCard already uses
  when a poster is missing).

## Architecture
1. **Proxy RomM through the Finesse nginx** (same trick as *arr in `nginx.conf`) so
   the browser never sees creds:
   ```nginx
   location /finesse/games/api/ {
       proxy_pass http://192.168.1.121:30061/api/;
       proxy_set_header Authorization "Basic <base64 of user:pass>";  # from env, not repo
       proxy_set_header Host $host;
   }
   location /finesse/games/assets/ {      # cover art / media
       proxy_pass http://192.168.1.121:30061/assets/;
       proxy_set_header Authorization "Basic <base64 of user:pass>";
   }
   ```
   Dev: add a Vite proxy for `/finesse/games` → `:30061` with the same
   `Authorization` header (mirror the `/finesse/previews` proxy in `vite.config.ts`).

2. **Browse (native Finesse):** new **Games** nav entry + `GamesPage`.
   - `src/api/romm.ts`: `getPlatforms()`, `getRoms({platform, search, limit, offset})`
     hitting `/finesse/games/api/...`; cover URL → `/finesse/games/assets/...`.
   - Reuse MediaRow/MediaCard-style grid; group by platform; name-fallback tile
     when `is_unidentified`.
   - Optional RA badge (RA enabled).

3. **Play — hand off to RomM's built-in EmulatorJS** (don't reimplement it).
   EmulatorJS is client-side WASM; the ROM downloads to the browser and runs
   locally. Works remotely over the Funnel; performance = the *client* device.
   - Start simple: a `PlayGame` view that **iframes RomM's player route** for the
     rom, full-screen; Back returns to Games. RomM handles its own session, or
     proxy its frontend under `/finesse/games/` (heavier — SPA absolute paths).
   - This is retro emulation, NOT server-rendered streaming (that's Wolf).

## TV (webOS Chromium 68)
- EmulatorJS WASM realistically handles **8/16-bit** (NES/SNES/GB/GBA/Genesis).
  Gate heavier cores off when `__WEBOS__`. Gamepad API for controllers.

## Build checklist
- [ ] `nginx.conf`: games proxy block (+ base64 creds from env) — **server/deploy**
- [ ] `vite.config.ts`: dev proxy `/finesse/games` → `:30061` (with Authorization)
- [ ] `src/api/romm.ts` + types
- [ ] `src/api/queries.ts`: `usePlatforms` / `useGames`
- [ ] `src/pages/GamesPage.tsx` (browse) + `PlayGamePage` (iframe player)
- [ ] `NavBar` + `BottomTabs`: "Games" entry; `App.tsx` routes
- [ ] (optional) enable IGDB/SteamGridDB identify for box art
- [ ] TV gating for heavy cores

## Later: Wolf hand-off
Modern/heavy games = existing Wolf/Moonlight (server-rendered). Could add a
"Stream (Wolf)" entry to unify retro + modern in one Games hub. Separate effort.
