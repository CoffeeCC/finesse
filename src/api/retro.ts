// Client + React Query hooks for Finesse's Retro ROM Store, Downloads, Sources & Folder Import (/api/retro/*).

import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { mediaBrowserAuthHeader } from './client'
import { finesseApi } from '../lib/finesseServer'

export class RetroApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function call<T>(method: string, path: string, body?: unknown, timeoutMs = 45_000): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: mediaBrowserAuthHeader(),
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(finesseApi(`/api/retro${path}`), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    })
  } catch (e) {
    throw new RetroApiError(0, (e as Error).name === 'AbortError' ? 'Finesse took too long to answer' : 'Can’t reach Finesse')
  } finally {
    clearTimeout(timer)
  }

  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    const d = data as { error?: string } | null
    throw new RetroApiError(res.status, d?.error || res.statusText || 'Request failed')
  }
  return data as T
}

// ---------- Types (matching exact backend API contract) ----------

export interface RetroVariant {
  id: string
  fileName: string
  region: string
  url: string
  sizeBytes?: number
}

export interface RetroGameEntry {
  id: string
  title: string
  console: string
  consoleLabel: string
  sourceName: string
  summary?: string
  cover?: string
  year?: number
  sizeBytes?: number
  homebrew?: boolean
  showcase?: boolean
  variants: RetroVariant[]
}

export interface RetroConsoleFacet {
  slug: string
  label: string
  count: number
}

export interface RetroCatalogResponse {
  romsWritable: boolean
  homebrewEnabled: boolean
  showcase: RetroGameEntry[]
  items: RetroGameEntry[]
  consoles: RetroConsoleFacet[]
  sourcesCount: number
}

export interface RetroLiveResult {
  id: string
  title: string
  releaseTitle: string
  console: string
  consoleLabel: string
  sizeBytes: number
  seeders: number
  indexer: string
  downloadUrl: string
}

export interface RetroLiveSearchResponse {
  available: boolean
  items: RetroLiveResult[]
}

export interface RetroDownloadJob {
  id: string
  title: string
  console: string
  fileName: string
  state: 'downloading' | 'ready' | 'failed'
  progress: number
  receivedBytes: number
  totalBytes: number
  error?: string
  createdAt: string
}

export interface RetroSourceStatus {
  at: string
  ok: boolean
  games: number
  notes: string[]
}

export interface RetroSource {
  id: string
  name: string
  url: string
  console?: string
  status: RetroSourceStatus | null
}

export interface RetroSourcesResponse {
  homebrew: boolean
  romsDir: string | null
  sources: RetroSource[]
}

export interface RetroImportConsolePreview {
  slug: string
  label: string
  count: number
  bytes: number
  sample: string[]
}

export interface RetroImportPreview {
  folder: string
  totalFiles: number
  totalBytes: number
  consoles: RetroImportConsolePreview[]
}

export interface RetroImportResult {
  imported: number
  skipped: number
  consoles: number
}

// ---------- API Client ----------

export const retroApi = {
  catalog: (q?: string, consoleSlug?: string) => {
    const params = new URLSearchParams()
    if (q?.trim()) params.set('q', q.trim())
    if (consoleSlug) params.set('console', consoleSlug)
    const qs = params.toString()
    return call<RetroCatalogResponse>('GET', `/catalog${qs ? `?${qs}` : ''}`)
  },

  liveSearch: (q: string, consoleSlug?: string) => {
    const params = new URLSearchParams()
    params.set('q', q.trim())
    if (consoleSlug) params.set('console', consoleSlug)
    return call<RetroLiveSearchResponse>('GET', `/live-search?${params.toString()}`, undefined, 60_000)
  },

  download: (body: { title: string; console: string; fileName: string; url: string }) =>
    call<RetroDownloadJob>('POST', '/download', body),

  downloads: () => call<{ downloads: RetroDownloadJob[] }>('GET', '/downloads'),

  sources: () => call<RetroSourcesResponse>('GET', '/sources'),

  addSource: (body: { name: string; url: string; console?: string }) =>
    call<{ source: RetroSource; status: RetroSourceStatus | null }>('POST', '/sources', body, 90_000),

  removeSource: (id: string) => call<{ ok: boolean }>('DELETE', `/sources/${encodeURIComponent(id)}`),

  syncSources: () => call<{ statuses: Record<string, RetroSourceStatus> }>('POST', '/sources/sync', undefined, 120_000),

  setSettings: (body: { homebrew?: boolean }) => call<{ homebrew: boolean }>('PUT', '/settings', body),

  importPreview: (folder: string) => call<RetroImportPreview>('POST', '/import/preview', { folder }, 90_000),

  importRun: (folder: string) => call<RetroImportResult>('POST', '/import/run', { folder }, 300_000),

  scan: () => call<{ ok: boolean; message: string }>('POST', '/scan', undefined, 60_000),
}

// ---------- React Query Hooks ----------

export function useRetroCatalog(q?: string, consoleSlug?: string) {
  const trimmed = q?.trim() ?? ''
  return useQuery<RetroCatalogResponse>({
    queryKey: ['retro', 'catalog', trimmed, consoleSlug ?? ''],
    queryFn: () => retroApi.catalog(trimmed || undefined, consoleSlug || undefined),
    staleTime: 60_000,
    retry: (count, err) => (err instanceof RetroApiError && err.status === 404 ? false : count < 1),
  })
}

export function useRetroLiveSearch(q: string, consoleSlug?: string) {
  const trimmed = q.trim()
  return useQuery<RetroLiveSearchResponse>({
    queryKey: ['retro', 'liveSearch', trimmed, consoleSlug ?? ''],
    enabled: trimmed.length >= 2,
    staleTime: 60_000,
    retry: false,
    queryFn: () => retroApi.liveSearch(trimmed, consoleSlug || undefined),
  })
}

export function useRetroDownloads(enabled = true) {
  const qc = useQueryClient()
  const prevReady = useRef<Set<string> | null>(null)

  const query = useQuery<RetroDownloadJob[]>({
    queryKey: ['retro', 'downloads'],
    enabled,
    queryFn: async () => (await retroApi.downloads()).downloads,
    retry: false,
    refetchInterval: (q) => ((q.state.data ?? []).some((d) => d.state === 'downloading') ? 2000 : 30_000),
  })

  // When any retro download finishes, refresh RomM games & platforms so it shows up in Your games.
  useEffect(() => {
    if (!query.data) return
    const nowReady = new Set(query.data.filter((d) => d.state === 'ready').map((d) => d.id))
    if (prevReady.current) {
      let added = false
      for (const id of nowReady) {
        if (!prevReady.current.has(id)) {
          added = true
          break
        }
      }
      if (added) {
        void qc.invalidateQueries({ queryKey: ['games'] })
        void qc.invalidateQueries({ queryKey: ['gamePlatforms'] })
      }
    }
    prevReady.current = nowReady
  }, [query.data, qc])

  return query
}
