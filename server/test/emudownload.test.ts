// Finesse's emulator downloads: the pinned catalog, and the downloader against
// a fake server (Range requests, a server that ignores them, a bad file, an
// update), plus the settings and setup document that drive them.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { test } from 'node:test'
import { EMULATOR_PINS, INSTALL_IDS, type PinnedEmulator } from '../src/emucatalog.ts'
import { EmulatorDownloads } from '../src/emudownload.ts'
import { consoleViews, withConsoles } from '../src/emuapi.ts'
import { emulatorCatalog, launchScript, appMounts, validateEmulators } from '../src/emulators.ts'
import { validateSetup } from '../src/setup/doc.ts'
import { listen, tmp } from './helpers.ts'

const globRe = (p: string) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i')

test('the catalog: pinned, checked, from the projects’ own releases; Eden for Switch, no Ryujinx', () => {
  assert.deepEqual(EMULATOR_PINS.map((p) => p.id), INSTALL_IDS)
  const cat = emulatorCatalog('eden')
  for (const p of EMULATOR_PINS) {
    assert.match(p.url, /^https:\/\//, p.id)
    assert.match(p.sha256, /^[0-9a-f]{64}$/, p.id)
    assert.ok(p.size > 10_000_000, p.id)
    assert.ok(p.license && p.version && p.source, p.id)
    assert.ok(p.url.endsWith(encodeURI(p.file).replace(/%40/g, '@')) || p.url.endsWith(p.file), `${p.id}: saved under its own name`)
    // The file matches what the app looks for, so the launch script finds it.
    assert.ok(cat[p.app].program.some((g) => !g.includes('/') && globRe(g).test(p.file)), `${p.id}: ${p.file}`)
  }
  assert.ok(!EMULATOR_PINS.some((p) => /ryujinx/i.test(p.id + p.url)))
  assert.equal(EMULATOR_PINS.find((p) => p.app === 'switch')!.id, 'eden')
  // Only Dolphin isn't the project's own build, and it says so.
  assert.deepEqual(EMULATOR_PINS.filter((p) => !p.official).map((p) => p.id), ['dolphin'])
  assert.match(EMULATOR_PINS.find((p) => p.id === 'dolphin')!.source, /community/)
})

/** A release server for one file, counting requests and Range headers. */
async function fakeRelease(body: Buffer, opts: { ignoreRange?: boolean; corrupt?: boolean } = {}) {
  const seen: { range: string | null }[] = []
  const server = createServer((req, res) => {
    seen.push({ range: (req.headers.range as string) ?? null })
    const data = opts.corrupt ? Buffer.from(body).fill(1, 0, 10) : body
    const m = /^bytes=(\d+)-$/.exec(String(req.headers.range ?? ''))
    if (m && !opts.ignoreRange) {
      const from = Number(m[1])
      res.writeHead(206, { 'Content-Length': String(data.length - from), 'Content-Range': `bytes ${from}-${data.length - 1}/${data.length}` })
      return res.end(data.subarray(from))
    }
    res.writeHead(200, { 'Content-Length': String(data.length) })
    res.end(data)
  })
  const url = await listen(server)
  return { url, seen, close: () => new Promise((r) => server.close(r)) }
}

const blob = Buffer.from(Array.from({ length: 300_000 }, (_, i) => (i * 31) % 251))
const pinOf = (url: string, over: Partial<PinnedEmulator> = {}): PinnedEmulator => ({
  ...EMULATOR_PINS[0]!,
  url: `${url}/pcsx2.AppImage`,
  sha256: createHash('sha256').update(blob).digest('hex'),
  size: blob.length,
  ...over,
})

test('downloads, checks the sha256, makes it executable; asking again changes nothing', async () => {
  const srv = await fakeRelease(blob)
  try {
    const d = new EmulatorDownloads(tmp('emudl-'), [pinOf(srv.url)])
    assert.equal(d.status('pcsx2').state, 'missing')
    await d.ensure(['pcsx2'])
    const f = join(d.dir, EMULATOR_PINS[0]!.file)
    assert.deepEqual(readFileSync(f), blob)
    assert.equal(statSync(f).mode & 0o777, 0o755)
    assert.equal(d.status('pcsx2').state, 'ready')
    assert.ok(!existsSync(`${f}.part`))
    await d.ensure(['pcsx2'])
    assert.equal(srv.seen.length, 1, 'the right version is there: no second download')
  } finally {
    await srv.close()
  }
})

test('a partial download continues with a Range request; a server that ignores it starts over', async () => {
  for (const ignoreRange of [false, true]) {
    const srv = await fakeRelease(blob, { ignoreRange })
    try {
      const d = new EmulatorDownloads(tmp('emudl-'), [pinOf(srv.url)])
      mkdirSync(d.dir, { recursive: true })
      writeFileSync(join(d.dir, `${EMULATOR_PINS[0]!.file}.part`), blob.subarray(0, 120_000))
      await d.ensure(['pcsx2'])
      assert.equal(srv.seen[0]!.range, 'bytes=120000-')
      assert.equal(d.status('pcsx2').state, 'ready', ignoreRange ? 'restarted' : 'resumed')
      assert.deepEqual(readFileSync(join(d.dir, EMULATOR_PINS[0]!.file)), blob)
    } finally {
      await srv.close()
    }
  }
})

test('a file that fails its check is deleted, and the status says so in plain words', async () => {
  const srv = await fakeRelease(blob, { corrupt: true })
  try {
    const d = new EmulatorDownloads(tmp('emudl-'), [pinOf(srv.url)])
    await d.ensure(['pcsx2'])
    const st = d.status('pcsx2')
    assert.equal(st.state, 'failed')
    assert.match(st.error!, /checksum/)
    assert.ok(!existsSync(join(d.dir, EMULATOR_PINS[0]!.file)))
    assert.ok(!existsSync(join(d.dir, `${EMULATOR_PINS[0]!.file}.part`)))
  } finally {
    await srv.close()
  }
  // A server that's gone: failed, with what to do; nothing half-done left as "ready".
  const d = new EmulatorDownloads(tmp('emudl-'), [pinOf('http://127.0.0.1:9')])
  await d.ensure(['pcsx2'])
  assert.equal(d.status('pcsx2').state, 'failed')
  assert.match(d.status('pcsx2').error!, /Try again|picks up/)
})

test('a newer pin is "an update" until asked for; then the old file goes', async () => {
  const srv = await fakeRelease(blob)
  try {
    const dir = tmp('emudl-')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'pcsx2-v2.0.0-linux-appimage-x64-Qt.AppImage'), 'old')
    writeFileSync(join(dir, 'finesse-emulators.json'), JSON.stringify({ pcsx2: { file: 'pcsx2-v2.0.0-linux-appimage-x64-Qt.AppImage', sha256: 'x'.repeat(64), version: '2.0.0' } }))
    const d = new EmulatorDownloads(dir, [pinOf(srv.url)])
    assert.equal(d.status('pcsx2').state, 'update')
    assert.equal(d.status('pcsx2').installed, '2.0.0')
    assert.equal(srv.seen.length, 0, 'never on its own')
    await d.ensure(['pcsx2'])
    assert.equal(d.status('pcsx2').state, 'ready')
    assert.ok(!existsSync(join(dir, 'pcsx2-v2.0.0-linux-appimage-x64-Qt.AppImage')))
    d.remove('pcsx2')
    assert.equal(d.status('pcsx2').state, 'missing')
    assert.ok(!existsSync(join(dir, EMULATOR_PINS[0]!.file)))
  } finally {
    await srv.close()
  }
})

test('downloaded emulators: mounted beside your own folder, which wins; no own folder needed', () => {
  const s = { apps: ['pcsx2' as const], paths: { roms: '/srv/games', saves: '/srv/saves' }, install: ['pcsx2' as const], managedDir: '/srv/finesse/config/emulators' }
  assert.deepEqual(validateEmulators(s), [])
  assert.notDeepEqual(validateEmulators({ ...s, install: [] }), [], 'without a download, the emulators folder is needed')
  assert.notDeepEqual(validateEmulators({ ...s, install: ['ryujinx'] }), [])
  assert.ok(appMounts('pcsx2', s, 'p').includes('/srv/finesse/config/emulators:/finesse/emulators-finesse:ro'))
  const cat = emulatorCatalog()
  assert.match(launchScript(cat.pcsx2, Object.values(cat)), /for d in \/finesse\/emulators \/finesse\/emulators-finesse;/)
  assert.notDeepEqual(validateEmulators({ apps: ['switch'], switchEmulator: 'ryujinx', paths: { roms: '/r', saves: '/s' }, install: ['eden'] }), [], 'Ryujinx is always your own')
})

test('adding consoles on a server Finesse set up: apps, Eden as the Switch app, folders beside the library', () => {
  const base = { mode: 'bundle', stack: { hostData: '/srv/data' } } as never
  const e = withConsoles(base, ['pcsx2', 'eden'], [], '/srv/root/config/finesse/emulators')
  assert.deepEqual(e.apps.sort(), ['pcsx2', 'switch'])
  assert.equal(e.switchEmulator, 'eden')
  assert.deepEqual(e.install, ['pcsx2', 'eden'])
  assert.deepEqual(e.paths, { roms: '/srv/data/media/games', firmware: '/srv/data/games/firmware', keys: '/srv/data/games/keys', saves: '/srv/data/games/saves' })
  assert.deepEqual(validateEmulators(e), [])
  const less = withConsoles({ ...(base as object), emulators: e } as never, [], ['pcsx2'], e.managedDir!)
  assert.deepEqual(less.apps, ['switch'])
  // Someone's own folders stay as they are.
  const own = withConsoles({ mode: 'adopt', emulators: { apps: ['dolphin'], paths: { roms: '/mnt/g', emulators: '/mnt/g/emulators', saves: '/mnt/g/saves' } } } as never, ['cemu'], ['dolphin'], '/c/emulators')
  assert.equal(own.paths.roms, '/mnt/g')
  assert.deepEqual(own.apps.sort(), ['cemu', 'dolphin'], 'your own Dolphin keeps its console')
})

test('each console says what it still needs, and where to put it', () => {
  const dir = tmp('emuview-')
  for (const d of ['roms/roms/ps2', 'saves', 'firmware/pcsx2']) mkdirSync(join(dir, d), { recursive: true })
  const s = { mode: 'adopt', emulators: { apps: ['pcsx2'], paths: { roms: join(dir, 'roms'), firmware: join(dir, 'firmware'), saves: join(dir, 'saves') }, install: ['pcsx2'], managedDir: '/x' } } as never
  const d = new EmulatorDownloads(join(dir, 'managed'))
  const v = consoleViews(s, d).find((c) => c.id === 'pcsx2')!
  assert.equal(v.added, true)
  assert.equal(v.ready, false)
  const bios = v.needs.find((n) => n.label === 'PS2 BIOS')!
  assert.equal(bios.ok, false)
  assert.equal(bios.folder, join(dir, 'firmware', 'pcsx2'))
  // The file appears: noticed on the next look, no restart.
  writeFileSync(join(dir, 'firmware/pcsx2/scph39001.bin'), '')
  assert.equal(consoleViews(s, d).find((c) => c.id === 'pcsx2')!.needs.find((n) => n.label === 'PS2 BIOS')!.ok, true)
  assert.equal(consoleViews(s, d).find((c) => c.id === 'cemu')!.added, false)
})

test('the setup document takes the consoles to download', () => {
  const doc = (emulators: unknown) => ({ version: 1, admin: { username: 'a', password: 'longenough1' }, libraries: { movies: true, games: true }, emulators })
  assert.deepEqual(validateSetup(doc({ apps: [], paths: {}, install: ['pcsx2', 'dolphin', 'rpcs3', 'cemu', 'eden'] })).problems.filter((p) => p.path.startsWith('emulators')), [])
  assert.ok(validateSetup(doc({ apps: [], paths: {}, install: ['ryujinx'] })).problems.some((p) => p.path === 'emulators.install'))
})
