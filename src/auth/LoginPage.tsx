import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { getPublicUsers, publicUserImageUrl, splashscreenUrl, type JfPublicUser } from '../api/client'

// On the tailnet funnel the LAN IP is unreachable (and mixed-content blocked),
// so default to Jellyfin's own funnel on :10000 of the same host instead.
const DEFAULT_SERVER = window.location.hostname.endsWith('.ts.net')
  ? `https://${window.location.hostname}:10000`
  : 'http://192.168.1.121:8096'

type Mode = 'profiles' | 'password' | 'manual'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [server, setServer] = useState(localStorage.getItem('finesse.lastServer') ?? DEFAULT_SERVER)
  const [users, setUsers] = useState<JfPublicUser[] | null>(null)
  const [mode, setMode] = useState<Mode>('profiles')
  const [selected, setSelected] = useState<JfPublicUser | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Who's watching? — fetch visible accounts for the picker
  useEffect(() => {
    let cancelled = false
    getPublicUsers(server).then(
      (u) => {
        if (!cancelled) {
          setUsers(u)
          if (u.length === 0) setMode('manual')
        }
      },
      () => {
        if (!cancelled) {
          setUsers([])
          setMode('manual')
        }
      },
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doLogin = async (name: string, pw: string) => {
    setBusy(true)
    setError('')
    try {
      await login(server, name.trim(), pw.trim())
      localStorage.setItem('finesse.lastServer', server)
      navigate('/', { replace: true })
    } catch (err) {
      setError(
        err instanceof Error && err.message.includes('401')
          ? 'Wrong password'
          : 'Could not reach the server',
      )
      setBusy(false)
    }
  }

  const pickUser = (u: JfPublicUser) => {
    setSelected(u)
    setError('')
    if (u.HasPassword) {
      setPassword('')
      setMode('password')
    } else {
      doLogin(u.Name, '')
    }
  }

  const submitManual = (e: FormEvent) => {
    e.preventDefault()
    doLogin(username, password)
  }

  const submitPassword = (e: FormEvent) => {
    e.preventDefault()
    if (selected) doLogin(selected.Name, password)
  }

  const inputClass =
    'mt-1 w-full rounded-lg bg-ink-800 border border-white/10 px-3 py-2 text-sm outline-none focus:border-accent-500 transition-colors'
  const labelClass = 'mt-4 block text-xs font-medium uppercase tracking-wider text-ink-400'

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden">
      <img
        src={splashscreenUrl(server || DEFAULT_SERVER)}
        alt=""
        className="slowzoom absolute inset-0 h-full w-full object-cover opacity-40 blur-sm"
        onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-ink-950/70 via-ink-950/40 to-ink-950" />

      {/* Who's watching? */}
      {mode === 'profiles' && (
        <div className="card-in relative text-center px-6">
          <h1 className="text-4xl font-semibold tracking-tight text-white mb-2">
            Who&rsquo;s watching?
          </h1>
          <p className="text-sm text-ink-400 mb-10">
            Finesse<span className="text-accent-400">.</span> · {server.replace(/^https?:\/\//, '')}
          </p>

          {users === null ? (
            <div className="flex gap-6 justify-center">
              {[0, 1].map((i) => (
                <div key={i} className="w-28">
                  <div className="h-28 w-28 rounded-2xl shimmer" />
                  <div className="h-4 w-16 mx-auto mt-3 rounded shimmer" />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-6 justify-center max-w-2xl">
              {users.map((u) => (
                <button
                  key={u.Id}
                  onClick={() => pickUser(u)}
                  disabled={busy}
                  className="group w-28 outline-none disabled:opacity-50"
                >
                  <div className="h-28 w-28 rounded-2xl overflow-hidden ring-2 ring-transparent group-hover:ring-accent-400 group-focus-visible:ring-accent-400 group-hover:scale-105 transition-all duration-200 shadow-xl shadow-black/40 bg-gradient-to-br from-accent-600 to-accent-400 flex items-center justify-center">
                    {u.PrimaryImageTag ? (
                      <img
                        src={publicUserImageUrl(server, u.Id, u.PrimaryImageTag)}
                        alt={u.Name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-4xl font-bold text-white">
                        {u.Name.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <p className="mt-3 text-sm font-medium text-ink-200 group-hover:text-white transition-colors truncate">
                    {u.Name}
                  </p>
                </button>
              ))}
            </div>
          )}

          {error && <p className="mt-6 text-sm text-red-400">{error}</p>}

          <button
            onClick={() => setMode('manual')}
            className="mt-10 text-xs text-ink-400 hover:text-white transition-colors underline underline-offset-4"
          >
            Use another account or server
          </button>
        </div>
      )}

      {/* Password for picked profile */}
      {mode === 'password' && selected && (
        <form
          onSubmit={submitPassword}
          className="card-in relative w-full max-w-xs mx-4 text-center"
        >
          <div className="h-24 w-24 mx-auto rounded-2xl overflow-hidden shadow-xl shadow-black/40 bg-gradient-to-br from-accent-600 to-accent-400 flex items-center justify-center mb-4">
            {selected.PrimaryImageTag ? (
              <img
                src={publicUserImageUrl(server, selected.Id, selected.PrimaryImageTag)}
                alt={selected.Name}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-3xl font-bold text-white">
                {selected.Name.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <p className="text-lg font-semibold text-white mb-4">{selected.Name}</p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            autoComplete="current-password"
            className="w-full rounded-lg bg-ink-800/90 border border-white/10 px-4 py-2.5 text-sm text-center outline-none focus:border-accent-500 transition-colors"
          />
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="mt-4 w-full rounded-lg bg-accent-500 hover:bg-accent-400 disabled:opacity-50 py-2.5 text-sm font-semibold text-white active:scale-[0.98] transition-all"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('profiles')
              setError('')
            }}
            className="mt-4 text-xs text-ink-400 hover:text-white transition-colors"
          >
            ← Back
          </button>
        </form>
      )}

      {/* Manual server/username form */}
      {mode === 'manual' && (
        <form
          onSubmit={submitManual}
          className="card-in relative w-full max-w-sm mx-4 rounded-2xl bg-ink-900/80 backdrop-blur-xl border border-white/10 p-8 shadow-2xl"
        >
          <h1 className="text-3xl font-semibold tracking-tight text-white">
            Finesse<span className="text-accent-400">.</span>
          </h1>
          <p className="mt-1 text-sm text-ink-400">Sign in to your Jellyfin server</p>

          <label className={labelClass}>Server</label>
          <input
            value={server}
            onChange={(e) => setServer(e.target.value)}
            className={inputClass}
            placeholder={DEFAULT_SERVER}
            autoComplete="url"
          />

          <label className={labelClass}>Username</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={inputClass}
            autoComplete="username"
            autoFocus
          />

          <label className={labelClass}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            autoComplete="current-password"
          />

          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={busy || !username}
            className="mt-6 w-full rounded-lg bg-accent-500 hover:bg-accent-400 disabled:opacity-50 disabled:hover:bg-accent-500 py-2.5 text-sm font-semibold text-white active:scale-[0.98] transition-all"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          {(users?.length ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => {
                setMode('profiles')
                setError('')
              }}
              className="mt-4 w-full text-xs text-ink-400 hover:text-white transition-colors"
            >
              ← Back to profiles
            </button>
          )}
        </form>
      )}
    </div>
  )
}
