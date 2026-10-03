import { NavLink, useLocation } from 'react-router-dom'

const ICONS = {
  home: 'M2.25 12 11.2 3a1.13 1.13 0 0 1 1.6 0l8.95 9M4.5 9.75V21h5.25v-5.25a1.5 1.5 0 0 1 3 0V21h5.25V9.75',
  search: 'm21 21-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z',
  library: 'M3.75 4.5h4.5v15h-4.5zM10.5 4.5H15v15h-4.5zM17.25 5.25l3.4.9-3.25 13.9',
  mylist: 'M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z',
}

// Four tabs, not six: everything beyond Home / Search lives under Library
// (Movies, Shows, Anime, Music, Games, Collections) or My List (watchlist +
// requests) — nothing hides in the avatar menu any more.
const LIBRARY_PATHS = ['/libraries', '/library/', '/browse', '/music', '/album', '/games', '/person/']

export default function BottomTabs() {
  const { pathname } = useLocation()
  const inLibrary = LIBRARY_PATHS.some((p) => pathname.startsWith(p))

  const tabs = [
    { to: '/', label: 'Home', icon: ICONS.home, end: true },
    { to: '/search', label: 'Search', icon: ICONS.search, end: false },
    { to: '/libraries', label: 'Library', icon: ICONS.library, end: false, forceActive: inLibrary },
    { to: '/mylist', label: 'My List', icon: ICONS.mylist, end: false },
  ]

  return (
    // A floating glass bar (2.0), clear of the screen's edges and the home indicator.
    <nav
      aria-label="Tabs"
      className="vt-tabs md:hidden fixed inset-x-3 z-50 rounded-[26px] os-glass bg-ink-950/50"
      style={{ bottom: 'max(10px, env(safe-area-inset-bottom))' }}
    >
      <div className="grid grid-cols-4">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => {
              const on = isActive || tab.forceActive
              return `flex flex-col items-center justify-center gap-1 min-h-[60px] py-2 text-[11px] transition-colors ${
                on ? 'text-white font-semibold' : 'text-white/55 font-medium'
              }`
            }}
          >
            {({ isActive }) => (
              <>
                <svg
                  className="h-6 w-6"
                  fill={(isActive || tab.forceActive) && tab.icon !== ICONS.search ? 'currentColor' : 'none'}
                  fillOpacity={0.15}
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={isActive || tab.forceActive ? 2.1 : 1.8}
                  aria-hidden
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
                </svg>
                {tab.label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
