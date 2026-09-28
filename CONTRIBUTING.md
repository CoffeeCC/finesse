# Contributing to Finesse

Thanks for helping! Finesse aims to feel like a finished product to the people who use it, so
small, careful changes are the most welcome kind.

## Before you start

- **Read [AGENTS.md](AGENTS.md).** It's the working guide for people and AI agents alike: the
  layout, the commands and the rules that matter (no server dependencies, the TV's Chromium 68,
  secrets never reaching the browser, idempotent stack changes).
- **For anything bigger than a fix, open an issue first** so we can agree on the approach.
  [ROADMAP.md](ROADMAP.md) explains the architecture and why it's built this way.
- **Security problems** go through [private reporting](SECURITY.md), not issues.

## Set up

You need Node 22 and, for the server's stack features, Docker.

```bash
npm ci
npm run dev                 # the app on http://localhost:5173/finesse/
```

The dev server only serves the app. To use it with real data, run a Finesse server and point the
app at it with a `.env.local` file:

```bash
# Build and start a Finesse server from your checkout (see "Testing the real stack" in AGENTS.md)
docker build --target prebuilt -t finesse:dev .   # after npm run build && npm run server:build
./install.sh --yes --image finesse:dev --root /tmp/f/root --data /tmp/f/data

echo "FINESSE_SERVER=http://localhost:8080" > .env.local
npm run dev
```

Every server path (sign-in, setup, `/jellyfin`, requests, previews, invites) is then proxied to
that server.

## Before you open a pull request

Run the same checks as CI:

```bash
npm run build && npm run server:typecheck && npm run server:test
npm run build:webos         # if you touched the app: the TV build must still compile
```

Then:

- **Test what you changed, the way a person would.** Click through it on desktop and at phone
  width. For TV changes, use the arrow keys and Enter only.
- **Keep `setup.schema.json` in sync** with `server/src/setup/doc.ts`. A test checks this.
- **Add a test** for server behaviour. `server/test/` has fakes for Jellyfin, GitHub and SMTP,
  so no Docker is needed.
- **Describe it for people.** Put a line under the next version in `TODO.md` saying what changed
  for someone using Finesse, not how it was implemented.

## Style

- Match the code around you: its naming, comment density and idioms.
- UI copy is plain, friendly and specific. Errors say what happened and what to do next, for
  example "Can't find news.example.com — check the server address", not "ENOTFOUND".
- Comments explain *why*, not *what*.
