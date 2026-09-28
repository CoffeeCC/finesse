// Backups with a choice of parts: names, what's offered where, a full round
// trip (back up → things change → restore) on real SQLite databases, and how
// many big backups are kept.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { backupName, describeParts, heldApps, holdFile, partsOf, restoreBackup } from '../src/stack/backup.ts'
import { Maintainer } from '../src/stack/maintain.ts'
import { tmp } from './helpers.ts'

test('backup names say what they hold', () => {
  assert.equal(backupName('2026-09-28T17-00-00', ['settings', 'apps']), 'finesse-backup-2026-09-28T17-00-00.tar.gz')
  assert.equal(backupName('2026-09-28T17-00-00', ['settings', 'apps', 'games', 'watch']), 'finesse-backup-2026-09-28T17-00-00_apps_watch_games.tar.gz')
  assert.equal(backupName('2026-09-28T17-00-00', ['settings', 'watch']), 'finesse-backup-2026-09-28T17-00-00_watch.tar.gz')
  assert.deepEqual(partsOf('finesse-backup-2026-09-28T17-00-00.tar.gz'), ['settings', 'apps'])
  assert.deepEqual(partsOf('finesse-backup-2026-09-28T17-00-00_apps_watch_games.tar.gz'), ['settings', 'apps', 'watch', 'games'])
  assert.deepEqual(partsOf('finesse-backup-2026-09-28T17-00-00_watch.tar.gz'), ['settings', 'watch'])
  assert.deepEqual(partsOf('something-else.tar.gz'), [])
})

function sqlite(file: string, rows: string[]) {
  mkdirSync(join(file, '..'), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('CREATE TABLE IF NOT EXISTS t (v TEXT); DELETE FROM t;')
  for (const r of rows) db.prepare('INSERT INTO t VALUES (?)').run(r)
  db.close()
}
const rowsOf = (file: string) => {
  const db = new DatabaseSync(file, { readOnly: true })
  const r = (db.prepare('SELECT v FROM t ORDER BY v').all() as { v: string }[]).map((x) => x.v)
  db.close()
  return r
}

function world(mode: 'bundle' | 'adopt' = 'bundle', services = ['jellyfin', 'sonarr', 'radarr', 'romm-db', 'romm']) {
  const dir = tmp()
  const root = join(dir, 'root')
  const cfg = join(root, 'config')
  const configDir = join(cfg, 'finesse')
  mkdirSync(configDir, { recursive: true })
  const paths = { configDir, settingsFile: join(configDir, 'finesse.json'), invitesDb: join(configDir, 'invites.db'), backups: join(configDir, 'backups'), previews: '', bakedWeb: '', updatedWeb: '' }
  const s = {
    mode,
    version: '1.0.3',
    instanceId: 'test',
    jellyfin: { basePath: '' },
    services: {},
    setup: { state: 'ready' },
    stack: mode === 'bundle' ? { hostRoot: root, hostData: join(dir, 'data'), services } : undefined,
    maintenance: {},
  }
  writeFileSync(paths.settingsFile, JSON.stringify({ hello: 'finesse' }))
  const settings = { get: () => s, update: (fn: (x: typeof s) => void) => (fn(s), s), paths } as never
  // Each app's files.
  sqlite(join(cfg, 'jellyfin/data/jellyfin.db'), ['alex watched Sintel', 'robin watched Big Buck Bunny'])
  mkdirSync(join(cfg, 'jellyfin/config'), { recursive: true })
  writeFileSync(join(cfg, 'jellyfin/config/system.xml'), '<ServerConfiguration/>')
  sqlite(join(cfg, 'sonarr/sonarr.db'), ['Pioneer One'])
  writeFileSync(join(cfg, 'sonarr/config.xml'), '<Config><ApiKey>k</ApiKey></Config>')
  sqlite(join(cfg, 'radarr/radarr.db'), ['Big Buck Bunny', 'Sintel'])
  mkdirSync(join(cfg, 'romm/backups'), { recursive: true })
  writeFileSync(join(cfg, 'romm/backups/romm-2026-09-28T16-00-00.sql.gz'), gzipSync('CREATE TABLE roms (id int);'))
  mkdirSync(join(cfg, 'romm/assets/users/1/saves/gb'), { recursive: true })
  writeFileSync(join(cfg, 'romm/assets/users/1/saves/gb/Tobu Tobu Girl.srm'), 'level 7')
  // RomM's database answers the dump request like mariadb-dump would.
  const docker = { exec: async () => ({ code: 0, output: 'CREATE TABLE roms (id int);' }) }
  const maint = new Maintainer(settings, { docker } as never, paths as never)
  return { dir, root, cfg, configDir, paths, settings, maint }
}

test('what can be backed up depends on the server', () => {
  const bundle = world()
  const p = Object.fromEntries(describeParts((bundle.settings as { get: () => never }).get(), bundle.paths).map((x) => [x.id, x]))
  for (const id of ['settings', 'apps', 'watch', 'requests', 'games']) assert.equal(p[id]!.available, true, id)
  assert.ok(p.watch!.bytes > 0 && p.requests!.bytes > 0 && p.games!.bytes > 0)

  const noGames = world('bundle', ['jellyfin'])
  const q = Object.fromEntries(describeParts((noGames.settings as { get: () => never }).get(), noGames.paths).map((x) => [x.id, x]))
  assert.equal(q.games!.available, false)
  assert.equal(q.requests!.available, false)

  const adopt = world('adopt')
  const a = describeParts((adopt.settings as { get: () => never }).get(), adopt.paths)
  assert.deepEqual(a.filter((x) => x.available).map((x) => x.id), ['settings'])
})

test('back up everything, lose it, restore it', async () => {
  const w = world()
  const file = await w.maint.backupNow('manual', ['settings', 'apps', 'watch', 'requests', 'games'])
  assert.deepEqual(file.parts, ['settings', 'apps', 'watch', 'requests', 'games'])
  assert.match(file.name, /_apps_watch_requests_games\.tar\.gz$/)

  // Disaster: databases emptied, a save lost, settings changed.
  sqlite(join(w.cfg, 'jellyfin/data/jellyfin.db'), [])
  sqlite(join(w.cfg, 'sonarr/sonarr.db'), [])
  sqlite(join(w.cfg, 'radarr/radarr.db'), ['something else'])
  writeFileSync(join(w.cfg, 'jellyfin/data/jellyfin.db-wal'), 'stale')
  writeFileSync(join(w.cfg, 'romm/assets/users/1/saves/gb/Tobu Tobu Girl.srm'), 'level 1')
  writeFileSync(w.paths.settingsFile, JSON.stringify({ hello: 'changed' }))

  const r = await restoreBackup(join(w.paths.backups, file.name), { configDir: w.configDir, root: w.root, uid: process.getuid!(), gid: process.getgid!(), docker: null })
  assert.deepEqual(rowsOf(join(w.cfg, 'jellyfin/data/jellyfin.db')), ['alex watched Sintel', 'robin watched Big Buck Bunny'])
  assert.deepEqual(rowsOf(join(w.cfg, 'sonarr/sonarr.db')), ['Pioneer One'])
  assert.deepEqual(rowsOf(join(w.cfg, 'radarr/radarr.db')), ['Big Buck Bunny', 'Sintel'])
  assert.equal(existsSync(join(w.cfg, 'jellyfin/data/jellyfin.db-wal')), false, 'a stale WAL would undo the restore')
  assert.equal(readFileSync(join(w.cfg, 'romm/assets/users/1/saves/gb/Tobu Tobu Girl.srm'), 'utf8'), 'level 7')
  assert.equal(JSON.parse(readFileSync(w.paths.settingsFile, 'utf8')).hello, 'finesse')
  assert.deepEqual(r.databases.sort(), ['Jellyfin', 'Radarr', 'Sonarr'])
  // RomM's dump waits for its database; the marker tells Finesse to import it.
  assert.equal(r.rommPending, true)
  assert.ok(existsSync(join(w.cfg, 'romm-db/finesse-restore.sql.gz')))
  assert.ok(existsSync(join(w.configDir, 'restore-pending.json')))
  assert.equal(existsSync(holdFile(w.configDir)), false, 'the hold is lifted afterwards')
})

test('apps held by a restore are left alone, but not forever', () => {
  const dir = tmp()
  writeFileSync(holdFile(dir), JSON.stringify({ apps: ['jellyfin', 'sonarr'], until: Date.now() + 60000 }))
  assert.deepEqual(heldApps(dir), ['jellyfin', 'sonarr'])
  assert.deepEqual(heldApps(dir, Date.now() + 120000), [], 'expired')
  writeFileSync(holdFile(dir), 'not json')
  assert.deepEqual(heldApps(dir), [])
})

test('restore can bring back just one part', async () => {
  const w = world()
  const file = await w.maint.backupNow('manual', ['settings', 'apps', 'watch', 'requests'])
  sqlite(join(w.cfg, 'jellyfin/data/jellyfin.db'), [])
  sqlite(join(w.cfg, 'sonarr/sonarr.db'), [])
  writeFileSync(w.paths.settingsFile, JSON.stringify({ hello: 'changed' }))
  await restoreBackup(join(w.paths.backups, file.name), { configDir: w.configDir, root: w.root, uid: process.getuid!(), gid: process.getgid!(), docker: null, only: ['watch'] })
  assert.equal(rowsOf(join(w.cfg, 'jellyfin/data/jellyfin.db')).length, 2)
  assert.deepEqual(rowsOf(join(w.cfg, 'sonarr/sonarr.db')), [], 'requests weren’t asked for')
  assert.equal(JSON.parse(readFileSync(w.paths.settingsFile, 'utf8')).hello, 'changed', 'settings weren’t asked for')
})

test('the usual backup stays small, and only the newest 3 big ones are kept', async () => {
  const w = world()
  const plain = await w.maint.backupNow('nightly')
  assert.deepEqual(plain.parts, ['settings', 'apps'])
  assert.doesNotMatch(plain.name, /_/)
  mkdirSync(w.paths.backups, { recursive: true })
  // Five older big backups (a minute apart) and two older plain ones.
  for (let i = 0; i < 7; i++) {
    const name = `finesse-backup-2026-09-2${i}T10-00-00${i < 5 ? '_apps_watch' : ''}.tar.gz`
    writeFileSync(join(w.paths.backups, name), 'x')
    const t = new Date(Date.now() - (10 - i) * 60000)
    utimesSync(join(w.paths.backups, name), t, t)
  }
  await w.maint.backupNow('manual', ['settings', 'watch'])
  const names = readdirSync(w.paths.backups).filter((n) => n.startsWith('finesse-backup-'))
  const big = names.filter((n) => /_(apps_)?watch/.test(n))
  assert.equal(big.length, 3, big.join(', '))
  assert.equal(names.length - big.length, 3, 'plain ones are all kept')
})
