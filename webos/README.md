# Finesse for LG webOS TV

Sideloadable webOS build of Finesse, with an in-app **Check for updates** button
that pulls new versions from GitHub Releases — no PC reinstall needed for content
updates.

## How it works

A webOS app is just a web app in an `.ipk` package. The twist here is updates: a
sideloaded app can't install a new `.ipk` on itself, **but it can swap its own web
bundle**. So:

- The whole app is built into one bundle of `{ version, css, js }`.
- The `.ipk` ships that bundle baked in (`baked.js`) as a safe fallback.
- On launch, `boot.js` checks IndexedDB for a newer bundle staged by the updater
  and mounts whichever version is higher (injecting `<style>`/`<script>` as live
  DOM elements, which reliably execute).
- **Check for updates** (Settings, TV build only) asks the GitHub Releases API for
  the latest version, downloads its `finesse-webos-<v>.json` asset, stashes it in
  IndexedDB, and restarts — now running the new version.

The native shell (icon, bootstrap, `appinfo.json`) rarely changes; when it does,
you reinstall the `.ipk` from the PC with `install-webos.bat`.

### What "offline-capable" does and doesn't mean

The **app UI** loads without the NAS serving it (faster cold start, survives an
nginx/Funnel hiccup). But login, artwork, metadata and video **still require the
Jellyfin server reachable** — bundling doesn't make playback work offline.

## First-time setup (once per PC)

1. **LG developer account** — sign up free at https://webostv.developer.lge.com and
   sign in to it on the TV.
2. **Enable Developer Mode on the TV** — install the **Developer Mode** app from the
   LG Content Store, open it, sign in, toggle **Dev Mode Status → ON**, and note the
   **IP address** + **passphrase** (a.k.a. "key server" passphrase). The TV reboots.
   > Heads-up: the dev session lasts 1000 hours, and **when it expires LG removes the
   > apps installed with it**. Re-open the Developer Mode app and press **Extend**
   > about once a month (or let webOS Dev Manager extend it). See
   > [docs/tv.md](../docs/tv.md) for the person-friendly install guide.
3. **Install the LG CLI** on this PC:
   ```
   npm i -g @webos-tools/cli
   ```
4. **Pair the TV:**
   ```
   webos\setup-tv.bat 192.168.1.50      REM use your TV's IP
   ```

## Install / update the app

```
webos\install-webos.bat
```
This builds the package and installs+launches it on the TV. Re-run it whenever you
change the **native shell**. For everyday **content** updates you don't need this —
just publish a release (below) and hit **Check for updates** on the TV.

## Cutting a release (enables the in-app updater)

**Automated since 0.12:** merging a version bump to `master` publishes the release with this asset
(`.github/workflows/release.yml`), and TVs offer an **Update** button in the top bar — see
[`../deploy/README.md`](../deploy/README.md). The manual steps below still work.

The updater pulls from `GITHUB_REPO` in
[`../src/lib/webosUpdate.ts`](../src/lib/webosUpdate.ts) — already set to
`CoffeeCC/finesse`.

**Each release:**

1. Bump `version` in `package.json`.
2. `npm run package:webos`
3. Create a GitHub Release whose tag is the version (e.g. `v0.2.0`) and **attach
   `webos/release/finesse-webos-<version>.json`** as an asset.
4. On the TV: **Settings → App updates → Check for updates → Download & install →
   Restart**.

## Files

| File | Role |
|------|------|
| `bootstrap/appinfo.json` | webOS app manifest (id `com.finesse.tv`) |
| `bootstrap/index.html` + `boot.js` | launch shell: picks newest bundle, mounts it |
| `bootstrap/icon.png`, `largeIcon.png` | launcher icons (regenerate: `node webos/gen-icons.mjs`) |
| `build-webos.mjs` | `npm run package:webos` — builds bundle, stages `.ipk`, emits OTA asset |
| `setup-tv.bat` | one-time TV pairing |
| `install-webos.bat` | build + install + launch on the TV |
| `release/finesse-webos-<v>.json` | the OTA bundle asset to attach to a GitHub Release |

## Troubleshooting

- **Back button goes back twice / doesn't exit at Home** — v0.9.0 switched `appinfo.json`
  to `disableBackHistoryAPI: true` so the app owns the remote's Back key (overlays close
  first, Back at Home exits). `appinfo.json` is part of the native shell, so **reinstall the
  .ipk once** with `install-webos.bat`; OTA updates can't change it. Older installs still
  work — the app detects the system's own history.back() and won't double-navigate.

- **`ares-*` not recognized** — the LG CLI isn't installed: `npm i -g @webos-tools/cli`.
- **Install fails / "dev mode session expired"** — re-extend in the TV's Developer
  Mode app, then retry.
- **Updater says "GitHub responded 404"** — `GITHUB_REPO` is unset or the repo/release
  doesn't exist yet.
- **App can't reach your server** — on first launch the app asks for your Finesse server's
  address (e.g. `192.168.1.50:8080`). To change it later: **Settings → Account → Finesse server →
  Change** (or clear `localStorage['finesse.contentOrigin']`).
