// "Needs you": an installer Finesse couldn't get through on its own is waiting on its screen.
// On the server this page shows that screen (noVNC over Finesse's websocket proxy) so the person
// clicks through it; Finesse notices when the installer closes. "I've finished" is there for
// when it doesn't. The demo store draws a pretend setup wizard instead.

import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useGameRequestActions, useGameRequests, useStoreMode } from '../api/gameStoreQueries'
import { installerScreenUrl } from '../api/gameStore'
import { useToast } from '../components/Toast'
import { GameRequestStatusView } from '../components/gamestore/GameRequestStatus'
import { storeGameHref } from '../components/gamestore/StoreCards'
import { IS_TV, TOUCH_UI } from '../lib/device'

export default function GameInstallerPage() {
  const { requestId } = useParams()
  const mode = useStoreMode()
  const navigate = useNavigate()
  const toast = useToast()
  const { data, isLoading } = useGameRequests()
  const actions = useGameRequestActions()
  const r = data?.find((x) => x.id === requestId)

  if (!mode) return null
  if (isLoading) return <div className="mx-auto mt-10 h-[calc(var(--vh)*60)] max-w-5xl rounded-2xl shimmer" />
  if (!r)
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-lg font-semibold text-white">This install isn’t waiting any more</p>
        <p className="mt-1 text-sm text-ink-400">It may have finished or been cancelled.</p>
        <Link to="/games/store/requests" className="mt-5 inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 hover:bg-ink-200">
          See your requests
        </Link>
      </div>
    )

  const waiting = r.state === 'needs-you'
  const done = () =>
    actions.installerDone.mutate(r.id, {
      onSuccess: () => {
        toast(`Thanks. Finesse is finishing “${r.title}”.`)
        navigate(storeGameHref(r.gameId))
      },
      onError: (e) => toast(e instanceof Error ? e.message : 'Couldn’t carry on', 'error'),
    })

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-12">
      <div className="mx-auto max-w-5xl">
        <Link to="/games/store/requests" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-300 hover:text-white">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          Requests
        </Link>
        <h1 className="page-title mb-2">Finish installing {r.title}</h1>
        <p className="mb-4 max-w-2xl text-sm text-ink-300">
          This installer asks questions Finesse can’t answer for you. Click through it below: the defaults are usually right. It runs in a sealed box on the server, with no
          internet and no access to anything but the game’s folder.
        </p>
        {(IS_TV || TOUCH_UI) && (
          <p className="mb-4 max-w-2xl rounded-xl border border-sky-300/25 bg-sky-400/10 px-4 py-3 text-sm text-sky-100">
            {IS_TV ? 'This is easier with a mouse. Open Finesse on a computer, go to Games → Store → Requests, and finish it there.' : 'Tap where you’d click. A computer with a mouse is easier for long installers.'}
          </p>
        )}

        {!waiting && (
          <div className="mb-5">
            <GameRequestStatusView request={r} />
          </div>
        )}

        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-black ring-1 ring-white/10 sm:aspect-video">
          {!waiting ? (
            <div className="grid h-full place-items-center p-6 text-center text-sm text-ink-300">The installer has closed. Finesse is taking it from here.</div>
          ) : mode === 'demo' ? (
            <DemoWizard title={r.title} onFinish={done} />
          ) : (
            <InstallerScreen url={installerScreenUrl(mode, r.id)} />
          )}
        </div>

        {waiting && (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button type="button" onClick={done} disabled={actions.installerDone.isPending} className="inline-flex h-11 items-center rounded-lg bg-white px-5 text-[15px] font-semibold text-ink-950 hover:bg-ink-200 disabled:opacity-60">
              I’ve finished
            </button>
            <p className="text-sm text-ink-400">Press this if the installer has closed and Finesse hasn’t noticed.</p>
          </div>
        )}
      </div>
    </div>
  )
}

/** The real installer's screen. Waits for the server side: the noVNC client connects here. */
function InstallerScreen({ url }: { url: string | null }) {
  return (
    <div className="grid h-full place-items-center p-6 text-center">
      <div>
        <p className="font-semibold text-white">The installer’s screen appears here</p>
        <p className="mt-1 text-sm text-ink-400">{url ? 'Connecting…' : 'This server can’t show installer screens yet.'}</p>
      </div>
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
      <div className="w-full max-w-lg border-2 border-t-white border-l-white border-b-[#404040] border-r-[#404040] bg-[#c0c0c0] font-sans text-[13px] text-black shadow-2xl">
        <div className="flex items-center justify-between bg-gradient-to-r from-[#000080] to-[#1084d0] px-2 py-1 text-[13px] font-bold text-white">
          <span>Setup – {title}</span>
          <span aria-hidden>✕</span>
        </div>
        <div className="min-h-[13rem] p-4">
          {step === 0 && <p>Welcome to the {title} Setup Wizard. This will install {title} on your computer. Click Next to continue.</p>}
          {step === 1 && (
            <div>
              <p className="mb-2">Please read the following License Agreement.</p>
              <div className="mb-3 h-20 overflow-y-auto border border-[#808080] bg-white p-2 text-[12px]">This program is free software: you can redistribute it and/or modify it under the terms of its license…</div>
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
      className="min-w-[5.5rem] border-2 border-t-white border-l-white border-b-[#404040] border-r-[#404040] bg-[#c0c0c0] px-3 py-1 text-[13px] text-black outline-none focus-visible:outline-1 focus-visible:outline-dotted focus-visible:outline-black active:border-t-[#404040] active:border-l-[#404040] active:border-b-white active:border-r-white disabled:text-[#808080]"
    >
      {children}
    </button>
  )
}
