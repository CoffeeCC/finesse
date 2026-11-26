// Transfer a downloaded or installed game directly to another PC, Steam Deck, or this browser:
// streams an uncompressed .tar straight from the server (zero temp disk space on either end).

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { createGameTransfer, formatSize, type GameTransferTicket } from '../../api/gameStore'
import { pushBackHandler } from '../../lib/back'
import { IS_TV } from '../../lib/device'
import { finesseApi } from '../../lib/finesseServer'
import { useToast } from '../Toast'

type Tab = 'linux' | 'windows' | 'qr'

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

function psQuote(s: string): string {
  return s.replace(/[`"$]/g, '`$&')
}

export default function GameTransferModal({
  requestId,
  title,
  onClose,
}: {
  requestId: string
  title: string
  onClose: () => void
}) {
  const toast = useToast()
  const [ticket, setTicket] = useState<GameTransferTicket | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>(IS_TV ? 'qr' : 'linux')
  const [qrUrl, setQrUrl] = useState('')

  useEffect(() => {
    let alive = true
    createGameTransfer(requestId).then(
      (t) => alive && setTicket(t),
      (e: unknown) => alive && setError(e instanceof Error ? e.message : 'Couldn’t prepare transfer link'),
    )
    return () => {
      alive = false
    }
  }, [requestId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const popBack = pushBackHandler(() => {
      onClose()
      return true
    })
    return () => {
      window.removeEventListener('keydown', onKey)
      popBack()
    }
  }, [onClose])

  const fullUrl = ticket ? new URL(finesseApi(ticket.url), window.location.href).toString() : ''

  useEffect(() => {
    if (!fullUrl || tab !== 'qr') return
    let alive = true
    QRCode.toDataURL(fullUrl, { width: 220, margin: 2, color: { dark: '#0b0d14', light: '#ffffff' } })
      .then((u) => alive && setQrUrl(u))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [fullUrl, tab])

  const linuxCmd = ticket
    ? `mkdir -p ~/Games/${shellQuote(ticket.folderName)} && curl -fL ${shellQuote(fullUrl)} | tar -xf - -C ~/Games/${shellQuote(ticket.folderName)}`
    : ''
  const windowsCmd = ticket
    ? `New-Item -ItemType Directory -Force "$env:USERPROFILE\\Games\\${psQuote(ticket.folderName)}" | Out-Null; curl.exe -fL "${psQuote(fullUrl)}" | tar.exe -xf - -C "$env:USERPROFILE\\Games\\${psQuote(ticket.folderName)}"`
    : ''

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast(`Copied ${what}`)
    } catch {
      toast('Select and copy the text above')
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="transfer-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl border border-white/10 bg-ink-900 p-5 sm:p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="transfer-title" className="font-display text-2xl sm:text-3xl leading-tight text-white truncate">
              Transfer {title}
            </h2>
            <p className="mt-1 text-xs text-ink-400">
              Streams directly from your server — zero extra disk space needed on either machine.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-9 w-9 shrink-0 rounded-full text-ink-300 hover:bg-white/10 hover:text-white transition"
          >
            ×
          </button>
        </div>

        {error ? (
          <p className="mt-4 rounded-xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            {error}
          </p>
        ) : !ticket ? (
          <div className="mt-5 space-y-3">
            <div className="h-11 rounded-xl shimmer" />
            <div className="h-28 rounded-xl shimmer" />
          </div>
        ) : (
          <div className="mt-5 space-y-5">
            {/* Summary + 1-click browser download */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <div className="text-xs text-ink-300">
                <p className="font-semibold text-white">
                  {ticket.kind === 'installed' ? 'Installed game' : 'Downloaded files'} · {formatSize(ticket.bytes)}
                </p>
                <p className="mt-0.5 text-ink-400">
                  {ticket.files} {ticket.files === 1 ? 'file' : 'files'} · Link valid for 2 hours
                </p>
              </div>
              {!IS_TV && (
                <a
                  href={fullUrl}
                  download={ticket.fileName}
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-xs font-semibold text-ink-950 hover:bg-ink-200 transition active:scale-[0.97]"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Download to this device (.tar)
                </a>
              )}
            </div>

            {/* Another machine: 1-line command or QR */}
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Transfer method">
                {(
                  [
                    ['linux', 'Linux / Steam Deck'],
                    ['windows', 'Windows (PowerShell)'],
                    ['qr', 'QR / Direct link'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={tab === id}
                    onClick={() => setTab(id)}
                    className={`h-8 rounded-full px-3 text-xs font-semibold transition ${
                      tab === id ? 'bg-white text-ink-950' : 'border border-white/10 bg-white/[0.04] text-ink-300 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tab === 'linux' && (
                <div className="space-y-2">
                  <p className="text-xs text-ink-400">
                    Paste into a terminal on your Linux PC, Omarchy desktop, or Steam Deck (Desktop Mode). Streams & unpacks straight into <span className="font-mono text-ink-200">~/Games/{ticket.folderName}</span>:
                  </p>
                  <pre className="overflow-x-auto rounded-xl border border-white/10 bg-ink-950 p-3 font-mono text-[11.5px] leading-relaxed text-emerald-200 select-all">
                    {linuxCmd}
                  </pre>
                  <button
                    type="button"
                    onClick={() => void copy(linuxCmd, 'Linux / Steam Deck command')}
                    className="h-9 rounded-full border border-white/15 bg-white/10 px-4 text-xs font-semibold text-white hover:bg-white/15 transition"
                  >
                    Copy command
                  </button>
                </div>
              )}

              {tab === 'windows' && (
                <div className="space-y-2">
                  <p className="text-xs text-ink-400">
                    Paste into PowerShell on Windows 10/11 (<span className="font-mono text-ink-200">curl.exe</span> and <span className="font-mono text-ink-200">tar.exe</span> are built in). Unpacks directly into <span className="font-mono text-ink-200">%USERPROFILE%\Games\{ticket.folderName}</span>:
                  </p>
                  <pre className="overflow-x-auto rounded-xl border border-white/10 bg-ink-950 p-3 font-mono text-[11.5px] leading-relaxed text-sky-200 select-all">
                    {windowsCmd}
                  </pre>
                  <button
                    type="button"
                    onClick={() => void copy(windowsCmd, 'PowerShell command')}
                    className="h-9 rounded-full border border-white/15 bg-white/10 px-4 text-xs font-semibold text-white hover:bg-white/15 transition"
                  >
                    Copy PowerShell command
                  </button>
                </div>
              )}

              {tab === 'qr' && (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:flex-row">
                  {qrUrl ? (
                    <img src={qrUrl} alt="Transfer QR code" className="h-40 w-40 shrink-0 rounded-xl bg-white p-1.5" />
                  ) : (
                    <div className="h-40 w-40 shrink-0 rounded-xl shimmer" />
                  )}
                  <div className="min-w-0 flex-1 space-y-2 text-center sm:text-left">
                    <p className="text-xs text-ink-300">
                      Scan with a phone or handheld on the same network (or Tailscale), or copy the direct link below.
                    </p>
                    <p className="break-all rounded-lg bg-ink-950 px-2.5 py-2 font-mono text-[11px] text-ink-200">
                      {fullUrl}
                    </p>
                    <button
                      type="button"
                      onClick={() => void copy(fullUrl, 'transfer link')}
                      className="h-9 rounded-full border border-white/15 bg-white/10 px-4 text-xs font-semibold text-white hover:bg-white/15 transition"
                    >
                      Copy link
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
