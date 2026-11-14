# Game store: plugging things in

For agents (and people) extending the game store. Read
[game-store-plan.md](game-store-plan.md) first for the whole design and its rules; this page is
the short version of **where things plug in** and what's already there.

## What works today

| Piece | Where | State |
|---|---|---|
| Store pages (front page, browse + filters, game page, requests) | `src/pages/GameStore*.tsx`, `GameRequestsPage.tsx` | Work against the real server |
| Settings → Server → Game store (on/off, sources, status) | `src/pages/settings/GameStoreAdmin.tsx` | Works |
| Catalogue + API (`/api/games/store/*`) | `server/src/gamestore/routes.ts`, `catalogue.ts`, `db.ts` | Works |
| Sources: feeds by address, feed files on disk | `server/src/gamestore/feed.ts`, [docs/game-store-feed.md](../game-store-feed.md) | Works |
| Downloads: magnets via the VPN's qBittorrent, https directly | `qbit.ts`, `direct.ts`, `wiring.ts` | Tested against a pretend qBittorrent only |
| Request pipeline (queued → … → ready / failed, restart-safe) | `pipeline.ts` | Works; stops after "checking" until there's an installer |
| Install engine (unpack → silent → auto-click → needs you, start check) | `install.ts`, `answers.ts`, `program.ts` | Tested against a pretend sandbox only |
| Sandbox (Docker), Windows host, window helper, play/stream | — | **Not built** (WS4, WS5, WS6 in the plan) |

## Adding a source of games

A source is anything that produces a **feed**: one JSON document in the format of
[docs/game-store-feed.md](../game-store-feed.md). Finesse itself knows nothing about any site.

The easy way to plug one in is a **feed file**:

1. Write a script (any language, run anywhere) that gathers the games and writes the feed JSON.
2. Put its output at `<config folder>/game-feeds/<name>.json` on the server (the config folder is
   where `finesse.json` lives; `/config` in the container).
3. Settings → Server → Game store → **Read them again** (or `POST /api/games/store/sync`). The
   source shows up with how many games it gave and which were left out and why.

Finesse re-reads the files twice a day, so a script on a timer keeps the store current. Deleting
the file removes its games. A feed hosted at an `https://` address works the same way and is added
in Settings.

What a feed entry needs to be usable: a title, and at least one download with `platform`,
`sizeBytes`, and a `magnet` or an `https` `url`. Add `checksums` whenever the source publishes
them: they're what lets Finesse say a download is genuine. Pictures must be `https`.

Rules (from the plan; they apply to sources too):

- Nothing in this repository points at a particular download site, and no code here is aimed at
  one release group's or repacker's tooling. A source's script lives outside the repo, with
  whoever runs the server.
- Tests and examples use only games that are free to share.

To add a source **type** in the server itself (rather than a script that writes a feed),
implement `Provider` (`server/src/gamestore/types.ts`): `list()` yields `{ game, sources }` and
`syncOnce` in `routes.ts` hands them to `db.replaceProvider(id, entries)`.

## Adding the installer (WS4 / WS5)

`server/src/gamestore/wiring.ts` builds the pipeline with a stand-in installer that says
"can't install yet". To make installs real, pass `plugPipeline(store, settings, { installer })`
an `Installer` (`pipeline.ts`):

```ts
install(r, folder, onStep)  // run install.ts's install({ runner, title, files, sniff, … })
finish(r)                   // finishAfterPerson(...) once someone completed "Needs you"
remove(r)                   // stop the sandbox, delete what was installed
```

and a `SandboxRunner` (`types.ts`) for the host: a container with `NetworkMode: none`, labelled
`finesse.managed=true` + `finesse.job=install` on Linux; Windows Sandbox on Windows. The engine's
tests (`server/test/gamestore-install.test.ts`) show exactly what a runner is asked and what it
must answer; the lab (`tools/installer-lab/`) has the real installers to prove it with.

## Checks

`npm run build && npm run server:typecheck && npm run server:test` (and `npm run build:webos`
for anything in `src/`). The game store's tests: `server/test/gamestore*.test.ts`.
