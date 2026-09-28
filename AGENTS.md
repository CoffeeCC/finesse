# AGENTS.md

Guidance for AI coding agents (and humans) working **on** Finesse.

> Asked to **install** Finesse on a machine instead? Follow
> [docs/agents/INSTALL.md](docs/agents/INSTALL.md).

## What this is

Finesse is a self-hosted streaming service. It has two halves.

- **The app** (`src/`): React 19, TypeScript, Vite, Tailwind v4. It talks to Jellyfin for media
  and to the Finesse server for everything else. There are two builds:
  - **web**: served by the Finesse server under `/finesse/`;
  - **webOS TV app**: `npm run build:webos`, runs from `file://` on LG TVs.
- **The server** (`server/`): Node 22 + TypeScript with **zero runtime dependencies**. It uses
  `node:http`, `node:sqlite`, and the Docker Engine API over the unix socket. It:
  - serves the app;
  - proxies Jellyfin at `/jellyfin` and the *arr/SAB APIs, injecting their keys;
  - runs invites and updates;
  - installs, wires and maintains the whole stack (Jellyfin, Sonarr, Radarr, Lidarr, Prowlarr,
    SABnzbd, Gluetun + qBittorrent, Tailscale / Cloudflare Tunnel).

  It ships as one Docker image (`Dockerfile`, `ghcr.io/coffeecc/finesse`).

Read [ROADMAP.md](ROADMAP.md) for the architecture, its principles and why things are the way
they are.

## Commands

```bash
npm ci
npm run dev                 # app on http://localhost:5173/finesse/ (FINESSE_SERVER=http://localhost:8080 in .env.local proxies a real server)
npm run build               # typecheck + web build → dist/
npm run build:webos         # TV build → dist-webos/ (then npm run package:webos for the .ipk / OTA bundle)
npm run server:typecheck    # tsc -p server
npm run server:test         # node --test server/test/*.test.ts (fakes for Jellyfin, GitHub, SMTP; no Docker needed)
npm run server:build        # esbuild → server/dist/finesse-server.mjs + finesse.mjs (CLI)
docker build -t finesse:dev .                            # full image
docker build --target prebuilt -t finesse:dev .          # image from your local dist/ + server/dist/ (fast)
```

Before you push, run: `npm run build && npm run server:typecheck && npm run server:test`. CI
runs the same, plus the TV build.

## Layout

| Path | What |
|---|---|
| `src/api/` | Clients: `client.ts` (Jellyfin), `arr.ts`, `sab.ts`, `invite.ts`, `setup.ts` (setup + system APIs) |
| `src/lib/finesseServer.ts` | Discovery (`/api/finesse`): bundled Jellyfin, setup state, features, public URL |
| `src/lib/contentOrigin.ts` | The Finesse server's base URL (web: `/finesse/`; TV: the address the person connected to) |
| `src/lib/spatialNav.ts` | D-pad navigation for TVs |
| `src/pages/setup/` | The setup wizard |
| `src/pages/settings/SystemPanel.tsx` | Settings → Server (health, backups, updates, email) |
| `server/src/app.ts` | Assembles the HTTP server; `main.ts` starts it with the setup + system plugins |
| `server/src/services.ts` | `/arr/*`, `/games/*`, `/jellyfin` proxies |
| `server/src/invites.ts`, `update.ts`, `email.ts` | Invites, web/app updates, SMTP |
| `server/src/groups.ts`, `src/lib/peers.ts` | Groups: pairing, the friend proxies and their allow-list; the app's routing of friends' titles (`f-<friend>-<id>` ids) |
| `server/src/stack/` | `catalog.ts` (pinned images), `orchestrator.ts`, `seed.ts` (pre-seeded configs), `wire.ts` (API wiring), `maintain.ts` (health/repair/nightly backups), `backup.ts` (backup parts + restore), `libraries.ts` (first files into an empty Jellyfin library), `games.ts`, `selfupdate.ts` |
| `server/src/setup/` | `doc.ts` (setup document + validator), `apply.ts` (the stepped runner), `checks.ts` (live checks), `routes.ts` |
| `server/cli/finesse.ts` | The `finesse` CLI inside the container |
| `setup.schema.json` | Public schema of the setup document. **Keep it in sync with `server/src/setup/doc.ts`.** `server/test/setup.test.ts` enforces this. |
| `webos/` | TV packaging and the CSS down-leveller for Chromium 68 |
| `deploy/` | Pre-1.0 nginx + Python invite-service deployment (legacy; kept for existing installs) |
| `tools/tour/` | The video tour: a demo server, scene scripts, narration, and the film + episodes. Adding a feature? Add its scene ([tools/tour/README.md](tools/tour/README.md)). |

## Rules that matter here

- **The server has no npm dependencies.** Use Node built-ins. Tests run with Node's type
  stripping (`node --test *.ts`), so use `.ts` import extensions and no TS-only runtime syntax
  (no enums, no parameter properties).
- **The LG CX runs Chromium 68.** Vite lowers modern JavaScript for the TV build, but not CSS.
  Don't use CSS features Chromium 68 lacks unless `webos/downlevel-css.mjs` rewrites them.
  Use `--vh`/`--vw`, not raw `vh`/`vw`, because the TV zooms the UI. Test TV changes with
  `npm run build:webos`.
- **Secrets never reach the browser.** The server adds API keys to proxied requests. Never
  send a key in a response, and never log one (`logger` callers log names, not values).
- **Stack changes must be idempotent.**
  - `ensureService` recreates a container only when its spec hash changes.
  - Wiring uses `Arr.upsert`.
  - Seeds never overwrite existing config files.

  Re-running setup must change nothing.
- **Only touch containers labelled `finesse.managed=true`.**
- **Pinned images live in `server/src/stack/catalog.ts`.** Bumping one is a release decision:
  the maintainer applies new pins on existing installs, overnight or via **Update now**. Test
  the whole flow first (below).
- **Words.** UI copy is plain, friendly and specific ("Can't find news.example.com — check the
  server address", not "ENOTFOUND"). Errors say what to do next.

## Testing the real stack

You need Docker. Build the image, then run it the way the installer does:

```bash
docker build --target prebuilt -t finesse:dev .
./install.sh --yes --image finesse:dev --root /tmp/f/root --data /tmp/f/data
docker exec -i finesse finesse setup apply - < examples/setup/minimal.json    # or a fuller one
docker exec finesse finesse doctor
```

To test the UI, open `http://localhost:8080/finesse/setup` on a fresh root folder. Use
`./install.sh --uninstall` to remove the containers; your folders are kept.

## Releasing

1. Bump `version` in `package.json`.
2. Add a `## … — vX.Y.Z (date)` section to `TODO.md`; it becomes the release notes.
3. Merge to `master`.

`.github/workflows/release.yml` tests, publishes the GitHub Release (web tarball + TV bundle)
and pushes the multi-arch image. Installs update from the in-app button.
