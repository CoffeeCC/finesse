# Use Finesse with your existing setup

Already running Jellyfin (and maybe Sonarr, Radarr, Lidarr, SABnzbd)? Finesse can sit in front of
what you have. It becomes the app everyone uses. Your apps, their settings and your libraries
stay exactly as they are. This is **adopt mode**: Finesse installs nothing and only connects.

In adopt mode you still get:

- the whole Finesse app on web, phones and LG TVs;
- requests, invites and invite emails;
- in-app updates of the Finesse app.

Features that manage containers (the setup wizard, app health, repairs, app updates) are only
for installs where Finesse built the stack.

## Run it

Finesse is one container. Point it at your apps with environment variables:

```yaml
# docker-compose.yml
services:
  finesse:
    image: ghcr.io/coffeecc/finesse:latest
    container_name: finesse
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - ./finesse:/config                # settings, invites, backups
    environment:
      TZ: Europe/London
      JELLYFIN_URL: http://192.168.1.10:8096
      JELLYFIN_API_KEY: ${JELLYFIN_API_KEY}   # Jellyfin → Dashboard → API Keys → +
      # Optional — each one lights up a feature:
      RADARR_URL: http://192.168.1.10:7878
      RADARR_API_KEY: ${RADARR_API_KEY}
      SONARR_URL: http://192.168.1.10:8989
      SONARR_API_KEY: ${SONARR_API_KEY}
      LIDARR_URL: http://192.168.1.10:8686
      LIDARR_API_KEY: ${LIDARR_API_KEY}
      SAB_URL: http://192.168.1.10:8085
      SAB_API_KEY: ${SAB_API_KEY}
      # FINESSE_PUBLIC_URL: https://media.example.com   # for invite links
```

Put the keys in a `.env` file next to it, then run `docker compose up -d`. Open
`http://<server>:8080`.

Finesse serves Jellyfin to the app at `/jellyfin` on its own address. So one port (8080) is all
you need to expose, and browsers never see Jellyfin's address or any API key.

| Variable | Meaning |
|---|---|
| `JELLYFIN_URL`, `JELLYFIN_API_KEY` | Required. Your Jellyfin and an API key for Finesse. |
| `JELLYFIN_BASE_PATH` | Only if your Jellyfin has a *Base URL* set (e.g. `/jellyfin`). |
| `RADARR_*`, `SONARR_*`, `LIDARR_*`, `PROWLARR_*` | `_URL` and `_API_KEY` (Settings → General in each app). |
| `SAB_URL`, `SAB_API_KEY` | SABnzbd (Config → General → API Key). |
| `QBIT_URL`, `QBIT_USERNAME`, `QBIT_PASSWORD` | qBittorrent Web UI. |
| `ROMM_URL`, `ROMM_USERNAME`, `ROMM_PASSWORD`, `STEAMGRIDDB_API_KEY` | Games (RomM). |
| `FINESSE_PUBLIC_URL` | Where people reach Finesse from outside, used in invite links. |
| `FINESSE_REPO`, `FINESSE_GITHUB_TOKEN` | Update from a fork / a private repo. |

Environment variables are never written to disk, so changing them and restarting is enough.

## Moving from the old nginx + invite-service deployment (≤ 0.13)

Before 1.0, Finesse was a folder of web files served by nginx, plus a small Python service for
invites and updates. The Finesse container replaces both. It keeps your invites, and the same
address keeps working.

On the NAS (TrueNAS SCALE shown; any Docker host works the same):

1. **Note what nginx proxied to.** Your `nginx.conf` has the Jellyfin, Radarr, Sonarr, Lidarr and
   SABnzbd addresses. Your `invite-service.env` has the Jellyfin URL and API key.
2. **Stop the old pieces:**
   - Stop the nginx app that served `/finesse` (e.g. on port 30500).
   - Stop the invite service: `pkill -f invite-service/server.py`.
3. **Run the Finesse container** on the port nginx used, so every bookmark, TV and invite link
   keeps working. Mount the folder that holds `invites.db`:

   ```bash
   sudo docker run -d --name finesse --restart unless-stopped \
     -p 30500:8080 \
     -v /mnt/POOL/apps/finesse/config:/config \
     -v /mnt/POOL/apps/finesse/data/invites.db:/config/invites.db \
     --env-file /mnt/POOL/apps/finesse/finesse.env \
     ghcr.io/coffeecc/finesse:latest
   ```

   Here `finesse.env` holds the `JELLYFIN_*`, `RADARR_*` … variables from the table above, using
   the addresses and keys from step 1. On TrueNAS, install it from the Apps page instead, so it's listed with your
   other apps: see [Finesse on TrueNAS](truenas.md).
4. **Tailscale Funnel / reverse proxy:** point it at the new container's port, as before.
5. **Check:**
   - Open `http://<nas>:30500/finesse/`, sign in, and look at **Settings → Server → Invites**.
     Your old invites should be listed.
   - Request something as a test.
6. **TVs** find the new server on their own the next time the Finesse app starts.

Once everything works, you can delete the old `dist/` folder and the `invite-service/` folder.
From now on, updates come from the **Update** button as before. They now also update the
server itself.

### Moving to a fully managed stack later

You can switch to a stack Finesse manages at any time. Install Finesse on a machine with the
[installer](install.md) and move your media into its media folder. Your Jellyfin users and watch
history stay in your old Jellyfin. The fresh install starts with a new one.
