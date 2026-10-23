// "Report a problem" (Settings → About): write what happened, choose what details to add, see all
// of it, then continue on GitHub with Finesse's bug form filled in. Nothing is sent from here.

import { useEffect, useMemo, useState } from 'react'
import { systemApi, type ServerReport } from '../api/setup'
import { deviceDetails, detailsText, issueUrl } from '../lib/bugReport'
import { TOUCH_UI } from '../lib/device'
import { useFinesse } from '../lib/finesseServer'
import { PROJECT_URL } from '../lib/project'
import { useToast } from './Toast'

const btn = 'inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:opacity-50'
const primary = `${btn} bg-accent-fill text-white hover:brightness-110`
const secondary = `${btn} bg-white/10 border border-white/15 text-white hover:bg-white/15`

export default function ReportProblem({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false)
  const [what, setWhat] = useState('')
  const [withDevice, setWithDevice] = useState(true)
  const [withServer, setWithServer] = useState(isAdmin)
  const [server, setServer] = useState<ServerReport | null>(null)
  const [serverErr, setServerErr] = useState('')
  const [showAll, setShowAll] = useState(false)
  const { info } = useFinesse()
  const toast = useToast()

  useEffect(() => {
    if (!open || !isAdmin || !withServer || server) return
    let live = true
    systemApi
      .report()
      .then((r) => live && setServer(r))
      .catch((e: Error) => live && setServerErr(e.message || 'Couldn’t get the server’s details'))
    return () => {
      live = false
    }
  }, [open, isAdmin, withServer, server])

  const details = useMemo(
    () =>
      detailsText(
        withDevice ? deviceDetails(TOUCH_UI ? 'a phone or tablet' : 'a computer') : null,
        withServer && isAdmin ? server : null,
        withDevice ? (info?.version ?? null) : null,
      ),
    [withDevice, withServer, isAdmin, server, info?.version],
  )

  if (!open) {
    return (
      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <p className="text-[15px] font-semibold text-white">Something not working?</p>
        <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-ink-300">Tell us what happened, and Finesse fills in the details that help fix it.</p>
        <button type="button" className={`${secondary} mt-4`} onClick={() => setOpen(true)}>
          Report a problem
        </button>
      </div>
    )
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${what.trim()}\n\n${details}`)
      toast('Copied')
    } catch {
      toast('Couldn’t copy. Select the text and copy it instead.')
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
      <div>
        <label htmlFor="report-what" className="text-[15px] font-semibold text-white">
          What happened?
        </label>
        <p className="mt-1 text-sm text-ink-400">What did you do, what did you expect, and what happened instead?</p>
        <textarea
          id="report-what"
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          rows={4}
          className="mt-2 w-full rounded-lg border border-white/15 bg-ink-950/60 px-3 py-2 text-sm text-white placeholder:text-ink-500 focus:border-white/40 focus:outline-none"
          placeholder="I pressed play on a movie and it showed a black screen…"
        />
      </div>

      <div className="space-y-2 text-sm text-ink-200">
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5" checked={withDevice} onChange={(e) => setWithDevice(e.target.checked)} />
          <span>Add details about this device and Finesse (versions, browser, screen size)</span>
        </label>
        {isAdmin && (
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={withServer} onChange={(e) => setWithServer(e.target.checked)} />
            <span>Add this server’s details and its recent warnings and errors</span>
          </label>
        )}
        {isAdmin && withServer && serverErr && <p className="text-[12.5px] text-amber-200">{serverErr}</p>}
      </div>

      {details && (
        <div>
          <button type="button" className="text-[13px] font-semibold text-ink-300 underline underline-offset-2 hover:text-white" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Hide what’s included' : 'See exactly what’s included'}
          </button>
          {showAll && (
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-ink-950/70 p-3 text-[11.5px] leading-relaxed text-ink-300">{details}</pre>
          )}
        </div>
      )}

      <p className="max-w-xl text-[12.5px] leading-relaxed text-ink-400">
        This opens a <b className="text-ink-200">public</b> issue on GitHub, where you’ll need a free account. Passwords, keys, emails, your
        address and your name in file paths are taken out, but have a look before you post. Security problems go to{' '}
        <a className="underline underline-offset-2 hover:text-white" href={`${PROJECT_URL}/security/advisories/new`} target="_blank" rel="noopener noreferrer">
          private reporting
        </a>{' '}
        instead.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <a
          href={issueUrl(what, details)}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={!what.trim()}
          onClick={(e) => !what.trim() && e.preventDefault()}
          className={`${primary} ${what.trim() ? '' : 'pointer-events-none opacity-50'}`}
        >
          Continue on GitHub
        </a>
        <button type="button" className={secondary} onClick={copy} disabled={!what.trim()}>
          Copy
        </button>
        <button type="button" className="text-sm font-semibold text-ink-400 hover:text-white" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  )
}
