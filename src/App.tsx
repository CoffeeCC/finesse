import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuth } from './auth/AuthContext'
import LoginPage from './auth/LoginPage'
import InvitePage from './pages/InvitePage'
import NavBar from './components/NavBar'
import BottomTabs from './components/BottomTabs'
import HomePage from './pages/HomePage'
import LibraryPage from './pages/LibraryPage'
import ItemPage from './pages/ItemPage'
import PlayerPage from './pages/PlayerPage'
import SearchPage from './pages/SearchPage'
import RequestPage from './pages/RequestPage'
import WatchlistPage from './pages/WatchlistPage'
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
import { initUiSounds } from './lib/sound'
import { useClipManifest } from './api/queries'
import { getAccentPref, getPreviewQualityPref } from './api/client'
import { applyAccent, getStoredAccent, setStoredAccent } from './lib/accent'
import { getPrefs, setPrefs, type PreviewQuality } from './lib/settings'

function ScrollToTop() {
  const { pathname } = useLocation()
  // Braces matter: newer Chrome returns a Promise from scrollTo, and a concise
  // arrow would hand it to React as the effect "cleanup" → TypeError (blank
  // screen) on every route change.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export default function App() {
  const { session } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  useSpatialNavigation()

  // Global select-confirm sound (opt-in via Settings). Idempotent.
  useEffect(() => initUiSounds(), [])

  // Keyboard/remote "back": Backspace, Escape, or the webOS remote Back button
  // (keyCode 461) navigate one step back — so keyboard/D-pad users aren't stuck
  // after clicking into a title. The full-bleed player owns its own keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const path = window.location.pathname + window.location.hash
      if (path.includes('/play/')) return
      const t = e.target as HTMLElement | null
      const typing =
        t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || (t?.isContentEditable ?? false)
      if (typing) return
      const isBack =
        e.key === 'Backspace' ||
        e.key === 'Escape' ||
        e.key === 'BrowserBack' ||
        (e as KeyboardEvent & { keyCode?: number }).keyCode === 461
      if (!isBack) return
      e.preventDefault()
      navigate(-1)
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
        <Route path="/invite" element={<InvitePage />} />
        <Route path="/invite/:code" element={<InvitePage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <>
      <ScrollToTop />
      {__WEBOS__ && <TvBoot />}
      {__WEBOS__ && <TvPointer />}
      <FocusBackdrop />
      <Marquee />
      <div className="grain" aria-hidden />
      <Routes>
        {/* Player + game player are full-bleed, no navbar */}
        <Route path="/play/:itemId" element={<PlayerPage />} />
        <Route path="/games/play/:romId" element={<PlayGamePage />} />
        <Route
          path="*"
          element={
            <>
              <NavBar />
              <main className="pt-16 pb-20 md:pb-0">
                {/* Re-keying per path gives every page a rise-in entrance */}
                <div key={location.pathname} className="page-enter">
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
                    <Route path="/watchlist" element={<WatchlistPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/login" element={<Navigate to="/" replace />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </div>
              </main>
              <MiniPlayer />
              <NowPlaying />
              <BottomTabs />
            </>
          }
        />
      </Routes>
    </>
  )
}
