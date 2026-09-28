# The video tour

Everything that makes Finesse's video tour: a demo server full of free films,
music and games; scripts that drive the real app like a person would; a
narrator; and the tools that turn the recordings into the film
(`docs/media/finesse-tour.mp4`) and into short episodes you can post one at a
time.

When you add a feature, you add a scene here and re-record. Nothing is edited by
hand, so the video always matches the app.

## What you need

- Linux with **Docker**, **Node 22**, **Python 3** and `curl`.
- **Google Chrome** (not Chromium: it has to play H.264 video). It's found at
  `/opt/google/chrome/chrome` or `/usr/bin/google-chrome`, or set `TOUR_CHROME`.
- About **15 GB** free. A desktop take is roughly 35,000 frames.
- An **ElevenLabs API key** for the narration, music and sound effects. Without
  one you can still record and check scenes (`TOUR_VO=0`), just silently.

```bash
cd tools/tour
npm install          # Playwright, for driving the browser
```

Work files go in `~/.cache/finesse-tour` (set `TOUR_WORK` to change it): the
demo server's folders, the takes, the voice cache, the film and the episodes.

## 1. Build the demo server (once)

```bash
sh demo/build.sh
```

It takes 20–30 minutes the first time. It downloads three Blender Foundation
films, builds a music library, fetches eight homebrew games, starts two Finesse
servers built from your working copy, sets up the demo one from
`demo/setup.json`, and fills in a household: four profiles, history, resume
points and My List.

- **`http://localhost:8080/finesse`** is the demo. Sign in as **alex /
  FinesseDemo2026**.
- **`http://localhost:8091/finesse`** is a fresh server for the setup-page
  scenes.

After changing the app, run `sh demo/up.sh`. It rebuilds the image and restarts
both servers, and your demo library stays.

> **Behind a proxy?** If this machine reaches the internet through a proxy on
> `127.0.0.1`, the demo's apps can't use it (the Request scene needs internet).
> Run `node demo/proxy-bridge.mjs`, then pass the demo network's gateway:
> `TOUR_APP_PROXY=http://$(docker network inspect finesse -f '{{(index .IPAM.Config 0).Gateway}}'):36008 sh demo/up.sh`.
> If the proxy inspects TLS, add `TOUR_APP_CA_BUNDLE=/path/to/its-ca.crt`.

## 2. Make the voice

```bash
ELEVENLABS_API_KEY=… node vo.mjs all
```

This voices every line in `narration.json` (one per caption, keyed by the
caption's title) and makes the interface sounds and the music bed. Everything is
cached: re-running it only pays for lines you added or changed. The whole tour
is about 5,000 credits. The key is only read from the environment, so never
save it in a file in the repo.

## 3. Record

```bash
sh record.sh
```

This takes about an hour. It records the desktop, phone and TV takes (resetting
the household before each), then makes:

| Output (in `~/.cache/finesse-tour`) | What |
|---|---|
| `film/finesse-tour.mp4` | The film: 1080p, chapters embedded (plus a 720p copy) |
| `film/tour-poster.jpg`, `film/chapters.md` | The README poster, and the chapter list for the README |
| `episodes/finesse-NN-*.mp4` | One episode per topic, each with a title card and a "Get Finesse" ending. `EPISODES.md` lists them. |

A finished take is kept. To record one again, delete it (`takes/desktop`,
`takes/phone` or `takes/tv`). To re-cut the film and episodes without recording,
run `sh record.sh film`.

Then copy `film/finesse-tour.mp4` and `film/tour-poster.jpg` into `docs/media/`,
and paste `film/chapters.md` into the README's tour section. Don't commit the
episodes: attach them to the GitHub release, or post them wherever you share
Finesse.

## Adding a feature to the tour

1. **Write the scene.** Scenes live in `tour.mjs` (desktop), `phone.mjs` and
   `tv.mjs`. Each is an `await scene('name', async () => { … })` block. Use the
   director, `d`:

   ```js
   await scene('lists', async () => {
     await page.goto(`${APP}/lists`)
     await d.caption('Shared lists', 'Make a list with the whole household.')   // caption + its narration
     await d.click(by('button', 'New list'), { after: 1200 })                  // visible cursor, click sound
     await d.type('Movie night')
     await sleep(2500)                                                          // always sleep(), never setTimeout
     await d.clear()                                                            // waits for the voice, then hides the caption
   })
   ```

   Scenes should leave the household as they found it, or `demo/seed.py` should
   reset what they change.
2. **Write its narration.** Add a line to `narration.json` under the caption's
   exact title. Aim for one or two short sentences per caption.
3. **Name the chapter and the episode.** Add the scene to `NAMES` in
   `compose.mjs`, and add an episode to `EPISODES` in `episodes.mjs` (or extend
   an existing one).
4. **Check it.**

   ```bash
   node tour.mjs /tmp/check --dry --only=lists          # a screenshot at every caption
   ELEVENLABS_API_KEY=… node vo.mjs voices              # voices the new line
   TOUR_SLOWMO=6 node tour.mjs /tmp/lists --only=lists  # record just this scene
   node sample.mjs /tmp/lists /tmp/lists/sample.mp4 6   # …and watch it, narrated
   ```

   `--only` starts from a blank page, so if the scene expects the previous one's
   page, list both (`--only=music,lists`).
5. **Re-record.** Delete `takes/desktop` (or phone/TV) and run
   `sh record.sh`.

If the scene shows new media, credit it in `docs/media/CREDITS.md`.

## How the smooth capture works

The browser can't screenshot fast enough for smooth video, so the tour is
recorded in **slow motion** (`TOUR_SLOWMO=6`), then sped back up.
- **Slowed six times:** the page's clocks, timers, animations and video.
- **Game emulator:** it counts frames instead of reading the clock, so the games
  scene paces it with `window.__tourGameClock`.
- **The script's pauses:** `sleep(ms)` is slowed too.
- **The result:** about 60 frames a second.

Two things to remember:

- Playwright timeouts are real time, so multiply them by `K` when waiting on the
  app.
- Anything that measures time in the browser sees slow time, which is the point.

## Files

| File | What |
|---|---|
| `config.mjs` | Paths and addresses (all overridable: `TOUR_WORK`, `TOUR_DEMO`, `TOUR_APP`, `TOUR_WIZ`, `TOUR_CHROME`) |
| `lib.mjs` | Browser, slow motion, cursor, captions, cards, sounds, screencast recorder |
| `tour.mjs`, `phone.mjs`, `tv.mjs` | The scenes |
| `narration.json` | What the narrator says, keyed by caption title |
| `vo.mjs` | ElevenLabs: narration, sound effects, music |
| `compose.mjs` | Takes → the film, with the audio mix and chapters |
| `episodes.mjs` | The film → episodes |
| `poster.mjs`, `chapters-md.mjs`, `screens.mjs` | README poster, chapter list and screenshots |
| `sample.mjs` | A quick narrated preview of a single take |
| `record.sh` | All of the above, in order |
| `assets/tobu-title.state.b64` | Save state for the games scene (Tobu Tobu Girl's title screen) |
| `demo/` | The demo server: `build.sh`, `up.sh`, `seed.py` (reset the household), `setup.json`, library, music and games builders, a fake indexer, `api.sh` |
