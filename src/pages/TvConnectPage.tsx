// First run on a TV app: which Finesse server should it use? The address is
// shown on the server's setup-complete screen and in Settings → Server.

import { useState, type FormEvent } from 'react'
import AuthShell, { FinesseWordmark, authPrimaryBtn } from '../components/AuthShell'
import { setContentOrigin } from '../lib/contentOrigin'
import { findFinesse } from '../lib/finesseServer'

export default function TvConnectPage() {
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const connect = async (e: FormEvent) => {
    e.preventDefault()
    if (!address.trim()) return
    setBusy(true)
    setError('')
    const found = await findFinesse(address)
    if (!found) {
      setBusy(false)
      setError(`Couldn’t find Finesse at “${address.trim()}”. Check the address, and that the TV is on the same network.`)
      return
    }
    setContentOrigin(found.base)
    // Everything that talks to the server reads the address at start-up.
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
          Enter the address of the computer running Finesse — for example <span className="text-ink-200">192.168.1.50:8080</span>. You’ll find it on the setup-complete screen or in Settings → Server.
        </p>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="192.168.1.50:8080"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          inputMode="url"
          className="mt-8 w-full h-16 rounded-2xl bg-ink-800/90 border border-white/15 px-5 text-center text-2xl text-white outline-none focus:border-accent-400"
        />
        {error && <p className="mt-4 text-base text-red-300">{error}</p>}
        <button type="submit" disabled={busy || !address.trim()} className={`${authPrimaryBtn} mt-6 h-14 text-lg`}>
          {busy ? 'Looking for Finesse…' : 'Connect'}
        </button>
      </form>
    </AuthShell>
  )
}
