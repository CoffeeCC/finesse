# Finesse on Android, and in the car

**[Finesse for Android](https://github.com/CoffeeCC/finesse-android/releases/latest)** is Finesse as an
app. On the phone it's the same Finesse you use in the browser. In the car, **Android Auto** shows your
Finesse music next to Maps, with the car's own controls.

## Install

1. On your phone, download `finesse-android-v….apk` from the
   [latest release](https://github.com/CoffeeCC/finesse-android/releases/latest) and open it. Android
   asks to allow installing apps from your browser once; allow it.
2. Open **Finesse** and type your Finesse address, the one from **Settings → Other devices**, without
   `/finesse` at the end (for example `192.168.1.20:8080`). Then sign in as usual.

   For the car, use an address that works **away from home**: your phone is on mobile data there.
   That's your Tailscale address (keep Tailscale on, ideally as an always-on VPN) or your
   Cloudflare Tunnel / Tailscale Funnel address, set up under **Settings → Server → Downloads & away
   from home**.

To update, download the newer `.apk` and open it: it installs over the old one and you stay signed in.

## Android Auto

Android Auto only lists apps from the Play Store unless you allow others, once:

1. On the phone, open **Android Auto** settings (Settings → Connected devices → Android Auto, or
   search for it).
2. Scroll to the bottom and tap **Version** ten times, until it says developer settings are on.
3. ⋮ (top right) → **Developer settings** → turn on **Unknown sources**.
4. Back in Android Auto settings, **Customize launcher**: make sure **Finesse** is ticked.
5. Connect to the car (reconnect if it was already connected).

In the car, Finesse has Recently added, Albums, Artists, Favourites, Genres, Playlists and search,
with album art. Next to Maps it shows what's playing, with play/pause and skip, and the steering-wheel
buttons work.

**Start where you left off.** Turn on **Start music automatically** in Android Auto settings: when you
connect, Finesse carries on with what you last played in the car.

## Good to know

- **Android only.** iPhones use CarPlay, which this app doesn't do.
- **Music you start in the car is what the car remembers.** Music played on the phone in Finesse
  itself plays in its own player, so the car doesn't pick that up.
- **https with Finesse's own certificate doesn't connect.** The app refuses certificates it can't
  check. Plain `http://` at home, Tailscale and Cloudflare addresses work.
- **Friends' music (Groups) isn't in the car**, only the server you signed in to.
- **Video in the car** isn't available: Android Auto only lists that kind of app when it's installed
  from Google Play.

The app is built from [Jellyfin for Android](https://github.com/jellyfin/jellyfin-android) (GPL-2.0);
its code is at [CoffeeCC/finesse-android](https://github.com/CoffeeCC/finesse-android).
