import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { getPublicUsers, publicUserImageUrl, type JfPublicUser } from '../api/client'
import AuthShell, {
  FinesseWordmark,
  authInputClass,
  authLabelClass,
  authPrimaryBtn,
} from '../components/AuthShell'

import { CONTENT_BASE } from '../lib/contentOrigin'
import { bundledJellyfin, discover, legacyJellyfinGuess } from '../lib/finesseServer'

/** A remembered Jellyfin address on the same host as a Finesse that now
 *  serves Jellyfin itself is the old direct port — switch to the bundled one. */
function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).hostname === new URL(b).hostname
  } catch {
    return false
  }
}

type Mode = 'profiles' | 'password' | 'manual'
type Conn = 'checking' | 'ok' | 'error'

const LAST_USER = 'finesse.lastUser'

/** Each person gets their own colour (stable per name), not the same accent tile. */
const profileHue = (name: string) => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 11)

/** Where the server was reached: a tailnet address, the home network, or elsewhere. */
function connectionLabel(server: string): string {
  try {
    const host = new URL(server).hostname
    if (host.endsWith('.ts.net')) return 'Connected · Tailscale'
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|localhost|127\.)/.test(host) || host.endsWith('.local')) return 'Connected · Home network'
  } catch {
    /* fall through */
  }
  return 'Connected'
}

function ConnectionPill({ conn, server, onRetry }: { conn: Conn; server: string; onRetry: () => void }) {
  const dot = conn === 'ok' ? 'bg-emerald-400' : conn === 'error' ? 'bg-red-400' : 'bg-ink-400 animate-pulse'
  return (
    <div className="absolute top-5 right-5 z-10 flex items-center gap-2">
      <span className="inline-flex items-center gap-2 h-9 rounded-full bg-ink-900/80 backdrop-blur border border-white/10 px-3.5 text-[13px] text-ink-200">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {conn === 'ok' ? connectionLabel(server) : conn === 'error' ? "Can't reach your server" : 'Connecting…'}
      </span>
      {conn === 'error' && (
        <button
          type="button"
          onClick={onRetry}
          className="h-9 rounded-full bg-white px-3.5 text-[13px] font-semibold text-ink-950 hover:bg-ink-200 transition-colors"
        >
          Try again
        </button>
      )}
    </div>
  )
}

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [server, setServer] = useState(localStorage.getItem('finesse.lastServer') ?? '')
  const [serverReady, setServerReady] = useState(false)
  /** Finesse serves Jellyfin itself: no need to show (or type) a server address. */
  const [bundled, setBundled] = useState(false)
  const [redirect, setRedirect] = useState<string | null>(null)
  const [users, setUsers] = useState<JfPublicUser[] | null>(null)
  const [mode, setMode] = useState<Mode>('profiles')
  const [selected, setSelected] = useState<JfPublicUser | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [conn, setConn] = useState<Conn>('checking')
  const [attempt, setAttempt] = useState(0)
  const lastUser = localStorage.getItem(LAST_USER)

  // Which server? Ask Finesse first (it may serve Jellyfin itself, or need setting up).
  useEffect(() => {
    let live = true
    ;(async () => {
      const stored = localStorage.getItem('finesse.lastServer')
      if (__WEBOS__ && !CONTENT_BASE && !stored) {
        setRedirect('/connect')
        return
      }
      const info = await discover()
      if (!live) return
      if (info?.setup.needsCode) {
        setRedirect('/setup')
        return
      }
      const bundled = bundledJellyfin(info)
      const next = stored && !(bundled && sameHost(stored, bundled) && stored !== bundled) ? stored : bundled || stored || legacyJellyfinGuess()
      setServer(next)
      setBundled(Boolean(bundled && next === bundled))
      setServerReady(true)
    })()
    return () => {
      live = false
    }
  }, [])

  // Who's watching? — fetch visible accounts for the picker
  useEffect(() => {
    if (!serverReady) return
    let cancelled = false
    setConn('checking')
    if (!server) {
      setConn('error')
      setUsers([])
      setMode('manual')
      return
    }
    getPublicUsers(server).then(
      (u) => {
        if (!cancelled) {
          setConn('ok')
          // Last-used profile first, so OK / Enter picks it straight away.
          setUsers([...u].sort((a, b) => Number(b.Name === lastUser) - Number(a.Name === lastUser)))
          if (u.length === 0) setMode('manual')
        }
      },
      () => {
        if (!cancelled) {
          setConn('error')
          setUsers([])
          setMode('manual')
        }
      },
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, serverReady])

  const doLogin = async (name: string, pw: string) => {
    setBusy(true)
    setError('')
    try {
      await login(server, name.trim(), pw.trim())
      localStorage.setItem('finesse.lastServer', server)
      localStorage.setItem(LAST_USER, name.trim())
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

  if (redirect) return <Navigate to={redirect} replace />

  return (
    <AuthShell server={server}>
      <ConnectionPill conn={conn} server={server} onRetry={() => setAttempt((n) => n + 1)} />

      {/* Who's watching? */}
      {mode === 'profiles' && (
        <div className="card-in relative text-center px-6">
          <h1 className="font-display text-5xl sm:text-7xl leading-none text-white mb-3">
            Who&rsquo;s watching?
          </h1>
          <p className="text-sm text-ink-400 mb-10">
            <FinesseWordmark />
          </p>

          {users === null ? (
            <div className="flex gap-8 justify-center">
              {[0, 1, 2].map((i) => (
                <div key={i} className="w-32">
                  <div className="h-32 w-32 rounded-[1.75rem] shimmer" />
                  <div className="h-4 w-16 mx-auto mt-3 rounded shimmer" />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-8 justify-center max-w-3xl">
              {users.map((u, i) => {
                const hue = profileHue(u.Name)
                const last = u.Name === lastUser
                return (
                  <button
                    key={u.Id}
                    onClick={() => pickUser(u)}
                    disabled={busy}
                    autoFocus={i === 0}
                    aria-label={`Watch as ${u.Name}`}
                    className="own-focus group w-32 outline-none disabled:opacity-50"
                  >
                    <div
                      className={`h-32 w-32 rounded-[1.75rem] overflow-hidden ring-offset-4 ring-offset-ink-950 transition-all duration-200 group-hover:scale-105 group-hover:ring-4 group-hover:ring-white group-focus-visible:ring-4 group-focus-visible:ring-white shadow-xl shadow-black/40 flex items-center justify-center ${
                        last ? 'ring-2 ring-white/60' : ''
                      }`}
                      style={{ background: `hsl(${hue}, 42%, 38%)` }}
                    >
                      {u.PrimaryImageTag ? (
                        <img
                          src={publicUserImageUrl(server, u.Id, u.PrimaryImageTag)}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-5xl font-semibold text-white">{u.Name.charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <p className="mt-3 text-base font-semibold text-ink-200 group-hover:text-white transition-colors truncate">
                      {u.Name}
                    </p>
                    <p className="h-4 text-xs text-ink-400">{last ? 'Last used' : u.HasPassword ? 'Password' : ''}</p>
                  </button>
                )
              })}
            </div>
          )}

          {error && <p className="mt-6 text-sm text-red-400">{error}</p>}

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/invite"
              className="inline-flex h-11 items-center rounded-lg bg-white/10 border border-white/15 px-5 text-sm font-semibold text-white hover:bg-white/15 transition-colors"
            >
              Have an invite code?
            </Link>
            <button
              onClick={() => setMode('manual')}
              className="inline-flex h-11 items-center rounded-lg px-4 text-sm font-medium text-ink-300 hover:text-white transition-colors"
            >
              Use another account or server
            </button>
          </div>
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
            aria-label={`Password for ${selected.Name}`}
            autoFocus
            autoComplete="current-password"
            className="w-full rounded-lg bg-ink-800/90 border border-white/10 px-4 py-2.5 text-sm text-center outline-none focus:border-accent-500 transition-colors"
          />
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="mt-4 w-full rounded-lg bg-accent-fill hover:brightness-110 disabled:opacity-50 py-2.5 text-sm font-semibold text-white active:scale-[0.98] transition-all"
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
            <FinesseWordmark />
          </h1>
          <p className="mt-1 text-sm text-ink-400">Sign in to your media server</p>

          {!bundled && (
            <>
              <label className={authLabelClass} htmlFor="login-server">Server</label>
              <input
                id="login-server"
                value={server}
                onChange={(e) => setServer(e.target.value)}
                className={authInputClass}
                placeholder="https://jellyfin.example.com"
                autoComplete="url"
              />
            </>
          )}

          <label className={authLabelClass} htmlFor="login-username">Username</label>
          <input
            id="login-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={authInputClass}
            autoComplete="username"
            autoFocus
          />

          <label className={authLabelClass} htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInputClass}
            autoComplete="current-password"
          />

          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

          <button type="submit" disabled={busy || !username} className={`${authPrimaryBtn} mt-6`}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <Link
            to="/invite"
            className="mt-4 block text-center text-xs text-ink-400 hover:text-accent-300 transition-colors"
          >
            Have an invite code?
          </Link>
          {bundled && (
            <button type="button" onClick={() => setBundled(false)} className="mt-2 w-full text-xs text-ink-400 hover:text-white transition-colors">
              Sign in to a different server
            </button>
          )}

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
    </AuthShell>
  )
}
