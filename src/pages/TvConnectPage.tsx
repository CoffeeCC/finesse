// First run on a TV app: which Finesse server should it use? The address is
// shown on the server's setup-complete screen and in Settings → Other devices.

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import AuthShell, { FinesseWordmark, authPrimaryBtn } from '../components/AuthShell'
import { pushBackHandler } from '../lib/back'
import { CONTENT_BASE, setContentOrigin } from '../lib/contentOrigin'
import { findFinesse } from '../lib/finesseServer'

const PREV_ORIGIN_KEY = 'finesse.prevContentOrigin'

function readPrevOrigin(): string {
  if (CONTENT_BASE) return CONTENT_BASE
  try {
    return sessionStorage.getItem(PREV_ORIGIN_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Auto-strips whitespace and any trailing `/finesse/` so users pasting a full web URL connect cleanly. */
function cleanAddress(raw: string): string {
  return raw.trim().replace(/\/+$/, '').replace(/\/finesse$/i, '')
}

export default function TvConnectPage() {
  const [prevOrigin] = useState<string>(readPrevOrigin)
  const [address, setAddress] = useState(() =>
    prevOrigin ? cleanAddress(prevOrigin).replace(/^https?:\/\//i, '') : '',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const cancel = useCallback(() => {
    if (!prevOrigin || busy) return
    setContentOrigin(prevOrigin)
    try {
      sessionStorage.removeItem(PREV_ORIGIN_KEY)
    } catch {
      /* ignore */
    }
    window.history.replaceState(null, '', '#/')
    window.location.reload()
  }, [prevOrigin, busy])

  useEffect(() => {
    if (!prevOrigin) return
    return pushBackHandler(() => {
      cancel()
      return true
    })
  }, [prevOrigin, cancel])

  const connect = async (e: FormEvent) => {
    e.preventDefault()
    const cleaned = cleanAddress(address)
    if (!cleaned) return
    setAddress(cleaned)
    setBusy(true)
    setError('')
    const found = await findFinesse(cleaned)
    if (!found) {
      setBusy(false)
      setError(`Couldn’t find Finesse at “${cleaned}”. Check the address and port (for example 192.168.1.50:8080), and make sure this TV is on the same network.`)
      return
    }
    setContentOrigin(found.base)
    try {
      sessionStorage.removeItem(PREV_ORIGIN_KEY)
    } catch {
      /* ignore */
    }
    // Everything that talks to the server reads the address at start-up, so reload,
    // but not here: at #/connect the reload came back to this form. The start
    // (#/) goes on to the profiles (or Home, when already signed in).
    window.history.replaceState(null, '', '#/')
    window.location.reload()
  }

  return (
    <AuthShell>
      <form onSubmit={connect} className="card-in relative w-full max-w-xl mx-6 text-center">
        <h1 className="font-display text-6xl leading-none text-white">
          <FinesseWordmark />
        </h1>
        <p className="mt-6 text-2xl text-ink-200">Connect to your server</p>
        <p className="mt-3 text-base leading-relaxed text-ink-400">
          Enter your server’s IP address and port — for example <span className="text-ink-200 font-mono">192.168.1.50:8080</span> (without <span className="font-mono text-ink-300">/finesse/</span>). You’ll find it on the setup-complete screen or in Settings → Other devices.
        </p>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="192.168.1.50:8080 (IP:port or web address)"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          inputMode="url"
          className="mt-8 w-full h-16 rounded-2xl bg-ink-800/90 border border-white/15 px-5 text-center text-2xl text-white placeholder:text-ink-500 outline-none focus:border-accent-400"
        />
        {error && <p className="mt-4 text-base text-red-300">{error}</p>}
        <button type="submit" disabled={busy || !cleanAddress(address)} className={`${authPrimaryBtn} mt-6 h-14 text-lg`}>
          {busy ? 'Looking for Finesse…' : 'Connect'}
        </button>
        {prevOrigin && (
          <button
            type="button"
            disabled={busy}
            onClick={cancel}
            className="mt-3 w-full h-12 rounded-xl border border-white/15 bg-white/[0.06] text-base font-medium text-ink-200 hover:bg-white/10 hover:text-white disabled:opacity-50 transition-colors"
          >
            Cancel &amp; go back
          </button>
        )}
      </form>
    </AuthShell>
  )
}
