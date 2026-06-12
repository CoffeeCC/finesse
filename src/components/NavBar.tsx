import { useState, useRef, useEffect } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useSearch, useViews } from '../api/queries'
import { posterUrl } from '../api/client'
import { useAuth } from '../auth/AuthContext'

function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

const NAV_COLLECTIONS = new Set(['movies', 'tvshows'])

export default function NavBar() {
  const { data: views } = useViews()
  const { session, logout } = useAuth()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(window.scrollY > 24)
  const menuRef = useRef<HTMLDivElement>(null)

  // Instant results dropdown
  const debouncedQuery = useDebouncedValue(query, 250)
  const { data: quickResults } = useSearch(searchFocused ? debouncedQuery : '')
  const quickItems = quickResults?.Items.slice(0, 7) ?? []
  const overlayOpen = searchFocused && debouncedQuery.trim().length > 1

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  // Transparent over the hero, glass once you scroll
  useEffect(() => {
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        setScrolled(window.scrollY > 24)
        ticking = false
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const libraries = views?.Items.filter((v) => NAV_COLLECTIONS.has(v.CollectionType ?? '')) ?? []

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
      isActive ? 'text-white bg-white/10' : 'text-ink-400 hover:text-white'
    }`

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 h-16 transition-all duration-500 ${
        scrolled
          ? 'bg-ink-950/70 backdrop-blur-xl border-b border-white/5 shadow-lg shadow-black/20'
          : 'bg-gradient-to-b from-ink-950/70 to-transparent border-b border-transparent'
      }`}
    >
      <div className="h-full max-w-[1800px] mx-auto px-6 flex items-center gap-2">
        <Link to="/" className="text-xl font-semibold tracking-tight text-white mr-4 shrink-0">
          Finesse<span className="text-accent-400">.</span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          <NavLink to="/" end className={linkClass}>
            Home
          </NavLink>
          {libraries.map((lib) => (
            <NavLink key={lib.Id} to={`/library/${lib.Id}`} className={linkClass}>
              {lib.Name}
            </NavLink>
          ))}
        </nav>

        <div className="flex-1" />

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (query.trim()) {
              setSearchFocused(false)
              navigate(`/search?q=${encodeURIComponent(query.trim())}`)
            }
          }}
          className="relative hidden md:block"
        >
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400 pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
            placeholder="Search"
            className="w-44 focus:w-72 transition-all rounded-full bg-ink-800/80 border border-white/10 pl-9 pr-4 py-1.5 text-sm outline-none focus:border-accent-500 placeholder:text-ink-400"
          />

          {overlayOpen && quickItems.length > 0 && (
            <div className="absolute top-11 right-0 w-80 rounded-2xl bg-ink-900/95 backdrop-blur-xl border border-white/10 shadow-2xl shadow-black/50 py-2 overflow-hidden">
              {quickItems.map((item) => (
                <button
                  key={item.Id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setQuery('')
                    setSearchFocused(false)
                    navigate(`/item/${item.Type === 'Episode' && item.SeriesId ? item.SeriesId : item.Id}`)
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 transition-colors text-left"
                >
                  <div className="w-9 h-[54px] rounded-md overflow-hidden bg-ink-800 shrink-0">
                    {posterUrl(item, 100) && (
                      <img src={posterUrl(item, 100)!} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-ink-200 truncate">{item.Name}</p>
                    <p className="text-xs text-ink-400">
                      {item.Type === 'Series' ? 'Show' : item.Type === 'Episode' ? `Episode · ${item.SeriesName ?? ''}` : item.ProductionYear ?? 'Movie'}
                    </p>
                  </div>
                </button>
              ))}
              <button
                type="submit"
                className="w-full px-4 py-2 text-xs text-accent-300 hover:bg-white/5 text-left transition-colors"
              >
                See all results for “{debouncedQuery.trim()}” →
              </button>
            </div>
          )}
        </form>

        <div className="relative ml-2" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="h-9 w-9 rounded-full bg-accent-600 hover:bg-accent-500 transition-colors text-sm font-semibold text-white"
            title={session?.userName}
          >
            {session?.userName?.charAt(0).toUpperCase()}
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-2 w-44 rounded-xl bg-ink-800 border border-white/10 shadow-2xl py-1.5 text-sm">
              <div className="px-4 py-2 text-ink-400 border-b border-white/5">
                {session?.userName}
              </div>
              <button
                onClick={logout}
                className="w-full text-left px-4 py-2 hover:bg-white/5 text-ink-200 transition-colors"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
