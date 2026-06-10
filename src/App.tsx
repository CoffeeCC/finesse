import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuth } from './auth/AuthContext'
import LoginPage from './auth/LoginPage'
import NavBar from './components/NavBar'
import HomePage from './pages/HomePage'
import LibraryPage from './pages/LibraryPage'
import ItemPage from './pages/ItemPage'
import PlayerPage from './pages/PlayerPage'
import SearchPage from './pages/SearchPage'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => window.scrollTo(0, 0), [pathname])
  return null
}

export default function App() {
  const { session } = useAuth()

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
      <Routes>
        {/* Player is full-bleed, no navbar */}
        <Route path="/play/:itemId" element={<PlayerPage />} />
        <Route
          path="*"
          element={
            <>
              <NavBar />
              <main className="pt-16">
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/library/:viewId" element={<LibraryPage />} />
                  <Route path="/item/:itemId" element={<ItemPage />} />
                  <Route path="/search" element={<SearchPage />} />
                  <Route path="/login" element={<Navigate to="/" replace />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </main>
            </>
          }
        />
      </Routes>
    </>
  )
}
