// Some resources aren't part of the app bundle — they're served by the Finesse
// *origin* on the NAS: the Radarr/Sonarr request proxy (nginx injects the API
// keys) and the pre-generated preview clips under /previews/. In the web build
// that origin is just the app's own base path (/finesse/). In the webOS build
// the app runs from file://, so these have to point at the deployed server.
//
// Defaults to the LAN nginx; override at runtime via localStorage if the box
// ever moves (Settings → could expose this later).
const DEFAULT_WEBOS_CONTENT_ORIGIN = 'http://192.168.1.121:30500/finesse/'

function resolve(): string {
  if (!__WEBOS__) return import.meta.env.BASE_URL
  try {
    const override = localStorage.getItem('finesse.contentOrigin')
    if (override) return override.endsWith('/') ? override : override + '/'
  } catch {
    /* localStorage may be unavailable */
  }
  return DEFAULT_WEBOS_CONTENT_ORIGIN
}

/** Base URL for server-hosted (non-bundled) resources. Always ends in a slash. */
export const CONTENT_BASE = resolve()
