# Game store feeds

Finesse's game store ships with no games in it. Whoever runs the server adds **feeds**: each is
one JSON document at an address, listing games and where each can be downloaded. Anyone can
publish one: a studio for its own downloads, a community for free games, you for a folder of
installers you own.

Add a feed as an administrator (`POST /api/games/store/feeds` with `{ "name", "url" }`; Settings
gets a page for it with the rest of the store). Finesse reads each feed when it's added, twice a
day after that, and whenever you ask (`POST /api/games/store/sync`). A game a feed stops listing
leaves the store; a feed that can't be reached keeps the games it gave last time.

## The format

```json
{
  "games": [
    {
      "id": "warzone-2100",
      "title": "Warzone 2100",
      "summary": "Command the forces of The Project in a battle to rebuild the world.",
      "description": "Longer text for the game's page.",
      "developer": "Warzone 2100 Project",
      "year": 1999,
      "genres": ["Strategy", "Sci-fi"],
      "modes": ["single", "online"],
      "license": "GPL-2.0-or-later",
      "website": "https://example.org/game",
      "cover": "https://example.org/cover.jpg",
      "hero": "https://example.org/wide.jpg",
      "screenshots": ["https://example.org/1.jpg"],
      "popularity": 90,
      "downloads": [
        {
          "id": "win",
          "platform": "windows",
          "installer": "inno",
          "sizeBytes": 209715200,
          "version": "4.5.5",
          "url": "https://example.org/downloads/game-4.5.5-setup.exe",
          "installerFile": "game-4.5.5-setup.exe",
          "checksums": [{ "file": "game-4.5.5-setup.exe", "algo": "sha256", "expected": "…64 hex characters…" }]
        }
      ]
    }
  ]
}
```

| Field | Notes |
|---|---|
| `title` | Needed. `id` is optional (made from the title) but keep it stable so requests survive a re-read. |
| `modes` | Any of `single`, `local`, `online`. |
| `downloads[].platform` | `windows` or `linux`. Needed. |
| `downloads[].sizeBytes` | Needed: Finesse checks there's room before it starts. |
| `downloads[].url` or `.magnet` | One of them. Addresses must be `https://`; magnets must carry a BitTorrent hash. Neither is ever sent to a browser. |
| `downloads[].installer` | `inno`, `nsis`, `msi`, `archive`, `portable`, `linux`. A hint only: Finesse reads the file itself. |
| `downloads[].checksums` | `md5`, `sha1` or `sha256` per file. With them the game page says the download can be verified. |
| pictures, `website` | `https://` only; anything else is dropped. |

A game with no usable download is left out, and the feed's status says which and why.

An example to copy: [examples/game-store/feed.json](../examples/game-store/feed.json).
