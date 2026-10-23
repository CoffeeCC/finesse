// "Report a problem": turns what someone wrote, plus (if they agree) details about this device and
// the server, into a GitHub issue on Finesse's bug form, filled in. Nothing is sent from here: the
// person sees all of it, then opens GitHub themselves.

import type { ServerReport } from '../api/setup'
import { PROJECT_URL } from './project'

/** GitHub refuses very long links; keep well under its limit by trimming the oldest log lines. */
const MAX_URL = 7000

export interface DeviceDetails {
  app: string
  device: string
  browser: string
  screen: string
}

export function deviceDetails(kind: string): DeviceDetails {
  const nav = typeof navigator !== 'undefined' ? navigator : null
  return {
    app: __APP_VERSION__,
    device: kind,
    browser: nav?.userAgent ?? 'unknown',
    screen: typeof window !== 'undefined' ? `${window.screen.width}×${window.screen.height} @${window.devicePixelRatio}x` : 'unknown',
  }
}

/** The text of the "Relevant logs" box: device, server and its recent problems. */
export function detailsText(device: DeviceDetails | null, server: ServerReport | null, serverVersion: string | null, problems?: string[]): string {
  const lines: string[] = []
  if (device) {
    lines.push(`App: ${device.app} on ${device.device}`, `Browser: ${device.browser}`, `Screen: ${device.screen}`)
  }
  if (server) {
    lines.push(
      `Server: Finesse ${server.version} (web ${server.web}), ${server.mode} on ${server.platform}, Node ${server.node}`,
      `Setup: ${server.setup}; on: ${server.features.join(', ') || 'nothing extra'}; up ${server.uptimeHours} h`,
    )
    const list = problems ?? server.problems
    if (list.length) lines.push('', `Recent warnings and errors (${list.length}):`, ...list)
    else lines.push('', 'No warnings or errors since the server started.')
  } else if (serverVersion) {
    lines.push(`Server: Finesse ${serverVersion}`)
  }
  return lines.join('\n')
}

export function issueUrl(what: string, details: string): string {
  const title = (what.trim().split('\n')[0] ?? '').slice(0, 80) || 'Something isn’t working'
  const version = details.match(/^App: (\S+)/m)?.[1]
  const server = details.match(/^Server: Finesse (\S+)/m)?.[1]
  const build = (logs: string) => {
    const q = new URLSearchParams({ template: 'bug.yml', title, what: what.trim().slice(0, 3000) })
    const v = [version && `${version} (app)`, server && `${server} (server)`].filter(Boolean).join(' · ')
    if (v) q.set('version', v)
    if (logs) q.set('logs', logs)
    return `${PROJECT_URL}/issues/new?${q.toString()}`
  }
  let logs = details
  let url = build(logs)
  // Too long: drop the oldest log lines first, then cut what's left.
  while (url.length > MAX_URL && logs.includes('\n')) {
    const lines = logs.split('\n')
    const start = lines.findIndex((l) => l.startsWith('Recent warnings'))
    if (start >= 0 && start + 1 < lines.length - 1) lines.splice(start + 1, 1)
    else lines.pop()
    logs = lines.join('\n')
    url = build(logs)
  }
  return url.length > MAX_URL ? build('') : url
}
