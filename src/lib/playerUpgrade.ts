// "Get a better copy", from inside the player. Someone watching a film that looks rough asks for
// a better one without leaving it: Finesse finds the best release Radarr counts as an upgrade,
// starts it downloading, and keeps watching for it. When Radarr has swapped the file (it removes
// the old one itself) and Jellyfin has noticed, the player moves over to the new copy at the same
// moment in the film. Leave the player and the download still finishes; it just has nobody to
// switch for. Films only: a show's episodes are many files, each with its own answer.

import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '../api/client'
import { arrGrabRelease, arrLibraryQuality, arrMovieByTmdb, arrSearchReleases, type ArrMovieFile } from '../api/arr'
import { isLikelyUpgrade } from '../components/QualityModal'
import { useArrQueue } from '../api/queries'
import type { JfItem } from '../api/types'
import { bytes } from './downloadProblems'
import { knownFinesse } from './finesseServer'

export type UpgradeStage = 'idle' | 'looking' | 'none' | 'downloading' | 'arriving' | 'switched' | 'failed'

export interface PlayerUpgrade {
  /** This title can be upgraded from here (a film, requests set up). */
  available: boolean
  stage: UpgradeStage
  /** One line for the settings panel, in plain words. */
  line: string
  start: () => void
}

const tmdbOf = (item: JfItem | undefined) => (item as (JfItem & { ProviderIds?: Record<string, string> }) | undefined)?.ProviderIds?.Tmdb
const baseName = (p: string | undefined) => (p ?? '').split(/[\\/]/).pop() ?? ''

export function usePlayerUpgrade(
  item: JfItem | undefined,
  opts: {
    /** Words for the person, shown quietly over the film. */
    say: (text: string, tone?: 'error') => void
    /** The better copy is in the library: carry on with it (the same item, or a new one). */
    onReady: (newItemId: string) => void
  },
): PlayerUpgrade {
  const tmdb = tmdbOf(item)
  const available = Boolean(item && item.Type === 'Movie' && tmdb && knownFinesse()?.features?.movies)
  const [stage, setStage] = useState<UpgradeStage>('idle')
  const [note, setNote] = useState('')
  const job = useRef<{ movie: ArrMovieFile; startedAt: number } | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts
  const { data: queue } = useArrQueue(stage === 'downloading')

  // A different film: start over.
  useEffect(() => {
    job.current = null
    setStage('idle')
    setNote('')
  }, [item?.Id])

  const start = useCallback(() => {
    if (!available || !tmdb || stage === 'looking' || stage === 'downloading' || stage === 'arriving') return
    setStage('looking')
    setNote('')
    void (async () => {
      try {
        const movie = await arrMovieByTmdb(tmdb)
        if (!movie) {
          setStage('none')
          setNote('This film wasn’t added through Finesse’s requests, so it can’t be upgraded from here.')
          return
        }
        // The same test the Requests page uses for "this is an upgrade": Radarr's own word, or a
        // clearly better quality than the file there now. Never one Radarr turned down.
        const [releases, current] = await Promise.all([arrSearchReleases('movie', movie.id), arrLibraryQuality('movie', movie.id).catch(() => null)])
        // Without knowing what's there now, nothing can be called better: don't guess.
        const best = current ? releases.find((r) => !r.rejected && (r.isUpgrade || isLikelyUpgrade(r, current))) : undefined
        if (!best) {
          setStage('none')
          setNote(movie.quality ? `This is the best copy there is right now (${movie.quality}).` : 'This is the best copy there is right now.')
          return
        }
        await arrGrabRelease('movie', best)
        job.current = { movie, startedAt: Date.now() }
        setNote([best.qualityName, best.size > 0 ? bytes(best.size) : ''].filter(Boolean).join(' · '))
        setStage('downloading')
        optsRef.current.say(`Getting a better copy${best.qualityName ? ` (${best.qualityName})` : ''}. Keep watching: it switches over by itself when it’s ready.`)
      } catch {
        setStage('failed')
        setNote('Couldn’t look for a better copy just now. Try again in a minute.')
      }
    })()
  }, [available, tmdb, stage])

  // While it downloads: has Radarr swapped the file yet? Then: has Jellyfin seen the new one?
  useEffect(() => {
    if ((stage !== 'downloading' && stage !== 'arriving') || !job.current || !tmdb || !item) return
    let live = true
    const before = job.current.movie
    const look = async () => {
      try {
        const now = await arrMovieByTmdb(tmdb)
        if (!live || !now) return
        const swapped = Boolean(now.fileId && now.fileId !== before.fileId)
        if (!swapped) return
        if (stage === 'downloading') setStage('arriving')
        // Jellyfin names an item after its file, so the new copy is the film whose file has Radarr's new name.
        const found = await api.getItems({ searchTerm: item.Name ?? before.title, includeItemTypes: 'Movie', recursive: true, fields: 'ProviderIds,Path', limit: 20 })
        if (!live) return
        const hit = found.Items.find((i) => tmdbOf(i) === tmdb && now.fileName && baseName(i.Path) === now.fileName)
        if (!hit) return
        job.current = null
        setStage('switched')
        setNote(now.quality ?? '')
        optsRef.current.say(`The better copy is here${now.quality ? ` (${now.quality})` : ''}. Carrying on with it.`)
        optsRef.current.onReady(hit.Id)
      } catch {
        /* the apps were busy: look again next time */
      }
    }
    const iv = window.setInterval(() => void look(), stage === 'arriving' ? 6000 : 20000)
    return () => {
      live = false
      window.clearInterval(iv)
    }
  }, [stage, tmdb, item])

  const q = stage === 'downloading' && job.current ? queue?.find((x) => x.kind === 'movie' && x.refId === job.current!.movie.id) : undefined
  const line =
    stage === 'looking'
      ? 'Looking for a better copy…'
      : stage === 'downloading'
        ? q?.status === 'Needs attention'
          ? 'The better copy got stuck. Finesse is sorting it out.'
          : `Getting a better copy${note ? ` · ${note}` : ''}${q && q.progress > 0 ? ` · ${q.progress}%` : ''}`
        : stage === 'arriving'
          ? 'Downloaded. Adding it to your library…'
          : stage === 'switched'
            ? `You’re watching the better copy${note ? ` (${note})` : ''}.`
            : note

  return { available, stage, line, start }
}
