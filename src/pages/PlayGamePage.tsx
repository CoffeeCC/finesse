import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useGame } from '../api/queries'
import { ejsCore, primeGamesAuth, rommContentUrl } from '../api/romm'
import { CONTENT_BASE } from '../lib/contentOrigin'

// Plays a RomM title with EmulatorJS (client-side WASM). The ROM streams from
// RomM through our nginx; the emulator core loads from the EmulatorJS CDN. Exit
// does a hard navigation back to /games — EmulatorJS doesn't tear down cleanly
// (audio/gamepad loops linger), so a full reload is the reliable way to stop it.

const EJS_DATA = 'https://cdn.emulatorjs.org/stable/data/'

function exitToGames() {
  window.location.href = `${CONTENT_BASE}games`
}

export default function PlayGamePage() {
  const { romId } = useParams()
  const { data: rom, isLoading } = useGame(romId)
  const started = useRef(false)
  const [error, setError] = useState('')

  const core = rom ? ejsCore(rom.platform_slug) : null

  useEffect(() => {
    // Back / Escape leaves the game (hard reload kills the emulator cleanly).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'BrowserBack' ||
          (e as KeyboardEvent & { keyCode?: number }).keyCode === 461) {
        e.preventDefault()
        exitToGames()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!rom || started.current) return
    if (!core) {
      setError(`${rom.platform_display_name} can’t be emulated in a browser.`)
      return
    }
    started.current = true
    primeGamesAuth() // cookie so EmulatorJS's ROM fetch clears the nginx auth gate
    const w = window as unknown as Record<string, unknown>
    w.EJS_player = '#game'
    w.EJS_core = core
    w.EJS_gameUrl = rommContentUrl(rom)
    w.EJS_gameName = rom.name
    w.EJS_pathtodata = EJS_DATA
    w.EJS_startOnLoaded = true
    w.EJS_backgroundColor = '#0b0d12'
    w.EJS_onLoadError = () => setError('Could not load this game. Its format may be unsupported.')
    const s = document.createElement('script')
    s.src = `${EJS_DATA}loader.js`
    s.async = true
    s.onerror = () => setError('Could not reach the EmulatorJS runtime.')
    document.body.appendChild(s)
  }, [rom, core])

  return (
    <div className="fixed inset-0 bg-ink-950 z-50">
      <button
        onClick={exitToGames}
        className="absolute top-3 left-3 z-[60] inline-flex items-center gap-2 rounded-lg bg-black/60 hover:bg-black/80 backdrop-blur px-3 py-2 text-sm font-medium text-white transition-colors"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
        Exit
      </button>

      {error ? (
        <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-ink-200">{error}</p>
          <button onClick={exitToGames} className="rounded-lg bg-accent-500 hover:bg-accent-400 px-4 py-2 text-sm font-semibold text-white transition-colors">
            Back to Games
          </button>
        </div>
      ) : isLoading || !rom ? (
        <div className="h-full flex items-center justify-center">
          <div className="spinner" />
        </div>
      ) : (
        <div id="game" className="h-full w-full" />
      )}
    </div>
  )
}
