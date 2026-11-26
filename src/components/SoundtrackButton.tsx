import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { findSoundtracks, requestSoundtrackAlbum, type SoundtrackAlbum } from '../api/arr'
import { useMusicSearch } from '../api/queries'
import { useMyLimits } from '../api/parental'
import { posterUrl } from '../api/client'
import type { JfItem } from '../api/types'
import { useFinesse } from '../lib/finesseServer'
import { ActionButton } from './ActionButton'
import { useToast } from './Toast'

/**
 * Movie & Show detail-page action: searches Lidarr for the title's soundtrack /
 * original score and lets you download ONLY that album straight into your music
 * library with one click (or jump straight to it if you already have it).
 */
export default function SoundtrackButton({ item }: { item: JfItem }) {
  const { info } = useFinesse()
  const limits = useMyLimits()
  const [open, setOpen] = useState(false)

  // Only offered on movies & shows when Lidarr music requests are enabled and allowed.
  if (item.Type !== 'Movie' && item.Type !== 'Series') return null
  if (info?.features && info.features.music === false) return null
  if (limits && !limits.requests) return null

  return (
    <>
      <ActionButton
        label="Soundtrack"
        onClick={() => setOpen(true)}
        active={open}
        ariaLabel={`Find soundtrack for ${item.Name ?? 'this title'}`}
        icon={
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="m9 9 10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 0 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z" />
          </svg>
        }
      />
      {open && <SoundtrackModal item={item} onClose={() => setOpen(false)} />}
    </>
  )
}

function SoundtrackModal({ item, onClose }: { item: JfItem; onClose: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const composer = item.People?.find((p) => p.Type === 'Composer')?.Name
  const kind = item.Type === 'Series' ? 'series' : 'movie'
  const [query, setQuery] = useState(item.Name ?? '')
  const [activeQuery, setActiveQuery] = useState(item.Name ?? '')
  const [retryKey, setRetryKey] = useState(0)
  const [albums, setAlbums] = useState<SoundtrackAlbum[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [requestedIds, setRequestedIds] = useState<Record<string, 'searching' | 'added' | 'have'>>({})

  // Also check if Jellyfin's music library already has a matching soundtrack album.
  const localMusic = useMusicSearch(item.Name ? item.Name : '')
  const localAlbums = (localMusic.data?.albums ?? []).slice(0, 2)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setError(null)
    findSoundtracks(
      {
        title: activeQuery,
        year: activeQuery === (item.Name ?? '') ? item.ProductionYear : undefined,
        kind,
        composer: activeQuery === (item.Name ?? '') ? composer : undefined,
      },
      ac.signal,
    )
      .then((list) => {
        if (!ac.signal.aborted) setAlbums(list)
      })
      .catch((e) => {
        if (ac.signal.aborted) return
        setError(e instanceof Error && e.message ? e.message : 'Couldn’t search Lidarr for soundtracks right now.')
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })
    return () => ac.abort()
  }, [activeQuery, retryKey, item.Name, item.ProductionYear, kind, composer])

  const download = async (album: SoundtrackAlbum) => {
    if (busyId) return
    setBusyId(album.foreignAlbumId)
    try {
      const res = await requestSoundtrackAlbum(album)
      const st = res.state === 'have' ? 'have' : res.state === 'added' ? 'added' : 'searching'
      setRequestedIds((prev) => ({ ...prev, [album.foreignAlbumId]: st }))
      toast(res.message)
      for (const key of [['arrQueue'], ['arrRequested']]) void qc.invalidateQueries({ queryKey: key })
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message.slice(0, 180) : `Couldn’t request “${album.title}”`, 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Soundtrack for ${item.Name ?? 'this title'}`}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="os-menu relative flex max-h-[85vh] w-full sm:max-w-xl flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl border border-white/12 shadow-[0_30px_90px_-12px_rgba(0,0,0,0.85)]">
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent-400/50 to-transparent" />
        <div className="flex items-start justify-between gap-3 border-b border-white/[0.08] px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-2xl leading-tight text-white truncate">Soundtrack</h2>
            <p className="mt-0.5 text-xs text-ink-400 truncate">
              {item.Name}
              {composer ? ` · Music by ${composer}` : ''} — downloads straight into your Music library via Lidarr
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close soundtrack dialog"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/12 bg-white/[0.05] text-ink-300 hover:bg-white/10 hover:text-white active:scale-95 transition"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Optional search refinement */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (query.trim()) setActiveQuery(query.trim())
          }}
          className="flex items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-5 py-2.5"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search soundtrack or composer…"
            aria-label="Search Lidarr for soundtrack"
            className="search-field h-9 flex-1 min-w-0 rounded-lg border border-white/12 bg-white/[0.05] px-3 text-sm text-white placeholder:text-ink-400 focus:border-accent-400/60"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="h-9 shrink-0 rounded-lg border border-white/15 bg-white/[0.08] px-3.5 text-xs font-semibold text-white hover:bg-white/15 disabled:opacity-50 active:scale-[0.97] transition"
          >
            Search
          </button>
        </form>

        <div className="os-scroll flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {localAlbums.length > 0 && (
            <div>
              <p className="mb-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-emerald-300/90">
                Already in your Music library
              </p>
              <div className="space-y-1.5">
                {localAlbums.map((a) => {
                  const art = posterUrl(a, 120)
                  return (
                    <Link
                      key={a.Id}
                      to={`/album/${a.Id}`}
                      onClick={onClose}
                      className="flex items-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-2.5 hover:bg-emerald-400/[0.12] transition-colors"
                    >
                      <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-ink-800 ring-1 ring-white/10">
                        {art && <img src={art} alt="" decoding="async" className="h-full w-full object-cover" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-white">{a.Name}</span>
                        <span className="block truncate text-xs text-ink-300">
                          {[a.AlbumArtist, a.ProductionYear].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-semibold text-ink-950">Listen</span>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}

          <div>
            <p className="mb-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-400">
              Lidarr results
            </p>
            {loading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
                    <div className="h-12 w-12 shrink-0 rounded-lg shimmer" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-48 rounded shimmer" />
                      <div className="h-3 w-32 rounded shimmer" />
                    </div>
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-100">
                <p>{error}</p>
                <button
                  type="button"
                  onClick={() => setRetryKey((k) => k + 1)}
                  className="mt-3 rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/15"
                >
                  Try again
                </button>
              </div>
            ) : albums.length === 0 ? (
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 text-center">
                <p className="text-sm font-semibold text-white">No soundtrack matches found for “{activeQuery}”</p>
                <p className="mt-1 text-xs text-ink-400">Try searching with the composer’s name or a shorter title above.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {albums.map((album) => {
                  const reqState = requestedIds[album.foreignAlbumId]
                  const isHave = album.downloaded || reqState === 'have'
                  const isRequested = reqState === 'added' || reqState === 'searching' || (album.inLidarr && album.monitored)
                  const isBusy = busyId === album.foreignAlbumId
                  return (
                    <div
                      key={album.foreignAlbumId}
                      className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-2.5 hover:border-white/15 transition-colors"
                    >
                      <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-ink-800 ring-1 ring-white/10 flex items-center justify-center text-ink-400">
                        {album.cover ? (
                          <img src={album.cover} alt="" decoding="async" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                        ) : (
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m9 9 10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303" />
                          </svg>
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white">{album.title}</p>
                        <p className="truncate text-xs text-ink-400">
                          {[album.artistName, album.year, album.type].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      {isHave ? (
                        <span className="shrink-0 rounded-full border border-emerald-400/25 bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-200">
                          In library
                        </span>
                      ) : isRequested ? (
                        <span className="shrink-0 rounded-full border border-accent-400/30 bg-accent-400/15 px-3 py-1 text-xs font-semibold text-accent-200">
                          Downloading
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void download(album)}
                          disabled={busyId !== null}
                          className="shrink-0 h-9 rounded-full bg-white px-4 text-xs font-semibold text-ink-950 hover:bg-ink-200 disabled:opacity-50 active:scale-[0.97] transition"
                        >
                          {isBusy ? 'Requesting…' : 'Download'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
