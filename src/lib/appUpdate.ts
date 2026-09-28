import { useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getServerUpdate, startServerUpdate, type ServerUpdateStatus } from '../api/invite'
import { useAuth } from '../auth/AuthContext'
import { checkForUpdate, cmpVersion, downloadAndStage, type UpdateInfo } from './webosUpdate'

// "Update Finesse", end to end:
//   1. Merging a version bump publishes a GitHub release (.github/workflows/release.yml).
//   2. An admin presses Update → the NAS installs that release's web build
//      (deploy/invite-service, /v1/update) — useServerUpdate + beginServerUpdate.
//   3. Everyone else is offered "Update ready" — useClientUpdate: browsers reload
//      into the build the NAS now serves; the webOS app pulls its OTA bundle.

export interface ClientUpdate {
  version: string
  /** reload = the NAS serves a newer web build; ota = a newer TV bundle on GitHub. */
  kind: 'reload' | 'ota'
  ota?: UpdateInfo
}

async function deployedVersion(): Promise<string | null> {
  const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) return null
  const data = (await res.json().catch(() => null)) as { version?: unknown } | null
  return typeof data?.version === 'string' ? data.version : null
}

const HOUR = 3_600_000

/** Is there a newer Finesse than the one running here? */
export function useClientUpdate() {
  return useQuery({
    queryKey: ['clientUpdate'],
    queryFn: async (): Promise<ClientUpdate | null> => {
      if (__WEBOS__) {
        const info = await checkForUpdate()
        return info.available ? { version: info.latest, kind: 'ota', ota: info } : null
      }
      const v = await deployedVersion()
      return v && cmpVersion(v, __APP_VERSION__) > 0 ? { version: v, kind: 'reload' } : null
    },
    // The TV asks GitHub (60 requests/hour per address), so rarely; browsers ask the NAS.
    staleTime: __WEBOS__ ? 6 * HOUR : 10 * 60_000,
    refetchInterval: __WEBOS__ ? 6 * HOUR : 30 * 60_000,
    refetchOnWindowFocus: !__WEBOS__,
    retry: false,
  })
}

/** Web: reload into the new build. TV: download + stage the bundle, then relaunch. */
export async function applyClientUpdate(u: ClientUpdate): Promise<void> {
  if (u.kind === 'ota' && u.ota) await downloadAndStage(u.ota)
  window.location.reload()
}

/** Admins on the web app: what the NAS serves vs the latest release. The TV app
 *  runs off file:// with no route to the invite service, so it only self-updates. */
export function useServerUpdate() {
  const { session } = useAuth()
  const enabled = !__WEBOS__ && !!session?.isAdmin
  return useQuery({
    queryKey: ['serverUpdate'],
    queryFn: getServerUpdate,
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
  })
}

// ---- The admin's update run (one at a time, shown by ServerUpdateOverlay) ----

export type ServerRun =
  | { phase: 'idle' }
  | { phase: 'running'; version: string | null; step: ServerUpdateStatus['step']; kind?: 'app' | 'web' }
  | { phase: 'done'; version: string | null }
  | { phase: 'error'; message: string }

let run: ServerRun = { phase: 'idle' }
const listeners = new Set<() => void>()
const setRun = (next: ServerRun) => {
  run = next
  listeners.forEach((l) => l())
}

export function useServerRun(): ServerRun {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => run,
  )
}

export function dismissServerRun() {
  if (run.phase !== 'running') setRun({ phase: 'idle' })
}

/** Start the server update and follow it; reloads this tab into the new build when done.
 *  A web update swaps files in place; an app update (Finesse server installs)
 *  replaces the whole container, so the server disappears for a moment. */
export async function beginServerUpdate(version: string | null, kind: 'app' | 'web' = 'web'): Promise<void> {
  if (run.phase === 'running') return
  setRun({ phase: 'running', version, step: 'checking', kind })
  try {
    await startServerUpdate()
  } catch (e) {
    // 409 = already running (another admin, another tab): just follow it.
    if (!(e instanceof Error && 'status' in e && (e as { status: number }).status === 409)) {
      setRun({ phase: 'error', message: e instanceof Error ? e.message : 'Could not start the update' })
      return
    }
  }
  const started = Date.now()
  let restartingSince = 0
  const newer = (a?: string | null, b?: string | null) => Boolean(a && b && a.localeCompare(b, undefined, { numeric: true }) >= 0)
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500))
    let s: ServerUpdateStatus
    try {
      s = await getServerUpdate()
    } catch (e) {
      // The server is busy writing files, or (app update) restarting.
      if (Date.now() - started < 120_000 || (restartingSince && Date.now() - restartingSince < 300_000)) continue
      setRun({ phase: 'error', message: e instanceof Error ? e.message : 'Lost contact with the server' })
      return
    }
    if (s.state === 'restarting') {
      restartingSince ||= Date.now()
      setRun({ phase: 'running', version: s.version ?? version, step: 'restarting', kind: 'app' })
      continue
    }
    if (s.state === 'running') {
      setRun({ phase: 'running', version: s.version ?? version, step: s.step, kind: s.kind ?? kind })
      continue
    }
    if (restartingSince) {
      // A fresh server answered: did it come back on the new version?
      if (newer(s.server, version)) {
        setRun({ phase: 'done', version: s.server ?? version })
        window.setTimeout(() => window.location.reload(), 1500)
        return
      }
      if (Date.now() - restartingSince < 240_000) continue
      setRun({ phase: 'error', message: 'The new version didn’t start, so Finesse went back to the previous one. Your settings are untouched.' })
      return
    }
    if (s.state !== 'done') {
      // error — or idle: the service restarted mid-run and lost track of it.
      setRun({ phase: 'error', message: s.message || 'The update was interrupted — try again' })
      return
    }
    setRun({ phase: 'done', version: s.current ?? s.version ?? version })
    window.setTimeout(() => window.location.reload(), 1500)
    return
  }
}
