import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { copyText } from '../lib/clipboard'
import { finesseRoot, useFinesse } from '../lib/finesseServer'
import { useToast } from './Toast'

const ANDROID_APP = 'https://github.com/CoffeeCC/finesse-android/releases/latest'
const ANDROID_GUIDE = 'https://github.com/CoffeeCC/finesse/blob/master/docs/android.md'

const isLocal = (host: string) => host === 'localhost' || host === '[::1]' || host.startsWith('127.')

function DeviceQr({ url }: { url: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    setSrc(null)
    setFailed(false)
    import('qrcode')
      .then((QR) => QR.toDataURL(url, { width: 320, margin: 1, color: { dark: '#0b0d12', light: '#ffffff' } }))
      .then((d) => {
        if (alive) setSrc(d)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [url])
  if (failed) return <p className="mt-3 text-xs text-ink-400">Couldn’t generate QR code.</p>
  if (!src) return <p className="mt-3 text-xs text-ink-400">Generating QR code…</p>
  return (
    <div className="mt-3">
      <div className="inline-block rounded-xl bg-white p-2 shadow-lg">
        <img decoding="async" src={src} alt={`QR code for ${url}`} className="h-40 w-40" />
      </div>
      <p className="mt-1.5 text-xs text-ink-400">Scan with your phone’s camera to open Finesse.</p>
    </div>
  )
}

/** "Open Finesse on another device": the address to type, said plainly and big. */
export default function ConnectDevices() {
  const { session } = useAuth()
  const { info } = useFinesse()
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const isAdmin = Boolean(session?.isAdmin)
  const root = new URL(finesseRoot() || window.location.origin)
  // On the server itself the address bar says "localhost", which no other device can use.
  const host = isLocal(root.hostname) ? info?.lanHost || null : root.hostname
  const base = host ? `${root.protocol}//${host}${root.port ? `:${root.port}` : ''}` : null
  const app = base ? `${base}/finesse/` : null
  const tvAddress = base ? base.replace(/^https?:\/\//, '') : null
  const jellyfin = base && info?.jellyfin ? `${base}${info.jellyfin.path}` : null
  const away = info?.publicUrl ? `${info.publicUrl.replace(/\/+$/, '')}/finesse/` : null
  // The Android app wants the server's address without /finesse; for the car, the away one.
  const androidAddress = away ? away.replace(/\/finesse\/$/, '') : tvAddress

  const copy = async (text: string) => {
    const ok = await copyText(text)
    if (ok) {
      setCopied(true)
      toast('Address copied')
      window.setTimeout(() => setCopied(false), 2000)
    } else {
      toast('Couldn’t copy. Select the address and copy it yourself.', 'error')
    }
  }

  return (
    <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.06] p-5">
      <p className="text-[15px] font-semibold text-white">Open Finesse on a phone, tablet, TV or another computer</p>
      {app ? (
        <>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-200">Connect it to the same Wi-Fi as this server, then open this address in its web browser:</p>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <code className="select-all break-all rounded-xl bg-black/30 px-4 py-3 text-lg font-semibold text-white sm:text-xl">{app}</code>
            <button type="button" onClick={() => void copy(app)} className="h-10 rounded-full bg-white/10 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/20">
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={() => setShowQr((v) => !v)}
              aria-expanded={showQr}
              className="h-10 rounded-full border border-white/15 bg-white/[0.05] px-4 text-sm font-medium text-ink-200 transition-colors hover:bg-white/10 hover:text-white"
            >
              {showQr ? 'Hide QR code' : 'Show QR code'}
            </button>
          </div>
          {showQr && <DeviceQr url={app} />}
          <dl className="mt-4 space-y-2.5 text-[13.5px] leading-relaxed">
            <div>
              <dt className="font-semibold text-white">LG TV</dt>
              <dd className="text-ink-200">
                Install the Finesse app, then enter <b className="text-white select-all">{tvAddress}</b>.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-white">Android phones and Android Auto</dt>
              <dd className="text-ink-200">
                Install{' '}
                <a href={ANDROID_APP} target="_blank" rel="noreferrer" className="font-semibold text-accent-300 underline-offset-2 hover:underline">
                  Finesse for Android
                </a>
                , then enter <b className="text-white select-all">{androidAddress}</b>. It puts your music in the car
                too.{' '}
                <a href={ANDROID_GUIDE} target="_blank" rel="noreferrer" className="font-semibold text-accent-300 underline-offset-2 hover:underline">
                  How to set up Android Auto
                </a>
              </dd>
            </div>
            {jellyfin && (
              <div>
                <dt className="font-semibold text-white">Other TVs and players (the Jellyfin app)</dt>
                <dd className="text-ink-200">
                  Use this as the server address: <b className="text-white select-all">{jellyfin}</b>
                </dd>
              </div>
            )}
            <div>
              <dt className="font-semibold text-white">Use your phone as a remote</dt>
              <dd className="text-ink-200">
                Open Finesse on your phone and choose{' '}
                <Link to="/remote" className="font-semibold text-accent-300 underline-offset-2 hover:underline">
                  Remote
                </Link>{' '}
                (in the menu under your name) to control any screen in the house.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-white">Away from home</dt>
              <dd className="text-ink-200">
                {away ? (
                  <>
                    Open <b className="text-white select-all">{away}</b>
                  </>
                ) : isAdmin ? (
                  <>
                    This address only works at home. To watch away from home, set up remote access in{' '}
                    <Link to="/settings?s=downloads" className="font-semibold text-accent-300 underline-offset-2 hover:underline">
                      Settings → Downloads
                    </Link>
                    .
                  </>
                ) : (
                  <>This address only works at home on your Wi-Fi.</>
                )}
              </dd>
            </div>
          </dl>
        </>
      ) : (
        <>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-200">
            This page is open on the server itself, so it can’t tell which address your other devices should use. On them, open this in a web browser (on the same Wi-Fi):
          </p>
          <code className="mt-3 block select-all break-all rounded-xl bg-black/30 px-4 py-3 text-lg font-semibold text-white sm:text-xl">
            http://<span className="text-amber-200">this-computers-address</span>:{root.port || '8080'}/finesse/
          </code>
          <p className="mt-4 text-[13.5px] font-semibold text-white">To find this computer’s address (it looks like 192.168.1.20):</p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-[13.5px] leading-relaxed text-ink-200">
            <li>
              <b className="text-white">Windows:</b> open Command Prompt, type <b className="text-white">ipconfig</b> and read the “IPv4 Address”.
            </li>
            <li>
              <b className="text-white">Linux or a NAS:</b> run <b className="text-white">hostname -I</b>.
            </li>
            <li>
              <b className="text-white">Any computer:</b> it’s also in your router’s app, in the list of connected devices.
            </li>
          </ol>
        </>
      )}
    </div>
  )
}
