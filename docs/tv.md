# Watch on your TV

Finesse works on TVs in three ways. Pick the first one that fits your TV.

| TV | Best option |
|---|---|
| **LG** (webOS, 2018 or newer) | [The Finesse TV app](#lg-tvs-the-finesse-app). It's built for the remote and updates itself. |
| **Samsung, Android TV / Google TV, Fire TV** | [The TV's web browser](#any-tv-with-a-web-browser), or a [Jellyfin app](#jellyfin-apps). |
| **Apple TV, Roku, game consoles** | A [Jellyfin app](#jellyfin-apps). |

Whichever you use, everyone's watch history, My List and "Up next" stay the same everywhere.

---

## LG TVs: the Finesse app

LG doesn't list self-hosted apps in its store, so you install Finesse with LG's free
**Developer Mode**. It takes about ten minutes, once. After that, the app updates itself from
inside the TV.

Tested on an LG CX (2020, webOS 5). Other LG TVs from 2018 onwards should work.

### 1. Turn on Developer Mode on the TV

1. Create a free account at [webostv.developer.lge.com](https://webostv.developer.lge.com)
   (**Sign in → Create account**).
2. On the TV, open the **LG Content Store**, search for **Developer Mode** and install it.
3. Open **Developer Mode**, sign in with that account and switch **Dev Mode Status** on. The TV
   restarts.
4. Open **Developer Mode** again. Switch **Key Server** on and note the TV's **IP address**.

### 2. Install the app

Download `com.finesse.tv_<version>_all.ipk` from the
[latest release](https://github.com/CoffeeCC/finesse/releases/latest). Then use one of these:

- **webOS Dev Manager** (easiest, with buttons). Install
  [Dev Manager](https://github.com/webosbrew/dev-manager-desktop/releases/latest) on your
  computer (Windows, macOS or Linux). Press **Add device**, enter the TV's IP address, and paste
  the passphrase from the Developer Mode app. Then open **Apps → Install** and pick the `.ipk`.
- **Command line.** Run `npm i -g @webos-tools/cli`, pair once with
  `ares-setup-device` (use the TV's IP, port 9922, user `prisoner`), fetch the key with
  `ares-novacom --device tv --getkey` and the passphrase, then run
  `ares-install --device tv com.finesse.tv_<version>_all.ipk`. On Windows,
  `webos\setup-tv.bat` and `webos\install-webos.bat` in this repository do all of this for you.

### 3. Connect it to your server

Open **Finesse** from the TV's app list. It asks for your server's address. Enter the address of
the machine running Finesse, with its port, for example `192.168.1.50:8080`. Then pick who's
watching.

### Keep Developer Mode alive

LG's Developer Mode lasts **1000 hours** (about six weeks). **When it runs out, LG removes the
apps installed with it**, so renew it before then:

- open **Developer Mode** on the TV and press **Extend**, about once a month; or
- let **Dev Manager** extend it for you whenever it's connected; or
- if your TV is rooted with the [Homebrew Channel](https://www.webosbrew.org), install the `.ipk`
  from there instead, and there's nothing to renew.

If the app does get removed, repeat step 2. Your account and history are on the server, so
nothing is lost.

### Updates

When a new Finesse is out, the TV shows **Update** in the top bar. Press it, and the app
downloads the new version and restarts. You don't need your computer again unless a release
says the `.ipk` itself changed.

### Using it

- **Arrows** move, **OK** selects, **Back** goes back.
- On Home, the big picture at the top follows whatever you're on.
- In the player, **Left** and **Right** skip 10 seconds. Hold them to skip further, faster.
  **OK** pauses. **Up** or **Down** shows the controls, including audio and subtitles.

---

## Any TV with a web browser

Samsung (Tizen), Android TV, Google TV and Fire TV browsers all work. Open:

```
http://<your server>:8080/finesse/
```

Finesse spots that it's on a TV and switches to remote control mode: big focus rings, the
D-pad moves between things, and nothing depends on hovering. Bookmark the page, or add it to
the TV's home screen if the browser allows it.

Some TV browsers can't play every video format. If a film won't start, try a Jellyfin app.

## Jellyfin apps

Finesse streams through Jellyfin, so every official
[Jellyfin app](https://jellyfin.org/downloads) works too. That includes Apple TV (Swiftfin),
Roku, Android TV, Fire TV, Xbox and PlayStation. Sign in with your Finesse username and
password.

- **Server address:** `http://<your server>:8096`. The setup-complete page, and
  **Settings → Server**, show the exact port.
- **Away from home:** use the same address you use for Finesse outside the home (for example
  your Tailscale or Cloudflare address), ending in `/jellyfin`.

Jellyfin apps look like Jellyfin, not Finesse. Requests, invites and Finesse's extras aren't
available in them, but your watch history and progress are shared.
