// Calls to the Finesse server's own API (not Jellyfin's), signed in as this profile.

import { mediaBrowserAuthHeader } from './client'
import { finesseApi } from '../lib/finesseServer'

export class FinesseError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function finesseCall<T>(method: string, path: string, body?: unknown): Promise<T> {
  let r: Response
  try {
    r = await fetch(finesseApi(path), {
      method,
      headers: { Authorization: mediaBrowserAuthHeader(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new FinesseError(0, 'Can’t reach the Finesse server. Check your connection, then try again.')
  }
  const d = (await r.json().catch(() => ({}))) as T & { error?: string }
  if (!r.ok) throw new FinesseError(r.status, d.error || `Finesse answered ${r.status}`)
  return d
}
