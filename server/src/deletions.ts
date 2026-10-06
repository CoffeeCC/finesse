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
import { basename, dirname, extname, join } from 'node:path'
import type { Auth } from './auth.ts'
import type { SettingsStore } from './config.ts'
import { ApiError, sendJson, type Router } from './http/core.ts'
import { logger } from './log.ts'
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
    if (!jfPath || !jfPath.startsWith('/data/media/') || jfPath.split('/').includes('..')) return null
    const p = join(root, jfPath.slice('/data/'.length))
    const lib = LIBRARIES.map((l) => join(root, l)).find((l) => p === l || p.startsWith(l + '/'))
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
    let title = item.Name
    const kids = async (types: string) => (await this.items(`ParentId=${item.Id}&Recursive=true&IncludeItemTypes=${types}`)).map((k) => this.host(root, k.Path)).filter((p): p is string => Boolean(p))

    switch (item.Type) {
      case 'Movie': {
        const file = this.host(root, item.Path)
        if (!file) throw new ApiError(409, 'This movie isn’t in Finesse’s media folder, so Finesse can’t delete it')
        title = item.ProductionYear && !item.Name.includes(`(${item.ProductionYear})`) ? `${item.Name} (${item.ProductionYear})` : item.Name
        const folder = dirname(file)
        // Its own folder (nothing else to play in there): the whole folder goes. In a shared folder: just its files.
        const others = this.host(root, item.Path!.slice(0, item.Path!.lastIndexOf('/'))) && readdirSync(folder).filter((n) => VIDEO_OR_AUDIO.test(n) && join(folder, n) !== file && !n.toLowerCase().startsWith(basename(file, extname(file)).toLowerCase()))
        if (others && others.length === 0) folders.push(folder)
        else files.push(...this.withSidecars(file))
        const radarr = this.arr('radarr')
        if (radarr) {
          const tmdb = item.ProviderIds?.Tmdb
          const movies = await this.ask('radarr', () => radarr.req<{ id: number; path: string; tmdbId: number }[]>('GET', tmdb ? `/movie?tmdbId=${encodeURIComponent(tmdb)}` : '/movie'))
          const m = movies.find((x) => (tmdb && String(x.tmdbId) === tmdb) || x.path === item.Path!.slice(0, item.Path!.lastIndexOf('/')))
          if (m) steps.push({ app: 'radarr', say: 'Radarr won’t download it again', run: () => radarr.req('DELETE', `/movie/${m.id}?deleteFiles=false&addImportExclusion=false`) })
        }
        break
      }
      case 'Series': {
        const folder = this.host(root, item.Path)
        if (!folder) throw new ApiError(409, 'This show isn’t in Finesse’s media folder, so Finesse can’t delete it')
        folders.push(folder)
        const series = await this.sonarrSeries(item)
        if (series) {
          const { sonarr, id } = series
          steps.push({ app: 'sonarr', say: 'Sonarr won’t download it again', run: () => sonarr.req('DELETE', `/series/${id}?deleteFiles=false&addImportListExclusion=false`) })
        }
        break
      }
      case 'Season': {
        title = `${item.SeriesName ?? ''} ${item.Name}`.trim()
        const eps = await kids('Episode')
        if (!eps.length) throw new ApiError(409, 'There are no files to delete in this season')
        for (const f of eps) files.push(...this.withSidecars(f))
        const [show] = item.SeriesId ? await this.items(`Ids=${item.SeriesId}`) : []
        const series = show ? await this.sonarrSeries(show) : null
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
        break
      }
      case 'Episode': {
        const file = this.host(root, item.Path)
        if (!file) throw new ApiError(409, 'This episode isn’t in Finesse’s media folder, so Finesse can’t delete it')
        title = `${item.SeriesName ?? ''} S${String(item.ParentIndexNumber ?? 0).padStart(2, '0')}E${String(item.IndexNumber ?? 0).padStart(2, '0')}`.trim()
        files.push(...this.withSidecars(file))
        const [show] = item.SeriesId ? await this.items(`Ids=${item.SeriesId}`) : []
        const series = show ? await this.sonarrSeries(show) : null
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
        break
      }
      case 'MusicArtist': {
        const folder = this.host(root, item.Path)
        if (!folder) throw new ApiError(409, 'This artist isn’t in Finesse’s media folder, so Finesse can’t delete them')
        folders.push(folder)
        const lidarr = this.arr('lidarr')
        const mbid = item.ProviderIds?.MusicBrainzArtist
        if (lidarr && mbid) {
          const artists = await this.ask('lidarr', () => lidarr.req<{ id: number; foreignArtistId: string }[]>('GET', '/artist'))
          const a = artists.find((x) => x.foreignArtistId === mbid)
          if (a) steps.push({ app: 'lidarr', say: 'Lidarr won’t download them again', run: () => lidarr.req('DELETE', `/artist/${a.id}?deleteFiles=false`) })
        }
        break
      }
      case 'MusicAlbum': {
        title = item.AlbumArtist ? `${item.AlbumArtist}: ${item.Name}` : item.Name
        const tracks = await kids('Audio')
        if (!tracks.length) throw new ApiError(409, 'There are no files to delete in this album')
        for (const f of tracks) files.push(...this.withSidecars(f))
        // The album's own folder, with its cover art, when every track lives there.
        const dirs = [...new Set(tracks.map((t) => dirname(t)))]
        if (dirs.length === 1 && readdirSync(dirs[0]!).every((n) => !VIDEO_OR_AUDIO.test(n) || tracks.includes(join(dirs[0]!, n))) && this.host(root, `/data/${dirs[0]!.slice(root.length + 1)}`)) {
          files.length = 0
          folders.push(dirs[0]!)
        }
        const lidarr = this.arr('lidarr')
        const mbid = item.ProviderIds?.MusicBrainzReleaseGroup
        if (lidarr && mbid) {
          const albums = await this.ask('lidarr', () => lidarr.req<{ id: number; foreignAlbumId: string }[]>('GET', `/album?foreignAlbumId=${encodeURIComponent(mbid)}`))
          const al = albums.find((x) => x.foreignAlbumId === mbid)
          if (al) steps.push({ app: 'lidarr', say: 'Lidarr stops looking for this album', run: () => lidarr.req('PUT', '/album/monitor', { albumIds: [al.id], monitored: false }) })
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

    const bytes = [...files, ...folders].reduce((a, p) => a + this.size(p), 0)
    const gone = [...folders, ...files.filter((f) => VIDEO_OR_AUDIO.test(f))].map((p) => `/data/${p.slice(root.length + 1)}`)
    return { title, type: item.Type, files: [...new Set(files)], folders, bytes, downloader: steps[0]?.say ?? null, gone, steps }
  }

  private async sonarrSeries(show: JfItem): Promise<{ sonarr: Arr; id: number } | null> {
    const sonarr = this.arr('sonarr')
    if (!sonarr) return null
    const tvdb = show.ProviderIds?.Tvdb
    const all = await this.ask('sonarr', () => sonarr.req<{ id: number; tvdbId: number; path: string }[]>('GET', tvdb ? `/series?tvdbId=${encodeURIComponent(tvdb)}` : '/series'))
    const s = all.find((x) => (tvdb && String(x.tvdbId) === tvdb) || x.path === show.Path)
    return s ? { sonarr, id: s.id } : null
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
      while (this.host(root, `/data/${dir.slice(root.length + 1)}`)) {
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
    sendJson(res, 200, { title: p.title, type: p.type, bytes: p.bytes, files: p.files.length + p.folders.length, downloader: p.downloader })
  })
  router.post('/api/media/items/:id/delete', async ({ req, res, params }) => {
    await auth.requireAdmin(req)
    sendJson(res, 200, await deleter.run(params.id!))
  })
}
