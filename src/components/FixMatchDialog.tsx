import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import * as api from '../api/client'
import { useToast } from './Toast'
import type { JfItem } from '../api/types'
import type { JfRemoteSearchResult } from '../api/client'

interface Props {
  item: JfItem
  onClose: () => void
}

export default function FixMatchDialog({ item, onClose }: Props) {
  const [name, setName] = useState(item.Name)
  const [year, setYear] = useState(item.ProductionYear ? String(item.ProductionYear) : '')
  const [results, setResults] = useState<JfRemoteSearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [applying, setApplying] = useState<JfRemoteSearchResult | null>(null)
  const toast = useToast()
  const queryClient = useQueryClient()

  const search = async () => {
    setSearching(true)
    setResults(null)
    try {
      const r = await api.remoteSearch(item, name.trim(), year ? Number(year) : undefined)
      setResults(r)
    } catch {
      toast('Provider search failed', 'error')
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  // Search immediately with the current name/year
  useEffect(() => {
    search()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const apply = async (result: JfRemoteSearchResult) => {
    setApplying(result)
    const oldTag = item.ImageTags?.Primary
    try {
      await api.applyRemoteResult(item.Id, result)
      onClose()
      toast('Re-matching — fetching new art…')
      // Server applies + refreshes async; wait for the new poster tag, then
      // repaint the detail page and every grid/row holding the old tag.
      await api.waitForImageChange(item.Id, oldTag)
      await queryClient.invalidateQueries()
      toast('Match updated')
    } catch {
      toast('Could not apply the match', 'error')
      setApplying(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card-in w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl bg-ink-900/95 backdrop-blur-xl border border-white/10 shadow-2xl overflow-hidden"
      >
        <div className="p-6 pb-4 border-b border-white/5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-white tracking-tight">Fix match</h2>
              {item.Path && (
                <p className="mt-1 text-xs text-ink-400 font-mono break-all">{item.Path}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="h-9 w-9 shrink-0 rounded-full hover:bg-white/10 flex items-center justify-center text-ink-400 hover:text-white transition-colors"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              search()
            }}
            className="mt-4 flex gap-2"
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Title"
              className="flex-1 rounded-lg bg-ink-800 border border-white/10 px-3 py-2 text-sm outline-none focus:border-accent-500 transition-colors"
            />
            <input
              value={year}
              onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="Year"
              className="w-20 rounded-lg bg-ink-800 border border-white/10 px-3 py-2 text-sm outline-none focus:border-accent-500 transition-colors"
            />
            <button
              type="submit"
              disabled={searching || !name.trim()}
              className="rounded-lg bg-accent-500 hover:bg-accent-400 disabled:opacity-50 px-5 py-2 text-sm font-semibold text-white active:scale-95 transition-all"
            >
              Search
            </button>
          </form>
        </div>

        <div className="flex-1 overflow-y-auto p-6 pt-4">
          {searching && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i}>
                  <div className="aspect-[2/3] rounded-lg shimmer" />
                  <div className="h-3.5 w-3/4 mt-2 rounded shimmer" />
                </div>
              ))}
            </div>
          )}

          {!searching && results?.length === 0 && (
            <p className="text-sm text-ink-400 py-8 text-center">
              No matches from the metadata providers. Try tweaking the title or year.
            </p>
          )}

          {!searching && results && results.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-4">
              {results.map((r, i) => (
                <button
                  key={i}
                  onClick={() => apply(r)}
                  disabled={!!applying}
                  className="group text-left outline-none disabled:opacity-50"
                >
                  <div className="aspect-[2/3] rounded-lg overflow-hidden bg-ink-800 ring-1 ring-white/5 group-hover:ring-2 group-hover:ring-accent-400 transition-all group-hover:scale-[1.03]">
                    {r.ImageUrl ? (
                      <img src={r.ImageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center p-2 text-center text-xs text-ink-400">
                        No poster
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-xs font-medium text-ink-200 group-hover:text-white truncate transition-colors">
                    {applying === r ? 'Applying…' : r.Name}
                  </p>
                  <p className="text-[11px] text-ink-400">
                    {r.ProductionYear ?? '—'}
                    {r.SearchProviderName ? ` · ${r.SearchProviderName}` : ''}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
