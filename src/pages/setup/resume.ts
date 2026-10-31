// Leaving setup half-way and coming back. In the same tab everything is still there (the draft
// and the code live in sessionStorage). Across visits, this browser keeps the choices and the
// step reached, but never a password or key: those steps ask for them again.
// No imports (the wizard's Draft and StepId fit these shapes), so server/test/setup-resume.test.ts
// can test it.

type StepId = 'welcome' | 'start' | 'machine' | 'account' | 'libraries' | 'downloads' | 'usenet' | 'vpn' | 'indexers' | 'quality' | 'remote' | 'email' | 'review'

/** Where the wizard's draft keeps passwords and keys (draft.ts Draft has these, and more). */
export interface SecretFields {
  admin: { password: string; confirm: string }
  games: { steamGridDbKey: string; igdbClientSecret: string }
  servers: { password: string }[]
  indexers: { apiKey?: string }[]
  vpn: { privateKey: string; presharedKey: string; password: string }
  tailscale: { authKey: string }
  cloudflare: { token: string }
  email: { password: string }
}

export const PROGRESS_KEY = 'finesse.setupProgress'
/** Older than this, a half-finished setup starts over. */
export const PROGRESS_MAX_AGE_MS = 14 * 86_400_000

export interface SavedProgress<D extends SecretFields = SecretFields> {
  v: 1
  /** The server it was for (discovery's instanceId): another server never picks it up. */
  instance: string
  step: StepId
  draft: D
  /** Steps that had a password or key, which wasn't kept. */
  reenter: StepId[]
  at: number
}

/** The draft without passwords and keys, and which steps had one. */
export function withoutSecrets<D extends SecretFields>(d: D): { draft: D; reenter: StepId[] } {
  const x = JSON.parse(JSON.stringify(d)) as D
  const reenter = new Set<StepId>()
  const drop = (o: object, k: string, step: StepId) => {
    const rec = o as Record<string, unknown>
    if (typeof rec[k] === 'string' && rec[k] !== '') {
      rec[k] = ''
      reenter.add(step)
    }
  }
  drop(x.admin, 'password', 'account')
  drop(x.admin, 'confirm', 'account')
  drop(x.games, 'steamGridDbKey', 'libraries')
  drop(x.games, 'igdbClientSecret', 'libraries')
  for (const s of x.servers) drop(s, 'password', 'usenet')
  for (const ix of x.indexers) drop(ix, 'apiKey', 'indexers')
  drop(x.vpn, 'privateKey', 'vpn')
  drop(x.vpn, 'presharedKey', 'vpn')
  drop(x.vpn, 'password', 'vpn')
  drop(x.tailscale, 'authKey', 'remote')
  drop(x.cloudflare, 'token', 'remote')
  drop(x.email, 'password', 'email')
  return { draft: x, reenter: [...reenter] }
}

export function progressFor<D extends SecretFields>(instance: string, step: StepId, d: D, now = Date.now()): SavedProgress<D> {
  const { draft, reenter } = withoutSecrets(d)
  return { v: 1, instance, step, draft, reenter, at: now }
}

/** A saved setup for this server, if there's a recent one. */
export function readProgress<D extends SecretFields>(raw: string | null, instance: string, now = Date.now()): SavedProgress<D> | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as SavedProgress<D>
    if (p?.v !== 1 || p.instance !== instance || typeof p.step !== 'string' || !p.draft) return null
    if (!(now - p.at < PROGRESS_MAX_AGE_MS)) return null
    return { ...p, reenter: Array.isArray(p.reenter) ? p.reenter : [] }
  } catch {
    return null
  }
}

/**
 * Where to pick up: the step reached, unless an earlier one is now incomplete (a password to
 * enter again, a check that fails now), then that one. Never the welcome step (index 0): the
 * code has just been entered. `steps` is the wizard's list for the draft being resumed.
 */
export function resumeIndex(steps: StepId[], saved: StepId | null | undefined, blocker: (s: StepId) => string | null, reenter: StepId[] = []): number {
  const target = saved ? steps.indexOf(saved) : -1
  if (target <= 1) return 1
  for (let i = 1; i < target; i++) {
    const s = steps[i]!
    if (blocker(s) || reenter.includes(s)) return i
  }
  return target
}

/** What a step asks for again, in words, after a resume. */
export const REENTER_WHAT: Partial<Record<StepId, string>> = {
  account: 'your password',
  libraries: 'the game artwork keys',
  usenet: 'your Usenet password',
  vpn: 'your VPN key or password',
  indexers: 'your search sites’ API keys',
  remote: 'the Tailscale key or tunnel token',
  email: 'the email password',
}
