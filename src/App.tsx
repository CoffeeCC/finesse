import { MomentArrivals } from './components/moments/MomentsBell'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Suspense, useEffect, useLayoutEffect, useMemo } from 'react'
import { lazyPage } from './lib/lazyPage'
import { PageError } from './components/PageError'
import { useAuth } from './auth/AuthContext'
import LoginPage from './auth/LoginPage'
import TvConnectPage from './pages/TvConnectPage'
import NavBar from './components/NavBar'
import BottomTabs from './components/BottomTabs'
import HomePage from './pages/HomePage'
import LibraryPage from './pages/LibraryPage'
import ItemPage from './pages/ItemPage'
import SearchPage from './pages/SearchPage'
import MyListPage from './pages/MyListPage'
import LibrariesPage from './pages/LibrariesPage'
import DropToAdd from './components/DropToAdd'
import BrowsePage from './pages/BrowsePage'
import MiniPlayer from './components/MiniPlayer'
import NowPlaying from './components/NowPlaying'
import TvBoot from './components/TvBoot'
import TvPointer from './components/TvPointer'
import FocusBackdrop from './components/FocusBackdrop'
import Marquee from './components/Marquee'
import { useSpatialNavigation } from './lib/spatialNav'
import { useRouteMemory } from './lib/routeMemory'
import { useRemoteControl } from './lib/remoteControl'
import { routeCommitted, transitionActive } from './lib/motion'
import CastRemote from './components/CastRemote'
import MoodWash from './components/MoodWash'
import SearchOverlay from './components/SearchOverlay'
import QuickMenu from './components/os/QuickMenu'
import PartyInvites from './components/PartyInvites'
import { ServerUpdateOverlay } from './components/Update'
import { IS_TV } from './lib/device'
import { goBack, isBackKey, isTypingTarget, runBackHandlers } from './lib/back'
import { initUiSounds } from './lib/sound'
import { initGamepad } from './lib/gamepad'
import ControllerHint from './components/ControllerHint'
import { useClipManifest } from './api/queries'
import { getAccentPref, getPreviewQualityPref } from './api/client'
import { applyAccent, getStoredAccent, setStoredAccent } from './lib/accent'
import { getPrefs, setPrefs, type PreviewQuality } from './lib/settings'

// Pages beyond the first screens load when first opened (their own files on the web; the TV
// build inlines them into its one app.js, see vite.config.ts). Home, a library, a title,
// search and My List stay in the main file so the everyday paths never wait.
const InvitePage = lazyPage(() => import('./pages/InvitePage'))
const SetupPage = lazyPage(() => import('./pages/setup/SetupPage'))
const PlayerPage = lazyPage(() => import('./pages/PlayerPage'))
const RequestPage = lazyPage(() => import('./pages/RequestPage'))
const RequestMoviePage = lazyPage(() => import('./pages/RequestMoviePage'))
const ActivityPage = lazyPage(() => import('./pages/ActivityPage'))
const AddMediaPage = lazyPage(() => import('./pages/AddMediaPage'))
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'))
const PersonPage = lazyPage(() => import('./pages/PersonPage'))
const MusicPage = lazyPage(() => import('./pages/MusicPage'))
const AlbumPage = lazyPage(() => import('./pages/AlbumPage'))
const GamesPage = lazyPage(() => import('./pages/GamesPage'))
const GameDetailPage = lazyPage(() => import('./pages/GameDetailPage'))
const PlayGamePage = lazyPage(() => import('./pages/PlayGamePage'))
const GameStorePage = lazyPage(() => import('./pages/GameStorePage'))
const GameStoreBrowsePage = lazyPage(() => import('./pages/GameStoreBrowsePage'))
const GameStoreGamePage = lazyPage(() => import('./pages/GameStoreGamePage'))
const GameRequestsPage = lazyPage(() => import('./pages/GameRequestsPage'))
const GameInstallerPage = lazyPage(() => import('./pages/GameInstallerPage'))
const StreamPlayPage = lazyPage(() => import('./pages/StreamPlayPage'))
const FriendsPage = lazyPage(() => import('./pages/FriendsPage'))
const RemotePage = lazyPage(() => import('./pages/RemotePage'))
const SmartCollectionsPage = lazyPage(() => import('./pages/SmartCollectionsPage'))
const TogetherPage = lazyPage(() => import('./pages/TogetherPage'))
const MomentsPage = lazyPage(() => import('./pages/MomentsPage'))

export default function App() {
  const { session } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  useSpatialNavigation()
  useRouteMemory()
  // Be a cast target for other devices ("Play on…"), and keep watch state live.
  useRemoteControl()

  // Tell lib/motion the new route is on screen (it snapshots the "after" state).
  useLayoutEffect(() => {
    routeCommitted()
  }, [location.key])
  // A page arriving through a morph skips its own rise-in (they'd fight); the
  // class is fixed per page so it can't restart when the morph ends.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const enterClass = useMemo(() => (transitionActive() ? '' : 'page-enter'), [location.pathname])

  // Global select-confirm sound (opt-in via Settings). Idempotent.
  useEffect(() => initUiSounds(), [])
  // Game controllers drive the app like a remote (lib/gamepad).
  useEffect(() => initGamepad(), [])

  // Remote/keyboard Back everywhere (player included): close the topmost open
  // menu/sheet first, otherwise step back — see lib/back.ts for the webOS
  // double-back guard and exit-at-root behavior.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isBackKey(e)) return
      const typing = isTypingTarget(e.target)
      // Backspace/Back inside a text field edit it (or close the TV keyboard).
      if (typing && e.key !== 'Escape') return
      // Escape in fullscreen is the browser leaving fullscreen, not "back".
      if (e.key === 'Escape' && document.fullscreenElement) return
      if (runBackHandlers()) {
        e.preventDefault()
        return
      }
      if (typing) return // Escape in a plain field: nothing to close, don't navigate
      e.preventDefault()
      goBack(navigate)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  // Warm the preview-clip manifest once so cards can offer hover-preview
  // (read from the shared cache) without each card firing its own fetch.
  useClipManifest()

  // Pull this account's saved accent (synced via DisplayPreferences) and apply it,
  // updating the local mirror so future loads are instant.
  useEffect(() => {
    if (!session) return
    getAccentPref().then((name) => {
      if (name && name !== getStoredAccent()) {
        setStoredAccent(name)
        applyAccent(name)
      }
    })
    // Pull this account's synced preview-quality choice (falls back to the local
    // default until the server answers).
    getPreviewQualityPref().then((q) => {
      if ((q === 'low' || q === 'medium' || q === 'high') && q !== getPrefs().previewQuality) {
        setPrefs({ previewQuality: q as PreviewQuality })
      }
    })
  }, [session])

  if (!session) {
    return (
      <PageError>
      <Suspense fallback={<div className="min-h-screen bg-ink-950" />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<SetupPage />} />
        {__WEBOS__ && <Route path="/connect" element={<TvConnectPage />} />}
        <Route path="/invite" element={<InvitePage />} />
        <Route path="/invite/:code" element={<InvitePage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
      </Suspense>
      </PageError>
    )
  }

  return (
    <>
      {__WEBOS__ && <TvBoot />}
      {__WEBOS__ && <TvPointer />}
      {!IS_TV && <MoodWash />}
      <FocusBackdrop />
      <Marquee />
      <div className="grain" aria-hidden />
      <ControllerHint />
      <PageError key={location.pathname.startsWith('/play/') || location.pathname.startsWith('/games/') || location.pathname === '/setup' ? location.pathname : 'app'}>
      <Suspense fallback={<div className="fixed inset-0 bg-black" />}>
      <Routes>
        {__WEBOS__ && <Route path="/connect" element={<TvConnectPage />} />}
        {/* Player + game player are full-bleed, no navbar */}
        <Route path="/play/:itemId" element={<PlayerPage />} />
        <Route path="/games/play/:romId" element={<PlayGamePage />} />
        {/* Administrators changing downloads / away-from-home access: the wizard, full-bleed */}
        {!__WEBOS__ && <Route path="/setup" element={<SetupPage />} />}
        {!__WEBOS__ && <Route path="/games/stream/:sessionId" element={<StreamPlayPage />} />}
        <Route
          path="*"
          element={
            <>
              <NavBar />
              <main className="pt-16 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-0">
                {/* Re-keying per path gives every page a rise-in entrance */}
                <div key={location.pathname} className={enterClass}>
                  <PageError>
                  <Suspense fallback={<PageLoading />}>
                  <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/library/:viewId" element={<LibraryPage />} />
                    <Route path="/item/:itemId" element={<ItemPage />} />
                    <Route path="/person/:personId" element={<PersonPage />} />
                    <Route path="/browse" element={<BrowsePage />} />
                    <Route path="/music" element={<MusicPage />} />
                    <Route path="/album/:albumId" element={<AlbumPage />} />
                    <Route path="/games" element={<GamesPage />} />
                    <Route path="/games/game/:romId" element={<GameDetailPage />} />
                    <Route path="/games/store" element={<GameStorePage />} />
                    <Route path="/games/store/browse" element={<GameStoreBrowsePage />} />
                    <Route path="/games/store/game/:gameId" element={<GameStoreGamePage />} />
                    <Route path="/games/store/requests" element={<GameRequestsPage />} />
                    <Route path="/games/store/requests/:requestId/installer" element={<GameInstallerPage />} />
                    <Route path="/search" element={<SearchPage />} />
                    <Route path="/request" element={<RequestPage />} />
                    <Route path="/request/movie/:tmdbId" element={<RequestMoviePage />} />
                    <Route path="/mylist" element={<MyListPage />} />
                    <Route path="/friends" element={<FriendsPage />} />
                    <Route path="/watchlist" element={<Navigate to="/mylist" replace />} />
                    <Route path="/libraries" element={<LibrariesPage />} />
                    <Route path="/activity" element={<ActivityPage />} />
                    <Route path="/smart/*" element={<SmartCollectionsPage />} />
                    <Route path="/together/*" element={<TogetherPage />} />
                    <Route path="/moments/*" element={<MomentsPage />} />
                    {!__WEBOS__ && <Route path="/add-media" element={<AddMediaPage />} />}
                    {!__WEBOS__ && <Route path="/remote" element={<RemotePage />} />}
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/login" element={<Navigate to="/" replace />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                  </Suspense>
                  </PageError>
                </div>
              </main>
              <MiniPlayer />
              <CastRemote />
              <NowPlaying />
              <BottomTabs />
              {!IS_TV && <SearchOverlay />}
              <QuickMenu />
              <MomentArrivals />
              <PartyInvites />
              <ServerUpdateOverlay />
              {!__WEBOS__ && <DropToAdd />}
            </>
          }
        />
      </Routes>
      </Suspense>
      </PageError>
    </>
  )
}

/** While a page's file loads (the first time it's opened): a quiet placeholder, not a blank. */
function PageLoading() {
  return (
    <div className="px-4 pt-8 sm:px-6 lg:px-12" aria-busy="true" aria-label="Loading">
      <div className="h-10 w-56 rounded-lg shimmer" />
      <div className="mt-6 h-40 rounded-2xl shimmer" />
    </div>
  )
}
