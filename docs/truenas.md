# Finesse on TrueNAS SCALE

Finesse installs from TrueNAS's **Apps** page, so it's listed with your other apps: start, stop,
logs, a shell and updates all work from there.

You need TrueNAS SCALE **24.10 (Electric Eel) or newer**, with Apps switched on (Apps →
Configuration → Choose Pool).

Pick the way that fits:

- **You already run Jellyfin** (and maybe Sonarr, Radarr, SABnzbd…): Finesse sits in front of
  them. Your apps, libraries, users and watch history stay as they are. → [A](#a-in-front-of-the-apps-you-already-run)
- **Starting fresh:** Finesse sets up Jellyfin, the download apps and a VPN for you, and looks
  after them. → [B](#b-a-full-install)

## A. In front of the apps you already run

1. **Make a dataset for Finesse's settings**, e.g. `apps/finesse` on your pool (Datasets → Add
   Dataset). Its settings, invites and backups live there.
2. **Collect the keys** Finesse needs:
   - Jellyfin: Dashboard → API Keys → **+**, name it "Finesse".
   - Radarr, Sonarr, Lidarr: Settings → General → API Key.
   - SABnzbd: Config → General → API Key.
3. **Install it:** Apps → Discover Apps → **⋮** (top right) → **Install via YAML**.
   - Name: `finesse`.
   - Paste [`examples/truenas/finesse-adopt.yaml`](../examples/truenas/finesse-adopt.yaml).
   - Change the marked lines: the port, your dataset's path and your time zone.
   - Paste the keys. Check each app's port matches yours, and delete the lines for apps you
     don't run.
   - Save.
4. Open `http://<your NAS>:30500/finesse/` and sign in with your Jellyfin account.

The addresses use `host.docker.internal`, which always means "this NAS", so they keep working
when your router gives the NAS a new address. If an app runs on a different machine, use that
machine's address instead. If your Jellyfin has a *Base URL* set, add
`JELLYFIN_BASE_PATH: /that-path`.

**Coming from Finesse before 1.0** (nginx and the Python invite service): stop both first (see
[the steps](adopt.md#moving-from-the-old-nginx--invite-service-deployment--013)). Use the port
nginx used (30500 in the YAML), so bookmarks, TVs and invite links keep working. Keep your
invites by adding one more line under `volumes:`, pointing at your old `invites.db`:

```yaml
      - /mnt/POOL/path/to/invite-service/invites.db:/config/invites.db
```

Everything else is in [Use your existing setup](adopt.md).

## B. A full install

1. **Make two datasets:**
   - `finesse` for every app's settings. An SSD pool is best.
   - `media` for movies, shows, music and downloads, on your biggest pool.

   Give TrueNAS's **apps** user permission to change both (dataset → Permissions → Edit → add
   user `apps` with Modify, or pick the *Apps* preset).
2. **Install it:** Apps → Discover Apps → **⋮** → **Install via YAML**.
   - Name: `finesse`.
   - Paste [`examples/truenas/finesse-full.yaml`](../examples/truenas/finesse-full.yaml).
   - Put your two dataset paths in. Each appears twice on purpose: Finesse gives the same
     folders to the apps it creates.
   - Set your time zone, then save.
3. **Get the setup code:** Apps → finesse → **Logs**. It's printed in a box. (Or from the shell:
   `sudo docker exec finesse finesse setup-code`.)
4. Open `http://<your NAS>:30500/finesse/setup` and follow the setup page. It's the same as on
   any other machine; see the [install guide](install.md#2-the-setup-page).

Finesse is listed on the Apps page. The apps it creates (Jellyfin, Sonarr, Radarr…) are
ordinary Docker containers it looks after itself, so they aren't listed separately: see them in
Finesse under **Settings → Server**.

If you'd rather use the shell, the installer works on TrueNAS too. It keeps everything on a pool
and never uses the system drive. Finesse won't be listed on the Apps page that way.

## Updates

Finesse updates itself: admins get an **Update** dot, and **Settings → Updates** has the
details. TrueNAS keeps showing the app correctly afterwards. TrueNAS's own **Update** button for
the app works too.

## Backups

Finesse backs up its settings nightly. **Settings → Server → Backups → Back up now** can also
include watch history, requests and games, and download the file to your computer. See
[Backups](install.md#backups).

On TrueNAS, also add a **Periodic Snapshot Task** for the settings dataset (Data Protection →
Periodic Snapshot Tasks). Snapshots cost almost nothing and capture everything at once.
Replicate them to another pool or machine if you can.

## Removing it

Apps → finesse → **Delete**. For a full install, also remove the apps it created:

```bash
sudo docker rm -f $(sudo docker ps -aq --filter label=finesse.managed=true)
```

Your datasets and everything in them stay.

## Problems

| What you see | What to do |
|---|---|
| **The app won't deploy: "port is already allocated"** | Another app uses that port. Change `30500` in the YAML to a free one. |
| **"Permission denied" in the logs** | Give the `apps` user Modify on the datasets (step B1 or A1). |
| **Finesse can't reach Jellyfin (adopt)** | Check the port in `JELLYFIN_URL` matches Jellyfin's port on the Apps page, and that the API key is right. |
| **Anything else** | Apps → finesse → Logs, and `sudo docker exec finesse finesse doctor`. Include both when you [open an issue](https://github.com/CoffeeCC/finesse/issues). |
