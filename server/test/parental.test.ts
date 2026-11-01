// Parental limits (server/src/parental.ts). The fake Jellyfin here enforces nothing itself (the
// worst case: an old Jellyfin, or one that didn't take the limit), so every refusal below is
// Finesse's own. Each test tries a way round the limit and shows it's closed.

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { ageAllowed, idsIn, jellyfinAuth, Parental, parseAuthHeader, ratingAge, refusedShape } from '../src/parental.ts'
import { listen, tmp, webBuild } from './helpers.ts'
import { dashed } from './peers.ts'

const hex = (c: string) => c.repeat(32)
const LIB = hex('1')
const G = hex('a') // rated G
const R = hex('b') // rated R
const UNRATED = hex('c')
const SHOW = hex('d') // a TV-MA show
const EP = hex('e') // its episode, no rating of its own
const CUSTOM = hex('f') // PG officially, but an administrator set R
const KIDSHOW = hex('2') // TV-Y
const KIDEP = hex('3')
const EXTRA_R = hex('7') // a trailer of the R film: not in /Items?Ids= lists, only by its id
const EXTRA_G = hex('8') // a trailer of the G film
const NOWHERE = hex('9') // no such item
const items: Record<string, { Id: string; Name: string; Type: string; OfficialRating?: string; CustomRating?: string; SeriesId?: string }> = {
  [G]: { Id: G, Name: 'Gentle Film', Type: 'Movie', OfficialRating: 'G' },
  [R]: { Id: R, Name: 'Grown-up Film', Type: 'Movie', OfficialRating: 'R' },
  [UNRATED]: { Id: UNRATED, Name: 'Home Video', Type: 'Movie' },
  [SHOW]: { Id: SHOW, Name: 'Late Show', Type: 'Series', OfficialRating: 'TV-MA' },
  [EP]: { Id: EP, Name: 'Pilot', Type: 'Episode', SeriesId: SHOW },
  [CUSTOM]: { Id: CUSTOM, Name: 'Retagged', Type: 'Movie', OfficialRating: 'PG', CustomRating: 'R' },
  [KIDSHOW]: { Id: KIDSHOW, Name: 'Bluey-ish', Type: 'Series', OfficialRating: 'TV-Y' },
  [KIDEP]: { Id: KIDEP, Name: 'Episode 1', Type: 'Episode', SeriesId: KIDSHOW },
}

// Found by id, not listed: the library itself and extras (Jellyfin leaves extras out of /Items?Ids=).
const folders: Record<string, Record<string, unknown>> = { [LIB]: { Id: LIB, Name: 'Films', Type: 'CollectionFolder' } }
const extras: Record<string, Record<string, unknown>> = {
  [EXTRA_R]: { Id: EXTRA_R, Name: 'Grown-up Trailer', Type: 'Trailer', ExtraType: 'Trailer', OwnerId: R },
  [EXTRA_G]: { Id: EXTRA_G, Name: 'Gentle Trailer', Type: 'Trailer', ExtraType: 'Trailer', OwnerId: G },
}
/** What the last request to each path carried (headers, query), as Jellyfin got it. */
const seenBy = new Map<string, { headers: IncomingMessage['headers']; query: string }>()

const users = new Map<string, { Id: string; Name: string; Policy: Record<string, unknown> }>()
const tokens = new Map<string, string>()
const calls: string[] = []
const policyPosts: { id: string; body: Record<string, unknown> }[] = []
let refusePolicy = false
const ID = { parent: hex('4'), kid: hex('5'), teen: hex('6') }

let jf: Server
let arr: Server
let app: Server
let base = ''
let settings: import('../src/config.ts').SettingsStore
let configDir = ''

async function body(req: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const t = Buffer.concat(chunks).toString()
  return t ? JSON.parse(t) : {}
}

before(async () => {
  users.set(ID.parent, { Id: ID.parent, Name: 'parent', Policy: { IsAdministrator: true } })
  users.set(ID.kid, { Id: ID.kid, Name: 'kid', Policy: { IsAdministrator: false } })
  users.set(ID.teen, { Id: ID.teen, Name: 'teen', Policy: { IsAdministrator: false } })
  tokens.set('parent', ID.parent).set('kid', ID.kid).set('teen', ID.teen).set('service', ID.parent)
  jf = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const p = url.pathname
    calls.push(`${req.method} ${p}${url.search}`)
    seenBy.set(p, { headers: req.headers, query: url.search })
    const send = (status: number, data?: unknown, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type })
      res.end(data === undefined ? '' : typeof data === 'string' ? data : JSON.stringify(data))
    }
    const tok = /Token="([^"]+)"/.exec(String(req.headers.authorization ?? ''))?.[1] || String(req.headers['x-emby-token'] ?? '') || url.searchParams.get('ApiKey') || ''
    const me = users.get(tokens.get(tok) ?? '')
    if (!me) return send(401)
    if (p === '/Users/Me') return send(200, me)
    if (p === '/Users') return send(200, [...users.values()])
    let m = /^\/Users\/([0-9a-f]{32})\/Policy$/.exec(p)
    if (m && req.method === 'POST') {
      if (refusePolicy) return send(500)
      const b = await body(req)
      policyPosts.push({ id: m[1]!, body: b })
      users.get(m[1]!)!.Policy = b
      return send(204)
    }
    m = /^\/Users\/([0-9a-f]{32})$/.exec(p)
    if (m) return users.has(m[1]!) ? send(200, users.get(m[1]!)) : send(404)
    // Lists: everything, whoever asks (this Jellyfin enforces nothing).
    if (p === '/Items' || /^\/Users\/[0-9a-f]{32}\/Items$/.test(p)) {
      const ids = url.searchParams.get('Ids')
      const list = ids ? ids.split(',').map((i) => items[i] ?? folders[i]).filter(Boolean) : Object.values(items)
      return send(200, { Items: list, TotalRecordCount: list.length })
    }
    if (p === '/Items/Latest' || /^\/Users\/[0-9a-f]{32}\/Items\/Latest$/.test(p)) return send(200, Object.values(items))
    if (p === '/Search/Hints') return send(200, { SearchHints: Object.values(items).map((i) => ({ Id: i.Id, ItemId: i.Id, Name: i.Name, Type: i.Type })), TotalRecordCount: 8 })
    m = /^\/(?:Users\/[0-9a-f]{32}\/)?Items\/([0-9a-f]{32})$/i.exec(p)
    const one = m ? (items[m[1]!.toLowerCase()] ?? folders[m[1]!.toLowerCase()] ?? extras[m[1]!.toLowerCase()]) : null
    if (one) return send(200, one)
    if (p === '/Movies/Recommendations')
      return send(200, [
        { BaselineItemName: 'Grown-up Film', CategoryId: R, RecommendationType: 'SimilarToRecentlyPlayed', Items: [items[G]] },
        { BaselineItemName: 'Gentle Film', CategoryId: G, RecommendationType: 'SimilarToLikedItem', Items: [items[R], items[G]] },
        { BaselineItemName: 'Directed by Someone', CategoryId: hex('0'), RecommendationType: 'HasDirectorFromRecentlyPlayed', Items: [items[R]] },
      ])
    if (p === '/Sessions')
      return send(200, [
        { Id: hex('0'), UserName: 'parent', NowPlayingItem: { Id: R, Name: 'Grown-up Film', Type: 'Movie' }, NowPlayingQueueFullItems: [items[R], items[G]] },
        { Id: hex('0').replace(/0$/, '1'), UserName: 'kid', NowPlayingItem: { Id: G, Name: 'Gentle Film', Type: 'Movie' } },
      ])
    if (p === '/Broken') return send(200, '{"Items": [')
    if (p === '/Camel') return send(200, /CamelCase/i.test(String(req.headers.accept)) ? { items: [{ id: R, name: 'Grown-up Film' }, { id: G, name: 'Gentle Film' }], totalRecordCount: 2 } : { Items: [items[R], items[G]], TotalRecordCount: 2 })
    if (/^\/Items\/[0-9a-f]{32}\/PlaybackInfo$/i.test(p)) return send(200, { MediaSources: [{ Id: 'x' }] })
    if (/^\/videos\//i.test(p)) return send(200, 'video-bytes', 'video/mp4')
    if (/^\/Shows\/[0-9a-f]{32}\/Episodes$/.test(p)) return send(200, { Items: [items[EP]] })
    send(404)
  })
  const jfUrl = await listen(jf)
  arr = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('[]')
  })
  const arrUrl = await listen(arr)
  const dir = tmp()
  configDir = join(dir, 'config')
  mkdirSync(configDir, { recursive: true })
  for (const [rel, c] of Object.entries(webBuild('1.0.0'))) {
    mkdirSync(join(dir, 'web', rel, '..'), { recursive: true })
    writeFileSync(join(dir, 'web', rel), c)
  }
  writeFileSync(
    join(configDir, 'finesse.json'),
    JSON.stringify({ version: 1, instanceId: `p-${randomUUID()}`, mode: 'adopt', setup: { state: 'ready' }, jellyfin: { url: jfUrl, apiKey: 'service', basePath: '' }, services: { radarr: { url: arrUrl, apiKey: 'radarr-key' } } }),
  )
  const previews = join(configDir, 'previews')
  mkdirSync(previews, { recursive: true })
  writeFileSync(join(previews, `${R}.mp4`), 'clip')
  writeFileSync(join(previews, `${G}.mp4`), 'clip')
  const paths = { configDir, settingsFile: join(configDir, 'finesse.json'), invitesDb: join(configDir, 'invites.db'), bakedWeb: join(dir, 'web'), updatedWeb: join(configDir, 'web'), previews, backups: join(configDir, 'backups') }
  const { createApp } = await import('../src/app.ts')
  const a = createApp({ paths })
  app = a.server
  settings = a.deps.settings
  base = await listen(app)
})
after(() => {
  for (const s of [jf, arr, app]) {
    s.closeAllConnections()
    s.close()
  }
})

const H = (token?: string, extra: Record<string, string> = {}) => ({ 'Content-Type': 'application/json', ...(token ? { Authorization: `MediaBrowser Client="t", Device="t", DeviceId="t", Version="1", Token="${token}"` } : {}), ...extra })
/** A request with exactly these headers (no default sign-in). */
async function raw(method: string, path: string, headers: Record<string, string>) {
  const r = await fetch(`${base}${path}`, { method, headers })
  const text = await r.text()
  return { status: r.status, text }
}
async function call(method: string, path: string, token?: string, b?: unknown, extra: Record<string, string> = {}) {
  const r = await fetch(`${base}${path}`, { method, headers: H(token, extra), body: b === undefined ? undefined : JSON.stringify(b) })
  const text = await r.text()
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(text)
  } catch {
    /* not JSON */
  }
  return { status: r.status, data, text }
}

test('ratings, ages and what counts as unrated', () => {
  assert.equal(ratingAge('PG-13'), 13)
  assert.equal(ratingAge('us-pg-13'), 13)
  assert.equal(ratingAge('DE-16'), 16)
  assert.equal(ratingAge('FSK 12'), 12)
  assert.equal(ratingAge('TV-MA'), 17)
  assert.equal(ratingAge('NR'), null)
  assert.equal(ratingAge(''), null)
  assert.equal(ratingAge('Banana'), null)
  // National adult ratings.
  for (const r of ['KR-19', 'RU-18+', 'NZ-R18', 'AU-R 18+', 'AU-X 18+', 'SG-M18', 'SG-R21', 'FI-K-18', 'NL-18', 'BR-18', 'JP-R18+', 'IE-18']) assert.ok((ratingAge(r) ?? 0) >= 18, r)
  assert.equal(ratingAge('JP-R15+'), 15)
  assert.equal(ratingAge('NZ: R16'), 16)
  assert.equal(ratingAge('RU-6+'), 6)
  assert.equal(ratingAge('KR-ALL'), 0)
  assert.equal(ratingAge('BR-L'), 0)
  const kid = { maxAge: 10, blockUnrated: true, requests: false }
  assert.ok(ageAllowed(0, 'Movie', kid))
  assert.ok(!ageAllowed(13, 'Movie', kid))
  assert.ok(!ageAllowed(null, 'Movie', kid), 'unrated film blocked')
  assert.ok(ageAllowed(null, 'CollectionFolder', kid), 'a library has no rating')
  assert.ok(ageAllowed(null, 'Movie', { ...kid, blockUnrated: false }))
})

test('every id a request names is found: encoded, hyphenated, any case, in the query', () => {
  assert.deepEqual(idsIn(`/Videos/${R.toUpperCase()}/stream`, new URLSearchParams()), [R])
  assert.deepEqual(idsIn(`/videos/${dashed(R)}/master.m3u8`, new URLSearchParams()), [R])
  assert.deepEqual(idsIn(`/Videos/${encodeURIComponent('%') + '62'}${R.slice(1)}/stream`, new URLSearchParams()), [R], 'double-encoded')
  assert.deepEqual(idsIn('/Items', new URLSearchParams(`Ids=${G},${R}&tag=${hex('9')}`)).sort(), [G, R])
  assert.deepEqual(idsIn('/Items', new URLSearchParams(`parentId=${SHOW}`)), [SHOW])
})

test('the one token Jellyfin would use, read the way Jellyfin reads it', () => {
  const t = (headers: Record<string, string>, q = '') => jellyfinAuth({ headers } as unknown as IncomingMessage, new URLSearchParams(q))
  // Unquoted, URL-encoded, any case of key: all are the kid's token.
  assert.equal(t({ authorization: 'MediaBrowser Client="x", Token=kid' }).token, 'kid')
  assert.equal(t({ authorization: 'MediaBrowser Token="%6Bid"' }).token, 'kid')
  assert.equal(t({ authorization: 'mediabrowser client="x",token="kid"' }).token, 'kid')
  assert.equal(t({ authorization: 'Emby Token="kid"' }).token, 'kid')
  assert.equal(t({ authorization: 'MediaBrowser Device="a, Token=x", Token="kid"' }).token, 'kid', 'commas inside quotes')
  // Jellyfin's order: Authorization, X-Emby-Token, X-MediaBrowser-Token, ApiKey, api_key.
  assert.equal(t({ authorization: 'MediaBrowser Token="a"', 'x-emby-token': 'b' }, 'ApiKey=c').token, 'a')
  assert.equal(t({ 'x-mediabrowser-token': 'c', 'x-emby-token': 'b' }, 'ApiKey=d').token, 'b')
  assert.equal(t({ 'x-mediabrowser-token': 'c' }, 'ApiKey=d').token, 'c')
  assert.equal(t({}, 'api_key=e&APIKEY=d').token, 'd')
  assert.equal(t({ 'x-emby-authorization': 'MediaBrowser Token="f"' }).token, 'f', 'X-Emby-Authorization when there’s no Authorization')
  assert.equal(t({ authorization: 'MediaBrowser Client="x"', 'x-emby-authorization': 'MediaBrowser Token="f"', 'x-emby-token': 'b' }).token, 'b', 'not when there is')
  assert.deepEqual(t({ authorization: 'MediaBrowser Token="a"', 'x-emby-token': 'b' }, 'ApiKey=c&api_key=c').all.sort(), ['a', 'b', 'c'])
  // Unreadable or crowded: refused.
  assert.ok(t({ authorization: 'Bearer kid' }).bad)
  assert.ok(t({ authorization: 'MediaBrowser Token="kid' }).bad, 'unpaired quote')
  assert.ok(t({ authorization: 'MediaBrowser Token="a"', 'x-emby-token': 'b', 'x-mediabrowser-token': 'c' }, 'ApiKey=d').bad, 'four tokens')
  assert.equal(t({ authorization: 'MediaBrowser Token="a"' }, 'ApiKey=a&api_key=a').bad, null)
  assert.deepEqual(parseAuthHeader('MediaBrowser Client="Fin+esse", DeviceId="x%3D"')!.fields, [['Client', 'Fin esse'], ['DeviceId', 'x=']])
})

test('the proxy checks the token Jellyfin uses, and Jellyfin gets only that one', async () => {
  settings.update((s) => void (s.parental = { [ID.kid]: { maxAge: 10, blockUnrated: true, requests: false } }))
  try {
    for (const authorization of ['MediaBrowser Client="t", Token=kid', 'MediaBrowser Client="t", Token="%6Bid"', 'MediaBrowser client="t", token="kid"']) {
      assert.equal((await raw('GET', `/jellyfin/Videos/${R}/stream.mp4`, { authorization })).status, 403, authorization)
    }
    // The parent's token first: it's the parent's request, and the kid's tokens don't go on.
    const r = await raw('GET', `/jellyfin/Videos/${R}/stream.mp4?api_key=kid&static=true`, { authorization: 'MediaBrowser Client="t", Device="My TV", Token="parent"', 'x-emby-token': 'kid' })
    assert.equal(r.status, 200)
    const got = seenBy.get(`/Videos/${R}/stream.mp4`)!
    assert.equal(got.headers['x-emby-token'], undefined)
    assert.match(String(got.headers.authorization), /^MediaBrowser Client="t", Device="My%20TV", Token="parent"$/)
    assert.equal(new URLSearchParams(got.query).get('api_key'), 'parent')
    assert.equal(new URLSearchParams(got.query).get('static'), 'true')
    // A token Jellyfin won't take, in front of the kid's: Jellyfin gets only that one, and refuses.
    assert.equal((await raw('GET', `/jellyfin/Videos/${R}/stream.mp4?ApiKey=kid`, { authorization: 'MediaBrowser Token="garbage-token"' })).status, 401)
    // Unreadable or crowded sign-ins are refused.
    assert.equal((await raw('GET', `/jellyfin/Videos/${G}/stream.mp4`, { authorization: 'Bearer kid' })).status, 400)
    assert.equal((await raw('GET', `/jellyfin/Videos/${G}/stream.mp4?ApiKey=d`, { authorization: 'MediaBrowser Token="a"', 'x-emby-token': 'b', 'x-mediabrowser-token': 'c' })).status, 400)
    // One lookup per request, however many tokens it carries.
    const fresh = () => `nobody-${randomUUID()}`
    calls.length = 0
    await raw('GET', `/jellyfin/Videos/${G}/stream.mp4?ApiKey=${fresh()}`, { authorization: `MediaBrowser Token="${fresh()}"`, 'x-emby-token': fresh() })
    assert.equal(calls.filter((c) => c.startsWith('GET /Users/Me')).length, 1)
  } finally {
    settings.update((s) => void delete s.parental)
  }
})

test('administrators set limits; Jellyfin gets its own copy; not on administrators; not by the profile itself', async () => {
  assert.equal((await call('PUT', `/api/parental/${ID.kid}`, 'kid', { maxAge: 16 })).status, 403, 'a kid can’t lift their own')
  assert.equal((await call('PUT', `/api/parental/${ID.parent}`, 'parent', { maxAge: 10 })).status, 400, 'administrators can’t be limited')
  assert.equal((await call('PUT', `/api/parental/${ID.kid}`, 'parent', { maxAge: 11 })).status, 400, 'only the listed limits')
  const r = await call('PUT', `/api/parental/${ID.kid}`, 'parent', { maxAge: 10, blockUnrated: true })
  assert.equal(r.status, 200, r.text)
  assert.equal(r.data.jellyfin, true)
  const post = policyPosts.find((x) => x.id === ID.kid)!
  assert.equal(post.body.MaxParentalRating, 10)
  assert.deepEqual(post.body.BlockUnratedItems, ['Movie', 'Trailer', 'Series', 'Other'])
  assert.equal(post.body.IsAdministrator, false, 'the rest of the policy is kept')
  assert.deepEqual((await call('GET', '/api/parental/me', 'kid')).data.limit, { maxAge: 10, blockUnrated: true, requests: false })
  assert.equal((await call('GET', '/api/parental/me', 'parent')).data.limit, null)
  const list = await call('GET', '/api/parental', 'parent')
  assert.deepEqual((list.data.people as { name: string; limit: unknown }[]).map((p) => `${p.name}:${p.limit ? 'limited' : '-'}`), ['kid:limited', 'parent:-', 'teen:-'])
  assert.equal((await call('GET', '/api/parental', 'kid')).status, 403)
  // Jellyfin refusing its copy: Finesse still enforces, and says Jellyfin's own apps aren't limited.
  refusePolicy = true
  const w = await call('PUT', `/api/parental/${ID.teen}`, 'parent', { maxAge: 14, blockUnrated: false, requests: true })
  refusePolicy = false
  assert.equal(w.status, 200)
  assert.equal(w.data.jellyfin, false)
  assert.match(String(w.data.warning), /Jellyfin’s own apps aren’t limited/)
})

test('title pages and direct links: refused, every way of writing them', async () => {
  const blocked = [
    `/jellyfin/Items/${R}`,
    `/jellyfin/Users/${ID.kid}/Items/${R}`,
    `/finesse/jellyfin/Users/${ID.kid}/Items/${R}`,
    `/jellyfin/users/${ID.kid}/items/${R.toUpperCase()}`,
    `/jellyfin/Users/${ID.kid}/Items/${dashed(R)}`,
    `/jellyfin//Users/${ID.kid}/Items/${R}`,
    `/jellyfin/Users/${ID.kid}/Items/%62${R.slice(1)}`,
    `/jellyfin/Items?Ids=${G},${R}`,
    `/jellyfin/Users/${ID.kid}/Items?ParentId=${SHOW}`,
    `/jellyfin/Shows/${SHOW}/Episodes`,
    `/jellyfin/Users/${ID.kid}/Items/${EP}`, // an episode takes its show's TV-MA
    `/jellyfin/Users/${ID.kid}/Items/${CUSTOM}`, // the administrator's own rating counts
    `/jellyfin/Users/${ID.kid}/Items/${UNRATED}`, // unrated, and the limit blocks unrated
  ]
  for (const path of blocked) {
    const r = await call('GET', path, 'kid')
    assert.equal(r.status, 403, path)
    assert.match(String(r.data.error), /can’t open that title/, path)
  }
  for (const path of [`/jellyfin/Users/${ID.kid}/Items/${G}`, `/jellyfin/Users/${ID.kid}/Items/${KIDEP}`, `/jellyfin/Users/${ID.kid}/Items?ParentId=${LIB}`]) assert.equal((await call('GET', path, 'kid')).status, 200, path)
  // Everyone else is untouched.
  assert.equal((await call('GET', `/jellyfin/Users/${ID.parent}/Items/${R}`, 'parent')).status, 200)
  assert.equal((await call('GET', `/jellyfin/Users/${ID.teen}/Items/${UNRATED}`, 'teen')).status, 200, 'the teen’s limit lets unrated through')
  assert.equal((await call('GET', `/jellyfin/Users/${ID.teen}/Items/${R}`, 'teen')).status, 403)
})

test('playing: PlaybackInfo, streams and playlists, with the token anywhere', async () => {
  assert.equal((await call('POST', `/jellyfin/Items/${R}/PlaybackInfo`, 'kid', {})).status, 403)
  assert.equal((await call('GET', `/jellyfin/Videos/${R}/stream.mp4?ApiKey=kid`)).status, 403, 'token in the address')
  assert.equal((await call('GET', `/jellyfin/videos/${dashed(R)}/master.m3u8?api_key=kid`)).status, 403, 'hyphenated, lower case')
  assert.equal((await call('GET', `/jellyfin/Videos/${R}/stream.mp4`, undefined, undefined, { 'X-Emby-Token': 'kid' })).status, 403, 'legacy header')
  // Hiding the kid's token behind another one doesn't help: Jellyfin gets only the one in front.
  assert.equal((await call('GET', `/jellyfin/Videos/${R}/stream.mp4?ApiKey=kid`, 'garbage-token')).status, 401)
  assert.equal((await call('GET', `/jellyfin/Videos/${G}/stream.mp4?ApiKey=kid`)).status, 200)
  assert.equal((await call('GET', `/jellyfin/Videos/${R}/stream.mp4?ApiKey=parent`)).status, 200)
})

test('browse and search: lists come back without what the profile can’t open', async () => {
  const lib = await call('GET', `/jellyfin/Users/${ID.kid}/Items?ParentId=${LIB}&Recursive=true`, 'kid')
  assert.equal(lib.status, 200)
  const names = (lib.data.Items as { Name: string }[]).map((i) => i.Name).sort()
  assert.deepEqual(names, ['Bluey-ish', 'Episode 1', 'Gentle Film'])
  assert.equal(lib.data.TotalRecordCount, 3)
  const latest = await call('GET', `/jellyfin/Users/${ID.kid}/Items/Latest`, 'kid')
  assert.deepEqual((JSON.parse(latest.text) as { Name: string }[]).map((i) => i.Name).sort(), ['Bluey-ish', 'Episode 1', 'Gentle Film'])
  const hints = await call('GET', '/jellyfin/Search/Hints?searchTerm=film', 'kid')
  assert.doesNotMatch(hints.text, /Grown-up|Late Show|Retagged|Home Video|Pilot/)
  // The parent sees everything.
  assert.equal(((await call('GET', `/jellyfin/Users/${ID.parent}/Items?ParentId=${LIB}`, 'parent')).data.Items as unknown[]).length, 8)
})

test('replies are checked all the way down, any case; unreadable ones aren’t sent on', async () => {
  const recs = await call('GET', `/jellyfin/Movies/Recommendations?userId=${ID.kid}`, 'kid')
  assert.equal(recs.status, 200)
  const groups = JSON.parse(recs.text) as { BaselineItemName: string; Items: { Name: string }[] }[]
  assert.deepEqual(groups.map((g) => [g.BaselineItemName, g.Items.map((i) => i.Name)]), [['Gentle Film', ['Gentle Film']]], 'the R baseline and the emptied list go')
  // Asking for camelCase gets plain JSON (and camelCase would be filtered anyway).
  const camel = await call('GET', '/jellyfin/Camel', 'kid', undefined, { Accept: 'application/json; profile=CamelCase' })
  assert.equal(seenBy.get('/Camel')!.headers.accept, 'application/json')
  assert.doesNotMatch(camel.text, /Grown-up/)
  assert.equal(camel.data.TotalRecordCount, 1)
  // What other people are watching.
  const sessions = await call('GET', '/jellyfin/Sessions', 'kid')
  assert.equal(sessions.status, 200)
  assert.doesNotMatch(sessions.text, /Grown-up/)
  assert.equal((JSON.parse(sessions.text) as unknown[]).length, 2, 'the sessions stay, without what they’re playing')
  assert.match(sessions.text, /Gentle Film/)
  // Not JSON: refused, not passed on.
  assert.equal((await call('GET', '/jellyfin/Broken', 'kid')).status, 502)
  assert.equal((await call('GET', '/jellyfin/Broken', 'parent')).status, 200, 'other people’s replies aren’t touched')
})

test('filterJson: nested, camelCase, wrappers, Live TV', async () => {
  const jfStub = { request: async (path: string) => (path.startsWith('/Items?') ? { Items: Object.values(items).filter((i) => path.includes(i.Id)) } : Promise.reject(new Error('404'))) }
  const p = new Parental({ settings: {} as never, jf: jfStub as never, auth: {} as never })
  const lim = { maxAge: 10, blockUnrated: true, requests: false }
  const out = (x: unknown) => p.filterJson(JSON.stringify(x), lim).then((t) => JSON.parse(t))
  assert.deepEqual(await out({ items: [{ id: R }, { id: G }], totalRecordCount: 2 }), { items: [{ id: G }], totalRecordCount: 1 })
  assert.deepEqual(await out({ SearchHints: [{ itemId: dashed(R) }, { ItemId: G }] }), { SearchHints: [{ ItemId: G }] })
  assert.deepEqual(await out([{ Name: 'x', SeriesId: SHOW }, { Name: 'y', SeriesId: KIDSHOW }]), [{ Name: 'y', SeriesId: KIDSHOW }])
  assert.deepEqual(await out({ a: { b: [{ c: { Id: R } }, { Id: G }] } }), { a: { b: [{}, { Id: G }] } })
  assert.deepEqual(await out([{ Type: 'TvChannel', Name: 'News' }, { CollectionType: 'livetv' }, { Id: G }]), [{ Id: G }])
  await assert.rejects(p.filterJson('{nope', lim))
  await assert.rejects(p.filterJson(JSON.stringify({ Id: R, Name: 'Grown-up Film' }), lim), 'a blocked title on its own isn’t sent')
})

test('odd ways of writing an id, ids that aren’t items, extras, Live TV', async () => {
  const bx = `{0x${R.slice(0, 8)},0x${R.slice(8, 12)},0x${R.slice(12, 16)},{${R.slice(16).match(/../g)!.map((b) => `0x${b}`).join(',')}}}`
  for (const path of [`/jellyfin/Videos/${encodeURIComponent(bx)}/stream.mp4`, `/jellyfin/Videos/${encodeURIComponent(`{${dashed(R)}}`)}/stream.mp4`, `/jellyfin/Videos/(${dashed(R)})/stream.mp4`, `/jellyfin/Items?Ids=${encodeURIComponent(bx)}`, `/jellyfin/Items?ParentId=(${G})`]) {
    assert.equal((await call('GET', path, 'kid')).status, 403, path)
  }
  assert.equal(refusedShape(`/Persons/Someone (II)`, new URLSearchParams('searchTerm=Alien (1979)')), null, 'names with brackets are fine')
  // Not an item Finesse can find: refused for the kid, fine for the parent.
  assert.equal((await call('GET', `/jellyfin/Videos/${NOWHERE}/stream.mp4`, 'kid')).status, 403)
  assert.equal((await call('GET', `/jellyfin/Videos/${NOWHERE}/stream.mp4`, 'parent')).status, 200)
  // Extras are found by their id, and take their film's rating.
  assert.equal((await call('GET', `/jellyfin/Videos/${EXTRA_G}/stream.mp4`, 'kid')).status, 200)
  assert.equal((await call('GET', `/jellyfin/Videos/${EXTRA_R}/stream.mp4`, 'kid')).status, 403)
  // The profile's own id, and a session's, aren't titles.
  assert.equal((await call('GET', `/jellyfin/Users/${ID.kid}/Items/${G}`, 'kid')).status, 200)
  assert.equal(idsIn(`/Users/${ID.kid}/../Videos/${R}`, new URLSearchParams(), { skipPeople: true }).join(), R)
  assert.deepEqual(idsIn(`/Users/${ID.kid}/Items/${G}`, new URLSearchParams(), { skipPeople: true }), [G])
  // Live TV is off for limited profiles.
  for (const path of ['/jellyfin/LiveTv/Channels', '/jellyfin/livetv/Programs/Recommended', `/jellyfin/LiveTv%2FChannels`]) assert.equal((await call('GET', path, 'kid')).status, 403, path)
  assert.notEqual((await call('GET', '/jellyfin/LiveTv/Channels', 'parent')).status, 403)
})

test('the Jellyfin WebSocket: not for limited profiles, however the token is sent', async () => {
  const { connect } = await import('node:net')
  const upgrade = (path: string, headers = '') =>
    new Promise<string>((resolve) => {
      const u = new URL(base)
      const s = connect(Number(u.port), u.hostname, () => s.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n${headers}\r\n`))
      let got = ''
      s.on('data', (d) => (got += d))
      s.on('close', () => resolve(got))
      s.on('error', () => resolve(got))
      setTimeout(() => s.destroy(), 3000)
    })
  assert.match(await upgrade('/jellyfin/socket?api_key=kid&deviceId=x'), /^HTTP\/1\.1 403/)
  assert.match(await upgrade('/finesse/jellyfin/socket?deviceId=x', 'Authorization: MediaBrowser Token=kid\r\n'), /^HTTP\/1\.1 403/)
  assert.match(await upgrade('/jellyfin/socket', 'Authorization: Bearer kid\r\n'), /^HTTP\/1\.1 400/)
  assert.doesNotMatch(await upgrade('/jellyfin/socket?api_key=parent&deviceId=x'), /^HTTP\/1\.1 40[03]/)
})

test('preview clips: checked as the file that would be served, in its one form only', async () => {
  for (const path of [`/previews//${R}.mp4`, `/previews/%62${R.slice(1)}.mp4`, `/finesse/previews/%2F${R}.mp4`, `/previews/x/..%2F${R}.mp4`]) {
    assert.equal((await call('GET', path, 'kid')).status, 404, path)
  }
  assert.equal((await call('GET', `/previews//${G}.mp4`, 'kid')).status, 200)
  assert.equal((await call('GET', `/previews/${R}.MP4`, 'parent')).status, 404, 'only the canonical form')
  assert.equal((await call('GET', '/previews/notes.txt', 'parent')).status, 404)
  assert.equal((await call('GET', '/previews/manifest.json', 'kid')).status, 200)
})

test('requests, friends’ servers and preview clips', async () => {
  for (const [m, p, b] of [['GET', '/arr/radarr/movie/lookup?term=x'], ['POST', '/arr/radarr/movie', { title: 'x' }], ['GET', '/arr/radarr/queue'], ['GET', '/api/requests/artist-albums?artist=x&name=y']] as [string, string, unknown?][]) {
    const r = await call(m, p, 'kid', b)
    assert.equal(r.status, 403, p)
    assert.match(String(r.data.error), /Requests are off for this profile/, p)
  }
  assert.equal((await call('GET', '/arr/radarr/movie/lookup?term=x', 'teen')).status, 200, 'the teen may request')
  assert.equal((await call('GET', '/arr/radarr/movie/lookup?term=x', 'parent')).status, 200)
  // A friend's server: listed for no one limited, unreachable for them, even by its id.
  settings.update((s) => void (s.groups = { links: [], friends: [{ id: 'abcdefgh', name: 'Sam', url: 'http://127.0.0.1:9', linkId: 'l', secret: 's', addedAt: '' }], codes: [], offers: [] }))
  assert.deepEqual((await call('GET', '/api/groups/friends', 'kid')).data.friends, [])
  assert.equal(((await call('GET', '/api/groups/friends', 'parent')).data.friends as unknown[]).length, 1)
  assert.equal((await call('GET', `/api/groups/friends/abcdefgh/jellyfin/Users/${ID.kid}/Items?searchTerm=a`, 'kid')).status, 403)
  assert.equal((await call('GET', `/api/groups/friends/abcdefgh/jellyfin/Videos/${G}/stream.mp4?ApiKey=kid`)).status, 403)
  // Preview clips of titles over the limit.
  assert.equal((await call('GET', `/previews/${R}.mp4`, 'kid')).status, 404)
  assert.equal((await call('GET', `/previews/${G}.mp4`, 'kid')).status, 200)
  assert.equal((await call('GET', `/previews/${R}.mp4`, 'parent')).status, 200)
})

test('Moments: not sent, not shown, not on the timeline', async () => {
  // The parent sends the kid a moment of each film.
  for (const item of [G, R]) assert.equal((await call('POST', '/api/moments', 'parent', { item, start: 1, end: 5, note: `see ${item.slice(0, 1)}`, to: [`user:${ID.kid}`] })).status, 201)
  const box = await call('GET', '/api/moments/inbox', 'kid')
  assert.deepEqual((box.data.moments as { note: string }[]).map((m) => m.note), ['see a'])
  assert.equal((await call('GET', `/api/moments/item/${R}`, 'kid')).status, 403)
  assert.equal((await call('POST', '/api/moments', 'kid', { item: R, start: 1, end: 5, to: [] })).status, 403)
  assert.equal((await call('GET', `/api/moments/targets?item=${R}`, 'kid')).status, 403)
  assert.equal((await call('POST', '/api/moments', 'kid', { item: `f-abcdefgh-${G}`, start: 1, end: 5, to: [] })).status, 403, 'a friend’s title')
})

test('shortlists and Moments collections: hidden, not added, not saved', async () => {
  const q = await call('POST', '/api/queues', 'parent', { name: 'Family night', members: [ID.kid] })
  const qid = String(q.data.id)
  assert.equal((await call('POST', `/api/queues/${qid}/items`, 'parent', { item: R })).status, 201)
  assert.equal((await call('POST', `/api/queues/${qid}/items`, 'parent', { item: G })).status, 201)
  const kids = await call('GET', `/api/queues/${qid}`, 'kid')
  assert.doesNotMatch(kids.text, /Grown-up Film/)
  assert.equal((kids.data.items as { hidden: boolean }[]).filter((i) => i.hidden).length, 1)
  assert.equal((await call('POST', `/api/queues/${qid}/items`, 'kid', { item: CUSTOM })).status, 404)
  const hidden = (kids.data.items as { key: string; hidden: boolean }[]).find((i) => i.hidden)!
  assert.equal((await call('PUT', `/api/queues/${qid}/vote`, 'kid', { key: hidden.key })).status, 403)
  const col = await call('POST', '/api/moment-collections', 'kid', { name: 'Mine' })
  assert.equal((await call('POST', `/api/moment-collections/${col.data.id}/entries`, 'kid', { item: R, start: 1, end: 3 })).status, 404)
  assert.equal((await call('POST', `/api/moment-collections/${col.data.id}/entries`, 'kid', { item: G, start: 1, end: 3 })).status, 201)
})

test('lifting the limit lifts it everywhere, at once', async () => {
  assert.equal((await call('PUT', `/api/parental/${ID.kid}`, 'parent', { maxAge: null })).status, 200)
  assert.equal(policyPosts.filter((x) => x.id === ID.kid).at(-1)!.body.MaxParentalRating, null)
  assert.equal((await call('GET', `/jellyfin/Users/${ID.kid}/Items/${R}`, 'kid')).status, 200)
  assert.equal((await call('GET', '/arr/radarr/movie/lookup?term=x', 'kid')).status, 200)
  // No limits anywhere: the proxy asks nothing extra.
  await call('PUT', `/api/parental/${ID.teen}`, 'parent', { maxAge: null })
  calls.length = 0
  await call('GET', `/jellyfin/Users/${ID.kid}/Items/${R}`, 'kid')
  assert.deepEqual(calls, [`GET /Users/${ID.kid}/Items/${R}`])
})
