import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getSession } from '../api/client'
import { useArrFailures, useArrQueue, useArrRequested, useLatest, useViews } from '../api/queries'
import { useAuth } from '../auth/AuthContext'
import { useHouse } from '../components/os/now'
import { agoLabel, buildActivity, type ActivityEntry } from '../lib/activity'
import { useFinesse } from '../lib/finesseServer'
import { requestStatus } from '../lib/requestStatus'

// Activity: what's happening on the server, in one place: playing now, downloads, requests
// still waiting, and what was just added. Only data this account can already see elsewhere
// (Jellyfin decides whose playback shows; requests and downloads are the household's, as on
// the Requests page). Each part loads on its own, so one app being down doesn't empty the page.

const SEEN = 'finesse.activitySeen'

const ICON: Record<ActivityEntry['type'], string> = {
  playing: 'M5.25 5.65c0-.86.92-1.4 1.67-.98l11.54 6.35a1.13 1.13 0 0 1 0 1.96L6.92 19.33c-.75.42-1.67-.12-1.67-.98V5.65Z',
  downloading: 'M12 3v13.5m0 0 4.5-4.5M12 16.5 7.5 12M3.75 18.75A2.25 2.25 0 0 0 6 21h12a2.25 2.25 0 0 0 2.25-2.25',
  requested: 'M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  added: 'M12 4.5v15m7.5-7.5h-15',
}
const TYPE_LABEL: Record<ActivityEntry['type'], string> = { playing: 'Playing', downloading: 'Download', requested: 'Request', added: 'Added' }
const TONE = { ok: 'text-emerald-300', busy: 'text-accent-300', wait: 'text-ink-300', bad: 'text-amber-200' } as const

function Row({ e }: { e: ActivityEntry }) {
  return (
    <li>
      <Link to={e.to} className="flex items-center gap-3.5 rounded-xl px-3 py-2.5 outline-none transition-colors hover:bg-white/5 focus-visible:bg-white/10">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.06] ${TONE[e.tone ?? 'wait']}`} aria-hidden>
          <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d={ICON[e.type]} />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[14.5px] font-semibold text-white">{e.title}</span>
            {e.isNew && <span className="shrink-0 rounded-full bg-accent-500/25 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-accent-200">New</span>}
          </span>
          <span className={`block truncate text-[12.5px] ${e.tone === 'bad' ? TONE.bad : 'text-ink-400'}`}>
            <span className="sr-only">{TYPE_LABEL[e.type]}: </span>
            {e.detail}
            {e.at ? ` · ${agoLabel(e.at)}` : ''}
          </span>
          {e.progress != null && (
            <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-white/10" aria-hidden>
              <span className="block h-full bg-accent-400" style={{ width: `${e.progress}%` }} />
            </span>
          )}
        </span>
      </Link>
    </li>
  )
}

function Section({ title, entries, empty, note }: { title: string; entries: ActivityEntry[]; empty: string; note?: string }) {
  return (
    <section className="mt-8" aria-label={title}>
      <h2 className="px-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-400">{title}</h2>
      {note && <p className="px-3 pt-1 text-[12.5px] text-amber-200">{note}</p>}
      {entries.length ? <ul className="mt-2 space-y-0.5">{entries.map((e) => <Row key={e.key} e={e} />)}</ul> : <p className="px-3 pt-2 text-[13.5px] text-ink-400">{empty}</p>}
    </section>
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

  // New since the last visit: read once when the page opens, then this visit counts as seen.
  const [seenAt] = useState<number | null>(() => {
    const v = Number(localStorage.getItem(SEEN))
    return Number.isFinite(v) && v > 0 ? v : null
  })
  useEffect(() => {
    try {
      localStorage.setItem(SEEN, String(Date.now()))
    } catch {
      /* private mode: nothing is marked new next time */
    }
  }, [])

  const me = getSession()?.userId
  const { now, recent } = useMemo(
    () =>
      buildActivity(
        {
          playing: (house.data ?? [])
            .filter((s) => s.NowPlayingItem)
            .map((s) => {
              const it = s.NowPlayingItem!
              const title = it.Type === 'Episode' && it.SeriesName ? `${it.SeriesName}: ${it.Name}` : it.Name ?? 'Something'
              return { id: s.Id, itemId: it.Type === 'Audio' && it.AlbumId ? it.AlbumId : it.Id, title, who: s.UserId === me ? 'you' : s.UserName, device: s.DeviceName, paused: s.PlayState?.IsPaused }
            }),
          downloads: requests ? (queue.data ?? []).map((q) => ({ key: q.key, title: q.title, status: q.status, progress: q.progress, done: q.done, reason: q.reason })) : [],
          requested: requests
            ? (requested.data ?? []).map((r) => {
                const s = requestStatus({ requested: true, hasFile: false, available: r.available, failure: failures?.get(r.key) })
                return { key: r.key, title: r.title, year: r.year, added: r.added, status: s.label, tone: s.tone }
              })
            : [],
          added: [...(movies.data ?? []), ...(shows.data ?? []), ...(music.data ?? [])].slice(0, 60).map((i) => ({ id: i.Id, title: i.Name ?? 'Untitled', at: i.DateCreated, kind: i.Type === 'Series' ? 'Show' : i.Type === 'MusicAlbum' ? 'Album' : i.Type === 'Episode' ? 'Episode' : 'Movie' })),
        },
        seenAt,
      ),
    [house.data, queue.data, requested.data, failures, movies.data, shows.data, music.data, requests, seenAt, me],
  )
  const recentShown = recent.slice(0, 40)
  const loading = house.isLoading && movies.isLoading && shows.isLoading

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6">
      <h1 className="page-title">Activity</h1>
      <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-ink-400">
        What’s playing, downloading and new on the server. {session?.isAdmin ? 'As an administrator you see everyone’s playback.' : 'You see your own playback; requests are the household’s.'} Moments and recommendations are in their own inbox.
      </p>
      {loading ? (
        <div className="mt-8 space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-xl shimmer" />
          ))}
        </div>
      ) : (
        <>
          <Section
            title="Now"
            entries={now}
            empty="Nothing playing or downloading right now."
            note={house.isError ? 'Can’t see what’s playing right now.' : requests && queue.isError ? 'Can’t reach the downloads right now.' : undefined}
          />
          <Section
            title="Recently"
            entries={recentShown}
            empty={requests ? 'No requests or new titles lately.' : 'Nothing new in the library lately.'}
            note={requests && requested.isError ? 'Can’t reach the request apps right now: requests are missing below.' : undefined}
          />
        </>
      )}
    </div>
  )
}
