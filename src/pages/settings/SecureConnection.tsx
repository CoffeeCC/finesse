import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { finesseApi } from '../../lib/finesseServer'

interface TlsInfo {
  httpsPort: number | null
  ca: boolean
  tailscaleUrl: string | null
}

type Os = 'windows' | 'mac' | 'ios' | 'android' | 'linux'

/** Installing Finesse's certificate, one device at a time: the steps each system asks for. */
const STEPS: Record<Os, { name: string; steps: string[] }> = {
  windows: {
    name: 'Windows',
    steps: [
      'Open the downloaded finesse-ca.crt and choose Install Certificate.',
      'Pick Local Machine (or Current User), then Place all certificates in the following store → Browse → Trusted Root Certification Authorities.',
      'Finish, then restart your browser.',
    ],
  },
  mac: {
    name: 'Mac',
    steps: ['Open the downloaded finesse-ca.crt: Keychain Access adds it to the login keychain.', 'Double-click “Finesse …” there, open Trust, and set When using this certificate to Always Trust.', 'Close the window (it asks for your password), then reload Finesse.'],
  },
  ios: {
    name: 'iPhone / iPad',
    steps: [
      'Open this page in Safari and download the certificate; allow the profile download.',
      'Settings → General → VPN & Device Management → Finesse → Install.',
      'Settings → General → About → Certificate Trust Settings → turn on full trust for Finesse.',
    ],
  },
  android: {
    name: 'Android',
    steps: ['Download the certificate.', 'Settings → Security (or Security & privacy) → More security settings → Encryption & credentials → Install a certificate → CA certificate.', 'Pick finesse-ca.crt, then reopen Chrome.'],
  },
  linux: {
    name: 'Chrome on Linux / ChromeOS',
    steps: ['Download the certificate.', 'Chrome → Settings → Privacy and security → Security → Manage certificates → Authorities → Import.', 'Pick finesse-ca.crt and tick Trust this certificate for identifying websites.'],
  },
}

function guessOs(): Os {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac'
  if (/Windows/.test(ua)) return 'windows'
  return 'linux'
}

/** Settings → Account: opening Finesse without a browser warning. */
export default function SecureConnection({ className = '' }: { className?: string }) {
  const { data } = useQuery({
    queryKey: ['tls'],
    queryFn: async () => (await fetch(finesseApi('/api/tls'))).json() as Promise<TlsInfo>,
    staleTime: 5 * 60_000,
    retry: false,
  })
  const [os, setOs] = useState<Os>(guessOs)
  if (!data?.httpsPort || (!data.ca && !data.tailscaleUrl)) return null
  const link = 'text-accent-300 underline-offset-2 hover:underline'
  return (
    <div className={`space-y-4 rounded-2xl border border-white/5 bg-ink-900/60 px-5 py-4 text-sm ${className}`}>
      <div>
        <p className="font-semibold text-white">Secure connection, without warnings</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-400">
          Finesse uses https (games in the page need it). Browsers warn about it until they know Finesse’s certificate. Pick one of these, once per device.
        </p>
      </div>
      {data.tailscaleUrl && (
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-3">
          <p className="font-medium text-white">With Tailscale on the device: nothing to install</p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-300">
            This address has a real certificate:{' '}
            <a className={`${link} break-all`} href={data.tailscaleUrl}>
              {data.tailscaleUrl}
            </a>
          </p>
        </div>
      )}
      {data.ca && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-medium text-white">At home by address: trust Finesse’s certificate</p>
            <a
              href={finesseApi('/api/tls/ca.crt')}
              download="finesse-ca.crt"
              className="inline-flex h-9 items-center rounded-full bg-white px-4 text-[13px] font-semibold text-ink-950 hover:bg-ink-200"
            >
              Download certificate
            </a>
          </div>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Your device">
            {(Object.keys(STEPS) as Os[]).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={os === k}
                onClick={() => setOs(k)}
                className={`rounded-full px-3 py-1 text-[12.5px] font-medium ${os === k ? 'bg-white/15 text-white' : 'text-ink-400 hover:text-white'}`}
              >
                {STEPS[k].name}
              </button>
            ))}
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-ink-300">
            {STEPS[os].steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <p className="text-[12px] leading-relaxed text-ink-500">
            Safe to trust: this certificate can only vouch for this server’s own addresses (home-network addresses and its name), never for other websites.
          </p>
        </div>
      )}
    </div>
  )
}
