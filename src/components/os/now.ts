// Finesse 2.0's home is one "Now" row: what you're in the middle of, what's
// playing in other rooms, games, a friend's pick and what just arrived, each
// with the art, colour and action the stage needs. Everything here comes from
// data the app already loads (resume, next up, sessions, friends, latest).

import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import * as api from '../../api/client'
import { backdropUrl, episodeThumbUrl, imageUrl, logoUrl, getPeerLatest, type JfSession } from '../../api/client'
import { useArrQueue, useFriends, useLatest, useNextUp, useResume, useViews } from '../../api/queries'
import { formatRuntime, type JfItem } from '../../api/types'
import { backdropBlurhash, blurhashAverageColor, primaryBlurhash } from '../../lib/blurhash'
import { vividRgb } from '../../lib/accent'
import { useFinesse } from '../../lib/finesseServer'
import { playHref } from '../MediaCard'

export type NowKind = 'elsewhere' | 'resume' | 'next' | 'music' | 'play' | 'friend' | 'new'

export interface NowEntry {
  key: string
  kind: NowKind
  /** The title the stage describes (its details load as you rest on it). */
  item?: JfItem
  title: string
  /** The line above the title: why it's here. */
  kicker: string
  /** The tile's small line. */
  sub: string
  badge?: string
  /** Full-screen art behind the stage, and the tile's own (smaller) art. */
  art: string | null
  tileArt: string | null
  /** Square art (music): shown blurred behind, and as a cover on the tile. */
  cover?: string | null
  logo: string | null
  /** "r, g, b": the colour the room takes on. */
  tint: string
  pct?: number
  primary: { label: string; to: string; stopSession?: string }
  info?: string
  /** A scene the server draws itself (game streaming). */
  gen?: 'neon' | 'pixel'
  playing?: boolean
}

const FALLBACK_TINT = '117, 137, 216'
const MAX = 10
const WATCHABLE = new Set(['Movie', 'Series', 'Season', 'Episode', 'Video'])

export function tintOf(item: JfItem | undefined): string {
  if (!item) return FALLBACK_TINT
  const avg = blurhashAverageColor(backdropBlurhash(item) ?? primaryBlurhash(item))
  return avg ? vividRgb(avg[0], avg[1], avg[2]).join(', ') : FALLBACK_TINT
}

function seriesLogo(item: JfItem): string | null {
  if (item.Type === 'Episode' && item.ParentLogoItemId && item.ParentLogoImageTag) {
    return imageUrl(item.ParentLogoItemId, 'Logo', { maxWidth: 600, tag: item.ParentLogoImageTag })
  }
  return logoUrl(item, 600)
}

const left = (item: JfItem, pos: number) => (item.RunTimeTicks ? formatRuntime(item.RunTimeTicks - pos) : '')
const episodeLabel = (item: JfItem) => `S${item.ParentIndexNumber ?? '?'} · E${item.IndexNumber ?? '?'}`

function watchEntry(item: JfItem, kind: 'resume' | 'next' | 'friend' | 'new', artWidth: number, extra: Partial<NowEntry> = {}): NowEntry {
  const isEp = item.Type === 'Episode'
  const pos = item.UserData?.PlaybackPositionTicks ?? 0
  const resuming = !item.UserData?.Played && pos > 0
  const pct = resuming && item.RunTimeTicks ? Math.min(100, Math.max(2, (pos / item.RunTimeTicks) * 100)) : undefined
  const rest = left(item, pos)
  const title = isEp ? (item.SeriesName ?? item.Name) : item.Name
  const playable = item.Type === 'Movie' || item.Type === 'Episode' || item.Type === 'Video'
  let kicker = ''
  let sub = ''
  if (kind === 'resume') {
    kicker = rest ? `Continue · ${rest} left` : 'Continue'
    sub = isEp ? `${episodeLabel(item)} · ${rest} left` : `${rest} left`
  } else if (kind === 'next') {
    kicker = `Up next · season ${item.ParentIndexNumber ?? '?'}, episode ${item.IndexNumber ?? '?'}`
    sub = `${episodeLabel(item)} next`
  } else if (kind === 'new') {
    kicker = 'New on your server'
    sub = item.Type === 'Series' ? 'New show' : item.ProductionYear ? `${item.ProductionYear}` : 'New'
  }
  return {
    key: `${kind}-${item.Id}`,
    kind,
    item,
    title,
    kicker,
    sub,
    art: backdropUrl(item, artWidth),
    tileArt: isEp ? episodeThumbUrl(item, 720) ?? backdropUrl(item, 720) : backdropUrl(item, 720),
    logo: seriesLogo(item),
    tint: tintOf(item),
    pct,
    primary: playable
      ? { label: resuming ? 'Resume' : isEp ? `Play ${episodeLabel(item).replace(' · ', ':')}` : 'Play', to: playHref(item) }
      : { label: 'Open', to: `/item/${item.Id}` },
    info: `/item/${isEp && item.SeriesId ? item.SeriesId : item.Id}`,
    ...extra,
  }
}

function sessionEntry(s: JfSession, artWidth: number): NowEntry | null {
  const item = s.NowPlayingItem
  if (!item) return null
  const pos = s.PlayState?.PositionTicks ?? 0
  const where = s.DeviceName || s.Client || 'another device'
  if (item.Type === 'Audio') {
    const cover = item.AlbumId && item.AlbumPrimaryImageTag ? imageUrl(item.AlbumId, 'Primary', { maxWidth: 800, tag: item.AlbumPrimaryImageTag }) : null
    return {
      key: `music-${s.Id}`,
      kind: 'music',
      item,
      title: item.Album || item.Name,
      kicker: `Playing on ${where}`,
      sub: `${where} · ${item.Name}`,
      badge: 'Live',
      art: null,
      tileArt: null,
      cover,
      logo: null,
      tint: tintOf(item),
      primary: { label: 'Open album', to: item.AlbumId ? `/album/${item.AlbumId}` : '/music' },
      playing: !s.PlayState?.IsPaused,
    }
  }
  const e = watchEntry(item, 'resume', artWidth)
  return {
    ...e,
    key: `elsewhere-${s.Id}`,
    kind: 'elsewhere',
    kicker: `Playing on ${where}${left(item, pos) ? ` · ${left(item, pos)} left` : ''}`,
    sub: `On ${where}`,
    badge: 'Live',
    pct: item.RunTimeTicks ? Math.min(100, (pos / item.RunTimeTicks) * 100) : undefined,
    primary: { label: 'Continue here', to: `/play/${item.Id}${pos > 0 ? `?t=${pos}` : ''}`, stopSession: s.Id },
    playing: !s.PlayState?.IsPaused,
  }
}

/** Everyone's sessions this account can see (administrators see the whole house). */
export function useHouse() {
  return useQuery({
    queryKey: ['house'],
    queryFn: () => api.getSessions(),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
    retry: false,
  })
}

/** artWidth: how wide the stage's art is fetched (phones don't need 1920). */
export function useNowEntries(artWidth = 1920): { entries: NowEntry[]; loading: boolean } {
  const { data: resume, isLoading: resumeLoading } = useResume()
  const { data: nextUp, isLoading: nextLoading } = useNextUp()
  const { data: sessions } = useHouse()
  const { data: views } = useViews()
  const { info } = useFinesse()
  const { data: friends } = useFriends()
  const movieLib = views?.Items.find((v) => v.CollectionType === 'movies')
  const showLib = views?.Items.find((v) => v.CollectionType === 'tvshows')
  const { data: latestMovies } = useLatest(movieLib?.Id)
  const { data: latestShows } = useLatest(showLib?.Id)
  // The same query (and cache) the friends' rows on Home use.
  const friendPicks = useQueries({
    queries: (friends ?? []).slice(0, 2).map((f) => ({
      queryKey: ['friend', f.id, 'latest'],
      queryFn: async () => (await getPeerLatest(f.id, 40)).filter((i) => WATCHABLE.has(i.Type)).slice(0, 24),
      staleTime: 5 * 60_000,
      retry: false,
    })),
    combine: (results) => results.map((r) => r.data?.[0]),
  })

  const entries = useMemo(() => {
    const out: NowEntry[] = []
    const seen = new Set<string>()
    const push = (e: NowEntry | null) => {
      if (!e || out.length >= MAX) return
      const id = e.item?.Id ?? e.key
      if (seen.has(id)) return
      seen.add(id)
      out.push(e)
    }
    const me = api.getSession()
    const mine = (sessions ?? []).filter((s) => s.UserId === me?.userId && s.DeviceId !== api.DEVICE_ID && s.NowPlayingItem)
    for (const s of mine.filter((x) => x.NowPlayingItem?.Type !== 'Audio')) push(sessionEntry(s, artWidth))
    for (const it of (resume?.Items ?? []).slice(0, 3)) push(watchEntry(it, 'resume', artWidth))
    for (const it of (nextUp?.Items ?? []).slice(0, 2)) push(watchEntry(it, 'next', artWidth))
    for (const s of mine.filter((x) => x.NowPlayingItem?.Type === 'Audio')) push(sessionEntry(s, artWidth))
    if (info?.features.streaming) {
      push({
        key: 'play-streaming',
        kind: 'play',
        title: 'Your PC games',
        kicker: 'Play · streamed from your server',
        sub: 'Ready to play',
        art: null,
        tileArt: null,
        logo: null,
        tint: '122, 92, 255',
        gen: 'neon',
        primary: { label: 'Play', to: '/games' },
      })
    }
    friendPicks.forEach((it, i) => {
      const f = friends?.[i]
      if (!f || !it) return
      push(watchEntry(it, 'friend', artWidth, { kicker: `From ${f.name}`, sub: `Shared by ${f.name}`, badge: f.name }))
    })
    const fresh: JfItem[] = []
    const ms = latestMovies ?? []
    const ss = latestShows ?? []
    for (let i = 0; i < Math.max(ms.length, ss.length); i++) {
      if (ms[i]) fresh.push(ms[i])
      if (ss[i]) fresh.push(ss[i])
    }
    for (const it of fresh) {
      if (!it.BackdropImageTags?.length && !it.ImageTags?.Thumb) continue
      push(watchEntry(it, 'new', artWidth, { badge: 'New' }))
    }
    return out
  }, [sessions, resume, nextUp, info, friends, friendPicks, latestMovies, latestShows, artWidth])

  return { entries, loading: (resumeLoading || nextLoading) && entries.length === 0 }
}

/** The ticker under the rail: a few true lines about the house right now. */
export function useLiveLines(entries: NowEntry[]): { text: string; when: string; rgb: string }[] {
  const { data: sessions } = useHouse()
  const { data: queue } = useArrQueue()
  const { data: friends } = useFriends()
  return useMemo(() => {
    const me = api.getSession()
    const lines: { text: string; when: string; rgb: string }[] = []
    for (const s of sessions ?? []) {
      const it = s.NowPlayingItem
      if (!it || s.DeviceId === api.DEVICE_ID) continue
      const who = s.UserId === me?.userId ? 'You’re' : `${s.UserName ?? 'Someone'} is`
      const what = it.Type === 'Audio' ? `listening to ${it.Album || it.Name}` : `watching ${it.Type === 'Episode' ? it.SeriesName : it.Name}`
      lines.push({ text: `${who} ${what} on ${s.DeviceName ?? 'a device'}`, when: 'now', rgb: tintOf(it) })
    }
    for (const d of (queue ?? []).slice(0, 3)) {
      lines.push(d.done ? { text: `${d.title} is almost ready`, when: 'importing', rgb: '91, 227, 141' } : { text: `${d.title} is downloading`, when: `${d.progress}%`, rgb: '147, 165, 232' })
    }
    for (const e of entries.filter((x) => x.kind === 'new').slice(0, 2)) lines.push({ text: `${e.title} was added`, when: 'new', rgb: e.tint })
    for (const e of entries.filter((x) => x.kind === 'friend').slice(0, 1)) lines.push({ text: `${e.badge} shared ${e.title}`, when: 'friends', rgb: e.tint })
    if (friends?.length && !entries.some((x) => x.kind === 'friend')) lines.push({ text: `${friends.length} friend${friends.length === 1 ? '' : 's'} share their libraries with you`, when: 'friends', rgb: '54, 169, 188' })
    return lines
  }, [sessions, queue, friends, entries])
}
