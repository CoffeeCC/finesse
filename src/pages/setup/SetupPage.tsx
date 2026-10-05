// First-run setup: from "Finesse is installed" to a working, wired media
// server. A step-by-step wizard (with live checks) that assembles the setup
// document, then a live "Building your server" screen while the server
// applies it, then sign-in.

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { ApiError, getSetupCode, setSetupCode, setupApi, type Problem, type RunStatus, type SetupInfo, type SystemItem } from '../../api/setup'
import { bundledJellyfin, discover, type FinesseInfo } from '../../lib/finesseServer'
import { DOCS_URL } from '../../lib/project'
import { FinesseWordmark } from '../../components/AuthShell'
import { clearDraft, fromDoc, loadDraft, newDraft, saveDraft, toDoc, type Draft } from './draft'
import {
  AccountStep,
  DownloadsStep,
  EmailStep,
  Icon,
  IndexersStep,
  LibrariesStep,
  MachineStep,
  QualityStep,
  RemoteStep,
  STEP_META,
  stepBlocker,
  UsenetStep,
  VpnStep,
  type StepId,
} from './steps'
import { Callout, GhostButton, PrimaryButton, Spinner, StatusDot } from './ui'
import { QUALITY_PRESETS } from './presets'
import { LoFinessaCard, LoFinessaToggle, useLofiWizard } from './LoFinessa'
import { finishLofi } from './lofi'

type Phase = 'loading' | 'wizard' | 'building' | 'done' | 'already'

const DOCS = `${DOCS_URL}/install.md`

export default function SetupPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { login, session } = useAuth()
  /** Changing a finished server from Settings: 'kept' = its last setup is stored (secrets stay on the server);
   *  'redo' = an older install with none, so everything is picked again. */
  const [change, setChange] = useState<null | 'kept' | 'redo'>(null)

  const [finesse, setFinesse] = useState<FinesseInfo | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [d, setDraft] = useState<Draft>(() => loadDraft() ?? newDraft())
  const [stepIdx, setStepIdx] = useState(0)
  const [code, setCode] = useState(() => (params.get('code') ?? getSetupCode()).toUpperCase())
  const [codeOk, setCodeOk] = useState(false)
  const [codeError, setCodeError] = useState('')
  const [codeBusy, setCodeBusy] = useState(false)
  const [info, setInfo] = useState<SetupInfo | null>(null)
  const [system, setSystem] = useState<{ items: SystemItem[]; ok: boolean } | null>(null)
  const [checking, setChecking] = useState(false)
  const [problems, setProblems] = useState<Problem[]>([])
  const [run, setRun] = useState<RunStatus | null>(null)
  const [applyError, setApplyError] = useState('')
  const contentRef = useRef<HTMLDivElement>(null)
  const changeRef = useRef(false)
  useLofiWizard(phase === 'wizard' || phase === 'building' || phase === 'done')

  const set = useCallback((fn: (x: Draft) => void) => {
    setDraft((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as Draft
      fn(next)
      if (!changeRef.current) saveDraft(next)
      return next
    })
  }, [])

  const steps = useMemo(() => {
    const s: StepId[] = change === 'kept' ? ['libraries', 'downloads'] : change === 'redo' ? ['account', 'libraries', 'downloads'] : ['welcome', 'machine', 'account', 'libraries', 'downloads']
    if (d.usenet) s.push('usenet')
    if (d.torrents) s.push('vpn')
    if (d.usenet || d.torrents) s.push('indexers', 'quality')
    s.push('remote', 'email', 'review')
    return s
  }, [d.usenet, d.torrents, change])
  const step = steps[Math.min(stepIdx, steps.length - 1)]!

  // ---------- boot: what state is the server in? ----------
  useEffect(() => {
    let live = true
    ;(async () => {
      const f = await discover({ force: true })
      if (!live) return
      setFinesse(f)
      if (!f) {
        setPhase('already') // not a Finesse server (older install): nothing to set up here
        return
      }
      if (f.setup.state === 'ready' && !getSetupCode()) {
        if (params.get('change') && session?.isAdmin) return void enterChange()
        setPhase('already')
        return
      }
      // A run in progress (page reloaded mid-build)? Jump to it.
      if (getSetupCode()) {
        const st = await setupApi.status().catch(() => null)
        if (!live) return
        if (st && (st.state === 'running' || (st.state === 'done' && f.setup.state === 'ready'))) {
          setRun(st)
          setPhase(st.state === 'done' ? 'done' : 'building')
          return
        }
      }
      setPhase(f.setup.state === 'ready' ? 'already' : 'wizard')
    })()
    return () => {
      live = false
    }
  }, [])

  // Settings → "Change downloads or away-from-home access": the wizard again, signed in as the admin.
  const enterChange = async () => {
    setPhase('loading')
    try {
      const [cur, i] = await Promise.all([setupApi.current(), setupApi.info()])
      changeRef.current = true
      setInfo(i)
      setDraft(cur.doc ? fromDoc(cur.doc) : { ...newDraft(), admin: { username: session?.userName ?? '', password: '', confirm: '' } })
      setChange(cur.doc ? 'kept' : 'redo')
      setCodeOk(true)
      setStepIdx(0)
      setPhase('wizard')
    } catch {
      setPhase('already')
    }
  }

  const runSystemCheck = useCallback(async () => {
    setChecking(true)
    try {
      setSystem(await setupApi.checkSystem())
    } catch (e) {
      setSystem({ ok: false, items: [{ id: 'docker', title: 'Finesse', ok: false, message: (e as Error).message }] })
    } finally {
      setChecking(false)
    }
  }, [])

  const submitCode = async (e?: FormEvent) => {
    e?.preventDefault()
    const c = code.trim().toUpperCase()
    if (!c) return
    setCodeBusy(true)
    setCodeError('')
    setSetupCode(c)
    try {
      await setupApi.checkCode()
      setCodeOk(true)
      const i = await setupApi.info()
      setInfo(i)
      void runSystemCheck()
      setStepIdx(1)
    } catch (err) {
      setSetupCode('')
      setCodeError(err instanceof ApiError && err.status === 429 ? 'Too many tries — wait a minute and try again.' : (err as Error).message || 'That code didn’t work')
    } finally {
      setCodeBusy(false)
    }
  }

  // Auto-submit a code that arrived in the URL (the installer prints one).
  useEffect(() => {
    if (phase === 'wizard' && code && !codeOk && (params.get('code') || getSetupCode())) void submitCode()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const blocker = stepBlocker(step, d, { codeOk, system })

  const go = (delta: number) => {
    setStepIdx((i) => Math.max(0, Math.min(steps.length - 1, i + delta)))
    setProblems([])
    requestAnimationFrame(() => {
      contentRef.current?.scrollTo({ top: 0 })
      window.scrollTo({ top: 0 })
      contentRef.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true })
    })
  }

  const next = async () => {
    if (step === 'welcome') return void submitCode()
    if (blocker) return
    if (step === 'review') return void build()
    go(1)
  }

  // ---------- build ----------
  const build = async () => {
    setApplyError('')
    const doc = toDoc(d)
    try {
      const v = await setupApi.validate(doc)
      if (!v.ok) {
        setProblems(v.problems)
        return
      }
      const st = await setupApi.apply(doc)
      setRun(st)
      setPhase('building')
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.details)) setProblems(e.details as Problem[])
      else setApplyError((e as Error).message)
    }
  }

  // Poll while building.
  useEffect(() => {
    if (phase !== 'building') return
    let live = true
    let timer = 0
    const tick = async () => {
      const st = await setupApi.status().catch(() => null)
      if (!live) return
      if (st) {
        setRun(st)
        if (st.state === 'done') {
          setPhase('done')
          return
        }
        if (st.state === 'error') return
      }
      timer = window.setTimeout(tick, 1500)
    }
    timer = window.setTimeout(tick, 800)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [phase])

  const retry = async () => {
    setApplyError('')
    try {
      setRun(await setupApi.apply(toDoc(d)))
      setPhase('building')
    } catch (e) {
      setApplyError((e as Error).message)
    }
  }

  // ---------- done → sign in ----------
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState('')
  const signIn = async () => {
    // The music fades out (2 s) while Home loads.
    finishLofi(2)
    setSigningIn(true)
    setSignInError('')
    const info2 = await discover({ force: true })
    const server = bundledJellyfin(info2 ?? finesse)
    try {
      if (!server || !d.admin.username || !d.admin.password) throw new Error('manual')
      await login(server, d.admin.username.trim(), d.admin.password)
      localStorage.setItem('finesse.lastServer', server)
      localStorage.setItem('finesse.lastUser', d.admin.username.trim())
      clearDraft()
      setSetupCode('')
      navigate('/', { replace: true })
    } catch {
      setSigningIn(false)
      if (!d.admin.password) navigate('/login', { replace: true })
      else setSignInError('Couldn’t sign in automatically — use the sign-in page.')
    }
  }

  // ---------- render ----------
  if (phase === 'loading') {
    return (
      <Backdrop>
        <div className="flex min-h-[calc(var(--vh)*100)] items-center justify-center">
          <Spinner className="h-8 w-8 text-ink-400" />
        </div>
      </Backdrop>
    )
  }

  if (phase === 'already') {
    return (
      <Backdrop>
        <div className="flex min-h-[calc(var(--vh)*100)] items-center justify-center px-6">
          <div className="card-in max-w-md text-center">
            <h1 className="font-display text-5xl text-white">{finesse ? 'All set up' : 'Nothing to set up here'}</h1>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-300">
              {finesse
                ? 'This Finesse server is already running. Sign in to use it — administrators can look after it from Settings → Server.'
                : 'This address isn’t a Finesse server that can install apps (it may be an older install). Sign in to continue.'}
            </p>
            {finesse && session?.isAdmin ? (
              <div className="mt-8 flex flex-col items-center gap-3">
                <PrimaryButton onClick={() => void enterChange()}>Change downloads or away-from-home access</PrimaryButton>
                <button type="button" className="text-[13.5px] text-ink-400 hover:text-white" onClick={() => navigate('/', { replace: true })}>
                  Back to Finesse
                </button>
              </div>
            ) : (
              <PrimaryButton className="mt-8" onClick={() => navigate('/login', { replace: true })}>
                Go to sign in
              </PrimaryButton>
            )}
          </div>
        </div>
      </Backdrop>
    )
  }

  if (phase === 'building' || phase === 'done') {
    return (
      <Backdrop>
        <BuildScreen
          run={run}
          done={phase === 'done'}
          onRetry={retry}
          onEdit={() => {
            setPhase('wizard')
            setStepIdx(steps.indexOf('review'))
          }}
          applyError={applyError}
          canRetry={Boolean(d.admin.password) || Boolean(change)}
          onSignIn={change ? () => navigate('/settings#settings-server', { replace: true }) : signIn}
          signingIn={signingIn}
          signInError={signInError}
          dataPath={info?.defaults.data}
          services={run?.services ?? []}
        />
      </Backdrop>
    )
  }

  const meta = STEP_META[step]
  const props = { d, set, info, system }
  const visible = steps.filter((s) => s !== 'welcome')

  return (
    <Backdrop>
      <div className="mx-auto flex min-h-[calc(var(--vh)*100)] max-w-6xl">
        {/* Step rail (desktop) */}
        <aside className="sticky top-0 hidden h-[calc(var(--vh)*100)] w-72 shrink-0 flex-col px-8 py-10 lg:flex">
          <div className="font-display text-3xl text-white">
            <FinesseWordmark />
          </div>
          <p className="mt-1 text-[13px] text-ink-400">Server setup</p>
          <nav className="mt-10 space-y-1" aria-label="Setup steps">
            {visible.map((s) => {
              const i = steps.indexOf(s)
              const state = i < stepIdx ? 'done' : i === stepIdx ? 'current' : 'todo'
              return (
                <button
                  key={s}
                  type="button"
                  disabled={state === 'todo' || !codeOk}
                  onClick={() => setStepIdx(i)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] transition-colors ${
                    state === 'current' ? 'bg-white/[0.07] font-semibold text-white' : state === 'done' ? 'text-ink-200 hover:bg-white/[0.04]' : 'text-ink-400/70'
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                      state === 'done' ? 'bg-accent-fill text-white' : state === 'current' ? 'border-2 border-accent-400' : 'border border-white/20'
                    }`}
                  >
                    {state === 'done' && (
                      <svg viewBox="0 0 20 20" className="h-3 w-3" fill="currentColor" aria-hidden>
                        <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z" />
                      </svg>
                    )}
                  </span>
                  {STEP_META[s].nav}
                </button>
              )
            })}
          </nav>
          <div className="mt-auto text-[12.5px] leading-relaxed text-ink-400">
            Stuck? The{' '}
            <a className="text-accent-300 hover:text-accent-200" href={DOCS} target="_blank" rel="noreferrer">
              install guide
            </a>{' '}
            explains every step.
          </div>
        </aside>

        {/* Content */}
        <main className="flex min-w-0 flex-1 flex-col">
          {/* Mobile progress */}
          <div className="sticky top-0 z-20 border-b border-white/[0.06] bg-ink-950/80 px-5 pb-3 pt-4 backdrop-blur lg:hidden">
            <div className="flex items-center justify-between text-[12.5px] text-ink-400">
              <span className="font-display text-xl text-white">
                <FinesseWordmark />
              </span>
              <span>{step === 'welcome' ? 'Setup' : `${stepIdx} of ${steps.length - 1}`}</span>
            </div>
            <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-accent-400 transition-all duration-500" style={{ width: `${(stepIdx / (steps.length - 1)) * 100}%` }} />
            </div>
          </div>

          <div ref={contentRef} className="flex-1 px-5 pb-12 pt-8 sm:px-10 lg:pt-16">
            <div key={step} className="card-in mx-auto max-w-2xl">
              <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-accent-300">
                {step === 'welcome' ? 'Welcome' : step === 'review' ? 'Last step' : change ? `Step ${stepIdx + 1} of ${steps.length}` : `Step ${stepIdx} of ${steps.length - 1}`}
              </p>
              <h1 tabIndex={-1} className="mt-2 font-display text-[2.6rem] leading-[1.05] text-white outline-none sm:text-6xl">
                {change && step === 'account' ? 'Confirm your account' : change && step === 'review' ? 'Ready to apply' : meta.title}
              </h1>
              <p className="mt-4 max-w-xl text-[15.5px] leading-relaxed text-ink-300">
                {change && step === 'account'
                  ? 'Your administrator username and password, so Finesse can apply the changes.'
                  : change && step === 'review'
                    ? 'Here’s your server as it will be. Nothing changes until you press Apply changes.'
                    : meta.lead}
              </p>
              <div className="mt-9">
                {step === 'welcome' && <WelcomeStep code={code} setCode={setCode} error={codeError} onSubmit={submitCode} />}
                {step === 'machine' && <MachineStep {...props} recheck={runSystemCheck} checking={checking} />}
                {step === 'account' && <AccountStep {...props} />}
                {step === 'libraries' && <LibrariesStep {...props} />}
                {step === 'downloads' && <DownloadsStep {...props} />}
                {step === 'usenet' && <UsenetStep {...props} />}
                {step === 'vpn' && <VpnStep {...props} />}
                {step === 'indexers' && <IndexersStep {...props} />}
                {step === 'quality' && <QualityStep {...props} />}
                {step === 'remote' && <RemoteStep {...props} />}
                {step === 'email' && <EmailStep {...props} />}
                {step === 'review' && change && (
                  <div className="mb-5">
                    <Callout tone="warn" title="Changing your server">
                      {change === 'kept'
                        ? 'Only what you changed is applied; passwords and keys you didn’t touch stay as they are. Anything you switched off is turned off (its settings are kept for next time).'
                        : 'This server was set up before Finesse remembered its setup, so pick everything you want to keep. Anything left out is turned off (its settings are kept for next time).'}
                    </Callout>
                  </div>
                )}
                {step === 'review' && <ReviewStep d={d} info={info} jumpTo={(s) => setStepIdx(steps.indexOf(s))} problems={problems} applyError={applyError} />}
              </div>
            </div>
          </div>

          {/* Footer actions */}
          <div className="sticky bottom-0 z-20 border-t border-white/[0.06] bg-ink-950/85 px-5 backdrop-blur pb-safe sm:px-10">
            <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 py-4">
              <GhostButton onClick={() => go(-1)} disabled={stepIdx === 0 || step === 'machine'}>
                Back
              </GhostButton>
              <div className="flex items-center gap-4">
                {blocker && step !== 'welcome' && <span className="hidden text-right text-[12.5px] text-ink-400 sm:block">{blocker}</span>}
                <PrimaryButton onClick={next} disabled={Boolean(blocker) && !(step === 'welcome' && code.trim())} busy={codeBusy}>
                  {step === 'welcome' ? 'Start' : step === 'review' ? (change ? 'Apply changes' : 'Build my server') : 'Continue'}
                </PrimaryButton>
              </div>
            </div>
          </div>
        </main>
      </div>
    </Backdrop>
  )
}

/** How long building takes depends on what's being installed: streaming alone
 *  (Jellyfin and Finesse) is one small download; requests, downloaders, games
 *  and a VPN add a few GB. */
const HEAVY = ['sonarr', 'radarr', 'lidarr', 'prowlarr', 'sabnzbd', 'qbittorrent', 'gluetun', 'romm', 'wolf']
function buildEstimate(services: string[]): string {
  if (!services.length) return 'It takes from under a minute to about 15 minutes, depending on what you picked and your connection.'
  const heavy = services.filter((s) => HEAVY.includes(s)).length
  if (heavy === 0) return 'Streaming on its own is a small download: this usually takes under a minute.'
  if (heavy <= 3) return 'This usually takes a few minutes, mostly downloading the apps (up to about 10 on a slow connection).'
  return 'This usually takes 5–15 minutes, mostly downloading about 3 GB of apps (much less if they’re already on this machine).'
}

function Backdrop({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-[calc(var(--vh)*100)] bg-ink-950 text-white">
      <div className="aurora" aria-hidden>
        <div />
        <div />
        <div />
      </div>
      <div className="grain" aria-hidden />
      {children}
      <LoFinessaToggle />
    </div>
  )
}

function WelcomeStep({ code, setCode, error, onSubmit }: { code: string; setCode: (c: string) => void; error: string; onSubmit: (e: FormEvent) => void }) {
  const format = (raw: string) => {
    const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
    return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c
  }
  return (
    <form onSubmit={onSubmit} className="space-y-8">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ['film', 'Streaming', 'Jellyfin, served by Finesse on every screen'],
          ['cloud', 'Downloads', 'Sonarr, Radarr, Lidarr, SABnzbd, qBittorrent'],
          ['shield', 'Private', 'Torrents only through your VPN, kill switch on'],
        ].map(([icon, t, s]) => (
          <div key={t} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.07] text-accent-300">
              <Icon name={icon as 'film'} />
            </span>
            <p className="mt-3 text-[14.5px] font-semibold text-white">{t}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-400">{s}</p>
          </div>
        ))}
      </div>
      <div className="max-w-sm">
        <label htmlFor="setup-code" className="text-[13px] font-medium text-ink-200">
          Setup code
        </label>
        <input
          id="setup-code"
          value={code}
          onChange={(e) => setCode(format(e.target.value))}
          autoFocus
          autoComplete="one-time-code"
          spellCheck={false}
          placeholder="XXXX-XXXX"
          className="mt-1.5 h-14 w-full rounded-2xl border border-white/10 bg-ink-900/80 px-4 text-center font-mono text-2xl tracking-[0.3em] text-white outline-none placeholder:text-ink-400/40 focus:border-accent-400"
        />
        {error ? (
          <p className="mt-2 text-[13px] text-red-300">{error}</p>
        ) : (
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-400">
            The installer showed it when it finished. Lost it? Run <code className="rounded bg-white/10 px-1.5 py-0.5 text-[12px]">docker exec finesse finesse setup-code</code> on the server.
          </p>
        )}
      </div>
      <button type="submit" hidden />
    </form>
  )
}

function Row({ label, value, onEdit }: { label: string; value: ReactNode; onEdit: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3.5">
      <div className="min-w-0">
        <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-400">{label}</p>
        <div className="mt-1 break-words text-[14.5px] text-white">{value}</div>
      </div>
      <button type="button" onClick={onEdit} className="shrink-0 text-[13px] font-medium text-accent-300 hover:text-accent-200">
        Edit
      </button>
    </div>
  )
}

const PATH_STEP: [RegExp, StepId][] = [
  [/^admin|^server/, 'account'],
  [/^libraries/, 'libraries'],
  [/^downloads\.usenet/, 'usenet'],
  [/^downloads\.torrents/, 'vpn'],
  [/^downloads\.indexers/, 'indexers'],
  [/^quality/, 'quality'],
  [/^remoteAccess|^publicUrl/, 'remote'],
  [/^email/, 'email'],
]

function ReviewStep({ d, info, jumpTo, problems, applyError }: { d: Draft; info: SetupInfo | null; jumpTo: (s: StepId) => void; problems: Problem[]; applyError: string }) {
  const libs = (['movies', 'shows', 'music', 'games'] as const).filter((k) => d.libraries[k]).map((k) => ({ movies: 'Movies', shows: 'TV shows', music: 'Music', games: 'Games' })[k])
  const apps = ['Jellyfin']
  if (d.usenet || d.torrents) {
    apps.push('Prowlarr')
    if (d.libraries.shows) apps.push('Sonarr')
    if (d.libraries.movies) apps.push('Radarr')
    if (d.libraries.music) apps.push('Lidarr')
  }
  if (d.usenet) apps.push('SABnzbd')
  if (d.torrents) apps.push('Gluetun VPN', 'qBittorrent')
  if (d.libraries.games) apps.push('RomM')
  if (d.remote === 'tailscale') apps.push('Tailscale')
  if (d.remote === 'cloudflare') apps.push('Cloudflare Tunnel')
  const vpnName = info?.vpnProviders.find((p) => p.id === d.vpn.provider)?.name ?? d.vpn.provider
  const ixCount = d.indexers.filter((ix) => (ix.kind === 'newznab' ? d.usenet : d.torrents)).length
  return (
    <div className="space-y-6">
      {problems.length > 0 && (
        <Callout tone="error" title="A few things need fixing">
          <ul className="mt-1 space-y-1">
            {problems.map((p, i) => {
              const target = PATH_STEP.find(([re]) => re.test(p.path))?.[1]
              return (
                <li key={i}>
                  {p.message}
                  {target && (
                    <button type="button" className="ml-2 font-semibold underline" onClick={() => jumpTo(target)}>
                      Fix
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </Callout>
      )}
      {applyError && <Callout tone="error">{applyError}</Callout>}
      <div className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
        <Row label="Administrator" value={`${d.admin.username} · ${d.server.name}`} onEdit={() => jumpTo('account')} />
        <Row label="Libraries" value={libs.join(', ')} onEdit={() => jumpTo('libraries')} />
        <Row
          label="Downloads"
          value={
            d.usenet || d.torrents ? (
              <>
                {[d.usenet && `Usenet via ${d.servers.map((s) => s.name || s.host).join(' + ')}`, d.torrents && `Torrents through ${vpnName}`].filter(Boolean).join(' · ')}
                <span className="block text-[13px] text-ink-400">
                  {ixCount} indexer{ixCount === 1 ? '' : 's'} · {QUALITY_PRESETS.find((q) => q.id === d.quality)?.title}
                </span>
              </>
            ) : (
              'None — streaming your own files'
            )
          }
          onEdit={() => jumpTo('downloads')}
        />
        <Row
          label="Away from home"
          value={{ none: 'Home network only', tailscale: `Tailscale Funnel (${d.tailscale.hostname}.…ts.net)`, cloudflare: `Cloudflare Tunnel (${d.cloudflare.publicUrl})`, own: d.publicUrl }[d.remote]}
          onEdit={() => jumpTo('remote')}
        />
        <Row label="Invite emails" value={d.emailOn ? `Sent from ${d.email.from}` : 'Off — share invite links instead'} onEdit={() => jumpTo('email')} />
      </div>
      <div>
        <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-400">Finesse will install</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {apps.map((a) => (
            <span key={a} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[13px] text-ink-200">
              {a}
            </span>
          ))}
        </div>
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-400">
          About {apps.length > 3 ? '3' : '1'} GB to download. Everything is stored under {info?.defaults.root ?? 'the Finesse folder'} and {info?.defaults.data ?? 'your data folder'}.
        </p>
      </div>
    </div>
  )
}

function BuildScreen({
  run,
  done,
  onRetry,
  onEdit,
  applyError,
  canRetry,
  onSignIn,
  signingIn,
  signInError,
  dataPath,
  services,
}: {
  run: RunStatus | null
  done: boolean
  onRetry: () => void
  onEdit: () => void
  applyError: string
  canRetry: boolean
  onSignIn: () => void
  signingIn: boolean
  signInError: string
  dataPath?: string
  services: string[]
}) {
  const [showLog, setShowLog] = useState(false)
  const failed = run?.state === 'error'
  const steps = (run?.steps ?? []).filter((s) => s.state !== 'skipped')
  const doneCount = steps.filter((s) => s.state === 'done').length
  const pct = steps.length ? Math.round((doneCount / steps.length) * 100) : 0
  const host = window.location.hostname
  const jfPort = run?.warnings.map((w) => /port (\d+)\./.exec(w)?.[1]).find(Boolean) ?? '8096'

  if (done) {
    return (
      <div className="mx-auto flex min-h-[calc(var(--vh)*100)] max-w-3xl flex-col justify-center px-5 py-16 sm:px-10">
        <div className="card-in">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-400/15 text-emerald-300">
            <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </div>
          <h1 className="mt-6 font-display text-5xl leading-none text-white sm:text-7xl">Your server is ready</h1>
          <p className="mt-4 max-w-xl text-[15.5px] leading-relaxed text-ink-300">Everything is installed, connected and looking after itself — Finesse checks on the apps every minute and backs up nightly.</p>
          {(run?.warnings.length ?? 0) > 0 && (
            <div className="mt-6">
              <Callout tone="warn" title="Worth knowing">
                <ul className="list-disc space-y-1 pl-4">
                  {run!.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </Callout>
            </div>
          )}
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <Tip icon="film" title="Add what you already have">
              Copy files into <code className="rounded bg-white/10 px-1 text-[12px]">{dataPath ?? 'the data folder'}/media/movies</code>, <code className="rounded bg-white/10 px-1 text-[12px]">…/tv</code> or <code className="rounded bg-white/10 px-1 text-[12px]">…/music</code>.
            </Tip>
            <Tip icon="tv" title="Watch on your TV">
              LG TVs: install the Finesse app and enter <b>{window.location.host}</b>. Other TVs and players: any Jellyfin app, server <b>{`http://${host}:${jfPort}`}</b>.
            </Tip>
            {services.includes('sonarr') || services.includes('radarr') ? (
              <Tip icon="cloud" title="Request something">
                Search for any movie or show and press Request — it downloads and appears in your library on its own.
              </Tip>
            ) : null}
            {services.includes('romm') ? (
              <Tip icon="games" title="Add your games">
                Put them in <code className="rounded bg-white/10 px-1 text-[12px]">{dataPath ?? 'the data folder'}/media/games/roms/snes</code> (one folder per system: nes, snes, gb, gba, n64, genesis, psx…). They show up under Games within a few minutes.
              </Tip>
            ) : null}
            <Tip icon="link" title="Invite people">
              Settings → Server → Invites makes a link (or sends an email) so friends and family get their own account.
            </Tip>
          </div>
          {signInError && <p className="mt-6 text-[13.5px] text-red-300">{signInError}</p>}
          <PrimaryButton className="mt-10 h-12 px-8 text-base" onClick={onSignIn} busy={signingIn}>
            Start watching
          </PrimaryButton>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-[calc(var(--vh)*100)] max-w-2xl flex-col justify-center px-5 py-16 sm:px-10">
      <div className="card-in">
        <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-accent-300">{failed ? 'Setup stopped' : `${pct}%`}</p>
        <h1 className="mt-2 font-display text-5xl leading-none text-white sm:text-6xl">{failed ? 'Something needs attention' : 'Building your server'}</h1>
        <p className="mt-4 text-[15.5px] leading-relaxed text-ink-300">
          {failed
            ? 'Nothing is lost — fix the problem below and try again. Finished steps are skipped.'
            : `Downloading and connecting your apps. ${buildEstimate(services)} You can leave this page open or come back later.`}
        </p>
        <div className="mt-8 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className={`h-full rounded-full transition-all duration-700 ${failed ? 'bg-red-400' : 'bg-accent-400'}`} style={{ width: `${Math.max(pct, 3)}%` }} />
        </div>
        {!failed && <LoFinessaCard />}
        <ol className="mt-8 space-y-1">
          {steps.map((s) => (
            <li key={s.id} className={`flex items-start gap-3 rounded-xl px-3 py-2.5 ${s.state === 'running' ? 'bg-white/[0.05]' : ''}`}>
              <span className="mt-0.5 flex h-5 w-5 items-center justify-center">
                {s.state === 'running' ? <Spinner className="h-4 w-4 text-accent-300" /> : s.state === 'pending' ? <span className="h-2 w-2 rounded-full bg-white/20" /> : <StatusDot ok={s.state === 'done'} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-[15px] ${s.state === 'pending' ? 'text-ink-400' : 'text-white'} ${s.state === 'running' ? 'font-semibold' : ''}`}>{s.title}</span>
                {s.detail && s.state !== 'done' && !(s.state === 'error' && s.detail === run?.error) && (
                  <span className={`mt-0.5 block text-[13px] leading-relaxed ${s.state === 'error' ? 'text-red-300' : 'text-ink-400'}`}>{s.detail}</span>
                )}
                {s.state === 'running' && typeof s.progress === 'number' && (
                  <span className="mt-2 block h-1 overflow-hidden rounded-full bg-white/10">
                    <span className="block h-full rounded-full bg-accent-300 transition-all duration-500" style={{ width: `${Math.round(s.progress * 100)}%` }} />
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
        {failed && (
          <div className="mt-6 space-y-4">
            <Callout tone="error" title="What went wrong">
              {run?.error}
            </Callout>
            {applyError && <Callout tone="error">{applyError}</Callout>}
            <div className="flex flex-wrap gap-3">
              {canRetry && <PrimaryButton onClick={onRetry}>Try again</PrimaryButton>}
              <GhostButton onClick={onEdit}>Change settings</GhostButton>
            </div>
          </div>
        )}
        <button type="button" onClick={() => setShowLog((v) => !v)} className="mt-8 text-[13px] font-medium text-ink-400 hover:text-white">
          {showLog ? 'Hide details' : 'Show details'}
        </button>
        {showLog && (
          <pre className="mt-3 max-h-72 overflow-auto rounded-xl border border-white/10 bg-black/40 p-4 font-mono text-[11.5px] leading-relaxed text-ink-300">{(run?.log ?? []).join('\n')}</pre>
        )}
      </div>
    </div>
  )
}

function Tip({ icon, title, children }: { icon: 'film' | 'tv' | 'cloud' | 'link' | 'games'; title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.07] text-accent-300">
          <Icon name={icon} className="h-4.5 w-4.5" />
        </span>
        <p className="text-[14.5px] font-semibold text-white">{title}</p>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-400">{children}</p>
    </div>
  )
}
