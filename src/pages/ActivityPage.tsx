import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { backdropUrl, episodeThumbUrl, getSession, posterUrl, type JfSession } from '../api/client'
import { useArrFailures, useArrQueue, useArrRequested, useLatest, useViews } from '../api/queries'
import type { JfItem } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import ArrThumb from '../components/ArrThumb'
import DownloadsSection from '../components/DownloadsSection'
import MediaCard from '../components/MediaCard'
import { useHouse } from '../components/os/now'
import { CardSkeleton } from '../components/Skeletons'
import { agoLabel } from '../lib/activity'
import { useFinesse } from '../lib/finesseServer'
import { requestStatus } from '../lib/requestStatus'

// Activity: full-width visual dashboard of everything happening on the server right now —
// live playback cards, active downloads with speed/ETA/rescue controls, pending requests,
// and recently added titles with poster artwork and hover previews.

const SEEN = 'finesse.activitySeen'
const PAD = 'px-4 sm:px-6 lg:px-12'

type Filter = 'all' | 'playing' | 'downloads' | 'requests' | 'added'

const AVATAR_TONES = [
  'bg-violet-500/25 text-violet-200 border-violet-400/30',
  'bg-sky-500/25 text-sky-200 border-sky-400/30',
  'bg-emerald-500/25 text-emerald-200 border-emerald-400/30',
  'bg-amber-500/25 text-amber-200 border-amber-400/30',
  'bg-fuchsia-500/25 text-fuchsia-200 border-fuchsia-400/30',
] as const

function avatarTone(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return AVATAR_TONES[h % AVATAR_TONES.length]!
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase()
}

function PlayingCard({ s, isMe }: { s: JfSession; isMe: boolean }) {
  const it = s.NowPlayingItem!
  const isEp = it.Type === 'Episode'
  const isAudio = it.Type === 'Audio'
  const targetHref = isAudio && it.AlbumId ? `/album/${it.AlbumId}` : `/item/${isEp && it.SeriesId ? it.SeriesId : it.Id}`
  const art = isEp
    ? episodeThumbUrl(it, 640) ?? backdropUrl(it, 640)
    : isAudio
      ? posterUrl(it, 480)
      : backdropUrl(it, 640) ?? posterUrl(it, 480)
  const title = isEp && it.SeriesName ? it.SeriesName : it.Name ?? 'Something'
  const subtitle = isEp
    ? [it.ParentIndexNumber != null && it.IndexNumber != null ? `S${it.ParentIndexNumber}:E${it.IndexNumber}` : '', it.Name].filter(Boolean).join(' · ')
    : isAudio
      ? it.AlbumArtist ?? it.Artists?.[0] ?? it.Album ?? 'Music'
      : it.ProductionYear
        ? String(it.ProductionYear)
        : ''
  const paused = Boolean(s.PlayState?.IsPaused)
  const pos = s.PlayState?.PositionTicks ?? 0
  const dur = it.RunTimeTicks ?? 0
  const pct = dur > 0 && pos > 0 ? Math.max(2, Math.min(100, Math.round((pos / dur) * 100))) : null
  const who = isMe ? 'You' : s.UserName || 'Someone'

  return (
    <Link
      to={targetHref}
      className="group relative flex flex-col justify-end overflow-hidden rounded-2xl border border-white/10 bg-ink-900/75 min-h-[11.5rem] hover:border-accent-400/50 transition"
    >
      {art && (
        <img
          src={art}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover opacity-55 transition-transform duration-500 group-hover:scale-105"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/75 to-ink-950/25" />

      <div className="relative flex items-center justify-between gap-2 px-4 pt-3.5">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold backdrop-blur-md ${
            paused
              ? 'border-amber-400/30 bg-amber-500/15 text-amber-200'
              : 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${paused ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'}`} aria-hidden />
          {paused ? 'Paused' : 'Playing'}
        </span>
        {s.DeviceName && (
          <span className="truncate rounded-full bg-black/50 px-2.5 py-0.5 text-[11px] font-medium text-ink-200 backdrop-blur-md">
            {s.DeviceName}
          </span>
        )}
      </div>

      <div className="relative mt-auto px-4 pb-4 pt-8">
        <div className="flex items-center gap-2.5">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold backdrop-blur-md ${avatarTone(s.UserId ?? who)}`}>
            {initials(who)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white group-hover:text-accent-200 transition-colors">{title}</p>
            <p className="truncate text-xs text-ink-300">
              {who}
              {subtitle ? ` · ${subtitle}` : ''}
            </p>
          </div>
          {pct != null && <span className="shrink-0 text-xs font-semibold tabular-nums text-ink-200">{pct}%</span>}
        </div>
        {pct != null && (
          <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/15" aria-hidden>
            <div className="h-full rounded-full bg-accent-400" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </Link>
  )
}

export default function ActivityPage() {
  const { session } = useAuth()
  const { info } = useFinesse()
  const requests = Boolean(info?.features?.requests)
  const { data: views } = useViews()
  const movieLib = views?.Items.find((v) => v.CollectionType === 'movies')
  const showLib = views?.Items.find((v) => v.CollectionType === 'tvshows')
  const musicLib = views?.Items.find((v) => v.CollectionType === 'music')
  const house = useHouse()
  const queue = useArrQueue(requests)
  const requested = useArrRequested(requests)
  const { data: failures } = useArrFailures(requests)
  const movies = useLatest(movieLib?.Id)
  const shows = useLatest(showLib?.Id)
  const music = useLatest(musicLib?.Id)

  const [filter, setFilter] = useState<Filter>('all')

  // New since the last visit: read once when the page opens, then this visit counts as seen.
  const [seenAt] = useState<number | null>(() => {
    const v = Number(localStorage.getItem(SEEN))
    return Number.isFinite(v) && v > 0 ? v : null
  })
  useEffect(() => {
    try {
      localStorage.setItem(SEEN, String(Date.now()))
    } catch {
      /* private mode */
    }
  }, [])

  const me = getSession()?.userId
  const playing = useMemo(
    () => (house.data ?? []).filter((s) => Boolean(s.NowPlayingItem)),
    [house.data],
  )
  const downloadKeys = useMemo(() => new Set((queue.data ?? []).map((q) => q.key)), [queue.data])
  const pendingRequests = useMemo(() => {
    if (!requests) return []
    return (requested.data ?? [])
      .filter((r) => !downloadKeys.has(r.key))
      .map((r) => {
        const s = requestStatus({ requested: true, hasFile: false, available: r.available, failure: failures?.get(r.key) })
        const ts = Date.parse(r.added)
        return { ...r, statusLabel: s.label, tone: s.tone, isNew: seenAt != null && Number.isFinite(ts) && ts > seenAt }
      })
      .sort((a, b) => Date.parse(b.added) - Date.parse(a.added))
  }, [requests, requested.data, downloadKeys, failures, seenAt])

  const recentlyAdded = useMemo(() => {
    const all: JfItem[] = [...(movies.data ?? []), ...(shows.data ?? []), ...(music.data ?? [])]
    const seen = new Set<string>()
    const dedup = all.filter((i) => {
      if (seen.has(i.Id)) return false
      seen.add(i.Id)
      return true
    })
    dedup.sort((a, b) => (Date.parse(b.DateCreated ?? '') || 0) - (Date.parse(a.DateCreated ?? '') || 0))
    return dedup.slice(0, 36)
  }, [movies.data, shows.data, music.data])

  const downloadsCount = requests ? (queue.data?.length ?? 0) : 0
  const loading = house.isLoading && movies.isLoading && shows.isLoading

  const tabs: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: 'Everything', count: playing.length + downloadsCount + pendingRequests.length + recentlyAdded.length },
    { id: 'playing', label: 'Playing now', count: playing.length },
    ...(requests ? [{ id: 'downloads' as const, label: 'Downloads', count: downloadsCount }] : []),
    ...(requests ? [{ id: 'requests' as const, label: 'Requests', count: pendingRequests.length }] : []),
    { id: 'added', label: 'Recently added', count: recentlyAdded.length },
  ]

  const show = (section: Exclude<Filter, 'all'>) => filter === 'all' || filter === section

  return (
    <div className={`${PAD} pb-16 pt-6 space-y-8`}>
      {/* Header + Summary + Filter Tabs */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title mb-1">Activity</h1>
          <p className="text-sm text-ink-400">
            Live streams, downloads, requests, and new arrivals.{' '}
            {session?.isAdmin ? 'As an admin you see everyone’s playback.' : 'You see your own playback and household requests.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Filter activity">
          {tabs.map((t) => {
            const active = filter === t.id
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(t.id)}
                className={`inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-xs font-semibold transition ${
                  active
                    ? 'border-white bg-white text-ink-950'
                    : 'border-white/10 bg-white/[0.04] text-ink-200 hover:border-white/25 hover:text-white'
                }`}
              >
                {t.label}
                {t.count > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                      active ? 'bg-ink-950/15 text-ink-950' : 'bg-white/10 text-ink-200'
                    }`}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Live Playing Now */}
      {show('playing') && (
        <section aria-label="Playing now">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight text-white">Playing now</h2>
            {playing.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden />
                {playing.length} active {playing.length === 1 ? 'stream' : 'streams'}
              </span>
            )}
          </div>
          {house.isError ? (
            <p className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              Can’t reach Jellyfin sessions right now.
            </p>
          ) : playing.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {playing.map((s) => (
                <PlayingCard key={s.Id} s={s} isMe={s.UserId === me} />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/5 bg-ink-900/45 px-5 py-6 text-sm text-ink-400">
              Nobody is streaming right now.
            </div>
          )}
        </section>
      )}

      {/* Active Downloads (full visual queue with speed, ETA, rescue controls) */}
      {requests && show('downloads') && (
        <div>
          {queue.isError ? (
            <p className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              Can’t reach Radarr/Sonarr/Lidarr queues right now.
            </p>
          ) : downloadsCount > 0 ? (
            <DownloadsSection title="Downloading now" />
          ) : filter === 'downloads' ? (
            <section aria-label="Downloading now">
              <h2 className="mb-3 text-lg font-semibold tracking-tight text-white">Downloading now</h2>
              <div className="rounded-2xl border border-white/5 bg-ink-900/45 px-5 py-6 text-sm text-ink-400">
                Nothing downloading right now.{' '}
                <Link to="/request" className="font-semibold text-accent-300 hover:text-white">
                  Request something →
                </Link>
              </div>
            </section>
          ) : null}
        </div>
      )}

      {/* Pending Requests */}
      {requests && show('requests') && (pendingRequests.length > 0 || filter === 'requests') && (
        <section aria-label="Pending requests">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight text-white">Waiting for release</h2>
            <Link to="/request" className="text-xs font-semibold text-accent-300 hover:text-white">
              Manage requests →
            </Link>
          </div>
          {requested.isError ? (
            <p className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              Can’t reach the request apps right now.
            </p>
          ) : pendingRequests.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {pendingRequests.slice(0, 16).map((r) => (
                <Link
                  key={r.key}
                  to="/request"
                  className="flex items-center gap-3 rounded-2xl border border-white/10 bg-ink-900/60 p-3 hover:border-white/25 hover:bg-ink-900/85 transition"
                >
                  <ArrThumb kind={r.kind} id={r.id} remote={r.poster} title={r.title} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-semibold text-white">
                        {r.title}
                        {r.year ? <span className="font-normal text-ink-400"> ({r.year})</span> : null}
                      </p>
                      {r.isNew && (
                        <span className="shrink-0 rounded-full bg-accent-500/25 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent-200">
                          New
                        </span>
                      )}
                    </div>
                    <p className={`mt-0.5 truncate text-xs ${r.tone === 'bad' ? 'text-amber-300' : 'text-ink-300'}`}>
                      {r.statusLabel}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-500">Requested {agoLabel(r.added)}</p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/5 bg-ink-900/45 px-5 py-6 text-sm text-ink-400">
              No pending requests waiting on a release.
            </div>
          )}
        </section>
      )}

      {/* Recently Added Poster Grid (with hover previews!) */}
      {show('added') && (
        <section aria-label="Recently added">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight text-white">Recently added</h2>
            {recentlyAdded.length > 0 && (
              <span className="text-xs text-ink-400">Latest {recentlyAdded.length} arrivals</span>
            )}
          </div>
          {loading ? (
            <div className="grid gap-4 sm:gap-5 grid-cols-2 min-[480px]:grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(168px,1fr))]">
              {Array.from({ length: 12 }).map((_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          ) : recentlyAdded.length > 0 ? (
            <div className="grid gap-4 sm:gap-5 grid-cols-2 min-[480px]:grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(168px,1fr))]">
              {recentlyAdded.map((item) => {
                const ts = item.DateCreated ? Date.parse(item.DateCreated) : NaN
                const isNew = seenAt != null && Number.isFinite(ts) && ts > seenAt
                const addedAgo = agoLabel(item.DateCreated)
                return (
                  <div key={item.Id} className="relative">
                    {isNew && (
                      <span className="pointer-events-none absolute left-2 top-2 z-10 rounded-full bg-accent-fill px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-md">
                        New
                      </span>
                    )}
                    <MediaCard item={item} />
                    {addedAgo && (
                      <p className="mt-0.5 px-0.5 text-[11px] text-ink-500">Added {addedAgo}</p>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/5 bg-ink-900/45 px-5 py-6 text-sm text-ink-400">
              Nothing new added to the library lately.
            </div>
          )}
        </section>
      )}
    </div>
  )
}
