import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { splashscreenUrl } from '../api/client'

const DEFAULT_SERVER = 'http://192.168.1.121:8096'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [server, setServer] = useState(localStorage.getItem('finesse.lastServer') ?? DEFAULT_SERVER)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(server, username, password)
      localStorage.setItem('finesse.lastServer', server)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error && err.message.includes('401')
        ? 'Wrong username or password'
        : 'Could not reach the server')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden">
      <img
        src={splashscreenUrl(server || DEFAULT_SERVER)}
        alt=""
        className="slowzoom absolute inset-0 h-full w-full object-cover opacity-40 blur-sm"
        onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-ink-950/70 via-ink-950/40 to-ink-950" />

      <form
        onSubmit={submit}
        className="card-in relative w-full max-w-sm mx-4 rounded-2xl bg-ink-900/80 backdrop-blur-xl border border-white/10 p-8 shadow-2xl"
      >
        <h1 className="text-3xl font-semibold tracking-tight text-white">
          Finesse<span className="text-accent-400">.</span>
        </h1>
        <p className="mt-1 text-sm text-ink-400">Sign in to your Jellyfin server</p>

        <label className="mt-6 block text-xs font-medium uppercase tracking-wider text-ink-400">
          Server
        </label>
        <input
          value={server}
          onChange={(e) => setServer(e.target.value)}
          className="mt-1 w-full rounded-lg bg-ink-800 border border-white/10 px-3 py-2 text-sm outline-none focus:border-accent-500 transition-colors"
          placeholder="http://192.168.1.121:8096"
          autoComplete="url"
        />

        <label className="mt-4 block text-xs font-medium uppercase tracking-wider text-ink-400">
          Username
        </label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="mt-1 w-full rounded-lg bg-ink-800 border border-white/10 px-3 py-2 text-sm outline-none focus:border-accent-500 transition-colors"
          autoComplete="username"
          autoFocus
        />

        <label className="mt-4 block text-xs font-medium uppercase tracking-wider text-ink-400">
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg bg-ink-800 border border-white/10 px-3 py-2 text-sm outline-none focus:border-accent-500 transition-colors"
          autoComplete="current-password"
        />

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={busy || !username}
          className="mt-6 w-full rounded-lg bg-accent-500 hover:bg-accent-400 disabled:opacity-50 disabled:hover:bg-accent-500 py-2.5 text-sm font-semibold text-white transition-colors"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
