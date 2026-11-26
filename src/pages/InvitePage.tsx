import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import AuthShell, {
  FinesseWordmark,
  StepDots,
  authInputClass,
  authLabelClass,
  authPrimaryBtn,
} from '../components/AuthShell'
import { getInvite, joinInvite, InviteError, type InvitePublic } from '../api/invite'
import { copyText } from '../lib/clipboard'
import { bundledJellyfin, finesseRoot, legacyJellyfinGuess, useFinesse } from '../lib/finesseServer'

type Step = 'welcome' | 'rules' | 'create' | 'success'

const STEPS: Step[] = ['welcome', 'rules', 'create']

function isStrongPassword(pw: string): boolean {
  return pw.length >= 8 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw)
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-accent-300" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M3.6 9h16.8M3.6 15h16.8M12 3a13.5 13.5 0 0 0 0 18M12 3a13.5 13.5 0 0 1 0 18" />
    </svg>
  )
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-accent-300" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
    </svg>
  )
}

function TvIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-accent-300" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-accent-300" fill="currentColor" aria-hidden>
      <path d="M7.5 5.6v12.8a1 1 0 0 0 1.5.86l10.2-6.4a1 1 0 0 0 0-1.72L9 4.74a1 1 0 0 0-1.5.86Z" />
    </svg>
  )
}

function CopyRow({ icon, label, url, note }: { icon: ReactNode; label: string; url: string; note?: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const handleCopy = async () => {
    const ok = await copyText(url)
    setStatus(ok ? 'copied' : 'failed')
    window.setTimeout(() => setStatus('idle'), 2000)
  }
  return (
    <div className="mt-3 rounded-xl bg-ink-800/60 border border-white/10 p-3 text-left">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-200">
          {icon}
          {label}
        </span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className={`shrink-0 text-[11px] px-2.5 py-0.5 rounded-full transition-colors ${
            status === 'copied'
              ? 'bg-emerald-500/20 text-emerald-300'
              : status === 'failed'
                ? 'bg-red-500/20 text-red-200'
                : 'bg-white/10 text-ink-300 hover:text-white hover:bg-white/20'
          }`}
        >
          {status === 'copied' ? 'Copied!' : status === 'failed' ? 'Select & copy' : 'Copy'}
        </button>
      </div>
      <p className="mt-1 text-[11px] font-mono text-accent-300 break-all select-all">{url}</p>
      {note && <p className="mt-1 text-[11px] text-ink-400">{note}</p>}
    </div>
  )
}

export default function InvitePage() {
  const { code: codeParam } = useParams()
  const navigate = useNavigate()
  const { login } = useAuth()

  const [codeInput, setCodeInput] = useState((codeParam || '').toUpperCase())
  const [invite, setInvite] = useState<InvitePublic | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(Boolean(codeParam))
  const [step, setStep] = useState<Step>('welcome')

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [formError, setFormError] = useState('')
  const [loginError, setLoginError] = useState('')
  const [busy, setBusy] = useState(false)

  // Where this Finesse is: the address in use now, plus its public one if it has it.
  const { info: finesse } = useFinesse()
  const server = bundledJellyfin(finesse) ?? localStorage.getItem('finesse.lastServer') ?? legacyJellyfinGuess()
  const here = `${finesseRoot()}/finesse/`
  const publicApp = finesse?.publicUrl ? `${finesse.publicUrl.replace(/\/+$/, '')}/finesse/` : null
  const publicJellyfin = finesse?.publicUrl && finesse.jellyfin ? `${finesse.publicUrl.replace(/\/+$/, '')}${finesse.jellyfin.path}` : null

  const load = async (code: string) => {
    setLoading(true)
    setLoadError('')
    setInvite(null)
    try {
      const inv = await getInvite(code.trim())
      if (inv.status === 'used') {
        setLoadError('This invite has already been used.')
      } else if (inv.status === 'expired') {
        setLoadError('This invite has expired.')
      } else {
        setInvite(inv)
        setCodeInput(inv.code)
        setStep('welcome')
      }
    } catch (e) {
      setLoadError(
        e instanceof InviteError && e.status === 404
          ? 'We couldn’t find that invite.'
          : e instanceof Error
            ? e.message
            : 'Could not load invite',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (codeParam) void load(codeParam)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeParam])

  const stepIndex = Math.max(0, STEPS.indexOf(step === 'success' ? 'create' : step))
  const passwordValid = isStrongPassword(password)
  const passwordsMatch = confirm.length > 0 && password === confirm
  const expiresLabel = invite?.expires_at
    ? new Date(invite.expires_at).toLocaleDateString(undefined, { dateStyle: 'medium' })
    : null

  const submitCode = (e: FormEvent) => {
    e.preventDefault()
    if (!codeInput.trim()) return
    navigate(`/invite/${encodeURIComponent(codeInput.trim().toUpperCase())}`, {
      replace: true,
    })
  }

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (!invite) return
    if (!passwordValid) {
      setFormError('Password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a number.')
      return
    }
    if (!confirm || password !== confirm) {
      setFormError('Passwords don’t match')
      return
    }
    setBusy(true)
    setFormError('')
    setLoginError('')
    try {
      await joinInvite({
        code: invite.code,
        username: username.trim(),
        password,
      })
      // Account exists — show the "how to watch" screen before signing in, so
      // new members leave with the addresses they'll need away from this house.
      localStorage.setItem('finesse.lastServer', server)
      setBusy(false)
      setStep('success')
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create account')
      setBusy(false)
      setStep('create')
    }
  }

  const startWatching = async () => {
    setBusy(true)
    setLoginError('')
    try {
      await login(server, username.trim(), password)
      navigate('/', { replace: true })
    } catch {
      setBusy(false)
      setLoginError('Your account is ready, but automatic sign-in didn’t go through. Sign in manually with your new username and password.')
    }
  }

  return (
    <AuthShell server={server}>
      <div className="card-in relative w-full max-w-md mx-4">
        {loading && (
          <div className="text-center py-16">
            <div className="h-10 w-10 mx-auto rounded-full border-2 border-accent-400/30 border-t-accent-400 animate-spin" />
            <p className="mt-4 text-sm text-ink-400">Checking invite…</p>
          </div>
        )}

        {!loading && !invite && !codeParam && (
          <form
            onSubmit={submitCode}
            className="rounded-2xl bg-ink-900/90 border border-white/10 p-8 shadow-2xl"
          >
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              <FinesseWordmark />
            </h1>
            <p className="mt-2 text-sm text-ink-400">Enter the invite code you were sent.</p>
            <label className={authLabelClass} htmlFor="invite-code">Invite code</label>
            <input
              id="invite-code"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              className={authInputClass}
              autoFocus
              autoComplete="off"
              placeholder="e.g. CHRISSY"
            />
            {loadError && <p className="mt-3 text-sm text-red-400">{loadError}</p>}
            <button type="submit" disabled={!codeInput.trim()} className={`${authPrimaryBtn} mt-6`}>
              Continue
            </button>
            <Link
              to="/login"
              className="mt-4 block text-center text-xs text-ink-400 hover:text-white transition-colors"
            >
              Already have an account? Sign in
            </Link>
          </form>
        )}

        {!loading && loadError && codeParam && (
          <div className="rounded-2xl bg-ink-900/90 border border-white/10 p-8 shadow-2xl text-center">
            <h1 className="text-2xl font-semibold text-white">
              <FinesseWordmark />
            </h1>
            <p className="mt-4 text-sm text-red-400">{loadError}</p>
            <Link
              to="/invite"
              className="mt-6 inline-block text-sm text-accent-400 hover:text-accent-300"
            >
              Try another code
            </Link>
            <span className="mx-2 text-ink-700">·</span>
            <Link to="/login" className="inline-block text-sm text-ink-400 hover:text-white">
              Sign in
            </Link>
          </div>
        )}

        {!loading && invite && step !== 'success' && (
          <div className="rounded-2xl bg-ink-900/90 border border-white/10 p-8 shadow-2xl">
            <StepDots step={stepIndex} total={3} />

            {step === 'welcome' && (
              <div className="text-center">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-accent-400 mb-3">
                  You&rsquo;re invited
                </p>
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">
                  Welcome to <FinesseWordmark />
                </h1>
                <p className="mt-3 text-sm text-ink-400 leading-relaxed">
                  A private media library — movies, shows, and more — in a cinematic app built for
                  the living room and the phone.
                </p>
                {invite.label && (
                  <p className="mt-3 inline-block rounded-full border border-white/10 bg-white/[0.04] px-3 py-0.5 text-xs text-ink-200">
                    {invite.label} invite
                  </p>
                )}
                {invite.libraries.length > 0 && (
                  <p className="mt-4 text-xs text-ink-400 leading-relaxed">
                    Includes{' '}
                    <span className="text-ink-200">
                      {invite.libraries.join(' · ')}
                    </span>
                  </p>
                )}
                {expiresLabel && (
                  <p className="mt-1.5 text-[11.5px] text-ink-500">
                    Valid until {expiresLabel}
                  </p>
                )}
                <button type="button" onClick={() => setStep('rules')} className={`${authPrimaryBtn} mt-8`}>
                  Continue
                </button>
              </div>
            )}

            {step === 'rules' && (
              <div>
                <h2 className="text-xl font-semibold text-white text-center">A few ground rules</h2>
                <ul className="mt-6 space-y-3 text-sm text-ink-300">
                  <li className="flex gap-3">
                    <span className="text-accent-400 shrink-0">01</span>
                    <span>Keep your password private — each person gets their own invite.</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="text-accent-400 shrink-0">02</span>
                    <span>Be kind to the bandwidth when others might be watching.</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="text-accent-400 shrink-0">03</span>
                    <span>Missing a title? Use Request inside Finesse after you join.</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="text-accent-400 shrink-0">04</span>
                    <span>This is a private server for invited people only.</span>
                  </li>
                </ul>
                <p className="mt-6 text-xs text-ink-400 text-center">
                  Next you&rsquo;ll create your account. You don&rsquo;t have access yet.
                </p>
                <button
                  type="button"
                  onClick={() => setStep('create')}
                  className={`${authPrimaryBtn} mt-6`}
                >
                  Create my account
                </button>
                <button
                  type="button"
                  onClick={() => setStep('welcome')}
                  className="mt-4 w-full text-xs text-ink-400 hover:text-white transition-colors"
                >
                  ← Back
                </button>
              </div>
            )}

            {step === 'create' && (
              <form onSubmit={submitCreate}>
                <h2 className="text-xl font-semibold text-white text-center">Create your account</h2>
                <p className="mt-1 text-center text-xs text-ink-400">
                  Invite <span className="text-ink-200 font-mono">{invite.code}</span>
                </p>

                <label className={authLabelClass} htmlFor="invite-username">Username</label>
                <input
                  id="invite-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={authInputClass}
                  autoComplete="username"
                  autoFocus
                  required
                />

                <label className={authLabelClass} htmlFor="invite-password">Password</label>
                <div className="relative">
                  <input
                    id="invite-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`${authInputClass} pr-16`}
                    autoComplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-medium text-ink-400 hover:bg-white/10 hover:text-white transition-colors"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <p className={`mt-1 text-[11px] ${password && !passwordValid ? 'text-amber-300' : password && passwordValid ? 'text-emerald-300' : 'text-ink-400'}`}>
                  At least 8 characters, with upper, lower, and a number.
                </p>

                <label className={authLabelClass} htmlFor="invite-confirm">Confirm password</label>
                <input
                  id="invite-confirm"
                  type={showPassword ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className={authInputClass}
                  autoComplete="new-password"
                  required
                />
                {confirm && password !== confirm && (
                  <p className="mt-1 text-[11px] text-amber-300">Passwords don’t match yet.</p>
                )}

                {formError && <p className="mt-3 text-sm text-red-400">{formError}</p>}

                <button
                  type="submit"
                  disabled={busy || !username.trim() || !passwordValid || !passwordsMatch}
                  className={`${authPrimaryBtn} mt-6`}
                >
                  {busy ? 'Creating…' : 'Join Finesse'}
                </button>
                <button
                  type="button"
                  onClick={() => setStep('rules')}
                  disabled={busy}
                  className="mt-4 w-full text-xs text-ink-400 hover:text-white transition-colors"
                >
                  ← Back
                </button>
              </form>
            )}
          </div>
        )}

        {!loading && invite && step === 'success' && (
          <div className="rounded-2xl bg-ink-900/90 border border-white/10 p-8 shadow-2xl text-center">
            <div className="h-12 w-12 mx-auto rounded-2xl bg-accent-500/20 border border-accent-400/40 flex items-center justify-center">
              <span className="text-xl text-accent-300">✓</span>
            </div>
            <h2 className="mt-4 text-2xl font-semibold text-white">You&rsquo;re in</h2>
            <p className="mt-1 text-sm text-ink-400">
              Account <span className="text-ink-200 font-medium">{username.trim()}</span> is ready.
              Save these before you go —
            </p>

            {publicApp && publicApp !== here && (
              <CopyRow
                icon={<GlobeIcon />}
                label="Watch from anywhere"
                url={publicApp}
                note="Works on any phone, tablet, or computer — bookmark it. On a phone, open it in the browser and use “Add to Home Screen” to install it like an app."
              />
            )}
            <CopyRow
              icon={publicApp && publicApp !== here ? <HomeIcon /> : <TvIcon />}
              label={publicApp && publicApp !== here ? 'At home (faster)' : 'Your Finesse address'}
              url={here}
              note={publicApp && publicApp !== here ? 'Same app, local — use this one when you’re here.' : 'Bookmark it. On a phone, use “Add to Home Screen” to install it like an app.'}
            />
            <CopyRow
              icon={<PlayIcon />}
              label="Prefer the official Jellyfin app?"
              url={publicJellyfin ?? server}
              note="Install “Jellyfin” from your app store, add this as the server address, and sign in with the same username and password."
            />

            {loginError && (
              <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-2.5 text-left text-xs leading-relaxed text-amber-100">
                <p>{loginError}</p>
                <Link to="/login" className="mt-2 inline-block font-semibold text-white underline underline-offset-2 hover:text-accent-200">
                  Go to Sign in
                </Link>
              </div>
            )}

            <button type="button" onClick={() => void startWatching()} disabled={busy} className={`${authPrimaryBtn} mt-6`}>
              {busy ? 'Signing in…' : 'Start watching'}
            </button>
          </div>
        )}
      </div>
    </AuthShell>
  )
}
