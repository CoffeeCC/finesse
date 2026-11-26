// Delete from the library (administrators, servers Finesse set up): a movie, show, season, episode,
// artist, album or song.
//  1. The downloader that fetched it stops wanting it, so it isn't downloaded again: Radarr forgets
//     the movie, Sonarr the show (or stops watching that season or episode), Lidarr the album.
//  2. Finesse deletes the files (it writes the media folder; Jellyfin only reads it), and folders
//     left empty.
//  3. Jellyfin hears which paths are gone, so the item leaves every screen straight away.
// Everyone sees media at /data/media (Jellyfin, Radarr, Sonarr and Lidarr all mount the media
// folder at /data), which Finesse finds at <media folder>/media.

import { existsSync, readdirSync, rmdirSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, sep } from 'node:path'
import type { Auth } from './auth.ts'
import type { SettingsStore } from './config.ts'
import { ApiError, sendJson, type Router } from './http/core.ts'
import { logger } from './log.ts'
import { fromApp, hostToApp } from './stack/apppaths.ts'
import { Arr } from './stack/wire.ts'
import { insideLibrary } from './uploads.ts'

const log = logger('deletions')
const LIBRARIES = ['media/movies', 'media/tv', 'media/music']
const VIDEO_OR_AUDIO = /\.(mkv|mp4|m4v|avi|mov|wmv|ts|m2ts|webm|mpg|mpeg|flv|vob|mp3|flac|m4a|aac|ogg|opus|wav|wma|aiff?|ape|wv|dsf|mka)$/i

interface JfItem {
  Id: string
  Name: string
  Type: string
  Path?: string
  ProviderIds?: Record<string, string>
  SeriesId?: string
  SeasonId?: string
  ParentId?: string
  IndexNumber?: number
  ParentIndexNumber?: number
  ProductionYear?: number
  SeriesName?: string
  AlbumArtist?: string
}

type ArrStep = { app: 'radarr' | 'sonarr' | 'lidarr'; say: string; run: () => Promise<void> }

export interface DeletePlan {
  title: string
  type: string
  /** Files to delete (where Finesse sees them). */
  files: string[]
  /** Whole folders to delete (a movie's or show's own folder). */
  folders: string[]
  /** Files delegated to Radarr/Sonarr/Lidarr when the media lives outside Finesse's mount. */
  delegatedFiles: number
  bytes: number
  /** "Radarr won't download it again", or null when nothing was tracking it. */
  downloader: string | null
  /** For Jellyfin: the paths that are gone (as it sees them). */
  gone: string[]
  steps: ArrStep[]
}

export class Deleter {
  private readonly settings: SettingsStore

  constructor(settings: SettingsStore) {
    this.settings = settings
  }

  private root(): string {
    const s = this.settings.get()
    if (s.mode !== 'bundle' || !s.stack || s.setup.state !== 'ready') throw new ApiError(409, 'Deleting from the library works on servers Finesse set up. Delete the files on the server instead.')
    return s.stack.hostData
  }

  private jf() {
    const jf = this.settings.get().jellyfin
    if (!jf.url || !jf.apiKey) throw new ApiError(503, 'Jellyfin isn’t connected')
    return { base: `${jf.url}${jf.basePath ?? ''}`, headers: { Authorization: `MediaBrowser Client="Finesse", Device="Finesse server", DeviceId="finesse-server", Version="1", Token="${jf.apiKey}"` } }
  }

  private async items(query: string): Promise<JfItem[]> {
    const { base, headers } = this.jf()
    const r = await fetch(`${base}/Items?${query}&Fields=Path,ProviderIds,ParentId&EnableImages=false`, { headers, signal: AbortSignal.timeout(20000) })
    if (!r.ok) throw new ApiError(502, `Jellyfin answered ${r.status}`)
    return ((await r.json()) as { Items?: JfItem[] }).Items ?? []
  }

  /** Asks a downloader something; if it's set up but doesn't answer, nothing is deleted (it would fetch it again). */
  private async ask<T>(app: 'radarr' | 'sonarr' | 'lidarr', fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      throw new ApiError(502, `Couldn’t reach ${app[0]!.toUpperCase()}${app.slice(1)} (${(e as Error).message}), so nothing was deleted: it might download it again. Try again in a minute.`)
    }
  }

  private arr(app: 'radarr' | 'sonarr' | 'lidarr'): Arr | null {
    const svc = this.settings.get().services[app]
    return svc?.url && svc.apiKey ? new Arr(svc.url, svc.apiKey, app === 'lidarr' ? 'v1' : 'v3') : null
  }

  /** /data/media/movies/Heat (1995) → <media folder>/media/movies/Heat (1995), only inside a library. */
  private host(root: string, jfPath: string | undefined, allowLibraryRoot = false): string | null {
    const p = fromApp(root, jfPath)
    if (!p) return null
    const lib = LIBRARIES.map((l) => join(root, l)).find((l) => p === l || p.startsWith(l + sep))
    if (!lib || (!allowLibraryRoot && p === lib)) return null
    // Never through a shortcut (symlink) to somewhere outside the library.
    if (!insideLibrary(lib, p)) return null
    return p
  }

  /** A video or song file, plus the subtitles, posters and .nfo named after it. */
  private withSidecars(file: string): string[] {
    const dir = dirname(file)
    const stem = basename(file, extname(file)).toLowerCase()
    let names: string[] = []
    try {
      names = readdirSync(dir)
    } catch {
      return [file]
    }
    return [file, ...names.filter((n) => n.toLowerCase().startsWith(stem) && join(dir, n) !== file && !VIDEO_OR_AUDIO.test(n)).map((n) => join(dir, n))]
  }

  private size(p: string): number {
    try {
      const st = statSync(p)
      if (!st.isDirectory()) return st.size
      return readdirSync(p).reduce((a, n) => a + this.size(join(p, n)), 0)
    } catch {
      return 0
    }
  }

  async plan(itemId: string): Promise<DeletePlan> {
    const root = this.root()
    if (!/^[0-9a-f]{32}$/i.test(itemId)) throw new ApiError(400, 'Unknown item')
    const [item] = await this.items(`Ids=${itemId}`)
    if (!item) throw new ApiError(404, 'That item isn’t in the library any more')
    const files: string[] = []
    const folders: string[] = []
    const steps: ArrStep[] = []
    const delegatedGone: string[] = []
    let delegatedFiles = 0
    let delegatedBytes = 0
    let title = item.Name
    const rawKids = async (types: string) => this.items(`ParentId=${item.Id}&Recursive=true&IncludeItemTypes=${types}`)
    const pathTail = (p?: string) => (p ? p.replace(/[\\/]+$/, '').split(/[\\/]/).pop()?.toLowerCase() ?? '' : '')

    switch (item.Type) {
      case 'Movie': {
        const file = this.host(root, item.Path)
        title = item.ProductionYear && !item.Name.includes(`(${item.ProductionYear})`) ? `${item.Name} (${item.ProductionYear})` : item.Name
        const radarr = this.arr('radarr')
        let matchedMovie: { id: number; path: string; tmdbId: number; sizeOnDisk?: number; movieFile?: { size?: number } } | undefined
        if (radarr) {
          const tmdb = item.ProviderIds?.Tmdb
          const movies = await this.ask('radarr', () =>
            radarr.req<{ id: number; path: string; tmdbId: number; sizeOnDisk?: number; movieFile?: { size?: number } }[]>(
              'GET',
              tmdb ? `/movie?tmdbId=${encodeURIComponent(tmdb)}` : '/movie',
            ),
          )
          const jfDir = item.Path ? item.Path.slice(0, item.Path.lastIndexOf('/')) : ''
          const jfFolderName = pathTail(jfDir)
          matchedMovie = movies.find(
            (x) =>
              (tmdb && String(x.tmdbId) === tmdb) ||
              (jfDir && x.path === jfDir) ||
              (!file && jfFolderName && pathTail(x.path) === jfFolderName),
          )
        }
        if (file) {
          const folder = dirname(file)
          // Its own folder (nothing else to play in there): the whole folder goes. In a shared folder: just its files.
          const others = this.host(root, item.Path!.slice(0, item.Path!.lastIndexOf('/'))) && readdirSync(folder).filter((n) => VIDEO_OR_AUDIO.test(n) && join(folder, n) !== file && !n.toLowerCase().startsWith(basename(file, extname(file)).toLowerCase()))
          if (others && others.length === 0) folders.push(folder)
          else files.push(...this.withSidecars(file))
          if (radarr && matchedMovie) {
            const m = matchedMovie
            steps.push({ app: 'radarr', say: 'Radarr won’t download it again', run: () => radarr.req('DELETE', `/movie/${m.id}?deleteFiles=false&addImportExclusion=false`) })
          }
        } else if (radarr && matchedMovie) {
          // Custom mount (e.g. TrueNAS /movies): Finesse can't see the file directly, so ask Radarr to remove it.
          const m = matchedMovie
          delegatedFiles = 1
          delegatedBytes = m.sizeOnDisk ?? m.movieFile?.size ?? 0
          if (item.Path) delegatedGone.push(item.Path)
          steps.push({ app: 'radarr', say: 'Radarr deletes the files and won’t download it again', run: () => radarr.req('DELETE', `/movie/${m.id}?deleteFiles=true&addImportExclusion=false`) })
        } else {
          throw new ApiError(409, 'This movie isn’t in Finesse’s media folder, so Finesse can’t delete it')
        }
        break
      }
      case 'Series': {
        const folder = this.host(root, item.Path)
        const series = await this.sonarrSeries(item, !folder)
        if (folder) {
          folders.push(folder)
          if (series) {
            const { sonarr, id } = series
            steps.push({ app: 'sonarr', say: 'Sonarr won’t download it again', run: () => sonarr.req('DELETE', `/series/${id}?deleteFiles=false&addImportListExclusion=false`) })
          }
        } else if (series) {
          const { sonarr, id, sizeOnDisk } = series
          delegatedFiles = 1
          delegatedBytes = sizeOnDisk
          if (item.Path) delegatedGone.push(item.Path)
          steps.push({ app: 'sonarr', say: 'Sonarr deletes the files and won’t download it again', run: () => sonarr.req('DELETE', `/series/${id}?deleteFiles=true&addImportListExclusion=false`) })
        } else {
          throw new ApiError(409, 'This show isn’t in Finesse’s media folder, so Finesse can’t delete it')
        }
        break
      }
      case 'Season': {
        title = `${item.SeriesName ?? ''} ${item.Name}`.trim()
        const allEps = await rawKids('Episode')
        const eps = allEps.map((k) => this.host(root, k.Path)).filter((p): p is string => Boolean(p))
        const [show] = item.SeriesId ? await this.items(`Ids=${item.SeriesId}`) : []
        const series = show ? await this.sonarrSeries(show, eps.length === 0) : null
        if (eps.length) {
          for (const f of eps) files.push(...this.withSidecars(f))
          if (series && typeof item.IndexNumber === 'number') {
            const { sonarr, id } = series
            const n = item.IndexNumber
            steps.push({
              app: 'sonarr',
              say: 'Sonarr stops looking for this season',
              run: async () => {
                const s = await sonarr.req<{ seasons: { seasonNumber: number; monitored: boolean }[] }>('GET', `/series/${id}`)
                s.seasons = s.seasons.map((x) => (x.seasonNumber === n ? { ...x, monitored: false } : x))
                await sonarr.req('PUT', `/series/${id}`, s)
              },
            })
          }
        } else if (allEps.length && series && typeof item.IndexNumber === 'number') {
          const { sonarr, id } = series
          const n = item.IndexNumber
          const epFiles = (await this.ask('sonarr', () => sonarr.req<{ id: number; seasonNumber: number; size?: number }[]>('GET', `/episodefile?seriesId=${id}`))).filter((f) => f.seasonNumber === n)
          if (!epFiles.length) throw new ApiError(409, 'There are no files to delete in this season')
          delegatedFiles = epFiles.length
          delegatedBytes = epFiles.reduce((a, f) => a + (f.size ?? 0), 0)
          for (const e of allEps) if (e.Path) delegatedGone.push(e.Path)
          steps.push({
            app: 'sonarr',
            say: 'Sonarr deletes the season’s files and stops looking for it',
            run: async () => {
              const s = await sonarr.req<{ seasons: { seasonNumber: number; monitored: boolean }[] }>('GET', `/series/${id}`)
              s.seasons = s.seasons.map((x) => (x.seasonNumber === n ? { ...x, monitored: false } : x))
              await sonarr.req('PUT', `/series/${id}`, s)
              for (const ef of epFiles) await sonarr.req('DELETE', `/episodefile/${ef.id}`)
            },
          })
        } else {
          throw new ApiError(409, 'There are no files to delete in this season')
        }
        break
      }
      case 'Episode': {
        const file = this.host(root, item.Path)
        title = `${item.SeriesName ?? ''} S${String(item.ParentIndexNumber ?? 0).padStart(2, '0')}E${String(item.IndexNumber ?? 0).padStart(2, '0')}`.trim()
        const [show] = item.SeriesId ? await this.items(`Ids=${item.SeriesId}`) : []
        const series = show ? await this.sonarrSeries(show, !file) : null
        if (file) {
          files.push(...this.withSidecars(file))
          if (series) {
            const { sonarr, id } = series
            steps.push({
              app: 'sonarr',
              say: 'Sonarr stops looking for this episode',
              run: async () => {
                const eps = await sonarr.req<{ id: number; seasonNumber: number; episodeNumber: number }[]>('GET', `/episode?seriesId=${id}`)
                const ep = eps.find((e) => e.seasonNumber === item.ParentIndexNumber && e.episodeNumber === item.IndexNumber)
                if (ep) await sonarr.req('PUT', '/episode/monitor', { episodeIds: [ep.id], monitored: false })
              },
            })
          }
        } else if (series) {
          const { sonarr, id } = series
          const eps = await this.ask('sonarr', () => sonarr.req<{ id: number; seasonNumber: number; episodeNumber: number; episodeFileId?: number }[]>('GET', `/episode?seriesId=${id}`))
          const ep = eps.find((e) => e.seasonNumber === item.ParentIndexNumber && e.episodeNumber === item.IndexNumber)
          if (!ep?.episodeFileId) throw new ApiError(409, 'This episode isn’t in Finesse’s media folder, so Finesse can’t delete it')
          const efId = ep.episodeFileId
          const ef = await sonarr.req<{ size?: number }>('GET', `/episodefile/${efId}`).catch(() => null)
          delegatedFiles = 1
          delegatedBytes = ef?.size ?? 0
          if (item.Path) delegatedGone.push(item.Path)
          steps.push({
            app: 'sonarr',
            say: 'Sonarr deletes the episode’s file and stops looking for it',
            run: async () => {
              await sonarr.req('PUT', '/episode/monitor', { episodeIds: [ep.id], monitored: false })
              await sonarr.req('DELETE', `/episodefile/${efId}`)
            },
          })
        } else {
          throw new ApiError(409, 'This episode isn’t in Finesse’s media folder, so Finesse can’t delete it')
        }
        break
      }
      case 'MusicArtist': {
        const folder = this.host(root, item.Path)
        const lidarr = this.arr('lidarr')
        const mbid = item.ProviderIds?.MusicBrainzArtist
        let matchedArtist: { id: number; foreignArtistId: string; statistics?: { sizeOnDisk?: number } } | undefined
        if (lidarr && mbid) {
          const artists = await this.ask('lidarr', () => lidarr.req<{ id: number; foreignArtistId: string; statistics?: { sizeOnDisk?: number } }[]>('GET', '/artist'))
          matchedArtist = artists.find((x) => x.foreignArtistId === mbid)
        }
        if (folder) {
          folders.push(folder)
          if (lidarr && matchedArtist) {
            const a = matchedArtist
            steps.push({ app: 'lidarr', say: 'Lidarr won’t download them again', run: () => lidarr.req('DELETE', `/artist/${a.id}?deleteFiles=false`) })
          }
        } else if (lidarr && matchedArtist) {
          const a = matchedArtist
          delegatedFiles = 1
          delegatedBytes = a.statistics?.sizeOnDisk ?? 0
          if (item.Path) delegatedGone.push(item.Path)
          steps.push({ app: 'lidarr', say: 'Lidarr deletes the files and won’t download them again', run: () => lidarr.req('DELETE', `/artist/${a.id}?deleteFiles=true`) })
        } else {
          throw new ApiError(409, 'This artist isn’t in Finesse’s media folder, so Finesse can’t delete them')
        }
        break
      }
      case 'MusicAlbum': {
        title = item.AlbumArtist ? `${item.AlbumArtist}: ${item.Name}` : item.Name
        const allTracks = await rawKids('Audio')
        const tracks = allTracks.map((k) => this.host(root, k.Path)).filter((p): p is string => Boolean(p))
        const lidarr = this.arr('lidarr')
        const mbid = item.ProviderIds?.MusicBrainzReleaseGroup
        let matchedAlbum: { id: number; foreignAlbumId: string } | undefined
        if (lidarr && mbid) {
          const albums = await this.ask('lidarr', () => lidarr.req<{ id: number; foreignAlbumId: string }[]>('GET', `/album?foreignAlbumId=${encodeURIComponent(mbid)}`))
          matchedAlbum = albums.find((x) => x.foreignAlbumId === mbid)
        }
        if (tracks.length) {
          for (const f of tracks) files.push(...this.withSidecars(f))
          // The album's own folder, with its cover art, when every track lives there.
          const dirs = [...new Set(tracks.map((t) => dirname(t)))]
          if (dirs.length === 1 && readdirSync(dirs[0]!).every((n) => !VIDEO_OR_AUDIO.test(n) || tracks.includes(join(dirs[0]!, n))) && this.host(root, hostToApp(root, dirs[0]!))) {
            files.length = 0
            folders.push(dirs[0]!)
          }
          if (lidarr && matchedAlbum) {
            const al = matchedAlbum
            steps.push({ app: 'lidarr', say: 'Lidarr stops looking for this album', run: () => lidarr.req('PUT', '/album/monitor', { albumIds: [al.id], monitored: false }) })
          }
        } else if (allTracks.length && lidarr && matchedAlbum) {
          const al = matchedAlbum
          const trackFiles = await this.ask('lidarr', () => lidarr.req<{ id: number; size?: number }[]>('GET', `/trackfile?albumId=${al.id}`))
          if (!trackFiles.length) throw new ApiError(409, 'There are no files to delete in this album')
          delegatedFiles = trackFiles.length
          delegatedBytes = trackFiles.reduce((a, f) => a + (f.size ?? 0), 0)
          for (const t of allTracks) if (t.Path) delegatedGone.push(t.Path)
          steps.push({
            app: 'lidarr',
            say: 'Lidarr deletes the album’s files and stops looking for it',
            run: async () => {
              await lidarr.req('PUT', '/album/monitor', { albumIds: [al.id], monitored: false })
              for (const tf of trackFiles) await lidarr.req('DELETE', `/trackfile/${tf.id}`)
            },
          })
        } else {
          throw new ApiError(409, 'There are no files to delete in this album')
        }
        break
      }
      case 'Audio': {
        const file = this.host(root, item.Path)
        if (!file) throw new ApiError(409, 'This song isn’t in Finesse’s media folder, so Finesse can’t delete it')
        files.push(...this.withSidecars(file))
        break
      }
      default:
        throw new ApiError(400, 'Only movies, shows, seasons, episodes, artists, albums and songs can be deleted here')
    }

    const bytes = [...files, ...folders].reduce((a, p) => a + this.size(p), 0) + delegatedBytes
    const gone = [...[...folders, ...files.filter((f) => VIDEO_OR_AUDIO.test(f))].map((p) => hostToApp(root, p)), ...delegatedGone]
    return { title, type: item.Type, files: [...new Set(files)], folders, delegatedFiles, bytes, downloader: steps[0]?.say ?? null, gone, steps }
  }

  private async sonarrSeries(show: JfItem, matchFolderName = false): Promise<{ sonarr: Arr; id: number; sizeOnDisk: number } | null> {
    const sonarr = this.arr('sonarr')
    if (!sonarr) return null
    const tvdb = show.ProviderIds?.Tvdb
    const all = await this.ask('sonarr', () => sonarr.req<{ id: number; tvdbId: number; path: string; statistics?: { sizeOnDisk?: number } }[]>('GET', tvdb ? `/series?tvdbId=${encodeURIComponent(tvdb)}` : '/series'))
    const tail = (p?: string) => (p ? p.replace(/[\\/]+$/, '').split(/[\\/]/).pop()?.toLowerCase() ?? '' : '')
    const showTail = tail(show.Path)
    const s = all.find(
      (x) =>
        (tvdb && String(x.tvdbId) === tvdb) ||
        x.path === show.Path ||
        (matchFolderName && showTail && tail(x.path) === showTail),
    )
    return s ? { sonarr, id: s.id, sizeOnDisk: s.statistics?.sizeOnDisk ?? 0 } : null
  }

  async run(itemId: string): Promise<{ title: string; freed: number }> {
    const root = this.root()
    const plan = await this.plan(itemId)
    // The downloader first: if it can't be told, nothing is deleted (it would only fetch it again).
    for (const step of plan.steps) {
      try {
        await step.run()
      } catch (e) {
        throw new ApiError(502, `Couldn’t tell ${step.app[0]!.toUpperCase()}${step.app.slice(1)} to stop (${(e as Error).message}). Nothing was deleted.`)
      }
    }
    for (const f of plan.folders) rmSync(f, { recursive: true, force: true })
    for (const f of plan.files) rmSync(f, { force: true })
    // Folders the deletion emptied (a season, an album), up to the library itself.
    for (const start of new Set([...plan.files, ...plan.folders].map((p) => dirname(p)))) {
      let dir = start
      while (this.host(root, hostToApp(root, dir))) {
        try {
          if (existsSync(dir)) rmdirSync(dir)
        } catch {
          break
        }
        dir = dirname(dir)
      }
    }
    log.info(`deleted ${plan.type} “${plan.title}” (${Math.round(plan.bytes / 1e6)} MB)`)
    await this.tellJellyfin(plan.gone, itemId)
    // Sonarr and Lidarr notice the files are gone on their next look; ask now.
    void this.rescan(plan).catch(() => {})
    return { title: plan.title, freed: plan.bytes }
  }

  private async tellJellyfin(paths: string[], itemId: string) {
    const { base, headers } = this.jf()
    // Straight out of Jellyfin's lists (its files are already gone, so there's nothing for it to delete)…
    await fetch(`${base}/Items/${itemId}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(15000) }).catch(() => {})
    // …and the paths, for anything else that pointed at them (it acts on these after a short wait).
    try {
      const r = await fetch(`${base}/Library/Media/Updated`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ Updates: paths.map((Path) => ({ Path, UpdateType: 'Deleted' })) }),
        signal: AbortSignal.timeout(15000),
      })
      if (!r.ok) throw new Error(String(r.status))
    } catch {
      await fetch(`${base}/Library/Refresh`, { method: 'POST', headers, signal: AbortSignal.timeout(15000) }).catch(() => {})
    }
  }

  private async rescan(plan: DeletePlan) {
    if (plan.type === 'Season' || plan.type === 'Episode') await this.arr('sonarr')?.req('POST', '/command', { name: 'RescanSeries' })
    if (plan.type === 'MusicAlbum' || plan.type === 'Audio') await this.arr('lidarr')?.req('POST', '/command', { name: 'RescanFolders' })
  }
}

export function registerDeletions(router: Router, deps: { deleter: Deleter; auth: Auth }) {
  const { deleter, auth } = deps
  // What deleting would do (for the confirmation): title, size, whether a downloader is told.
  router.get('/api/media/items/:id/delete', async ({ req, res, params }) => {
    await auth.requireAdmin(req)
    const p = await deleter.plan(params.id!)
    sendJson(res, 200, { title: p.title, type: p.type, bytes: p.bytes, files: p.files.length + p.folders.length + p.delegatedFiles, downloader: p.downloader })
  })
  router.post('/api/media/items/:id/delete', async ({ req, res, params }) => {
    await auth.requireAdmin(req)
    sendJson(res, 200, await deleter.run(params.id!))
  })
}
