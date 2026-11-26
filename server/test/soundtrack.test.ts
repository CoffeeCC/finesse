import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findSoundtracks, requestSoundtrack, type LidarrAlbum, type LidarrCall } from '../src/albumRequests.ts'

const OST_ID = '11111111-1111-4111-8111-111111111111'
const TRIBUTE_ID = '22222222-2222-4222-8222-222222222222'
const UNRELATED_ID = '33333333-3333-4333-8333-333333333333'
const COMPOSER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

test('findSoundtracks ranks original soundtrack above tribute covers and drops unrelated albums', async () => {
  const catalog: LidarrAlbum[] = [
    {
      foreignAlbumId: TRIBUTE_ID,
      title: 'Interstellar Piano Cover Tribute',
      albumType: 'Album',
      releaseDate: '2016-01-01T00:00:00Z',
      artist: { foreignArtistId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', artistName: 'Lullaby Tribute Band' },
    },
    {
      foreignAlbumId: UNRELATED_ID,
      title: 'Greatest Hits Vol. 2',
      albumType: 'Album',
      releaseDate: '2014-05-01T00:00:00Z',
      artist: { foreignArtistId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', artistName: 'Random Pop' },
    },
    {
      foreignAlbumId: OST_ID,
      title: 'Interstellar (Original Motion Picture Soundtrack)',
      albumType: 'Album',
      secondaryTypes: ['Soundtrack'],
      releaseDate: '2014-11-17T00:00:00Z',
      images: [{ coverType: 'cover', remoteUrl: 'https://img.example/interstellar.jpg' }],
      artist: { foreignArtistId: COMPOSER_ID, artistName: 'Hans Zimmer' },
    },
  ]

  const call: LidarrCall = async (_method, path) => {
    if (path.startsWith('/album/lookup')) return catalog as never
    if (path === '/artist') return [{ id: 9, foreignArtistId: COMPOSER_ID, artistName: 'Hans Zimmer' }] as never
    if (path === '/album?artistId=9') return [{ id: 42, foreignAlbumId: OST_ID, monitored: true, statistics: { trackFileCount: 0 } }] as never
    throw new Error(`unexpected ${path}`)
  }

  const rows = await findSoundtracks(call, { title: 'Interstellar', year: 2014, kind: 'movie', composer: 'Hans Zimmer' })
  assert.equal(rows.length, 2)
  assert.equal(rows[0]!.foreignAlbumId, OST_ID)
  assert.equal(rows[0]!.artistName, 'Hans Zimmer')
  assert.equal(rows[0]!.cover, 'https://img.example/interstellar.jpg')
  assert.equal(rows[0]!.inLidarr, true)
  assert.equal(rows[0]!.monitored, true)
  assert.equal(rows[0]!.downloaded, false)
  assert.ok(!rows.some((r) => r.foreignAlbumId === UNRELATED_ID))
})

test('requestSoundtrack adds only that soundtrack without monitoring the composer discography', async () => {
  const posted: { path: string; body: Record<string, unknown> }[] = []
  const ost: LidarrAlbum = {
    foreignAlbumId: OST_ID,
    title: 'Interstellar (Original Motion Picture Soundtrack)',
    albumType: 'Album',
    releaseDate: '2014-11-17T00:00:00Z',
    artist: { foreignArtistId: COMPOSER_ID, artistName: 'Hans Zimmer' },
  }

  const call: LidarrCall = async (method, path, body) => {
    if (method === 'GET' && path === '/qualityprofile') return [{ id: 1, name: 'Lossless' }] as never
    if (method === 'GET' && path === '/rootfolder') return [{ path: '/data/media/music' }] as never
    if (method === 'GET' && path === '/metadataprofile') {
      return [{ id: 2, name: 'Standard', primaryAlbumTypes: [{ albumType: { name: 'Album' }, allowed: true }] }] as never
    }
    if (method === 'GET' && path === '/artist') return [] as never
    if (method === 'GET' && path.startsWith('/album/lookup')) return [ost] as never
    if (method === 'POST' && path === '/album') {
      posted.push({ path, body: body as Record<string, unknown> })
      return { id: 101 } as never
    }
    throw new Error(`unexpected ${method} ${path}`)
  }

  const res = await requestSoundtrack(call, {
    foreignAlbumId: OST_ID,
    albumTitle: ost.title!,
    artistName: 'Hans Zimmer',
    qualityProfileId: 1,
    rootFolderPath: '/data/media/music',
  })

  assert.equal(res.state, 'added')
  assert.equal(posted.length, 1)
  const payload = posted[0]!.body
  assert.equal(payload.monitored, true)
  assert.deepEqual(payload.addOptions, { searchForNewAlbum: true })
  const artist = payload.artist as Record<string, unknown>
  assert.equal(artist.rootFolderPath, '/data/media/music')
  assert.equal(artist.monitorNewItems, 'none')
  assert.deepEqual(artist.addOptions, { monitor: 'none', searchForMissingAlbums: false })
})
