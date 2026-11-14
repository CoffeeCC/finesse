// The store's top: its title, Store · Browse · Requests, and a note when it's the demo store.

import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useGameRequests, useStoreMode } from '../../api/gameStoreQueries'

export function StoreHeader({ title = 'Game store', extra }: { title?: string; extra?: ReactNode }) {
  const { pathname } = useLocation()
  const mode = useStoreMode()
  const { data: requests } = useGameRequests()
  const needsYou = requests?.filter((r) => r.state === 'needs-you').length ?? 0
  const moving = requests?.filter((r) => r.state !== 'ready' && r.state !== 'failed').length ?? 0
  const tabs = [
    { to: '/games/store', label: 'Store', on: pathname === '/games/store' || pathname.startsWith('/games/store/game/') },
    { to: '/games/store/browse', label: 'Browse', on: pathname.startsWith('/games/store/browse') },
    { to: '/games/store/requests', label: 'Requests', on: pathname.startsWith('/games/store/requests'), count: moving, alert: needsYou > 0 },
  ]
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="page-title">{title}</h1>
          {mode === 'demo' && (
            <span
              className="rounded-full border border-amber-300/30 bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200"
              title="Made-up downloads for trying the store. Nothing is downloaded or installed."
            >
              Demo store
            </span>
          )}
        </div>
        {extra}
      </div>
      <nav className="mt-4 flex items-center gap-1 overflow-x-auto no-scrollbar" aria-label="Game store">
        <Link to="/games" className="shrink-0 rounded-full px-4 py-1.5 text-sm font-medium text-ink-300 transition-colors hover:text-white">
          Your games
        </Link>
        {tabs.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            aria-current={t.on ? 'page' : undefined}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              t.on ? 'bg-[#f5f3ee] text-ink-950' : 'text-ink-300 hover:text-white'
            }`}
          >
            {t.label}
            {Boolean(t.count) && (
              <span className={`rounded-full px-1.5 text-[11px] font-semibold ${t.alert ? 'bg-sky-400 text-ink-950' : t.on ? 'bg-ink-950/15' : 'bg-white/10'}`}>{t.count}</span>
            )}
          </Link>
        ))}
      </nav>
    </div>
  )
}

/** The store's search box, shaped like the app's search in the top bar. */
export function StoreSearchBox({ value, onChange, onSubmit, autoFocus }: { value: string; onChange: (v: string) => void; onSubmit?: () => void; autoFocus?: boolean }) {
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit?.()
      }}
      className="w-full sm:w-80"
    >
      <label className="flex h-10 w-full items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 text-ink-300 focus-within:border-white/30">
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path strokeLinecap="round" d="m20 20-3.5-3.5" />
        </svg>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search the store"
          aria-label="Search the game store"
          autoFocus={autoFocus}
          className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-ink-400"
        />
      </label>
    </form>
  )
}
