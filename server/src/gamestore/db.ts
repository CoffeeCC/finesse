// What the game store remembers (sqlite, in the config folder): the catalogue the providers
// filled (games and their downloads) and every request with its history. Requests live here so a
// restart carries on where it was.

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { CatalogueGame, CatalogueSource, GameRequest, GameRequestState, StoreSource } from './types.ts'

/** A request as the server keeps it: what the app sees, plus who asked and what the pipeline needs. */
export interface StoredRequest extends GameRequest {
  /** The Jellyfin user id of whoever asked. */
  userId: string
  /** Where the installed game is and what starts it, once it's ready. */
  installDir?: string
  program?: string
  /** The start check's screenshot, relative to the games folder. */
  screenshot?: string
  /** What a person has to answer, when it needs them. */
  waitingOn?: string
}

export interface RequestEvent {
  at: string
  state: GameRequestState
  text: string
}

const json = <T>(v: string | null | undefined, fallback: T): T => {
  try {
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}

export class GameStoreDb {
  readonly db: DatabaseSync

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS store_game (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        title TEXT NOT NULL,
        popularity REAL NOT NULL DEFAULT 0,
        added_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS store_source (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS store_source_game ON store_source(game_id);
      CREATE TABLE IF NOT EXISTS game_request (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS game_request_state ON game_request(state);
      CREATE TABLE IF NOT EXISTS game_request_event (
        request_id TEXT NOT NULL,
        at TEXT NOT NULL,
        state TEXT NOT NULL,
        text TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS game_request_event_request ON game_request_event(request_id, at);
    `)
  }

  // ---------- the catalogue ----------

  /** Everything one provider has, replacing what it had before (a game it dropped leaves the store). */
  replaceProvider(provider: string, entries: { game: CatalogueGame; sources: CatalogueSource[] }[]) {
    this.db.exec('BEGIN')
    try {
      const old = (this.db.prepare('SELECT id, added_at FROM store_game WHERE provider = ?').all(provider) as { id: string; added_at: string }[])
      const firstSeen = new Map(old.map((g) => [g.id, g.added_at]))
      this.db.prepare('DELETE FROM store_source WHERE game_id IN (SELECT id FROM store_game WHERE provider = ?)').run(provider)
      this.db.prepare('DELETE FROM store_game WHERE provider = ?').run(provider)
      const game = this.db.prepare('INSERT OR REPLACE INTO store_game (id, provider, title, popularity, added_at, data) VALUES (?, ?, ?, ?, ?, ?)')
      const source = this.db.prepare('INSERT OR REPLACE INTO store_source (id, game_id, data) VALUES (?, ?, ?)')
      for (const e of entries) {
        // "New in the store" means new here: the day it first turned up, kept across syncs.
        const addedAt = firstSeen.get(e.game.id) ?? e.game.addedAt
        game.run(e.game.id, provider, e.game.title, e.game.popularity, addedAt, JSON.stringify({ ...e.game, addedAt, provider }))
        for (const s of e.sources) source.run(s.id, e.game.id, JSON.stringify({ ...s, gameId: e.game.id }))
      }
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  games(): CatalogueGame[] {
    return (this.db.prepare('SELECT data FROM store_game').all() as { data: string }[]).map((r) => json<CatalogueGame | null>(r.data, null)).filter((g): g is CatalogueGame => g !== null)
  }

  game(id: string): CatalogueGame | null {
    const r = this.db.prepare('SELECT data FROM store_game WHERE id = ?').get(id) as { data: string } | undefined
    return json<CatalogueGame | null>(r?.data, null)
  }

  sources(gameId: string): CatalogueSource[] {
    return (this.db.prepare('SELECT data FROM store_source WHERE game_id = ?').all(gameId) as { data: string }[]).map((r) => json<CatalogueSource | null>(r.data, null)).filter((s): s is CatalogueSource => s !== null)
  }

  source(id: string): CatalogueSource | null {
    const r = this.db.prepare('SELECT data FROM store_source WHERE id = ?').get(id) as { data: string } | undefined
    return json<CatalogueSource | null>(r?.data, null)
  }

  // ---------- requests ----------

  saveRequest(r: StoredRequest) {
    this.db
      .prepare('INSERT OR REPLACE INTO game_request (id, game_id, source_id, user_id, state, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(r.id, r.gameId, r.sourceId, r.userId, r.state, r.createdAt, r.updatedAt, JSON.stringify(r))
  }

  request(id: string): StoredRequest | null {
    const r = this.db.prepare('SELECT data FROM game_request WHERE id = ?').get(id) as { data: string } | undefined
    return json<StoredRequest | null>(r?.data, null)
  }

  /** Newest first. */
  requests(): StoredRequest[] {
    return (this.db.prepare('SELECT data FROM game_request ORDER BY created_at DESC').all() as { data: string }[]).map((r) => json<StoredRequest | null>(r.data, null)).filter((x): x is StoredRequest => x !== null)
  }

  removeRequest(id: string) {
    this.db.prepare('DELETE FROM game_request WHERE id = ?').run(id)
    this.db.prepare('DELETE FROM game_request_event WHERE request_id = ?').run(id)
  }

  /** Moves a request on and writes the step into its history. */
  advance(id: string, state: GameRequestState, change: Partial<StoredRequest> = {}, text?: string): StoredRequest | null {
    const r = this.request(id)
    if (!r) return null
    const now = new Date().toISOString()
    const next: StoredRequest = { ...r, ...change, state, updatedAt: now }
    this.saveRequest(next)
    if (text || state !== r.state) this.db.prepare('INSERT INTO game_request_event (request_id, at, state, text) VALUES (?, ?, ?, ?)').run(id, now, state, text ?? next.detail ?? '')
    return next
  }

  events(id: string): RequestEvent[] {
    return this.db.prepare('SELECT at, state, text FROM game_request_event WHERE request_id = ? ORDER BY at').all(id) as unknown as RequestEvent[]
  }
}

/** What a browser may know of a download: never where it comes from. */
export function publicSource(s: CatalogueSource): StoreSource {
  return { id: s.id, platform: s.platform, installer: s.installer, sizeBytes: s.sizeBytes, ...(s.version ? { version: s.version } : {}), ...(s.checksums?.length ? { verified: true } : {}) }
}

/** What a browser may know of a request: not who asked by id, nor where things are on disk. */
export function publicRequest(r: StoredRequest): GameRequest {
  const { userId: _u, installDir: _d, program: _p, screenshot: _s, waitingOn: _w, ...pub } = r
  return pub
}
