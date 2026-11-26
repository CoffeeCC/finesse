import { useQuery } from '@tanstack/react-query'
import { getItems } from '../api/client'
import { useSmartOn } from '../api/smart'
import { useQueuesOn } from '../api/queues'
import { useMomentCollectionsOn } from '../api/momentCollections'
import { useMyLimits } from '../api/parental'
import { useFinesse } from '../lib/finesseServer'
import { useState, useRef, useEffect, useLayoutEffect, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useFriends, useViews } from '../api/queries'
import { useAuth } from '../auth/AuthContext'
import { pushBackHandler } from '../lib/back'
import { useOverlayFocus } from '../lib/overlayFocus'
import { openSearch } from '../lib/searchOverlay'
import { openQuickMenu } from '../lib/quickMenu'
import { useArrQueue } from '../api/queries'
import MomentsBell from './moments/MomentsBell'
import { IS_TV } from '../lib/device'
import { ActionMenu } from './Menu'
import { useFriendMusic } from './FriendAlbums'
import { beginServerUpdate, useServerUpdate } from '../lib/appUpdate'
import { SparkIcon, UpdatePill, shortVersion } from './Update'
import { gameStoreMode } from '../api/gameStore'
import { prefetchRoute } from '../lib/prefetch'

const NAV_COLLECTIONS = new Set(['movies', 'tvshows'])
const HANDLED_COLLECTIONS = new Set(['movies', 'tvshows', 'music', 'boxsets', 'playlists'])

export const ANIME_HREF = '/browse?title=Anime&tags=anime&includeItemTypes=Movie,Series&sortBy=SortName'
export const COLLECTIONS_HREF = '/browse?title=Collections&includeItemTypes=BoxSet&sortBy=SortName'

export interface SecondaryDestination {
  label: string
  to: string
  match: (p: string, s: string) => boolean
  viewId?: string
  collectionType?: string
}

/** Everything that isn't Movies / Shows — one "More" menu on desktop and the
 *  TV, the Library tab on phones (pages/LibrariesPage). */
export function useSecondaryDestinations(): SecondaryDestination[] {
  const { data: views } = useViews()
  const { hasAnime, hasGames } = useOptionalLibraries()
  const { info } = useFinesse()
  const { data: friends } = useFriends()
  const friendMusic = useFriendMusic()
  const hasCollections = views?.Items.some((v) => v.CollectionType === 'boxsets') ?? false
  const smart = useSmartOn()
  const together = useQueuesOn()
  const momentCollections = useMomentCollectionsOn()
  const limits = useMyLimits()
  // Music shows when there's music here, or a friend shares theirs (Groups).
  const hasMusic = (views?.Items.some((v) => v.CollectionType === 'music') ?? false) || friendMusic.rows.length > 0
  // Friends is always reachable on a Finesse server (to add friends, see live household activity, Watch Together, and shared libraries).
  const hasFriends = Boolean(friends?.length || info)
  const extraLibraries: SecondaryDestination[] = (views?.Items ?? [])
    .filter((v) => !HANDLED_COLLECTIONS.has(v.CollectionType ?? ''))
    .map((v) => ({
      label: v.Name,
      to: `/library/${v.Id}`,
      match: (p: string) => p === `/library/${v.Id}`,
      viewId: v.Id,
      collectionType: v.CollectionType,
    }))
  return [
    ...(hasAnime ? [{ label: 'Anime', to: ANIME_HREF, match: (p: string, s: string) => p === '/browse' && s.includes('tags=anime') }] : []),
    ...(hasMusic ? [{ label: 'Music', to: '/music', match: (p: string) => p.startsWith('/music') || p.startsWith('/album') }] : []),
    ...(hasGames ? [{ label: 'Games', to: '/games', match: (p: string) => p.startsWith('/games') }] : []),
    ...(hasFriends ? [{ label: 'Friends', to: '/friends', match: (p: string) => p === '/friends' }] : []),
    ...(hasCollections
      ? [{ label: 'Collections', to: COLLECTIONS_HREF, match: (p: string, s: string) => p === '/browse' && s.includes('BoxSet') }]
      : []),
    ...extraLibraries,
    ...(together ? [{ label: 'Watch together', to: '/together', match: (p: string) => p.startsWith('/together') }] : []),
    ...(momentCollections ? [{ label: 'Moments', to: '/moments', match: (p: string) => p.startsWith('/moments') }] : []),
    ...(smart ? [{ label: 'My collections', to: '/smart', match: (p: string) => p.startsWith('/smart') }] : []),
    ...(limits && !limits.requests ? [] : [{ label: 'Requests and downloads', to: '/request', match: (p: string) => p === '/request' }]),
    { label: 'Activity', to: '/activity', match: (p: string) => p === '/activity' },
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
  return { hasAnime: (anime?.TotalRecordCount ?? 0) > 0, hasGames: loading ? false : info ? Boolean(info.features.games || info.features.streaming || gameStoreMode(info)) : true }
}

export default function NavBar() {
  const { data: views } = useViews()
  const { session, logout } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(window.scrollY > 24)
  const menuRef = useRef<HTMLDivElement>(null)
  const avatarRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const more = useSecondaryDestinations()
  // Admins: the NAS is behind the latest release — offer to update it.
  const { data: server } = useServerUpdate()
  const serverUpdate = server?.available && server.latest ? server.latest : null
  const { info: finesse } = useFinesse()
  const limits = useMyLimits()
  const canAddMedia = !__WEBOS__ && Boolean(session?.isAdmin && finesse?.features?.addMedia)

  const closeMenu = (refocus = false) => {
    setMenuOpen(false)
    if (refocus) avatarRef.current?.focus({ preventScroll: true })
  }

  useEffect(() => {
    const close = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuRef.current && !menuRef.current.contains(t) && !popRef.current?.contains(t)) setMenuOpen(false)
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
      closeMenu(true)
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
  // 2.0: Music, Games and Friends are spaces of their own in the pill; the rest
  // stays under More. (The TV's stylesheet drops the glass blur it can't draw.)
  const SPACES = new Set(['Music', 'Games', 'Friends'])
  // Narrower screens (a tablet, an unfolded phone held sideways, a small
  // window) keep the spaces under More, so the bar never runs off the edge.
  const wide = useWide()
  // Still too much for the bar (many libraries, long names, a narrow window)? Fold the spaces
  // into More, then the libraries too, rather than let destinations scroll out of sight.
  const navRef = useRef<HTMLElement>(null)
  const [crowd, setCrowd] = useState(0)
  const crowdKey = `${libraries.map((l) => l.Name).join('|')}#${more.length}#${wide}`
  useEffect(() => setCrowd(0), [crowdKey])
  useEffect(() => {
    const reset = () => setCrowd(0)
    window.addEventListener('resize', reset)
    return () => window.removeEventListener('resize', reset)
  }, [])
  useLayoutEffect(() => {
    const el = navRef.current
    if (el && crowd < 2 && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) setCrowd(crowd + 1)
  }, [crowd, crowdKey])
  const spaces = wide && crowd < 1 ? more.filter((d) => SPACES.has(d.label)) : []
  const barLibraries = crowd < 2 ? libraries : []
  const rest = [
    ...(crowd < 2 ? [] : libraries.map((lib) => ({ label: lib.Name, to: `/library/${lib.Id}`, match: (p: string) => p === `/library/${lib.Id}` }))),
    ...(wide && crowd < 1 ? more.filter((d) => !SPACES.has(d.label)) : more),
  ]
  const moreActive = rest.some((d) => d.match(pathname, search))
  const { data: queue } = useArrQueue(Boolean(finesse?.features?.requests) && (!limits || limits.requests))
  const downloading = (queue ?? []).filter((d) => !d.done).length

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-4 py-2 rounded-full text-[14px] font-medium transition-all duration-300 ${
      isActive ? 'text-ink-950 bg-[#f5f3ee] shadow-[0_0_28px_rgba(255,255,255,0.35)]' : 'text-white/70 hover:text-white'
    }`

  return (
    <header
      // No bottom border: a transparent one repeated the fade's dark top row as a
      // hairline under the bar. The scrolled bar's shadow separates it instead.
      className={`vt-nav fixed top-0 inset-x-0 z-50 transition-all duration-500 ${
        scrolled
          ? 'bg-ink-950/55 backdrop-blur-2xl backdrop-saturate-150 shadow-lg shadow-black/25'
          : 'bg-gradient-to-b from-ink-950/70 to-transparent'
      }`}
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div
        className="h-16 max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-12 flex items-center gap-2"
        style={{
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        <Link to="/" className="font-display italic text-[30px] leading-none tracking-tight text-white mr-5 shrink-0">
          Finesse<span style={{ color: 'rgb(var(--mood-rgb, 117, 137, 216))', transition: 'color 1s ease' }}>.</span>
        </Link>

        <nav ref={navRef} aria-label="Main" className="hidden md:flex min-w-0 items-center gap-0.5 overflow-x-auto no-scrollbar p-1 rounded-full os-glass">
          <NavLink to="/" end className={linkClass}>
            Home
          </NavLink>
          {barLibraries.map((lib) => (
            <NavLink key={lib.Id} to={`/library/${lib.Id}`} className={linkClass}>
              {lib.Name}
            </NavLink>
          ))}
          {spaces.map((d) => (
            <NavLink
              key={d.to}
              to={d.to}
              onMouseEnter={() => prefetchRoute(d.to)}
              onFocus={() => prefetchRoute(d.to)}
              className={() => linkClass({ isActive: d.match(pathname, search) })}
            >
              {d.label}
            </NavLink>
          ))}
          <ActionMenu
            label="More"
            align="left"
            items={rest.map((d) => ({ label: d.label, onSelect: () => navigate(d.to) }))}
            triggerClassName={`inline-flex items-center gap-1 px-4 py-2 rounded-full text-[14px] font-medium transition-all duration-300 ${
              moreActive ? 'text-ink-950 bg-[#f5f3ee]' : 'text-white/70 hover:text-white'
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
            className="hidden md:flex shrink-0 items-center justify-center xl:justify-start gap-2.5 w-10 xl:w-60 h-10 rounded-full os-glass xl:pl-4 xl:pr-2 text-sm text-white/65 hover:text-white transition-colors"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z" />
            </svg>
            <span className="hidden xl:inline flex-1 text-left">Search</span>
            <kbd className="hidden xl:flex h-5 min-w-5 px-1.5 rounded border border-white/15 text-[11px] font-sans text-ink-400 items-center justify-center">/</kbd>
          </button>
        )}

        <button
          type="button"
          onClick={openQuickMenu}
          aria-label={`Quick menu${downloading ? ` (${downloading} downloading)` : ''}`}
          title="Quick menu"
          className="relative ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full os-glass text-white/85 hover:text-white transition-colors"
        >
          <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9} aria-hidden>
            <rect x="4" y="4" width="6.5" height="6.5" rx="1.8" />
            <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8" />
            <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8" />
            <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8" />
          </svg>
          {downloading > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#f5f3ee] text-ink-950 font-mono text-[10.5px] font-semibold leading-[18px] text-center">
              {downloading}
            </span>
          )}
        </button>

        <MomentsBell lux />

        <NavLink
          to="/mylist"
          aria-label="My List"
          title="My List"
          className={({ isActive }) =>
            `hidden md:flex h-10 w-10 shrink-0 ml-1 items-center justify-center rounded-full os-glass transition-colors ${isActive ? 'text-white' : 'text-white/80 hover:text-white'}`
          }
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
          </svg>
        </NavLink>

        <div className="relative ml-2 shrink-0" ref={menuRef}>
          <button
            ref={avatarRef}
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="relative h-10 w-10 rounded-full p-[2px] text-sm font-semibold text-white bg-[conic-gradient(from_200deg,rgb(var(--mood-rgb,117,137,216)),#f5f3ee,rgb(var(--mood-rgb,117,137,216)))] hover:brightness-110 transition"
            title={session?.userName}
            aria-label={`Account menu for ${session?.userName ?? 'you'}${serverUpdate ? ' (update available)' : ''}`}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            <span className="flex h-full w-full items-center justify-center rounded-full bg-ink-900">{session?.userName?.charAt(0).toUpperCase()}</span>
            {serverUpdate && (
              <span aria-hidden className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-accent-300 ring-2 ring-ink-950" />
            )}
          </button>
          {menuOpen && (
            <AccountMenu anchor={menuRef} popRef={popRef} name={session?.userName ?? ''} admin={Boolean(session?.isAdmin)}>
              {serverUpdate && (
                <MenuItem
                  icon={<SparkIcon />}
                  accent
                  onClick={() => {
                    closeMenu()
                    void beginServerUpdate(serverUpdate, server?.kind)
                  }}
                >
                  Update Finesse to {shortVersion(serverUpdate)}
                </MenuItem>
              )}
              {canAddMedia && (
                <MenuItem
                  icon={<Icon d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 14v3.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V14" />}
                  onClick={() => {
                    closeMenu()
                    navigate('/add-media')
                  }}
                >
                  Add media
                </MenuItem>
              )}
              {!__WEBOS__ && (
                <MenuItem
                  icon={<Icon d="M8.25 4.5h7.5a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-7.5a1.5 1.5 0 0 1-1.5-1.5V6a1.5 1.5 0 0 1 1.5-1.5Z" extra="M12 9.5v.01M10 12h4M12 15.5v.01" />}
                  onClick={() => {
                    closeMenu()
                    navigate('/remote')
                  }}
                >
                  Remote
                </MenuItem>
              )}
              <MenuItem
                icon={<Icon d={COG} extra="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />}
                onClick={() => {
                  closeMenu()
                  navigate('/settings')
                }}
              >
                Settings
              </MenuItem>
              {(!limits || limits.requests) && (
                <MenuItem
                  className="md:hidden"
                  icon={<Icon d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />}
                  onClick={() => {
                    closeMenu()
                    navigate('/request')
                  }}
                >
                  Requests and downloads
                </MenuItem>
              )}
              <MenuItem
                icon={<Icon d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />}
                onClick={logout}
              >
                Switch profile or sign out
              </MenuItem>
            </AccountMenu>
          )}
        </div>
      </div>
    </header>
  )
}

const COG =
  'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z'

function Icon({ d, extra }: { d: string; extra?: string }) {
  return (
    <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
      {extra && <path strokeLinecap="round" strokeLinejoin="round" d={extra} />}
    </svg>
  )
}

function MenuItem({ icon, children, onClick, accent, className = '' }: { icon: ReactNode; children: ReactNode; onClick: () => void; accent?: boolean; className?: string }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`${className} flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-[15px] transition-colors hover:bg-white/[0.08] focus-visible:bg-white/[0.1] [@media(hover:none)]:py-3 ${
        accent ? 'font-semibold text-accent-300' : 'text-white/90'
      }`}
    >
      <span className={`shrink-0 ${accent ? '' : 'text-white/55'}`}>{icon}</span>
      {children}
    </button>
  )
}

/** The account menu. It lives outside the nav bar (a portal) on purpose: glass
 *  only blurs what's behind it up to the nearest glass parent, so inside the
 *  bar it would blur nothing and the page would show straight through. */
function AccountMenu({
  anchor,
  popRef,
  name,
  admin,
  children,
}: {
  anchor: RefObject<HTMLDivElement | null>
  popRef: RefObject<HTMLDivElement | null>
  name: string
  admin: boolean
  children: ReactNode
}) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  useOverlayFocus(Boolean(pos), popRef)
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect()
      if (r) setPos({ top: r.bottom + 10, right: Math.max(12, window.innerWidth - r.right) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchor])
  if (!pos) return null
  return createPortal(
    <div
      ref={popRef}
      role="menu"
      aria-label="Account"
      className="os-menu toast-in fixed z-[60] w-[17rem] max-w-[calc(100vw-24px)] rounded-[26px] p-1.5"
      style={{ top: pos.top, right: pos.right }}
    >
      <div className="flex items-center gap-3 px-3 pb-3 pt-2.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 text-[15px] font-semibold text-white">
          {name.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold text-white">{name}</span>
          <span className="block text-[13px] text-white/55">{admin ? 'Administrator' : 'Member'}</span>
        </span>
      </div>
      <div className="mx-2 mb-1.5 h-px bg-white/10" />
      {children}
    </div>,
    document.body,
  )
}

const WIDE = '(min-width: 1024px)'
/** Wide enough for Music, Games and Friends in the top bar. */
function useWide(): boolean {
  return useSyncExternalStore(
    (fn) => {
      const mql = window.matchMedia(WIDE)
      mql.addListener(fn) // addEventListener('change') is missing on the TV's Chromium 68
      return () => mql.removeListener(fn)
    },
    () => window.matchMedia(WIDE).matches,
  )
}
