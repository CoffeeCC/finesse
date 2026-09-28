import { useEffect, useRef, useState } from 'react'
import { pushBackHandler } from '../lib/back'
import { applyClientUpdate, dismissServerRun, useClientUpdate, useServerRun } from '../lib/appUpdate'
import { useToast } from './Toast'

/** "0.12.0" → "0.12" for people; full versions stay in Settings. */
export const shortVersion = (v: string) => v.replace(/^v/, '').replace(/\.0$/, '')

export function SparkIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z"
      />
    </svg>
  )
}

/** Navbar pill once a newer Finesse is out: the web reloads into the build the
 *  NAS now serves; the TV downloads its bundle and relaunches. In the bar (not a
 *  floating banner) so the remote can reach it with one press of Up. */
export function UpdatePill() {
  const { data: update } = useClientUpdate()
  const run = useServerRun()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (!update || run.phase !== 'idle') return null
  const v = shortVersion(update.version)
  const go = async () => {
    setBusy(true)
    try {
      await applyClientUpdate(update)
    } catch (e) {
      setBusy(false)
      toast(e instanceof Error ? e.message : 'Update failed', 'error')
    }
  }
  return (
    <button
      type="button"
      onClick={go}
      disabled={busy}
      aria-label={`Finesse ${v} is ready — update now`}
      className="update-pill inline-flex shrink-0 items-center gap-1.5 h-9 mr-1 rounded-full bg-accent-fill pl-3 pr-3.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-70 transition"
    >
      <SparkIcon />
      {busy ? (
        <span>Updating…</span>
      ) : (
        <>
          <span className="hidden lg:inline">Finesse {v} is ready ·</span>
          <span>Update</span>
        </>
      )}
    </button>
  )
}

const WEB_STEPS = [
  { id: 'downloading', label: 'Download from GitHub' },
  { id: 'verifying', label: 'Check the build' },
  { id: 'installing', label: 'Install on the server' },
] as const

const APP_STEPS = [
  { id: 'backing up', label: 'Back up your settings' },
  { id: 'downloading', label: 'Download the new version' },
  { id: 'restarting', label: 'Restart Finesse' },
] as const

/** Follows an admin's server update (lib/appUpdate beginServerUpdate) and
 *  reloads into the new build when it lands. */
export function ServerUpdateOverlay() {
  const run = useServerRun()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (run.phase !== 'error') return
    closeRef.current?.focus()
    return pushBackHandler(() => {
      dismissServerRun()
      return true
    })
  }, [run.phase])

  if (run.phase === 'idle') return null
  const STEPS: readonly { id: string; label: string }[] = run.phase === 'running' && run.kind === 'app' ? APP_STEPS : WEB_STEPS
  // "checking" (finding the release) reads as the first step starting.
  const at =
    run.phase === 'running' ? Math.max(0, STEPS.findIndex((s) => s.id === run.step)) : run.phase === 'done' ? STEPS.length : -1
  const version = run.phase === 'running' || run.phase === 'done' ? run.version : null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="server-update-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-950/80 backdrop-blur-md px-6"
    >
      <div className="w-full max-w-sm rounded-2xl bg-ink-900 border border-white/10 shadow-2xl shadow-black/50 p-6 toast-in">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-300">
          {run.phase === 'error' ? 'Update stopped' : run.phase === 'done' ? 'All set' : 'Updating'}
        </p>
        <h2 id="server-update-title" className="mt-1.5 font-display text-3xl leading-tight text-white">
          {run.phase === 'error'
            ? 'Finesse didn’t update'
            : run.phase === 'done'
              ? `Finesse ${version ? shortVersion(version) : ''} is live`
              : `Finesse ${version ? shortVersion(version) : ''}`}
        </h2>

        {run.phase === 'error' ? (
          <>
            <p className="mt-3 text-sm leading-relaxed text-ink-300">{run.message}</p>
            <p className="mt-2 text-sm text-ink-400">Nothing changed — everyone is still on the current version.</p>
            <button
              ref={closeRef}
              type="button"
              onClick={dismissServerRun}
              className="mt-5 inline-flex h-10 items-center rounded-lg bg-white/10 border border-white/15 px-4 text-sm font-semibold text-white hover:bg-white/15 transition-colors"
            >
              Close
            </button>
          </>
        ) : (
          <>
            <ol className="mt-5 space-y-3" aria-live="polite">
              {STEPS.map((s, i) => {
                const state = i < at ? 'done' : i === at ? 'now' : 'todo'
                return (
                  <li key={s.id} className="flex items-center gap-3 text-sm">
                    <span
                      className={`h-6 w-6 shrink-0 rounded-full flex items-center justify-center ${
                        state === 'done' ? 'bg-accent-fill text-white' : state === 'now' ? 'border-2 border-accent-400' : 'border border-white/15'
                      }`}
                    >
                      {state === 'done' ? (
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                      ) : state === 'now' ? (
                        <span className="h-2 w-2 rounded-full bg-accent-400 animate-pulse" />
                      ) : null}
                    </span>
                    <span className={state === 'todo' ? 'text-ink-400' : 'text-white font-medium'}>{s.label}</span>
                  </li>
                )
              })}
            </ol>
            <p className="mt-5 text-[13px] text-ink-400">
              {run.phase === 'done'
                ? 'Reloading into the new version…'
                : run.phase === 'running' && run.kind === 'app'
                  ? 'Keep this open — Finesse is offline for about a minute while it restarts. If anything goes wrong it rolls back by itself.'
                  : 'Keep this open — it only takes a moment. People watching now aren’t interrupted.'}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
