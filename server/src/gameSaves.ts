// In-game saves from the retro player (EmulatorJS in the browser): the battery save a game
// writes itself (SRAM: Pokémon's "Save", a memory card), kept per person, per game and per
// emulator core. The browser keeps its own copy too, but that one vanishes with cleared
// site data and never follows you to another device; this one does.
//
// Stored in saves.db, not lists.db: saves are bytes, up to megabytes each, and lists.db (and
// its backups) should stay small. saves.db is backed up and restored next to it
// (stack/maintain.ts, stack/backup.ts), and the caps below keep it a size a backup can carry.
// Rows an earlier build wrote to lists.db (its step 4) move here on start.
//
// Not in RomM: Finesse reaches RomM as one account, so everyone's saves would land in the
// same place and overwrite each other.
//
// No blind overwrites. A save's version is its fingerprint: the same FNV hash the browser
// computes (src/lib/saveSync.ts; plain-HTTP pages have no crypto.subtle, so the server speaks
// the browser's hash rather than the other way round). It is the ETag. An upload says which
// version it replaces (If-Match: "<fingerprint>", or If-None-Match: * for "there was none"),
// and gets 409 when the server's copy has moved on since: another device saved in between.
//
//   GET    /api/game-saves/:rom/:core → the save (application/octet-stream), ETag, X-Saved-At (ms); 404 if none
//   PUT    /api/game-saves/:rom/:core   body: the save; If-Match or If-None-Match: * → { savedAt, size, hash }
//   DELETE /api/game-saves/:rom/:core   your own save (If-Match optional) → { deleted: true }

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Auth } from './auth.ts'
import { ApiError, readBody, sendJson, type Router } from './http/core.ts'

/** Big enough for any battery save or memory card (a DS cartridge tops out at 8 MB). */
export const SAVE_MAX = 8 << 20
/** Saves one person can keep (one per game and core). */
export const SAVES_PER_PERSON = 2000
/** What one person's saves may add up to. */
export const PERSON_BYTES_MAX = 256 << 20
/** What everyone's saves may add up to: saves.db stays a size a backup can carry. */
export const TOTAL_BYTES_MAX = 1024 << 20

const ROM = /^\d{1,12}$/
const CORE = /^[A-Za-z0-9_-]{1,40}$/

/** A save's fingerprint: FNV-1a over the bytes, with the length. Must match saveFingerprint in
 *  src/lib/saveSync.ts exactly (server/test/game-saves.test.ts checks). */
export function saveFingerprint(b: Uint8Array): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193 ^ b.length
  for (let i = 0; i < b.length; i++) {
    h1 = Math.imul(h1 ^ b[i]!, 0x01000193)
    h2 = Math.imul(h2 ^ b[i]!, 0x5bd1e995) ^ (h2 >>> 15)
  }
  return `${b.length.toString(16)}-${(h1 >>> 0).toString(16)}-${(h2 >>> 0).toString(16)}`
}

/** One slot per game and system, however they're written: "0012" is game 12, "GBA" is gba. */
export function saveKey(params: Record<string, string>): { rom: number; core: string } {
  const rom = String(params.rom ?? '')
  const core = String(params.core ?? '')
  if (!ROM.test(rom) || !CORE.test(core) || Number(rom) < 1) throw new ApiError(400, 'That isn’t a game save')
  return { rom: Number(rom), core: core.toLowerCase() }
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS game_saves (
  owner TEXT NOT NULL,
  rom INTEGER NOT NULL,
  core TEXT NOT NULL,
  data BLOB NOT NULL,
  fp TEXT NOT NULL,
  size INTEGER NOT NULL,
  saved_at INTEGER NOT NULL,
  PRIMARY KEY (owner, rom, core)
);`

/**
 * Open saves.db, moving in any saves an earlier build kept in lists.db. That table is dropped
 * once they're safely here, and lists.db compacted, so its backups shrink back.
 */
export function openSaves(file: string, lists?: DatabaseSync): DatabaseSync {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec(SCHEMA)
  if (lists?.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'game_saves'").get()) {
    const rows = lists.prepare('SELECT owner, rom, core, data, saved_at FROM game_saves').all() as { owner: string; rom: number; core: string; data: Uint8Array; saved_at: number }[]
    const add = db.prepare('INSERT OR IGNORE INTO game_saves (owner, rom, core, data, fp, size, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    db.exec('BEGIN')
    try {
      for (const r of rows) add.run(r.owner, Number(r.rom), String(r.core).toLowerCase(), r.data, saveFingerprint(r.data), r.data.length, r.saved_at)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    lists.exec('DROP TABLE game_saves')
    if (rows.length) lists.exec('VACUUM')
  }
  return db
}

const etag = (fp: string) => `"${fp}"`
/** The version an If-Match names: "fp", W/"fp" or a bare fp. */
const named = (h: string) => h.trim().replace(/^W\//, '').replace(/^"(.*)"$/, '$1')

export interface SaveLimits {
  perPerson: number
  total: number
  count: number
}

export function registerGameSaves(router: Router, deps: { auth: Pick<Auth, 'requirePerson'>; db: DatabaseSync; limits?: SaveLimits }) {
  const { auth, db } = deps
  const lim = deps.limits ?? { perPerson: PERSON_BYTES_MAX, total: TOTAL_BYTES_MAX, count: SAVES_PER_PERSON }
  const mb = (n: number) => `${Math.round(n / (1 << 20))} MB`
  const one = db.prepare('SELECT data, fp, saved_at FROM game_saves WHERE owner = ? AND rom = ? AND core = ?')
  const head = db.prepare('SELECT fp, size, saved_at FROM game_saves WHERE owner = ? AND rom = ? AND core = ?')

  router.get('/api/game-saves/:rom/:core', async ({ req, res, params }) => {
    const me = await auth.requirePerson(req)
    const { rom, core } = saveKey(params)
    const row = one.get(me.id, rom, core) as { data: Uint8Array; fp: string; saved_at: number } | undefined
    if (!row) throw new ApiError(404, 'No save for this game yet')
    const body = Buffer.from(row.data)
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length, ETag: etag(row.fp), 'X-Saved-At': String(row.saved_at), 'Cache-Control': 'no-store' })
    res.end(body)
  })

  router.put('/api/game-saves/:rom/:core', async ({ req, res, params }) => {
    const me = await auth.requirePerson(req)
    const { rom, core } = saveKey(params)
    const ifMatch = req.headers['if-match']?.trim()
    const ifNone = req.headers['if-none-match']?.trim()
    const body = await readBody(req, SAVE_MAX)
    if (!body.length) throw new ApiError(400, 'The save was empty')
    if (!ifMatch && ifNone !== '*') throw new ApiError(428, 'This save didn’t say which copy it replaces. Reload the page to update the player.')
    const fp = saveFingerprint(body)
    // Nothing runs between this read and the write below (no await), so the check holds.
    const had = head.get(me.id, rom, core) as { fp: string; size: number; saved_at: number } | undefined
    if (had?.fp === fp) {
      // Already here (a retry whose answer was lost, or two devices with the same save).
      res.setHeader('ETag', etag(fp))
      return void sendJson(res, 200, { savedAt: had.saved_at, size: body.length, hash: fp })
    }
    const base = ifMatch && ifMatch !== '*' ? named(ifMatch) : null
    const moved = had ? ifNone === '*' || (ifMatch !== '*' && base !== had.fp) : Boolean(ifMatch)
    if (moved) {
      if (had) res.setHeader('ETag', etag(had.fp))
      throw new ApiError(409, 'This game was saved on another device since this one last saved', { current: had?.fp ?? null })
    }
    if (!had && (db.prepare('SELECT COUNT(*) AS n FROM game_saves WHERE owner = ?').get(me.id) as { n: number }).n >= lim.count) {
      throw new ApiError(413, `You have saves for ${lim.count} games here, the most Finesse keeps for one person`)
    }
    const grows = body.length - (had?.size ?? 0)
    if (grows > 0) {
      const mine = Number((db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM game_saves WHERE owner = ?').get(me.id) as { n: number }).n)
      if (mine + grows > lim.perPerson) throw new ApiError(413, `Your game saves here would add up to more than ${mb(lim.perPerson)}, the most Finesse keeps for one person`)
      const all = Number((db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM game_saves').get() as { n: number }).n)
      if (all + grows > lim.total) throw new ApiError(413, `Game saves on this server would add up to more than ${mb(lim.total)}, the most Finesse keeps. Ask whoever runs Finesse to make room.`)
    }
    const savedAt = Date.now()
    db.prepare(
      `INSERT INTO game_saves (owner, rom, core, data, fp, size, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner, rom, core) DO UPDATE SET data = excluded.data, fp = excluded.fp, size = excluded.size, saved_at = excluded.saved_at`,
    ).run(me.id, rom, core, body, fp, body.length, savedAt)
    res.setHeader('ETag', etag(fp))
    sendJson(res, 200, { savedAt, size: body.length, hash: fp })
  })

  router.delete('/api/game-saves/:rom/:core', async ({ req, res, params }) => {
    const me = await auth.requirePerson(req)
    const { rom, core } = saveKey(params)
    // Only ever the signed-in person's own: the owner is part of the key.
    const had = head.get(me.id, rom, core) as { fp: string } | undefined
    if (!had) throw new ApiError(404, 'No save for this game yet')
    const ifMatch = req.headers['if-match']?.trim()
    if (ifMatch && ifMatch !== '*' && named(ifMatch) !== had.fp) throw new ApiError(409, 'This game was saved on another device since, so nothing was deleted', { current: had.fp })
    db.prepare('DELETE FROM game_saves WHERE owner = ? AND rom = ? AND core = ?').run(me.id, rom, core)
    sendJson(res, 200, { deleted: true })
  })
}
