import { useQuery } from '@tanstack/react-query'
import { getItems } from '../api/client'
import { useFinesse } from '../lib/finesseServer'
import { useState, useRef, useEffect } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useFriends, useViews } from '../api/queries'
import { useAuth } from '../auth/AuthContext'
import { pushBackHandler } from '../lib/back'
import { openSearch } from '../lib/searchOverlay'
import { IS_TV } from '../lib/device'
import { ActionMenu } from './Menu'
import { useFriendMusic } from './FriendAlbums'
import { beginServerUpdate, useServerUpdate } from '../lib/appUpdate'
import { SparkIcon, UpdatePill, shortVersion } from './Update'

const NAV_COLLECTIONS = new Set(['movies', 'tvshows'])

export const ANIME_HREF = '/browse?title=Anime&tags=anime&includeItemTypes=Movie,Series&sortBy=SortName'
export const COLLECTIONS_HREF = '/browse?title=Collections&includeItemTypes=BoxSet&sortBy=SortName'

/** Everything that isn't Movies / Shows — one "More" menu on desktop and the
 *  TV, the Library tab on phones (pages/LibrariesPage). */
export function useSecondaryDestinations() {
  const { data: views } = useViews()
  const { hasAnime, hasGames } = useOptionalLibraries()
  const { data: friends } = useFriends()
  const friendMusic = useFriendMusic()
  const hasCollections = views?.Items.some((v) => v.CollectionType === 'boxsets') ?? false
  // Music shows when there's music here, or a friend shares theirs (Groups).
  const hasMusic = (views?.Items.some((v) => v.CollectionType === 'music') ?? false) || friendMusic.rows.length > 0
  return [
    ...(hasAnime ? [{ label: 'Anime', to: ANIME_HREF, match: (p: string, s: string) => p === '/browse' && s.includes('tags=anime') }] : []),
    ...(hasMusic ? [{ label: 'Music', to: '/music', match: (p: string) => p.startsWith('/music') || p.startsWith('/album') }] : []),
    ...(hasGames ? [{ label: 'Games', to: '/games', match: (p: string) => p.startsWith('/games') }] : []),
    ...(friends?.length ? [{ label: 'Friends', to: '/friends', match: (p: string) => p === '/friends' }] : []),
    ...(hasCollections
      ? [{ label: 'Collections', to: COLLECTIONS_HREF, match: (p: string, s: string) => p === '/browse' && s.includes('BoxSet') }]
      : []),
    { label: 'Requests and downloads', to: '/request', match: (p: string) => p === '/request' },
  ]
}

/** Anime appears when something is tagged anime; Games when the server has a
 *  games service (older installs without discovery keep showing it). */
export function useOptionalLibraries(): { hasAnime: boolean; hasGames: boolean } {
  const { info, loading } = useFinesse()
  const { data: anime } = useQuery({
    queryKey: ['hasTag', 'anime'],
    queryFn: () => getItems({ recursive: true, tags: 'anime', includeItemTypes: 'Movie,Series', limit: 1, enableImages: false }),
    staleTime: 30 * 60_000,
  })
  return { hasAnime: (anime?.TotalRecordCount ?? 0) > 0, hasGames: loading ? false : info ? Boolean(info.features.games || info.features.streaming) : true }
}

export default function NavBar() {
  const { data: views } = useViews()
  const { session, logout } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(window.scrollY > 24)
  const menuRef = useRef<HTMLDivElement>(null)
  const more = useSecondaryDestinations()
  // Admins: the NAS is behind the latest release — offer to update it.
  const { data: server } = useServerUpdate()
  const serverUpdate = server?.available && server.latest ? server.latest : null

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  // Close the account menu on navigation and on Escape / remote Back.
  const { pathname, search } = useLocation()
  useEffect(() => setMenuOpen(false), [pathname])
  useEffect(() => {
    if (!menuOpen) return
    return pushBackHandler(() => {
      setMenuOpen(false)
      return true
    })
  }, [menuOpen])

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
  const moreActive = more.some((d) => d.match(pathname, search))

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
      isActive ? 'text-white bg-white/10' : 'text-ink-400 hover:text-white'
    }`

  return (
    <header
      // No bottom border: a transparent one repeated the fade's dark top row as a
      // hairline under the bar. The scrolled bar's shadow separates it instead.
      className={`vt-nav fixed top-0 inset-x-0 z-50 h-16 transition-all duration-500 ${
        scrolled ? 'bg-ink-950/70 backdrop-blur-xl shadow-lg shadow-black/20' : 'bg-gradient-to-b from-ink-950/70 to-transparent'
      }`}
    >
      <div className="h-full max-w-[1800px] mx-auto px-4 sm:px-6 flex items-center gap-2">
        <Link to="/" className="text-xl font-semibold tracking-tight text-white mr-4 shrink-0">
          Finesse<span className="text-accent-400">.</span>
        </Link>

        <nav aria-label="Main" className="hidden md:flex items-center gap-1">
          <NavLink to="/" end className={linkClass}>
            Home
          </NavLink>
          {libraries.map((lib) => (
            <NavLink key={lib.Id} to={`/library/${lib.Id}`} className={linkClass}>
              {lib.Name}
            </NavLink>
          ))}
          <ActionMenu
            label="More"
            align="left"
            items={more.map((d) => ({ label: d.label, onSelect: () => navigate(d.to) }))}
            triggerClassName={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              moreActive ? 'text-white bg-white/10' : 'text-ink-400 hover:text-white'
            }`}
          >
            More
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </ActionMenu>
        </nav>

        <div className="flex-1" />

        <UpdatePill />

        {/* TV: an input would D-pad-focus straight into the on-screen keyboard and
            trap navigation — a plain link to the Search page keeps the bar traversable
            (and the TV has no "/" overlay). */}
        {IS_TV ? (
          <Link
            to="/search"
            aria-label="Search"
            className="flex h-9 w-9 mr-1 items-center justify-center rounded-full text-ink-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z" />
            </svg>
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => openSearch()}
            aria-label="Search (press /)"
            className="hidden md:flex items-center gap-2.5 w-56 lg:w-64 h-9 rounded-lg bg-ink-800/70 border border-white/10 pl-3 pr-2 text-sm text-ink-400 hover:text-ink-200 hover:border-white/20 transition-colors"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z" />
            </svg>
            <span className="flex-1 text-left">Search</span>
            <kbd className="h-5 min-w-5 px-1.5 rounded border border-white/15 text-[11px] font-sans text-ink-400 flex items-center justify-center">/</kbd>
          </button>
        )}

        <NavLink
          to="/mylist"
          className={({ isActive }) =>
            `hidden md:inline-flex items-center gap-2 ml-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              isActive ? 'text-white bg-white/10' : 'text-ink-200 hover:text-white'
            }`
          }
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
          </svg>
          My List
        </NavLink>

        <div className="relative ml-2" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="relative h-9 w-9 rounded-full bg-accent-fill hover:brightness-110 transition-colors text-sm font-semibold text-white"
            title={session?.userName}
            aria-label={`Account menu for ${session?.userName ?? 'you'}${serverUpdate ? ' (update available)' : ''}`}
            aria-expanded={menuOpen}
          >
            {session?.userName?.charAt(0).toUpperCase()}
            {serverUpdate && (
              <span aria-hidden className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-accent-300 ring-2 ring-ink-950" />
            )}
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-2 w-56 rounded-xl bg-ink-800 border border-white/10 shadow-2xl py-1.5 text-sm toast-in">
              <div className="px-4 py-2 text-ink-400 border-b border-white/5">
                Signed in as <span className="text-ink-200 font-medium">{session?.userName}</span>
              </div>
              {serverUpdate && (
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    void beginServerUpdate(serverUpdate, server?.kind)
                  }}
                  className="w-full flex items-center gap-2 text-left px-4 py-2 hover:bg-white/5 text-accent-300 font-semibold transition-colors"
                >
                  <SparkIcon />
                  Update Finesse to {shortVersion(serverUpdate)}
                </button>
              )}
              <button
                onClick={() => {
                  setMenuOpen(false)
                  navigate('/settings')
                }}
                className="w-full text-left px-4 py-2 hover:bg-white/5 text-ink-200 transition-colors"
              >
                Settings
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false)
                  navigate('/request')
                }}
                className="md:hidden w-full text-left px-4 py-2 hover:bg-white/5 text-ink-200 transition-colors"
              >
                Requests and downloads
              </button>
              <button
                onClick={logout}
                className="w-full text-left px-4 py-2 hover:bg-white/5 text-ink-200 transition-colors"
              >
                Switch profile / sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
