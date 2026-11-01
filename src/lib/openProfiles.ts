// Profiles with no password, remembered on this device.
//
// Jellyfin 10.9+ no longer says whether an account has a password: /Users/Public reports
// HasPassword: true for everyone. Trying an empty password on every pick isn't safe (each
// miss counts toward Jellyfin's lockout), so the app remembers which profiles it has seen
// open with no password (signed in with an empty one, or created here without one) and
// opens those with one click. If one gets a password later, the first miss forgets it.

export interface KeyStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const KEY = 'finesse.openProfiles'
const MAX = 200

const id = (server: string, userId: string) => `${server.replace(/\/+$/, '').toLowerCase()}|${userId.toLowerCase()}`

function read(store: KeyStore): string[] {
  try {
    const v = JSON.parse(store.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function write(store: KeyStore, list: string[]) {
  try {
    store.setItem(KEY, JSON.stringify(list.slice(-MAX)))
  } catch {
    /* storage full or blocked: nothing remembered, nothing broken */
  }
}

/** Whether this profile is known to open with no password. */
export function isOpenProfile(store: KeyStore, server: string, userId: string): boolean {
  return read(store).includes(id(server, userId))
}

/** Remember (open = true) or forget (false) that this profile has no password. */
export function rememberOpenProfile(store: KeyStore, server: string, userId: string, open: boolean): void {
  const k = id(server, userId)
  const list = read(store).filter((x) => x !== k)
  if (open) list.push(k)
  write(store, list)
}

/**
 * What picking a profile does: sign straight in, or ask for its password. Old Jellyfin
 * that still says HasPassword: false is believed; otherwise only a remembered open profile
 * skips the prompt.
 */
export function pickAction(store: KeyStore, server: string, user: { Id: string; HasPassword?: boolean }): 'sign-in' | 'ask' {
  if (user.HasPassword === false) return 'sign-in'
  return isOpenProfile(store, server, user.Id) ? 'sign-in' : 'ask'
}
