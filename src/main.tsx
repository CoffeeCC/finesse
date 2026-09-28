import './lib/polyfills' // before anything runs: APIs old TV engines lack
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import './lib/accent' // applies the saved accent color before first paint
import { applyUiScale } from './lib/settings'
import { applyTimeAmbience } from './lib/timeAmbience'
import { IS_TV } from './lib/device'
import { migrateTvOrigin } from './lib/finesseServer'

applyUiScale() // apply saved UI zoom before first paint (no flash)
if (IS_TV) document.documentElement.classList.add('tv') // CSS opts TVs out of heavy motion
applyTimeAmbience() // daypart-tinted ambience (aurora hues, greeting copy)
import App from './App'
import { AuthProvider } from './auth/AuthContext'
import { ToastProvider } from './components/Toast'
import { AudioPlayerProvider } from './audio/AudioPlayerContext'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

// The webOS bundle runs from a file:// origin, where path-based routing breaks
// (no server to resolve /movie/123). HashRouter keeps all routing after the #.
// The web build keeps clean URLs under its /finesse/ basename.
const router = __WEBOS__
  ? { Router: HashRouter, props: {} }
  : { Router: BrowserRouter, props: { basename: import.meta.env.BASE_URL.replace(/\/$/, '') } }

const { Router, props: routerProps } = router

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <Router {...routerProps}>
          <AuthProvider>
            <ToastProvider>
              <AudioPlayerProvider>
                <App />
              </AudioPlayerProvider>
            </ToastProvider>
          </AuthProvider>
        </Router>
      </QueryClientProvider>
    </StrictMode>,
  )
}

// A TV updating from ≤0.13 had its server address built in; find it once
// (next to the Jellyfin it's signed in to) and remember it.
if (__WEBOS__) {
  migrateTvOrigin().then(
    (moved) => (moved ? window.location.reload() : render()),
    () => render(),
  )
} else {
  render()
}
