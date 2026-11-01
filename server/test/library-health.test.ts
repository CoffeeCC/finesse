// Library health (server/src/libraryHealth.ts): read-only findings from fixtures of what
// Jellyfin, Radarr and Sonarr return. Nothing is ever written.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Settings } from '../src/config.ts'
import { analyse, libraryHealth, type JfLite } from '../src/libraryHealth.ts'

const min = (m: number) => m * 600_000_000
const movies: JfLite[] = [
  { Id: 'm1', Name: 'District 9', ProductionYear: 2009, ProviderIds: { Tmdb: '17654' }, RunTimeTicks: min(112), Path: '/media/movies/District 9 (2009)/District 9.mkv' },
  { Id: 'm2', Name: 'District 9', ProductionYear: 2009, ProviderIds: { Tmdb: '17654' }, RunTimeTicks: min(112), Path: '/media/movies/District.9.2009.1080p/d9.mkv' },
  { Id: 'm3', Name: 'Sintel', ProviderIds: { Tmdb: '45745' }, RunTimeTicks: min(3), Path: '/media/movies/Sintel/sample.mkv' },
  { Id: 'm4', Name: 'Home Video', ProviderIds: { Tmdb: '999' }, RunTimeTicks: min(40) },
]
const episodes: JfLite[] = [
  { Id: 'e1', SeriesId: 's1', SeriesName: 'South Park', ParentIndexNumber: 1, IndexNumber: 1, Path: '/tv/South Park/S01E01.mkv' },
  { Id: 'e2', SeriesId: 's1', SeriesName: 'South Park', ParentIndexNumber: 1, IndexNumber: 1, Path: '/tv/South Park/Pack/sp101.mkv' },
  { Id: 'e3', SeriesId: 's1', SeriesName: 'South Park', ParentIndexNumber: 1, IndexNumber: 2 },
  { Id: 'e4', SeriesId: 's1', SeriesName: 'South Park', ParentIndexNumber: null, IndexNumber: null, Path: '/tv/South Park/South.Park.COMPLETE.mkv' },
]
const series: JfLite[] = [
  { Id: 's1', Name: 'South Park', ProviderIds: { Tvdb: '75897' } },
  { Id: 's2', Name: 'Bluey', ProviderIds: { Tvdb: '353546' } },
]
const radarr = [{ tmdbId: 17654, runtime: 112 }, { tmdbId: 45745, runtime: 15 }, { tmdbId: 999, runtime: 90 }]

test('duplicates, cut-short files, unnumbered episodes and unfollowed titles are found', () => {
  const f = analyse(movies, episodes, series, radarr, [{ tvdbId: 75897 }])
  const of = (k: string) => f.filter((x) => x.kind === k)
  assert.deepEqual(of('duplicate').map((x) => [x.title, x.items]), [
    ['District 9 (2009)', ['m1', 'm2']],
    ['South Park S1:E1', ['e1', 'e2']],
  ])
  assert.match(of('duplicate')[0]!.detail, /2 copies: District 9.mkv, d9.mkv/)
  assert.deepEqual(of('misfiled').map((x) => x.items), [['e4']])
  assert.match(of('misfiled')[0]!.detail, /without a season or episode number \(South.Park.COMPLETE.mkv\)/)
  // Home Video: 40 of 90 min → under half. Sintel is a 15-minute short: too short to judge, left alone.
  assert.deepEqual(of('short').map((x) => x.items[0]), ['m4'])
  assert.match(of('short')[0]!.detail, /runs 40 min, but the movie is 90 min/)
  assert.deepEqual(of('unfollowed').map((x) => [x.title, x.items]), [['1 show Sonarr doesn’t know', ['s2']]])
})

test('everything followed, no copies: nothing to say; apps not asked are not guessed about', () => {
  assert.deepEqual(analyse([movies[0]!], [episodes[2]!], [], null, null), [])
  const f = analyse([movies[0]!], [], [], [], null)
  assert.equal(f[0]!.kind, 'unfollowed')
})

test('only reads: Jellyfin and the apps are asked with GETs; an app not answering is said, not fatal', async () => {
  const asked: string[] = []
  const s = { services: { radarr: { url: 'http://radarr:7878', apiKey: 'rk' }, sonarr: { url: 'http://sonarr:8989', apiKey: 'sk' } } } as unknown as Settings
  const jf = async <T>(path: string) => {
    asked.push(`jf ${path.split('&')[1]}`)
    const type = /IncludeItemTypes=(\w+)/.exec(path)![1]
    return { Items: type === 'Movie' ? movies : type === 'Episode' ? episodes : series } as T
  }
  const get = async (url: string | URL) => {
    asked.push(String(url))
    if (String(url).includes('sonarr')) throw new Error('ECONNREFUSED')
    return radarr
  }
  const r = await libraryHealth(s, jf, get)
  assert.deepEqual(r.skipped, ['Sonarr didn’t answer, so titles it doesn’t know weren’t checked.'])
  assert.ok(r.findings.some((f) => f.kind === 'duplicate'))
  assert.ok(asked.includes('http://radarr:7878/api/v3/movie'))
})
