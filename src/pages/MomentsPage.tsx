import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '../api/client'
import {
  createMomentCollection,
  deleteMomentCollection,
  getMomentCollection,
  removeFromCollection,
  updateMomentCollection,
  useMomentCollection,
  useMomentCollections,
  useMomentCollectionsOn,
  type MomentCollection,
  type MomentCollectionSummary,
  type MomentEntry,
} from '../api/momentCollections'
import {
  clock,
  deleteMoment,
  getInbox,
  markMomentsRead,
  momentHref,
  useInbox,
  useMomentsOn,
  type InboxMoment,
  type MyMoment,
} from '../api/moments'
import type { JfItem } from '../api/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import PeoplePicker from '../components/PeoplePicker'
import SaveMoment from '../components/moments/SaveMoment'
import { ago } from '../components/moments/MomentsBell'
import { useToast } from '../components/Toast'

// Moments Hub: full-width visual home for received moments (Inbox), your own saved
// moments (Saved), and curated collections (Collections). Each entry is a reference
// (a title, where in it, the note, who flagged it), never a copy of the video.

const PAD = 'px-4 sm:px-6 lg:px-12 pb-16 pt-6'
const BTN = 'inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition active:scale-[0.97] disabled:opacity-60'
const BTN_MAIN = `${BTN} bg-white text-ink-950 hover:bg-ink-200`
const BTN_SOFT = `${BTN} bg-white/10 border border-white/15 text-white hover:bg-white/15`
const FIELD = 'h-10 rounded-lg border border-white/15 bg-white/[0.05] px-3 text-[15px] text-white outline-none focus:border-white/40'
const H2 = 'text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-400'

type Tab = 'inbox' | 'saved' | 'collections'

function titleHue(title: string): number {
  let h = 0
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) % 360
  return h
}

function useItemArtwork(ids: string[]) {
  const unique = useMemo(() => [...new Set(ids.filter(Boolean))].sort(), [ids])
  return useQuery({
    queryKey: ['moments', 'artwork', unique],
    enabled: unique.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const res = await api.getItems({ ids: unique.slice(0, 60).join(','), fields: 'PrimaryImageAspectRatio,ProductionYear,SeriesPrimaryImageTag' })
      return new Map<string, JfItem>(res.Items.map((i) => [i.Id, i]))
    },
  })
}

export default function MomentsPage() {
  const momentsOn = useMomentsOn()
  const collectionsOn = useMomentCollectionsOn()
  if (!momentsOn && !collectionsOn)
    return (
      <div className={PAD}>
        <h1 className="page-title">Moments</h1>
        <p className="mt-3 max-w-xl text-[14px] text-ink-300">
          This server’s Finesse is older and doesn’t support Moments yet. Ask whoever runs it to update Finesse.
        </p>
      </div>
    )
  return (
    <Routes>
      <Route index element={<MomentsHub momentsOn={momentsOn} collectionsOn={collectionsOn} />} />
      {collectionsOn && <Route path=":id" element={<CollectionPage />} />}
    </Routes>
  )
}

function MomentsHub({ momentsOn, collectionsOn }: { momentsOn: boolean; collectionsOn: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const inboxQuery = useInbox()
  const collectionsQuery = useMomentCollections()
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()

  const rawTab = searchParams.get('tab') as Tab | null
  const tabs: { id: Tab; label: string; count?: number; highlight?: boolean }[] = []
  if (momentsOn) {
    tabs.push({
      id: 'inbox',
      label: 'Inbox',
      count: inboxQuery.data?.unread || inboxQuery.data?.moments.length || undefined,
      highlight: Boolean(inboxQuery.data?.unread),
    })
    tabs.push({
      id: 'saved',
      label: 'Saved',
      count: inboxQuery.data?.mine?.length || undefined,
    })
  }
  if (collectionsOn) {
    const colCount = (collectionsQuery.data?.mine.length ?? 0) + (collectionsQuery.data?.shared.length ?? 0)
    tabs.push({
      id: 'collections',
      label: 'Collections',
      count: colCount || undefined,
    })
  }
  const activeTab: Tab = rawTab && tabs.some((t) => t.id === rawTab) ? rawTab : tabs[0]?.id ?? 'collections'

  const setTab = (t: Tab) => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', t)
    setSearchParams(next, { replace: true })
  }

  const [refreshing, setRefreshing] = useState(false)
  const [savingMoment, setSavingMoment] = useState<InboxMoment | MyMoment | null>(null)
  const [deletingMoment, setDeletingMoment] = useState<MyMoment | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const inbox = inboxQuery.data?.moments ?? []
  const mine = inboxQuery.data?.mine ?? []
  const unread = inboxQuery.data?.unread ?? 0

  // Batch fetch artwork for Inbox & Saved moments.
  const momentItemIds = useMemo(
    () => (activeTab === 'inbox' ? inbox : activeTab === 'saved' ? mine : []).map((m) => m.item),
    [activeTab, inbox, mine],
  )
  const { data: momentItems } = useItemArtwork(momentItemIds)

  const refreshInbox = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      const fresh = await getInbox(true)
      qc.setQueryData(['moments', 'inbox'], fresh)
    } catch (e) {
      toast((e as Error).message || 'Couldn’t refresh inbox', 'error')
    } finally {
      setRefreshing(false)
    }
  }

  const markRead = async (keys: string[]) => {
    if (!keys.length) return
    const keySet = new Set(keys)
    qc.setQueryData<typeof inboxQuery.data>(['moments', 'inbox'], (d) =>
      d
        ? {
            ...d,
            moments: d.moments.map((m) => (keySet.has(m.key) ? { ...m, read: true } : m)),
            unread: d.moments.filter((m) => !m.read && !keySet.has(m.key)).length,
          }
        : d,
    )
    try {
      await markMomentsRead(keys)
    } catch {
      toast('Couldn’t mark as read. Try again in a moment.', 'error')
    }
    void qc.invalidateQueries({ queryKey: ['moments', 'inbox'] })
  }

  const openMoment = (m: InboxMoment | MyMoment) => {
    if (!m.read && !('to' in m)) void markRead([m.key])
    navigate(momentHref(m))
  }

  const confirmDeleteMoment = async () => {
    if (!deletingMoment || deleteBusy) return
    setDeleteBusy(true)
    try {
      await deleteMoment(deletingMoment.key)
      toast('Moment deleted')
      setDeletingMoment(null)
      void qc.invalidateQueries({ queryKey: ['moments'] })
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className={PAD}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Moments</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-400">
            Favourite scenes sent to you, moments you’ve saved while watching, and collections you can share.
          </p>
        </div>
        {tabs.length > 1 && (
          <div
            role="tablist"
            aria-label="Moments views"
            className="inline-flex max-w-full overflow-x-auto no-scrollbar rounded-full bg-ink-800/80 border border-white/10 p-1"
          >
            {tabs.map((t) => {
              const active = t.id === activeTab
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.id)}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition active:scale-[0.97] ${
                    active ? 'bg-[#f5f3ee] text-ink-950 font-semibold' : 'text-ink-300 hover:text-white'
                  }`}
                >
                  <span>{t.label}</span>
                  {t.count !== undefined && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none tabular-nums ${
                        t.highlight
                          ? active
                            ? 'bg-accent-fill text-white'
                            : 'bg-accent-300 text-ink-950'
                          : active
                            ? 'bg-black/15 text-ink-950'
                            : 'bg-white/10 text-ink-300'
                      }`}
                    >
                      {t.count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {activeTab === 'inbox' && momentsOn && (
        <section className="mt-8" aria-label="Inbox">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className={H2}>
              Sent to you {unread > 0 ? `· ${unread} unread` : ''}
            </h2>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => void markRead(inbox.filter((m) => !m.read).map((m) => m.key))}
                  className="inline-flex h-9 items-center rounded-lg border border-white/15 bg-white/10 px-3.5 text-xs font-semibold text-white hover:bg-white/15 transition active:scale-[0.97]"
                >
                  Mark all read
                </button>
              )}
              <button
                type="button"
                onClick={refreshInbox}
                disabled={refreshing}
                className="inline-flex h-9 items-center rounded-lg border border-white/10 bg-white/5 px-3.5 text-xs font-semibold text-ink-200 hover:bg-white/10 hover:text-white transition active:scale-[0.97] disabled:opacity-50"
              >
                {refreshing ? 'Checking…' : 'Check for new'}
              </button>
            </div>
          </div>

          {inboxQuery.isLoading ? (
            <MomentGridSkeleton />
          ) : inboxQuery.isError ? (
            <ErrorBox message="Couldn’t load your Moments inbox." onRetry={() => void inboxQuery.refetch()} />
          ) : inbox.length === 0 ? (
            <EmptyBox
              title="Your inbox is quiet"
              body="When someone flags a scene or recommends a movie or episode to you, it shows up right here with artwork and a direct jump to that timestamp."
            />
          ) : (
            <ul className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
              {inbox.map((m) => (
                <MomentCard
                  key={m.key}
                  m={m}
                  jf={momentItems?.get(m.item)}
                  onPlay={() => openMoment(m)}
                  onMarkRead={!m.read ? () => void markRead([m.key]) : undefined}
                  onSave={collectionsOn ? () => setSavingMoment(m) : undefined}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {activeTab === 'saved' && momentsOn && (
        <section className="mt-8" aria-label="Saved by you">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className={H2}>Saved by you</h2>
          </div>

          {inboxQuery.isLoading ? (
            <MomentGridSkeleton />
          ) : inboxQuery.isError ? (
            <ErrorBox message="Couldn’t load your saved moments." onRetry={() => void inboxQuery.refetch()} />
          ) : mine.length === 0 ? (
            <EmptyBox
              title="No saved moments yet"
              body="While watching anything in the player, tap the flag icon to save a favourite scene for yourself or send it to someone."
            />
          ) : (
            <ul className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
              {mine.map((m) => (
                <MomentCard
                  key={m.key}
                  m={m}
                  jf={momentItems?.get(m.item)}
                  onPlay={() => openMoment(m)}
                  onSave={collectionsOn ? () => setSavingMoment(m) : undefined}
                  onDelete={() => setDeletingMoment(m)}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {activeTab === 'collections' && collectionsOn && (
        <CollectionsTab query={collectionsQuery} />
      )}

      {savingMoment && (
        <SaveMoment
          what={{ moment: savingMoment.key }}
          label={'to' in savingMoment ? `Your moment in “${savingMoment.title}”` : `${savingMoment.from}’s moment in “${savingMoment.title}”`}
          onClose={() => setSavingMoment(null)}
        />
      )}

      {deletingMoment && (
        <ConfirmDialog
          title={`Delete moment in “${deletingMoment.title}”?`}
          confirmLabel="Delete"
          busy={deleteBusy}
          onCancel={() => setDeletingMoment(null)}
          onConfirm={() => void confirmDeleteMoment()}
        >
          This removes the saved moment{deletingMoment.to.length ? ` (including for ${deletingMoment.to.join(', ')})` : ''}. Any copies already saved in a collection stay.
        </ConfirmDialog>
      )}
    </div>
  )
}

function MomentCard({
  m,
  jf,
  onPlay,
  onMarkRead,
  onSave,
  onDelete,
}: {
  m: InboxMoment | MyMoment
  jf?: JfItem
  onPlay: () => void
  onMarkRead?: () => void
  onSave?: () => void
  onDelete?: () => void
}) {
  const [reveal, setReveal] = useState(false)
  const to = 'to' in m ? m.to : null
  const unread = !to && !m.read
  const poster = jf ? api.posterUrl(jf, 240) : null
  const backdrop = jf ? api.backdropUrl(jf, 640) : null
  const hue = titleHue(m.title)

  return (
    <li
      className={`cv-card group relative overflow-hidden rounded-2xl border transition-colors ${
        unread ? 'border-accent-400/40 bg-accent-400/[0.06]' : 'border-white/10 bg-ink-900/65 hover:border-white/15'
      }`}
    >
      {backdrop && (
        <div className="pointer-events-none absolute inset-0 -z-0 opacity-20">
          <img decoding="async" src={backdrop} alt="" loading="lazy" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/85 to-ink-950/55" />
        </div>
      )}
      <div className="relative z-10 flex gap-4 p-4">
        <Link
          to={`/item/${m.item}`}
          onClick={onMarkRead}
          aria-label={`Open ${m.title}`}
          className="relative h-28 w-20 shrink-0 overflow-hidden rounded-xl bg-ink-800 ring-1 ring-white/10 transition hover:brightness-110"
        >
          {poster ? (
            <img decoding="async" src={poster} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <div
              className="flex h-full w-full items-end p-2 text-[11px] font-semibold leading-tight text-white/90"
              style={{ backgroundImage: `linear-gradient(150deg, hsl(${hue}, 45%, 34%), hsl(${(hue + 40) % 360}, 50%, 16%))` }}
            >
              <span className="line-clamp-3">{m.title}</span>
            </div>
          )}
        </Link>

        <div className="min-w-0 flex-1 flex flex-col">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-ink-300">
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-400/20 text-[11px] font-bold text-accent-200">
                  {(to ? 'Y' : m.from.charAt(0)).toUpperCase()}
                </span>
                <span className="truncate">
                  {to ? (
                    <>
                      <strong className="font-semibold text-white">You</strong>
                      {to.length ? ` → ${to.join(', ')}` : ' · Just for you'}
                    </>
                  ) : (
                    <>
                      <strong className="font-semibold text-white">{m.from}</strong>{' '}
                      {m.start == null ? 'recommends' : 'flagged'}
                    </>
                  )}
                </span>
                <span className="shrink-0 text-ink-400">· {ago(m.created)}</span>
              </div>
              <Link
                to={`/item/${m.item}`}
                onClick={onMarkRead}
                className="mt-1 block truncate text-base font-semibold text-white hover:underline"
              >
                {m.title}
                {m.subtitle && <span className="font-normal text-ink-400"> · {m.subtitle}</span>}
              </Link>
            </div>
            {unread && <span aria-label="Unread" className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-accent-300" />}
          </div>

          {m.start != null && (
            <div className="mt-1.5 flex items-center gap-2">
              <span className="rounded-md bg-white/10 px-2 py-0.5 font-mono text-[11.5px] font-medium text-ink-100">
                {m.end != null ? `${clock(m.start)}–${clock(m.end)}` : clock(m.start)}
              </span>
            </div>
          )}

          {m.note && (
            <div className="mt-2">
              {m.spoiler && !reveal ? (
                <button
                  type="button"
                  onClick={() => setReveal(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1 text-xs font-medium text-amber-200 hover:bg-amber-300/20 transition-colors"
                >
                  Spoiler · show note
                </button>
              ) : (
                <p className="text-[13.5px] leading-relaxed text-ink-100">“{m.note}”</p>
              )}
            </div>
          )}

          <div className="mt-auto pt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onPlay}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-ink-950 hover:bg-ink-200 transition active:scale-[0.97]"
            >
              <span>▶</span>
              <span>{m.start != null ? `Play from ${clock(m.start)}` : 'Open title'}</span>
            </button>
            {onSave && (
              <button
                type="button"
                onClick={onSave}
                className="inline-flex h-8 items-center rounded-lg border border-white/15 bg-white/10 px-3 text-xs font-semibold text-white hover:bg-white/15 transition active:scale-[0.97]"
              >
                Save to collection
              </button>
            )}
            {onMarkRead && (
              <button
                type="button"
                onClick={onMarkRead}
                className="inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-medium text-ink-300 hover:bg-white/10 hover:text-white transition-colors"
              >
                Mark read
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                aria-label={`Delete moment in ${m.title}`}
                className="ml-auto inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-medium text-ink-400 hover:bg-red-500/15 hover:text-red-200 transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>
    </li>
  )
}

function CollectionsTab({ query }: { query: ReturnType<typeof useMomentCollections> }) {
  const { data, isLoading, isError, refetch } = query
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const allSummaries = useMemo(
    () => [...(data?.mine ?? []), ...(data?.shared ?? [])].slice(0, 24),
    [data],
  )
  // Fetch collection details so each collection card can show visual poster thumbnails.
  const detailQueries = useQueries({
    queries: allSummaries.map((c) => ({
      queryKey: ['momentCollections', 'one', c.id] as const,
      queryFn: () => getMomentCollection(c.id),
      staleTime: 60_000,
      retry: false,
    })),
  })
  const detailById = useMemo(() => {
    const map = new Map<string, MomentCollection>()
    allSummaries.forEach((s, i) => {
      const d = detailQueries[i]?.data
      if (d) map.set(s.id, d)
    })
    return map
  }, [allSummaries, detailQueries])

  const previewItemIds = useMemo(() => {
    const out: string[] = []
    for (const d of detailById.values()) {
      for (const e of d.entries) {
        if (e.available && e.item) {
          out.push(e.item)
          if (out.length >= 60) break
        }
      }
    }
    return out
  }, [detailById])
  const { data: artItems } = useItemArtwork(previewItemIds)

  return (
    <div className="mt-8">
      <form
        className="flex flex-wrap max-w-lg gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          if (busy || !name.trim()) return
          setBusy(true)
          try {
            const c = await createMomentCollection(name.trim())
            await qc.invalidateQueries({ queryKey: ['momentCollections'] })
            navigate(`/moments/${c.id}`)
          } catch (err) {
            toast((err as Error).message, 'error')
            setBusy(false)
          }
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder="New collection, like “Best openings”"
          aria-label="New collection name"
          className={`${FIELD} min-w-0 flex-1`}
        />
        <button type="submit" disabled={busy || !name.trim()} className={BTN_MAIN}>
          {busy ? 'Making…' : 'New collection'}
        </button>
      </form>

      {isLoading ? (
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-48 rounded-2xl shimmer" />
          ))}
        </div>
      ) : isError ? (
        <div className="mt-8">
          <ErrorBox message="Couldn’t load your collections." onRetry={() => void refetch()} />
        </div>
      ) : (
        <>
          <section className="mt-8" aria-label="Your collections">
            <h2 className={H2}>Your collections</h2>
            {data?.mine.length ? (
              <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {data.mine.map((c) => (
                  <CollectionCard key={c.id} summary={c} detail={detailById.get(c.id)} artItems={artItems} mine />
                ))}
              </ul>
            ) : (
              <div className="mt-3">
                <EmptyBox
                  title="No collections yet"
                  body="Create one above, or save any moment from your Inbox or Saved tab to start building a themed playlist of scenes."
                />
              </div>
            )}
          </section>

          {Boolean(data?.shared.length) && (
            <section className="mt-10" aria-label="Shared with you">
              <h2 className={H2}>Shared with you</h2>
              <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {data!.shared.map((c) => (
                  <CollectionCard key={c.id} summary={c} detail={detailById.get(c.id)} artItems={artItems} mine={false} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function CollectionCard({
  summary,
  detail,
  artItems,
  mine,
}: {
  summary: MomentCollectionSummary
  detail?: MomentCollection
  artItems?: Map<string, JfItem>
  mine: boolean
}) {
  const hue = titleHue(summary.name)
  const posters = useMemo(() => {
    const urls: string[] = []
    const seen = new Set<string>()
    for (const e of detail?.entries ?? []) {
      if (!e.available || !e.item || seen.has(e.item)) continue
      seen.add(e.item)
      const jf = artItems?.get(e.item)
      const p = jf ? api.posterUrl(jf, 240) : null
      if (p) urls.push(p)
      if (urls.length >= 4) break
    }
    return urls
  }, [detail, artItems])

  const heroBackdrop = useMemo(() => {
    for (const e of detail?.entries ?? []) {
      if (!e.available || !e.item) continue
      const jf = artItems?.get(e.item)
      const bd = jf ? api.backdropUrl(jf, 640) : null
      if (bd) return bd
    }
    return null
  }, [detail, artItems])

  return (
    <li className="cv-card">
      <Link
        to={`/moments/${summary.id}`}
        className="group block overflow-hidden rounded-2xl border border-white/10 bg-ink-900/70 transition hover:border-white/25 hover:bg-ink-900/90 focus-visible:border-accent-400"
      >
        <div
          className="relative h-32 w-full overflow-hidden"
          style={{
            backgroundImage: `linear-gradient(135deg, hsla(${hue}, 48%, 28%, 0.9), hsla(${(hue + 48) % 360}, 45%, 14%, 0.95))`,
          }}
        >
          {heroBackdrop && (
            <img
              decoding="async"
              src={heroBackdrop}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover opacity-55 transition-transform duration-500 group-hover:scale-105"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-ink-950/90 via-ink-950/35 to-transparent" />
          {posters.length > 0 && (
            <div className="absolute bottom-3 left-3 flex items-end gap-1.5">
              {posters.map((src, idx) => (
                <img
                  key={idx}
                  decoding="async"
                  src={src}
                  alt=""
                  loading="lazy"
                  className="h-16 w-11 rounded-md object-cover shadow-lg ring-1 ring-white/20"
                />
              ))}
            </div>
          )}
          <span className="absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-md">
            {summary.entries} {summary.entries === 1 ? 'moment' : 'moments'}
          </span>
        </div>

        <div className="p-3.5">
          <p className="truncate text-[15px] font-semibold text-white group-hover:text-accent-300 transition-colors">
            {summary.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-400">
            {mine
              ? summary.shared
                ? `Shared with ${summary.shared} ${summary.shared === 1 ? 'person' : 'people'}`
                : 'Private · only you'
              : `Shared by ${summary.owner}`}
          </p>
        </div>
      </Link>
    </li>
  )
}

function CollectionPage() {
  const { id } = useParams()
  const { data: c, isLoading, isError, error, refetch, isFetching } = useMomentCollection(id)
  const { data: inboxData } = useInbox()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()

  const [sharing, setSharing] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameText, setRenameText] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState<MomentEntry | null>(null)
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(() => new Set())

  // Pending optimistic entry removal with 4.5s Undo window.
  const [pendingRemove, setPendingRemove] = useState<MomentEntry | null>(null)
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingEntryRef = useRef<{ collectionId: string; entry: MomentEntry } | null>(null)

  const set = useCallback(
    (next: MomentCollection) => {
      qc.setQueryData(['momentCollections', 'one', id], next)
      void qc.invalidateQueries({ queryKey: ['momentCollections', 'list'] })
    },
    [qc, id],
  )

  const commitRemove = useCallback(async () => {
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current)
      pendingTimerRef.current = null
    }
    const target = pendingEntryRef.current
    if (!target) return
    pendingEntryRef.current = null
    setPendingRemove(null)
    try {
      const next = await removeFromCollection(target.collectionId, target.entry.key)
      qc.setQueryData(['momentCollections', 'one', target.collectionId], next)
      void qc.invalidateQueries({ queryKey: ['momentCollections', 'list'] })
    } catch (err) {
      toast((err as Error).message || 'Couldn’t remove moment', 'error')
      void qc.invalidateQueries({ queryKey: ['momentCollections', 'one', target.collectionId] })
    }
  }, [qc, toast])

  useEffect(() => {
    return () => {
      if (pendingEntryRef.current) {
        void commitRemove()
      }
    }
  }, [commitRemove])

  const scheduleRemove = (entry: MomentEntry) => {
    if (!c) return
    if (pendingEntryRef.current) {
      void commitRemove()
    }
    pendingEntryRef.current = { collectionId: c.id, entry }
    setPendingRemove(entry)
    pendingTimerRef.current = setTimeout(() => {
      void commitRemove()
    }, 4500)
  }

  const undoRemove = () => {
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current)
      pendingTimerRef.current = null
    }
    pendingEntryRef.current = null
    setPendingRemove(null)
  }

  // Cross-check inbox/mine spoilers so a moment flagged as spoiler never leaks unmasked.
  const spoilerSignatures = useMemo(() => {
    const sigs = new Set<string>()
    for (const m of [...(inboxData?.moments ?? []), ...(inboxData?.mine ?? [])]) {
      if (m.spoiler && m.note) {
        sigs.add(`${m.item}|${m.start ?? ''}|${m.note}`)
      }
    }
    return sigs
  }, [inboxData])

  const entryIds = useMemo(
    () => (c?.entries ?? []).filter((e) => e.available && e.item).map((e) => e.item!),
    [c],
  )
  const { data: artItems } = useItemArtwork(entryIds)

  if (isLoading) {
    return (
      <div className={PAD}>
        <div className="h-8 w-40 rounded shimmer" />
        <div className="mt-4 h-12 w-72 rounded-xl shimmer" />
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-36 rounded-2xl shimmer" />
          ))}
        </div>
      </div>
    )
  }
  if (isError || !c) {
    return (
      <div className={PAD}>
        <Link
          to="/moments?tab=collections"
          className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2 -ml-2 text-sm font-semibold text-accent-300 hover:bg-white/5 hover:text-white transition-colors"
        >
          ‹ Moments
        </Link>
        <h1 className="page-title mt-2">Collection not found</h1>
        <p className="mt-2 max-w-xl text-[14px] text-ink-300">
          {(error as Error | null)?.message ?? 'It may have been removed, or it isn’t shared with you any more.'}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={() => void refetch()} disabled={isFetching} className={BTN_MAIN}>
            {isFetching ? 'Trying again…' : 'Try again'}
          </button>
          <Link to="/moments?tab=collections" className={BTN_SOFT}>
            Back to Moments
          </Link>
        </div>
      </div>
    )
  }

  const visibleEntries = c.entries.filter((e) => !pendingRemove || e.key !== pendingRemove.key)
  const gone = visibleEntries.filter((e) => !e.available).length

  const startRename = () => {
    setRenameText(c.name)
    setRenaming(true)
    setSharing(false)
  }

  const saveRename = async (ev: React.FormEvent) => {
    ev.preventDefault()
    const trimmed = renameText.trim()
    if (!trimmed || renameBusy) return
    setRenameBusy(true)
    try {
      const next = await updateMomentCollection(c.id, { name: trimmed })
      set(next)
      setRenaming(false)
      toast('Collection renamed')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setRenameBusy(false)
    }
  }

  return (
    <div className={PAD}>
      <Link
        to="/moments?tab=collections"
        className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2 -ml-2 text-sm font-semibold text-accent-300 hover:bg-white/5 hover:text-white transition-colors"
      >
        ‹ Moments
      </Link>

      <div className="mt-1 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="page-title">{c.name}</h1>
          <p className="mt-1.5 max-w-2xl text-[14px] text-ink-400">
            {c.mine
              ? c.sharedWith?.length
                ? `Shared with ${c.sharedWith.map((p) => p.name).join(', ')}. They see where each moment is and its note, and play the ones they can open themselves.`
                : 'Only you see this collection.'
              : `${c.owner.name} shared this with you. Save a moment to one of yours to keep it.`}
          </p>
        </div>

        {c.mine && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN_SOFT} onClick={renaming ? () => setRenaming(false) : startRename}>
              {renaming ? 'Cancel rename' : 'Rename'}
            </button>
            <button
              type="button"
              className={BTN_SOFT}
              onClick={() => {
                setSharing((v) => !v)
                setRenaming(false)
              }}
            >
              {sharing ? 'Close sharing' : 'Share'}
            </button>
            <button type="button" className={BTN_SOFT} onClick={() => setRemoving(true)}>
              Remove
            </button>
          </div>
        )}
      </div>

      {renaming && c.mine && (
        <form onSubmit={saveRename} className="mt-4 flex flex-wrap max-w-lg items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <input
            value={renameText}
            onChange={(e) => setRenameText(e.target.value)}
            maxLength={60}
            aria-label="Collection name"
            className={`${FIELD} min-w-0 flex-1`}
          />
          <button type="submit" disabled={renameBusy || !renameText.trim()} className={BTN_MAIN}>
            {renameBusy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => setRenaming(false)} className={BTN_SOFT}>
            Cancel
          </button>
        </form>
      )}

      {sharing && c.mine && (
        <ShareEditor
          c={c}
          onCancel={() => setSharing(false)}
          onSaved={(next) => {
            set(next)
            setSharing(false)
          }}
        />
      )}

      {gone > 0 && (
        <p className="mt-5 max-w-2xl rounded-xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-2.5 text-[13px] text-amber-100">
          {gone === 1 ? 'One moment is' : `${gone} moments are`} of a title{' '}
          {c.mine
            ? 'that isn’t available to you any more: it may have been removed, or a friend’s server stopped sharing it.'
            : 'you can’t open.'}
        </p>
      )}

      {visibleEntries.length === 0 ? (
        <div className="mt-8">
          <EmptyBox
            title="Nothing in this collection yet"
            body={
              c.mine
                ? 'Open Inbox or Saved (or the Moments bell) and choose Save to collection on any moment.'
                : 'No moments have been added to this collection yet.'
            }
          />
        </div>
      ) : (
        <ul className="mt-6 grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
          {visibleEntries.map((e) => {
            const jf = e.item ? artItems?.get(e.item) : undefined
            const poster = jf ? api.posterUrl(jf, 240) : null
            const backdrop = jf ? api.backdropUrl(jf, 640) : null
            const hue = titleHue(e.title)
            const entryWithSpoiler = e as MomentEntry & { spoiler?: boolean }
            const isSpoiler =
              Boolean(entryWithSpoiler.spoiler) ||
              (Boolean(e.item && e.note) && spoilerSignatures.has(`${e.item}|${e.start ?? ''}|${e.note}`))
            const revealed = revealedKeys.has(e.key)
            return (
              <li
                key={e.key}
                className={`cv-card relative overflow-hidden rounded-2xl border border-white/10 ${
                  e.available ? 'bg-ink-900/65' : 'bg-white/[0.02] opacity-75'
                }`}
              >
                {backdrop && e.available && (
                  <div className="pointer-events-none absolute inset-0 -z-0 opacity-20">
                    <img decoding="async" src={backdrop} alt="" loading="lazy" className="h-full w-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/85 to-ink-950/55" />
                  </div>
                )}
                <div className="relative z-10 flex gap-4 p-4">
                  {e.available && e.item ? (
                    <Link
                      to={`/item/${e.item}`}
                      aria-label={`Open ${e.title}`}
                      className="h-28 w-20 shrink-0 overflow-hidden rounded-xl bg-ink-800 ring-1 ring-white/10 transition hover:brightness-110"
                    >
                      {poster ? (
                        <img decoding="async" src={poster} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <div
                          className="flex h-full w-full items-end p-2 text-[11px] font-semibold leading-tight text-white/90"
                          style={{ backgroundImage: `linear-gradient(150deg, hsl(${hue}, 45%, 34%), hsl(${(hue + 40) % 360}, 50%, 16%))` }}
                        >
                          <span className="line-clamp-3">{e.title}</span>
                        </div>
                      )}
                    </Link>
                  ) : (
                    <div className="h-28 w-20 shrink-0 overflow-hidden rounded-xl bg-ink-800/70 ring-1 ring-white/5" />
                  )}

                  <div className="min-w-0 flex-1 flex flex-col">
                    <p className="text-base font-semibold text-white leading-snug">
                      {e.available && e.item ? (
                        <Link to={`/item/${e.item}`} className="hover:underline">
                          {e.title}
                        </Link>
                      ) : (
                        e.title
                      )}
                      {e.subtitle && <span className="font-normal text-ink-400"> · {e.subtitle}</span>}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-400">
                      {e.start != null && (
                        <span className="rounded-md bg-white/10 px-2 py-0.5 font-mono text-[11.5px] text-ink-100">
                          {e.end != null ? `${clock(e.start)}–${clock(e.end)}` : clock(e.start)}
                        </span>
                      )}
                      {e.from && <span>Flagged by {e.from}</span>}
                    </p>

                    {e.note && (
                      <div className="mt-2">
                        {isSpoiler && !revealed ? (
                          <button
                            type="button"
                            onClick={() => setRevealedKeys((prev) => new Set(prev).add(e.key))}
                            className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1 text-xs font-medium text-amber-200 hover:bg-amber-300/20 transition-colors"
                          >
                            Spoiler · show note
                          </button>
                        ) : (
                          <p className="text-[13.5px] leading-relaxed text-ink-100">“{e.note}”</p>
                        )}
                      </div>
                    )}

                    {!e.available && (
                      <p className="mt-1.5 text-xs text-amber-200">
                        {c.mine ? 'Not available to you any more.' : 'Your profile can’t open this title.'}
                      </p>
                    )}

                    <div className="mt-auto pt-3 flex flex-wrap items-center gap-2">
                      {e.available && e.item && (
                        <Link
                          to={momentHref({ item: e.item, start: e.start })}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-ink-950 hover:bg-ink-200 transition active:scale-[0.97]"
                        >
                          ▶ {e.start != null ? `Play from ${clock(e.start)}` : 'Open'}
                        </Link>
                      )}
                      {!c.mine && e.available && (
                        <button
                          type="button"
                          onClick={() => setSaving(e)}
                          className="h-8 rounded-lg border border-white/15 bg-white/10 px-3 text-xs font-semibold text-white transition hover:bg-white/15 active:scale-[0.97]"
                        >
                          Save to mine
                        </button>
                      )}
                      {c.mine && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => scheduleRemove(e)}
                          aria-label={`Remove “${e.title}” from the collection`}
                          title="Remove from collection"
                          className="ml-auto inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-medium text-ink-400 transition hover:bg-red-500/15 hover:text-red-200 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {pendingRemove && (
        <div
          role="status"
          className="toast-in fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 z-[72] flex items-center gap-3 rounded-full os-menu px-5 py-2.5 text-sm text-white shadow-2xl"
        >
          <span>Removed “{pendingRemove.title}”</span>
          <button
            type="button"
            onClick={undoRemove}
            className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-ink-950 hover:bg-ink-200 transition-colors"
          >
            Undo
          </button>
        </div>
      )}

      {saving && (
        <SaveMoment
          what={{ from: { collection: c.id, key: saving.key } }}
          label={`${saving.from ? `${saving.from}’s` : 'A'} moment in “${saving.title}”`}
          onClose={() => setSaving(null)}
        />
      )}

      {removing && (
        <ConfirmDialog
          title={`Remove “${c.name}”?`}
          confirmLabel="Remove"
          busy={busy}
          onCancel={() => setRemoving(false)}
          onConfirm={async () => {
            setBusy(true)
            try {
              await deleteMomentCollection(c.id)
              await qc.invalidateQueries({ queryKey: ['momentCollections'] })
              navigate('/moments?tab=collections', { replace: true })
            } catch (err) {
              toast((err as Error).message, 'error')
              setBusy(false)
              setRemoving(false)
            }
          }}
        >
          The collection goes{c.sharedWith?.length ? ', for everyone it’s shared with too' : ''}. The moments themselves and the titles stay.
        </ConfirmDialog>
      )}
    </div>
  )
}

function ShareEditor({
  c,
  onSaved,
  onCancel,
}: {
  c: MomentCollection
  onSaved: (c: MomentCollection) => void
  onCancel: () => void
}) {
  const [who, setWho] = useState((c.sharedWith ?? []).map((p) => p.id))
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  return (
    <div className="mt-4 max-w-2xl space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[13.5px] text-ink-300">
        Who can see it. They see where each moment is and its note; they play a moment only if their own profile can open the title. Nothing new becomes watchable for them.
      </p>
      <PeoplePicker chosen={who} onChange={setWho} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          className={BTN_MAIN}
          onClick={async () => {
            setBusy(true)
            try {
              onSaved(await updateMomentCollection(c.id, { sharedWith: who }))
              toast(who.length ? 'Shared' : 'Only you see it now')
            } catch (e) {
              toast((e as Error).message, 'error')
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={BTN_SOFT}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function MomentGridSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-36 rounded-2xl shimmer" />
      ))}
    </div>
  )
}

function EmptyBox({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 max-w-2xl">
      <p className="text-base font-semibold text-white">{title}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-400">{body}</p>
    </div>
  )
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.05] p-5 max-w-xl">
      <p className="text-sm text-amber-200">{message}</p>
      <button type="button" onClick={onRetry} className={`${BTN_SOFT} mt-3`}>
        Try again
      </button>
    </div>
  )
}
