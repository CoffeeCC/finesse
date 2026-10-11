// Which host runs the stack's apps: Docker (Linux and NAS installs, the
// default), or this PC's own Windows programs (FINESSE_HOST=native, set by the
// Finesse service on Windows).

import type { SettingsStore } from '../config.ts'
import { stackBase } from '../setup/apply.ts'
import type { StackServiceId } from './catalog.ts'
import { isNative, type StackHost } from './host.ts'
import { NativeHost } from './native.ts'
import { Orchestrator } from './orchestrator.ts'

export { isNative } from './host.ts'

export function createHost(settings: SettingsStore): StackHost {
  if (!isNative()) return new Orchestrator()
  return new NativeHost(stackBase().hostRoot, { askToStop: (id, url) => askToStop(settings, id, url) })
}

/** Each app's own "shut down" (databases close cleanly), with the key Finesse keeps for it. */
async function askToStop(settings: SettingsStore, id: StackServiceId, url: string): Promise<boolean> {
  const s = settings.get()
  const post = (path: string, headers: Record<string, string> = {}) =>
    fetch(url + path, { method: 'POST', headers, signal: AbortSignal.timeout(5000) }).then((r) => r.ok)
  switch (id) {
    case 'jellyfin':
      return s.jellyfin.apiKey ? post(`${s.jellyfin.basePath ?? '/jellyfin'}/System/Shutdown`, { Authorization: `MediaBrowser Token="${s.jellyfin.apiKey}"` }) : false
    case 'sonarr':
    case 'radarr':
    case 'lidarr':
    case 'prowlarr': {
      const key = s.services[id]?.apiKey
      return key ? post(`/api/${id === 'sonarr' || id === 'radarr' ? 'v3' : 'v1'}/system/shutdown`, { 'X-Api-Key': key }) : false
    }
    case 'sabnzbd': {
      const key = s.services.sabnzbd?.apiKey
      if (!key) return false
      return fetch(`${url}/api?${new URLSearchParams({ mode: 'shutdown', apikey: key, output: 'json' })}`, { signal: AbortSignal.timeout(5000) }).then((r) => r.ok)
    }
    case 'qbittorrent':
      // Finesse is on 127.0.0.1, which qBittorrent lets in without signing in.
      return post('/api/v2/app/shutdown')
    default:
      return false
  }
}
