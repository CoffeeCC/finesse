/** Client for Finesse native invite-service (proxied at /invite-api). */

import { mediaBrowserAuthHeader } from './client'

function inviteBase(): string {
  // When served under /finesse/, API is same-origin at /invite-api (after nginx rewrite)
  // or /finesse/invite-api before rewrite — nginx normalizes both.
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  // Prefer absolute path from site root so Funnel + LAN both work
  if (base && base !== '/') {
    return `${base}/invite-api`
  }
  return '/invite-api'
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

/** Build shareable invite URLs for LAN + Funnel. */
export function inviteShareUrls(code: string): { lan: string; funnel: string } {
  const path = `/finesse/invite/${encodeURIComponent(code)}`
  return {
    lan: `http://192.168.1.121:30500${path}`,
    funnel: `https://truenas-scale.taild65e2.ts.net:10000${path}`,
  }
}
