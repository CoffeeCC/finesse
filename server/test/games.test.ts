import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { clearFinishedTcLog, GamesNudger } from '../src/stack/games.ts'

function stack(data: string, services = ['jellyfin', 'romm-db', 'romm']) {
  const login = { url: 'http://romm:8080', username: 'finesse', password: 'pw' }
  return { get: () => ({ stack: { hostRoot: data, hostData: data, services }, services: { romm: login } }) } as never
}

test('registers folders RomM doesn’t know yet and nudges each so RomM scans it', async () => {
  const data = mkdtempSync(join(tmpdir(), 'finesse-games-'))
  const roms = join(data, 'media', 'games', 'roms')
  for (const d of ['nes', 'gb']) mkdirSync(join(roms, d), { recursive: true })
  const registered: string[] = []
  const unknown = new Set(['nes', 'gb', '../../etc'])
  const n = new GamesNudger(stack(data), {
    unregistered: async () => [...unknown],
    register: async (_login, folder) => {
      registered.push(folder)
      unknown.delete(folder)
    },
  })
  await n.tick(0)
  assert.deepEqual(registered.sort(), ['gb', 'nes'], 'only real folders in the games folder')
  assert.ok(existsSync(join(roms, 'nes', 'finesse-rescan.tmp')), 'nudged right away')
  await new Promise((r) => setTimeout(r, 3300))
  assert.ok(!existsSync(join(roms, 'nes', 'finesse-rescan.tmp')), 'and cleaned up')
  await n.tick(60000)
  assert.equal(registered.length, 2, 'once registered, left to RomM’s own watcher')
})

test('a folder RomM won’t take is retried later, not every minute', async () => {
  const data = mkdtempSync(join(tmpdir(), 'finesse-games-'))
  mkdirSync(join(data, 'media', 'games', 'roms', 'snes'), { recursive: true })
  let tries = 0
  const n = new GamesNudger(stack(data), {
    unregistered: async () => ['snes'],
    register: async () => {
      tries++
      throw new Error('boom')
    },
  })
  await n.tick(0)
  await n.tick(60000)
  assert.equal(tries, 1)
  await n.tick(31 * 60000)
  assert.equal(tries, 2)
})

test('does nothing without Games, and shrugs off RomM being down', async () => {
  let asked = 0
  const api = {
    unregistered: async () => {
      asked++
      throw new Error('ECONNREFUSED')
    },
    register: async () => {},
  }
  await new GamesNudger(stack('/nonexistent', ['jellyfin']), api).tick(0)
  assert.equal(asked, 0)
  await assert.doesNotReject(new GamesNudger(stack('/nonexistent'), api).tick(0))
  assert.equal(asked, 1)
})

test('clears a transaction log MariaDB already finished with, and nothing else', () => {
  const root = mkdtempSync(join(tmpdir(), 'finesse-games-'))
  const dir = join(root, 'config', 'romm-db')
  mkdirSync(dir, { recursive: true })
  const log = join(dir, 'tc.log')
  const header = (first: number) => Buffer.concat([Buffer.from([first, 0x23, 0x05, 0x74, 0x03]), Buffer.alloc(4091)])

  assert.equal(clearFinishedTcLog(root), false, 'no log: nothing to do')
  writeFileSync(log, header(0xfe))
  assert.equal(clearFinishedTcLog(root), false, 'a live or crashed log is kept for recovery')
  assert.ok(existsSync(log))
  writeFileSync(log, header(0x41))
  assert.equal(clearFinishedTcLog(root), true, 'a finished log is removed')
  assert.ok(!existsSync(log))
})

test('turning Games off drops RomM from the settings before removing its containers', async () => {
  const { SetupRunner } = await import('../src/setup/apply.ts')
  const events: string[] = []
  const s = { mode: 'bundle', services: { romm: { url: 'http://romm:8080' } } as Record<string, unknown>, stack: { services: ['jellyfin', 'romm-db', 'romm'] } }
  const settings = {
    get: () => s,
    update: (fn: (x: typeof s) => void) => {
      fn(s)
      events.push(`settings: ${s.stack.services.join(',')}`)
      return s
    },
  } as never
  const orch = { removeService: async (id: string) => void events.push(`remove ${id}`) } as never
  const runner = new SetupRunner(settings, orch)
  runner.setGames(false)
  while (runner.gamesJob.state === 'working') await new Promise((r) => setTimeout(r, 5))
  assert.equal(runner.gamesJob.state, 'done')
  assert.deepEqual(events, ['settings: jellyfin', 'remove romm', 'remove romm-db'])
  assert.ok(!('romm' in s.services))
})
