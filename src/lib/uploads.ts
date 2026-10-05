// The Add media upload queue: lives outside any page, so uploads carry on while you browse.
// Dropped files wait in review until someone presses Add (wrong folder? nothing has moved yet).
// Then two files at a time, 16 MB chunks; a dropped connection retries, and the server says where
// to pick up (the same file dropped again later continues too). A file just added can be taken
// back with Remove for a day (the server's receipt for it).

import { useEffect, useState } from 'react'
import { mediaBrowserAuthHeader } from '../api/client'
import { finesseApi } from './finesseServer'
import type { Kind, Planned } from './mediaSort'

const CHUNK = 16 << 20
const PARALLEL = 2

export type Status = 'review' | 'waiting' | 'sending' | 'done' | 'skipped' | 'failed' | 'cancelled' | 'removing' | 'removed'

export interface Job extends Planned {
  /** The server's id for this upload, once it's started. */
  id?: string
  status: Status
  sent: number
  error?: string
  /** Where it ended up, inside its library. */
  placed?: string
  /** The server's receipt for a file it added: what Remove needs. */
  receipt?: string
}

interface State {
  jobs: Job[]
  /** Bytes a second, averaged over the last few chunks. */
  speed: number
}

let state: State = { jobs: [], speed: 0 }
const listeners = new Set<() => void>()
let running = 0
const samples: { at: number; bytes: number }[] = []

function emit() {
  state = { ...state, jobs: [...state.jobs] }
  listeners.forEach((l) => l())
}

function patch(key: string, p: Partial<Job>) {
  const i = state.jobs.findIndex((j) => j.key === key)
  if (i >= 0) state.jobs[i] = { ...state.jobs[i]!, ...p }
  emit()
}

async function api<T>(method: string, path: string, body?: BodyInit, json = true): Promise<T> {
  const headers: Record<string, string> = { Authorization: mediaBrowserAuthHeader() }
  if (json && body) headers['Content-Type'] = 'application/json'
  if (!json) headers['Content-Type'] = 'application/octet-stream'
  const res = await fetch(finesseApi(path), { method, headers, body })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; details?: { offset?: number } }
  if (!res.ok) throw Object.assign(new Error(data.error || `Finesse answered ${res.status}`), { status: res.status, offset: data.details?.offset })
  return data
}

export interface MediaInfo {
  available: boolean
  free?: number | null
  folder?: string
  games?: boolean
}
export const mediaInfo = () => api<MediaInfo>('GET', '/api/media/info')

/** Puts dropped files up for review (ones already in the list are left alone). Nothing is sent yet. */
export function enqueue(items: Planned[]) {
  const have = new Set(state.jobs.filter((j) => j.status !== 'cancelled' && j.status !== 'failed' && j.status !== 'removed').map((j) => j.key))
  const fresh = items.filter((i) => !have.has(i.key)).map((i): Job => ({ ...i, status: 'review', sent: 0 }))
  state.jobs = [...state.jobs.filter((j) => !fresh.some((f) => f.key === j.key)), ...fresh]
  emit()
}

/** Add: everything in review goes (files marked "not added" stay behind). */
export function confirmReview() {
  state.jobs = state.jobs.map((j) => (j.status !== 'review' ? j : { ...j, status: j.kind === 'skip' ? 'skipped' : 'waiting' }))
  emit()
  pump()
}

/** Changed your mind about the whole drop. */
export function discardReview() {
  state.jobs = state.jobs.filter((j) => j.status !== 'review')
  emit()
}

/** Takes back a file that was just added: deleted on the server, gone from the library. */
export async function remove(key: string) {
  const j = state.jobs.find((x) => x.key === key)
  if (!j?.receipt) return
  patch(key, { status: 'removing' })
  try {
    await api('DELETE', `/api/media/files/${encodeURIComponent(j.receipt)}`)
    patch(key, { status: 'removed', receipt: undefined })
  } catch (e) {
    patch(key, { status: 'done', error: (e as Error).message })
  }
}

/** Changes where a waiting file goes (and the subtitles or posters that follow it). */
export function move(key: string, kind: Kind, path: string, system?: string) {
  const j = state.jobs.find((x) => x.key === key)
  if (!j || (j.status !== 'review' && j.status !== 'waiting' && j.status !== 'skipped' && j.status !== 'failed')) return
  const status: Status = j.status === 'review' ? 'review' : kind === 'skip' ? 'skipped' : 'waiting'
  patch(key, { kind, path, system, status, note: kind === 'games' && !system ? 'Pick the console' : kind === 'skip' ? 'Won’t be added' : undefined, error: undefined })
  for (const f of state.jobs.filter((x) => x.follows === key && (x.status === 'waiting' || x.status === 'review'))) {
    const name = f.path.slice(f.path.lastIndexOf('/') + 1)
    patch(f.key, { kind, path: `${path.includes('/') ? path.slice(0, path.lastIndexOf('/')) + '/' : ''}${name}` })
  }
  pump()
}

export function cancel(key: string) {
  const j = state.jobs.find((x) => x.key === key)
  if (!j) return
  patch(key, { status: 'cancelled' })
  if (j.id) void api('DELETE', `/api/media/uploads/${j.id}`).catch(() => {})
}

export function retry(key: string) {
  patch(key, { status: 'waiting', error: undefined })
  pump()
}

/** Clears finished, skipped and cancelled rows from the list. */
export function tidy() {
  state.jobs = state.jobs.filter((j) => j.status === 'review' || j.status === 'waiting' || j.status === 'sending' || j.status === 'failed' || j.status === 'removing')
  emit()
}

export const busy = () => state.jobs.some((j) => j.status === 'waiting' || j.status === 'sending')

function pump() {
  while (running < PARALLEL) {
    const next = state.jobs.find((j) => j.status === 'waiting' && !(j.kind === 'games' && !j.system))
    if (!next) return
    running++
    patch(next.key, { status: 'sending' })
    void send(next.key).finally(() => {
      running--
      pump()
    })
  }
}

async function send(key: string) {
  const job = () => state.jobs.find((j) => j.key === key)!
  let tries = 0
  try {
    const j = job()
    const begun = await api<{ id: string | null; offset: number; done: boolean; skipped?: boolean; path: string; receipt?: string }>('POST', '/api/media/uploads', JSON.stringify({ kind: j.kind, path: j.path, size: j.file.size }))
    if (begun.done) return patch(key, { status: 'done', sent: j.file.size, placed: begun.path, receipt: begun.receipt, note: begun.skipped ? 'Already in your library' : undefined })
    patch(key, { id: begun.id!, sent: begun.offset })
    let offset = begun.offset
    while (offset < j.file.size) {
      if (job().status === 'cancelled') return
      const end = Math.min(offset + CHUNK, j.file.size)
      try {
        const r = await api<{ offset: number; done: boolean; path: string; receipt?: string }>('PUT', `/api/media/uploads/${begun.id}?offset=${offset}`, j.file.slice(offset, end), false)
        sample(r.offset - offset)
        offset = r.offset
        tries = 0
        patch(key, { sent: offset })
        if (r.done) return patch(key, { status: 'done', placed: r.path, receipt: r.receipt })
      } catch (e) {
        const err = e as Error & { status?: number; offset?: number }
        // Out of step (a chunk half-arrived before the connection dropped): carry on from the server's count.
        if (err.status === 409 && typeof err.offset === 'number') {
          offset = err.offset
          continue
        }
        if (err.status && err.status < 500 && err.status !== 408) throw err
        if (++tries > 6) throw err
        await new Promise((r) => setTimeout(r, Math.min(30000, 1000 * 2 ** tries)))
      }
    }
  } catch (e) {
    if (job().status !== 'cancelled') patch(key, { status: 'failed', error: (e as Error).message === 'Failed to fetch' ? 'Lost the connection to Finesse' : (e as Error).message })
  }
}

function sample(bytes: number) {
  const now = performance.now()
  samples.push({ at: now, bytes })
  while (samples.length > 1 && now - samples[0]!.at > 8000) samples.shift()
  const span = (now - samples[0]!.at) / 1000
  state.speed = span > 0.5 ? samples.reduce((a, s) => a + s.bytes, 0) / span : state.speed
}

export function useUploads(): State {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => void listeners.delete(l)
  }, [])
  return state
}

// Closing the tab mid-upload: the browser asks first.
window.addEventListener('beforeunload', (e) => {
  if (!busy()) return
  e.preventDefault()
  e.returnValue = ''
})
