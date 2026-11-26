import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import * as api from '../../api/client'
import { backdropUrl, imageUrl, posterUrl } from '../../api/client'
import { gameStoreMode, isActive as isActiveGameRequest } from '../../api/gameStore'
import { useGameRequests } from '../../api/gameStoreQueries'
import { useInbox } from '../../api/moments'
import { usePartyInvites } from '../../api/parties'
import { useArrQueue, useFriends, useResume, useSabStatus } from '../../api/queries'
import { connectionsApi, systemApi } from '../../api/setup'
import { useAuth } from '../../auth/AuthContext'
import { friendViewsQuery } from '../FriendAlbums'
import { useToast } from '../Toast'
import { beginServerUpdate, useServerUpdate } from '../../lib/appUpdate'
import { pushBackHandler } from '../../lib/back'
import { bytes, explainProblem, roughly, speed } from '../../lib/downloadProblems'
import { useFinesse } from '../../lib/finesseServer'
import { useOverlayFocus } from '../../lib/overlayFocus'
import { closeQuickMenu, useQuickMenuOpen } from '../../lib/quickMenu'
import { shortVersion } from '../Update'
import { useHouse } from './now'

const card = 'rounded-3xl bg-white/[0.05] border border-white/10 p-4 sm:p-5 flex flex-col gap-3.5 min-w-0'
const heading = 'os-kicker text-white/60'
const linkBtn =
  'mt-auto self-start inline-flex h-9 items-center rounded-full border border-white/20 bg-white/[0.07] px-3.5 text-[13px] font-semibold text-white hover:bg-white/[0.14] transition-colors'
const actionPill =
  'inline-flex h-9 items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-3.5 text-[13px] font-semibold text-white hover:bg-white/[0.15] active:scale-[0.98] transition disabled:opacity-55'

const gb = (n: number) => (n >= 1e12 ? `${(n / 1e12).toFixed(1)} TB` : `${Math.round(n / 1e9)} GB`)

function QuickActions({
  fixableCount,
  fixing,
  onFixAll,
}: {
  fixableCount: number
  fixing: boolean
  onFixAll: () => void
}) {
  const { session } = useAuth()
  const { info } = useFinesse()
  const { data: resume } = useResume()
  const { data: serverUp } = useServerUpdate()
  const navigate = useNavigate()
  const toast = useToast()
  const [picking, setPicking] = useState(false)
  const [scanning, setScanning] = useState(false)

  const topResume = resume?.Items?.[0]
  const resumeArt = topResume ? backdropUrl(topResume, 320) ?? posterUrl(topResume, 180) : null
  const resumeTitle = topResume
    ? topResume.Type === 'Episode' && topResume.SeriesName
      ? `${topResume.SeriesName}${topResume.ParentIndexNumber != null && topResume.IndexNumber != null ? ` · S${topResume.ParentIndexNumber}:E${topResume.IndexNumber}` : ''}`
      : topResume.Name
    : ''
  const resumePct = topResume?.UserData?.PlayedPercentage ? Math.round(topResume.UserData.PlayedPercentage) : null

  const pickSurprise = async () => {
    if (picking) return
    setPicking(true)
    try {
      const res = await api.getItems({
        includeItemTypes: 'Movie,Series',
        recursive: true,
        filters: 'IsUnplayed',
        sortBy: 'Random',
        limit: 1,
        fields: 'PrimaryImageAspectRatio',
      })
      const pick = res.Items?.[0]
      if (!pick) {
        toast('No unwatched movies or shows found')
        return
      }
      closeQuickMenu()
      navigate(`/item/${pick.Id}`)
    } catch {
      toast('Couldn’t pick a title right now', 'error')
    } finally {
      setPicking(false)
    }
  }

  const scanLibrary = async () => {
    if (scanning) return
    setScanning(true)
    try {
      await api.refreshLibrary()
      toast('Library scan started')
    } catch {
      toast('Couldn’t start library scan', 'error')
    } finally {
      setScanning(false)
    }
  }

  const serverUpdate = !__WEBOS__ && session?.isAdmin && serverUp?.available && serverUp.latest ? serverUp.latest : null

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 px-2">
      {topResume && (
        <Link
          to={`/play/${topResume.Id}`}
          className="group inline-flex min-w-0 max-w-full sm:max-w-[22rem] items-center gap-2.5 rounded-full border border-white/20 bg-white/[0.1] pl-1.5 pr-4 py-1 text-left hover:bg-white/[0.18] transition"
        >
          {resumeArt ? (
            <img src={resumeArt} alt="" className="h-7 w-11 shrink-0 rounded-full object-cover" />
          ) : (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-ink-950 text-xs font-bold">▶</span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-semibold text-white">Resume · {resumeTitle}</span>
          </span>
          {resumePct != null && (
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-white/70">{resumePct}%</span>
          )}
        </Link>
      )}

      <button type="button" onClick={() => void pickSurprise()} disabled={picking} className={actionPill}>
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
        </svg>
        {picking ? 'Picking…' : 'Surprise me'}
      </button>

      {info?.features?.requests && (
        <Link to="/request" className={actionPill}>
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Request
        </Link>
      )}

      {session?.isAdmin && (
        <button type="button" onClick={() => void scanLibrary()} disabled={scanning} className={actionPill}>
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          {scanning ? 'Scanning…' : 'Scan library'}
        </button>
      )}

      {session?.isAdmin && fixableCount > 0 && (
        <button
          type="button"
          onClick={onFixAll}
          disabled={fixing}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-amber-300/40 bg-amber-400/20 px-3.5 text-[13px] font-semibold text-amber-100 hover:bg-amber-400/30 active:scale-[0.98] transition disabled:opacity-55"
        >
          <span className="h-2 w-2 rounded-full bg-amber-300 animate-pulse" aria-hidden />
          {fixing ? 'Fixing…' : `Fix ${fixableCount} server ${fixableCount === 1 ? 'issue' : 'issues'}`}
        </button>
      )}

      {serverUpdate && (
        <button
          type="button"
          onClick={() => {
            closeQuickMenu()
            void beginServerUpdate(serverUpdate, serverUp?.kind)
          }}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-accent-300/40 bg-accent-500/25 px-3.5 text-[13px] font-semibold text-white hover:bg-accent-500/35 transition"
        >
          Update to {shortVersion(serverUpdate)}
        </button>
      )}
    </div>
  )
}

function House() {
  const { data: sessions } = useHouse()
  const { data: parties } = usePartyInvites(true)
  const { data: inbox } = useInbox()
  const playing = (sessions ?? []).filter((s) => s.NowPlayingItem)
  const activeParties = parties ?? []
  const unreadMoments = inbox?.unread ?? 0

  return (
    <section className={card} aria-label="In the house">
      <div className="flex items-center justify-between gap-2">
        <h3 className={heading}>In the house</h3>
        {playing.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden />
            {playing.length} live
          </span>
        )}
      </div>

      {playing.length === 0 && activeParties.length === 0 ? (
        <p className="text-[14px] text-white/60">Nobody’s streaming right now.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {playing.slice(0, 3).map((s) => {
            const it = s.NowPlayingItem!
            const isEp = it.Type === 'Episode'
            const isAudio = it.Type === 'Audio'
            const href = isAudio && it.AlbumId ? `/album/${it.AlbumId}` : `/item/${isEp && it.SeriesId ? it.SeriesId : it.Id}`
            const art = isAudio
              ? it.AlbumId && it.AlbumPrimaryImageTag
                ? imageUrl(it.AlbumId, 'Primary', { maxWidth: 160, tag: it.AlbumPrimaryImageTag })
                : null
              : backdropUrl(it, 320)
            const title = isEp ? it.SeriesName || it.Name : isAudio ? it.Album || it.Name : it.Name
            const pct = it.RunTimeTicks ? Math.min(100, ((s.PlayState?.PositionTicks ?? 0) / it.RunTimeTicks) * 100) : 0
            return (
              <li key={s.Id} className="min-w-0">
                <Link to={href} className="group flex items-center gap-3 rounded-2xl -mx-1.5 px-1.5 py-1 hover:bg-white/[0.06] transition">
                  {art ? (
                    <img src={art} alt="" className={`shrink-0 h-11 rounded-lg object-cover ${isAudio ? 'w-11' : 'w-[70px]'}`} />
                  ) : (
                    <span className="shrink-0 h-11 w-[70px] rounded-lg bg-white/10" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-white group-hover:text-accent-200 transition-colors">{title}</p>
                    <p className="truncate text-[12px] text-white/60">
                      {s.UserName ?? 'Someone'} · {s.DeviceName ?? 'Finesse'}
                      {s.PlayState?.IsPaused ? ' · paused' : ''}
                    </p>
                    {pct > 0 && (
                      <div className="mt-1.5 h-1 rounded-full bg-white/15 overflow-hidden">
                        <div className="h-full rounded-full bg-white/85" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>
                </Link>
              </li>
            )
          })}
          {activeParties.slice(0, 2).map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 rounded-2xl border border-accent-400/25 bg-accent-500/10 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-white">{p.title}</p>
                <p className="truncate text-[11.5px] text-white/65">
                  Watch party · {p.host} ({p.people})
                </p>
              </div>
              {p.item && (
                <Link
                  to={`/play/${p.item}?party=${encodeURIComponent(p.id)}`}
                  className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-ink-950 hover:bg-ink-200 transition"
                >
                  {p.joined ? 'Rejoin' : 'Join'}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}

      {unreadMoments > 0 && (
        <Link
          to="/moments"
          className="flex items-center justify-between rounded-2xl border border-fuchsia-400/20 bg-fuchsia-500/10 px-3 py-2 text-[12.5px] font-medium text-fuchsia-100 hover:bg-fuchsia-500/20 transition"
        >
          <span>{unreadMoments} unread {unreadMoments === 1 ? 'moment' : 'moments'}</span>
          <span aria-hidden>→</span>
        </Link>
      )}

      <Link to="/activity" className={linkBtn}>
        Activity
      </Link>
    </section>
  )
}

function Server({
  conn,
  fixableCount,
  fixing,
  onFixAll,
}: {
  conn: Awaited<ReturnType<typeof connectionsApi.get>> | undefined
  fixableCount: number
  fixing: boolean
  onFixAll: () => void
}) {
  const { data: s } = useQuery({ queryKey: ['system', 'status', 'quick'], queryFn: () => systemApi.status(), staleTime: 15_000, retry: false })
  const { data: counts } = useQuery({ queryKey: ['itemCounts', 'quick'], queryFn: () => api.getItemCounts(), staleTime: 5 * 60_000, retry: false })

  if (!s && !conn) {
    return (
      <section className={card} aria-label="Server">
        <h3 className={heading}>Server</h3>
        <div className="h-24 rounded-2xl shimmer" />
      </section>
    )
  }

  const h = s?.health
  const own = s?.mode === 'adopt'
  const services = h?.services ?? []
  const down = services.filter((x) => x.state !== 'running' && x.state !== 'paused' && x.state !== 'starting').length
  const roomiest = [...(h?.disks ?? [])].sort((a, b) => b.free - a.free)[0]

  const connApps = conn?.apps ?? []
  const connBad = connApps.filter((a) => a.ok === false)
  const connOk = connApps.filter((a) => a.ok === true).length
  const allOk = down === 0 && connBad.length === 0 && (!h?.vpn || h.vpn.connected) && (!conn?.vpn || conn.vpn.ok !== false)

  const libraryBits = [
    counts?.MovieCount ? `${counts.MovieCount.toLocaleString()} movies` : null,
    counts?.SeriesCount ? `${counts.SeriesCount.toLocaleString()} shows` : null,
    counts?.AlbumCount ? `${counts.AlbumCount.toLocaleString()} albums` : null,
  ].filter(Boolean)

  const row = (label: string, value: string, warn = false) => (
    <p className="flex justify-between gap-3 text-white/70">
      <span>{label}</span>
      <b className={`min-w-0 truncate font-semibold ${warn ? 'text-amber-200' : 'text-white'}`}>{value}</b>
    </p>
  )

  return (
    <section className={card} aria-label="Server">
      <div className="flex items-center justify-between gap-2">
        <h3 className={heading}>Server</h3>
        {s?.version && <span className="font-mono text-[11px] text-white/45">v{s.version}</span>}
      </div>

      <div className="flex items-center gap-3.5">
        <span
          className={`relative grid place-items-center h-14 w-14 sm:h-16 sm:w-16 shrink-0 rounded-full ${allOk ? 'bg-[#5BE38D]/15 text-[#7ff0a8]' : 'bg-amber-300/15 text-amber-200'}`}
          style={{ boxShadow: allOk ? '0 0 36px rgba(91,227,141,.28), inset 0 0 0 2.5px rgba(91,227,141,.8)' : 'inset 0 0 0 2.5px rgba(252,211,77,.85)' }}
        >
          <span className="font-display italic text-[22px] sm:text-[24px] leading-none">{allOk ? 'OK' : '!'}</span>
        </span>
        <div className="min-w-0 flex-1 space-y-1 text-[13.5px]">
          {connApps.length > 0
            ? row(
                'Apps',
                connBad.length > 0 ? `${connBad.length} need${connBad.length === 1 ? 's' : ''} a look` : `${connOk} connected`,
                connBad.length > 0,
              )
            : !own && services.length > 0
              ? row('Apps', down ? `${down} down` : `${services.length} running`, down > 0)
              : null}
          {libraryBits.length > 0 && row('Library', libraryBits.slice(0, 2).join(' · '))}
          {h?.vpn && row('VPN', h.vpn.connected ? `On${h.vpn.country ? ` · ${h.vpn.country}` : ''}` : 'Off', !h.vpn.connected)}
          {roomiest && row('Storage', `${gb(roomiest.free)} free`)}
        </div>
      </div>

      {connBad.length > 0 && (
        <p className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-100">
          {connBad.map((a) => a.name).join(', ')}: {connBad[0]!.summary}
        </p>
      )}

      <div className="mt-auto flex flex-wrap gap-2">
        {fixableCount > 0 && (
          <button
            type="button"
            onClick={onFixAll}
            disabled={fixing}
            className="inline-flex h-9 items-center rounded-full bg-amber-300 px-3.5 text-[13px] font-semibold text-ink-950 hover:bg-amber-200 transition disabled:opacity-55"
          >
            {fixing ? 'Fixing…' : 'Fix now'}
          </button>
        )}
        <Link to="/settings?s=health" className={linkBtn.replace('mt-auto ', '')}>
          Server settings
        </Link>
      </div>
    </section>
  )
}

function Downloads() {
  const { info } = useFinesse()
  const { data: queue, isError } = useArrQueue(Boolean(info?.features?.requests))
  const { data: sab } = useSabStatus()
  const { data: gameReqs } = useGameRequests()

  const mediaItems = queue ?? []
  const activeGames = (gameReqs ?? []).filter(isActiveGameRequest)
  const stuckCount = mediaItems.filter((d) => d.status === 'Needs attention' || Boolean(d.reason)).length

  return (
    <section className={card} aria-label="Downloads">
      <div className="flex items-center justify-between gap-2">
        <h3 className={heading}>Downloads</h3>
        {sab && sab.speedBps > 0 && !sab.paused ? (
          <span className="font-mono text-[11.5px] font-semibold text-emerald-300">{speed(sab.speedBps)}</span>
        ) : stuckCount > 0 ? (
          <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[10.5px] font-semibold text-amber-200">
            {stuckCount} stuck
          </span>
        ) : null}
      </div>

      {(isError || mediaItems.length === 0) && activeGames.length === 0 ? (
        <p className="text-[14px] text-white/60">Nothing downloading right now.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {mediaItems.slice(0, 3).map((d) => {
            const stuck = d.status === 'Needs attention' || Boolean(d.reason)
            const etaMs = d.etaAt ? Date.parse(d.etaAt) - Date.now() : 0
            const meta = stuck
              ? explainProblem(d.reason, d.done).what
              : d.done
                ? d.status
                : [
                    `${d.progress}%`,
                    d.leftBytes > 0 ? `${bytes(d.leftBytes)} left` : null,
                    etaMs > 0 ? roughly(etaMs) : d.status,
                  ]
                    .filter(Boolean)
                    .join(' · ')
            return (
              <li key={d.key} className="min-w-0">
                <p className="truncate text-[14px] font-semibold text-white">{d.title}</p>
                <div className="mt-1.5 h-1.5 rounded-full bg-white/12 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${stuck ? 'bg-amber-400' : d.done ? 'bg-[#5BE38D]' : 'os-stripes'}`}
                    style={{ width: `${Math.max(4, d.done ? 100 : d.progress)}%` }}
                  />
                </div>
                <p className={`mt-1 truncate text-[11.5px] ${stuck ? 'text-amber-200' : 'font-mono text-white/55'}`}>{meta}</p>
              </li>
            )
          })}
          {activeGames.slice(0, 2).map((g) => (
            <li key={g.id} className="min-w-0">
              <Link to="/games/store/requests" className="group block">
                <p className="truncate text-[14px] font-semibold text-white group-hover:text-accent-200 transition-colors">
                  {g.title} <span className="text-[11px] font-normal text-white/50">· Game</span>
                </p>
                <div className="mt-1.5 h-1.5 rounded-full bg-white/12 overflow-hidden">
                  <div className="h-full rounded-full bg-accent-400" style={{ width: `${Math.max(6, g.progress ?? 0)}%` }} />
                </div>
                <p className="mt-1 truncate font-mono text-[11.5px] text-white/55">
                  {[
                    g.progress != null ? `${Math.round(g.progress)}%` : null,
                    g.bytesPerSecond ? speed(g.bytesPerSecond) : null,
                    g.detail || g.state,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto flex flex-wrap gap-2">
        <Link to="/request" className={linkBtn.replace('mt-auto ', '')}>
          Requests &amp; queue
        </Link>
        {activeGames.length > 0 && (
          <Link to="/games/store/requests" className={linkBtn.replace('mt-auto ', '')}>
            Game queue
          </Link>
        )}
      </div>
    </section>
  )
}

function PlayAndFriends() {
  const { info } = useFinesse()
  const { data: friends } = useFriends()
  const { data: gameReqs } = useGameRequests()
  const friendList = useMemo(() => friends ?? [], [friends])
  const viewQueries = useQueries({ queries: friendList.slice(0, 4).map((f) => friendViewsQuery(f.id)) })

  const streaming = Boolean(info?.features.streaming)
  const hasGames = Boolean(info?.features.games || streaming || gameStoreMode(info))
  const readyGames = (gameReqs ?? []).filter((r) => r.state === 'ready').length

  return (
    <section className={card} aria-label="Friends and games">
      <h3 className={heading}>Friends &amp; games</h3>
      <div className="space-y-2 text-[13.5px]">
        {friendList.length > 0 ? (
          friendList.slice(0, 3).map((f, idx) => {
            const q = viewQueries[idx]
            const state = q?.isError ? 'offline' : q?.isLoading ? 'checking' : 'online'
            const count = (q?.data?.Items ?? []).filter((v) => v.CollectionType !== 'playlists').length
            return (
              <p key={f.id} className="flex items-center justify-between gap-3 text-white/80">
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      state === 'online' ? 'bg-emerald-400' : state === 'checking' ? 'bg-amber-400 animate-pulse' : 'bg-rose-400'
                    }`}
                    aria-hidden
                  />
                  <span className="truncate font-medium text-white">{f.name}</span>
                </span>
                <span className="shrink-0 text-[12px] text-white/55">
                  {state === 'online' ? (count ? `${count} ${count === 1 ? 'lib' : 'libs'}` : 'Online') : state === 'checking' ? '…' : 'Offline'}
                </span>
              </p>
            )
          })
        ) : (
          <p className="text-white/60">No friends’ servers connected yet.</p>
        )}

        {hasGames && (
          <div className="border-t border-white/10 pt-2 space-y-1.5">
            {readyGames > 0 && (
              <p className="flex justify-between gap-3 text-white/70">
                <span>Installed games</span>
                <b className="font-semibold text-white">{readyGames} ready</b>
              </p>
            )}
            <p className="flex justify-between gap-3 text-white/70">
              <span>Game streaming</span>
              <b className={`font-semibold ${streaming ? 'text-[#7ff0a8]' : 'text-white/55'}`}>{streaming ? 'Ready' : 'Off'}</b>
            </p>
          </div>
        )}
      </div>

      <div className="mt-auto flex flex-wrap gap-2">
        <Link to="/friends" className={linkBtn.replace('mt-auto ', '')}>
          Friends
        </Link>
        {hasGames && (
          <Link to="/games" className={linkBtn.replace('mt-auto ', '')}>
            Games
          </Link>
        )}
      </div>
    </section>
  )
}

/** The system layer: the whole house at a glance + 1-click actions, over whatever you're doing. */
export default function QuickMenu() {
  const open = useQuickMenuOpen()
  const { session } = useAuth()
  const { pathname } = useLocation()
  const sheet = useRef<HTMLElement>(null)
  const qc = useQueryClient()
  const toast = useToast()
  const [fixing, setFixing] = useState(false)

  // Focus moves onto the sheet (its Close button) and back to what opened it.
  useOverlayFocus(open, sheet)

  const { data: conn } = useQuery({
    queryKey: ['system', 'connections'],
    queryFn: () => connectionsApi.get(),
    enabled: open && Boolean(session?.isAdmin),
    staleTime: 30_000,
    retry: false,
  })

  const fixable = useMemo(
    () => (conn?.apps ?? []).flatMap((a) => (a.fixes ?? []).map((f) => ({ app: a.id, fix: f.id, label: f.label }))),
    [conn],
  )

  const runFixAll = async () => {
    if (fixing || fixable.length === 0) return
    setFixing(true)
    let ok = 0
    for (const item of fixable) {
      try {
        await connectionsApi.fix(item.app, item.fix)
        ok++
      } catch {
        /* continue attempting remaining repairs */
      }
    }
    await qc.invalidateQueries({ queryKey: ['system', 'connections'] })
    toast(ok > 0 ? `Fixed ${ok} of ${fixable.length} server ${fixable.length === 1 ? 'issue' : 'issues'}` : 'Couldn’t auto-fix — check Server settings', ok > 0 ? 'info' : 'error')
    setFixing(false)
  }

  useEffect(() => closeQuickMenu(), [pathname])
  useEffect(() => {
    if (!open) return
    document.documentElement.dataset.overlay = 'open'
    const popBack = pushBackHandler(() => {
      closeQuickMenu()
      return true
    })
    return () => {
      delete document.documentElement.dataset.overlay
      popBack()
    }
  }, [open])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] flex flex-col justify-end px-3 pb-3 pt-14 sm:px-6 sm:pb-6 sm:pt-20 lg:px-12 lg:pb-10">
      <button type="button" aria-label="Close the quick menu" className="os-qm-scrim absolute inset-0 h-full w-full bg-black/65 os-fade-in cursor-default" onClick={closeQuickMenu} />
      <section
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-label="Quick menu"
        className="os-glass os-sheet-in relative flex max-h-full min-h-0 flex-col overflow-hidden rounded-[32px]"
      >
        <div className="flex shrink-0 items-center justify-between gap-4 px-5 pb-3 pt-5 sm:px-7 sm:pt-6 lg:px-8">
          <h2 className="font-display italic text-[32px] sm:text-[42px] leading-none text-white">Quick menu</h2>
          <button
            type="button"
            onClick={closeQuickMenu}
            data-autofocus
            className="inline-flex h-10 items-center gap-2 rounded-full border border-white/20 bg-white/[0.08] px-4 text-[14px] font-semibold text-white hover:bg-white/[0.16] transition-colors"
          >
            Close
          </button>
        </div>
        <div className="os-scroll mx-2 mb-3 min-h-0 flex-1 overflow-y-auto px-1 pb-5 pt-1 sm:mx-3 sm:px-2 lg:mx-4">
          <QuickActions fixableCount={fixable.length} fixing={fixing} onFixAll={() => void runFixAll()} />
          <div className={`grid gap-3 px-2 sm:gap-4 sm:grid-cols-2 ${session?.isAdmin ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>
            <House />
            {session?.isAdmin && (
              <Server conn={conn} fixableCount={fixable.length} fixing={fixing} onFixAll={() => void runFixAll()} />
            )}
            <Downloads />
            <PlayAndFriends />
          </div>
        </div>
      </section>
    </div>
  )
}
