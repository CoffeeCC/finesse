import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuth } from './auth/AuthContext'
import LoginPage from './auth/LoginPage'
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
import MiniPlayer from './components/MiniPlayer'
import NowPlaying from './components/NowPlaying'
import { useSpatialNavigation } from './lib/spatialNav'
import { getAccentPref } from './api/client'
import { applyAccent, getStoredAccent, setStoredAccent } from './lib/accent'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => window.scrollTo(0, 0), [pathname])
  return null
}

export default function App() {
  const { session } = useAuth()
  const location = useLocation()
  useSpatialNavigation()

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
  }, [session])

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <>
      <ScrollToTop />
      <div className="grain" aria-hidden />
      <Routes>
        {/* Player is full-bleed, no navbar */}
        <Route path="/play/:itemId" element={<PlayerPage />} />
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
