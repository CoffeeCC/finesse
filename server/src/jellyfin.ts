// Server-side Jellyfin client. Uses the modern `Authorization: MediaBrowser …`
// header (the legacy X-Emby-Token form can be disabled on newer servers).

import type { SettingsStore } from './config.ts'
import { ApiError } from './http/core.ts'

declare const __FINESSE_VERSION__: string
export const VERSION: string = typeof __FINESSE_VERSION__ === 'string' ? __FINESSE_VERSION__ : process.env.FINESSE_VERSION || '0.0.0-dev'

export class JfError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(`${status}: ${message}`)
    this.status = status
  }
}

export function mediaBrowserHeader(token?: string, device = 'finesse-server', deviceName = device): string {
  // Header values must be plain ASCII (names like "Sam’s server" come from phones).
  const clean = (v: string) =>
    v
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u00b7\u2022]/g, '-')
      .normalize('NFKD')
      .replace(/[^\x20-\x7e]|["\\]/g, '')
  const parts = [`Client="Finesse"`, `Device="${clean(deviceName)}"`, `DeviceId="${clean(device)}"`, `Version="${VERSION}"`]
  if (token) parts.push(`Token="${token}"`)
  return `MediaBrowser ${parts.join(', ')}`
}

export interface JfUser {
  Id: string
  Name: string
  Policy?: { IsAdministrator?: boolean; [k: string]: unknown }
  [k: string]: unknown
}

export class Jellyfin {
  private settings: SettingsStore

  constructor(settings: SettingsStore) {
    this.settings = settings
  }

  /** Base URL including Jellyfin's own base path (e.g. http://jellyfin:8096/jellyfin). */
  base(): string {
    const j = this.settings.get().jellyfin
    if (!j.url) throw new ApiError(503, 'Jellyfin is not configured yet')
    return j.url.replace(/\/+$/, '') + (j.basePath || '')
  }

  apiKey(): string | undefined {
    return this.settings.get().jellyfin.apiKey
  }

  async request<T = unknown>(
    path: string,
    opts: { method?: string; body?: unknown; token?: string; timeoutMs?: number; base?: string; deviceId?: string; deviceName?: string } = {},
  ): Promise<T> {
    const token = opts.token ?? this.apiKey()
    const url = (opts.base ?? this.base()) + path
    const headers: Record<string, string> = { Accept: 'application/json', Authorization: mediaBrowserHeader(token, opts.deviceId, opts.deviceName) }
    let body: string | undefined
    if (opts.body !== undefined) {
      body = JSON.stringify(opts.body)
      headers['Content-Type'] = 'application/json'
    }
    let res: Response
    try {
      res = await fetch(url, { method: opts.method ?? 'GET', headers, body, signal: AbortSignal.timeout(opts.timeoutMs ?? 30000) })
    } catch (e) {
      throw new JfError(0, `Couldn't reach Jellyfin (${(e as Error).message})`)
    }
    const text = await res.text()
    if (!res.ok) throw new JfError(res.status, text || res.statusText)
    if (!text) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      return text as T
    }
  }

  /** The user a token belongs to, or null if Jellyfin rejects it. */
  async me(token: string): Promise<JfUser | null> {
    try {
      return await this.request<JfUser>('/Users/Me', { token, timeoutMs: 10000 })
    } catch (e) {
      if (e instanceof JfError && (e.status === 401 || e.status === 403 || e.status === 400)) return null
      throw e
    }
  }
}
