# Finesse

A premium web client for Jellyfin. Dark, cinematic, and fast — built because the
stock web UI makes you click "next page" like it's 2009.

![stack](https://img.shields.io/badge/React%2019-TypeScript-6279cd) ![tailwind](https://img.shields.io/badge/Tailwind-v4-38bdf8)

## Features

- **True infinite scroll** — the entire library is one continuous virtualized grid.
  Drag the scrollbar from A to Z across thousands of titles; pages load on demand,
  nothing is ever paginated.
- **Alphabet jump rail** — phone-contacts-style A–Z rail on the right edge of
  library views (visible on screens ≥1024px wide, name sort only).
- **Cinematic home** — hero banner with logo art from recently added, Continue
  Watching, Next Up, and Recently Added rows with resume bars and watched badges.
- **Detail pages** — full-bleed backdrops, logo art, cast, season/episode browser
  with thumbnails and progress.
- **Playback with sync** — direct play for compatible files, HLS transcode for
  everything else, watch progress reported back to Jellyfin every 10 seconds so
  Continue Watching stays in sync with every other client.
- **Instant filter + global search** — type-to-filter within a library, or search
  movies/shows/episodes from the navbar.

## Run it

```
start.bat
```

or manually:

```
npm install
npm run dev
```

Then open http://localhost:5173 and sign in (server field is prefilled with the
LAN address).

## Stack

Vite · React 19 · TypeScript · Tailwind v4 · TanStack Query + Virtual · hls.js

## Architecture notes

- `src/api/client.ts` — fetch wrapper + all Jellyfin endpoints, token in
  localStorage, `Authorization: MediaBrowser` header scheme.
- `src/api/queries.ts` — TanStack Query hooks. The library grid uses a **sparse
  page cache**: the virtualizer reports the visible index range, and only the
  100-item pages covering that range are fetched (keyed by page index, cached
  5 min). A lightweight one-shot index (IDs + SortNames) provides total count
  and per-letter offsets for the jump rail.
- `src/pages/PlayerPage.tsx` — PlaybackInfo negotiation, hls.js attach, progress
  reporting, and transcode cleanup (`DELETE /Videos/ActiveEncodings`) on exit.
  HLS transcodes that start at a resume offset track `offsetTicks` so reported
  positions stay absolute.

## Known limitations (v1)

- Audio/subtitle track selection uses server defaults (no track picker yet).
- Seeking backward past a transcode's start point restarts at that offset's
  playlist rather than re-negotiating.
- Music/photo libraries are not surfaced in the nav.
