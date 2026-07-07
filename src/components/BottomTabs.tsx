import { NavLink } from 'react-router-dom'
import { useViews } from '../api/queries'

const NAV_COLLECTIONS = new Set(['movies', 'tvshows'])

const ICONS: Record<string, string> = {
  home: 'M2.25 12 11.2 3a1.13 1.13 0 0 1 1.6 0l8.95 9M4.5 9.75V21h5.25v-5.25a1.5 1.5 0 0 1 3 0V21h5.25V9.75',
  movies: 'M3.375 19.5h17.25a1.125 1.125 0 0 0 1.125-1.125V5.625A1.125 1.125 0 0 0 20.625 4.5H3.375A1.125 1.125 0 0 0 2.25 5.625v12.75c0 .621.504 1.125 1.125 1.125ZM7.5 4.5v15m9-15v15M2.25 9h5.25m9 0h5.25M2.25 15h5.25m9 0h5.25',
  tvshows: 'M6 20.25h12M9 16.5v3.75m6-3.75v3.75M3.375 16.5h17.25c.621 0 1.125-.504 1.125-1.125V4.875A1.125 1.125 0 0 0 20.625 3.75H3.375A1.125 1.125 0 0 0 2.25 4.875v10.5c0 .621.504 1.125 1.125 1.125Z',
  search: 'm21 21-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z',
  request: 'M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  games: 'M7 8h10a4 4 0 0 1 3.94 4.68l-.7 4.2A2.4 2.4 0 0 1 16 17l-1.5-2h-5L8 17a2.4 2.4 0 0 1-4.24-.12l-.7-4.2A4 4 0 0 1 7 8Z M8 11v2 M7 12h2 M15.5 11.5h.01 M17 13h.01',
}

export default function BottomTabs() {
  const { data: views } = useViews()
  const libraries = views?.Items.filter((v) => NAV_COLLECTIONS.has(v.CollectionType ?? '')) ?? []

  const tabs = [
    { to: '/', label: 'Home', icon: ICONS.home, end: true },
    ...libraries.slice(0, 2).map((lib) => ({
      to: `/library/${lib.Id}`,
      label: lib.Name,
      icon: ICONS[lib.CollectionType ?? 'movies'] ?? ICONS.movies,
      end: false,
    })),
    { to: '/games', label: 'Games', icon: ICONS.games, end: false },
    { to: '/search', label: 'Search', icon: ICONS.search, end: false },
    { to: '/request', label: 'Request', icon: ICONS.request, end: false },
  ]

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-ink-950/85 backdrop-blur-xl border-t border-white/5 pb-safe">
      <div className="flex">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${
                isActive ? 'text-accent-300' : 'text-ink-400'
              }`
            }
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
            </svg>
            {tab.label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
