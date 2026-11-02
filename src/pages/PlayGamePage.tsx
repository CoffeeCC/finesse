import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getSession } from '../api/client'
import { useGame } from '../api/queries'
import { biosUrl, EJS_NIGHTLY, ejsCore, isBeta, needsThreads, primeGamesAuth, rommContentUrl } from '../api/romm'
import { CONTENT_BASE } from '../lib/contentOrigin'
import { bindPads, pressedPad, type PadState } from '../lib/retroPads'
import { keepSaves, type Ejs, type SaveConflict, type SaveNote } from '../lib/retroSaves'

// Plays a RomM title with EmulatorJS (client-side WASM). The ROM and the
// console's firmware (BIOS) stream from RomM through Finesse. The emulator
// itself comes from RomM's own copy when it has one (on your network, and the
// version RomM tested), else from the EmulatorJS CDN. Exit does a hard
// navigation back to /games — EmulatorJS doesn't tear down cleanly (audio and
// gamepad loops linger), so a full reload is the reliable way to stop it.
// In-game saves go to the Finesse server (lib/retroSaves), and Exit waits for the last one.
// Player 1 is the real controller this device chose (lib/retroPads), never a microphone.

const EJS_CDN = 'https://cdn.emulatorjs.org/stable/data/'
const EJS_LOCAL = `${CONTENT_BASE}games/assets/emulatorjs/data/`
const RELOADED = 'finesse.play.isolated'

async function emulatorData(): Promise<string> {
  try {
    const r = await fetch(`${EJS_LOCAL}version.json`, { credentials: 'same-origin' })
    if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) return EJS_LOCAL
  } catch {
    // No local copy: the CDN below.
  }
  return EJS_CDN
}

// The game's save, flushed before Exit reloads the page (set once the emulator is up).
let flushSave: (() => Promise<void>) | null = null
let exiting = false

async function exitToGames() {
  if (exiting) return
  exiting = true
  await flushSave?.().catch(() => {})
  window.location.href = `${CONTENT_BASE}games`
}

export default function PlayGamePage() {
  const { romId } = useParams()
  const { data: rom, isLoading } = useGame(romId)
  const started = useRef(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<{ note: SaveNote; at: number } | null>(null)
  const [conflict, setConflict] = useState<SaveConflict | null>(null)
  const [pads, setPads] = useState<PadState | null>(null)
  const [picking, setPicking] = useState(false)
  const choosePad = useRef<((id: string) => void) | null>(null)
  const asked = useRef(false)

  const core = rom ? ejsCore(rom.platform_slug) : null

  useEffect(() => {
    // Back / Escape leaves the game (hard reload kills the emulator cleanly).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'BrowserBack' ||
          (e as KeyboardEvent & { keyCode?: number }).keyCode === 461) {
        e.preventDefault()
        void exitToGames()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!rom || started.current) return
    if (!core) {
      setError(`${rom.platform_display_name} can’t be played in a browser. Stream it from a PC with Moonlight instead.`)
      return
    }
    // PSP and DOS emulators need threads, which only an isolated page gets: the
    // server isolates this page when it's loaded directly, so load it once more.
    const threads = needsThreads(core)
    if (threads && !window.crossOriginIsolated) {
      if (sessionStorage.getItem(RELOADED) !== String(rom.id)) {
        sessionStorage.setItem(RELOADED, String(rom.id))
        window.location.reload()
        return
      }
      setError(`${rom.platform_display_name} games need Chrome, Edge or Firefox to play here.`)
      return
    }
    sessionStorage.removeItem(RELOADED)
    started.current = true
    primeGamesAuth() // cookie so EmulatorJS's ROM, firmware and core fetches pass the auth gate
    void (async () => {
      const [data, bios] = await Promise.all([isBeta(core) ? EJS_NIGHTLY : emulatorData(), biosUrl(rom, core)])
      const w = window as unknown as Record<string, unknown>
      w.EJS_player = '#game'
      w.EJS_core = core
      w.EJS_gameUrl = rommContentUrl(rom)
      // Per person: EmulatorJS keys its in-browser states and settings by this name. (Its
      // battery save is keyed by the ROM's file name instead; lib/saveSlots keeps that per person.)
      const user = getSession()?.userId ?? ''
      w.EJS_gameName = user ? `${rom.name} (${user})` : rom.name
      if (bios) w.EJS_biosUrl = bios
      w.EJS_threads = threads
      w.EJS_pathtodata = data
      w.EJS_startOnLoaded = true
      w.EJS_backgroundColor = '#0b0d12'
      w.EJS_onLoadError = () => setError('Could not load this game. Its format may be unsupported.')
      w.EJS_ready = () => {
        const emu = w.EJS_emulator as Ejs | undefined
        if (!emu || typeof emu.on !== 'function') return
        // Signed out (can't happen here, but): the game plays, saves stay in this browser.
        if (user) {
          const saves = keepSaves(emu, {
            rom: rom.id,
            system: core,
            user,
            onNote: (note) =>
              // "Couldn't reach" once, not on every retry; "Saved" every time one lands.
              setSaved((prev) => (note.kind === 'offline' && prev?.note.kind === 'offline' ? prev : { note, at: Date.now() })),
            onConflict: setConflict,
          })
          flushSave = saves.flush
        }
        choosePad.current = bindPads(emu as unknown as Parameters<typeof bindPads>[0], (st) => {
          setPads(st)
          // Two controllers and no choice yet: ask once (the Controller button asks again).
          if (st.ask && !asked.current) {
            asked.current = true
            setPicking(true)
          }
        }).choose
      }
      const s = document.createElement('script')
      s.src = `${data}loader.js`
      s.async = true
      s.onerror = () => setError('Could not reach the emulator. Check that RomM is running.')
      document.body.appendChild(s)
    })()
  }, [rom, core])

  const pick = (id: string) => {
    choosePad.current?.(id)
    setPicking(false)
  }
  // The picker: a button pressed on a controller chooses it (that's the one in your hands).
  useEffect(() => {
    if (!picking) return
    const t = window.setInterval(() => {
      const id = pressedPad()
      if (id) pick(id)
    }, 100)
    return () => window.clearInterval(t)
  }, [picking])

  // The note fades after a moment.
  useEffect(() => {
    if (!saved) return
    const t = window.setTimeout(() => setSaved((s) => (s === saved ? { ...s, at: 0 } : s)), saved.note.kind === 'saved' ? 2500 : saved.note.kind === 'offline' ? 6000 : 12000)
    return () => window.clearTimeout(t)
  }, [saved])

  return (
    <div className="fixed inset-0 bg-ink-950 z-50">
      {saved && (
        <div
          role="status"
          className={`pointer-events-none absolute top-3.5 left-1/2 z-[60] -translate-x-1/2 inline-flex items-center gap-1.5 ${saved.note.kind === 'saved' ? 'rounded-full' : 'w-max max-w-md rounded-2xl text-center'} bg-black/70 px-3 py-1.5 text-[12px] font-medium text-white ring-1 ring-white/15 transition-opacity duration-500 ${saved.at ? 'opacity-100' : 'opacity-0'}`}
        >
          {saved.note.kind === 'saved' ? (
            <>
              <svg className="h-3.5 w-3.5 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
              Saved
            </>
          ) : saved.note.kind === 'offline' ? (
            'Couldn’t reach Finesse. Your save is kept on this device and goes up when it can.'
          ) : (
            saved.note.message
          )}
        </div>
      )}
      <button
        onClick={() => void exitToGames()}
        className="absolute top-3 left-3 z-[60] inline-flex items-center gap-2 rounded-lg bg-black/60 hover:bg-black/80 backdrop-blur px-3 py-2 text-sm font-medium text-white transition-colors"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
        Exit
      </button>

      {pads && pads.pads.length > 1 && !picking && (
        <button
          onClick={() => setPicking(true)}
          className="absolute top-3 right-3 z-[60] inline-flex max-w-[45vw] items-center gap-2 rounded-lg bg-black/60 hover:bg-black/80 backdrop-blur px-3 py-2 text-sm font-medium text-white transition-colors"
          title="Choose the controller you play with"
        >
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
            <rect x="2.5" y="7" width="19" height="10" rx="5" />
            <path strokeLinecap="round" d="M7 10.5v3M5.5 12h3M16 11h.01M18 13h.01" />
          </svg>
          <span className="truncate">{pads.pads.find((p) => p.id === pads.chosen)?.name ?? 'Controller'}</span>
        </button>
      )}
      {picking && pads && pads.pads.length > 0 && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={() => setPicking(false)}>
          <div role="dialog" aria-modal="true" aria-label="Choose your controller" className="w-full max-w-sm rounded-2xl bg-ink-900 p-5 text-left shadow-2xl ring-1 ring-white/10" onClick={(e) => e.stopPropagation()}>
            <p className="text-[15px] font-semibold text-white">Which controller are you playing with?</p>
            <p className="mt-1 text-[13px] text-ink-300">Press any button on it, or tap its name. This device remembers it.</p>
            <div className="mt-4 flex flex-col gap-2">
              {pads.pads.map((p) => (
                <button
                  key={p.id}
                  onClick={() => pick(p.id)}
                  className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-left text-[14px] font-medium ring-1 transition-colors ${
                    p.id === pads.chosen ? 'bg-white/10 text-white ring-accent-400/60' : 'bg-white/[0.04] text-ink-200 ring-white/10 hover:bg-white/10'
                  }`}
                >
                  <span className="truncate">{p.name}</span>
                  {p.id === pads.chosen && <span className="shrink-0 text-[12px] text-accent-300">Playing</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {conflict && (
        <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
          <div role="alertdialog" aria-modal="true" aria-labelledby="save-conflict" className="w-full max-w-sm rounded-2xl bg-ink-900 p-5 text-left shadow-2xl ring-1 ring-white/10">
            <p id="save-conflict" className="text-[15px] font-semibold text-white">This game was saved on another device.</p>
            <p className="mt-1 text-[13px] text-ink-300">
              Use that save to carry on from there (the game restarts), or keep this one and it replaces the other on Finesse. The one you don’t pick is kept on this device.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                autoFocus
                onClick={() => conflict.choose('theirs')}
                className="rounded-xl bg-accent-fill px-4 py-3 text-left text-[14px] font-semibold text-white hover:brightness-110"
              >
                Use that save
              </button>
              <button
                onClick={() => conflict.choose('mine')}
                className="rounded-xl bg-white/[0.04] px-4 py-3 text-left text-[14px] font-medium text-ink-200 ring-1 ring-white/10 hover:bg-white/10"
              >
                Keep this one
              </button>
            </div>
          </div>
        </div>
      )}

      {error ? (
        <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-ink-200">{error}</p>
          <button onClick={() => void exitToGames()} className="rounded-lg bg-accent-fill hover:brightness-110 px-4 py-2 text-sm font-semibold text-white transition-colors">
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
