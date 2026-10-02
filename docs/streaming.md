# Game streaming: play Steam on your TV

[Wolf](https://games-on-whales.github.io/wolf/) runs Steam and other apps on your server and
streams them to [Moonlight](https://moonlight-stream.org) on TVs, phones, tablets and computers.
Everyone who plays gets their own session.

- **Games** shows what you can stream, and how to start playing.
- **Settings → Server → Game streaming** pairs new devices. Moonlight shows a PIN, and an
  administrator enters it in Finesse. No digging through Wolf's logs.

The games run on the server, on its graphics card. You play in Moonlight; Finesse doesn't stream
games itself.

There are two ways to set it up:

- **Finesse installed your apps (a full install)?** It sets Wolf up for you. See
  [Turn it on](#turn-it-on-full-installs). Needs Finesse 1.4 or newer.
- **You run Wolf yourself?** Connect it to Finesse. See [Connect your own Wolf](#connect-your-own-wolf).
  Needs Finesse 1.3 or newer.

Don't run both: two Wolfs on one machine fight over Moonlight's ports.

## Turn it on (full installs)

1. Open **Settings → Server → Game streaming**. Finesse looks at what the server has: a graphics
   card, virtual controllers and PlayStation controller support. Anything missing comes with the
   commands that fix it (see [Get the server ready](#get-the-server-ready)).
2. Press **Turn on game streaming**. Wolf is about 1 GB to download, so the first time takes a
   few minutes. Then **Games** has "Stream from your server".
3. [Add a device](#add-a-device).

From a terminal, or for an AI agent setting up the server:

```bash
docker exec finesse finesse streaming        # what this server has, and whether it's on
docker exec finesse finesse streaming on     # set Wolf up (waits until it's running)
docker exec finesse finesse streaming off    # remove Wolf's container; its folder stays
```

### Get the server ready

These live in the server's own system, so Finesse can't change them for you. Run the commands
on the server (not in a container), then press **check again**. If game streaming is already on,
turn it off and on again so Wolf gets the new devices.

| Part | What it does | How |
|---|---|---|
| **Intel or AMD graphics** | Runs and streams the games | Works as it is. |
| **Nvidia graphics** | Runs and streams the games | Install the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) 1.16 or newer and restart Docker. Then add `nvidia-drm.modeset=1` to `GRUB_CMDLINE_LINUX_DEFAULT` in `/etc/default/grub`, run `sudo update-grub` and restart the server. On TrueNAS, turn on **Install NVIDIA Drivers** in the Apps settings instead. |
| **Virtual controllers** | Controllers, mouse and keyboard in games | `sudo modprobe uinput`, and `echo uinput \| sudo tee -a /etc/modules-load.d/wolf.conf` to keep it after a restart. |
| **PlayStation controller extras** | DualSense touchpad and motion | `sudo modprobe uhid`, and `echo uhid \| sudo tee -a /etc/modules-load.d/wolf.conf`. |

Without a graphics card Wolf still starts, using the processor, but games are too slow to play.

**On TrueNAS,** changes to `/etc` can be lost when TrueNAS updates. Add `modprobe uinput && modprobe uhid`
as a **Post Init** command under **System → Advanced → Init/Shutdown Scripts** instead.

### What Finesse sets up

- **Wolf runs as `finesse-wolf`, on the server's own network,** because Moonlight connects
  straight to it (ports 47984, 47989 and 48010 over TCP, and 47999, 48100 and 48200 over UDP).
- **Its folder is `<Finesse's folder>/config/wolf`.** It holds Wolf's settings, paired devices,
  and each app's files. Steam's games are installed there too, so leave room for them.
- **Finesse keeps Wolf running and updates it** with the other apps.
- **Nightly backups keep Wolf's settings and paired devices,** not the games.
- **Turning it off** removes the container. The folder stays, so turning it on again brings back
  your devices and games.

## Connect your own Wolf

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
  devices, and only administrators can do the pairing. On a full install the socket stays inside
  Finesse's folder.

## Problems

| What you see | What to do |
|---|---|
| **No Games in the menu, or no Game streaming in Settings** | On a full install, turn it on under **Settings → Server → Game streaming**. With your own Wolf, Finesse doesn't know where its socket is: check `WOLF_SOCKET` in Finesse's settings, then restart it. |
| **"Finesse's folder is too deep for Wolf"** | A socket's path can be at most 107 characters, and Wolf's go in `<Finesse's folder>/config/wolf/run`. Move Finesse's folder to a shorter path, like `/srv/finesse`. |
| **"Wolf stopped right after starting"** | The message ends with Wolf's last log lines. Often another Wolf or Sunshine already uses Moonlight's ports: stop it first. |
| **Controllers don't work in games** | Virtual controllers are off. See [Get the server ready](#get-the-server-ready), then turn game streaming off and on. |
| **"Can't find Wolf's socket at …"** | The folder isn't shared with Finesse, or Wolf puts its socket somewhere else. Check that both apps have `/var/run/wolf` shared, and that Wolf has `WOLF_SOCKET_PATH` set. |
| **"Wolf isn't running"** | The socket is there but nothing answers. Start Wolf, or check its logs. |
| **The device never shows up to pair** | Moonlight has to be waiting on its PIN screen. Start pairing again in Moonlight. |
| **"Moonlight didn't finish pairing"** | Usually the PIN didn't match. Start pairing again in Moonlight and type the new PIN. |
| **A black screen the first time you start a game** | Wolf downloads the game's app the first time. Give it a few minutes. |
