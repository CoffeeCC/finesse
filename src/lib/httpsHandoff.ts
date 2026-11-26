import * as api from '../api/client'
import type { Session } from '../api/client'
import { IS_TV } from './device'
import { finesseApi } from './finesseServer'

const HASH_PREFIX = 'finesse-handoff='
const UPGRADE_TRIED_KEY = 'finesse.httpsUpgradeTried'

/** Parse a handoff code out of the current URL hash, if present. */
export function hasPendingHandoff(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.hash.includes(HASH_PREFIX)
}

/**
 * Consume a one-time handoff code from the URL hash after an HTTP → HTTPS switch,
 * restoring the Jellyfin session seamlessly without showing the login screen.
 */
export async function redeemHttpsHandoff(): Promise<Session | null> {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash
  const match = hash.match(/finesse-handoff=([0-9a-f]{32,128})/i)
  if (!match) return null
  const code = match[1]!
  // Remove the one-time code from the URL right away.
  const cleanedHash = hash
    .replace(new RegExp(`[#&]?${HASH_PREFIX}[0-9a-f]+`, 'i'), '')
    .replace(/^#$/, '')
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search + cleanedHash)
  } catch {
    /* ignore */
  }
  try {
    const res = await fetch(finesseApi(`/api/handoff/${encodeURIComponent(code)}`), {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const s = (await res.json()) as Session
    if (!s?.token || !s?.userId || !s?.server) return null
    // If the session pointed at the HTTP origin directly, rewrite to the current HTTPS origin's /jellyfin proxy when same-host.
    const fixed: Session = { ...s }
    try {
      const prev = new URL(s.server)
      if (prev.hostname === window.location.hostname && prev.protocol === 'http:') {
        prev.protocol = window.location.protocol
        prev.port = window.location.port
        fixed.server = prev.toString().replace(/\/+$/, '')
      }
    } catch {
      /* relative server path like /jellyfin stays as-is */
    }
    api.setSession(fixed)
    return fixed
  } catch {
    return null
  }
}

/**
 * Switch the current tab from HTTP to the server's HTTPS port while carrying
 * the signed-in session across origins via a 60s one-time server handoff code.
 */
export async function switchToHttps(httpsPort: number, extraParams?: Record<string, string>): Promise<void> {
  const session = api.getSession()
  let code = ''
  if (session?.token) {
    try {
      const ctrl = new AbortController()
      const timer = window.setTimeout(() => ctrl.abort(), 3000)
      const res = await fetch(finesseApi('/api/handoff'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: api.mediaBrowserAuthHeader(),
        },
        body: JSON.stringify(session),
        signal: ctrl.signal,
      })
      window.clearTimeout(timer)
      if (res.ok) {
        const data = (await res.json()) as { code?: string }
        if (data.code) code = data.code
      }
    } catch {
      /* older server or offline: still switch cleanly */
    }
  }

  const params = new URLSearchParams(window.location.search)
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      if (v) params.set(k, v)
    }
  }
  const qs = params.toString() ? `?${params.toString()}` : ''
  const hash = code ? `#${HASH_PREFIX}${code}` : window.location.hash
  const portPart = httpsPort === 443 ? '' : `:${httpsPort}`
  const target = `https://${window.location.hostname}${portPart}${window.location.pathname}${qs}${hash}`
  window.location.replace(target)
}

/**
 * When opened over plain HTTP on the LAN and the server exposes HTTPS, silently
 * check whether this browser ALREADY trusts the HTTPS certificate (e.g. via
 * Finesse's installed CA or Tailscale). If trusted, seamlessly upgrade to HTTPS
 * with zero warnings and zero re-login so streaming/clipboard/WebCodecs just work.
 */
export async function trySilentHttpsUpgrade(httpsPort: number | null | undefined): Promise<void> {
  if (!httpsPort || typeof window === 'undefined' || __WEBOS__ || IS_TV) return
  if (window.isSecureContext || window.location.protocol !== 'http:') return
  const host = window.location.hostname
  if (!host || host === 'localhost' || host === '127.0.0.1' || host === '::1') return
  try {
    if (sessionStorage.getItem(UPGRADE_TRIED_KEY) === '1') return
    sessionStorage.setItem(UPGRADE_TRIED_KEY, '1')
  } catch {
    /* ignore */
  }
  const portPart = httpsPort === 443 ? '' : `:${httpsPort}`
  const probeUrl = `https://${host}${portPart}/api/health`
  try {
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => ctrl.abort(), 1500)
    // mode: 'no-cors' rejects on untrusted TLS certificates and resolves ONLY when the cert is already trusted.
    await fetch(probeUrl, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal })
    window.clearTimeout(timer)
    await switchToHttps(httpsPort)
  } catch {
    /* cert not trusted yet or HTTPS port unreachable — stay quietly on HTTP */
  }
}
