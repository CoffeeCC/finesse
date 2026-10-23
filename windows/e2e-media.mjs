// Part of windows/e2e.ps1, run with the node.exe Finesse installed: Add media on a real Windows
// install. Signs in to Jellyfin as the setup's admin and adds a movie into a folder of its own, the
// way the app does (Windows paths use \, not /).
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
console.log('Add media works.')
