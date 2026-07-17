# Finesse native invites

Invites are first-party Finesse — no Wizarr required for new users.

## Share links

| Network | URL |
|---------|-----|
| LAN | `http://192.168.1.121:30500/finesse/invite/<CODE>` |
| Funnel | `https://truenas-scale.taild65e2.ts.net:10000/finesse/invite/<CODE>` |

Examples seeded at install: `CHRISSY` (family libraries), `DEMO1` (Movies+Shows, 7 days).

## Architecture

- **SPA:** `/invite/:code` — premium multi-step join → auto login  
- **API:** host process on `:30501` → proxied at `/invite-api/` by Finesse nginx  
- **DB:** `/mnt/HDDs/Applications/finesse/data/invites.db`  
- **Secrets:** `/mnt/HDDs/Applications/finesse/invite-service.env` (Jellyfin API key)

## Admin

Sign in as Jellyfin **admin** → **Settings → Administration → Invites**.

Create Standard / Family / custom, copy Funnel or LAN link, revoke.

## Ops

### Start invite service (on TrueNAS)

```bash
set -a; . /mnt/HDDs/Applications/finesse/invite-service.env; set +a
nohup python3 /mnt/HDDs/Applications/finesse/invite-service/server.py \
  >> /mnt/HDDs/Applications/finesse/data/invite-service.log 2>&1 &
```

Health: `curl http://127.0.0.1:30501/health`

### Deploy SPA

From your PC (repo):

```powershell
cd C:\Users\Paulw\finesse
npm run build
# then stage tarball + copy into /mnt/HDDs/Applications/finesse/dist
# (ACL-aware; see deploy notes in deploy.ps1)
```

### Nginx

Live config: `/mnt/HDDs/Applications/finesse/nginx.conf`  
Repo template: `deploy/nginx.conf`  
Must include `location /invite-api/` → `http://192.168.1.121:30501/`.

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
```
