import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useLayoutEffect, useMemo } from 'react'
import { useAuth } from './auth/AuthContext'
import LoginPage from './auth/LoginPage'
import InvitePage from './pages/InvitePage'
import SetupPage from './pages/setup/SetupPage'
import TvConnectPage from './pages/TvConnectPage'
import NavBar from './components/NavBar'
import BottomTabs from './components/BottomTabs'
import HomePage from './pages/HomePage'
import LibraryPage from './pages/LibraryPage'
import ItemPage from './pages/ItemPage'
import PlayerPage from './pages/PlayerPage'
import SearchPage from './pages/SearchPage'
import RequestPage from './pages/RequestPage'
import MyListPage from './pages/MyListPage'
import LibrariesPage from './pages/LibrariesPage'
import SettingsPage from './pages/SettingsPage'
import PersonPage from './pages/PersonPage'
import BrowsePage from './pages/BrowsePage'
import MusicPage from './pages/MusicPage'
import AlbumPage from './pages/AlbumPage'
import GamesPage from './pages/GamesPage'
import GameDetailPage from './pages/GameDetailPage'
import PlayGamePage from './pages/PlayGamePage'
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
import { ServerUpdateOverlay } from './components/Update'
import { IS_TV } from './lib/device'
import { goBack, isBackKey, isTypingTarget, runBackHandlers } from './lib/back'
import { initUiSounds } from './lib/sound'
import { useClipManifest } from './api/queries'
import { getAccentPref, getPreviewQualityPref } from './api/client'
import { applyAccent, getStoredAccent, setStoredAccent } from './lib/accent'
import { getPrefs, setPrefs, type PreviewQuality } from './lib/settings'

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
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<SetupPage />} />
        {__WEBOS__ && <Route path="/connect" element={<TvConnectPage />} />}
        <Route path="/invite" element={<InvitePage />} />
        <Route path="/invite/:code" element={<InvitePage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
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
      <Routes>
        {__WEBOS__ && <Route path="/connect" element={<TvConnectPage />} />}
        {/* Player + game player are full-bleed, no navbar */}
        <Route path="/play/:itemId" element={<PlayerPage />} />
        <Route path="/games/play/:romId" element={<PlayGamePage />} />
        <Route
          path="*"
          element={
            <>
              <NavBar />
              <main className="pt-16 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-0">
                {/* Re-keying per path gives every page a rise-in entrance */}
                <div key={location.pathname} className={enterClass}>
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
                    <Route path="/search" element={<SearchPage />} />
                    <Route path="/request" element={<RequestPage />} />
                    <Route path="/mylist" element={<MyListPage />} />
                    <Route path="/watchlist" element={<Navigate to="/mylist" replace />} />
                    <Route path="/libraries" element={<LibrariesPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/login" element={<Navigate to="/" replace />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </div>
              </main>
              <MiniPlayer />
              <CastRemote />
              <NowPlaying />
              <BottomTabs />
              {!IS_TV && <SearchOverlay />}
              <ServerUpdateOverlay />
            </>
          }
        />
      </Routes>
    </>
  )
}
