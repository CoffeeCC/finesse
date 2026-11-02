// In-game saves for the retro player (EmulatorJS), kept on the Finesse server.
//
// EmulatorJS writes a game's battery save (SRAM) to /data/saves in the browser (IndexedDB),
// but only every 5 minutes and as the page unloads, and IndexedDB is written after the page
// is gone: Exit (a reload, to stop the emulator) or closing the tab lost whatever the game had
// saved since. Saves also stayed in that one browser. Now:
//   - on start, the newer of this browser's copy and the server's is loaded (lib/saveSync)
//   - every few seconds the game's save is flushed; when it changed, it goes to the server
//     (server/src/gameSaves.ts) and the player says "Saved"
//   - leaving (Exit, switching apps, closing the tab) flushes it once more
// The browser's copy stays as it was, so a server that can't be reached loses nothing.

import { mediaBrowserAuthHeader } from '../api/client'
import { finesseApi } from './finesseServer'
import { pickSave, saveFingerprint } from './saveSync'

/** What we use of EmulatorJS (4.x). Everything is checked: a different version just plays without this. */
interface EjsFS {
  analyzePath(p: string): { exists: boolean }
  readFile(p: string): Uint8Array
  writeFile(p: string, d: Uint8Array): void
  mkdir(p: string): void
  unlink(p: string): void
  stat(p: string): { mtime: Date | number }
}
interface EjsGameManager {
  FS: EjsFS
  getSaveFilePath(): string
  saveSaveFiles(): void
  loadSaveFiles(): void
}
export interface Ejs {
  started?: boolean
  gameManager?: EjsGameManager
  on(event: string, fn: (data?: unknown) => void): void
}

export type SaveStatus = 'saved' | 'offline'

const FLUSH_EVERY = 5000
// A request that outlives the page can carry this much (keepalive's limit is 64 KB).
const KEEPALIVE_MAX = 60 * 1024

const syncedKey = (rom: number, system: string) => `finesse.save.${rom}.${system}`
function synced(rom: number, system: string): string | null {
  try {
    return localStorage.getItem(syncedKey(rom, system))
  } catch {
    return null
  }
}
function setSynced(rom: number, system: string, hash: string) {
  try {
    localStorage.setItem(syncedKey(rom, system), hash)
  } catch {
    /* private mode */
  }
}

/**
 * Keep `emu`'s in-game save for game `rom` (system `system`: gba, snes…) on the server.
 * Returns flush(): write the save now and wait (briefly) for it to reach the server.
 */
export function keepSaves(emu: Ejs, rom: number, system: string, onStatus: (s: SaveStatus) => void): { flush: () => Promise<void> } {
  const url = finesseApi(`/api/game-saves/${rom}/${encodeURIComponent(system)}`)
  let ready = false // loaded what to play from: before that, uploading could overwrite a newer save
  let sent = synced(rom, system)
  let inflight: Promise<void> = Promise.resolve()
  let leaving = false

  const upload = (data: Uint8Array) => {
    const hash = saveFingerprint(data)
    if (hash === sent) return inflight
    const body = data.slice() // the emulator's own buffer can change under the request
    inflight = inflight.then(async () => {
      if (hash === sent) return
      try {
        const r = await fetch(url, {
          method: 'PUT',
          headers: { Authorization: mediaBrowserAuthHeader(), 'Content-Type': 'application/octet-stream' },
          body,
          keepalive: leaving && body.length <= KEEPALIVE_MAX,
        })
        if (!r.ok) throw new Error(String(r.status))
        sent = hash
        setSynced(rom, system, hash)
        onStatus('saved')
      } catch {
        // Kept in this browser; the next flush tries the server again.
        onStatus('offline')
      }
    })
    return inflight
  }

  // EmulatorJS hands over the save every time it writes it (its own timer, its menu, unload, ours).
  emu.on('saveSaveFiles', (data) => {
    if (ready && data instanceof Uint8Array && data.length) void upload(data)
  })

  const flushNow = () => {
    const gm = emu.gameManager
    if (!ready || !emu.started || !gm) return
    try {
      gm.saveSaveFiles()
    } catch {
      /* the core is gone */
    }
  }

  emu.on('start', () => {
    void (async () => {
      const gm = emu.gameManager
      if (!gm) return
      let path = ''
      try {
        path = gm.getSaveFilePath()
      } catch {
        return
      }
      if (!path) return
      const fs = gm.FS
      let local: Uint8Array | null = null
      let localAt = 0
      try {
        if (fs.analyzePath(path).exists) {
          local = fs.readFile(path)
          const m = fs.stat(path).mtime
          localAt = typeof m === 'number' ? m : m.getTime()
        }
      } catch {
        local = null
      }
      let server: Uint8Array | null = null
      let serverAt = 0
      let reached = true
      try {
        const r = await fetch(url, { headers: { Authorization: mediaBrowserAuthHeader() }, cache: 'no-store' })
        if (r.ok) {
          server = new Uint8Array(await r.arrayBuffer())
          serverAt = Number(r.headers.get('X-Saved-At')) || 0
        } else if (r.status !== 404) reached = false
      } catch {
        reached = false
      }
      if (!reached) {
        // Play from this browser's copy; uploads try again as the game saves.
        ready = true
        onStatus('offline')
        return
      }
      const lh = local?.length ? saveFingerprint(local) : null
      const sh = server?.length ? saveFingerprint(server) : null
      const choice = pickSave(lh ? { hash: lh, at: localAt } : null, sh ? { hash: sh, at: serverAt } : null, synced(rom, system))
      if (choice === 'server' && server && sh) {
        try {
          const parts = path.split('/').filter(Boolean)
          let dir = ''
          for (const p of parts.slice(0, -1)) {
            dir += `/${p}`
            if (!fs.analyzePath(dir).exists) fs.mkdir(dir)
          }
          if (fs.analyzePath(path).exists) fs.unlink(path)
          fs.writeFile(path, server)
          gm.loadSaveFiles()
          sent = sh
          setSynced(rom, system, sh)
        } catch {
          /* keeps playing from this browser's copy */
        }
      } else if (choice === 'same' && sh) {
        sent = sh
        setSynced(rom, system, sh)
      }
      ready = true
      if (choice === 'local' && local) void upload(local)
    })()
  })

  window.setInterval(flushNow, FLUSH_EVERY)
  // Switching apps on a phone, closing the tab: the save goes now (the page may not come back).
  const away = () => {
    leaving = true
    flushNow()
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') away()
    else leaving = false
  })
  window.addEventListener('pagehide', away)
  // Before EmulatorJS's own unload save (capture runs first), so that one may outlive the page too.
  window.addEventListener('beforeunload', () => void (leaving = true), true)

  return {
    flush: async () => {
      flushNow()
      await Promise.race([inflight, new Promise((r) => window.setTimeout(r, 4000))])
    },
  }
}
