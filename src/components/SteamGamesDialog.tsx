import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { streamingApi, type LutrisGame, type SteamGame } from '../api/setup'
import { pushBackHandler } from '../lib/back'
import { useToast } from './Toast'

function fmtSize(n: number): string {
  if (!n) return ''
  const gb = n / 1e9
  return gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`
}

function Cover({ game }: { game: SteamGame }) {
  const [broken, setBroken] = useState(false)
  return (
    <div className="h-16 w-11 shrink-0 overflow-hidden rounded-md bg-ink-800">
      {!broken && <img src={streamingApi.steamArtUrl(game.appId)} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />}
    </div>
  )
}

/** Administrators: pick installed Steam games to show as their own apps, in Finesse and in Moonlight. */
export default function SteamGamesDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [filter, setFilter] = useState('')
  const { data, isLoading, refetch } = useQuery({ queryKey: ['streaming', 'steam'], queryFn: streamingApi.steamGames, staleTime: 30_000, retry: 0 })
  const lutris = useQuery({ queryKey: ['streaming', 'lutris'], queryFn: streamingApi.lutrisGames, staleTime: 30_000, retry: 0 })
  const [lBusy, setLBusy] = useState<number | 'all' | null>(null)
  const lutrisToggle = async (g: LutrisGame | 'all') => {
    setLBusy(g === 'all' ? 'all' : g.id)
    try {
      if (g === 'all') {
        const r = await streamingApi.addLutris('all')
        toast(r.added ? `Added ${r.added} Lutris game${r.added === 1 ? '' : 's'}` : 'They’re all here already')
      } else if (g.added) {
        await streamingApi.removeLutris(g.id)
        toast(`${g.name} removed`)
      } else {
        await streamingApi.addLutris(g.id)
        toast(`${g.name} added — it’s in Moonlight too`)
      }
      await Promise.all([lutris.refetch(), qc.invalidateQueries({ queryKey: ['streaming', 'apps'] })])
    } catch (e) {
      toast((e as Error).message || 'That didn’t work', 'error')
    } finally {
      setLBusy(null)
    }
  }

  useEffect(() => pushBackHandler(() => (onClose(), true)), [onClose])
  // The page behind stays put while the list scrolls.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const raf = requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('input, button[data-first]')?.focus({ preventScroll: true }))
    return () => {
      cancelAnimationFrame(raf)
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  const games = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (data?.games ?? []).filter((g) => !q || g.name.toLowerCase().includes(q))
  }, [data, filter])

  const [bulk, setBulk] = useState<'all' | 'sync' | null>(null)
  const missing = (data?.games ?? []).filter((g) => !g.added).length
  const refresh = () => Promise.all([refetch(), qc.invalidateQueries({ queryKey: ['streaming', 'apps'] })])
  const addAll = async () => {
    setBulk('all')
    try {
      const r = await streamingApi.addAllSteam()
      toast(r.added ? `Added ${r.added} game${r.added === 1 ? '' : 's'}` : 'They’re all here already')
      await refresh()
    } catch (e) {
      toast((e as Error).message || 'That didn’t work', 'error')
    } finally {
      setBulk(null)
    }
  }
  const setSync = async (on: boolean) => {
    setBulk('sync')
    try {
      const r = await streamingApi.steamSync(on)
      toast(on ? (r.added || r.removed ? `In sync: ${r.added} added, ${r.removed} removed` : 'In sync. New installs show up by themselves.') : 'Sync off. Add games yourself.')
      await refresh()
    } catch (e) {
      toast((e as Error).message || 'That didn’t work', 'error')
    } finally {
      setBulk(null)
    }
  }

  const toggle = async (g: SteamGame) => {
    setBusy(g.appId)
    try {
      if (g.added) await streamingApi.removeSteam(g.appId)
      else await streamingApi.addSteam(g.appId)
      toast(g.added ? `${g.name} removed` : `${g.name} added — it’s in Moonlight too`)
      await Promise.all([refetch(), qc.invalidateQueries({ queryKey: ['streaming', 'apps'] })])
    } catch (e) {
      toast((e as Error).message || 'That didn’t work', 'error')
    } finally {
      setBusy(null)
    }
  }

  // On <body>: inside the page, an animated parent turns "fixed" into "wherever the section is".
  return createPortal(
    <div ref={dialogRef} className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Steam games">
      <button tabIndex={-1} className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-label="Close" onClick={onClose} />
      <div className="relative flex max-h-[calc(var(--vh)*90)] w-full flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-ink-900 shadow-2xl sm:max-w-lg sm:rounded-2xl">
        <div className="border-b border-white/5 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Your games</h2>
              <p className="mt-0.5 text-[13px] leading-relaxed text-ink-400">Add a game and it gets its own tile here and in Moonlight. It opens Steam straight into the game.</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-full p-1.5 text-ink-400 hover:bg-white/10 hover:text-white" aria-label="Close">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {data?.ok && data.games.length > 0 && (
            <div className="mt-3 space-y-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-accent-400" checked={data.sync === true} disabled={bulk !== null} onChange={(e) => void setSync(e.target.checked)} />
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-medium text-white">{bulk === 'sync' ? 'Syncing…' : 'Keep in sync with Steam'}</span>
                  <span className="block text-[12px] leading-relaxed text-ink-400">Games you install in Steam or Lutris get a tile by themselves, and uninstalled ones go. Checked every few minutes.</span>
                </span>
              </label>
              {data.sync !== true && missing > 0 && (
                <button type="button" data-first="" disabled={bulk !== null} onClick={() => void addAll()} className="h-9 w-full rounded-full bg-accent-500 px-4 text-[13px] font-semibold text-white hover:bg-accent-400 disabled:opacity-50">
                  {bulk === 'all' ? 'Adding…' : `Add all ${missing} game${missing === 1 ? '' : 's'}`}
                </button>
              )}
            </div>
          )}
          {(data?.games.length ?? 0) > 8 && (
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Find a game"
              className="mt-3 h-10 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white placeholder:text-ink-500 focus:border-accent-400 focus:outline-none"
            />
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-2 sm:p-3">
          {isLoading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-16 rounded-xl shimmer" />
              ))}
              <p className="pt-1 text-center text-[12px] text-ink-500">Looking in Steam’s folder…</p>
            </div>
          ) : !data?.ok ? (
            <p className="m-2 rounded-xl border border-white/5 bg-ink-950/50 px-4 py-3 text-sm text-ink-300">{data?.error ?? 'Couldn’t look in Steam’s folder.'}</p>
          ) : data.games.length === 0 ? (
            <p className="m-2 text-sm leading-relaxed text-ink-400">No games installed yet. Open Steam in Moonlight, install a game, then come back.</p>
          ) : (
            <ul>
              {games.map((g, i) => (
                <li key={g.appId} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/[0.03]">
                  <Cover game={g} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14.5px] font-medium text-white">{g.name}</p>
                    {g.size > 0 && <p className="text-[12px] text-ink-500">{fmtSize(g.size)}</p>}
                  </div>
                  <button
                    type="button"
                    data-first={i === 0 ? '' : undefined}
                    disabled={busy !== null || bulk !== null}
                    onClick={() => toggle(g)}
                    aria-pressed={g.added}
                    className={`h-9 shrink-0 rounded-full px-4 text-[13px] font-semibold transition-colors disabled:opacity-50 ${
                      g.added ? 'border border-white/15 bg-transparent text-ink-200 hover:border-white/30 hover:text-white' : 'bg-accent-500 text-white hover:bg-accent-400'
                    }`}
                  >
                    {busy === g.appId ? '…' : g.added ? 'Remove' : 'Add'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {lutris.data?.ok && lutris.data.games.length > 0 && (
            <div className="mt-3 border-t border-white/5 pt-3">
              <div className="flex items-center justify-between gap-3 px-2 pb-1">
                <p className="text-[13px] font-semibold text-ink-300">Lutris</p>
                {lutris.data.games.some((g) => !g.added) && (
                  <button type="button" disabled={lBusy !== null} onClick={() => void lutrisToggle('all')} className="text-[12.5px] font-semibold text-accent-300 hover:underline disabled:opacity-50">
                    {lBusy === 'all' ? 'Adding…' : 'Add all'}
                  </button>
                )}
              </div>
              <ul>
                {lutris.data.games.map((g) => (
                  <li key={g.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/[0.03]">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14.5px] font-medium text-white">{g.name}</p>
                      {g.playtime > 0 && <p className="text-[12px] text-ink-500">{g.playtime >= 1 ? `${Math.round(g.playtime)} h played` : 'Played a little'}</p>}
                    </div>
                    <button
                      type="button"
                      disabled={lBusy !== null}
                      onClick={() => void lutrisToggle(g)}
                      aria-pressed={g.added}
                      className={`h-9 shrink-0 rounded-full px-4 text-[13px] font-semibold transition-colors disabled:opacity-50 ${
                        g.added ? 'border border-white/15 bg-transparent text-ink-200 hover:border-white/30 hover:text-white' : 'bg-accent-500 text-white hover:bg-accent-400'
                      }`}
                    >
                      {lBusy === g.id ? '…' : g.added ? 'Remove' : 'Add'}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
