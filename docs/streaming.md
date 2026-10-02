# Game streaming: play Steam on your TV

[Wolf](https://games-on-whales.github.io/wolf/) runs Steam and other apps on your server and
streams them to [Moonlight](https://moonlight-stream.org) on TVs, phones, tablets and computers.
Finesse works with the Wolf you run:

- **Games** shows what you can stream, and how to start playing.
- **Settings → Server → Game streaming** pairs new devices. Moonlight shows a PIN, and an
  administrator enters it in Finesse. No digging through Wolf's logs.

The games run on the server, on its graphics card. You play in Moonlight; Finesse doesn't stream
games itself.

## What you need

- **Wolf running on the same machine as Finesse,** with its graphics card set up. Follow
  [Wolf's quickstart](https://games-on-whales.github.io/wolf/stable/user/quickstart.html).
- **Finesse 1.3 or newer.**

## Connect Wolf to Finesse

Finesse talks to Wolf through Wolf's API socket, a file in a folder both can see.

1. **Wolf:** put its API socket in a shared folder. Add to Wolf's settings (its compose file or
   TrueNAS YAML):

   ```yaml
       environment:
         WOLF_SOCKET_PATH: /var/run/wolf/wolf.sock
       volumes:
         - /var/run/wolf:/var/run/wolf
   ```

2. **Finesse:** share the same folder, and say where the socket is:

   ```yaml
       environment:
         WOLF_SOCKET: /var/run/wolf/wolf.sock
       volumes:
         - /var/run/wolf:/var/run/wolf
   ```

   Share the folder, not the socket file itself. Wolf makes a new socket every time it starts, and
   a shared file would keep pointing at the old one.

3. **Restart both.** **Games** now has "Stream from your server", and **Settings → Server** has
   **Game streaming**.

## Add a device

1. **Get Moonlight** for the device from [moonlight-stream.org](https://moonlight-stream.org).
   On an LG TV, use the community [Moonlight TV](https://github.com/mariotaku/moonlight-tv) app.
2. **Open it and pick your server.** At home it usually finds it by itself. If it doesn't, add
   the server's address.
3. **Moonlight shows a 4-digit PIN.** In Finesse, open **Settings → Server → Game streaming**.
   Within a few seconds the device appears there. Give it a name ("Living room TV"), type the
   PIN and press **Pair**.
4. **Pick a game in Moonlight** and play.

To remove a device, press **Remove** next to it under **Paired devices**. It has to pair again to
stream.

## Good to know

- **It's for your home network.** Moonlight connects straight to the server, so it works best at
  home. Over a VPN like Tailscale it can work too, with more delay.
- **How many people can play at once depends on your graphics card.**
- **Groups never shares game streaming.** Friends who watch your libraries can't stream your
  games.
- **Keep Wolf's socket folder between Wolf and Finesse.** Wolf's API has no password, and it can
  do much more than pair devices. Finesse only uses it to list apps and to pair and remove
  devices, and only administrators can do the pairing.

## Problems

| What you see | What to do |
|---|---|
| **No Games in the menu, or no Game streaming in Settings** | Finesse doesn't know where Wolf's socket is. Check `WOLF_SOCKET` in Finesse's settings, then restart it. |
| **"Can't find Wolf's socket at …"** | The folder isn't shared with Finesse, or Wolf puts its socket somewhere else. Check that both apps have `/var/run/wolf` shared, and that Wolf has `WOLF_SOCKET_PATH` set. |
| **"Wolf isn't running"** | The socket is there but nothing answers. Start Wolf, or check its logs. |
| **The device never shows up to pair** | Moonlight has to be waiting on its PIN screen. Start pairing again in Moonlight. |
| **"Moonlight didn't finish pairing"** | Usually the PIN didn't match. Start pairing again in Moonlight and type the new PIN. |
| **A black screen the first time you start a game** | Wolf downloads the game's app the first time. Give it a few minutes. |
