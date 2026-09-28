# Security

Finesse runs on people's home servers, next to their media, their accounts and a Docker socket.
Please report security problems privately so they can be fixed before they're public.

## Reporting a vulnerability

Use GitHub's **private vulnerability reporting**:
[Report a vulnerability](https://github.com/CoffeeCC/finesse/security/advisories/new) (the
**Security** tab → **Report a vulnerability**).

Please include:

- the Finesse version (**Settings → Server**, or `docker exec finesse finesse version`);
- what someone could do, and what they need first (for example "anyone on the LAN" or "a
  signed-in non-admin user");
- steps to reproduce, or a proof of concept.

Please **don't** open a public issue, and don't include real API keys, passwords or media
server addresses. You'll get a reply within a week. Fixes ship as a normal release, and every
install is offered it through the in-app **Update** button.

## Supported versions

Only the latest release gets fixes. Finesse updates itself in one click, so please update
before reporting.

## What's in scope

Some examples of what we'd treat as vulnerabilities:

- anything that lets someone who isn't an administrator reach **Settings → Server**, the
  setup API, the Docker socket or another app's API key;
- claiming a fresh install without its setup code;
- an app's API key, a password or a VPN key reaching a browser or a log;
- torrent traffic leaving outside the VPN;
- Finesse touching containers that aren't labelled `finesse.managed`.

## How Finesse is designed to be safe

- **The Docker socket.** Finesse needs `/var/run/docker.sock` to install and repair apps. Anything
  with that socket is effectively root on the machine. So Finesse only ever touches containers
  labelled `finesse.managed`, and only administrators can reach the endpoints that use it.
- **Setup.** Until setup finishes, every setup call needs a one-time setup code. The code stops
  working 30 minutes after setup completes.
- **Keys stay on the server.** Browsers only talk to Finesse. It adds each app's API key to
  proxied requests itself, never sends a key to a browser and never logs one.
- **Accounts.** Sign-in is Jellyfin's. Finesse checks each request's token with Jellyfin, and
  admin-only features need a Jellyfin administrator.
- **Torrents.** qBittorrent runs inside Gluetun's network namespace, with its kill switch. If the
  VPN drops, torrents stop. They never fall back to your normal connection.
- **Exposure.** Don't publish Finesse's port directly on the internet. Use the built-in Tailscale
  or Cloudflare Tunnel options, or a reverse proxy with HTTPS.
