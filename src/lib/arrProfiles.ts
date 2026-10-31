// Which quality profile (and root folder) a new request goes to in Radarr, Sonarr or Lidarr.
// Setup saves the profile each app should use (server: settings.requests.profiles, from the
// quality preset; the app reads it from /api/finesse). Requests must use that choice: when it
// is gone from the app, say so and how to fix it rather than quietly picking another quality.
// Only when nothing was chosen (Finesse added to apps someone set up themselves) does the old
// guess apply. Pure, so it can be tested on its own (server/test/arr-profiles.test.ts).

export type ArrKindName = 'movie' | 'series' | 'artist'

export interface ArrProfile {
  id: number
  name: string
}

export interface ArrRoot {
  path: string
}

export type ArrPick =
  | { ok: true; profile: ArrProfile; root: ArrRoot; /** The profile was the one chosen in setup (not a guess). */ saved: boolean }
  | { ok: false; problem: string }

const APP_NAME: Record<ArrKindName, string> = { movie: 'Radarr', series: 'Sonarr', artist: 'Lidarr' }
/** The keys setup saves the profiles under (settings.requests.profiles). */
export const PROFILE_KEY: Record<ArrKindName, 'radarr' | 'sonarr' | 'lidarr'> = { movie: 'radarr', series: 'sonarr', artist: 'lidarr' }

const norm = (s: string) => s.trim().toLowerCase()

/** No saved choice: prefer 1080p for films and shows, Lossless then Standard for music. */
function guess(kind: ArrKindName, profiles: ArrProfile[]): ArrProfile | undefined {
  return kind === 'artist'
    ? profiles.find((p) => /lossless/i.test(p.name)) ?? profiles.find((p) => /standard/i.test(p.name)) ?? profiles[0]
    : profiles.find((p) => /1080/.test(p.name)) ?? profiles.find((p) => p.id === 4) ?? profiles[0]
}

/** The saved choice for one app (GET /api/requests/defaults; server/src/requestDefaults.ts). */
export interface SavedChoice {
  profileName?: string
  /** Chosen in Settings → Downloads: the app's own id for the profile. */
  profileId?: number
  rootFolder?: string
  source?: 'settings' | 'setup' | 'none'
  /** A Settings choice made for a different app at this address. */
  stale?: boolean
}

const trimSlash = (s: string) => s.replace(/[\\/]+$/, '')

/**
 * The profile and root folder for a new request.
 * `saved`: what was chosen for this app (a profile name from setup, or a Settings → Downloads
 * choice by id and folder); nothing means nothing was chosen.
 */
export function pickArrConfig(kind: ArrKindName, profiles: ArrProfile[], roots: ArrRoot[], saved?: string | SavedChoice | null): ArrPick {
  const app = APP_NAME[kind]
  const choice: SavedChoice = typeof saved === 'string' ? { profileName: saved } : saved ?? {}
  // The folder: the chosen one, which must still be there; otherwise the app's first.
  let root: ArrRoot | undefined = roots[0]
  if (choice.rootFolder) {
    root = roots.find((r) => trimSlash(r.path) === trimSlash(choice.rootFolder!))
    if (!root) return { ok: false, problem: `${app} no longer has the folder chosen in Settings → Downloads. Pick a folder there again, then request again.` }
  }
  if (!root) return { ok: false, problem: `${app} has no folder to download to yet. Add a root folder in ${app} (Settings → Media Management), then request again.` }
  // The choice was made for another app at this address (moved, replaced): never guess for it.
  if (choice.stale) return { ok: false, problem: `${app} has changed since its quality was chosen in Settings → Downloads. Pick one there again, then request again.` }
  if (choice.profileId) {
    const profile = profiles.find((p) => p.id === choice.profileId)
    if (profile) return { ok: true, profile, root, saved: true }
    return { ok: false, problem: `${app} no longer has the “${choice.profileName ?? 'chosen'}” quality chosen in Settings → Downloads. Pick one there again, then request again.` }
  }
  const wanted = choice.profileName?.trim()
  if (wanted) {
    const profile = profiles.find((p) => norm(p.name) === norm(wanted))
    if (profile) return { ok: true, profile, root, saved: true }
    return {
      ok: false,
      // Short: the request pages show the first 180 characters.
      problem: `${app} no longer has the “${wanted}” quality chosen in setup. Add it back in ${app}, or pick a quality again in setup, then request again.`,
    }
  }
  const profile = guess(kind, profiles)
  if (!profile) return { ok: false, problem: `${app} has no quality profiles. Add one in ${app} (Settings → Profiles), then request again.` }
  return { ok: true, profile, root, saved: false }
}
