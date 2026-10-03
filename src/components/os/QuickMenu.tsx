import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useLocation } from 'react-router-dom'
import * as api from '../../api/client'
import { backdropUrl, imageUrl } from '../../api/client'
import { useArrQueue, useFriends } from '../../api/queries'
import { systemApi } from '../../api/setup'
import { useAuth } from '../../auth/AuthContext'
import { pushBackHandler } from '../../lib/back'
import { useFinesse } from '../../lib/finesseServer'
import { closeQuickMenu, useQuickMenuOpen } from '../../lib/quickMenu'
import { useHouse } from './now'

const card = 'rounded-3xl bg-white/[0.05] border border-white/10 p-5 flex flex-col gap-4 min-w-0'
const heading = 'os-kicker text-white/60'
const linkBtn =
  'mt-auto self-start inline-flex h-10 items-center rounded-full border border-white/20 bg-white/[0.07] px-4 text-[14px] font-semibold text-white hover:bg-white/[0.14] transition-colors'

const gb = (n: number) => (n >= 1e12 ? `${(n / 1e12).toFixed(1)} TB` : `${Math.round(n / 1e9)} GB`)
const ago = (iso: string | null | undefined) => {
  if (!iso) return 'never'
  const h = (Date.now() - Date.parse(iso)) / 3_600_000
  if (h < 1) return 'within the hour'
  if (h < 24) return `${Math.round(h)} h ago`
  return `${Math.round(h / 24)} days ago`
}

function House() {
  const { data: sessions } = useHouse()
  const playing = (sessions ?? []).filter((s) => s.NowPlayingItem && s.DeviceId !== api.DEVICE_ID)
  return (
    <section className={card} aria-label="In the house">
      <h3 className={heading}>In the house</h3>
      {playing.length === 0 ? (
        <p className="text-[15px] text-white/65">Nothing’s playing anywhere right now.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {playing.slice(0, 4).map((s) => {
            const it = s.NowPlayingItem!
            const art =
              it.Type === 'Audio'
                ? it.AlbumId && it.AlbumPrimaryImageTag
                  ? imageUrl(it.AlbumId, 'Primary', { maxWidth: 160, tag: it.AlbumPrimaryImageTag })
                  : null
                : backdropUrl(it, 320)
            const title = it.Type === 'Episode' ? it.SeriesName : it.Type === 'Audio' ? it.Album || it.Name : it.Name
            const pct = it.RunTimeTicks ? Math.min(100, ((s.PlayState?.PositionTicks ?? 0) / it.RunTimeTicks) * 100) : 0
            return (
              <li key={s.Id} className="flex items-center gap-3 min-w-0">
                {art ? (
                  <img src={art} alt="" className={`shrink-0 h-11 rounded-lg object-cover ${it.Type === 'Audio' ? 'w-11' : 'w-[72px]'}`} />
                ) : (
                  <span className="shrink-0 h-11 w-[72px] rounded-lg bg-white/10" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-white">{title}</p>
                  <p className="truncate text-[13px] text-white/60">
                    {s.DeviceName ?? 'A device'}
                    {s.UserName ? ` · ${s.UserName}` : ''}
                    {s.PlayState?.IsPaused ? ' · paused' : ''}
                  </p>
                  {pct > 0 && (
                    <div className="mt-1.5 h-1 rounded-full bg-white/15 overflow-hidden">
                      <div className="h-full rounded-full bg-white/80" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function Server() {
  const { data: s } = useQuery({ queryKey: ['system', 'status', 'quick'], queryFn: () => systemApi.status(), staleTime: 15_000, retry: false })
  if (!s) {
    return (
      <section className={card} aria-label="Server">
        <h3 className={heading}>Server</h3>
        <div className="h-24 rounded-2xl shimmer" />
      </section>
    )
  }
  const h = s.health
  const services = h.services ?? []
  const running = services.filter((x) => x.state === 'running').length
  const down = services.filter((x) => x.state !== 'running' && x.state !== 'paused' && x.state !== 'starting').length
  const roomiest = [...(h.disks ?? [])].sort((a, b) => b.free - a.free)[0]
  const ok = down === 0 && (!h.vpn || h.vpn.connected)
  return (
    <section className={card} aria-label="Server">
      <h3 className={heading}>Server</h3>
      <div className="flex items-center gap-4">
        <span
          className={`relative grid place-items-center h-20 w-20 shrink-0 rounded-full ${ok ? 'bg-[#5BE38D]/15 text-[#7ff0a8]' : 'bg-amber-300/15 text-amber-200'}`}
          style={{ boxShadow: ok ? '0 0 40px rgba(91,227,141,.3), inset 0 0 0 3px rgba(91,227,141,.8)' : 'inset 0 0 0 3px rgba(252,211,77,.8)' }}
        >
          <span className="font-display italic text-[26px] leading-none">{ok ? 'OK' : '!'}</span>
        </span>
        <div className="min-w-0 flex-1 space-y-1.5 text-[14px]">
          {services.length > 0 && (
            <p className="flex justify-between gap-3 text-white/70">
              <span>Apps</span>
              <b className="font-semibold text-white">{down ? `${down} need${down === 1 ? 's' : ''} a look` : `${running} running`}</b>
            </p>
          )}
          {h.vpn && (
            <p className="flex justify-between gap-3 text-white/70">
              <span>VPN</span>
              <b className="font-semibold text-white truncate">{h.vpn.connected ? `On${h.vpn.country ? ` · ${h.vpn.country}` : ''}` : 'Off'}</b>
            </p>
          )}
          {roomiest && (
            <p className="flex justify-between gap-3 text-white/70">
              <span>Space</span>
              <b className="font-semibold text-white">{gb(roomiest.free)} free</b>
            </p>
          )}
          <p className="flex justify-between gap-3 text-white/70">
            <span>Backup</span>
            <b className="font-semibold text-white">{ago(h.backups?.last)}</b>
          </p>
        </div>
      </div>
      <Link to="/settings#settings-server" className={linkBtn}>
        Server settings
      </Link>
    </section>
  )
}

function Downloads() {
  const { data: queue, isError } = useArrQueue()
  const items = (queue ?? []).slice(0, 3)
  return (
    <section className={card} aria-label="Downloads">
      <h3 className={heading}>Downloads</h3>
      {isError || items.length === 0 ? (
        <p className="text-[15px] text-white/65">Nothing downloading. Requests start here as soon as a release turns up.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((d) => (
            <li key={d.key} className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-white">{d.title}</p>
              <div className="mt-2 h-2 rounded-full bg-white/12 overflow-hidden">
                <div className={`h-full rounded-full ${d.done ? 'bg-[#5BE38D]' : 'os-stripes'}`} style={{ width: `${Math.max(4, d.done ? 100 : d.progress)}%` }} />
              </div>
              <p className="mt-1.5 font-mono text-[12px] text-white/55">{d.done ? d.status : `${d.progress}% · ${d.status}`}</p>
            </li>
          ))}
        </ul>
      )}
      <Link to="/request" className={linkBtn}>
        Requests and downloads
      </Link>
    </section>
  )
}

function PlayAndFriends() {
  const { info } = useFinesse()
  const { data: friends } = useFriends()
  const streaming = Boolean(info?.features.streaming)
  return (
    <section className={card} aria-label="Play and friends">
      <h3 className={heading}>Play &amp; friends</h3>
      <div className="space-y-2.5 text-[14px]">
        <p className="flex justify-between gap-3 text-white/70">
          <span>Game streaming</span>
          <b className={`font-semibold ${streaming ? 'text-[#7ff0a8]' : 'text-white/60'}`}>{streaming ? 'Ready' : 'Off'}</b>
        </p>
        {(friends ?? []).slice(0, 3).map((f) => (
          <p key={f.id} className="flex justify-between gap-3 text-white/70">
            <span className="truncate">{f.name}</span>
            <b className="font-semibold text-white">Sharing</b>
          </p>
        ))}
        {!friends?.length && <p className="text-white/60">No friends’ servers yet.</p>}
      </div>
      <div className="mt-auto flex flex-wrap gap-2">
        {streaming && (
          <Link to="/games" className={linkBtn.replace('mt-auto ', '')}>
            Games
          </Link>
        )}
        {Boolean(friends?.length) && (
          <Link to="/friends" className={linkBtn.replace('mt-auto ', '')}>
            Friends
          </Link>
        )}
      </div>
    </section>
  )
}

/** The system layer: the whole house at a glance, over whatever you're doing. */
export default function QuickMenu() {
  const open = useQuickMenuOpen()
  const { session } = useAuth()
  const { pathname } = useLocation()

  useEffect(() => closeQuickMenu(), [pathname])
  useEffect(() => {
    if (!open) return
    return pushBackHandler(() => {
      closeQuickMenu()
      return true
    })
  }, [open])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70]">
      <button type="button" aria-label="Close the quick menu" className="absolute inset-0 bg-black/45 backdrop-blur-md os-fade-in cursor-default" onClick={closeQuickMenu} />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Quick menu"
        className="os-glass os-sheet-in absolute inset-x-3 bottom-3 top-auto max-h-[calc(var(--vh)*86)] overflow-y-auto rounded-[32px] p-5 sm:inset-x-6 sm:bottom-6 sm:p-7 lg:inset-x-12 lg:bottom-10 lg:p-8"
      >
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display italic text-[34px] sm:text-[44px] leading-none text-white">Quick menu</h2>
          <button
            type="button"
            onClick={closeQuickMenu}
            data-autofocus
            className="inline-flex h-11 items-center gap-2 rounded-full border border-white/20 bg-white/[0.08] px-4 text-[14px] font-semibold text-white hover:bg-white/[0.16] transition-colors"
          >
            Close
          </button>
        </div>
        <div className={`mt-5 sm:mt-6 grid gap-4 sm:grid-cols-2 ${session?.isAdmin ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>
          <House />
          {session?.isAdmin && <Server />}
          <Downloads />
          <PlayAndFriends />
        </div>
      </section>
    </div>
  )
}
