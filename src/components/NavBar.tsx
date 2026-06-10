import { useState, useRef, useEffect } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useViews } from '../api/queries'
import { useAuth } from '../auth/AuthContext'

const NAV_COLLECTIONS = new Set(['movies', 'tvshows'])

export default function NavBar() {
  const { data: views } = useViews()
  const { session, logout } = useAuth()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const libraries = views?.Items.filter((v) => NAV_COLLECTIONS.has(v.CollectionType ?? '')) ?? []

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
      isActive ? 'text-white bg-white/10' : 'text-ink-400 hover:text-white'
    }`

  return (
    <header className="fixed top-0 inset-x-0 z-50 h-16 bg-ink-950/70 backdrop-blur-xl border-b border-white/5">
      <div className="h-full max-w-[1800px] mx-auto px-6 flex items-center gap-2">
        <Link to="/" className="text-xl font-semibold tracking-tight text-white mr-4 shrink-0">
          Finesse<span className="text-accent-400">.</span>
        </Link>

        <nav className="flex items-center gap-1">
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
            if (query.trim()) navigate(`/search?q=${encodeURIComponent(query.trim())}`)
          }}
          className="relative"
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
            placeholder="Search"
            className="w-44 focus:w-64 transition-all rounded-full bg-ink-800/80 border border-white/10 pl-9 pr-4 py-1.5 text-sm outline-none focus:border-accent-500 placeholder:text-ink-400"
          />
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
