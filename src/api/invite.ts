/** Client for Finesse native invite-service (proxied at /invite-api). */

import { mediaBrowserAuthHeader } from './client'
import { CONTENT_BASE } from '../lib/contentOrigin'
import { finesseRoot } from '../lib/finesseServer'

function inviteBase(): string {
  // Same place as the rest of the server API (the app's own base path on the
  // web; the remembered server address on a TV).
  return `${CONTENT_BASE}invite-api`
}

async function invFetch<T>(
  path: string,
  opts: { method?: string; body?: unknown; admin?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.admin) headers.Authorization = mediaBrowserAuthHeader()

  const res = await fetch(`${inviteBase()}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T
  if (!res.ok) {
    throw new InviteError(res.status, data.error || res.statusText || 'Request failed')
  }
  return data
}

export class InviteError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface InvitePublic {
  code: string
  status: 'pending' | 'used' | 'expired' | string
  label?: string | null
  libraries: string[]
  allow_downloads: boolean
  allow_live_tv: boolean
  expires_at?: string | null
}

export interface InviteAdmin extends InvitePublic {
  id: number
  created_at: string
  unlimited: boolean
  used: boolean
  used_at?: string | null
  used_by_username?: string | null
  created_by?: string | null
  library_ids: string[]
  max_active_sessions?: number | null
}

export function getInvite(code: string) {
  return invFetch<InvitePublic>(`/v1/invites/${encodeURIComponent(code)}`)
}

export function joinInvite(input: {
  code: string
  username: string
  password: string
  email?: string
}) {
  return invFetch<{ ok: boolean; username: string; user_id: string; message: string }>(
    '/v1/join',
    { method: 'POST', body: input },
  )
}

export function listInvites() {
  return invFetch<{ invites: InviteAdmin[]; count: number }>('/v1/invites', { admin: true })
}

export function listInviteLibraries() {
  return invFetch<{ libraries: { id: string; name: string }[] }>('/v1/libraries', {
    admin: true,
  })
}

export function createInvite(body: {
  code?: string
  label?: string
  library_ids: string[]
  expires_in_days?: number | null
  unlimited?: boolean
  allow_downloads?: boolean
  allow_live_tv?: boolean
}) {
  return invFetch<InviteAdmin>('/v1/invites', { method: 'POST', body, admin: true })
}

export function deleteInvite(id: number) {
  return invFetch<{ ok: boolean }>(`/v1/invites/${id}`, { method: 'DELETE', admin: true })
}

/** Shareable invite links: the public address (if Finesse has one) and the
 *  address this device uses right now (fine at home). */
export function inviteShareUrls(code: string, publicUrl?: string | null): { home: string; public: string | null } {
  const path = `finesse/invite/${encodeURIComponent(code)}`
  const root = finesseRoot()
  return {
    home: `${root}/${path}`,
    public: publicUrl ? `${publicUrl.replace(/\/+$/, '')}/${path}` : null,
  }
}

/** Emails an invite (needs email set up on the server). */
export function emailInvite(code: string, to: string, note?: string) {
  return invFetch<{ ok: boolean; to: string; link: string }>(`/v1/invites/${encodeURIComponent(code)}/email`, {
    method: 'POST',
    body: { to, note, origin: finesseRoot() },
    admin: true,
  })
}

// ---- Server self-update (admin) — see deploy/invite-service "Self-update" ----

export interface ServerUpdateStatus {
  /** Version nginx is serving; null for builds from before version.json (≤ 0.11). */
  current: string | null
  latest: string | null
  available: boolean
  notes?: string
  publishedAt?: string | null
  state: 'idle' | 'running' | 'restarting' | 'done' | 'error'
  step: 'checking' | 'backing up' | 'downloading' | 'verifying' | 'installing' | 'restarting' | null
  /** 'app' = the whole server updates (new image, restarts); 'web' = only the web app. */
  kind?: 'app' | 'web'
  /** Server version (Finesse server installs). */
  server?: string
  message: string
  version: string | null
  /** GitHub unreachable etc. — the status is still usable. */
  error?: string
}

export function getServerUpdate(): Promise<ServerUpdateStatus> {
  return invFetch<ServerUpdateStatus>('/v1/update', { admin: true })
}

export function startServerUpdate(): Promise<{ state: string }> {
  return invFetch<{ state: string }>('/v1/update', { method: 'POST', admin: true })
}
