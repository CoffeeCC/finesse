# Installer lab

Worst-case Windows installers we build ourselves, plus a stand-in game, for testing the game
store's install engine. See [docs/agents/game-store-plan.md](../../docs/agents/game-store-plan.md).
Nothing here is a real game; nothing binary is committed. WS8 is what builds these cases in CI
and fails the build when an outcome changes.

## The sandbox

`docker/installer/` is the image a request installs in (`ghcr.io/coffeecc/finesse-installer`,
version in `docker/installer/VERSION`, pinned in `server/src/stack/catalog.ts`). CI builds it on
every pull request. A release pushes that version tag. The catalog pins the tag; pinning the
digest is a release decision. `FINESSE_INSTALLER_IMAGE` points a server at a local build.

`run-sandbox.ts` puts each case through the same code a request uses (`DockerInstaller` in
`server/src/gamestore/sandbox.ts`, and the engine in `install.ts`), inside that image, with no
network. It prints what happened against what the lab expects and exits 1 when an expected
outcome changes.

```bash
node tools/installer-lab/run-sandbox.ts <folder>... [--image finesse-installer:dev] [--data <dir>] [--only 01,06]
```

`<folder>` is one case per subfolder (the built installers, or a free game with its checksum).
`<dir>` is where the installs go; it has to be the same path Docker sees, and it is emptied
first. The dev NAS has no Node of its own, so the runner is the `node:22` image with the Docker
socket mounted, `LAB_UID` and `LAB_GID` set to the server's user.

## What's in here

- `src/game.c`, `src/redist.c`: the stand-in game (opens a window, or exits 1/2/3 when broken or
  missing its data or runtime) and a stand-in runtime installer. `build-programs.sh` builds them
  with mingw-w64.
- `iss/`: the Inno Setup sources for cases 01–08 (plain, split `.bin` files, heaviest
  compression, required pages, refuses silent, bundled runtime, needs internet, broken game).
  `make-payloads.sh` makes their test data; `compile-installers.sh` builds them with Inno
  Setup's compiler under Wine.
- `src/run-pipeline.sh`: the earlier unpack-and-silent pass. `src/plan.ts` + `src/auto-install.sh`:
  the hands-off prototype used before the engine lived in the server.
- `prototype/`: the image those scripts used, and `try-install.sh`. The server doesn't use them.
- `results-*.txt`, `real-results.txt`: the outcomes the plan's findings come from. They are not
  committed; `run-sandbox.ts` keeps the expected outcomes itself.
