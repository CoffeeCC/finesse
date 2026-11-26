// Retro Games Engine, BIOS Upload & RomM Auto-Scan tests.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { Auth } from '../src/auth.ts'
import { SettingsStore } from '../src/config.ts'
import { consoleViews, registerConsoles } from '../src/emuapi.ts'
import { EmulatorDownloads } from '../src/emudownload.ts'
import { fingerprintOf } from '../src/fingerprint.ts'
import { Router, sendError } from '../src/http/core.ts'
import { Jellyfin } from '../src/jellyfin.ts'
import {
  allowedRetroUrl,
  extractRegion,
  groupRetroEntries,
  internetArchiveTarget,
  liveSearchRetro,
  normalizeConsoleSlug,
  parseHtmlAutoindex,
  parseInternetArchiveMetadata,
  parseJsonRetroFeed,
  previewRomImport,
  runRomImport,
  sanitizeFileName,
  scoreVariant,
  SHOWCASE_GAMES,
  triggerRommScan,
  type RetroGameEntry,
} from '../src/retro/retroStore.ts'
import { registerRetro } from '../src/retro/routes.ts'
import { Uploads } from '../src/uploads.ts'
import { listen, tmp } from './helpers.ts'
import { fakeJellyfin } from './peers.ts'

const MAGNET_SWITCH = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=SwitchGame'
const HASH_PS2 = 'fedcba9876543210fedcba9876543210fedcba98'

function makeStore(dir = tmp('retro-test-')) {
  return new SettingsStore({
    configDir: dir,
    settingsFile: join(dir, 'finesse.json'),
    invitesDb: join(dir, 'invites.db'),
    bakedWeb: dir,
    updatedWeb: dir,
    previews: dir,
    backups: dir,
  })
}

// ---------- 1. Console aliases, URL & filename validation ----------

test('normalizeConsoleSlug maps all common aliases to canonical RomM slugs', () => {
  const cases: [string, string][] = [
    ['SFC', 'snes'],
    ['Super Famicom', 'snes'],
    ['FC', 'nes'],
    ['Famicom', 'nes'],
    ['PSX', 'psx'],
    ['PS1', 'psx'],
    ['GC', 'ngc'],
    ['GAMECUBE', 'ngc'],
    ['MD', 'genesis'],
    ['MEGADRIVE', 'genesis'],
    ['Mega Drive', 'genesis'],
    ['GBA', 'gba'],
    ['GBC', 'gbc'],
    ['GB', 'gb'],
    ['N64', 'n64'],
    ['NDS', 'nds'],
    ['3DS', '3ds'],
    ['PSP', 'psp'],
    ['PS2', 'ps2'],
    ['WII', 'wii'],
    ['DC', 'dc'],
    ['DREAMCAST', 'dc'],
    ['SWITCH', 'switch'],
  ]
  for (const [alias, expected] of cases) {
    assert.equal(normalizeConsoleSlug(alias), expected, `expected ${alias} -> ${expected}`)
  }
})

test('allowedRetroUrl and sanitizeFileName enforce strict safety rules', () => {
  assert.ok(allowedRetroUrl('https://roms.example.org/snes/game.sfc'))
  assert.ok(allowedRetroUrl('http://127.0.0.1:8080/roms/gba/'))
  assert.ok(allowedRetroUrl('http://192.168.1.50/roms/'))
  assert.ok(allowedRetroUrl('http://nas.local/roms/'))
  assert.equal(allowedRetroUrl('http://public.example.com/game.sfc'), undefined)
  assert.equal(allowedRetroUrl('https://user:pass@example.com/game.sfc'), undefined)
  assert.equal(allowedRetroUrl('file:///etc/passwd'), undefined)
  assert.equal(allowedRetroUrl('javascript:alert(1)'), undefined)

  assert.equal(sanitizeFileName('Super Mario World (USA).sfc'), 'Super Mario World (USA).sfc')
  assert.equal(sanitizeFileName('../etc/passwd'), null)
  assert.equal(sanitizeFileName('sub/game.gba'), null)
  assert.equal(sanitizeFileName('sub\\game.gba'), null)
  assert.equal(sanitizeFileName('.hidden.gba'), null)
  assert.equal(sanitizeFileName('..'), null)
})

// ---------- 2. Region priority & smart deduping ----------

test('groupRetroEntries deduplicates variants and orders USA > World > Europe > En > Japan, avoiding Beta/Proto/[b]', () => {
  const source = { id: 'src-1', name: 'Test Archive' }
  const files = [
    { fileName: 'Super Mario World (Japan).sfc', url: 'https://cdn.example.org/smw-jp.sfc', console: 'snes', sizeBytes: 512000 },
    { fileName: 'Super Mario World (USA) (Beta).sfc', url: 'https://cdn.example.org/smw-beta.sfc', console: 'snes', sizeBytes: 512000 },
    { fileName: 'Super Mario World (USA) [b1].sfc', url: 'https://cdn.example.org/smw-bad.sfc', console: 'snes', sizeBytes: 512000 },
    { fileName: 'Super Mario World (Europe).sfc', url: 'https://cdn.example.org/smw-eu.sfc', console: 'snes', sizeBytes: 512000 },
    { fileName: 'Super Mario World (World).sfc', url: 'https://cdn.example.org/smw-world.sfc', console: 'snes', sizeBytes: 512000 },
    { fileName: 'Super Mario World (USA).sfc', url: 'https://cdn.example.org/smw-usa.sfc', console: 'snes', sizeBytes: 512000 },
    { fileName: 'Super Mario World (USA) (Rev 1).sfc', url: 'https://cdn.example.org/smw-usa-r1.sfc', console: 'snes', sizeBytes: 512000 },
    // Duplicate URL should be deduped
    { fileName: 'Super Mario World (USA).sfc', url: 'https://cdn.example.org/smw-usa.sfc', console: 'snes', sizeBytes: 512000 },
    { fileName: 'Super Mario World (En,Fr,De).sfc', url: 'https://cdn.example.org/smw-en.sfc', console: 'snes', sizeBytes: 512000 },
  ]

  assert.ok(scoreVariant('Game (USA).sfc') > scoreVariant('Game (World).sfc'))
  assert.ok(scoreVariant('Game (World).sfc') > scoreVariant('Game (Europe).sfc'))
  assert.ok(scoreVariant('Game (Europe).sfc') > scoreVariant('Game (En,Fr).sfc'))
  assert.ok(scoreVariant('Game (En,Fr).sfc') > scoreVariant('Game (Japan).sfc'))
  assert.ok(scoreVariant('Game (Japan).sfc') > scoreVariant('Game (USA) (Beta).sfc'))
  assert.ok(scoreVariant('Game (USA) (Beta).sfc') > scoreVariant('Game (USA) [b1].sfc'))
  assert.equal(extractRegion('Super Mario World (USA) (Beta).sfc'), 'USA (Beta)')

  const entries = groupRetroEntries(files, source)
  assert.equal(entries.length, 1)
  const smw = entries[0]!
  assert.equal(smw.title, 'Super Mario World')
  assert.equal(smw.console, 'snes')
  assert.equal(smw.consoleLabel, 'SNES')
  assert.equal(smw.variants.length, 8)
  assert.equal(smw.variants[0]!.fileName, 'Super Mario World (USA) (Rev 1).sfc')
  assert.equal(smw.variants[1]!.fileName, 'Super Mario World (USA).sfc')
  assert.equal(smw.variants[2]!.fileName, 'Super Mario World (World).sfc')
  assert.equal(smw.variants[3]!.fileName, 'Super Mario World (Europe).sfc')
  assert.equal(smw.variants[4]!.fileName, 'Super Mario World (En,Fr,De).sfc')
  assert.equal(smw.variants[5]!.fileName, 'Super Mario World (Japan).sfc')
  // Beta and [b1] should be dead last
  assert.equal(smw.variants[6]!.fileName, 'Super Mario World (USA) (Beta).sfc')
  assert.equal(smw.variants[7]!.fileName, 'Super Mario World (USA) [b1].sfc')
})

// ---------- 3. HTML autoindex, Internet Archive & JSON feed parsing ----------

test('parseHtmlAutoindex extracts ROMs, resolves relative URLs, parses sizes, and skips non-ROMs', () => {
  const html = `
    <html><body><table>
      <tr><td><a href="../">Parent directory/</a></td><td>-</td></tr>
      <tr><td><a href="README.txt">README.txt</a></td><td>1.2K</td></tr>
      <tr><td><a href="Chrono%20Trigger%20%28USA%29.zip">Chrono Trigger (USA).zip</a></td><td>3.2M</td></tr>
      <tr><td><a href="Chrono%20Trigger%20%28Japan%29.zip">Chrono Trigger (Japan).zip</a></td><td>3.1M</td></tr>
      <tr><td><a href="EarthBound%20%28USA%29.sfc">EarthBound (USA).sfc</a></td><td>2.5M</td></tr>
      <tr><td><a href="javascript:alert(1)">Evil.sfc</a></td><td>10K</td></tr>
    </table></body></html>
  `
  const entries = parseHtmlAutoindex(html, 'https://mirror.example.org/roms/SNES/', {
    id: 'myrient-snes',
    name: 'Myrient SNES',
    url: 'https://mirror.example.org/roms/SNES/',
  })

  assert.equal(entries.length, 2)
  const chrono = entries.find((e) => e.title === 'Chrono Trigger')!
  assert.ok(chrono)
  assert.equal(chrono.console, 'snes')
  assert.equal(chrono.variants.length, 2)
  assert.equal(chrono.variants[0]!.region, 'USA')
  assert.equal(chrono.variants[0]!.url, 'https://mirror.example.org/roms/SNES/Chrono%20Trigger%20%28USA%29.zip')
  assert.ok((chrono.sizeBytes ?? 0) > 3_000_000)
})

test('parseInternetArchiveMetadata extracts ROM files and ignores archive metadata files', () => {
  const target = internetArchiveTarget('https://archive.org/details/gba-homebrew-pack')
  assert.deepEqual(target, {
    identifier: 'gba-homebrew-pack',
    metadataUrl: 'https://archive.org/metadata/gba-homebrew-pack',
  })

  const doc = {
    metadata: { identifier: 'gba-homebrew-pack', title: 'Game Boy Advance Homebrew Pack' },
    files: [
      { name: 'gba-homebrew-pack_meta.xml', size: '1234' },
      { name: 'gba-homebrew-pack_files.xml', size: '5678' },
      { name: '__ia_thumb.jpg', size: '9999' },
      { name: 'Apotris (World).gba', size: '2097152' },
      { name: 'Apotris (Beta).gba', size: '1048576' },
      { name: 'NES/Micro Mages Demo (USA).nes', size: '40960' },
    ],
  }

  const entries = parseInternetArchiveMetadata(doc, {
    id: 'ia-gba',
    name: 'IA GBA Pack',
    url: 'https://archive.org/details/gba-homebrew-pack',
  })

  assert.equal(entries.length, 2)
  const apotris = entries.find((e) => e.title === 'Apotris')!
  assert.equal(apotris.console, 'gba')
  assert.equal(apotris.variants.length, 2)
  assert.equal(apotris.variants[0]!.fileName, 'Apotris (World).gba')
  assert.equal(apotris.variants[0]!.url, 'https://archive.org/download/gba-homebrew-pack/Apotris%20(World).gba')

  const micro = entries.find((e) => e.title === 'Micro Mages Demo')!
  assert.equal(micro.console, 'nes')
  assert.equal(micro.variants[0]!.url, 'https://archive.org/download/gba-homebrew-pack/NES/Micro%20Mages%20Demo%20(USA).nes')
})

test('parseJsonRetroFeed parses curated JSON feeds and rejects unsafe URLs', () => {
  const entries = parseJsonRetroFeed(
    {
      games: [
        {
          title: 'Goodboy Galaxy Demo',
          console: 'gba',
          summary: 'Exploration platformer demo',
          year: 2023,
          variants: [
            { fileName: 'Goodboy Galaxy (USA).gba', url: 'https://cdn.example.org/goodboy.gba', sizeBytes: 4194304 },
            { fileName: 'Evil.gba', url: 'http://insecure.example.com/evil.gba', sizeBytes: 100 },
          ],
        },
      ],
    },
    { id: 'json-1', name: 'JSON Feed', url: 'https://cdn.example.org/feed.json' },
  )
  assert.equal(entries.length, 1)
  assert.equal(entries[0]!.variants.length, 1)
  assert.equal(entries[0]!.variants[0]!.fileName, 'Goodboy Galaxy (USA).gba')
})

// ---------- 4. NAS folder import preview & run ----------

test('previewRomImport and runRomImport map folder aliases, walk 2 levels, copy cleanly, and skip existing files', async () => {
  const work = tmp('retro-import-')
  const nas = join(work, 'nas-roms')
  const destData = join(work, 'finesse-data')
  mkdirSync(join(nas, 'SFC'), { recursive: true })
  mkdirSync(join(nas, 'PSX'), { recursive: true })
  mkdirSync(join(nas, 'MD'), { recursive: true })
  mkdirSync(join(nas, 'Nintendo', 'GC'), { recursive: true })
  mkdirSync(join(nas, '.hidden'), { recursive: true })

  writeFileSync(join(nas, 'SFC', 'Super Metroid (USA).sfc'), 'snes-rom-bytes')
  writeFileSync(join(nas, 'PSX', 'Ridge Racer (USA).chd'), 'psx-chd-bytes')
  writeFileSync(join(nas, 'MD', 'Sonic (USA).md'), 'genesis-bytes')
  writeFileSync(join(nas, 'MD', 'README.md'), '# ignore doc file')
  writeFileSync(join(nas, 'Nintendo', 'GC', 'Melee (USA).rvz'), 'gc-rvz-bytes')
  writeFileSync(join(nas, 'TopLevel.gba'), 'gba-top-level')
  writeFileSync(join(nas, '.hidden', 'Secret.nes'), 'hidden-skip')
  writeFileSync(join(nas, 'notes.txt'), 'not a rom')

  const preview = previewRomImport(nas)
  assert.equal(preview.totalFiles, 5)
  assert.ok(preview.totalBytes > 0)
  const slugs = preview.consoles.map((c) => c.slug).sort()
  assert.deepEqual(slugs, ['gba', 'genesis', 'ngc', 'psx', 'snes'])

  const scanned: string[] = []
  const mockFetch: typeof fetch = async (input) => {
    const u = typeof input === 'string' ? input : input.toString()
    scanned.push(u)
    if (u.endsWith('/api/platforms/filesystem')) return new Response(JSON.stringify([]), { status: 200 })
    if (u.endsWith('/api/tasks/run/scan_library')) return new Response(JSON.stringify({ ok: true }), { status: 200 })
    return new Response('', { status: 404 })
  }

  const fakeSettings = {
    version: 1 as const,
    instanceId: 'test',
    mode: 'bundle' as const,
    createdAt: new Date().toISOString(),
    jellyfin: { basePath: '' },
    services: { romm: { url: 'http://romm.local:8080', username: 'u', password: 'p' } },
    setup: { state: 'ready' as const },
    updates: { repo: 'o/r', auto: false },
    stack: { hostRoot: work, hostData: destData, timezone: 'UTC', puid: 1000, pgid: 1000, services: ['romm'] },
  }

  const first = await runRomImport(nas, fakeSettings, { fetch: mockFetch })
  assert.deepEqual(first, { imported: 5, skipped: 0, consoles: 5 })
  assert.equal(readFileSync(join(destData, 'media/games/roms/snes/Super Metroid (USA).sfc'), 'utf8'), 'snes-rom-bytes')
  assert.equal(readFileSync(join(destData, 'media/games/roms/psx/Ridge Racer (USA).chd'), 'utf8'), 'psx-chd-bytes')
  assert.equal(readFileSync(join(destData, 'media/games/roms/genesis/Sonic (USA).md'), 'utf8'), 'genesis-bytes')
  assert.equal(readFileSync(join(destData, 'media/games/roms/ngc/Melee (USA).rvz'), 'utf8'), 'gc-rvz-bytes')
  assert.equal(readFileSync(join(destData, 'media/games/roms/gba/TopLevel.gba'), 'utf8'), 'gba-top-level')
  assert.equal(existsSync(join(destData, 'media/games/roms/genesis/README.md')), false)

  // Wait briefly for fire-and-forget RomM scan trigger
  await new Promise((r) => setTimeout(r, 30))
  assert.ok(scanned.some((u) => u.includes('/api/tasks/run/scan_library')))

  // Re-running skips all existing files
  const second = await runRomImport(nas, fakeSettings, { fetch: mockFetch })
  assert.deepEqual(second, { imported: 0, skipped: 5, consoles: 0 })
})

// ---------- 5. Prowlarr Console Live Search (category 1000) ----------

test('liveSearchRetro queries Prowlarr category 1000, hides API keys, detects consoles, and filters', async () => {
  assert.deepEqual(await liveSearchRetro('zelda'), { available: false, items: [] })

  const seenUrls: string[] = []
  const mockFetch: typeof fetch = async (input, init) => {
    const u = typeof input === 'string' ? input : input.toString()
    seenUrls.push(u)
    assert.equal((init?.headers as Record<string, string>)['X-Api-Key'], 'secret-prowlarr-key')
    return new Response(
      JSON.stringify([
        {
          title: 'The Legend of Zelda Breath of the Wild [Switch][NSP]',
          size: 14_000_000_000,
          seeders: 120,
          indexer: 'NxBrew',
          magnetUrl: MAGNET_SWITCH,
        },
        {
          title: 'Shadow of the Colossus (PS2) (USA)',
          size: 2_500_000_000,
          seeders: 45,
          indexer: 'RetroIdx',
          infoHash: HASH_PS2,
        },
        {
          title: 'Mario Kart DS',
          size: 33_554_432,
          seeders: 80,
          indexer: 'PrivateIdx',
          categories: [{ id: 1010 }],
          downloadUrl: 'http://prowlarr.local:9696/1/download?apikey=secret-prowlarr-key&file=mkds',
        },
      ]),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const all = await liveSearchRetro('zelda', {
    prowlarr: { url: 'http://prowlarr.local:9696', apiKey: 'secret-prowlarr-key' },
    fetch: mockFetch,
  })

  assert.equal(all.available, true)
  assert.ok(seenUrls[0]!.includes('categories=1000&type=search'))
  assert.equal(all.items.length, 3)
  assert.equal(all.items[0]!.console, 'switch')
  assert.equal(all.items[0]!.downloadUrl, MAGNET_SWITCH)
  const ds = all.items.find((i) => i.console === 'nds')!
  assert.ok(ds.downloadUrl.startsWith('prowlarr://'))
  const ps2 = all.items.find((i) => i.console === 'ps2')!
  assert.ok(ps2.downloadUrl.startsWith(`magnet:?xt=urn:btih:${HASH_PS2}`))
  // Never leaks API key
  assert.equal(JSON.stringify(all).includes('secret-prowlarr-key'), false)

  // Filtering by console
  const filtered = await liveSearchRetro('zelda', {
    console: 'switch',
    prowlarr: { url: 'http://prowlarr.local:9696', apiKey: 'secret-prowlarr-key' },
    fetch: mockFetch,
  })
  assert.equal(filtered.items.length, 1)
  assert.equal(filtered.items[0]!.console, 'switch')
})

// ---------- 6. triggerRommScan ----------

test('triggerRommScan registers new filesystem platforms and starts scan', async () => {
  const work = tmp('retro-romm-')
  mkdirSync(join(work, 'media/games/roms/gba'), { recursive: true })
  const calls: string[] = []
  const mockFetch: typeof fetch = async (input, init) => {
    const u = typeof input === 'string' ? input : input.toString()
    calls.push(`${init?.method ?? 'GET'} ${new URL(u).pathname}`)
    if (u.endsWith('/api/platforms/filesystem')) return new Response(JSON.stringify([{ fs_slug: 'gba' }]), { status: 200 })
    if (u.endsWith('/api/platforms')) return new Response(JSON.stringify({ ok: true }), { status: 201 })
    if (u.endsWith('/api/tasks/run/scan_library')) return new Response(JSON.stringify({ ok: true }), { status: 200 })
    return new Response('', { status: 404 })
  }

  const res = await triggerRommScan(
    {
      version: 1,
      instanceId: 'i',
      mode: 'bundle',
      createdAt: '',
      jellyfin: { basePath: '' },
      services: { romm: { url: 'http://romm.local:8080', username: 'admin', password: 'pw' } },
      setup: { state: 'ready' },
      updates: { repo: 'o/r', auto: false },
      stack: { hostRoot: work, hostData: work, timezone: 'UTC', puid: 1000, pgid: 1000, services: ['romm'] },
    },
    { fetch: mockFetch },
  )
  assert.equal(res.ok, true)
  assert.deepEqual(calls, ['GET /api/platforms/filesystem', 'POST /api/platforms', 'POST /api/tasks/run/scan_library'])
})

// ---------- 7. Uploads auto-RomM scan ----------

test('Uploads triggers debounced RomM scan when a games file finishes uploading or is removed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const data = tmp('retro-uploads-')
  let rommScans = 0
  let jfScans = 0
  const s = {
    mode: 'bundle',
    setup: { state: 'ready' },
    stack: { hostData: data, puid: 1000, pgid: 1000 },
    services: { romm: { url: 'http://romm.local:8080', username: 'u', password: 'p' } },
    jellyfin: { url: 'http://jf', apiKey: 'k' },
  }
  const settings = { get: () => s } as unknown as SettingsStore
  const jfApi = { list: async () => [], count: async () => 0, scan: async () => void jfScans++ }
  const up = new Uploads(settings, jfApi, async () => void rommScans++)

  const payload = Buffer.from('fake-gba-rom-content')
  const fp = fingerprintOf(payload, payload, payload.length)
  const b = up.begin({ kind: 'games', path: 'gba/Apotris.gba', size: payload.length, fingerprint: fp })
  const fin = await up.write(b.id!, 0, payload.length, Readable.from([payload]))
  assert.equal(fin.done, true)
  assert.equal(rommScans, 0)
  t.mock.timers.tick(8000)
  assert.equal(rommScans, 1)
  assert.equal(jfScans, 0)

  // Removing the game file also triggers a debounced RomM scan
  up.remove(fin.receipt!)
  t.mock.timers.tick(8000)
  assert.equal(rommScans, 2)
})

// ---------- 8. End-to-end HTTP routes: /api/retro/* & BIOS upload ----------

test('HTTP routes: /api/retro/* and POST /api/emulators/consoles/:id/upload', async () => {
  const work = tmp('retro-http-')
  const dataDir = join(work, 'data')
  const nasDir = join(work, 'nas')
  mkdirSync(join(dataDir, 'media/games/roms'), { recursive: true })
  mkdirSync(join(nasDir, 'SFC'), { recursive: true })
  writeFileSync(join(nasDir, 'SFC', 'Chrono Trigger (USA).sfc'), 'ct-rom-data')

  const jf = await fakeJellyfin(
    'RetroTest',
    [
      { name: 'Admin', token: 'tok-admin', admin: true },
      { name: 'Member', token: 'tok-member', admin: false },
      { name: 'Kid', token: 'tok-kid', admin: false },
    ],
    'svc-key',
  )

  // Local HTTP server acting as both an HTML autoindex ROM source + ROM file host + fake RomM
  const romBytes = Buffer.from('FAKE_GBA_ROM_HEADER_1234567890')
  let rommScanCalls = 0
  const upstream = createServer((req: IncomingMessage, res: ServerResponse) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (u.pathname === '/roms/gba/') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      return void res.end(`
        <a href="Goodboy%20Galaxy%20%28USA%29.gba">Goodboy Galaxy (USA).gba</a> 30B
        <a href="Goodboy%20Galaxy%20%28Europe%29.gba">Goodboy Galaxy (Europe).gba</a> 30B
      `)
    }
    if (u.pathname === '/roms/gba/Goodboy%20Galaxy%20%28USA%29.gba') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(romBytes.length) })
      return void res.end(romBytes)
    }
    if (u.pathname === '/api/platforms/filesystem') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return void res.end('[]')
    }
    if (u.pathname === '/api/tasks/run/scan_library' && req.method === 'POST') {
      rommScanCalls++
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return void res.end(JSON.stringify({ ok: true }))
    }
    res.writeHead(404)
    res.end()
  })
  const upstreamUrl = await listen(upstream)

  const settings = makeStore(join(work, 'config'))
  const kidId = [...jf.users.values()].find((u) => u.Name === 'Kid')!.Id.toLowerCase()
  settings.update((s) => {
    s.mode = 'bundle'
    s.setup.state = 'ready'
    s.jellyfin.url = jf.url
    s.jellyfin.apiKey = 'svc-key'
    s.services.romm = { url: upstreamUrl, username: 'admin', password: 'pw' }
    s.stack = { hostRoot: work, hostData: dataDir, timezone: 'UTC', puid: 1000, pgid: 1000, services: ['romm'] }
    s.parental = { [kidId]: { maxAge: 10, blockUnrated: true, requests: false } }
    s.emulators = {
      apps: ['pcsx2'],
      paths: {
        roms: join(dataDir, 'media/games'),
        firmware: join(dataDir, 'games/firmware'),
        keys: join(dataDir, 'games/keys'),
        saves: join(dataDir, 'games/saves'),
      },
    }
  })

  const router = new Router()
  const auth = new Auth(settings, new Jellyfin(settings))
  const downloads = new EmulatorDownloads(join(work, 'config', 'emulators'))
  registerRetro(router, { settings, auth })
  registerConsoles(router, { settings, auth, docker: null, downloads })

  const appServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    try {
      const ok = await router.dispatch({ req, res, path: url.pathname, url })
      if (!ok) {
        res.writeHead(404)
        res.end()
      }
    } catch (e) {
      sendError(res, e)
    }
  })
  const base = await listen(appServer)

  const h = (tok: string) => ({ Authorization: `MediaBrowser Client="test", Device="t", DeviceId="t", Version="1", Token="${tok}"` })

  try {
    // 1. Unauthenticated rejected
    assert.equal((await fetch(`${base}/api/retro/catalog`)).status, 401)

    // 2. Member can view catalog: always 2 showcase games, homebrew initially off
    const cat1 = await fetch(`${base}/api/retro/catalog`, { headers: h('tok-member') })
    assert.equal(cat1.status, 200)
    const cat1Json = (await cat1.json()) as {
      romsWritable: boolean
      homebrewEnabled: boolean
      showcase: RetroGameEntry[]
      items: RetroGameEntry[]
      sourcesCount: number
    }
    assert.equal(cat1Json.romsWritable, true)
    assert.equal(cat1Json.homebrewEnabled, false)
    assert.equal(cat1Json.showcase.length, 2)
    assert.equal(cat1Json.showcase[0]!.id, SHOWCASE_GAMES[0]!.id)
    assert.equal(cat1Json.items.length, 0)
    assert.equal(cat1Json.sourcesCount, 0)

    // 3. Non-admin cannot change settings or add sources
    assert.equal(
      (await fetch(`${base}/api/retro/settings`, { method: 'PUT', headers: { ...h('tok-member'), 'Content-Type': 'application/json' }, body: JSON.stringify({ homebrew: true }) })).status,
      403,
    )

    // 4. Admin enables homebrew shelf
    const setRes = await fetch(`${base}/api/retro/settings`, {
      method: 'PUT',
      headers: { ...h('tok-admin'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ homebrew: true }),
    })
    assert.equal(setRes.status, 200)
    assert.deepEqual(await setRes.json(), { homebrew: true })

    // 5. Admin adds HTML autoindex source (synced immediately)
    const addSrc = await fetch(`${base}/api/retro/sources`, {
      method: 'POST',
      headers: { ...h('tok-admin'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Local GBA', url: `${upstreamUrl}/roms/gba/` }),
    })
    assert.equal(addSrc.status, 201)
    const addSrcJson = (await addSrc.json()) as { source: { id: string }; status: { ok: boolean; games: number } }
    assert.equal(addSrcJson.status.ok, true)
    assert.equal(addSrcJson.status.games, 1)

    // 6. Catalog now includes synced source + homebrew shelf + console filter
    const cat2 = await (await fetch(`${base}/api/retro/catalog?q=goodboy&console=gba`, { headers: h('tok-member') })).json() as {
      homebrewEnabled: boolean
      items: RetroGameEntry[]
      consoles: { slug: string; count: number }[]
      sourcesCount: number
    }
    assert.equal(cat2.homebrewEnabled, true)
    assert.equal(cat2.sourcesCount, 1)
    assert.equal(cat2.items.length, 1)
    assert.equal(cat2.items[0]!.title, 'Goodboy Galaxy')
    assert.equal(cat2.items[0]!.variants[0]!.region, 'USA')

    // 7. Kid with requests=false is refused download
    const kidDl = await fetch(`${base}/api/retro/download`, {
      method: 'POST',
      headers: { ...h('tok-kid'), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Goodboy Galaxy',
        console: 'gba',
        fileName: 'Goodboy Galaxy (USA).gba',
        url: `${upstreamUrl}/roms/gba/Goodboy%20Galaxy%20%28USA%29.gba`,
      }),
    })
    assert.equal(kidDl.status, 403)

    // 8. Member starts download -> streams to disk -> ready + RomM scan triggered
    const dlRes = await fetch(`${base}/api/retro/download`, {
      method: 'POST',
      headers: { ...h('tok-member'), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Goodboy Galaxy',
        console: 'gba',
        fileName: 'Goodboy Galaxy (USA).gba',
        url: `${upstreamUrl}/roms/gba/Goodboy%20Galaxy%20%28USA%29.gba`,
      }),
    })
    assert.equal(dlRes.status, 201)
    const job = (await dlRes.json()) as { id: string; state: string }
    assert.ok(job.id)

    // Poll briefly until async download finishes
    let finalState = job.state
    for (let i = 0; i < 40 && finalState === 'downloading'; i++) {
      await new Promise((r) => setTimeout(r, 25))
      const list = (await (await fetch(`${base}/api/retro/downloads`, { headers: h('tok-member') })).json()) as {
        downloads: { id: string; state: string; progress: number }[]
      }
      const hit = list.downloads.find((d) => d.id === job.id)
      finalState = hit?.state ?? finalState
    }
    assert.equal(finalState, 'ready')
    assert.deepEqual(readFileSync(join(dataDir, 'media/games/roms/gba/Goodboy Galaxy (USA).gba')), romBytes)
    assert.ok(rommScanCalls >= 1)

    // 9. Sources GET, sync, DELETE
    const srcList = (await (await fetch(`${base}/api/retro/sources`, { headers: h('tok-admin') })).json()) as {
      homebrew: boolean
      romsDir: string
      sources: { id: string; status: { ok: boolean } }[]
    }
    assert.equal(srcList.homebrew, true)
    assert.equal(srcList.romsDir, join(dataDir, 'media/games/roms'))
    assert.equal(srcList.sources.length, 1)

    const syncRes = await fetch(`${base}/api/retro/sources/sync`, { method: 'POST', headers: h('tok-admin') })
    assert.equal(syncRes.status, 200)
    const delRes = await fetch(`${base}/api/retro/sources/${addSrcJson.source.id}`, { method: 'DELETE', headers: h('tok-admin') })
    assert.equal(delRes.status, 200)
    assert.deepEqual(await delRes.json(), { ok: true })

    // 10. Import preview, import run, and manual RomM scan
    const prevRes = await fetch(`${base}/api/retro/import/preview`, {
      method: 'POST',
      headers: { ...h('tok-admin'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: nasDir }),
    })
    assert.equal(prevRes.status, 200)
    assert.equal(((await prevRes.json()) as { totalFiles: number }).totalFiles, 1)

    const runRes = await fetch(`${base}/api/retro/import/run`, {
      method: 'POST',
      headers: { ...h('tok-admin'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: nasDir }),
    })
    assert.equal(runRes.status, 200)
    assert.deepEqual(await runRes.json(), { imported: 1, skipped: 0, consoles: 1 })

    const scanRes = await fetch(`${base}/api/retro/scan`, { method: 'POST', headers: h('tok-admin') })
    assert.equal(scanRes.status, 200)
    assert.equal(((await scanRes.json()) as { ok: boolean }).ok, true)

    // 11. 1-click BIOS upload endpoint + ConsoleNeed.what exposure
    const beforeViews = consoleViews(settings.get(), downloads)
    const ps2NeedBefore = beforeViews.find((c) => c.id === 'pcsx2')!.needs.find((n) => n.label === 'PS2 BIOS')!
    assert.equal(ps2NeedBefore.what, 'firmware')
    assert.equal(ps2NeedBefore.ok, false)

    // Non-admin rejected
    assert.equal(
      (await fetch(`${base}/api/emulators/consoles/pcsx2/upload?what=firmware&name=scph10000.bin`, {
        method: 'POST',
        headers: h('tok-member'),
        body: Buffer.from('bios-bytes'),
      })).status,
      403,
    )

    // Path traversal rejected
    assert.equal(
      (await fetch(`${base}/api/emulators/consoles/pcsx2/upload?what=firmware&name=../evil.bin`, {
        method: 'POST',
        headers: h('tok-admin'),
        body: Buffer.from('bios-bytes'),
      })).status,
      400,
    )

    // Valid BIOS upload succeeds and flips PS2 BIOS need to ok: true
    const biosPayload = Buffer.from('PS2_BIOS_BINARY_IMAGE_DATA')
    const upRes = await fetch(`${base}/api/emulators/consoles/pcsx2/upload?what=firmware&name=scph10000.bin`, {
      method: 'POST',
      headers: h('tok-admin'),
      body: biosPayload,
    })
    assert.equal(upRes.status, 200)
    const upJson = (await upRes.json()) as { ok: boolean; fileName: string; consoles: ReturnType<typeof consoleViews> }
    assert.equal(upJson.ok, true)
    assert.equal(upJson.fileName, 'scph10000.bin')
    assert.deepEqual(readFileSync(join(dataDir, 'games/firmware/pcsx2/scph10000.bin')), biosPayload)
    const ps2NeedAfter = upJson.consoles.find((c) => c.id === 'pcsx2')!.needs.find((n) => n.label === 'PS2 BIOS')!
    assert.equal(ps2NeedAfter.ok, true)
    assert.equal(ps2NeedAfter.what, 'firmware')
  } finally {
    await new Promise<void>((r) => { appServer.closeAllConnections(); appServer.close(() => r()) })
    await new Promise<void>((r) => { upstream.closeAllConnections(); upstream.close(() => r()) })
    await new Promise<void>((r) => { jf.server.closeAllConnections(); jf.server.close(() => r()) })
  }
})
