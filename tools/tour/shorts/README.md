# Shorts captures

Playwright scripts that record real Finesse UI on the demo server for vertical Shorts. They use the tour stage (`../lib.mjs`) at 860x880 CSS px and 2x DPR.

| Script | Take |
|---|---|
| `cap-home.mjs` | Home, then Customize Home: add a genre, move it up, hide a row |
| `cap-req-a.mjs` | Request page: search a title and tap Request |
| `cap-req-b.mjs` | Request page Downloads panel, real time (K=1) |
| `cap-req-c.mjs` | Home, Recently added, then the item page (Play is never pressed) |
| `reset.mjs` | Resets Customize Home between takes |

Run each script from this folder, for example `TOUR_SLOWMO=6 node cap-req-a.mjs`. Frames and `marks.json` go to `$SHORTS_OUT/<take>` (the default is `shorts-out/`). Then build a page-time video with `./tovid.sh <take dir> <K>`.

**Staged data in `cap-req-b.mjs`.** The demo's indexer can't deliver a real file, so this script mocks the Radarr queue and downloader status responses. The real UI renders the mocked progress over about 60 s. After that, `SHORTS_PLACE_CMD` runs a command that really imports a placeholder file into the demo Radarr. Say so wherever this footage is published.

Trailers are blocked at the network level (`common.mjs`). Posters only.
