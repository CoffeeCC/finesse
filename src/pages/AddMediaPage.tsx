import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useIsTouch } from '../lib/device'
import { fromInput, plan, readDrop, repath, SYSTEM_CHOICES, type Dropped, type Kind, type Planned } from '../lib/mediaSort'
import { cancel, cancelAllActive, confirmReview, discardReview, enqueue, mediaInfo, move, remove, retry, retryAllFailed, tidy, useUploads, type Job, type MediaInfo } from '../lib/uploads'
import { detectConsoleFromZip } from '../lib/zipPeek'

// Add media: drop files or whole folders (from this computer, a USB drive, a network share:
// anything the browser can open). They're sorted into libraries and listed for a look first;
// Add sends them. A file just added can be removed again. Administrators only.

const KIND_LABEL: Record<Kind, string> = { movies: 'Movies', tv: 'TV shows', music: 'Music', games: 'Games', skip: 'Not added' }
const KIND_HUE: Record<Kind, number> = { movies: 222, tv: 190, music: 28, games: 140, skip: 230 }
const ORDER: Kind[] = ['movies', 'tv', 'music', 'games', 'skip']
/** A drop this big gets a "is this the folder you meant?" note. */
const BIG_FILES = 200
const BIG_BYTES = 500e9
/** Rows shown per library before "Show all". */
const ROWS = 40

const size = (b: number) => (b >= 1e12 ? `${(b / 1e12).toFixed(1)} TB` : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`)
const eta = (s: number) => (s < 90 ? 'under a minute and a half' : s < 3600 ? `about ${Math.round(s / 60)} min` : `about ${(s / 3600).toFixed(1)} h`)
const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`

/** Turns dropped files into a list to review, peeking inside .zip ROMs to auto-detect their console. */
async function addDropped(items: Dropped[], games: boolean) {
  const planned: Planned[] = plan(items, { games })
  if (games) {
    await Promise.all(
      planned.map(async (item) => {
        if (item.kind === 'games' && !item.system && /\.zip$/i.test(item.file.name)) {
          const detected = await detectConsoleFromZip(item.file)
          if (detected) {
            item.system = detected
            item.path = repath(item, 'games', detected)
            item.note = undefined
          }
        }
      }),
    )
  }
  enqueue(planned)
}

export default function AddMediaPage() {
  const { session } = useAuth()
  const isTouch = useIsTouch()
  const isAdmin = Boolean(session?.isAdmin)
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [failed, setFailed] = useState('')
  const [over, setOver] = useState(false)
  const [reading, setReading] = useState(false)
  const files = useRef<HTMLInputElement>(null)
  const folder = useRef<HTMLInputElement>(null)
  const { jobs, speed } = useUploads()

  useEffect(() => {
    if (!isAdmin) return
    mediaInfo().then(setInfo, (e: Error) => setFailed(e.message))
  }, [isAdmin])

  const games = Boolean(info?.games)
  const review = jobs.filter((j) => j.status === 'review')
  const list = jobs.filter((j) => j.status !== 'review' && j.status !== 'cancelled')
  const totals = useMemo(() => {
    const live = list.filter((j) => j.status === 'waiting' || j.status === 'sending')
    const failedJobs = list.filter((j) => j.status === 'failed')
    const all = list.filter((j) => j.status !== 'skipped' && j.status !== 'removed')
    const bytes = all.reduce((a, j) => a + j.file.size, 0)
    const sent = all.reduce((a, j) => a + (j.status === 'done' ? j.file.size : j.sent), 0)
    const left = live.reduce((a, j) => a + j.file.size - j.sent, 0)
    return {
      live: live.length,
      failed: failedJobs.length,
      all: all.length,
      done: all.filter((j) => j.status === 'done').length,
      bytes,
      sent,
      left,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs])

  // Refresh free space on the server after uploads finish (or are removed).
  const prevDone = useRef(totals.done)
  const prevLive = useRef(totals.live)
  useEffect(() => {
    if (!isAdmin) return
    const finishedBatch = prevLive.current > 0 && totals.live === 0
    const completedMore = totals.done > prevDone.current
    prevDone.current = totals.done
    prevLive.current = totals.live
    if (finishedBatch || completedMore) {
      mediaInfo().then(setInfo).catch(() => {})
    }
  }, [isAdmin, totals.done, totals.live])

  // Peek inside any unassigned .zip game files in review (e.g. dropped via global DropToAdd overlay).
  const peekedZips = useRef(new Set<string>())
  useEffect(() => {
    if (!games) return
    const pending = review.filter(
      (j) => j.kind === 'games' && !j.system && /\.zip$/i.test(j.file.name) && !peekedZips.current.has(j.key),
    )
    if (!pending.length) return
    for (const j of pending) {
      peekedZips.current.add(j.key)
      void detectConsoleFromZip(j.file).then((detected) => {
        if (detected) move(j.key, 'games', repath(j, 'games', detected), detected)
      })
    }
  }, [games, review])

  const take = async (p: Promise<Dropped[]> | Dropped[]) => {
    setReading(true)
    try {
      await addDropped(await p, games)
    } finally {
      setReading(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="page-title mb-3">Add media</h1>
        <p className="text-ink-200">Only administrators can add media to this server.</p>
        <Link to="/" className="mt-5 inline-flex h-10 items-center rounded-full bg-white/10 px-5 text-sm font-semibold text-white hover:bg-white/15 transition-colors">
          Back to Home
        </Link>
      </div>
    )
  }

  if (failed || (info && !info.available)) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="page-title mb-3">Add media</h1>
        <p className="text-ink-200">{failed || 'Adding media from here works on servers Finesse set up. Copy files into your media folders instead, and they appear after the next library scan.'}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
      <h1 className="page-title mb-2">Add media</h1>
      <p className="mb-6 max-w-2xl text-[15px] leading-relaxed text-ink-200">
        {isTouch
          ? `Choose movies, shows, music${games ? ' or games' : ''} from your device. Finesse sorts them and shows you where each one goes before anything is sent.`
          : `Drop movies, shows, music${games ? ' or games' : ''} here: single files or whole folders. From this computer, a USB drive or a network folder, anything you can open, you can drop. Finesse sorts them and shows you where each one goes before anything is sent.`}
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
        className={`relative flex flex-col items-center justify-center gap-4 overflow-hidden rounded-3xl border-2 border-dashed px-6 transition-all duration-200 ${review.length || list.length ? 'py-8' : 'py-12'} text-center ${over ? 'scale-[1.01] border-accent-300 bg-accent-500/10' : 'border-white/12 bg-white/[0.02] hover:border-white/20'}`}
      >
        <span aria-hidden className={`pointer-events-none absolute -top-24 left-1/2 h-56 w-[36rem] -translate-x-1/2 rounded-full blur-3xl transition-opacity ${over ? 'opacity-60' : 'opacity-25'}`} style={{ background: 'radial-gradient(closest-side, rgba(117,137,216,.55), transparent)' }} />
        <span className={`relative grid h-16 w-16 place-items-center rounded-2xl bg-white/[0.06] ring-1 ring-white/10 transition-transform ${over ? '-translate-y-1' : ''}`}>
          <svg viewBox="0 0 24 24" className="h-8 w-8 text-accent-300" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5" />
            <path d="M4 14v3.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V14" />
          </svg>
        </span>
        <div className="relative">
          <p className="text-[18px] font-semibold text-white">
            {reading ? 'Reading folders…' : over ? 'Let go to add them' : isTouch ? 'Choose files to add' : 'Drop files or folders here'}
          </p>
          <p className="mt-1 text-[13.5px] text-ink-400">Videos, music{games ? ', games' : ''}, plus subtitles and posters that go with them</p>
        </div>
        <div className="relative flex flex-wrap justify-center gap-2.5">
          <button type="button" onClick={() => files.current?.click()} className="h-10 rounded-full bg-accent-fill px-5 text-[14px] font-semibold text-white shadow-[0_8px_24px_rgba(79,99,180,.4)] transition hover:brightness-110">
            Choose files
          </button>
          {!isTouch && (
            <button type="button" onClick={() => folder.current?.click()} className="h-10 rounded-full border border-white/12 bg-white/[0.05] px-5 text-[14px] font-semibold text-ink-200 transition hover:bg-white/[0.09] hover:text-white">
              Choose a folder
            </button>
          )}
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

      {review.length > 0 && <Review jobs={review} games={games} free={info?.free ?? null} />}

      {list.length > 0 && (
        <section className="mt-10">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-[17px] font-semibold text-white">
                {totals.live ? `Sending ${totals.all - totals.done} of ${totals.all}` : totals.done ? `Added ${plural(totals.done, 'file')}` : 'Nothing sent'}
              </h2>
              <p className="mt-0.5 text-[13px] text-ink-400">
                {totals.live
                  ? `${size(totals.sent)} of ${size(totals.bytes)}${speed > 0 ? ` · ${size(speed)}/s · ${eta(totals.left / speed)} left` : ''} · keep this tab open (browsing Finesse is fine)`
                  : totals.done
                    ? 'They show up in your library within a minute or two. Wrong file? Remove takes it back for the next day.'
                    : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {totals.failed > 0 && (
                <button type="button" onClick={retryAllFailed} className="text-[13px] font-semibold text-accent-300 hover:text-accent-200">
                  Retry failed ({totals.failed})
                </button>
              )}
              {totals.live > 0 && (
                <button type="button" onClick={cancelAllActive} className="text-[13px] text-red-300 hover:text-red-200">
                  Cancel all
                </button>
              )}
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
          <Groups jobs={list} games={games} />
        </section>
      )}
    </div>
  )
}

/** The drop, sorted, before anything is sent. */
function Review({ jobs, games, free }: { jobs: Job[]; games: boolean; free: number | null }) {
  const [bulkSystem, setBulkSystem] = useState('')
  const going = jobs.filter((j) => j.kind !== 'skip')
  const gameJobs = going.filter((j) => j.kind === 'games')
  const bytes = going.reduce((a, j) => a + j.file.size, 0)
  const noConsole = gameJobs.filter((j) => !j.system).length
  const big = going.length > BIG_FILES || bytes > BIG_BYTES
  const tooBig = free !== null && bytes > free
  const tops = [...new Set(jobs.map((j) => j.key.split('/')[0]!).filter((t) => t && jobs.some((j) => j.key.startsWith(t + '/'))))]

  const applyAllConsoles = (sys: string) => {
    setBulkSystem(sys)
    if (!sys) return
    for (const j of gameJobs) {
      move(j.key, 'games', repath(j, 'games', sys), sys)
    }
  }

  return (
    <section className="mt-8 rounded-3xl border border-accent-400/25 bg-accent-500/[0.05] p-5 sm:p-6" aria-labelledby="review-title">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="review-title" className="text-[18px] font-semibold text-white">
            {going.length ? `Ready to add ${plural(going.length, 'file')}` : 'Nothing here to add'} {going.length > 0 && <span className="font-normal text-ink-400">· {size(bytes)}</span>}
          </h2>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-400">Check where each one goes, and change any that are wrong. Nothing is sent until you press Add.</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-3">
            <button type="button" onClick={discardReview} className="h-10 rounded-full px-4 text-[13.5px] font-medium text-ink-400 hover:text-white">
              Clear
            </button>
            <button
              type="button"
              disabled={!going.length || tooBig || noConsole > 0}
              onClick={confirmReview}
              className="h-10 rounded-full bg-accent-fill px-6 text-[14px] font-semibold text-white shadow-[0_8px_24px_rgba(79,99,180,.4)] transition hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
            >
              Add {plural(going.length, 'file')}
            </button>
          </div>
          {noConsole > 0 && <p className="text-[12px] text-amber-200">Pick a console for each game first</p>}
        </div>
      </div>
      {(big || tooBig || noConsole > 0 || gameJobs.length > 1) && (
        <div className="mb-4 space-y-2">
          {tooBig && (
            <p className="rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-[13.5px] leading-relaxed text-red-200">
              Not enough room on the server: {size(bytes)} to add, {size(free!)} free. Leave some out (set them to “Not added”), or make room first.
            </p>
          )}
          {big && !tooBig && (
            <p className="rounded-2xl border border-amber-300/25 bg-amber-400/10 px-4 py-3 text-[13.5px] leading-relaxed text-amber-100">
              That’s a big drop: {plural(going.length, 'file')}, {size(bytes)}{tops.length ? ` from ${tops.slice(0, 3).map((t) => `“${t}”`).join(', ')}${tops.length > 3 ? '…' : ''}` : ''}. Make sure it’s the folder you meant before adding.
            </p>
          )}
          {(noConsole > 0 || gameJobs.length > 1) && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300/25 bg-amber-400/10 px-4 py-3 text-[13.5px] leading-relaxed text-amber-100">
              <span>
                {noConsole > 0
                  ? `Pick a console for ${plural(noConsole, 'game')} before adding.`
                  : `All ${plural(gameJobs.length, 'game')} have a console selected.`}
              </span>
              <label className="inline-flex items-center gap-2 text-[12.5px] text-ink-200">
                <span>Set console for all games:</span>
                <select
                  value={bulkSystem}
                  onChange={(e) => applyAllConsoles(e.target.value)}
                  aria-label="Set console for all games"
                  className="h-8 rounded-full border border-white/15 bg-ink-900 px-3 text-[12.5px] text-white outline-none focus:border-accent-400"
                >
                  <option value="" className="bg-ink-900 text-white">
                    Choose console…
                  </option>
                  {SYSTEM_CHOICES.map(([id, label]) => (
                    <option key={id} value={id} className="bg-ink-900 text-white">
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
      )}
      <Groups jobs={jobs} games={games} />
    </section>
  )
}

function Groups({ jobs, games }: { jobs: Job[]; games: boolean }) {
  const [all, setAll] = useState<Record<string, boolean>>({})
  const byName = (a: Job, b: Job) => (a.placed ?? a.path).localeCompare(b.placed ?? b.path, undefined, { numeric: true, sensitivity: 'base' })
  const groups = ORDER.map((k) => ({ kind: k, jobs: jobs.filter((j) => j.kind === k).sort(byName) })).filter((g) => g.jobs.length)
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.kind}>
          <h3 className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-400">
            <span className="h-2 w-2 rounded-full" style={{ background: `hsl(${KIND_HUE[g.kind]}, 60%, 66%)` }} />
            {KIND_LABEL[g.kind]} <span className="text-ink-400/60">{g.jobs.length.toLocaleString()}</span>
          </h3>
          <ul className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/5 bg-ink-900/60">
            {(all[g.kind] ? g.jobs : g.jobs.slice(0, ROWS)).map((j) => (
              <Row key={j.key} j={j} games={games} />
            ))}
          </ul>
          {g.jobs.length > ROWS && !all[g.kind] && (
            <button type="button" onClick={() => setAll((a) => ({ ...a, [g.kind]: true }))} className="mt-2 text-[13px] font-medium text-accent-300 hover:text-accent-200">
              Show all {g.jobs.length.toLocaleString()}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function Row({ j, games }: { j: Job; games: boolean }) {
  const [sure, setSure] = useState(false)
  useEffect(() => {
    if (!sure) return
    const t = window.setTimeout(() => setSure(false), 4000)
    return () => window.clearTimeout(t)
  }, [sure])
  // Once added, where it really went (an existing "Show (2010)/Season 01" folder, say).
  const at = j.placed ?? j.path
  const name = at.slice(at.lastIndexOf('/') + 1)
  const where = at.includes('/') ? at.slice(0, at.lastIndexOf('/')).replace(/\//g, ' › ') : ''
  // Say it's a folder: a loose song's folder is called "Added", which read as "already added".
  const whereLabel = where ? `${j.status === 'done' ? 'In folder' : 'Goes in folder'} ${where}` : ''
  const pct = j.file.size ? (j.status === 'done' ? 100 : (j.sent / j.file.size) * 100) : 100
  const editable = j.status === 'review' || j.status === 'waiting' || j.status === 'skipped' || j.status === 'failed'
  const gone = j.status === 'removed'
  return (
    <li className={`px-4 py-3 ${gone ? 'opacity-50' : ''}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-[12rem] flex-1">
          <p className={`truncate text-[14px] text-white ${gone ? 'line-through' : ''}`} title={j.file.name}>{name}</p>
          <p className="truncate text-[12.5px] text-ink-400">
            {j.error ? <span className="text-red-300">{j.error}</span> : j.note ? <span className={j.kind === 'skip' || j.note.startsWith('Already') ? '' : 'text-amber-200'}>{j.note}</span> : whereLabel}
            {!j.error && !j.note && whereLabel && ' · '}
            {!j.error && !j.note && size(j.file.size)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editable && j.follows === undefined && (
            <select
              value={j.kind}
              onChange={(e) => {
                const kind = e.target.value as Kind
                move(j.key, kind, repath(j, kind), j.system)
              }}
              className="h-8 rounded-full border border-white/10 bg-ink-900 px-3 text-[12.5px] text-ink-100 outline-none focus:border-accent-400"
              aria-label={`Library for ${name}`}
            >
              {(['movies', 'tv', 'music', ...(games ? ['games'] : []), 'skip'] as Kind[]).map((k) => (
                <option key={k} value={k} className="bg-ink-900 text-white">
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          )}
          {editable && j.kind === 'games' && (
            <select
              value={j.system ?? ''}
              onChange={(e) => move(j.key, 'games', repath(j, 'games', e.target.value), e.target.value)}
              className="h-8 max-w-[10rem] rounded-full border border-white/10 bg-ink-900 px-3 text-[12.5px] text-ink-100 outline-none focus:border-accent-400"
              aria-label={`Console for ${name}`}
            >
              <option value="" disabled className="bg-ink-900 text-ink-400">
                Console…
              </option>
              {SYSTEM_CHOICES.map(([id, label]) => (
                <option key={id} value={id} className="bg-ink-900 text-white">
                  {label}
                </option>
              ))}
            </select>
          )}
          {j.status !== 'review' && (
            <span className="w-16 shrink-0 text-right font-mono text-[11.5px] text-ink-400">
              {j.status === 'done' ? <span className="text-emerald-300">Added</span> : j.status === 'sending' ? `${Math.floor(pct)}%` : j.status === 'waiting' ? 'Waiting' : j.status === 'skipped' ? 'Skipped' : j.status === 'removing' ? '…' : gone ? 'Removed' : ''}
            </span>
          )}
          {j.status === 'failed' ? (
            <button type="button" onClick={() => retry(j.key)} className="text-[12.5px] font-semibold text-accent-300 hover:text-accent-200">
              Retry
            </button>
          ) : j.status === 'waiting' || j.status === 'sending' ? (
            <button type="button" onClick={() => cancel(j.key)} aria-label={`Cancel ${name}`} className="grid h-7 w-7 place-items-center rounded-full text-ink-400 hover:bg-white/10 hover:text-white">
              <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.4" /></svg>
            </button>
          ) : j.status === 'done' && j.receipt ? (
            <button
              type="button"
              onClick={() => (sure ? void remove(j.key) : setSure(true))}
              className={`shrink-0 rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors ${sure ? 'bg-red-500/20 text-red-200 hover:bg-red-500/30' : 'text-ink-400 hover:bg-white/10 hover:text-white'}`}
            >
              {sure ? 'Remove it?' : 'Remove'}
            </button>
          ) : j.status !== 'review' ? (
            <span className="w-7" />
          ) : null}
        </div>
      </div>
      {(j.status === 'sending' || (j.status === 'waiting' && j.sent > 0)) && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.07]">
          <div className="h-full rounded-full bg-accent-400 transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      )}
    </li>
  )
}
