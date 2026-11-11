import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import * as api from '../../api/client'
import { clock, deleteMoment, markMomentsRead, momentHref, useInbox, type InboxMoment, type MyMoment } from '../../api/moments'
import { useMomentCollectionsOn } from '../../api/momentCollections'
import { useToast } from '../Toast'
import SaveMoment from './SaveMoment'

// The feed: every moment the people here and on friends' servers have flagged for you, and your
// own, newest first. Each one is a card you can play right where it is: just that stretch of the
// film or episode, streamed from whichever server has it (yours or the friend's), then it stops.
// New ones arrive at the top while the page is open. Nothing here is copied anywhere: a moment is
// a place in a video and a note, and the video stays on its own server.

type Entry = (InboxMoment | MyMoment) & { own: boolean }

const HUES = [222, 262, 292, 334, 12, 38, 152, 188]
const hueOf = (name: string) => HUES[[...name].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % HUES.length]

function ago(ms: number): string {
  const min = Math.max(0, Math.round((Date.now() - ms) / 60000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : d < 30 ? `${d} days ago` : new Date(ms).toLocaleDateString()
}

/** Plays one stretch of a title in place, then stops. Direct play where the browser can, a
 *  converted stream (hls.js, loaded only when needed) where it can't. */
function StretchPlayer({ m, onDone, onFail }: { m: Entry; onDone: () => void; onFail: () => void }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  const start = Math.max(0, (m.start ?? 0) - 1)
  const end = m.end ?? (m.start ?? 0) + 30

  useEffect(() => {
    const v = ref.current
    if (!v) return
    let live = true
    let hls: { destroy: () => void } | null = null
    let session: { transcoding: boolean; id: string } | null = null
    const seek = () => {
      try {
        v.currentTime = start
      } catch {
        /* not seekable yet */
      }
    }
    void (async () => {
      try {
        const info = await api.getPlaybackInfo(m.item, Math.round(start * 1e7))
        if (!live) return
        const src = info.MediaSources[0]
        if (!src) throw new Error('no file')
        if (src.SupportsDirectPlay) {
          v.src = api.directStreamUrl(m.item, src.Id, src.Container)
          v.addEventListener('loadedmetadata', seek, { once: true })
        } else if (src.TranscodingUrl) {
          session = { transcoding: true, id: info.PlaySessionId }
          const url = api.transcodeUrl(src.TranscodingUrl)
          const { default: Hls } = await import('hls.js')
          if (!live) return
          if (Hls.isSupported()) {
            const h = new Hls({ startPosition: start, maxBufferLength: 20 })
            hls = h
            h.on(Hls.Events.ERROR, (_e, d) => d.fatal && live && onFail())
            h.loadSource(url)
            h.attachMedia(v)
          } else {
            v.src = url
            v.addEventListener('loadedmetadata', seek, { once: true })
          }
        } else throw new Error('no way to play it')
        await v.play().catch(() => {})
      } catch {
        if (live) onFail()
      }
    })()
    return () => {
      live = false
      hls?.destroy()
      if (session?.transcoding) api.stopActiveEncoding(session.id)
      v.removeAttribute('src')
      v.load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.key])

  return (
    <>
      <video
        ref={ref}
        className="absolute inset-0 h-full w-full bg-black object-contain"
        playsInline
        controls={ready}
        onPlaying={() => setReady(true)}
        onError={onFail}
        onTimeUpdate={(e) => {
          const v = e.currentTarget
          if (v.currentTime >= end + 1) {
            v.pause()
            onDone()
          }
        }}
      />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-white" aria-label="Loading" />
        </div>
      )}
    </>
  )
}

function Card({ m, fresh, onSave }: { m: Entry; fresh: boolean; onSave: (m: Entry) => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [playing, setPlaying] = useState(false)
  const [shown, setShown] = useState(!m.spoiler || m.own)
  const [art, setArt] = useState<'Backdrop' | 'Primary' | null>('Backdrop')
  const [armed, setArmed] = useState(false)
  const whole = m.start == null
  const who = m.own ? 'You' : m.from
  const to = m.own && 'to' in m && m.to.length ? ` to ${m.to.slice(0, 3).join(', ')}${m.to.length > 3 ? ` and ${m.to.length - 3} more` : ''}` : ''
  const hue = hueOf(m.from || 'you')
  const fromFriend = m.item.startsWith('f-')

  const remove = async () => {
    if (!armed) {
      setArmed(true)
      setTimeout(() => setArmed(false), 4000)
      return
    }
    try {
      await deleteMoment(m.key)
      void qc.invalidateQueries({ queryKey: ['moments'] })
      toast('Moment deleted')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  return (
    <article className={`feed-card overflow-hidden rounded-2xl border border-white/8 bg-ink-900/70 ${fresh ? 'feed-new' : ''}`}>
      <header className="flex items-center gap-3 px-4 pt-3.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ background: `hsl(${hue} 55% 42%)` }} aria-hidden>
          {(who[0] ?? '?').toUpperCase()}
        </span>
        <p className="min-w-0 flex-1 text-[13.5px] leading-tight text-ink-300">
          <span className="font-semibold text-white">{who}</span> {whole ? 'recommended' : 'flagged a moment'}
          {to}
          <span className="block truncate text-[12px] text-ink-400">
            {ago(m.created)}
            {fromFriend && ' · plays from a friend’s server'}
          </span>
        </p>
        {!m.read && !m.own && <span className="h-2 w-2 shrink-0 rounded-full bg-accent-400" aria-label="New" />}
      </header>

      {m.note && (
        <div className="px-4 pt-2.5">
          {shown ? (
            <p className="font-display text-[22px] leading-snug text-white sm:text-[26px]">{m.note}</p>
          ) : (
            <button onClick={() => setShown(true)} className="rounded-lg bg-white/8 px-3 py-1.5 text-[13px] font-medium text-ink-100 hover:bg-white/12">
              Spoiler. Tap to read
            </button>
          )}
        </div>
      )}

      <div className="relative mt-3 aspect-video w-full overflow-hidden bg-ink-950">
        {playing ? (
          <StretchPlayer
            m={m}
            onDone={() => setPlaying(false)}
            onFail={() => {
              setPlaying(false)
              toast('Couldn’t play it here. Try opening it in the player.', 'error')
            }}
          />
        ) : (
          <button
            onClick={() => (whole ? undefined : setPlaying(true))}
            className="group absolute inset-0 block w-full text-left outline-none"
            aria-label={whole ? m.title : `Play ${who === 'You' ? 'your' : `${who}’s`} moment in ${m.title}`}
            tabIndex={whole ? -1 : 0}
          >
            {art && (
              <img
                src={api.imageUrl(m.item, art, { maxWidth: 1280 })}
                alt=""
                loading="lazy"
                className={`h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03] ${art === 'Primary' ? 'scale-110 blur-xl brightness-75' : ''}`}
                onError={() => setArt(art === 'Backdrop' ? 'Primary' : null)}
              />
            )}
            <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
            {!whole && (
              <span className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/92 text-ink-950 shadow-2xl transition-transform group-hover:scale-110 group-focus-visible:ring-4 group-focus-visible:ring-accent-400">
                <svg className="ml-1 h-7 w-7" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            )}
            <span className="absolute inset-x-4 bottom-3 flex items-end justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold text-white">{m.title}</span>
                {m.subtitle && <span className="block truncate text-[12.5px] text-white/75">{m.subtitle}</span>}
              </span>
              {!whole && (
                <span className="shrink-0 rounded-full bg-black/60 px-2.5 py-1 font-mono text-[11.5px] text-white">
                  {clock(m.start!)}
                  {m.end != null && m.end > m.start! ? ` – ${clock(m.end)}` : ''}
                </span>
              )}
            </span>
          </button>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-[13px]">
        <Link to={momentHref(m)} className="rounded-lg px-2.5 py-1.5 font-semibold text-accent-300 hover:bg-white/5 hover:text-white">
          {whole ? 'Open it' : 'Watch from here'}
        </Link>
        <Link to={`/item/${m.item}`} className="rounded-lg px-2.5 py-1.5 text-ink-300 hover:bg-white/5 hover:text-white">
          About this title
        </Link>
        <button onClick={() => onSave(m)} className="rounded-lg px-2.5 py-1.5 text-ink-300 hover:bg-white/5 hover:text-white">
          Keep
        </button>
        {m.canDelete !== false && (m.own || m.canDelete) && (
          <button onClick={remove} className={`ml-auto rounded-lg px-2.5 py-1.5 ${armed ? 'bg-red-500 font-semibold text-white' : 'text-ink-400 hover:bg-white/5 hover:text-red-300'}`}>
            {armed ? 'Tap again to delete' : 'Delete'}
          </button>
        )}
      </footer>
    </article>
  )
}

export default function MomentFeed() {
  const { data, isLoading, isError, refetch } = useInbox(true)
  const collections = useMomentCollectionsOn()
  const [filter, setFilter] = useState<'all' | 'forYou' | 'yours'>('all')
  const [saving, setSaving] = useState<Entry | null>(null)
  const seen = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())

  const entries = useMemo<Entry[]>(() => {
    if (!data) return []
    const theirs = data.moments.map((m) => ({ ...m, own: false }))
    const mine = (data.mine ?? []).map((m) => ({ ...m, own: true }))
    const keys = new Set(theirs.map((m) => m.key))
    return [...theirs, ...mine.filter((m) => !keys.has(m.key))].sort((a, b) => b.created - a.created)
  }, [data])

  // What arrives while the page is open slides in; what was here on arrival doesn't.
  useEffect(() => {
    if (!data) return
    const keys = entries.map((e) => e.key)
    if (!seen.current) {
      seen.current = new Set(keys)
      return
    }
    const added = keys.filter((k) => !seen.current!.has(k))
    for (const k of keys) seen.current.add(k)
    if (added.length) setFresh(new Set(added))
  }, [data, entries])

  // Seeing the feed is reading it: the bell's count clears after a moment.
  useEffect(() => {
    const unread = (data?.moments ?? []).filter((m) => !m.read).map((m) => m.key)
    if (!unread.length) return
    const t = setTimeout(() => void markMomentsRead(unread).catch(() => {}), 2500)
    return () => clearTimeout(t)
  }, [data])

  const shown = entries.filter((e) => (filter === 'all' ? true : filter === 'yours' ? e.own : !e.own))
  const tab = (id: typeof filter, label: string, n: number) => (
    <button
      onClick={() => setFilter(id)}
      aria-pressed={filter === id}
      className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${filter === id ? 'bg-white text-ink-950' : 'text-ink-300 hover:bg-white/8 hover:text-white'}`}
    >
      {label}
      {n > 0 && <span className={`ml-1.5 tabular-nums ${filter === id ? 'text-ink-950/60' : 'text-ink-400'}`}>{n}</span>}
    </button>
  )

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="page-title">Moments</h1>
        {collections && (
          <Link to="/moments/collections" className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-accent-300 hover:bg-white/5 hover:text-white">
            Your collections
          </Link>
        )}
      </div>
      <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-ink-400">
        The scenes people here and on friends’ servers flagged for you. Press play and that stretch plays right here, from the server that has it. To add one, press the flag while you’re watching something.
      </p>

      <div className="mt-5 flex flex-wrap gap-1.5">
        {tab('all', 'Everything', entries.length)}
        {tab('forYou', 'For you', entries.filter((e) => !e.own).length)}
        {tab('yours', 'Yours', entries.filter((e) => e.own).length)}
      </div>

      {isLoading && (
        <div className="mt-6 space-y-5">
          {[0, 1].map((i) => (
            <div key={i} className="overflow-hidden rounded-2xl border border-white/8">
              <div className="h-16 shimmer" />
              <div className="aspect-video shimmer opacity-60" />
            </div>
          ))}
        </div>
      )}
      {isError && (
        <div className="mt-8 rounded-2xl border border-white/8 bg-ink-900/60 p-5 text-[14px] text-ink-200">
          Couldn’t load moments just now.
          <button onClick={() => void refetch()} className="ml-3 rounded-lg bg-white px-3 py-1.5 text-[13px] font-semibold text-ink-950">
            Try again
          </button>
        </div>
      )}
      {!isLoading && !isError && shown.length === 0 && (
        <div className="mt-8 rounded-2xl border border-dashed border-white/12 p-8 text-center">
          <p className="font-display text-2xl text-white">{filter === 'yours' ? 'You haven’t flagged anything yet' : 'Nothing here yet'}</p>
          <p className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-ink-400">
            While you’re watching, press the flag in the player, mark the scene, write a line and choose who gets it. It shows up here for them, and for you.
          </p>
        </div>
      )}

      <div className="mt-6 space-y-5">
        {shown.map((m) => (
          <Card key={m.key} m={m} fresh={fresh.has(m.key)} onSave={setSaving} />
        ))}
      </div>

      {saving && <SaveMoment what={{ moment: saving.key }} label={saving.own ? `Your moment in “${saving.title}”` : `${saving.from}’s moment in “${saving.title}”`} onClose={() => setSaving(null)} />}
    </div>
  )
}
