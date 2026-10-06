// Delete from the library: the downloader is told first, files and emptied folders go, Jellyfin hears.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import type { SettingsStore } from '../src/config.ts'
import { Deleter } from '../src/deletions.ts'
import { listen, tmp } from './helpers.ts'

const ids = { movie: 'a'.repeat(32), loose: 'b'.repeat(32), show: 'c'.repeat(32), season: 'd'.repeat(32), episode: 'e'.repeat(32), album: 'f'.repeat(32), outside: '1'.repeat(32) }
let jf: Server, arr: Server
let jfUrl = '', arrUrl = ''
const seen: string[] = []
let data = ''
let failArr = false

function file(p: string, bytes = 10) {
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, 'x'.repeat(bytes))
}

before(async () => {
  data = tmp('finesse-delete-')
  const m = (p: string) => join(data, 'media', p)
  file(m('movies/Heat (1995)/Heat.mkv'), 100)
  file(m('movies/Heat (1995)/Heat.en.srt'))
  file(m('movies/Heat (1995)/poster.jpg'))
  file(m('movies/Loose.mkv'), 50)
  file(m('movies/Loose.nfo'))
  file(m('movies/Other.mkv'), 50)
  file(m('tv/Show (2010)/Season 01/Show.S01E01.mkv'), 30)
  file(m('tv/Show (2010)/Season 01/Show.S01E01.en.srt'))
  file(m('tv/Show (2010)/Season 01/Show.S01E02.mkv'), 30)
  file(m('tv/Show (2010)/Season 02/Show.S02E01.mkv'), 30)
  file(m('music/Artist/Album/01.flac'), 20)
  file(m('music/Artist/Album/02.flac'), 20)
  file(m('music/Artist/Album/cover.jpg'))
  const items: Record<string, object> = {
    [ids.movie]: { Id: ids.movie, Name: 'Heat', Type: 'Movie', ProductionYear: 1995, Path: '/data/media/movies/Heat (1995)/Heat.mkv', ProviderIds: { Tmdb: '949' } },
    [ids.loose]: { Id: ids.loose, Name: 'Loose', Type: 'Movie', Path: '/data/media/movies/Loose.mkv' },
    [ids.show]: { Id: ids.show, Name: 'Show', Type: 'Series', Path: '/data/media/tv/Show (2010)', ProviderIds: { Tvdb: '77' } },
    [ids.season]: { Id: ids.season, Name: 'Season 1', Type: 'Season', SeriesId: ids.show, SeriesName: 'Show', IndexNumber: 1 },
    [ids.episode]: { Id: ids.episode, Name: 'Pilot', Type: 'Episode', SeriesId: ids.show, SeriesName: 'Show', ParentIndexNumber: 2, IndexNumber: 1, Path: '/data/media/tv/Show (2010)/Season 02/Show.S02E01.mkv' },
    [ids.album]: { Id: ids.album, Name: 'Album', Type: 'MusicAlbum', AlbumArtist: 'Artist' },
    [ids.outside]: { Id: ids.outside, Name: 'Elsewhere', Type: 'Movie', Path: '/mnt/somewhere/else.mkv' },
  }
  const children: Record<string, object[]> = {
    [ids.season]: [{ Id: '9', Type: 'Episode', Path: '/data/media/tv/Show (2010)/Season 01/Show.S01E01.mkv' }, { Id: '8', Type: 'Episode', Path: '/data/media/tv/Show (2010)/Season 01/Show.S01E02.mkv' }],
    [ids.album]: [{ Id: '7', Type: 'Audio', Path: '/data/media/music/Artist/Album/01.flac' }, { Id: '6', Type: 'Audio', Path: '/data/media/music/Artist/Album/02.flac' }],
  }
  jf = createServer((req, res) => {
    const u = new URL(req.url!, 'http://x')
    seen.push(`jf ${req.method} ${u.pathname}`)
    res.setHeader('Content-Type', 'application/json')
    if (u.pathname === '/Items') {
      const parent = u.searchParams.get('ParentId')
      const id = u.searchParams.get('Ids')
      return res.end(JSON.stringify({ Items: parent ? (children[parent] ?? []) : id && items[id] ? [items[id]] : [] }))
    }
    res.end('{}')
  })
  arr = createServer((req, res) => {
    const u = new URL(req.url!, 'http://x')
    seen.push(`arr ${req.method} ${u.pathname}${u.search}`)
    res.setHeader('Content-Type', 'application/json')
    if (failArr) return void (res.statusCode = 500, res.end('{}'))
    if (u.pathname === '/api/v3/movie') return res.end(JSON.stringify([{ id: 5, tmdbId: 949, path: '/data/media/movies/Heat (1995)' }]))
    if (u.pathname === '/api/v3/series') return res.end(JSON.stringify([{ id: 3, tvdbId: 77, path: '/data/media/tv/Show (2010)' }]))
    if (u.pathname === '/api/v3/series/3' && req.method === 'GET') return res.end(JSON.stringify({ id: 3, seasons: [{ seasonNumber: 1, monitored: true }, { seasonNumber: 2, monitored: true }] }))
    if (u.pathname === '/api/v3/episode') return res.end(JSON.stringify([{ id: 41, seasonNumber: 2, episodeNumber: 1 }]))
    res.end('{}')
  })
  jfUrl = await listen(jf)
  arrUrl = await listen(arr)
})
after(() => {
  for (const s of [jf, arr]) {
    s.closeAllConnections()
    s.close()
  }
})

const deleter = (extra: Record<string, unknown> = {}) =>
  new Deleter({
    get: () => ({ mode: 'bundle', setup: { state: 'ready' }, stack: { hostData: data }, jellyfin: { url: jfUrl, apiKey: 'k' }, services: { radarr: { url: arrUrl, apiKey: 'r' }, sonarr: { url: arrUrl, apiKey: 's' } }, ...extra }),
  } as unknown as SettingsStore)
const at = (p: string) => existsSync(join(data, 'media', p))

test('a movie in its own folder: Radarr forgets it, the folder goes, Jellyfin hears', async () => {
  const d = deleter()
  const plan = await d.plan(ids.movie)
  assert.equal(plan.title, 'Heat (1995)')
  assert.equal(plan.bytes, 120)
  assert.equal(plan.downloader, 'Radarr won’t download it again')
  seen.length = 0
  await d.run(ids.movie)
  assert.equal(at('movies/Heat (1995)'), false)
  assert.equal(at('movies'), true)
  assert.ok(seen.includes('arr DELETE /api/v3/movie/5?deleteFiles=false&addImportExclusion=false'))
  assert.ok(seen.includes('jf POST /Library/Media/Updated'))
})

test('a movie loose in the movies folder: only its own files (and sidecars) go', async () => {
  await deleter().run(ids.loose)
  assert.equal(at('movies/Loose.mkv'), false)
  assert.equal(at('movies/Loose.nfo'), false)
  assert.equal(at('movies/Other.mkv'), true)
})

test('an episode: Sonarr stops watching it; the file goes and its emptied season folder too', async () => {
  seen.length = 0
  await deleter().run(ids.episode)
  assert.equal(at('tv/Show (2010)/Season 02'), false)
  assert.equal(at('tv/Show (2010)/Season 01/Show.S01E01.mkv'), true)
  assert.ok(seen.some((s) => s.startsWith('arr PUT /api/v3/episode/monitor')))
})

test('a season: Sonarr stops watching it; its episodes and subtitles go', async () => {
  seen.length = 0
  await deleter().run(ids.season)
  assert.equal(at('tv/Show (2010)/Season 01'), false)
  assert.equal(at('tv/Show (2010)'), false) // nothing left in the show's folder either
  assert.ok(seen.includes('arr PUT /api/v3/series/3'))
})

test('an album: its folder (cover art and all) goes', async () => {
  await deleter().run(ids.album)
  assert.equal(at('music/Artist/Album'), false)
  assert.equal(at('music'), true)
})

test('nothing outside the media folder, nothing when the downloader can’t be told, nothing on servers Finesse didn’t set up', async () => {
  await assert.rejects(deleter().plan(ids.outside), /isn’t in Finesse’s media folder/)
  file(join(data, 'media/movies/Heat (1995)/Heat.mkv'))
  failArr = true
  await assert.rejects(deleter().run(ids.movie), /nothing was deleted/)
  failArr = false
  assert.equal(at('movies/Heat (1995)/Heat.mkv'), true)
  await assert.rejects(deleter({ mode: 'adopt' }).plan(ids.movie), /servers Finesse set up/)
  await assert.rejects(deleter().plan('../../etc'), /Unknown item/)
})

test('a folder that is a shortcut out of the library is never deleted through', async () => {
  const outside = tmp('finesse-outside-')
  file(join(outside, 'precious.mkv'))
  const { symlinkSync } = await import('node:fs')
  symlinkSync(outside, join(data, 'media/movies/Linked (1999)'))
  const d = new Deleter({
    get: () => ({ mode: 'bundle', setup: { state: 'ready' }, stack: { hostData: data }, jellyfin: { url: jfUrl, apiKey: 'k' }, services: {} }),
  } as unknown as SettingsStore)
  // Jellyfin would report it at /data/media/movies/Linked (1999)/precious.mkv
  assert.equal((d as unknown as { host: (r: string, p: string) => string | null }).host(data, '/data/media/movies/Linked (1999)/precious.mkv'), null)
  assert.ok(existsSync(join(outside, 'precious.mkv')))
})
