// "Needs you": interactive installer screen or executable picker. Handles error, ready, failed,
// and cancel states cleanly so users are never stranded.

import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useGameRequestActions, useGameRequests, useStoreMode } from '../api/gameStoreQueries'
import { installerScreenUrl, needsProgramPick, splitProgramPath, type ExecutableCandidate, type GameRequest } from '../api/gameStore'
import { PLAY_BTN, START_OVER_BTN } from '../components/ActionButton'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useToast } from '../components/Toast'
import { GameRequestStatusView } from '../components/gamestore/GameRequestStatus'
import GameTransferModal from '../components/gamestore/GameTransferModal'
import { storeGameHref } from '../components/gamestore/StoreCards'
import { StoreUnavailable } from '../components/gamestore/StoreHeader'
import { IS_TV, TOUCH_UI } from '../lib/device'

export default function GameInstallerPage() {
  const { requestId } = useParams()
  const mode = useStoreMode()
  const navigate = useNavigate()
  const toast = useToast()
  const { data, isLoading, isError, refetch } = useGameRequests()
  const actions = useGameRequestActions()
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [transfer, setTransfer] = useState(false)

  if (!mode) return <StoreUnavailable title="Game installer" />

  if (isLoading) {
    return (
      <div className="px-4 py-6 sm:px-6 lg:px-12">
        <div className="mx-auto mt-6 h-[calc(var(--vh)*60)] max-w-5xl rounded-2xl shimmer" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-lg font-semibold text-white">Couldn’t load this install</p>
        <p className="mt-1 text-sm text-ink-400">The game store didn’t respond. Try again in a moment.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 transition hover:bg-ink-200 active:scale-[0.97]"
          >
            Try again
          </button>
          <Link
            to="/games/store/requests"
            className="inline-flex h-10 items-center rounded-lg border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/20"
          >
            Back to Requests
          </Link>
        </div>
      </div>
    )
  }

  const r = data?.find((x) => x.id === requestId)

  if (!r) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-lg font-semibold text-white">This install isn’t waiting any more</p>
        <p className="mt-1 text-sm text-ink-400">It may have already finished or been cancelled.</p>
        <Link
          to="/games/store/requests"
          className="mt-5 inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 transition hover:bg-ink-200 active:scale-[0.97]"
        >
          See your requests
        </Link>
      </div>
    )
  }

  const picking = needsProgramPick(r)
  const waiting = r.state === 'needs-you' && !picking
  const canTransfer = r.state === 'ready' || r.state === 'needs-you' || (r.state === 'failed' && (r.progress ?? 0) >= 100)
  const fail = (e: unknown) => toast(e instanceof Error ? e.message : 'Couldn’t carry on', 'error')

  const done = () =>
    actions.installerDone.mutate(r.id, {
      onSuccess: () => {
        toast(`Thanks. Finesse is finishing “${r.title}”.`)
        navigate(storeGameHref(r.gameId))
      },
      onError: fail,
    })

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link to="/games/store/requests" className="inline-flex items-center gap-1.5 text-sm text-ink-300 hover:text-white">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
            Requests
          </Link>

          <button
            type="button"
            onClick={() => setConfirmCancel(true)}
            className="inline-flex h-9 items-center rounded-lg border border-white/10 bg-white/[0.04] px-3.5 text-xs font-semibold text-ink-300 transition hover:bg-white/10 hover:text-white"
          >
            {r.state === 'ready' ? 'Uninstall' : r.state === 'failed' ? 'Remove request' : 'Cancel install'}
          </button>
        </div>

        {picking ? (
          <>
            <h1 className="page-title mb-2">Choose how {r.title} starts</h1>
            <p className="mb-5 max-w-2xl text-sm leading-relaxed text-ink-300">
              {r.state === 'failed'
                ? 'The game files are unpacked, but Finesse couldn’t tell which file launches the game. Pick the game’s launcher below to finish setting it up.'
                : 'The game files are unpacked and include more than one runnable file. Pick the one that starts the game — the top suggestion is our best guess.'}
            </p>
            {r.state === 'failed' && (
              <div className="mb-5">
                <GameRequestStatusView request={r} size="lg" />
              </div>
            )}
            <ProgramPicker request={r} />
          </>
        ) : r.state === 'ready' ? (
          <div className="rounded-2xl border border-emerald-400/25 bg-emerald-500/[0.06] p-6 sm:p-8">
            <h1 className="page-title mb-2">{r.title} is ready to play</h1>
            <p className="mb-6 max-w-xl text-sm text-ink-200">
              Installation finished cleanly and the game has been added to your library.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link to="/games" className={PLAY_BTN}>
                Play
              </Link>
              <button type="button" onClick={() => setTransfer(true)} className={START_OVER_BTN}>
                Transfer to PC / Deck
              </button>
              <Link to={storeGameHref(r.gameId)} className={START_OVER_BTN}>
                Back to game
              </Link>
            </div>
          </div>
        ) : r.state === 'failed' ? (
          <div className="rounded-2xl border border-amber-400/25 bg-amber-500/[0.05] p-6 sm:p-8">
            <h1 className="page-title mb-2">{r.title} didn’t finish installing</h1>
            <GameRequestStatusView request={r} size="lg" className="mb-6" />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className={PLAY_BTN}
                disabled={actions.retry.isPending}
                onClick={() => actions.retry.mutate(r.id, { onError: fail })}
              >
                {actions.retry.isPending ? 'Trying again…' : 'Try again'}
              </button>
              {canTransfer && (
                <button type="button" onClick={() => setTransfer(true)} className={START_OVER_BTN}>
                  Transfer downloaded files
                </button>
              )}
              <button type="button" onClick={() => setConfirmCancel(true)} className={START_OVER_BTN}>
                Remove
              </button>
            </div>
          </div>
        ) : (
          <>
            <h1 className="page-title mb-2">Finish installing {r.title}</h1>
            <p className="mb-4 max-w-2xl text-sm text-ink-300">
              This installer asks questions Finesse can’t answer automatically. Click through it below (the defaults are usually right). It runs in an isolated sandbox on the server with no internet access.
            </p>
            {(IS_TV || TOUCH_UI) && (
              <p className="mb-4 max-w-2xl rounded-xl border border-sky-300/25 bg-sky-400/10 px-4 py-3 text-sm text-sky-100">
                {IS_TV
                  ? 'This is easier with a mouse. Open Finesse on a computer, go to Games → Requests, and finish it there.'
                  : 'Tap where you’d click. A computer with a mouse is easier for long installers.'}
              </p>
            )}

            {!waiting && (
              <div className="mb-5">
                <GameRequestStatusView request={r} size="lg" />
              </div>
            )}

            {/* The sandbox's screen is 4:3 (1024×768): as big as the page allows, never taller than the window. */}
            <div className="relative mx-auto aspect-[4/3] w-full max-w-[calc(var(--vh)*104)] overflow-hidden rounded-2xl bg-black ring-1 ring-white/10">
              {!waiting ? (
                <div className="grid h-full place-items-center p-6 text-center">
                  <div>
                    <p className="font-semibold text-white">Finesse is taking it from here</p>
                    <p className="mt-1 text-sm text-ink-400">The installer has closed and the game is wrapping up.</p>
                    <Link
                      to={storeGameHref(r.gameId)}
                      className="mt-4 inline-flex h-9 items-center rounded-lg border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white hover:bg-white/20"
                    >
                      Back to game
                    </Link>
                  </div>
                </div>
              ) : mode === 'demo' ? (
                <DemoWizard title={r.title} onFinish={done} />
              ) : (
                <InstallerScreen url={installerScreenUrl(mode, r.id)} />
              )}
            </div>

            {waiting && (
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={done}
                  disabled={actions.installerDone.isPending}
                  className="inline-flex h-11 items-center rounded-lg bg-white px-5 text-[15px] font-semibold text-ink-950 transition hover:bg-ink-200 active:scale-[0.97] disabled:opacity-60"
                >
                  I’ve finished
                </button>
                <p className="text-sm text-ink-400">Press this if the installer has closed and Finesse hasn’t noticed yet.</p>
              </div>
            )}
          </>
        )}
      </div>

      {transfer && <GameTransferModal requestId={r.id} title={r.title} onClose={() => setTransfer(false)} />}
      {confirmCancel && (
        <ConfirmDialog
          title={r.state === 'ready' ? `Uninstall “${r.title}”?` : r.state === 'failed' ? `Remove “${r.title}”?` : `Cancel “${r.title}”?`}
          confirmLabel={r.state === 'ready' ? 'Uninstall' : r.state === 'failed' ? 'Remove' : 'Cancel the request'}
          cancelLabel="Keep it"
          busy={actions.cancel.isPending}
          onCancel={() => setConfirmCancel(false)}
          onConfirm={() =>
            actions.cancel.mutate(r.id, {
              onSuccess: () => {
                toast(r.state === 'ready' ? `Uninstalled “${r.title}”` : `Removed “${r.title}”`)
                navigate('/games/store/requests')
              },
              onError: fail,
              onSettled: () => setConfirmCancel(false),
            })
          }
        >
          {r.state === 'ready'
            ? 'The installed game files and its download are deleted from the server to free space.'
            : 'The install stops and downloaded files are deleted. You can request this game again later.'}
        </ConfirmDialog>
      )}
    </div>
  )
}

const ENGINE_REASON = /unity|unreal|godot|rpg maker|store executable hint/i

/** Plain-English executable chooser for unpacked archives with multiple runnable files. */
function ProgramPicker({ request: r }: { request: GameRequest }) {
  const navigate = useNavigate()
  const toast = useToast()
  const { pickProgram } = useGameRequestActions()
  const pending = pickProgram.isPending ? pickProgram.variables?.program : undefined
  const pick = (c: ExecutableCandidate) =>
    pickProgram.mutate(
      { id: r.id, program: c.path },
      {
        onSuccess: () => {
          toast(`Got it. Finesse is finishing setup for “${r.title}”.`)
          navigate(storeGameHref(r.gameId))
        },
        onError: (e) => toast(e instanceof Error ? e.message : 'Couldn’t use that program', 'error'),
      },
    )
  const hints = r.redistHints ?? []
  return (
    <section aria-labelledby="program-picker-title" className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 id="program-picker-title" className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-300">
          Which file starts this game?
        </h2>
        <span className="text-xs text-ink-400">Click “Use this” to test and add the game to your library.</span>
      </div>
      <ul className="space-y-2.5">
        {r.candidates!.map((c, i) => {
          const { name, folder } = splitProgramPath(c.path)
          const busy = pending === c.path
          return (
            <li
              key={c.path}
              className={`flex flex-col gap-3 rounded-xl border p-3.5 sm:flex-row sm:items-center sm:p-4 ${
                i === 0 ? 'border-accent-300/35 bg-accent-400/[0.07]' : 'border-white/10 bg-ink-900/60'
              }`}
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-ink-200" aria-hidden>
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0 0 21 18V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v12a2.25 2.25 0 0 0 2.25 2.25Z" />
                  </svg>
                </span>
                <div className="min-w-0">
                  <p className="break-all text-[15px] font-semibold text-white">{name}</p>
                  <p className="mt-0.5 break-all font-mono text-xs text-ink-400">{folder || 'Main game folder'}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {i === 0 && (
                      <span className="rounded-full bg-accent-400/20 px-2.5 py-0.5 text-[11px] font-semibold text-accent-200">
                        Recommended
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                        ENGINE_REASON.test(c.reason) ? 'bg-emerald-400/15 text-emerald-200' : 'bg-white/[0.07] text-ink-200'
                      }`}
                    >
                      {c.reason}
                    </span>
                    <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${c.linux ? 'border-amber-300/30 text-amber-100' : 'border-sky-300/30 text-sky-100'}`}>
                      {c.linux ? 'Linux native' : 'Windows'}
                    </span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => pick(c)}
                disabled={pickProgram.isPending}
                aria-label={`Use ${name} to start ${r.title}`}
                className={`inline-flex h-11 shrink-0 items-center justify-center rounded-lg px-5 text-[15px] font-semibold transition active:scale-[0.97] disabled:opacity-60 sm:h-10 ${
                  i === 0 ? 'bg-white text-ink-950 hover:bg-ink-200' : 'border border-white/15 bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                {busy ? 'Checking…' : 'Use this'}
              </button>
            </li>
          )
        })}
      </ul>
      {hints.length > 0 && (
        <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[13px] text-ink-400">
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[12px] font-medium text-ink-200">
            Auto runtimes
          </span>
          <span>
            Required components (<span className="font-mono text-ink-200">{hints.join(' · ')}</span>) will be set up automatically.
          </span>
        </p>
      )}
    </section>
  )
}

/** The real installer's screen: noVNC over the server's websocket. */
function InstallerScreen({ url }: { url: string | null }) {
  const host = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState(url ? 'Connecting…' : 'This server can’t show installer screens yet.')
  // Fitted to the box, or pixel for pixel (scroll to move around) when small text is hard to read.
  const [actual, setActual] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const rfbRef = useRef<{ scaleViewport: boolean } | null>(null)
  useEffect(() => {
    if (rfbRef.current) rfbRef.current.scaleViewport = !actual
  }, [actual])

  useEffect(() => {
    if (!url || !host.current) return
    const el = host.current
    let gone = false
    let client: { disconnect: () => void } | null = null
    setStatus('Connecting…')
    void import('@novnc/novnc/lib/rfb.js')
      .then(({ default: RFB }) => {
        if (gone) return
        const rfb = new RFB(el, url, { wsProtocols: ['binary'] })
        rfb.scaleViewport = !actual
        rfbRef.current = rfb
        rfb.focusOnClick = true
        rfb.addEventListener('connect', () => {
          if (!gone) setStatus('')
        })
        rfb.addEventListener('disconnect', (ev: Event) => {
          if (gone) return
          const clean = (ev as CustomEvent<{ clean?: boolean }>).detail?.clean === true
          setStatus(clean ? 'The screen closed.' : 'The screen didn’t connect.')
        })
        client = rfb
      })
      .catch(() => {
        if (!gone) setStatus('The screen didn’t connect.')
      })
    return () => {
      gone = true
      rfbRef.current = null
      try {
        client?.disconnect()
      } catch {
        /* already closed */
      }
    }
    // The size choice is applied live (above); reconnecting for it would restart the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, attempt])

  const canRetry = Boolean(url) && status !== '' && status !== 'Connecting…'

  return (
    <div className="relative h-full w-full bg-black">
      <div ref={host} className={`h-full w-full ${actual ? 'overflow-auto' : ''}`} />
      {!status && (
        <button
          type="button"
          onClick={() => setActual((v) => !v)}
          className="absolute right-3 top-3 z-10 inline-flex h-8 items-center rounded-full bg-black/70 px-3 text-[12.5px] font-semibold text-white ring-1 ring-white/20 hover:bg-black/90"
        >
          {actual ? 'Fit to window' : 'Actual size'}
        </button>
      )}
      {status && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <div>
            <p className="font-semibold text-white">The installer’s screen appears here</p>
            <p className="mt-1 text-sm text-ink-400">{status}</p>
            {canRetry && (
              <button
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
                className="mt-4 inline-flex h-9 items-center rounded-lg border border-white/15 bg-white/10 px-4 text-xs font-semibold text-white hover:bg-white/20"
              >
                Reconnect
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** A pretend setup wizard (demo store only), to try the flow end to end. */
function DemoWizard({ title, onFinish }: { title: string; onFinish: () => void }) {
  const [step, setStep] = useState(0)
  const [agree, setAgree] = useState(false)
  const [desktop, setDesktop] = useState(true)
  const steps = ['Welcome', 'License', 'Options', 'Installing', 'Done']
  return (
    <div className="grid h-full place-items-center bg-[#008080] p-3 sm:p-8">
      <div className="w-full max-w-lg border-2 border-b-[#404040] border-l-white border-r-[#404040] border-t-white bg-[#c0c0c0] font-sans text-[13px] text-black shadow-2xl">
        <div className="flex items-center justify-between bg-gradient-to-r from-[#000080] to-[#1084d0] px-2 py-1 text-[13px] font-bold text-white">
          <span>Setup – {title}</span>
          <span aria-hidden>✕</span>
        </div>
        <div className="min-h-[13rem] p-4">
          {step === 0 && <p>Welcome to the {title} Setup Wizard. This will install {title} on your computer. Click Next to continue.</p>}
          {step === 1 && (
            <div>
              <p className="mb-2">Please read the following License Agreement.</p>
              <div className="mb-3 h-20 overflow-y-auto border border-[#808080] bg-white p-2 text-[12px]">
                This program is free software: you can redistribute it and/or modify it under the terms of its license…
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I accept the agreement
              </label>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-2">
              <p>Select additional tasks:</p>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={desktop} onChange={(e) => setDesktop(e.target.checked)} /> Create a desktop shortcut
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" defaultChecked /> Install the music pack
              </label>
            </div>
          )}
          {step === 3 && (
            <div>
              <p className="mb-3">Installing {title}…</p>
              <div className="h-4 border border-[#808080] bg-white">
                <div className="h-full w-2/3 bg-[#000080]" />
              </div>
            </div>
          )}
          {step === 4 && <p>Setup has finished installing {title}. Click Finish to exit Setup.</p>}
        </div>
        <div className="flex items-center justify-between border-t border-[#808080] px-4 py-3">
          <span className="text-[11px] text-[#404040]">
            {steps[step]} ({step + 1}/{steps.length})
          </span>
          <div className="flex gap-2">
            {step > 0 && step < 3 && <WinButton onClick={() => setStep(step - 1)}>&lt; Back</WinButton>}
            {step < 2 && (
              <WinButton onClick={() => setStep(step + 1)} disabled={step === 1 && !agree}>
                Next &gt;
              </WinButton>
            )}
            {step === 2 && <WinButton onClick={() => setStep(3)}>Install</WinButton>}
            {step === 3 && <WinButton onClick={() => setStep(4)}>Next &gt;</WinButton>}
            {step === 4 && <WinButton onClick={onFinish}>Finish</WinButton>}
          </div>
        </div>
      </div>
    </div>
  )
}

function WinButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-w-[5.5rem] border-2 border-b-[#404040] border-l-white border-r-[#404040] border-t-white bg-[#c0c0c0] px-3 py-1 text-[13px] text-black outline-none focus-visible:outline-1 focus-visible:outline-dotted focus-visible:outline-black active:border-b-white active:border-l-[#404040] active:border-r-white active:border-t-[#404040] disabled:text-[#808080]"
    >
      {children}
    </button>
  )
}
