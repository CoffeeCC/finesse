# Groups: share with friends who run Finesse

Groups lets households that each run Finesse share libraries with each other: films, shows and
music. Your friends watch and listen to what you share from their own Finesse, next to their own
library, and you do the same with theirs.

It's **watch- and listen-only**:

- **Nobody gets an account on your server.** Your friends sign in to their own Finesse as usual.
- **They can't request, download or delete anything** on your server, or see anything you
  didn't share.
- **Each person keeps their own progress.** Your server keeps a hidden, locked-down viewer for
  every person who watches. It never shows on your "Who's watching?" screen and can't be
  signed in to.
- **Nothing about your setup leaves your server.** Keys, passwords and file locations stay
  where they are.
- **Stopping works at once.** Stop sharing, or change what's shared, and it applies to their
  very next click.

## What you need

- Both households run Finesse **1.1 or newer**.
- **The sharing server must be reachable from the other one.** Usually that's its public
  address: Tailscale Funnel, Cloudflare Tunnel or your own domain (see "Away from home" in the
  [install guide](install.md)).
  - Full install: set it in **Settings → Server → Invites & sharing → Public address**.
  - [Adopt mode](adopt.md): set `FINESSE_PUBLIC_URL`.
- Streams come from the server that has the file, so they use its **upload speed**, and its
  processor does any transcoding.

## Share your libraries

1. **Settings → Server → Groups → Share with a friend's server.**
2. Tick the libraries they can watch or listen to, then **Create a code**.
3. Send your friend the code and your address. The code works once, within 7 days.

## Add a friend's server

1. **Settings → Server → Groups → Add a friend's server.**
2. Enter the address and code they sent you, then **Add**.

Their libraries appear for everyone in your household:

- **Friends** in the menu (More on desktop and TVs, the Library tab on phones): a row for each
  library they share, plus what you're in the middle of.
- **Home**: a "From *their server*" row with the films and shows they added lately.
- **Music**: a "From *their server*" row of their albums, with Shuffle. Music appears in the menu
  even if you have no music of your own.
- **Search**: films and shows from friends' servers appear under "On friends' servers".

A friend's titles and albums are marked "From *their server*". Everything else works as usual:
episodes, subtitles, audio tracks, lyrics, My List, resuming.

## Share back

To share yours with a friend you already watch, press **Share yours back** next to their server
and pick the libraries. Their admin gets an offer under Groups and adds you with one click. Your
server needs a public address for this.

## Change or stop

Everything is under **Settings → Server → Groups**:

- **Watching your server** lists who watches yours: when they were last here and how many
  people have watched. Tick or untick libraries to change what they see (it applies
  immediately). **Stop sharing** ends it and removes their viewers.
- **Servers you watch**: **Remove** stops watching a friend's server and tells their server too.

## Good to know

- **Play on… stays with your own titles.** Your TVs' own Jellyfin apps can't see a friend's
  library. The Finesse TV app and the web app play friends' titles as normal.
- **Share only what you're allowed to share.** What you share, and with whom, is up to you.

## Problems

| What you see | What to do |
|---|---|
| **"That address doesn't answer like a Finesse server"** | Check the address works in a browser (it should open Finesse). Use their public address, not a home one like `192.168.…`. |
| **"That code didn't work"** | Codes work once and last 7 days. Ask for a new one. |
| **"Their server has to reach yours"** (sharing back) | Set your public address first (see [What you need](#what-you-need)). |
| **"… isn't answering right now"** on the Friends page | Their server is off or unreachable, or they stopped sharing. |
| **Their films start slowly or stutter** | It's their upload speed. Lower **Maximum streaming quality** in Settings → Playback. |
| **A library isn't offered when you share** | Films, shows and music can be shared. Playlists, photos, books and live TV can't. |
