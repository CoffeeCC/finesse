import { useEffect, useState, type FormEvent } from 'react'
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

const DEFAULT_SERVER = window.location.hostname.endsWith('.ts.net')
  ? `https://${window.location.hostname}:10000`
  : 'http://192.168.1.121:8096'

type Step = 'welcome' | 'rules' | 'create' | 'success'

const STEPS: Step[] = ['welcome', 'rules', 'create']

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
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  const server = localStorage.getItem('finesse.lastServer') ?? DEFAULT_SERVER

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
    if (password !== confirm) {
      setFormError('Passwords don’t match')
      return
    }
    setBusy(true)
    setFormError('')
    try {
      await joinInvite({
        code: invite.code,
        username: username.trim(),
        password,
      })
      setStep('success')
      localStorage.setItem('finesse.lastServer', server)
      await login(server, username.trim(), password)
      navigate('/', { replace: true })
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create account')
      setBusy(false)
      setStep('create')
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
            className="rounded-2xl bg-ink-900/80 backdrop-blur-xl border border-white/10 p-8 shadow-2xl"
          >
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              <FinesseWordmark />
            </h1>
            <p className="mt-2 text-sm text-ink-400">Enter the invite code you were sent.</p>
            <label className={authLabelClass}>Invite code</label>
            <input
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
          <div className="rounded-2xl bg-ink-900/80 backdrop-blur-xl border border-white/10 p-8 shadow-2xl text-center">
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
          <div className="rounded-2xl bg-ink-900/80 backdrop-blur-xl border border-white/10 p-8 shadow-2xl">
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
                {invite.libraries.length > 0 && (
                  <p className="mt-4 text-xs text-ink-400">
                    Includes{' '}
                    <span className="text-ink-200">
                      {invite.libraries.slice(0, 4).join(' · ')}
                      {invite.libraries.length > 4 ? '…' : ''}
                    </span>
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

                <label className={authLabelClass}>Username</label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={authInputClass}
                  autoComplete="username"
                  autoFocus
                  required
                />

                <label className={authLabelClass}>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={authInputClass}
                  autoComplete="new-password"
                  required
                />
                <p className="mt-1 text-[11px] text-ink-400">
                  At least 8 characters, with upper, lower, and a number.
                </p>

                <label className={authLabelClass}>Confirm password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className={authInputClass}
                  autoComplete="new-password"
                  required
                />

                {formError && <p className="mt-3 text-sm text-red-400">{formError}</p>}

                <button
                  type="submit"
                  disabled={busy || !username.trim() || !password}
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
          <div className="rounded-2xl bg-ink-900/80 backdrop-blur-xl border border-white/10 p-10 shadow-2xl text-center">
            <div className="h-14 w-14 mx-auto rounded-2xl bg-accent-500/20 border border-accent-400/40 flex items-center justify-center">
              <span className="text-2xl text-accent-300">✓</span>
            </div>
            <h2 className="mt-5 text-2xl font-semibold text-white">You&rsquo;re in</h2>
            <p className="mt-2 text-sm text-ink-400">Signing you into Finesse…</p>
          </div>
        )}
      </div>
    </AuthShell>
  )
}
