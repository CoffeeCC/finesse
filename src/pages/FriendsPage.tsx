import { useEffect, useMemo, useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getLatest, getResume, getSessions } from '../api/client'
import { clock, momentHref, useInbox } from '../api/moments'
import { usePartyInvites } from '../api/parties'
import { useFriends } from '../api/queries'
import { groupsApi, type Friend } from '../api/setup'
import { useAuth } from '../auth/AuthContext'
import { FriendAlbumsRow, friendViewsQuery, isMusicView } from '../components/FriendAlbums'
import MediaRow from '../components/MediaRow'
import { useToast } from '../components/Toast'
import { pushBackHandler } from '../lib/back'
import { IS_TV } from '../lib/device'

const PAD = 'px-4 sm:px-6 lg:px-12'

const AVATAR_TONES = [
  'bg-violet-500/20 text-violet-200 border-violet-400/25',
  'bg-sky-500/20 text-sky-200 border-sky-400/25',
  'bg-emerald-500/20 text-emerald-200 border-emerald-400/25',
  'bg-amber-500/20 text-amber-200 border-amber-400/25',
  'bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-400/25',
  'bg-rose-500/20 text-rose-200 border-rose-400/25',
] as const

function avatarTone(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return AVATAR_TONES[h % AVATAR_TONES.length]!
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase()
}

/** One friend's server: what they're sharing, a row per library. */
function FriendServer({ friend }: { friend: Friend }) {
  const views = useQuery(friendViewsQuery(friend.id))
  const resume = useQuery({ queryKey: ['friend', friend.id, 'resume'], queryFn: () => getResume(friend.id), staleTime: 60_000, retry: false })
  const all = views.data?.Items ?? []
  const libs = all.filter((v) => !isMusicView(v) && v.CollectionType !== 'playlists')
  const music = all.filter(isMusicView)

  return (
    <section className="space-y-6">
      <div className={`${PAD} flex flex-wrap items-center justify-between gap-3`}>
        <div className="flex items-center gap-3 min-w-0">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${avatarTone(friend.id)}`}>
            {initials(friend.name)}
          </span>
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-white tracking-tight truncate">{friend.name}</h2>
            <p className="text-[13px] text-ink-400">Shared with you. Streams come directly from their server.</p>
          </div>
        </div>
        {!views.isError && (libs.length > 0 || music.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {[...libs, ...music].map((lib) => (
              <Link
                key={lib.Id}
                to={`/library/${lib.Id}`}
                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-ink-200 hover:border-white/25 hover:bg-white/10 hover:text-white transition"
              >
                {lib.Name}
              </Link>
            ))}
          </div>
        )}
      </div>
      {views.isError ? (
        <div className="mx-4 sm:mx-6 lg:mx-12 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/5 bg-ink-900/50 px-4 py-3">
          <p className="text-sm text-ink-300">{friend.name} isn’t answering right now. It may be switched off, or no longer shared with you.</p>
          <button
            type="button"
            onClick={() => {
              void views.refetch()
              void resume.refetch()
            }}
            disabled={views.isFetching}
            className="h-9 shrink-0 rounded-lg border border-white/15 bg-white/10 px-3.5 text-sm font-semibold text-white transition hover:bg-white/15 active:scale-[0.97] disabled:opacity-60"
          >
            {views.isFetching ? 'Trying…' : 'Try again'}
          </button>
        </div>
      ) : (
        <>
          <MediaRow title="Continue watching" items={resume.data?.Items} variant="wide" />
          {views.isLoading ? <MediaRow title=" " items={undefined} loading /> : libs.map((lib) => <FriendLibraryRow key={lib.Id} viewId={lib.Id} title={lib.Name} />)}
          {music.map((lib) => (
            <FriendAlbumsRow key={lib.Id} viewId={lib.Id} title={lib.Name} />
          ))}
          {!views.isLoading && !libs.length && !music.length && <p className={`${PAD} text-sm text-ink-400`}>Nothing is shared with you yet.</p>}
        </>
      )}
    </section>
  )
}

function FriendLibraryRow({ viewId, title }: { viewId: string; title: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['latest', viewId], queryFn: () => getLatest(viewId, 24), staleTime: 5 * 60_000 })
  return <MediaRow title={title} items={data} loading={isLoading} seeAllHref={`/library/${viewId}`} />
}

/** Quick inline admin drawer for adding a friend or creating an invite code right on /friends. */
function QuickConnectPanel({
  mode,
  onClose,
}: {
  mode: 'add' | 'share'
  onClose: () => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: overview, isLoading } = useQuery({
    queryKey: ['groupsOverview'],
    queryFn: () => groupsApi.overview(),
    staleTime: 30_000,
    retry: false,
  })
  const [url, setUrl] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<string[] | null>(null)
  const [created, setCreated] = useState<{ code: string; expires: string } | null>(null)

  useEffect(() => pushBackHandler(() => {
    onClose()
    return true
  }), [onClose])

  const selectedLibs = picked ?? (overview?.libraries.map((l) => l.id) ?? [])
  const toggleLib = (id: string) => {
    const cur = new Set(selectedLibs)
    if (cur.has(id)) cur.delete(id)
    else cur.add(id)
    setPicked([...cur])
  }

  const submitAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || !url.trim() || !code.trim()) return
    setBusy(true)
    try {
      const f = await groupsApi.addFriend(url.trim(), code.trim().toUpperCase())
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['friends'] }),
        qc.invalidateQueries({ queryKey: ['groupsOverview'] }),
      ])
      toast(`Added ${f.name} to your friends list`)
      onClose()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const makeCode = async () => {
    if (busy || !selectedLibs.length) return
    setBusy(true)
    try {
      const res = await groupsApi.createCode(selectedLibs)
      setCreated(res)
      void qc.invalidateQueries({ queryKey: ['groupsOverview'] })
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const copyInvite = async () => {
    if (!created) return
    const text = overview?.publicUrl
      ? `Finesse address: ${overview.publicUrl}\nFriend code: ${created.code}`
      : created.code
    try {
      await navigator.clipboard.writeText(text)
      toast('Copied friend invite to clipboard')
    } catch {
      toast('Select and copy the code above')
    }
  }

  return (
    <div className="mx-4 sm:mx-6 lg:mx-12 rounded-2xl border border-white/10 bg-ink-900/80 p-5 shadow-xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white">
            {mode === 'add' ? 'Add a friend’s server' : 'Share your libraries with a friend'}
          </h2>
          <p className="mt-0.5 text-xs text-ink-400">
            {mode === 'add'
              ? 'Enter the Finesse address and one-time friend code they sent you.'
              : 'Pick which libraries to share, then send your friend the code and server address.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-8 w-8 shrink-0 rounded-full text-ink-400 hover:bg-white/10 hover:text-white transition"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {mode === 'add' ? (
        <form onSubmit={submitAdd} className="mt-4 grid gap-3 sm:grid-cols-[1fr_11rem_auto]">
          <input
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://their-finesse-address"
            aria-label="Friend’s Finesse address"
            className="h-10 rounded-lg border border-white/15 bg-ink-950/80 px-3 text-sm text-white placeholder:text-ink-500 focus:border-accent-400 focus:outline-none"
          />
          <input
            type="text"
            required
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="CODE"
            aria-label="Friend code"
            className="h-10 rounded-lg border border-white/15 bg-ink-950/80 px-3 font-mono text-sm uppercase tracking-widest text-white placeholder:text-ink-500 focus:border-accent-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !url.trim() || !code.trim()}
            className="h-10 rounded-lg bg-white px-5 text-sm font-semibold text-ink-950 hover:bg-ink-200 transition disabled:opacity-50"
          >
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        </form>
      ) : isLoading ? (
        <div className="mt-4 h-12 rounded-xl shimmer" />
      ) : created ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs text-emerald-200">One-time friend code</p>
            <p className="mt-0.5 font-mono text-2xl font-bold tracking-[0.22em] text-white">{created.code}</p>
            {overview?.publicUrl && (
              <p className="mt-1 truncate text-xs text-ink-300">Address: {overview.publicUrl}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!IS_TV && (
              <button
                type="button"
                onClick={() => void copyInvite()}
                className="h-9 rounded-lg bg-white px-4 text-xs font-semibold text-ink-950 hover:bg-ink-200 transition"
              >
                Copy invite
              </button>
            )}
            <button
              type="button"
              onClick={() => setCreated(null)}
              className="h-9 rounded-lg border border-white/15 px-3 text-xs font-medium text-ink-200 hover:bg-white/10"
            >
              New code
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {(overview?.libraries ?? []).map((lib) => {
              const on = selectedLibs.includes(lib.id)
              return (
                <button
                  key={lib.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleLib(lib.id)}
                  className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                    on
                      ? 'border-accent-400/60 bg-accent-500/20 text-white'
                      : 'border-white/10 bg-white/[0.03] text-ink-400 hover:text-white'
                  }`}
                >
                  {on ? '✓ ' : ''}{lib.name}
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-ink-400">
              {overview?.publicUrl ? `Your address: ${overview.publicUrl}` : 'Tip: set your public URL in Settings → People so friends can reach your server.'}
            </p>
            <button
              type="button"
              disabled={busy || !selectedLibs.length}
              onClick={() => void makeCode()}
              className="h-9 rounded-lg bg-white px-4 text-xs font-semibold text-ink-950 hover:bg-ink-200 transition disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create invite code'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Friends Hub: friends list with live status, household activity, Watch Together, Moments, and shared libraries. */
export default function FriendsPage() {
  const { data: friends, isLoading, isError, refetch, isFetching } = useFriends()
  const { session } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filterText, setFilterText] = useState('')
  const [connectMode, setConnectMode] = useState<'add' | 'share' | null>(null)
  const [offerBusy, setOfferBusy] = useState<string | null>(null)

  const { data: overview } = useQuery({
    queryKey: ['groupsOverview'],
    queryFn: () => groupsApi.overview(),
    enabled: Boolean(session?.isAdmin),
    staleTime: 60_000,
    retry: false,
  })
  const { data: sessions } = useQuery({
    queryKey: ['house'],
    queryFn: () => getSessions(),
    refetchInterval: 20_000,
    staleTime: 10_000,
    retry: false,
  })
  const { data: parties } = usePartyInvites(true)
  const { data: inbox } = useInbox()

  const friendList = useMemo(() => friends ?? [], [friends])
  // Reuse the exact same cached friendViewsQuery keys so FriendServer gets instant cache hits.
  const viewQueries = useQueries({
    queries: friendList.map((f) => friendViewsQuery(f.id)),
  })

  const friendMeta = useMemo(() => {
    const map = new Map<string, { state: 'online' | 'checking' | 'offline'; libs: { Id: string; Name: string }[]; refetch: () => void }>()
    friendList.forEach((f, idx) => {
      const q = viewQueries[idx]
      const items = (q?.data?.Items ?? []).filter((v) => v.CollectionType !== 'playlists')
      const state: 'online' | 'checking' | 'offline' = q?.isError ? 'offline' : q?.isLoading ? 'checking' : 'online'
      map.set(f.id, { state, libs: items.map((v) => ({ Id: v.Id, Name: v.Name })), refetch: () => void q?.refetch() })
    })
    return map
  }, [friendList, viewQueries])

  const watchingNow = useMemo(
    () =>
      (sessions ?? []).filter(
        (s) => Boolean(s.NowPlayingItem && s.UserName),
      ),
    [sessions],
  )
  const recentMoments = useMemo(() => (inbox?.moments ?? []).slice(0, 3), [inbox])
  const unreadMoments = inbox?.unread ?? 0
  const activeParties = parties ?? []
  const offers = overview?.offers ?? []

  const filteredFriends = useMemo(() => {
    const q = filterText.trim().toLowerCase()
    if (!q) return friendList
    return friendList.filter((f) => f.name.toLowerCase().includes(q))
  }, [friendList, filterText])

  const shownServers = useMemo(() => {
    if (selectedId && friendList.some((f) => f.id === selectedId)) {
      return friendList.filter((f) => f.id === selectedId)
    }
    return filteredFriends
  }, [friendList, filteredFriends, selectedId])

  const onlineCount = useMemo(
    () => friendList.filter((f) => friendMeta.get(f.id)?.state === 'online').length,
    [friendList, friendMeta],
  )

  const handleOffer = async (id: string, name: string, accept: boolean) => {
    setOfferBusy(id)
    try {
      if (accept) {
        await groupsApi.acceptOffer(id)
        toast(`Added ${name} to your friends list`)
      } else {
        await groupsApi.dismissOffer(id)
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['friends'] }),
        qc.invalidateQueries({ queryKey: ['groupsOverview'] }),
      ])
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setOfferBusy(null)
    }
  }

  // A failed look isn't "no friends": that said "add one" to someone who already has some.
  const none = !isLoading && !isError && !friendList.length
  const hasLiveStrip = watchingNow.length > 0 || activeParties.length > 0 || recentMoments.length > 0

  return (
    <div className="pb-16 py-6 space-y-8">
      {/* Header + Quick Actions */}
      <div className={`${PAD} flex flex-wrap items-end justify-between gap-4`}>
        <div>
          <h1 className="page-title mb-1">Friends</h1>
          <p className="text-sm text-ink-400">
            {friendList.length > 0
              ? `${friendList.length} connected ${friendList.length === 1 ? 'server' : 'servers'} · ${onlineCount} online right now`
              : 'Libraries friends share from their own Finesse, plus live activity and Watch Together.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/together"
            className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3.5 text-xs font-semibold text-white hover:bg-white/10 transition"
          >
            Watch Together
            {activeParties.length > 0 && (
              <span className="rounded-full bg-emerald-400/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                {activeParties.length}
              </span>
            )}
          </Link>
          <Link
            to="/moments"
            className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3.5 text-xs font-semibold text-white hover:bg-white/10 transition"
          >
            Moments
            {unreadMoments > 0 && (
              <span className="rounded-full bg-fuchsia-400/25 px-1.5 py-0.5 text-[10px] font-bold text-fuchsia-200">
                {unreadMoments} new
              </span>
            )}
          </Link>
          {session?.isAdmin && (
            <>
              <button
                type="button"
                onClick={() => setConnectMode((m) => (m === 'add' ? null : 'add'))}
                className={`h-9 rounded-full px-3.5 text-xs font-semibold transition ${
                  connectMode === 'add'
                    ? 'bg-accent-fill text-white'
                    : 'bg-white text-ink-950 hover:bg-ink-200'
                }`}
              >
                + Add friend
              </button>
              <button
                type="button"
                onClick={() => setConnectMode((m) => (m === 'share' ? null : 'share'))}
                className={`h-9 rounded-full border px-3.5 text-xs font-semibold transition ${
                  connectMode === 'share'
                    ? 'border-accent-400/60 bg-accent-500/20 text-white'
                    : 'border-white/15 bg-white/[0.04] text-ink-100 hover:bg-white/10'
                }`}
              >
                Share yours
              </button>
            </>
          )}
        </div>
      </div>

      {/* Pending Friend Offers */}
      {offers.length > 0 && (
        <div className={`${PAD} space-y-2`}>
          {offers.map((offer) => (
            <div
              key={offer.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent-400/30 bg-accent-500/10 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">{offer.name} offered to share their library with you</p>
                <p className="text-xs text-ink-300 truncate">{offer.url}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={offerBusy === offer.id}
                  onClick={() => void handleOffer(offer.id, offer.name, true)}
                  className="h-9 rounded-lg bg-white px-4 text-xs font-semibold text-ink-950 hover:bg-ink-200 disabled:opacity-50"
                >
                  {offerBusy === offer.id ? 'Adding…' : 'Accept'}
                </button>
                <button
                  type="button"
                  disabled={offerBusy === offer.id}
                  onClick={() => void handleOffer(offer.id, offer.name, false)}
                  className="h-9 rounded-lg border border-white/15 px-3 text-xs font-medium text-ink-200 hover:bg-white/10 disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Inline Add / Share drawer */}
      {connectMode && session?.isAdmin && (
        <QuickConnectPanel mode={connectMode} onClose={() => setConnectMode(null)} />
      )}

      {/* Live Activity Strip: Watching now, Watch Together, Recent Moments */}
      {hasLiveStrip && (
        <section className={`${PAD} grid gap-3 lg:grid-cols-3`} aria-label="Live activity">
          {watchingNow.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-ink-900/60 p-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-400">Watching now</h2>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden />
                  {watchingNow.length} live
                </span>
              </div>
              <ul className="space-y-2.5">
                {watchingNow.slice(0, 4).map((s) => {
                  const np = s.NowPlayingItem!
                  const label = np.SeriesName ? `${np.SeriesName} · ${np.Name}` : np.Name
                  return (
                    <li key={s.Id} className="flex items-center gap-2.5">
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${avatarTone(s.UserId ?? s.UserName ?? s.Id)}`}>
                        {initials(s.UserName ?? '?')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-white">
                          {s.UserName}{' '}
                          <span className="font-normal text-ink-400">on {s.DeviceName || s.Client || 'Finesse'}</span>
                        </p>
                        <Link
                          to={`/item/${np.SeriesId ?? np.Id}`}
                          className="block truncate text-xs text-accent-300 hover:text-white transition"
                        >
                          {label}
                        </Link>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {activeParties.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-ink-900/60 p-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-400">Watch parties</h2>
                <Link to="/together" className="text-xs font-semibold text-accent-300 hover:text-white">
                  All
                </Link>
              </div>
              <ul className="space-y-2.5">
                {activeParties.slice(0, 3).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-white">{p.title}</p>
                      <p className="truncate text-[11px] text-ink-400">
                        Hosted by {p.host} · {p.people} {p.people === 1 ? 'person' : 'people'}
                      </p>
                    </div>
                    {p.item && (
                      <Link
                        to={`/play/${p.item}?party=${encodeURIComponent(p.id)}`}
                        className="shrink-0 rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-ink-950 hover:bg-ink-200 transition"
                      >
                        {p.joined ? 'Rejoin' : 'Join'}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {recentMoments.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-ink-900/60 p-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-400">Recent moments</h2>
                <Link to="/moments" className="text-xs font-semibold text-accent-300 hover:text-white">
                  Open
                </Link>
              </div>
              <ul className="space-y-2.5">
                {recentMoments.map((m) => (
                  <li key={m.key}>
                    <Link
                      to={momentHref(m)}
                      className="group flex items-start gap-2.5 rounded-lg -mx-1.5 px-1.5 py-1 hover:bg-white/5 transition"
                    >
                      <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${avatarTone(m.from)}`}>
                        {initials(m.from)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-white group-hover:text-accent-200">
                          {m.from} <span className="font-normal text-ink-400">· {m.title}</span>
                          {m.start != null && <span className="ml-1 font-mono text-[10.5px] text-ink-400">{clock(m.start)}</span>}
                        </p>
                        <p className="truncate text-[11.5px] text-ink-300">
                          {m.spoiler ? 'Spoiler note · click to view' : m.note || 'Recommended this title'}
                        </p>
                      </div>
                      {!m.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-fuchsia-400" aria-label="Unread" />}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Friends List Roster */}
      {isLoading ? (
        <div className="space-y-6" aria-busy="true" aria-label="Loading friends’ servers">
          <div className={`${PAD} grid gap-3 sm:grid-cols-2 lg:grid-cols-3`}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-28 rounded-2xl shimmer" />
            ))}
          </div>
          <MediaRow title=" " items={undefined} loading />
        </div>
      ) : isError && !friendList.length ? (
        <div className="mx-4 sm:mx-6 lg:mx-12 flex max-w-2xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/5 bg-ink-900/50 px-5 py-4">
          <p className="text-sm text-ink-300">Couldn’t load your friends’ servers. Check your connection and try again.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="h-10 shrink-0 rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 transition hover:bg-ink-200 active:scale-[0.97] disabled:opacity-60"
          >
            {isFetching ? 'Trying…' : 'Try again'}
          </button>
        </div>
      ) : none ? (
        <div className="mx-4 sm:mx-6 lg:mx-12 rounded-2xl border border-white/10 bg-ink-900/55 px-6 py-10 sm:p-12 text-center max-w-2xl">
          <p className="text-lg font-semibold text-white">No friends connected yet</p>
          <p className="text-sm text-ink-300 mt-1.5">
            When a friend who runs Finesse shares with you, they appear in your friends list and you can stream straight from their libraries.
          </p>
          {session?.isAdmin ? (
            <div className="mt-6 flex flex-wrap justify-center gap-2.5">
              <button
                type="button"
                onClick={() => setConnectMode('add')}
                className="inline-flex h-10 items-center rounded-full bg-white px-5 text-sm font-semibold text-ink-950 hover:bg-ink-200 transition active:scale-[0.97]"
              >
                + Add a friend
              </button>
              <button
                type="button"
                onClick={() => setConnectMode('share')}
                className="inline-flex h-10 items-center rounded-full border border-white/15 bg-white/5 px-5 text-sm font-semibold text-white hover:bg-white/10 transition active:scale-[0.97]"
              >
                Share your library
              </button>
            </div>
          ) : (
            <p className="mt-3 text-xs text-ink-400">Ask whoever runs this server to connect with friends.</p>
          )}
        </div>
      ) : (
        <>
          <section className={`${PAD} space-y-3`} aria-label="Friends list">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-400">Friends list</h2>
                {selectedId && (
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold text-white hover:bg-white/20 transition"
                  >
                    Show all ({friendList.length})
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {friendList.length >= 3 && (
                  <input
                    type="search"
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    placeholder="Filter friends…"
                    aria-label="Filter friends"
                    className="h-8 w-44 rounded-full border border-white/10 bg-ink-900/70 px-3 text-xs text-white placeholder:text-ink-500 focus:border-accent-400 focus:outline-none"
                  />
                )}
                {session?.isAdmin && (
                  <Link
                    to="/settings?s=people&at=groups"
                    className="text-xs font-semibold text-ink-400 hover:text-white transition"
                  >
                    Manage sharing →
                  </Link>
                )}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredFriends.map((f) => {
                const meta = friendMeta.get(f.id)
                const state = meta?.state ?? 'checking'
                const libs = meta?.libs ?? []
                const active = selectedId === f.id
                const watchingUs = overview?.links.some((l) => l.name.toLowerCase() === f.name.toLowerCase())
                return (
                  <div
                    key={f.id}
                    className={`group rounded-2xl border p-4 transition ${
                      active
                        ? 'border-accent-400/70 bg-accent-500/10 shadow-lg'
                        : 'border-white/10 bg-ink-900/60 hover:border-white/20 hover:bg-ink-900/80'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() => setSelectedId((cur) => (cur === f.id ? null : f.id))}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        aria-pressed={active}
                      >
                        <span className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-sm font-bold ${avatarTone(f.id)}`}>
                          {initials(f.name)}
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-ink-900 ${
                              state === 'online'
                                ? 'bg-emerald-400'
                                : state === 'checking'
                                  ? 'bg-amber-400 animate-pulse'
                                  : 'bg-rose-400'
                            }`}
                            title={state === 'online' ? 'Online' : state === 'checking' ? 'Checking…' : 'Offline'}
                          />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-white">{f.name}</p>
                          <p className="mt-0.5 text-xs text-ink-400">
                            {state === 'online'
                              ? libs.length
                                ? `${libs.length} ${libs.length === 1 ? 'library' : 'libraries'} shared`
                                : 'Connected · no libraries yet'
                              : state === 'checking'
                                ? 'Checking connection…'
                                : 'Offline right now'}
                          </p>
                        </div>
                      </button>
                      {state === 'offline' && (
                        <button
                          type="button"
                          onClick={() => meta?.refetch()}
                          className="shrink-0 rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-semibold text-ink-200 hover:bg-white/10 hover:text-white"
                        >
                          Retry
                        </button>
                      )}
                    </div>

                    {(libs.length > 0 || watchingUs) && (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-white/5 pt-2.5">
                        {libs.slice(0, 4).map((lib) => (
                          <Link
                            key={lib.Id}
                            to={`/library/${lib.Id}`}
                            className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-[11px] font-medium text-ink-200 hover:bg-white/15 hover:text-white transition"
                          >
                            {lib.Name}
                          </Link>
                        ))}
                        {libs.length > 4 && (
                          <span className="text-[11px] text-ink-400">+{libs.length - 4} more</span>
                        )}
                        {watchingUs && (
                          <span className="ml-auto rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                            Mutual
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          {/* Shared Library Shelves */}
          <div className="space-y-10">
            {shownServers.map((f) => (
              <div key={f.id} className="cv-card" style={{ containIntrinsicSize: 'auto 720px' }}>
                <FriendServer friend={f} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
