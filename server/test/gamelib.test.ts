// Games without RomM (Windows): the library is the games folder, answered in RomM's shapes so the
// Games pages and EmulatorJS work unchanged; box art from libretro's thumbnails, cached.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { Writable } from 'node:stream'
import { crc32 } from 'node:zlib'
import { GameLibrary, artName, withoutTags } from '../src/gamelib.ts'
import { API_KEY, ADMIN_TOKEN, USER_TOKEN, auth, fakeJellyfin, listen, tmp, webBuild, type FakeJellyfin } from './helpers.ts'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)])

function folder(dir = join(tmp(), 'games')) {
  const put = (rel: string, body: string | Buffer = 'x') => {
    mkdirSync(join(dir, rel, '..'), { recursive: true })
    writeFileSync(join(dir, rel), body)
  }
  put('roms/snes/Super Mario World (USA).sfc', 'SMW-ROM-BYTES')
  put('roms/snes/Super Mario World (USA).srm', 'a save, not a game')
  put('roms/snes/notes.txt')
  put('roms/snes/.hidden.sfc')
  put('roms/psx/Final Fantasy VII (USA)/FF7.cue', 'FILE "FF7.bin" BINARY')
  put('roms/psx/Final Fantasy VII (USA)/FF7.bin', Buffer.alloc(5000, 7))
  put('roms/psx/Crash Bandicoot (Europe)/Crash.chd', 'CHD')
  put('roms/mystery/Thing.bin')
  put('bios/psx/scph5501.bin', 'BIOS')
  mkdirSync(join(dir, 'roms', 'n64'), { recursive: true })
  return dir
}

/** Enough of a ServerResponse for the file senders: a stream that keeps what it's sent. */
const res = () => {
  const chunks: Buffer[] = []
  const out = Object.assign(
    new Writable({
      write(c, _e, cb) {
        chunks.push(Buffer.from(c))
        cb()
      },
    }),
    {
      status: 0,
      headers: {} as Record<string, unknown>,
      writeHead(s: number, h: Record<string, unknown> = {}) {
        out.status = s
        out.headers = h
      },
    },
  )
  // A getter (Object.assign would copy just its first value).
  Object.defineProperty(out, 'body', { get: () => Buffer.concat(chunks) })
  return out as typeof out & { body: Buffer }
}

/** Sends and waits for the whole answer. */
async function take(send: (r: ReturnType<typeof res>) => unknown) {
  const r = res()
  const done = new Promise((ok) => r.on('finish', ok))
  await send(r)
  if (!r.writableEnded) await done
  return r
}

describe('the library', () => {
  test('consoles and games from the folder, in RomM’s shapes', () => {
    const lib = new GameLibrary({ dir: () => folder(), cacheDir: tmp(), fetchArt: async () => null })
    const platforms = lib.platforms()
    assert.deepEqual(
      platforms.map((p) => [p.fs_slug, p.name, p.rom_count]),
      [
        ['mystery', 'mystery', 1],
        ['n64', 'Nintendo 64', 0],
        ['psx', 'PlayStation', 2],
        ['snes', 'Super Nintendo', 1],
      ],
    )
    const psx = platforms.find((p) => p.fs_slug === 'psx')!
    assert.deepEqual(psx.firmware.map((f) => f.file_name), ['scph5501.bin'])

    const all = lib.roms(new URLSearchParams('limit=500&order_by=name&order_dir=asc'))
    assert.equal(all.total, 4)
    assert.deepEqual(all.items.map((r) => r.name), ['Crash Bandicoot', 'Final Fantasy VII', 'Super Mario World', 'Thing'])
    const smw = all.items.find((r) => r.name === 'Super Mario World')!
    assert.equal(smw.fs_name, 'Super Mario World (USA).sfc')
    assert.equal(smw.platform_slug, 'snes')
    assert.equal(smw.platform_display_name, 'Super Nintendo')
    assert.deepEqual(smw.regions, ['USA'])
    // A folder of several files goes as a zip; a folder with one file sends that file.
    assert.equal(all.items.find((r) => r.name === 'Final Fantasy VII')!.fs_name, 'Final Fantasy VII (USA).zip')
    assert.equal(all.items.find((r) => r.name === 'Crash Bandicoot')!.fs_name, 'Crash.chd')

    assert.deepEqual(lib.roms(new URLSearchParams(`platform_ids=${psx.id}`)).items.map((r) => r.name), ['Crash Bandicoot', 'Final Fantasy VII'])
    assert.deepEqual(lib.roms(new URLSearchParams('search_term=mario')).items.map((r) => r.name), ['Super Mario World'])
    assert.equal(lib.roms(new URLSearchParams('limit=1&offset=1')).items[0]!.name, 'Final Fantasy VII')
    assert.equal(lib.rom(smw.id).fs_name, smw.fs_name)
    assert.throws(() => lib.rom(9999), /No such game/)
  })

  test('a game keeps its number, even after Finesse restarts', () => {
    const dir = folder()
    const cache = tmp()
    const a = new GameLibrary({ dir: () => dir, cacheDir: cache, fetchArt: async () => null })
    const before = Object.fromEntries(a.roms(new URLSearchParams()).items.map((r) => [r.fs_name, r.id]))
    writeFileSync(join(dir, 'roms', 'snes', 'Aladdin (USA).sfc'), 'x')
    const b = new GameLibrary({ dir: () => dir, cacheDir: cache, fetchArt: async () => null })
    const after = Object.fromEntries(b.roms(new URLSearchParams()).items.map((r) => [r.fs_name, r.id]))
    for (const [name, id] of Object.entries(before)) assert.equal(after[name], id, name)
    assert.ok(after['Aladdin (USA).sfc'] && !Object.values(before).includes(after['Aladdin (USA).sfc']!))
  })

  test('new files show up after invalidate(), not before the cache is stale', () => {
    const dir = folder()
    const lib = new GameLibrary({ dir: () => dir, cacheDir: tmp(), fetchArt: async () => null })
    assert.equal(lib.roms(new URLSearchParams()).total, 4)
    writeFileSync(join(dir, 'roms', 'snes', 'Aladdin (USA).sfc'), 'x')
    assert.equal(lib.roms(new URLSearchParams()).total, 4)
    lib.invalidate()
    assert.equal(lib.roms(new URLSearchParams()).total, 5)
  })

  test('files: whole, in parts, and a folder as a zip any unzipper reads', async () => {
    const dir = folder()
    const lib = new GameLibrary({ dir: () => dir, cacheDir: tmp(), fetchArt: async () => null })
    const items = lib.roms(new URLSearchParams()).items
    const smw = items.find((r) => r.name === 'Super Mario World')!
    let r = await take((r) => lib.sendRom(smw.id, { method: 'GET', headers: {} } as never, r as never))
    assert.equal(r.status, 200)
    assert.equal(r.body.toString(), 'SMW-ROM-BYTES')
    r = await take((r) => lib.sendRom(smw.id, { method: 'GET', headers: { range: 'bytes=4-6' } } as never, r as never))
    assert.equal(r.status, 206)
    assert.equal(r.body.toString(), 'ROM')
    assert.equal(r.headers['content-range'], 'bytes 4-6/13')

    const ff7 = items.find((r) => r.name === 'Final Fantasy VII')!
    r = await take((r) => lib.sendRom(ff7.id, { method: 'GET', headers: {} } as never, r as never))
    assert.equal(r.status, 200)
    const zip = r.body
    assert.equal(zip.length, r.headers['content-length'])
    // End of central directory → central directory → each file's data and CRC.
    const eocd = zip.length - 22
    assert.equal(zip.readUInt32LE(eocd), 0x06054b50)
    const count = zip.readUInt16LE(eocd + 10)
    let at = zip.readUInt32LE(eocd + 16)
    const seen: Record<string, number> = {}
    for (let i = 0; i < count; i++) {
      assert.equal(zip.readUInt32LE(at), 0x02014b50)
      const crc = zip.readUInt32LE(at + 16)
      const size = zip.readUInt32LE(at + 24)
      const nameLen = zip.readUInt16LE(at + 28)
      const local = zip.readUInt32LE(at + 42)
      const name = zip.subarray(at + 46, at + 46 + nameLen).toString()
      assert.equal(zip.readUInt32LE(local), 0x04034b50)
      const dataAt = local + 30 + zip.readUInt16LE(local + 26)
      assert.equal(crc32(zip.subarray(dataAt, dataAt + size)) >>> 0, crc, name)
      seen[name] = size
      at += 46 + nameLen
    }
    assert.deepEqual(seen, { 'FF7.bin': 5000, 'FF7.cue': 21 })

    const bios = lib.platforms().find((p) => p.fs_slug === 'psx')!.firmware[0]!
    r = await take((r) => lib.sendFirmware(bios.id, { method: 'GET', headers: {} } as never, r as never))
    assert.equal(r.body.toString(), 'BIOS')
  })

  test('box art from libretro’s thumbnails, by the file’s No-Intro name, then by title', async () => {
    const asked: string[] = []
    const lib = new GameLibrary({
      dir: () => folder(),
      cacheDir: tmp(),
      fetchArt: async (url) => {
        asked.push(decodeURIComponent(url.replace('https://thumbnails.libretro.com/', '')))
        return url.includes('Crash%20Bandicoot%20(USA)') || url.includes('Super%20Mario%20World%20(USA)') ? PNG : null
      },
    })
    assert.equal(lib.roms(new URLSearchParams()).items.find((r) => r.name === 'Super Mario World')!.path_cover_small, undefined)
    await lib.artSettled()
    assert.ok(asked.includes('Nintendo - Super Nintendo Entertainment System/Named_Boxarts/Super Mario World (USA).png'))
    assert.ok(asked.includes('Sony - PlayStation/Named_Boxarts/Crash Bandicoot (Europe).png'), 'its own name first')
    assert.ok(!asked.some((a) => a.includes('Thing')), 'no art source for an unknown console')
    lib.invalidate()
    const items = lib.roms(new URLSearchParams()).items
    const smw = items.find((r) => r.name === 'Super Mario World')!
    assert.match(smw.path_cover_small ?? '', new RegExp(`^assets/covers/${smw.id}\\.png\\?v=\\d+$`))
    assert.ok(items.find((r) => r.name === 'Crash Bandicoot')!.path_cover_small, 'found under the USA name')
    assert.equal(items.find((r) => r.name === 'Final Fantasy VII')!.path_cover_small, undefined)
    // A miss isn't asked again on the next look.
    const n = asked.length
    lib.invalidate()
    lib.roms(new URLSearchParams())
    await lib.artSettled()
    assert.equal(asked.length, n)
  })

  test('names', () => {
    assert.equal(withoutTags('Super Mario World (USA) [!]'), 'Super Mario World')
    assert.equal(withoutTags('(Just Tags)'), '(Just Tags)')
    assert.equal(artName('Sonic & Knuckles: Part 1?'), 'Sonic _ Knuckles_ Part 1_')
  })
})

describe('through the server', () => {
  let base = ''
  let app: Server
  let jf: FakeJellyfin
  let romId = 0

  before(async () => {
    jf = await fakeJellyfin()
    const work = tmp()
    const data = join(work, 'data')
    folder(join(data, 'media', 'games'))
    mkdirSync(join(work, 'baked'), { recursive: true })
    for (const [rel, c] of Object.entries(webBuild('1.0.0'))) {
      mkdirSync(join(work, 'baked', rel, '..'), { recursive: true })
      writeFileSync(join(work, 'baked', rel), c)
    }
    mkdirSync(join(work, 'config'), { recursive: true })
    writeFileSync(
      join(work, 'config', 'finesse.json'),
      JSON.stringify({ mode: 'bundle', setup: { state: 'ready' }, services: { romm: { url: 'builtin:' } }, stack: { hostRoot: work, hostData: data, timezone: 'UTC', puid: 0, pgid: 0, services: ['jellyfin'] } }),
    )
    Object.assign(process.env, { FINESSE_CONFIG_DIR: join(work, 'config'), FINESSE_WEB_DIR: join(work, 'baked'), JELLYFIN_URL: jf.url, JELLYFIN_API_KEY: API_KEY, FINESSE_MAINTENANCE: 'off' })
    const { createApp } = await import('../src/app.ts')
    app = createApp().server
    base = await listen(app)
  })
  after(() => {
    for (const s of [app, jf?.server]) {
      s?.closeAllConnections()
      s?.close()
    }
  })

  const call = (method: string, path: string, token: string | null) => fetch(`${base}/finesse${path}`, { method, headers: token ? auth(token) : {} })

  test('the Games pages see the folder; everyone browses and plays, nobody changes it from here', async () => {
    const f = await (await call('GET', '/api/finesse', USER_TOKEN)).json()
    assert.equal((f as { features: { games: boolean } }).features.games, true)
    const platforms = (await (await call('GET', '/games/api/platforms', USER_TOKEN)).json()) as { fs_slug: string }[]
    assert.deepEqual(platforms.map((p) => p.fs_slug), ['mystery', 'n64', 'psx', 'snes'])
    const roms = (await (await call('GET', '/games/api/roms?limit=500', USER_TOKEN)).json()) as { items: { id: number; name: string; fs_name: string }[] }
    const smw = roms.items.find((r) => r.name === 'Super Mario World')!
    romId = smw.id
    const file = await call('GET', `/games/api/roms/${romId}/content/${encodeURIComponent(smw.fs_name)}`, USER_TOKEN)
    assert.equal(file.status, 200)
    assert.equal(await file.text(), 'SMW-ROM-BYTES')
    // EmulatorJS's download carries no header: the games cookie does it.
    const byCookie = await fetch(`${base}/finesse/games/api/roms/${romId}/content/x`, { headers: { cookie: `finesse_games_token=${USER_TOKEN}` } })
    assert.equal(byCookie.status, 200)
    await byCookie.arrayBuffer()
    assert.equal((await call('GET', '/games/api/platforms', null)).status, 401)
    assert.equal((await call('DELETE', `/games/api/roms/${romId}`, USER_TOKEN)).status, 403)
    assert.equal((await call('DELETE', `/games/api/roms/${romId}`, ADMIN_TOKEN)).status, 405)
    assert.equal((await call('GET', '/games/assets/covers/123.png', USER_TOKEN)).status, 404)
    assert.equal((await call('GET', '/games/assets/emulatorjs/data/version.json', USER_TOKEN)).status, 404, 'the app then uses EmulatorJS’s CDN')
  })
})
