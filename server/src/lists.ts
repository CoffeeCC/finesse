// lists.db: what people keep in Finesse itself (not in Jellyfin): smart collections, shared
// queues and Moments collections. One SQLite file next to moments.db, backed up with it.
//
// The schema has a version (PRAGMA user_version). Each step below runs once, in order, on
// whatever file is there: a new install runs them all, an existing one only the new ones.
// Steps only ever add; nothing already stored is rewritten.

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const STEPS: string[] = [
  // 1: smart collections (smartCollections.ts)
  `CREATE TABLE IF NOT EXISTS smart_collections (
     id TEXT PRIMARY KEY,
     owner TEXT NOT NULL,
     name TEXT NOT NULL,
     rules TEXT NOT NULL,
     created INTEGER NOT NULL,
     updated INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS smart_owner ON smart_collections(owner);`,
  // 2: shortlists (queues.ts)
  `CREATE TABLE IF NOT EXISTS queues (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     host TEXT NOT NULL,
     created INTEGER NOT NULL,
     updated INTEGER NOT NULL,
     archived INTEGER NOT NULL DEFAULT 0,
     picked TEXT
   );
   CREATE TABLE IF NOT EXISTS queue_members (
     queue TEXT NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
     user TEXT NOT NULL,
     PRIMARY KEY (queue, user)
   );
   CREATE INDEX IF NOT EXISTS queue_members_user ON queue_members(user);
   CREATE TABLE IF NOT EXISTS queue_items (
     queue TEXT NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
     key TEXT NOT NULL,
     item TEXT NOT NULL,
     title TEXT NOT NULL,
     subtitle TEXT NOT NULL DEFAULT '',
     added_by TEXT NOT NULL,
     added_at INTEGER NOT NULL,
     PRIMARY KEY (queue, key)
   );
   CREATE TABLE IF NOT EXISTS queue_votes (
     queue TEXT NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
     user TEXT NOT NULL,
     key TEXT NOT NULL,
     PRIMARY KEY (queue, user)
   );`,
]

export const LISTS_VERSION = STEPS.length

export function openLists(file: string): DatabaseSync {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON')
  const at = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version) || 0
  for (let i = at; i < STEPS.length; i++) {
    db.exec('BEGIN')
    try {
      db.exec(STEPS[i]!)
      db.exec(`PRAGMA user_version = ${i + 1}`)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  return db
}
