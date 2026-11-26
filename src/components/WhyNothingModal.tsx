// "Why nothing yet?" for a request that hasn't started: searches now, says in plain words why
// Radarr/Sonarr turned down every copy (src/lib/whyNothing.ts), points administrators at the
// setting that would change it, and lets anyone pick a copy and download it anyway.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrError, arrGrabRelease, arrSearchReleases, type ArrKind, type ArrRelease } from '../api/arr'
import { useAuth } from '../auth/AuthContext'
import { pushBackHandler } from '../lib/back'
import { explain, rankCopies, whyNothing } from '../lib/whyNothing'
import { useToast } from './Toast'

const FIX = {
  language: { text: 'Most of these are in another language.', action: 'Change languages' },
  size: { text: 'Most of these are bigger or smaller than your size limits.', action: 'Change size limits' },
  quality: { text: 'Most of these are a quality your settings skip.', action: 'Change picture quality' },
} as const

function fmtSize(n: number): string {
  if (!n) return ''
  const gb = n / 1e9
  return gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB` : `${Math.round(n / 1e6)} MB`
}

export default function WhyNothingModal({ item, onClose }: { item: { kind: ArrKind; id: number; title: string; year?: number }; onClose: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { session } = useAuth()
  const [releases, setReleases] = useState<ArrRelease[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [armed, setArmed] = useState<string | null>(null)
  const [grabbing, setGrabbing] = useState<string | null>(null)
  const [others, setOthers] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const raf = requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('button[data-close]')?.focus({ preventScroll: true }))
    return () => {
      cancelAnimationFrame(raf)
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => pushBackHandler(() => (onClose(), true)), [onClose])

  useEffect(() => {
    let gone = false
    arrSearchReleases(item.kind, item.id).then(
      (r) => !gone && setReleases(r),
      (e) => !gone && setError(e instanceof ArrError && e.status === 401 ? 'Sign in again, then try once more.' : 'Couldn’t ask the search sites right now. Try again in a minute.'),
    )
    return () => {
      gone = true
    }
  }, [item.kind, item.id])

  const why = useMemo(() => (releases ? whyNothing(releases) : null), [releases])
  const ranked = useMemo(() => (releases ? rankCopies(releases) : []), [releases])
  const mine = ranked.filter((r) => !r.rejections.some((x) => explain(x).reason === 'other-title'))
  const elsewhere = ranked.length - mine.length
  const shown = others ? ranked : mine

  const grab = async (r: ArrRelease) => {
    const key = r.guid + r.indexerId
    if (r.rejections.length && armed !== key) {
      setArmed(key)
      return
    }
    setArmed(null)
    setGrabbing(key)
    try {
      await arrGrabRelease(item.kind, r)
      toast(`Downloading “${item.title}”`)
      for (const k of ['arrQueue', 'arrRequested']) void qc.invalidateQueries({ queryKey: [k] })
      onClose()
    } catch (e) {
      toast(e instanceof ArrError && e.message ? e.message.slice(0, 200) : 'Couldn’t start that download. Try another copy.', 'error')
    } finally {
      setGrabbing(null)
    }
  }

  return (
    <div ref={dialogRef} className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-6" role="dialog" aria-modal="true" aria-label={`Why ${item.title} hasn’t downloaded`}>
      <button tabIndex={-1} className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-label="Close" onClick={onClose} />
      <div className="relative w-full sm:max-w-2xl max-h-[calc(var(--vh)*90)] flex flex-col rounded-t-2xl sm:rounded-2xl bg-ink-900 border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-start gap-3 p-4 sm:p-5 border-b border-white/5">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-white leading-tight">
              {item.title}
              {item.year ? <span className="text-ink-400 font-normal"> ({item.year})</span> : null}
            </h2>
            {!why && !error && <p className="mt-1 text-sm text-ink-400">Asking your search sites… this can take up to a minute.</p>}
            {error && <p className="mt-1 text-sm text-red-300">{error}</p>}
            {why && (
              <>
                <p className="mt-1 text-sm font-medium text-ink-100">{why.headline}</p>
                <ul className="mt-1 space-y-0.5 text-sm text-ink-300">
                  {why.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </>
            )}
            {why?.fix && (
              <div className="mt-3 rounded-xl bg-ink-800/60 px-3.5 py-3 text-sm text-ink-200">
                {FIX[why.fix].text}{' '}
                {session?.isAdmin ? (
                  <button
                    onClick={() => {
                      onClose()
                      navigate('/settings?s=downloads&at=quality-rules')
                    }}
                    className="font-semibold text-accent-300 hover:text-accent-200"
                  >
                    {FIX[why.fix].action} →
                  </button>
                ) : (
                  <span className="text-ink-400">Whoever runs the server can change that in Settings → Downloads, or you can pick a copy below.</span>
                )}
              </div>
            )}
          </div>
          <button data-close onClick={onClose} className="shrink-0 h-8 w-8 rounded-full hover:bg-white/10 text-ink-300 hover:text-white" aria-label="Close">
            <svg className="h-5 w-5 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          <ul className="divide-y divide-white/5">
            {shown.map((r) => {
              const key = r.guid + r.indexerId
              const reasons = [...new Set(r.rejections.map((x) => explain(x).text))]
              const facts = [fmtSize(r.size), r.raw.protocol === 'usenet' ? 'Usenet' : r.seeders != null ? `${r.seeders} sharing` : '', r.languages.join(' + '), r.qualityName].filter(Boolean)
              return (
                <li key={key} className="px-4 sm:px-5 py-3 flex gap-3 items-start">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-ink-100 line-clamp-2 break-all">{r.title}</p>
                    <p className="mt-0.5 text-[11px] text-ink-400 tabular-nums">{facts.join(' · ')}</p>
                    {reasons.map((t) => (
                      <p key={t} className="mt-0.5 text-[11px] text-amber-200/90">
                        {t}
                      </p>
                    ))}
                    {armed === key && <p className="mt-1 text-[11px] font-semibold text-amber-300">Your settings turned this one down. Press again to download it anyway.</p>}
                  </div>
                  <button
                    onClick={() => void grab(r)}
                    disabled={grabbing !== null}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                      r.rejections.length ? 'bg-white/5 text-ink-100 hover:bg-white/10 border border-white/10' : 'bg-accent-fill hover:brightness-110 text-white'
                    }`}
                  >
                    {grabbing === key ? '…' : armed === key ? 'Download anyway?' : r.rejections.length ? 'Download anyway' : 'Download'}
                  </button>
                </li>
              )
            })}
          </ul>
          {elsewhere > 0 && (
            <button onClick={() => setOthers((v) => !v)} className="m-4 sm:mx-5 text-xs font-medium text-ink-400 hover:text-white">
              {others ? 'Hide the other titles' : `Show ${elsewhere} result${elsewhere === 1 ? '' : 's'} that looked like other titles`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
