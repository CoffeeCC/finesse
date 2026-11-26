// Unified top header for Games + Game Store: keeps the Your games · Store · Retro · Browse · Requests
// tab bar cohesive across every games route so switching never blows away navigation.

import { useRef, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { getSession } from '../../api/client'
import { useGameRequests, useStoreMode } from '../../api/gameStoreQueries'
import { IS_TV } from '../../lib/device'
import { useFinesse } from '../../lib/finesseServer'

export function StoreHeader({ title = 'Game store', extra }: { title?: string; extra?: ReactNode }) {
  const { pathname } = useLocation()
  const { info } = useFinesse()
  const mode = useStoreMode()
  const { data: requests } = useGameRequests()
  const needsYou = requests?.filter((r) => r.state === 'needs-you').length ?? 0
  const failed = requests?.filter((r) => r.state === 'failed').length ?? 0
  const moving = requests?.filter((r) => r.state !== 'ready' && r.state !== 'failed').length ?? 0
  const readyCount = requests?.filter((r) => r.state === 'ready').length ?? 0

  const onYourGames = pathname === '/games' || pathname.startsWith('/games/game/') || pathname.startsWith('/games/play/')
  const onStore = pathname === '/games/store' || pathname.startsWith('/games/store/game/')
  const onRetro = pathname.startsWith('/games/store/retro')
  const onBrowse = pathname.startsWith('/games/store/browse')
  const onRequests = pathname.startsWith('/games/store/requests')
  const showRetro = Boolean(mode || info?.features?.games || onRetro)

  const tabs: { to: string; label: string; on: boolean; count?: number; alert?: 'you' | 'bad' | 'ok' }[] = [
    { to: '/games', label: 'Your games', on: onYourGames },
    ...(mode ? [{ to: '/games/store', label: 'Store', on: onStore }] : []),
    ...(showRetro ? [{ to: '/games/store/retro', label: 'Retro', on: onRetro }] : []),
    ...(mode
      ? [
          { to: '/games/store/browse', label: 'Browse', on: onBrowse },
          {
            to: '/games/store/requests',
            label: 'Requests',
            on: onRequests,
            count: moving > 0 ? moving : failed > 0 ? failed : readyCount > 0 ? readyCount : undefined,
            alert: needsYou > 0 ? ('you' as const) : failed > 0 ? ('bad' as const) : moving === 0 && readyCount > 0 ? ('ok' as const) : undefined,
          },
        ]
      : []),
  ]

  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="page-title">{title}</h1>
          {mode === 'demo' && pathname.startsWith('/games/store') && (
            <span
              className="rounded-full border border-amber-300/30 bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200"
              title="Simulated downloads for trying the store. Nothing is downloaded or installed."
            >
              Demo store
            </span>
          )}
        </div>
        {extra}
      </div>

      {tabs.length > 1 && (
        <nav className="mt-4 flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5" aria-label="Games navigation">
          {tabs.map((t) => (
            <Link
              key={t.to}
              to={t.to}
              aria-current={t.on ? 'page' : undefined}
              className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-accent-400 ${
                t.on
                  ? 'bg-[#f5f3ee] text-ink-950 shadow-sm'
                  : 'border border-white/[0.08] bg-white/[0.04] text-ink-300 hover:border-white/15 hover:bg-white/[0.08] hover:text-white'
              }`}
            >
              <span>{t.label}</span>
              {Boolean(t.count) && (
                <span
                  className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none tabular-nums ${
                    t.alert === 'you'
                      ? 'bg-sky-400 text-ink-950'
                      : t.alert === 'bad'
                        ? 'bg-amber-400/90 text-ink-950'
                        : t.alert === 'ok'
                          ? t.on
                            ? 'bg-emerald-600/20 text-emerald-900'
                            : 'bg-emerald-400/20 text-emerald-300'
                          : t.on
                            ? 'bg-ink-950/15 text-ink-950'
                            : 'bg-white/15 text-white'
                  }`}
                >
                  {t.count}
                </span>
              )}
            </Link>
          ))}
        </nav>
      )}
    </header>
  )
}

/** Search input with clickable submit icon, clear button, and TV-safe focus behavior. */
export function StoreSearchBox({
  value,
  onChange,
  onSubmit,
  placeholder = 'Search games & PC indexers…',
  ariaLabel = 'Search the game store',
  autoFocus,
  className = 'w-full sm:w-80',
}: {
  value: string
  onChange: (v: string) => void
  onSubmit?: () => void
  placeholder?: string
  ariaLabel?: string
  autoFocus?: boolean
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit?.()
      }}
      className={className}
    >
      <div className="flex h-10 w-full items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.06] pl-2 pr-2 text-ink-300 transition-colors focus-within:border-white/30 focus-within:bg-white/[0.09]">
        <button
          type="submit"
          aria-label="Submit search"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink-300 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-accent-400"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path strokeLinecap="round" d="m20 20-3.5-3.5" />
          </svg>
        </button>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          autoFocus={IS_TV ? false : autoFocus}
          className="search-field min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-ink-400"
        />
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => {
              onChange('')
              if (!IS_TV) inputRef.current?.focus()
            }}
            aria-label="Clear search"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink-400 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-accent-400"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </form>
  )
}

/** Graceful loading or unavailable state whenever a Game Store route is opened without `!mode`. */
export function StoreUnavailable({ title = 'Game store' }: { title?: string }) {
  const { loading } = useFinesse()
  const isAdmin = Boolean(getSession()?.isAdmin)

  if (loading) {
    return (
      <div className="px-4 py-6 sm:px-6 lg:px-12">
        <div className="mb-6 h-10 w-52 rounded-lg shimmer" />
        <div className="h-72 rounded-2xl shimmer" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] text-ink-300" aria-hidden>
        <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 .75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.35m-16.5 11.65V9.35m0 0a3 3 0 0 0 3.75-.62 3 3 0 0 0 4.5 0 3 3 0 0 0 4.5 0 3 3 0 0 0 3.75.62M3.75 9.35a3 3 0 0 1-.62-4.72L4.32 3.4a1.5 1.5 0 0 1 1.06-.44h13.24a1.5 1.5 0 0 1 1.06.44l1.19 1.2a3 3 0 0 1-.62 4.72" />
        </svg>
      </div>
      <h1 className="page-title">{title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-300">
        {isAdmin
          ? 'The game store isn’t enabled on this server yet. Turn it on in Settings → Games to browse feeds and search PC games.'
          : 'This server doesn’t have the game store enabled yet. Ask an administrator to turn it on in Settings.'}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          to="/games"
          className="inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 transition hover:bg-ink-200 active:scale-[0.97]"
        >
          Back to Games
        </Link>
        {isAdmin && (
          <Link
            to="/settings"
            className="inline-flex h-10 items-center rounded-lg border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/20 active:scale-[0.97]"
          >
            Open Settings
          </Link>
        )}
      </div>
    </div>
  )
}
