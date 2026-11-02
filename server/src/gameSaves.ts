// In-game saves from the retro player (EmulatorJS in the browser): the battery save a game
// writes itself (SRAM: Pokémon's "Save", a memory card), kept per person, per game and per
// emulator core. The browser keeps its own copy too, but that one vanishes with cleared
// site data and never follows you to another device; this one does, and is backed up with
// lists.db.
//
// Not in RomM: Finesse reaches RomM as one account, so everyone's saves would land in the
// same place and overwrite each other.
//
//   GET /api/game-saves/:rom/:core → the save (application/octet-stream), X-Saved-At (ms), ETag; 404 if none
//   PUT /api/game-saves/:rom/:core   body: the save, as bytes → { savedAt, size, hash }

import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Auth } from './auth.ts'
import { ApiError, readBody, sendJson, type Router } from './http/core.ts'

/** Big enough for any battery save or memory card (a DS cartridge tops out at 8 MB). */
export const SAVE_MAX = 8 << 20
/** Saves one person can keep (one per game and core). */
export const SAVES_PER_PERSON = 2000

const ROM = /^\d{1,12}$/
const CORE = /^[A-Za-z0-9_-]{1,40}$/

export const saveHash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

function key(params: Record<string, string>) {
  const rom = String(params.rom ?? '')
  const core = String(params.core ?? '')
  if (!ROM.test(rom) || !CORE.test(core)) throw new ApiError(400, 'That isn’t a game save')
  return { rom: Number(rom), core }
}

export function registerGameSaves(router: Router, deps: { auth: Auth; db: DatabaseSync }) {
  const { auth, db } = deps

  router.get('/api/game-saves/:rom/:core', async ({ req, res, params }) => {
    const me = await auth.requirePerson(req)
    const { rom, core } = key(params)
    const row = db.prepare('SELECT data, hash, saved_at FROM game_saves WHERE owner = ? AND rom = ? AND core = ?').get(me.id, rom, core) as { data: Uint8Array; hash: string; saved_at: number } | undefined
    if (!row) throw new ApiError(404, 'No save for this game yet')
    const body = Buffer.from(row.data)
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length, ETag: `"${row.hash}"`, 'X-Saved-At': String(row.saved_at), 'Cache-Control': 'no-store' })
    res.end(body)
  })

  router.put('/api/game-saves/:rom/:core', async ({ req, res, params }) => {
    const me = await auth.requirePerson(req)
    const { rom, core } = key(params)
    const body = await readBody(req, SAVE_MAX)
    if (!body.length) throw new ApiError(400, 'The save was empty')
    const hash = saveHash(body)
    const had = db.prepare('SELECT hash FROM game_saves WHERE owner = ? AND rom = ? AND core = ?').get(me.id, rom, core) as { hash: string } | undefined
    if (!had && (db.prepare('SELECT COUNT(*) AS n FROM game_saves WHERE owner = ?').get(me.id) as { n: number }).n >= SAVES_PER_PERSON) {
      throw new ApiError(400, `You have saves for ${SAVES_PER_PERSON} games here, the most Finesse keeps`)
    }
    const savedAt = Date.now()
    db.prepare(
      `INSERT INTO game_saves (owner, rom, core, data, hash, size, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner, rom, core) DO UPDATE SET data = excluded.data, hash = excluded.hash, size = excluded.size, saved_at = excluded.saved_at`,
    ).run(me.id, rom, core, body, hash, body.length, savedAt)
    sendJson(res, 200, { savedAt, size: body.length, hash })
  })
}
