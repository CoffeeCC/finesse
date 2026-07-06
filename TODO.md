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

## Next up
- [ ] **Subtitle styling (Part B of the subtitles idea)** — size, background/shadow, position
      controls in Settings, applied via `::cue` (works for external-delivered subs; burned-in
      transcoded subs can't be restyled). The "remember themselves" half is done above.
- [ ] **Idea pipeline** (Paul wants a steady flow): Skip Credits + smarter auto-next; Watch
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

## Native apps (Paul's targets: Samsung/LG smart TV + Fire/Android TV)
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

## Beauty / polish roadmap (Paul-approved 2026-07-03; do 1+2+6 first)
- [x] 1. **Living backdrop (lean-back mode)** — DONE v0.3.0 (`FocusBackdrop.tsx`): rest focus/
      pointer on a card ~1.5s → page background crossfades to that title's dimmed backdrop.
- [ ] 2. **Per-title color grading** — grade each detail page (buttons/progress/scrims) from
      the poster's palette (client-side sampling, cached). Every film's page feels custom.
      (Partial: ItemPage already derives accentRgb from the poster blurhash — extend it.)
- [x] 6. **Time-of-day ambience** — DONE v0.3.0 (`lib/timeAmbience.ts`): aurora hues +
      splash greeting shift with the clock (morning blues → evening ambers → late violets).
- [ ] 3. **Marquee screensaver** — idle on TV → drift through library backdrops with title
      logos + taglines, slow crossfades.
- [ ] 4. **UI sound design** — subtle D-pad tick + select confirm (WebAudio, Settings toggle).
- [ ] 5. **Trickplay memory strips** — Continue Watching cards cycle real frames from the
      resume point on focus (trickplay tiles already exist server-side).
- [ ] 7. **Poster light-spill** — focused card casts a glow in its dominant color (web full,
      TV cheap gradient version).
- [x] 8. **Editorial row headers** — DONE v0.3.0: row titles now render in the brand serif
      italic (`.row-title` in index.css / MediaRow). Editorial subtext ("12 new this week")
      still TODO if wanted.
- Also shipped v0.3.0: per-launch hero shuffle (fresh billboard each app start).

## Backlog
- [ ] **RomM integration — play games inside Finesse (long-term stretch goal, Paul 2026-07-05)**
      NOTE: Paul says RomM is already installed, but no RomM container found on the TrueNAS
      (running or stopped) as of 2026-07-05 — confirm where it's hosted / how it was installed
      before wiring Finesse to it.
      RomM is a self-hosted ROM manager with EmulatorJS built in (browser-based emulation,
      WASM). Plan sketch: (1) install RomM as a TrueNAS app pointed at a ROM library;
      (2) Finesse "Games" nav entry → browse RomM's library via its REST API (same nginx
      key-injection proxy pattern as the *arr apps); (3) play via embedded EmulatorJS
      (iframe RomM's player, or deep-link). Feasibility: web/desktop = very doable;
      TV (CX, Chromium 68) = WASM exists but the SoC will only handle 8/16-bit era
      (NES/SNES/GB/Genesis) at best — treat TV play as retro-only. Gamepad API for
      controllers. RetroAchievements creds exist (Chyeadeed) — RomM supports RA
      integration for cheevos.
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
- [ ] Remote-control *receiver*: make Finesse itself a castable target (Jellyfin websocket
      session + Play/Pause/Seek command handling) so you can fling to a Finesse browser/TV,
      not just native Jellyfin apps.
- [ ] Mini remote UI (play/pause/seek/volume) for the device you cast to.

## Spatial-nav — follow-ups
- [ ] Virtualized library grid (LibraryPage A-Z): off-screen items aren't in the DOM, so
      arrow nav is limited to the rendered window + nudge-scroll. Wire focus into the
      virtualizer for full grid traversal.
- [ ] Optional: map the remote Back button to in-app back navigation.
