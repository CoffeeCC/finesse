// Reading a post-list source: the rules that turn a site's posts into catalogue games. The posts
// come from a fake address, so nothing here reaches the network.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { call, fakeJellyfin, finesse } from './peers.ts'
import { cleanFeedConfig, readFeed, type Fetcher } from '../src/gamestore/feed.ts'
import { DEFAULT_FEEDS } from '../src/gamestore/defaults.ts'

const MAGNET = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567'

const POST = {
  id: 101,
  slug: 'great-game',
  date: '2026-11-20T10:00:00',
  title: { rendered: 'Great Game (2024)' },
  link: 'https://site.example/posts/great-game/',
  excerpt: { rendered: '<p>Great Game is a test post.</p>' },
  content: { rendered: `<p><strong>Repack Size:</strong> 13.5 GB<br>Genres/Tags: Action, Adventure<br>Companies: Test Studio<br><a href="${MAGNET}">Download</a></p>` },
  jetpack_featured_media_url: 'https://site.example/wp-content/uploads/cover.jpg',
}
const NOT_A_GAME = { id: 102, slug: 'news', date: '2026-11-21T10:00:00', title: { rendered: 'A news post' }, content: { rendered: '<p>Nothing usable here.</p>' } }

const postsGet: Fetcher = (url) =>
  Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(url.includes('page=2') ? [] : [POST, NOT_A_GAME]) })

test('a post list is read through rules: title, size, genres, developer, magnet — nothing trusted', async () => {
  const feed = await readFeed({ id: 'src', name: 'Src', url: 'https://site.example', kind: 'posts' }, postsGet)
  assert.equal(feed.entries.length, 1)
  const g = feed.entries[0]!.game
  assert.deepEqual([g.title, g.year, g.genres, g.developer], ['Great Game (2024)', 2024, ['Action', 'Adventure'], 'Test Studio'])
  assert.equal(g.summary, 'Great Game is a test post.')
  assert.equal(g.cover, 'https://site.example/wp-content/uploads/cover.jpg')
  assert.equal(g.addedAt, new Date('2026-11-20T10:00:00').toISOString())
  const s = feed.entries[0]!.sources[0]!
  assert.deepEqual([s.platform, s.installer, s.sizeBytes, s.magnet], ['windows', 'unknown', Math.round(13.5 * 1024 ** 3), MAGNET])
  assert.equal(feed.skipped.length, 1)
  assert.match(feed.skipped[0]!, /^A news post: no download/)
})

test('the reading rules are checked on the way in', () => {
  assert.deepEqual(cleanFeedConfig({ name: 'S', url: 'https://site.example', kind: 'posts' }), { id: 's', name: 'S', url: 'https://site.example/', kind: 'posts' })
  assert.deepEqual(cleanFeedConfig({ name: 'S', url: 'https://site.example', kind: 'posts', rules: { maxPages: 5, genresRe: 'Tags: (.+)' } }), {
    id: 's',
    name: 'S',
    url: 'https://site.example/',
    kind: 'posts',
    rules: { maxPages: 5, genresRe: 'Tags: (.+)' },
  })
  assert.throws(() => cleanFeedConfig({ name: 'S', url: 'https://site.example', kind: 'magic' }), /read as/)
  assert.throws(() => cleanFeedConfig({ name: 'S', url: 'https://site.example', kind: 'posts', rules: { maxPages: 999 } }), /60/)
  assert.throws(() => cleanFeedConfig({ name: 'S', url: 'https://site.example', kind: 'posts', rules: { sizeRe: '(' } }), /pattern/)
})

test('turning the store on with nothing plugged in sets up the default sources', async () => {
  const jf = await fakeJellyfin('Home', [{ name: 'alex', token: 't-admin', admin: true }, { name: 'robin', token: 't-robin', admin: false }], 'service')
  const F = await finesse('postfeed', jf, 'service')
  const S = '/api/games/store'
  const real = globalThis.fetch
  type FetchInput = Parameters<typeof fetch>[0]
  globalThis.fetch = (async (input: FetchInput, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input)
    if (DEFAULT_FEEDS.some((f) => url.startsWith(f.url)))
      return { ok: true, status: 200, text: async () => JSON.stringify(url.includes('page=1') ? [POST, NOT_A_GAME] : []), headers: new Headers() } as unknown as Response
    return real(input, init)
  }) as typeof fetch
  try {
    const on = await call(F.url, 'PUT', `${S}/settings`, 't-admin', { enabled: true })
    assert.equal(on.status, 200)
    const list = (await call(F.url, 'GET', `${S}/feeds`, 't-admin')).data as { feeds: { id: string; status: { ok: boolean; games: number } | null }[] }
    assert.deepEqual(list.feeds.map((f) => f.id), DEFAULT_FEEDS.map((f) => f.id))
    for (const feed of list.feeds) {
      assert.equal(feed.status?.ok, true)
      assert.equal(feed.status?.games, 1)
    }
    const ids = (await call(F.url, 'GET', `${S}/search?q=great+game`, 't-robin')).data.items as { id: string }[]
    assert.deepEqual(ids.map((g) => g.id).sort(), ['dodi-great-game', 'fitgirl-great-game'])
    // The address is kept on the server and never shown to users.
    const view = (await call(F.url, 'GET', `${S}/games/fitgirl-great-game`, 't-robin')).data
    assert.ok(!JSON.stringify(view).includes('site.example'))
    // Removed defaults don't come back when the settings are saved again.
    await call(F.url, 'DELETE', `${S}/feeds/dodi`, 't-admin')
    const again = (await call(F.url, 'GET', `${S}/feeds`, 't-admin')).data as { feeds: { id: string }[] }
    assert.deepEqual(again.feeds.map((f) => f.id), ['fitgirl'])
  } finally {
    globalThis.fetch = real
    await new Promise((r) => jf.server.close(r))
    await new Promise((r) => F.app.close(r))
  }
})
