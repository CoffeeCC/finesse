// "Report a problem" (Settings → About): what an administrator can add to a bug report about this
// server. Versions, how it runs, what's switched on, and its last warnings and errors, with
// anything private taken out first. Nothing is sent anywhere: the app shows it, and the person
// decides whether to open a GitHub issue with it.

import { arch, platform } from 'node:os'
import type { Auth } from './auth.ts'
import type { Settings, SettingsStore } from './config.ts'
import { sendJson, type Router } from './http/core.ts'
import { recentProblems } from './log.ts'

/** Takes out what a public bug report shouldn't carry: keys and tokens, addresses, emails, names in paths. */
export function redact(text: string, s?: Pick<Settings, 'publicUrl'>): string {
  let t = text
  const pub = s?.publicUrl ? safeHost(s.publicUrl) : null
  if (pub) t = t.split(pub).join('<your address>')
  return t
    .replace(/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, '<email>')
    .replace(/\b(token|api[_-]?key|apikey|password|pw|secret|authorization)(["'\s:=]+)("[^"]*"|'[^']*'|[^\s,&;"'}]+)/gi, '$1$2<hidden>')
    .replace(/\b(Token|Bearer|FinessePeer)\s+[^\s,"']+/g, '$1 <hidden>')
    .replace(/\b[0-9a-f]{32,}\b/gi, '<hidden>')
    .replace(/\btskey-[\w-]+/g, '<hidden>')
    .replace(/\b[\w-]+\.[\w-]+\.ts\.net\b/gi, '<tailnet name>')
    .replace(/\b(?!(?:10|127)\.)(?!192\.168\.)(?!172\.(?:1[6-9]|2\d|3[01])\.)(?!100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '<public IP>')
    .replace(/([A-Za-z]:\\Users\\)[^\\\s"']+/g, '$1<you>')
    .replace(/(\/home\/)[^/\s"']+/g, '$1<you>')
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host || null
  } catch {
    return null
  }
}

export interface ServerReport {
  version: string
  web: string
  mode: string
  platform: string
  node: string
  setup: string
  features: string[]
  uptimeHours: number
  problems: string[]
}

export function serverReport(s: Settings, info: { version: string; web: string; features: Record<string, unknown> }): ServerReport {
  return {
    version: info.version,
    web: info.web,
    mode: String(s.mode),
    platform: `${platform()} ${arch()}`,
    node: process.version,
    setup: String(s.setup?.state ?? 'unknown'),
    features: Object.entries(info.features).filter(([, on]) => !!on).map(([k]) => k).sort(),
    uptimeHours: Math.round((process.uptime() / 3600) * 10) / 10,
    problems: recentProblems().slice(-30).map((l) => redact(l, s)),
  }
}

export function registerReport(
  router: Router,
  deps: { settings: SettingsStore; auth: Auth; info: () => { version: string; web: string; features: Record<string, unknown> } },
) {
  router.get('/api/report', async ({ req, res }) => {
    await deps.auth.requireAdmin(req)
    sendJson(res, 200, serverReport(deps.settings.get(), deps.info()))
  })
}
