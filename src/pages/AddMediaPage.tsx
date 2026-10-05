import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { fromInput, plan, repath, SYSTEM_CHOICES, type Dropped, type Kind } from '../lib/mediaSort'
import { cancel, enqueue, mediaInfo, move, retry, tidy, useUploads, type Job, type MediaInfo } from '../lib/uploads'
import { readDrop } from '../lib/mediaSort'

// Add media: drop files or whole folders (from this computer, a USB drive, a network share:
// anything the browser can open) and they land in the right library. Administrators only.

const KIND_LABEL: Record<Kind, string> = { movies: 'Movies', tv: 'TV shows', music: 'Music', games: 'Games', skip: 'Not added' }
const KIND_HUE: Record<Kind, number> = { movies: 222, tv: 190, music: 28, games: 140, skip: 230 }

const size = (b: number) => (b >= 1e12 ? `${(b / 1e12).toFixed(1)} TB` : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`)
const eta = (s: number) => (s < 90 ? 'under a minute and a half' : s < 3600 ? `about ${Math.round(s / 60)} min` : `about ${(s / 3600).toFixed(1)} h`)

/** Turns dropped files into queued uploads (shared with the drop-anywhere overlay). */
export function addDropped(items: Dropped[], games: boolean) {
  enqueue(plan(items, { games }))
}

export default function AddMediaPage() {
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [failed, setFailed] = useState('')
  const [over, setOver] = useState(false)
  const [reading, setReading] = useState(false)
  const files = useRef<HTMLInputElement>(null)
  const folder = useRef<HTMLInputElement>(null)
  const { jobs, speed } = useUploads()

  useEffect(() => {
    mediaInfo().then(setInfo, (e: Error) => setFailed(e.message))
  }, [])

  const games = Boolean(info?.games)
  const totals = useMemo(() => {
    const live = jobs.filter((j) => j.status === 'waiting' || j.status === 'sending')
    const all = jobs.filter((j) => j.status !== 'skipped' && j.status !== 'cancelled')
    const bytes = all.reduce((a, j) => a + j.file.size, 0)
    const sent = all.reduce((a, j) => a + (j.status === 'done' ? j.file.size : j.sent), 0)
    const left = live.reduce((a, j) => a + j.file.size - j.sent, 0)
    return { live: live.length, all: all.length, done: all.filter((j) => j.status === 'done').length, bytes, sent, left }
  }, [jobs])

  const take = async (p: Promise<Dropped[]> | Dropped[]) => {
    setReading(true)
    try {
      addDropped(await p, games)
    } finally {
      setReading(false)
    }
  }

  if (failed || (info && !info.available)) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="page-title mb-3">Add media</h1>
        <p className="text-ink-300">{failed || 'Adding media from here works on servers Finesse set up. Copy files into your media folders instead, and they appear after the next library scan.'}</p>
      </div>
    )
  }

  const groups = (['movies', 'tv', 'music', 'games', 'skip'] as Kind[]).map((k) => ({ kind: k, jobs: jobs.filter((j) => j.kind === k && j.status !== 'cancelled') })).filter((g) => g.jobs.length)

  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
      <h1 className="page-title mb-2">Add media</h1>
      <p className="mb-6 max-w-2xl text-[15px] leading-relaxed text-ink-300">
        Drop movies, shows, music{games ? ' or games' : ''} here: single files or whole folders. From this computer, a USB drive or a network folder, anything you can open, you can drop. Finesse puts each file in the right library.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOver(false)
          void take(readDrop(e.dataTransfer))
        }}
        className={`relative flex flex-col items-center justify-center gap-4 overflow-hidden rounded-3xl border-2 border-dashed px-6 py-12 text-center transition-all duration-200 ${over ? 'scale-[1.01] border-accent-300 bg-accent-500/10' : 'border-white/12 bg-white/[0.02] hover:border-white/20'}`}
      >
        <span aria-hidden className={`pointer-events-none absolute -top-24 left-1/2 h-56 w-[36rem] -translate-x-1/2 rounded-full blur-3xl transition-opacity ${over ? 'opacity-60' : 'opacity-25'}`} style={{ background: 'radial-gradient(closest-side, rgba(117,137,216,.55), transparent)' }} />
        <span className={`relative grid h-16 w-16 place-items-center rounded-2xl bg-white/[0.06] ring-1 ring-white/10 transition-transform ${over ? '-translate-y-1' : ''}`}>
          <svg viewBox="0 0 24 24" className="h-8 w-8 text-accent-300" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5" />
            <path d="M4 14v3.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V14" />
          </svg>
        </span>
        <div className="relative">
          <p className="text-[18px] font-semibold text-white">{reading ? 'Reading folders…' : over ? 'Let go to add them' : 'Drop files or folders here'}</p>
          <p className="mt-1 text-[13.5px] text-ink-400">Videos, music{games ? ', games' : ''}, plus subtitles and posters that go with them</p>
        </div>
        <div className="relative flex flex-wrap justify-center gap-2.5">
          <button type="button" onClick={() => files.current?.click()} className="h-10 rounded-full bg-accent-fill px-5 text-[14px] font-semibold text-white shadow-[0_8px_24px_rgba(79,99,180,.4)] transition hover:brightness-110">
            Choose files
          </button>
          <button type="button" onClick={() => folder.current?.click()} className="h-10 rounded-full border border-white/12 bg-white/[0.05] px-5 text-[14px] font-semibold text-ink-200 transition hover:bg-white/[0.09] hover:text-white">
            Choose a folder
          </button>
        </div>
        <input ref={files} type="file" multiple hidden onChange={(e) => (void take(fromInput(e.target.files)), (e.target.value = ''))} />
        <input ref={folder} type="file" multiple hidden {...({ webkitdirectory: '' } as Record<string, string>)} onChange={(e) => (void take(fromInput(e.target.files)), (e.target.value = ''))} />
      </div>

      {info && (
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-400">
          {typeof info.free === 'number' && <>{size(info.free)} free on the server. </>}
          On the server itself, you can also copy files straight into <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[12px] text-ink-200">{info.folder}{info.folder?.includes('\\') ? '\\' : '/'}media</code> (movies, tv, music{games ? ', games/roms' : ''}).
        </p>
      )}

      {jobs.length > 0 && (
        <section className="mt-8">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-[17px] font-semibold text-white">
                {totals.live ? `Sending ${totals.all - totals.done} of ${totals.all}` : totals.done ? `Added ${totals.done} ${totals.done === 1 ? 'file' : 'files'}` : 'Ready'}
              </h2>
              <p className="mt-0.5 text-[13px] text-ink-400">
                {totals.live
                  ? `${size(totals.sent)} of ${size(totals.bytes)}${speed > 0 ? ` · ${size(speed)}/s · ${eta(totals.left / speed)} left` : ''} · keep this tab open (browsing Finesse is fine)`
                  : totals.done
                    ? 'They show up in your library within a minute or two, once Jellyfin has had a look.'
                    : ''}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {!totals.live && totals.done > 0 && (
                <Link to="/" className="text-[13.5px] font-semibold text-accent-300 hover:text-accent-200">
                  Go to Home
                </Link>
              )}
              <button type="button" onClick={tidy} className="text-[13px] text-ink-400 hover:text-white">
                Clear finished
              </button>
            </div>
          </div>
          {totals.bytes > 0 && (
            <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
              <div className="h-full rounded-full bg-gradient-to-r from-accent-500 via-violet-400 to-pink-400 transition-[width] duration-500" style={{ width: `${Math.min(100, (totals.sent / totals.bytes) * 100)}%` }} />
            </div>
          )}
          <div className="space-y-6">
            {groups.map((g) => (
              <div key={g.kind}>
                <h3 className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-400">
                  <span className="h-2 w-2 rounded-full" style={{ background: `hsl(${KIND_HUE[g.kind]}, 60%, 66%)` }} />
                  {KIND_LABEL[g.kind]} <span className="text-ink-400/60">{g.jobs.length}</span>
                </h3>
                <ul className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/5 bg-ink-900/60">
                  {g.jobs.map((j) => (
                    <Row key={j.key} j={j} games={games} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function Row({ j, games }: { j: Job; games: boolean }) {
  const name = j.path.slice(j.path.lastIndexOf('/') + 1)
  const where = j.path.includes('/') ? j.path.slice(0, j.path.lastIndexOf('/')).replace(/\//g, ' › ') : ''
  const pct = j.file.size ? (j.status === 'done' ? 100 : (j.sent / j.file.size) * 100) : 100
  const editable = j.status === 'waiting' || j.status === 'skipped' || j.status === 'failed'
  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] text-white" title={j.file.name}>{name}</p>
          <p className="truncate text-[12.5px] text-ink-400">
            {j.status === 'failed' ? <span className="text-red-300">{j.error}</span> : j.note ? <span className={j.kind === 'skip' ? '' : 'text-amber-200'}>{j.note}</span> : where}
            {j.status !== 'failed' && !j.note && where && ' · '}
            {j.status !== 'failed' && !j.note && size(j.file.size)}
          </p>
        </div>
        {editable && j.follows === undefined && (
          <select
            value={j.kind}
            onChange={(e) => {
              const kind = e.target.value as Kind
              move(j.key, kind, repath(j, kind), j.system)
            }}
            className="h-8 rounded-full border border-white/10 bg-white/[0.05] px-3 text-[12.5px] text-ink-200 outline-none focus:border-accent-400"
            aria-label={`Library for ${name}`}
          >
            {(['movies', 'tv', 'music', ...(games ? ['games'] : []), 'skip'] as Kind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        )}
        {editable && j.kind === 'games' && (
          <select
            value={j.system ?? ''}
            onChange={(e) => move(j.key, 'games', repath(j, 'games', e.target.value), e.target.value)}
            className="h-8 max-w-[10rem] rounded-full border border-white/10 bg-white/[0.05] px-3 text-[12.5px] text-ink-200 outline-none focus:border-accent-400"
            aria-label={`Console for ${name}`}
          >
            <option value="" disabled>
              Console…
            </option>
            {SYSTEM_CHOICES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        )}
        <span className="w-16 shrink-0 text-right font-mono text-[11.5px] text-ink-400">
          {j.status === 'done' ? <span className="text-emerald-300">Added</span> : j.status === 'sending' ? `${Math.floor(pct)}%` : j.status === 'waiting' ? 'Waiting' : j.status === 'skipped' ? 'Skipped' : ''}
        </span>
        {j.status === 'failed' ? (
          <button type="button" onClick={() => retry(j.key)} className="text-[12.5px] font-semibold text-accent-300 hover:text-accent-200">
            Retry
          </button>
        ) : (j.status === 'waiting' || j.status === 'sending') ? (
          <button type="button" onClick={() => cancel(j.key)} aria-label={`Cancel ${name}`} className="grid h-7 w-7 place-items-center rounded-full text-ink-400 hover:bg-white/10 hover:text-white">
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.4" /></svg>
          </button>
        ) : (
          <span className="w-7" />
        )}
      </div>
      {(j.status === 'sending' || (j.status === 'waiting' && j.sent > 0)) && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.07]">
          <div className="h-full rounded-full bg-accent-400 transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      )}
    </li>
  )
}
