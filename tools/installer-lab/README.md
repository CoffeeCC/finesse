# Installer lab

Worst-case Windows installers we build ourselves, plus a stand-in game, for testing the game
store's install engine. See [docs/agents/game-store-plan.md](../../docs/agents/game-store-plan.md)
(WS8 turns this into a CI job). Nothing here is a real game; nothing binary is committed.

- `src/game.c`, `src/redist.c`: the stand-in game (opens a window, or exits 1/2/3 when broken or
  missing its data or runtime) and a stand-in runtime installer. `build-programs.sh` builds them
  with mingw-w64.
- `iss/`: the Inno Setup sources for cases 01–08 (plain, split `.bin` files, heaviest
  compression, required pages, refuses silent, bundled runtime, needs internet, broken game).
  `make-payloads.sh` makes their test data; `compile-installers.sh` builds them with Inno
  Setup's compiler under Wine.
- `src/run-pipeline.sh`: puts each built installer through unpack and silent install, then starts
  the game. `src/plan.ts` + `src/auto-install.sh`: the hands-off prototype used on real games.
- `prototype/`: the sandbox image used for these runs, and `try-install.sh` (one command for a
  download folder). Paths in the scripts are the dev NAS's (`/e` = the lab folder); WS8 makes
  them repo-relative.
- `results-*.txt`, `real-results.txt`: the outcomes the plan's findings come from.
