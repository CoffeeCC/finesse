> **Finesse 1.0 ships as one container.** New installs: see [docs/install.md](../docs/install.md).
> Existing Jellyfin/*arr setups and the pre-1.0 nginx + invite-service deployment described below:
> see [docs/adopt.md](../docs/adopt.md) to move to the container. This page is kept for installs
> that haven't moved yet.

# Deploying and updating Finesse

## Updating from the app

Since 0.12, Finesse updates itself. There are no scripts to run.

1. **Ship a version.** Bump `version` in `package.json` and add a `## … — vX.Y.Z (date)` section to
   `TODO.md` (it becomes the release notes). Then merge to `master`. The **Release** workflow
   (`.github/workflows/release.yml`) builds and publishes GitHub Release `vX.Y.Z` with two files:
   - `finesse-web-X.Y.Z.tar.gz`: the web build, for the NAS.
   - `finesse-webos-X.Y.Z.json`: the TV bundle, for the webOS updater.
2. **Update the server.** An admin sees a dot on their avatar. Either option works:
   - **Avatar menu → Update Finesse to X.Y**
   - **Settings → Updates → Update everyone**

   The invite service on the NAS downloads the release, checks it, and copies it into the served
   `dist/`. It copies assets first and `index.html` last, so it's safe while people are watching.
3. **Everyone else** gets a **Finesse X.Y is ready · Update** button in the top bar. Pressing it
   reloads into the new build. TVs check GitHub at launch and every 6 hours, show the same button,
   then download the bundle and relaunch.

Pushes that don't change the version publish nothing. If a release was made by hand with only one
of the two files, run the Release workflow from the Actions tab and it uploads the missing one.

### One-time setup on the NAS

The server update runs inside the invite service, so the NAS needs the new version of it once:

```bash
# from the repo, on your PC
scp deploy/invite-service/server.py truenas:/mnt/POOL/apps/finesse/invite-service/server.py

# on the NAS: restart it (same start command as deploy/INVITES.md)
pkill -f 'invite-service/server.py'
set -a; . /mnt/POOL/apps/finesse/invite-service.env; set +a
nohup python3 /mnt/POOL/apps/finesse/invite-service/server.py \
  >> /mnt/POOL/apps/finesse/data/invite-service.log 2>&1 &
```

The Update button only exists from 0.12 onwards, so install 0.12 itself from the same NAS shell. The
service accepts its own API key as admin:

```bash
curl -s -X POST -H "X-Emby-Token: $JELLYFIN_API_KEY" http://127.0.0.1:30501/v1/update
sleep 20; curl -s -H "X-Emby-Token: $JELLYFIN_API_KEY" http://127.0.0.1:30501/v1/update   # "state": "done"
```

(Or run `.\deploy\deploy.ps1` once.) On TVs still running 0.11, use Settings → App updates → Check
for updates one last time. From then on, updates come from the button.

Optional settings in `invite-service.env`:

| Variable | Default | When |
|---|---|---|
| `FINESSE_DIST` | `/mnt/POOL/apps/finesse/dist` | the web build lives elsewhere |
| `FINESSE_REPO` | `CoffeeCC/finesse` | releases come from a fork |
| `FINESSE_GITHUB_TOKEN` | — | the repo is private (fine-grained token, *Contents: read*) |

### Troubleshooting

- **"GitHub responded 403"**: GitHub's anonymous rate limit (60 requests an hour per address).
  Wait a bit, or set `FINESSE_GITHUB_TOKEN`.
- **"… has no web build to install"**: the latest release is missing `finesse-web-*.tar.gz`. Run
  the Release workflow (see above).
- **"PermissionError …"**: the user running the invite service can't write to `FINESSE_DIST`.
  Start it as the same user that `deploy.ps1` copies files as.
- **Something's wrong with a new version**: nothing is rolled back automatically. Check out the
  previous tag and run `.\deploy\deploy.ps1` (below), or ship a fixed version.

## Manual deploy (from your PC)

`.\deploy\deploy.ps1` still works: it builds locally and copies `dist/` to the NAS over SSH. Use it
for builds that aren't on GitHub yet. Browsers still get the Update button, because the build
includes `version.json`.
