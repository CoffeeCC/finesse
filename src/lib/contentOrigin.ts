// Where the Finesse server lives. It serves the API proxies (Radarr/Sonarr/
// SAB with keys injected), invites, setup, preview clips — and Jellyfin
// itself at /jellyfin. In the web build that's just the app's own base path
// (/finesse/). The webOS app runs from file://, so it remembers the address
// the person connected to (see lib/finesseServer + pages/TvConnectPage).

export const CONTENT_ORIGIN_KEY = 'finesse.contentOrigin'

function resolve(): string {
  if (!__WEBOS__) return import.meta.env.BASE_URL
  try {
    const stored = localStorage.getItem(CONTENT_ORIGIN_KEY)
    if (stored) return stored.endsWith('/') ? stored : stored + '/'
  } catch {
    /* localStorage may be unavailable */
  }
  return '' // not connected yet
}

/** Base URL for server-hosted (non-bundled) resources. Ends in a slash; '' on a TV that hasn't connected yet. */
export const CONTENT_BASE = resolve()

/** Remembers the Finesse address on a TV (takes effect after a reload). */
export function setContentOrigin(base: string | null) {
  try {
    if (base) localStorage.setItem(CONTENT_ORIGIN_KEY, base.endsWith('/') ? base : base + '/')
    else localStorage.removeItem(CONTENT_ORIGIN_KEY)
  } catch {
    /* ignore */
  }
}
