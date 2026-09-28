# Finesse native invites (pre-1.0 nginx + invite-service deployment)

> Legacy: this describes the original single-home deployment. Finesse 1.0 runs invites inside the
> Finesse server — see [docs/install.md](../docs/install.md).

Invites are first-party Finesse — no Wizarr required for new users.

## Share links

| Network | URL |
|---------|-----|
| LAN | `http://NAS-IP:30500/finesse/invite/<CODE>` |
| Funnel | `https://NAS.TAILNET.ts.net:10000/finesse/invite/<CODE>` |

Examples seeded at install: `CHRISSY` (family libraries), `DEMO1` (Movies+Shows, 7 days).

## Architecture

- **SPA:** `/invite/:code` — premium multi-step join → auto login  
- **API:** host process on `:30501` → proxied at `/invite-api/` by Finesse nginx  
- **DB:** `/mnt/POOL/apps/finesse/data/invites.db`  
- **Secrets:** `/mnt/POOL/apps/finesse/invite-service.env` (Jellyfin API key)

## What new members see

After creating their account, the success screen shows (with copy buttons):

- **Watch from anywhere** — the Funnel Finesse URL (+ "Add to Home Screen" hint)
- **On this house's wifi** — the LAN Finesse URL (faster locally)
- **Jellyfin app option** — the Funnel origin as server address, same credentials

So an invitee leaves the flow with everything needed to connect from outside the
LAN — no follow-up "what's the link again?" texts.

## Admin

Sign in as Jellyfin **admin** → **Settings → Administration → Invites**.

Create Standard / Family / custom, copy Funnel or LAN link, revoke.

## Ops

### Start invite service (on TrueNAS)

```bash
set -a; . /mnt/POOL/apps/finesse/invite-service.env; set +a
nohup python3 /mnt/POOL/apps/finesse/invite-service/server.py \
  >> /mnt/POOL/apps/finesse/data/invite-service.log 2>&1 &
```

Health: `curl http://127.0.0.1:30501/health`

### Deploy SPA

From your PC (repo):

```powershell
cd path\to\finesse
npm run build
# then stage tarball + copy into /mnt/POOL/apps/finesse/dist
# (ACL-aware; see deploy notes in deploy.ps1)
```

### Nginx

Live config: `/mnt/POOL/apps/finesse/nginx.conf`  
Repo template: `deploy/nginx.conf`  
Must include `location /invite-api/` → `http://NAS-IP:30501/`.

Restart/redeploy the Finesse app after nginx changes.

## Wizarr

Deprecated for invites. Existing Jellyfin accounts remain. Uninstall Wizarr when you no longer need it.

## API (quick)

```
GET  /invite-api/v1/invites/:code     # public validate
POST /invite-api/v1/join              # { code, username, password }
GET  /invite-api/v1/invites           # admin (Jellyfin admin token)
POST /invite-api/v1/invites           # admin create
DELETE /invite-api/v1/invites/:id     # admin revoke
GET  /invite-api/v1/update            # admin: served build vs latest GitHub release
POST /invite-api/v1/update            # admin: install the latest release (deploy/README.md)
```
