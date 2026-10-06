import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { mediaBrowserAuthHeader } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { finesseApi, useFinesse } from '../lib/finesseServer'
import { useToast } from './Toast'

// Delete from the library (administrators, servers Finesse set up): asks the server what it would
// delete first, then says so plainly before anything goes.

interface Preview {
  title: string
  type: string
  bytes: number
  files: number
  downloader: string | null
}

const size = (b: number) => (b >= 1e12 ? `${(b / 1e12).toFixed(1)} TB` : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`)
const WHAT: Record<string, string> = { Movie: 'movie', Series: 'show', Season: 'season', Episode: 'episode', MusicArtist: 'artist', MusicAlbum: 'album', Audio: 'song' }
export const DELETABLE = Object.keys(WHAT)

async function call<T>(method: string, id: string): Promise<T> {
  const r = await fetch(finesseApi(`/api/media/items/${id}/delete`), { method, headers: { Authorization: mediaBrowserAuthHeader() } })
  const d = (await r.json().catch(() => ({}))) as T & { error?: string }
  if (!r.ok) throw new Error(d.error || `Finesse answered ${r.status}`)
  return d
}

/** Whether this person, on this server, can delete from the library. */
export function useCanDelete(): boolean {
  const { session } = useAuth()
  const { info } = useFinesse()
  return !__WEBOS__ && Boolean(session?.isAdmin && info?.features?.addMedia)
}

export function DeleteFromLibrary({ itemId, onClose, onDeleted }: { itemId: string; onClose: () => void; onDeleted: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()
  const toast = useToast()

  useEffect(() => {
    call<Preview>('GET', itemId).then(setPreview, (e: Error) => setError(e.message))
  }, [itemId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const go = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await call<{ title: string; freed: number }>('POST', itemId)
      await queryClient.invalidateQueries()
      toast(`Deleted ${r.title}${r.freed ? ` (${size(r.freed)} freed)` : ''}`)
      onDeleted()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const what = preview ? WHAT[preview.type] ?? 'item' : 'item'
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="del-title" onClick={() => !busy && onClose()}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-ink-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 id="del-title" className="font-display text-[28px] leading-tight text-white">
          {preview ? `Delete ${preview.title}?` : error ? 'Can’t delete this' : 'Checking…'}
        </h2>
        {preview && (
          <div className="mt-3 space-y-2 text-[14px] leading-relaxed text-ink-200">
            <p>
              The {what}’s files are deleted from the server{preview.bytes ? `, freeing ${size(preview.bytes)}` : ''}, and it leaves the library for everyone.
            </p>
            {preview.downloader && <p className="text-ink-400">{preview.downloader}.</p>}
            <p className="font-medium text-red-200">This can’t be undone.</p>
          </div>
        )}
        {error && <p className="mt-3 text-[13.5px] leading-relaxed text-red-200">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={busy} className="h-10 rounded-full px-5 text-[14px] font-medium text-ink-200 hover:text-white disabled:opacity-50">
            {preview ? 'Keep it' : 'Close'}
          </button>
          {preview && (
            <button type="button" onClick={go} disabled={busy} className="h-10 rounded-full bg-red-600 px-6 text-[14px] font-semibold text-white hover:bg-red-500 disabled:opacity-60">
              {busy ? 'Deleting…' : `Delete ${what}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
