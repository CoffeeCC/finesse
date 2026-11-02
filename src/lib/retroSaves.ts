// In-game saves for the retro player (EmulatorJS), kept on the Finesse server.
//
// EmulatorJS writes a game's battery save (SRAM) to /data/saves in the browser (IndexedDB),
// but only every 5 minutes and as the page unloads, and IndexedDB is written after the page
// is gone: Exit (a reload, to stop the emulator) or closing the tab lost whatever the game had
// saved since. Saves also stayed in that one browser. Now:
//   - before the game starts, the save at its path becomes the signed-in person's (lib/saveSlots:
//     profiles sharing a browser never play or upload each other's), the server's copy is
//     fetched, and lib/saveSync decides: load the server's, send this one, or ask
//   - the server's copy is written before the core reads the file, so the game boots with it.
//     RetroArch keeps saves in a folder named after the core (/data/saves/Gambatte/…), which
//     isn't known until a core has run once on this device: that first time, the save is
//     loaded as the game starts and the core is reset, so a stale save in memory can't be
//     written back. Checked in a real browser with EmulatorJS 4.2.3 and Gambatte.
//   - every few seconds the game's save is flushed; when it changed, it goes to the server
//     (server/src/gameSaves.ts) saying which copy it replaces, and the player says "Saved".
//     If another device saved in between, the server says so (409) and the player asks which
//     to keep; neither is lost.
//   - leaving (Exit, switching apps, closing the tab) flushes it once more
// The browser's copy stays as it was, so a server that can't be reached loses nothing.

import { mediaBrowserAuthHeader } from '../api/client'
import { finesseApi } from './finesseServer'
import { readSave, setAside, takeSlot, writeSave, type SlotFS } from './saveSlots'
import { planSync, precondition, refusal, saveFingerprint } from './saveSync'

/** What we use of EmulatorJS (4.2.x). Everything is checked: a different version just plays without this. */
interface EjsGameManager {
  FS: SlotFS & { readdir?(p: string): string[] }
  getSaveFilePath(): string
  saveSaveFiles(): void
  loadSaveFiles(): void
  restart?(): void
}
export interface Ejs {
  started?: boolean
  gameManager?: EjsGameManager
  fileName?: string
  coreName?: string
  saveFileExt?: string | false
  startGame?: () => void
  on(event: string, fn: (data?: unknown) => void): void
}

export type SaveNote = { kind: 'saved' } | { kind: 'offline' } | { kind: 'stopped'; message: string }
/** Another device saved this game too: which one to keep. */
export interface SaveConflict {
  choose(which: 'theirs' | 'mine'): void
}

const FLUSH_EVERY = 5000
// A request that outlives the page can carry this much (keepalive's limit is 64 KB).
const KEEPALIVE_MAX = 60 * 1024
// How long the game waits for the server's copy before starting from this browser's.
const FETCH_WAIT = 10000

type ServerCopy = { kind: 'copy'; data: Uint8Array; fp: string } | { kind: 'none' } | { kind: 'offline' } | { kind: 'stopped'; message: string }

async function problem(r: Response): Promise<string> {
  let error: string | undefined
  try {
    error = ((await r.json()) as { error?: string }).error
  } catch {
    /* not JSON */
  }
  return refusal(r.status, error)
}

const SAVES = '/data/saves'
const dirKey = (core: string) => `finesse.save.dir.${core}`

/**
 * Where RetroArch will keep the save for the ROM EmulatorJS wrote, before the core runs:
 * <folder>/<ROM name without extension>.<ext>. The folder is the one this core used last time
 * on this device, else the one an earlier save of this game is in. Null: not known yet.
 */
function expectedPath(emu: Ejs, remembered: (k: string) => string | null): string | null {
  const name = emu.fileName?.split('/').pop()
  const fs = emu.gameManager?.FS
  if (!name || !fs || emu.saveFileExt === false) return null
  const dot = name.lastIndexOf('.')
  const file = `${dot > 0 ? name.slice(0, dot) : name}.${emu.saveFileExt || 'srm'}`
  const dir = emu.coreName ? remembered(dirKey(emu.coreName)) : null
  if (dir) return `${dir}/${file}`
  try {
    const dirs = [SAVES, ...(fs.readdir?.(SAVES) ?? []).filter((d) => !d.startsWith('.')).map((d) => `${SAVES}/${d}`)]
    const found = dirs.filter((d) => fs.analyzePath(`${d}/${file}`).exists)
    return found.length === 1 ? `${found[0]}/${file}` : null
  } catch {
    return null
  }
}

/**
 * Keep `emu`'s in-game save for game `rom` (system `system`: gba, snes…) on the server, for
 * person `user`. Call from EJS_ready (before the game starts). Returns flush(): write the save
 * now and wait (briefly) for it to reach the server.
 */
export function keepSaves(
  emu: Ejs,
  o: { rom: number | string; system: string; user: string; onNote: (n: SaveNote) => void; onConflict: (c: SaveConflict | null) => void },
): { flush: () => Promise<void> } {
  const rom = Number(o.rom)
  const system = o.system.toLowerCase()
  const { user, onNote, onConflict } = o
  const url = finesseApi(`/api/game-saves/${rom}/${encodeURIComponent(system)}`)
  // What this person and the server last agreed on, from this browser.
  const markerKey = `finesse.save.${user}.${rom}.${system}`
  const synced = () => {
    try {
      return localStorage.getItem(markerKey)
    } catch {
      return null
    }
  }
  const setSynced = (fp: string) => {
    try {
      localStorage.setItem(markerKey, fp)
    } catch {
      /* private mode */
    }
  }
  const store = {
    get: (k: string) => {
      try {
        return localStorage.getItem(k)
      } catch {
        return null
      }
    },
    set: (k: string, v: string) => {
      try {
        localStorage.setItem(k, v)
      } catch {
        /* private mode */
      }
    },
  }

  // 'starting' until we know what to play from (uploading before could overwrite a newer save);
  // 'conflict' while the person chooses; 'stopped' after the server refused (a 4xx).
  let state: 'starting' | 'ready' | 'conflict' | 'stopped' = 'starting'
  // The fingerprint of the server's copy as far as we know (null: it has none). Every upload names it.
  let base: string | null = null
  let path = ''
  let inflight: Promise<void> = Promise.resolve()
  let leaving = false
  let pending: (() => void) | null = null // what to do once the game runs (an upload, a question)

  const fetchServer = async (): Promise<ServerCopy> => {
    try {
      const r = await fetch(url, { headers: { Authorization: mediaBrowserAuthHeader() }, cache: 'no-store' })
      if (r.ok) {
        const data = new Uint8Array(await r.arrayBuffer())
        return data.length ? { kind: 'copy', data, fp: saveFingerprint(data) } : { kind: 'none' }
      }
      if (r.status === 404) return { kind: 'none' }
      if (r.status >= 400 && r.status < 500) return { kind: 'stopped', message: await problem(r) }
      return { kind: 'offline' }
    } catch {
      return { kind: 'offline' }
    }
  }
  // Asked right away, so it's usually here by the time the ROM is.
  const first = fetchServer()

  const gm = () => emu.gameManager

  const stop = (message: string) => {
    state = 'stopped'
    onNote({ kind: 'stopped', message })
  }

  /** Another device saved: hold uploads and ask. `theirs` is the server's copy now. */
  const ask = (theirs: { data: Uint8Array; fp: string }) => {
    state = 'conflict'
    onConflict({
      choose: (which) => {
        const g = gm()
        if (state !== 'conflict' || !g) return
        onConflict(null)
        if (which === 'theirs') {
          try {
            // This device's latest, kept aside before it's replaced.
            if (emu.started) g.saveSaveFiles()
            setAside(g.FS, path, user, readSave(g.FS, path))
            writeSave(g.FS, path, theirs.data)
            if (emu.started) {
              g.loadSaveFiles()
              g.restart?.()
            }
          } catch {
            /* the core is gone */
          }
          base = theirs.fp
          setSynced(theirs.fp)
          state = 'ready'
        } else {
          // The other device's copy is kept aside here too; this one replaces it on the server.
          try {
            setAside(g.FS, path, user, theirs.data)
          } catch {
            /* nowhere to keep it */
          }
          base = theirs.fp
          state = 'ready'
          if (emu.started) flushNow()
          else {
            const mine = readSave(g.FS, path)
            if (mine) void upload(mine)
          }
        }
      },
    })
  }

  const upload = (data: Uint8Array): Promise<void> => {
    if (state !== 'ready') return inflight
    const fp = saveFingerprint(data)
    if (fp === base) return inflight
    const body = data.slice() // the emulator's own buffer can change under the request
    inflight = inflight.then(async () => {
      if (state !== 'ready' || fp === base) return
      try {
        const r = await fetch(url, {
          method: 'PUT',
          headers: { Authorization: mediaBrowserAuthHeader(), 'Content-Type': 'application/octet-stream', ...precondition(base) },
          body,
          keepalive: leaving && body.length <= KEEPALIVE_MAX,
        })
        if (r.ok) {
          base = fp
          setSynced(fp)
          onNote({ kind: 'saved' })
        } else if (r.status === 409) {
          // Another device saved since: see what it has, then ask.
          const now = await fetchServer()
          if (now.kind === 'copy') ask(now)
          else if (now.kind === 'none') base = null // deleted meanwhile: the next flush goes up
          else if (now.kind === 'stopped') stop(now.message)
          else onNote({ kind: 'offline' })
        } else if (r.status >= 400 && r.status < 500) {
          // Final: retrying sends the same thing and gets the same answer.
          stop(await problem(r))
        } else onNote({ kind: 'offline' })
      } catch {
        // Kept in this browser; the next flush tries the server again.
        onNote({ kind: 'offline' })
      }
    })
    return inflight
  }

  // EmulatorJS hands over the save every time it writes it (its own timer, its menu, unload, ours).
  emu.on('saveSaveFiles', (data) => {
    if (data instanceof Uint8Array && data.length) void upload(data)
  })

  const flushNow = () => {
    const g = gm()
    if (state !== 'ready' || !emu.started || !g) return
    try {
      g.saveSaveFiles()
    } catch {
      /* the core is gone */
    }
  }

  /**
   * Put the right save at `at` and decide what happens next. Returns whether the file there
   * changed (after start, the core must then load it again).
   */
  const prepare = async (at: string): Promise<boolean> => {
    const g = gm()
    if (!g) return false
    path = at
    const fs = g.FS
    let changed = false
    try {
      const before = readSave(fs, at)
      takeSlot(fs, store, at, user)
      const now = readSave(fs, at)
      changed = (before ? saveFingerprint(before) : null) !== (now ? saveFingerprint(now) : null)
    } catch {
      // Can't tell whose the browser's copy is: don't send it anywhere.
      stop('Couldn’t read this game’s save on this device, so it isn’t being kept on Finesse.')
      return false
    }
    const local = readSave(fs, at)
    const lfp = local ? saveFingerprint(local) : null
    const srv = await Promise.race([first, new Promise<ServerCopy>((r) => window.setTimeout(() => r({ kind: 'offline' }), FETCH_WAIT))])
    if (srv.kind === 'stopped') {
      stop(srv.message)
      return changed
    }
    if (srv.kind === 'offline') {
      // Play from this browser's copy. The first upload still names the copy this browser last
      // saw on the server, so if another device saved meanwhile, the server says so (409).
      base = synced()
      state = 'ready'
      onNote({ kind: 'offline' })
      return changed
    }
    const sfp = srv.kind === 'copy' ? srv.fp : null
    base = sfp
    switch (planSync(lfp, sfp, synced())) {
      case 'server':
        if (srv.kind !== 'copy') break
        try {
          // An unsynced copy here is kept aside, never just overwritten.
          if (local && lfp !== synced()) setAside(fs, at, user, local)
          writeSave(fs, at, srv.data)
          changed = true
          setSynced(srv.fp)
        } catch {
          stop('Couldn’t load your save from Finesse on this device.')
          return changed
        }
        break
      case 'same':
        if (sfp) setSynced(sfp)
        break
      case 'upload':
        if (local) pending = () => void upload(local)
        break
      case 'conflict':
        if (srv.kind === 'copy') {
          const theirs = srv
          state = 'conflict'
          pending = () => ask(theirs)
          return changed
        }
        break
    }
    state = 'ready'
    return changed
  }

  // Before the game boots: EmulatorJS calls startGame once the ROM is written, and the core
  // reads the save file as it starts. Hold it until the right save is in place.
  let prepared: string | null = null
  const start = emu.startGame
  if (typeof start === 'function') {
    emu.startGame = () => {
      const at = expectedPath(emu, store.get)
      void (at ? prepare(at).then(() => void (prepared = at)) : Promise.resolve())
        .catch(() => {})
        .finally(() => start.call(emu))
    }
  }

  emu.on('start', () => {
    void (async () => {
      const g = gm()
      if (!g) return
      let real = ''
      try {
        real = g.getSaveFilePath()
      } catch {
        return
      }
      if (!real) return
      if (emu.coreName) store.set(dirKey(emu.coreName), real.slice(0, real.lastIndexOf('/')))
      if (prepared !== real) {
        // Guessed wrong (or couldn't): do it now, and restart the game on the right save.
        state = 'starting'
        pending = null
        if (await prepare(real)) {
          try {
            g.loadSaveFiles()
            g.restart?.()
          } catch {
            /* keeps playing */
          }
        }
      }
      const next = pending
      pending = null
      next?.()
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
