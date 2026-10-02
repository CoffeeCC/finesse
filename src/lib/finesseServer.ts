// Talking to the Finesse server itself: discovery (/api/finesse tells the app
// what it's connected to — bundled Jellyfin, setup state, features) and the
// address Jellyfin answers on. Older installs (nginx + Jellyfin on its own
// port, no discovery endpoint) still work through the legacy guess below.

import { useCallback, useEffect, useState } from 'react'
import { CONTENT_BASE, setContentOrigin } from './contentOrigin'

export interface FinesseInfo {
  name: 'finesse'
  version: string
  web: string | null
  mode: 'bundle' | 'adopt'
  instanceId: string
  /** Jellyfin is served by Finesse at this path (same origin). */
  jellyfin: { path: string } | null
  setup: { state: 'new' | 'applying' | 'ready' | 'error' | string; needsCode: boolean }
  features: Record<string, boolean>
  publicUrl: string | null
  requests?: { profiles?: Record<string, string> }
}

/** URL for a Finesse API path, e.g. finesseApi('/api/setup/info'). */
export function finesseApi(path: string): string {
  return `${CONTENT_BASE}${path.replace(/^\/+/, '')}`
}

/** The Finesse server's origin + root ("http://host:8080"), from its base URL. */
export function finesseRoot(base = CONTENT_BASE): string {
  const abs = new URL(base || '/', window.location.href)
  return `${abs.origin}${abs.pathname.replace(/\/?finesse\/?$/, '').replace(/\/$/, '')}`
}

let pending: Promise<FinesseInfo | null> | null = null
let known: FinesseInfo | null | undefined

/** Asks the server what it is. null = not a Finesse server (older nginx install) or unreachable. */
export function discover(opts: { force?: boolean; base?: string } = {}): Promise<FinesseInfo | null> {
  const base = opts.base ?? CONTENT_BASE
  if (!base) return Promise.resolve(null)
  if (!opts.force && !opts.base && pending) return pending
  const p = (async () => {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 6000)
      const res = await fetch(`${base}api/finesse`, { signal: ctrl.signal, cache: 'no-store' })
      clearTimeout(t)
      if (!res.ok) return null
      const info = (await res.json()) as FinesseInfo
      return info?.name === 'finesse' ? info : null
    } catch {
      return null
    }
  })()
  if (!opts.base) {
    pending = p
    void p.then((i) => (known = i))
  }
  return p
}

/** The last discovery result (undefined until it finishes). */
export const knownFinesse = () => known

/** Where this Finesse serves Jellyfin, or null if it doesn't. */
export function bundledJellyfin(info: FinesseInfo | null, base = CONTENT_BASE): string | null {
  return info?.jellyfin ? `${finesseRoot(base)}${info.jellyfin.path}` : null
}

/** Older installs: Jellyfin on its own port next to the web app. */
export function legacyJellyfinGuess(): string {
  const { protocol, hostname } = window.location
  if (!hostname || protocol === 'file:') return ''
  // A Tailscale Funnel can only publish 443/8443/10000; the original
  // deployment put Jellyfin on :10000 next to the app.
  if (hostname.endsWith('.ts.net')) return `https://${hostname}:10000`
  return `${protocol}//${hostname}:8096`
}

/** The Jellyfin address to offer on the sign-in page. */
export async function defaultServer(): Promise<string> {
  const info = await discover()
  return bundledJellyfin(info) ?? legacyJellyfinGuess()
}

/** React: discovery state. */
export function useFinesse(): { info: FinesseInfo | null; loading: boolean; refresh: () => void } {
  const [state, setState] = useState<{ info: FinesseInfo | null; loading: boolean }>(() => ({ info: known ?? null, loading: known === undefined }))
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    discover({ force: n > 0 }).then((info) => live && setState({ info, loading: false }))
    return () => {
      live = false
    }
  }, [n])
  // Stable, so effects can list it without re-running on every render.
  const refresh = useCallback(() => setN((x) => x + 1), [])
  return { ...state, refresh }
}

/** Turns what someone typed ("192.168.1.50", "nas.local:8080", "https://media.example.com")
 *  into candidate Finesse base URLs to probe, most likely first. */
export function candidateBases(input: string): string[] {
  let s = input.trim().replace(/\/+$/, '')
  if (!s) return []
  const hasScheme = /^https?:\/\//i.test(s)
  const out: string[] = []
  const add = (u: string) => {
    const b = u.replace(/\/+$/, '')
    const withFinesse = /\/finesse$/.test(b) ? `${b}/` : `${b}/finesse/`
    if (!out.includes(withFinesse)) out.push(withFinesse)
  }
  s = s.replace(/\/finesse$/, '')
  if (hasScheme) {
    add(s)
    return out
  }
  const hasPort = /:\d+$/.test(s)
  if (hasPort) {
    add(`http://${s}`)
    add(`https://${s}`)
  } else {
    add(`http://${s}:8080`)
    add(`https://${s}`)
    add(`http://${s}`)
    add(`http://${s}:30500`) // TrueNAS app installs from before 1.0
  }
  return out
}

/** Tries each candidate; returns the first that answers as Finesse (or an older Finesse web root). */
export async function findFinesse(input: string): Promise<{ base: string; info: FinesseInfo | null } | null> {
  for (const base of candidateBases(input)) {
    const info = await discover({ base })
    if (info) return { base, info }
    // Pre-1.0 servers (nginx) have no /api/finesse but do serve version.json.
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 4000)
      const r = await fetch(`${base}version.json`, { signal: ctrl.signal, cache: 'no-store' })
      clearTimeout(t)
      if (r.ok && /json/.test(r.headers.get('content-type') ?? '')) return { base, info: null }
    } catch {
      /* next */
    }
  }
  return null
}

/** webOS upgrade from ≤0.13: the TV used a built-in server address. Find the
 *  server next to the Jellyfin it's signed in to, remember it, return true. */
export async function migrateTvOrigin(): Promise<boolean> {
  if (!__WEBOS__ || CONTENT_BASE) return false
  let host = ''
  try {
    const s = JSON.parse(localStorage.getItem('finesse.session') ?? 'null') as { server?: string } | null
    if (s?.server) host = new URL(s.server).hostname
  } catch {
    /* no session */
  }
  if (!host) return false
  const found = await findFinesse(host)
  if (!found) return false
  setContentOrigin(found.base)
  return true
}
