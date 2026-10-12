// Part of windows/e2e.ps1, run with the node.exe Finesse installed: Add media and Games on a real
// Windows install. Signs in to Jellyfin as the setup's admin, adds a movie and a game the way the
// app does (Windows paths: \ not /), turns Games on (Finesse's own library, no RomM) and plays the
// game's file back through the Games API.
//
//   node e2e-media.mjs <finesse url> <jellyfin url> <user> <password> <media folder>

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const [finesse, jellyfin, user, password, media] = process.argv.slice(2)
const say = (m) => console.log(`  ${m}`)
const fail = (m) => {
  console.error(`FAILED: ${m}`)
  process.exit(1)
}

// src/lib/fingerprint.ts / server/src/fingerprint.ts (the server checks it once a file is in).
function cyrb53(bytes, seed = 0) {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i]
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}
const fingerprint = (buf) => {
  const head = buf.subarray(0, 1 << 20)
  const tail = buf.subarray(Math.max(0, buf.length - (1 << 20)))
  return `${buf.length.toString(36)}-${cyrb53(Buffer.concat([head, tail]))}`
}

const sign = await fetch(`${jellyfin}/Users/AuthenticateByName`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'MediaBrowser Client="Finesse CI", Device="CI", DeviceId="finesse-ci", Version="1.0"' },
  body: JSON.stringify({ Username: user, Pw: password }),
})
if (!sign.ok) fail(`signing in to Jellyfin: ${sign.status}`)
const token = (await sign.json()).AccessToken
const auth = { authorization: `MediaBrowser Token="${token}"` }

async function api(method, path, body) {
  const r = await fetch(`${finesse}${path}`, { method, headers: { ...auth, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  if (!r.ok) fail(`${method} ${path}: ${r.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

async function add(kind, path, bytes) {
  const begun = await api('POST', '/api/media/uploads', { kind, path, size: bytes.length, fingerprint: fingerprint(bytes) })
  if (begun.done) return begun
  const r = await fetch(`${finesse}/api/media/uploads/${begun.id}?offset=${begun.offset}`, { method: 'PUT', headers: { ...auth, 'content-type': 'application/octet-stream' }, body: bytes.subarray(begun.offset) })
  const out = await r.json()
  if (!r.ok || !out.done) fail(`sending ${path}: ${r.status} ${JSON.stringify(out)}`)
  return out
}

// A movie, into a folder of its own like the app does it.
const movie = Buffer.alloc(300000, 3)
await add('movies', 'Finesse Test Movie (2026)/Finesse Test Movie (2026).mkv', movie)
const movieFile = join(media, 'media', 'movies', 'Finesse Test Movie (2026)', 'Finesse Test Movie (2026).mkv')
if (!existsSync(movieFile) || readFileSync(movieFile).length !== movie.length) fail(`the movie isn't at ${movieFile}`)
say(`Add media: the movie is in ${movieFile}`)

// Games: on, from Settings → Server.
await api('PUT', '/api/system/games', { enabled: true })
for (let i = 0; ; i++) {
  const s = await api('GET', '/api/system/status')
  if (s.games?.job?.state === 'error') fail(`turning Games on: ${s.games.job.error}`)
  if (s.games?.enabled && s.games.job.state !== 'working') {
    say(`Games is on (${s.games.builtin ? 'Finesse’s own library' : 'RomM'}), folder ${s.games.folder}`)
    break
  }
  if (i > 60) fail(`Games didn't turn on: ${JSON.stringify(s.games)}`)
  await new Promise((r) => setTimeout(r, 1000))
}
const features = (await api('GET', '/api/finesse')).features
if (!features.games) fail('the app isn’t told Games is on')

// A game, added like the app does (console folder first), then found and played back.
const game = Buffer.from('FINESSE-TEST-ROM-'.repeat(1000))
await add('games', 'snes/Finesse Test Game (USA).sfc', game)
const platforms = await api('GET', '/finesse/games/api/platforms')
const snes = platforms.find((p) => p.fs_slug === 'snes')
if (!snes || snes.rom_count !== 1) fail(`the SNES folder isn't listed: ${JSON.stringify(platforms)}`)
const roms = await api('GET', `/finesse/games/api/roms?limit=500&platform_ids=${snes.id}`)
const rom = roms.items.find((r) => r.name === 'Finesse Test Game')
if (!rom) fail(`the game isn't listed: ${JSON.stringify(roms)}`)
const file = await fetch(`${finesse}/finesse/games/api/roms/${rom.id}/content/${encodeURIComponent(rom.fs_name)}`, { headers: auth })
const got = Buffer.from(await file.arrayBuffer())
if (!file.ok || !got.equals(game)) fail(`the game's file came back wrong (${file.status}, ${got.length} bytes)`)
say(`Games: "${rom.name}" (${snes.name}) is listed and its file plays back`)
console.log('Add media and Games work.')
