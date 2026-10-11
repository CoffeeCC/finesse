import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '../api/client'
import { ticksToSeconds } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'

// The Remote: every screen on the network running Finesse (or a Jellyfin app) that this person
// may control, and a full remote for the one they pick: playback, volume, tracks, a D-pad and a
// keyboard. Commands go through Jellyfin's session API; the screen's Finesse turns them into the
// same keys its own remote or a game controller would send (lib/remoteControl, lib/gamepad).

const POLL_MS = 2000
const TICKS = 10_000_000

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

function titleOf(item: api.JfSession['NowPlayingItem']): string {
  if (!item) return ''
  if (item.Type === 'Episode') return `${item.SeriesName ?? ''} · S${item.ParentIndexNumber ?? '?'}:E${item.IndexNumber ?? '?'} · ${item.Name ?? ''}`
  if (item.Type === 'Audio') return [item.Name, (item as { AlbumArtist?: string }).AlbumArtist].filter(Boolean).join(' · ')
  return item.Name ?? ''
}

/** A tiny buzz on phones that have it, so a press is felt even when the screen is across the room. */
const buzz = () => {
  try {
    navigator.vibrate?.(12)
  } catch {
    /* not on this phone */
  }
}

export default function RemotePage() {
  const [params, setParams] = useSearchParams()
  const chosen = params.get('d')
  const { data: displays = [], isFetched, isError } = useQuery({
    queryKey: ['remoteDisplays'],
    queryFn: api.getRemoteDisplays,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
  })
  const target = chosen ? displays.find((s) => s.Id === chosen) : undefined
  const pick = (id: string | null) => setParams(id ? { d: id } : {}, { replace: false })

  return (
    <div className="mx-auto max-w-xl px-4 pb-28 pt-6 sm:pt-8">
      {target ? (
        <Controller s={target} onBack={() => pick(null)} />
      ) : (
        <DisplayList displays={displays} loading={!isFetched} failed={isError} lost={Boolean(chosen && isFetched)} onPick={pick} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The list of screens
// ---------------------------------------------------------------------------

function DisplayList({ displays, loading, failed, lost, onPick }: { displays: api.JfSession[]; loading: boolean; failed: boolean; lost: boolean; onPick: (id: string) => void }) {
  const { session } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const playing = displays.filter((s) => s.NowPlayingItem && !s.PlayState?.IsPaused)

  const pauseAll = async () => {
    buzz()
    const r = await Promise.allSettled(playing.map((s) => api.sendPlaystate(s.Id, 'Pause')))
    const bad = r.filter((x) => x.status === 'rejected').length
    toast(bad ? `Paused ${playing.length - bad} of ${playing.length} screens` : `Paused ${playing.length === 1 ? 'it' : `all ${playing.length} screens`}`, bad ? 'error' : undefined)
    window.setTimeout(() => qc.invalidateQueries({ queryKey: ['remoteDisplays'] }), 500)
  }

  return (
    <>
      <h1 className="page-title">Remote</h1>
      <p className="mt-2 text-[14.5px] leading-relaxed text-ink-300">Control what’s playing on any screen in the house: TVs, computers, other phones. Pick one.</p>

      {lost && (
        <p className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-[13.5px] text-amber-100">That screen isn’t answering any more (it may have closed Finesse or gone to sleep).</p>
      )}

      {playing.length > 1 && (
        <button type="button" onClick={pauseAll} className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white/10 text-[15px] font-semibold text-white transition-colors hover:bg-white/15 active:scale-[.99]">
          <PauseIcon /> Pause everything ({playing.length} playing)
        </button>
      )}

      <div className="mt-5 space-y-3">
        {loading && <p className="text-[14px] text-ink-400">Looking for screens…</p>}
        {failed && !displays.length && <p className="text-[14px] text-red-300">Couldn’t ask the server which screens are on. Check this phone is connected, then pull down to try again.</p>}
        {!loading && !failed && displays.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <p className="text-[15px] font-semibold text-white">No screens to control yet</p>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[14px] leading-relaxed text-ink-300">
              <li>Open Finesse on the TV or computer you want to control.</li>
              <li>
                Sign in there as <b className="text-white">{session?.userName ?? 'you'}</b>
                {session?.isAdmin ? ' (as the admin, you can also control screens signed in as anyone else)' : ''}.
              </li>
              <li>It shows up here within a few seconds.</li>
            </ol>
          </div>
        )}
        {displays.map((s) => (
          <DisplayCard key={s.Id} s={s} onPick={() => onPick(s.Id)} />
        ))}
      </div>
    </>
  )
}

function DisplayCard({ s, onPick }: { s: api.JfSession; onPick: () => void }) {
  const item = s.NowPlayingItem
  const runtime = ticksToSeconds(item?.RunTimeTicks)
  const pos = ticksToSeconds(s.PlayState?.PositionTicks)
  const art = item ? (api.posterUrl(item, 120) ?? null) : null
  return (
    <button type="button" onClick={onPick} className="flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 text-left transition-colors hover:border-white/25 hover:bg-white/[0.06] active:scale-[.99]">
      <div className="flex h-16 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-ink-800 text-ink-400">{art ? <img src={art} alt="" className="h-full w-full object-cover" /> : <ScreenIcon />}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-white">{s.DeviceName || 'A screen'}</p>
        <p className="truncate text-[12.5px] text-ink-400">
          {s.Client}
          {s.UserName ? ` · ${s.UserName}` : ''}
        </p>
        {item ? (
          <>
            <p className="mt-1 truncate text-[13px] text-ink-200">
              <span className={s.PlayState?.IsPaused ? 'text-ink-400' : 'text-accent-300'}>{s.PlayState?.IsPaused ? 'Paused' : 'Playing'}</span> · {titleOf(item)}
            </p>
            {runtime > 0 && (
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-accent-400" style={{ width: `${Math.min(100, (pos / runtime) * 100)}%` }} />
              </div>
            )}
          </>
        ) : (
          <p className="mt-1 text-[13px] text-ink-400">Nothing playing</p>
        )}
      </div>
      <span aria-hidden className="text-xl text-ink-400">›</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// The remote for one screen
// ---------------------------------------------------------------------------

function Controller({ s, onBack }: { s: api.JfSession; onBack: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const can = api.commandsOf(s)
  const canNavigate = can.has('MoveUp') && can.has('Select')
  const item = s.NowPlayingItem
  const paused = s.PlayState?.IsPaused ?? false
  const name = s.DeviceName || 'this screen'

  // Smooth the clock between polls.
  const [, setTick] = useState(0)
  const polledAt = useRef(performance.now())
  useEffect(() => {
    polledAt.current = performance.now()
  }, [s.PlayState?.PositionTicks, paused])
  useEffect(() => {
    if (!item || paused) return
    const t = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [item, paused])
  const runtime = ticksToSeconds(item?.RunTimeTicks)
  const pos = Math.min(runtime || Infinity, ticksToSeconds(s.PlayState?.PositionTicks) + (item && !paused ? (performance.now() - polledAt.current) / 1000 : 0))

  // While dragging the seek bar, show where it'll land rather than where it is.
  const [scrub, setScrub] = useState<number | null>(null)

  const refresh = () => window.setTimeout(() => qc.invalidateQueries({ queryKey: ['remoteDisplays'] }), 400)
  const fail = () => toast(`Couldn’t reach ${name}. Is Finesse still open there?`, 'error')
  const playstate = (cmd: api.PlaystateCommand, seekTicks?: number) => {
    buzz()
    api.sendPlaystate(s.Id, cmd, seekTicks).then(refresh, fail)
  }
  const command = (cmd: string, args?: Record<string, string>) => {
    buzz()
    api.sendCommand(s.Id, cmd, args).then(refresh, fail)
  }
  const seekTo = (sec: number) => playstate('Seek', Math.max(0, Math.round(sec * TICKS)))

  // Audio and subtitle tracks of what's playing.
  const { data: full } = useQuery({
    queryKey: ['remoteItem', item?.Id],
    enabled: Boolean(item?.Id) && (can.has('SetAudioStreamIndex') || can.has('SetSubtitleStreamIndex')),
    queryFn: () => api.getItem(item!.Id),
    staleTime: 60_000,
  })
  const source = full?.MediaSources?.find((m) => m.Id === s.PlayState?.MediaSourceId) ?? full?.MediaSources?.[0]
  const audio = (source?.MediaStreams ?? []).filter((m) => m.Type === 'Audio')
  const subs = (source?.MediaStreams ?? []).filter((m) => m.Type === 'Subtitle')

  const [text, setText] = useState('')
  const sendText = () => {
    if (!text.trim()) return
    command('SendString', { String: text.trim() })
    setText('')
  }

  const art = item ? (api.backdropUrl(item, 720) ?? api.posterUrl(item, 300)) : null

  return (
    <>
      <button type="button" onClick={onBack} className="-ml-1 flex h-10 items-center gap-1.5 rounded-full px-2 text-[14px] font-medium text-ink-300 hover:text-white">
        <span aria-hidden className="text-lg">‹</span> All screens
      </button>
      <h1 className="mt-1 truncate font-display text-4xl leading-tight text-white">{name}</h1>
      <p className="text-[13px] text-ink-400">
        {s.Client}
        {s.UserName ? ` · ${s.UserName}` : ''}
      </p>

      {/* What's playing, and playback */}
      <section className="mt-5 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
        {item ? (
          <>
            {art && <img src={art} alt="" className="aspect-video w-full object-cover" />}
            <div className="p-4">
              <p className="text-[12px] font-semibold uppercase tracking-wider text-accent-300">{paused ? 'Paused' : 'Now playing'}</p>
              <p className="mt-0.5 text-[16px] font-semibold leading-snug text-white">{titleOf(item)}</p>
              {runtime > 0 && (
                <div className="mt-3">
                  <input
                    type="range"
                    min={0}
                    max={Math.round(runtime)}
                    step={1}
                    value={Math.round(scrub ?? pos)}
                    onChange={(e) => setScrub(Number(e.target.value))}
                    onPointerUp={() => {
                      if (scrub != null) seekTo(scrub)
                      setScrub(null)
                    }}
                    onKeyUp={() => {
                      if (scrub != null) seekTo(scrub)
                      setScrub(null)
                    }}
                    aria-label="Position"
                    className="w-full accent-[var(--color-accent-400,#7589d8)]"
                  />
                  <div className="flex justify-between text-[12px] tabular-nums text-ink-400">
                    <span>{fmt(scrub ?? pos)}</span>
                    <span>-{fmt(runtime - (scrub ?? pos))}</span>
                  </div>
                </div>
              )}
              <div className="mt-3 flex items-center justify-between">
                <RoundBtn label="Previous" onClick={() => playstate('PreviousTrack')}>
                  <PrevIcon />
                </RoundBtn>
                <RoundBtn label="Back 10 seconds" onClick={() => seekTo(pos - 10)}>
                  <span className="text-[13px] font-bold">-10</span>
                </RoundBtn>
                <button type="button" aria-label={paused ? 'Play' : 'Pause'} onClick={() => playstate('PlayPause')} className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-ink-950 shadow-lg transition active:scale-90">
                  {paused ? <PlayIcon /> : <PauseIcon big />}
                </button>
                <RoundBtn label="Forward 30 seconds" onClick={() => seekTo(pos + 30)}>
                  <span className="text-[13px] font-bold">+30</span>
                </RoundBtn>
                <RoundBtn label="Next" onClick={() => playstate('NextTrack')}>
                  <NextIcon />
                </RoundBtn>
              </div>
              <button type="button" onClick={() => playstate('Stop')} className="mt-3 h-10 w-full rounded-full border border-white/10 text-[13.5px] font-semibold text-ink-200 hover:border-red-400/50 hover:text-red-200">
                Stop
              </button>
            </div>
          </>
        ) : (
          <p className="p-5 text-[14px] leading-relaxed text-ink-300">
            Nothing is playing on {name}. {canNavigate ? 'Use the arrows below to pick something there, or' : 'To start something,'} open a title on this phone and choose <b className="text-white">Play on…</b>
          </p>
        )}
      </section>

      {/* Volume and tracks */}
      {(can.has('VolumeUp') || audio.length > 1 || subs.length > 0) && (
        <section className="mt-4 space-y-3 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          {can.has('VolumeUp') && (
            <div className="flex items-center gap-3">
              <span className="w-20 text-[13.5px] font-semibold text-white">Volume</span>
              <RoundBtn label="Volume down" onClick={() => command('VolumeDown')}>
                <span className="text-xl font-bold">−</span>
              </RoundBtn>
              <span className="w-12 text-center text-[13px] tabular-nums text-ink-300">{s.PlayState?.IsMuted ? 'Muted' : s.PlayState?.VolumeLevel != null ? `${s.PlayState.VolumeLevel}%` : ''}</span>
              <RoundBtn label="Volume up" onClick={() => command('VolumeUp')}>
                <span className="text-xl font-bold">+</span>
              </RoundBtn>
              {can.has('ToggleMute') && (
                <button type="button" onClick={() => command('ToggleMute')} className="ml-auto h-10 rounded-full bg-white/10 px-4 text-[13px] font-semibold text-white hover:bg-white/15">
                  {s.PlayState?.IsMuted ? 'Unmute' : 'Mute'}
                </button>
              )}
            </div>
          )}
          {item && audio.length > 1 && can.has('SetAudioStreamIndex') && (
            <TrackPick label="Audio" value={s.PlayState?.AudioStreamIndex} options={audio.map((m) => ({ value: m.Index, label: m.DisplayTitle || m.Title || m.Language || `Track ${m.Index}` }))} onPick={(i) => command('SetAudioStreamIndex', { Index: String(i) })} />
          )}
          {item && subs.length > 0 && can.has('SetSubtitleStreamIndex') && (
            <TrackPick
              label="Subtitles"
              value={s.PlayState?.SubtitleStreamIndex ?? -1}
              options={[{ value: -1, label: 'Off' }, ...subs.map((m) => ({ value: m.Index, label: m.DisplayTitle || m.Title || m.Language || `Track ${m.Index}` }))]}
              onPick={(i) => command('SetSubtitleStreamIndex', { Index: String(i) })}
            />
          )}
        </section>
      )}

      {/* The D-pad and the keyboard */}
      <section className="mt-4 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
        {canNavigate ? (
          <>
            <div className="mx-auto grid w-64 grid-cols-3 grid-rows-3 gap-2" role="group" aria-label="Arrows">
              <span />
              <PadBtn label="Up" onClick={() => command('MoveUp')}>▲</PadBtn>
              <span />
              <PadBtn label="Left" onClick={() => command('MoveLeft')}>◀</PadBtn>
              <button type="button" aria-label="OK" onClick={() => command('Select')} className="flex aspect-square items-center justify-center rounded-full bg-accent-fill text-[17px] font-bold text-white shadow-lg transition active:scale-90">
                OK
              </button>
              <PadBtn label="Right" onClick={() => command('MoveRight')}>▶</PadBtn>
              <span />
              <PadBtn label="Down" onClick={() => command('MoveDown')}>▼</PadBtn>
              <span />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <WideBtn onClick={() => command('Back')}>Back</WideBtn>
              <WideBtn onClick={() => command('GoHome')}>Home</WideBtn>
              <WideBtn onClick={() => command('ToggleContextMenu')}>Menu</WideBtn>
            </div>
            {can.has('SendString') && (
              <form
                className="mt-4 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  sendText()
                }}
              >
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={`Search or type on ${name}`}
                  enterKeyHint="send"
                  className="h-12 min-w-0 flex-1 rounded-full border border-white/10 bg-black/30 px-4 text-[15px] text-white placeholder:text-ink-400 focus:border-accent-400 focus:outline-none"
                />
                <button type="submit" className="h-12 shrink-0 rounded-full bg-white/10 px-5 text-[14px] font-semibold text-white hover:bg-white/15">
                  Send
                </button>
              </form>
            )}
          </>
        ) : (
          <p className="text-[13.5px] leading-relaxed text-ink-300">
            The arrows and keyboard need Finesse 2.8 or newer on that screen ({name} is running {s.Client || 'another app'}). You can still pause, skip, seek and stop what plays there from here.
          </p>
        )}
      </section>
    </>
  )
}

function TrackPick({ label, value, options, onPick }: { label: string; value?: number; options: { value: number; label: string }[]; onPick: (v: number) => void }) {
  return (
    <label className="flex items-center gap-3">
      <span className="w-20 text-[13.5px] font-semibold text-white">{label}</span>
      <select value={value ?? ''} onChange={(e) => onPick(Number(e.target.value))} className="h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-ink-900 px-3 text-[14px] text-white">
        {value == null && <option value="">Choose…</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function RoundBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/15 active:scale-90">
      {children}
    </button>
  )
}

function PadBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="flex aspect-square items-center justify-center rounded-2xl bg-white/10 text-xl text-white transition hover:bg-white/15 active:scale-90">
      {children}
    </button>
  )
}

function WideBtn({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="h-12 rounded-2xl bg-white/10 text-[14px] font-semibold text-white transition hover:bg-white/15 active:scale-95">
      {children}
    </button>
  )
}

const svg = 'h-5 w-5'
const PlayIcon = () => (
  <svg viewBox="0 0 24 24" className="ml-1 h-7 w-7" fill="currentColor" aria-hidden>
    <path d="M7 4.5v15l12-7.5z" />
  </svg>
)
const PauseIcon = ({ big }: { big?: boolean }) => (
  <svg viewBox="0 0 24 24" className={big ? 'h-7 w-7' : svg} fill="currentColor" aria-hidden>
    <path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" />
  </svg>
)
const PrevIcon = () => (
  <svg viewBox="0 0 24 24" className={svg} fill="currentColor" aria-hidden>
    <path d="M6 5h2v14H6zM20 5v14L9 12z" />
  </svg>
)
const NextIcon = () => (
  <svg viewBox="0 0 24 24" className={svg} fill="currentColor" aria-hidden>
    <path d="M16 5h2v14h-2zM4 5v14l11-7z" />
  </svg>
)
const ScreenIcon = () => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="5" width="18" height="12" rx="2" />
    <path d="M8 21h8" />
  </svg>
)
