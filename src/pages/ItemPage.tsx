import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import TitleLogo from '../components/TitleLogo'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useClipManifest, useCollectionItems, useEpisodes, useItem, useSeasons } from '../api/queries'
import {
  backdropUrl,
  episodeThumbUrl,
  getSeriesNextUp,
  imageUrl,
  logoUrl,
  posterUrl,
  getSimilar,
  refreshItemMetadata,
  setFavorite,
  setPlayed,
  waitForImageChange,
} from '../api/client'
import { blurhashAverageColor, primaryBlurhash } from '../lib/blurhash'
import { fillFor, shadesFromRgb, vividRgb } from '../lib/accent'
import { getPrefs } from '../lib/settings'
import { previewClipUrl, EMPTY_MANIFEST } from '../lib/preview'
import { morphNavigate, posterMorphName, setReturnMorph } from '../lib/motion'
import { useDepthParallax } from '../lib/depth'
import { goBack } from '../lib/back'
import { TOUCH_UI } from '../lib/device'
import { setMood } from '../lib/mood'
import { useToast } from '../components/Toast'
import FixMatchDialog from '../components/FixMatchDialog'
import CastMenu from '../components/CastMenu'
import { ActionMenu, type ActionItem } from '../components/Menu'
import { ACTION_BTN, ActionButton, actionCircle } from '../components/ActionButton'
import WatchlistButton from '../components/WatchlistButton'
import TrailerHero from '../components/TrailerHero'
import VideoClipHero from '../components/VideoClipHero'
import MediaCard, { playHref } from '../components/MediaCard'
import { useAuth } from '../auth/AuthContext'
import { CardSkeleton } from '../components/Skeletons'
import { formatRuntime, ticksToSeconds } from '../api/types'
import type { JfItem } from '../api/types'

function youTubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/.*[?&]v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/)
  return m ? m[1] : null
}

function firstTrailerId(item: JfItem): string | null {
  for (const t of item.RemoteTrailers ?? []) {
    const id = youTubeId(t.Url)
    if (id) return id
  }
  return null
}

const PLAY_BTN =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-white text-ink-950 h-11 px-6 text-[15px] font-semibold hover:bg-ink-200 active:scale-[0.98] transition-all w-full sm:w-auto'

/** Under the Play button: how much is left (with a bar), or which episode is next. */
function ResumeMeta({ item, episodeName }: { item: JfItem; episodeName?: string }) {
  const pos = ticksToSeconds(item.UserData?.PlaybackPositionTicks)
  const total = ticksToSeconds(item.RunTimeTicks)
  const inProgress = pos > 0 && total > 0 && !item.UserData?.Played
  if (!inProgress) {
    return episodeName ? <p className="mt-2 text-[13px] text-ink-300 truncate">Up next: “{episodeName}”</p> : null
  }
  const min = Math.max(1, Math.round((total - pos) / 60))
  return (
    <div className="mt-2.5 flex items-center gap-2.5">
      <div className="h-1 w-28 shrink-0 rounded-full bg-white/15 overflow-hidden">
        <div className="h-full bg-accent-400" style={{ width: `${Math.min(100, (pos / total) * 100)}%` }} />
      </div>
      <span className="text-[13px] text-ink-300 truncate">
        {min} min left{episodeName ? ` in “${episodeName}”` : ''}
      </span>
    </div>
  )
}

function PlayLink({ item }: { item: JfItem }) {
  const navigate = useNavigate()
  const resumeTicks = item.UserData?.PlaybackPositionTicks ?? 0
  const canResume = resumeTicks > 0 && !item.UserData?.Played
  const href = `/play/${item.Id}${canResume ? `?t=${resumeTicks}` : ''}`
  return (
    <div className="w-full sm:w-auto min-w-0">
      <Link
        to={href}
        // The backdrop (data-vt-static="vt-hero") morphs into the player's video.
        onClick={(e) => morphNavigate(() => navigate(href), { event: e })}
        data-autofocus
        className={PLAY_BTN}
      >
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path d="M8 5v14l11-7z" />
        </svg>
        {canResume ? 'Resume' : 'Play'}
      </Link>
      <ResumeMeta item={item} />
    </div>
  )
}

/** Series pages play the next-up episode directly, matching the big streaming apps. */
function SeriesPlayLink({ seriesId }: { seriesId: string }) {
  const navigate = useNavigate()
  const { data } = useQuery({
    queryKey: ['seriesNextUp', seriesId],
    queryFn: () => getSeriesNextUp(seriesId),
    staleTime: 60_000,
  })
  const ep = data?.Items?.[0]
  if (!ep) return null
  const resumeTicks = ep.UserData?.PlaybackPositionTicks ?? 0
  const code = `S${ep.ParentIndexNumber ?? '?'}:E${ep.IndexNumber ?? '?'}`
  const href = `/play/${ep.Id}${resumeTicks > 0 ? `?t=${resumeTicks}` : ''}`
  return (
    <div className="w-full sm:w-auto min-w-0">
      <Link
        to={href}
        onClick={(e) => morphNavigate(() => navigate(href), { event: e })}
        data-autofocus
        className={PLAY_BTN}
      >
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path d="M8 5v14l11-7z" />
        </svg>
        {resumeTicks > 0 ? 'Resume' : 'Play'} {code}
      </Link>
      <ResumeMeta item={ep} episodeName={ep.Name} />
    </div>
  )
}

function EpisodeRow({ ep, upNext }: { ep: JfItem; upNext?: boolean }) {
  const navigate = useNavigate()
  const thumbRef = useRef<HTMLDivElement>(null)
  const thumb = episodeThumbUrl(ep)
  const pct =
    ep.UserData?.PlaybackPositionTicks && ep.RunTimeTicks
      ? (ep.UserData.PlaybackPositionTicks / ep.RunTimeTicks) * 100
      : 0
  // Missing episodes (known to Jellyfin, no file) can't play — show, don't link.
  const missing = ep.LocationType === 'Virtual'
  const rowClass = `group flex gap-3 sm:gap-4 rounded-xl p-2 sm:p-3 transition-colors ${
    missing ? 'opacity-45' : 'hover:bg-white/5'
  } ${upNext ? 'bg-white/[0.04] ring-1 ring-accent-400/30' : ''}`
  const body = (
    <>
      <div ref={thumbRef} className="relative w-32 sm:w-44 shrink-0 aspect-video rounded-lg overflow-hidden bg-ink-800 ring-1 ring-white/5">
        {thumb && (
          <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover fade-in" />
        )}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
          <div className="h-10 w-10 rounded-full bg-white/90 flex items-center justify-center">
            <svg className="h-5 w-5 text-ink-950 translate-x-px" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
        {ep.UserData?.Played && (
          <div className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-accent-fill flex items-center justify-center">
            <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
        )}
        {pct > 1 && pct < 99 && (
          <div className="absolute bottom-0 inset-x-0 h-1 bg-black/60">
            <div className="h-full bg-accent-400" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      <div className="min-w-0 py-0.5 sm:py-1">
        <p className="text-sm font-semibold text-white line-clamp-2">
          {ep.IndexNumber != null && <span className="text-ink-400 mr-2">{ep.IndexNumber}.</span>}
          {ep.Name}
        </p>
        <p className="text-xs text-ink-400 mt-0.5">
          {missing ? 'Not in library' : formatRuntime(ep.RunTimeTicks)}
          {upNext && !missing && <span className="ml-2 font-semibold text-accent-300">Up next</span>}
        </p>
        {ep.Overview && (
          <p className="hidden sm:block text-xs text-ink-400 mt-1.5 line-clamp-2 max-w-2xl">{ep.Overview}</p>
        )}
      </div>
    </>
  )
  return missing ? (
    <div className={rowClass}>{body}</div>
  ) : (
    <Link
      to={playHref(ep)}
      // This episode's still (not the series backdrop) grows into the player.
      onClick={(e) => morphNavigate(() => navigate(playHref(ep)), { from: thumbRef.current, name: 'vt-hero', event: e })}
      className={rowClass}
    >
      {body}
    </Link>
  )
}

function Seasons({ series }: { series: JfItem }) {
  const { data: seasons } = useSeasons(series.Id)
  const [seasonId, setSeasonId] = useState<string>()
  // Open on the season you're actually watching (shared cache with the Play button).
  const nextUp = useQuery({
    queryKey: ['seriesNextUp', series.Id],
    queryFn: () => getSeriesNextUp(series.Id),
    staleTime: 60_000,
  })
  const upNext = nextUp.data?.Items?.[0]

  useEffect(() => {
    if (seasonId || !seasons?.Items.length || nextUp.isLoading) return
    const current = upNext?.SeasonId && seasons.Items.find((s) => s.Id === upNext.SeasonId)
    // Otherwise the first real season over Specials (IndexNumber 0)
    const regular = seasons.Items.find((s) => (s.IndexNumber ?? 0) >= 1)
    setSeasonId((current || regular || seasons.Items[0]).Id)
  }, [seasons, seasonId, nextUp.isLoading, upNext])

  const { data: episodes, isLoading } = useEpisodes(series.Id, seasonId)

  if (!seasons?.Items.length) return null

  return (
    <section>
      <div className="flex items-center gap-2 mb-4 overflow-x-auto no-scrollbar">
        {seasons.Items.map((s) => (
          <button
            key={s.Id}
            onClick={() => setSeasonId(s.Id)}
            aria-pressed={s.Id === seasonId}
            className={`shrink-0 h-9 px-4 rounded-full text-sm transition-colors ${
              s.Id === seasonId
                ? 'bg-white text-ink-950 font-semibold'
                : 'bg-white/5 border border-white/10 text-ink-200 hover:text-white font-medium'
            }`}
          >
            {s.Name}
          </button>
        ))}
      </div>
      {/* Grid instead of a single column: a season fits in a screen or two
          instead of one long scroll. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-x-4 gap-y-1">
        {isLoading && <p className="text-ink-400 text-sm px-3 py-6">Loading episodes…</p>}
        {episodes?.Items.map((ep) => <EpisodeRow key={ep.Id} ep={ep} upNext={ep.Id === upNext?.Id} />)}
      </div>
    </section>
  )
}

type Tab = 'episodes' | 'similar' | 'details'
const TAB_LABEL: Record<Tab, string> = { episodes: 'Episodes', similar: 'More like this', details: 'Cast and details' }

function SimilarGrid({ itemId }: { itemId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['similar', itemId],
    queryFn: () => getSimilar(itemId, 18),
    staleTime: 10 * 60_000,
  })
  if (!isLoading && !data?.Items.length) {
    return <p className="text-sm text-ink-400 py-6">Nothing similar in your library yet.</p>
  }
  return (
    <div className="grid gap-3 sm:gap-4 grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
      {isLoading
        ? Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)
        : data!.Items.map((m) => <MediaCard key={m.Id} item={m} />)}
    </div>
  )
}

function DetailsTab({ item, cast, showPath }: { item: JfItem; cast: NonNullable<JfItem['People']>; showPath: boolean }) {
  const facts: [string, string][] = []
  if (item.Genres?.length) facts.push(['Genres', item.Genres.join(', ')])
  if (item.PremiereDate) facts.push(['Released', new Date(item.PremiereDate).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })])
  else if (item.ProductionYear) facts.push(['Released', String(item.ProductionYear)])
  if (item.Type !== 'Series' && item.RunTimeTicks) facts.push(['Runtime', formatRuntime(item.RunTimeTicks)])
  if (item.OfficialRating) facts.push(['Rated', item.OfficialRating])
  if (item.CommunityRating) facts.push(['Score', `${item.CommunityRating.toFixed(1)} / 10`])
  if (showPath && item.Path) facts.push(['File', item.Path])

  return (
    <div className="space-y-8">
      {cast.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-400 mb-4">Cast</h3>
          <div className="flex gap-4 sm:gap-5 overflow-x-auto no-scrollbar pb-2 snap-x snap-proximity">
            {cast.map((p) => (
              <Link
                key={p.Id}
                to={`/person/${p.Id}`}
                title={`${p.Name}${p.Role ? ` — ${p.Role}` : ''}`}
                className="group/cast w-20 sm:w-24 shrink-0 snap-start text-center outline-none"
              >
                <div className="relative h-20 w-20 sm:h-24 sm:w-24 rounded-full overflow-hidden bg-ink-800 ring-1 ring-white/5 mx-auto transition-all group-hover/cast:ring-2 group-hover/cast:ring-accent-400 group-focus-visible/cast:ring-2 group-focus-visible/cast:ring-accent-400 group-hover/cast:scale-105">
                  {p.PrimaryImageTag ? (
                    <img
                      src={imageUrl(p.Id, 'Primary', { maxWidth: 200, tag: p.PrimaryImageTag })}
                      alt={p.Name}
                      loading="lazy"
                      className="h-full w-full object-cover fade-in"
                    />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-2xl font-bold text-ink-400">
                      {p.Name.charAt(0)}
                    </div>
                  )}
                </div>
                <p className="mt-2 text-xs font-medium text-ink-200 truncate group-hover/cast:text-white transition-colors">{p.Name}</p>
                {p.Role && <p className="text-[11px] text-ink-400 truncate">{p.Role}</p>}
              </Link>
            ))}
          </div>
        </div>
      )}
      {facts.length > 0 && (
        <dl className="grid grid-cols-1 sm:grid-cols-[8rem_1fr] gap-x-6 gap-y-3 max-w-3xl text-sm">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ink-400">{k}</dt>
              <dd className={`text-ink-200 ${k === 'File' ? 'font-mono text-xs break-all' : ''}`}>{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

export default function ItemPage() {
  const { itemId } = useParams()
  const { data: item, isLoading } = useItem(itemId)
  // Back from here morphs into the card that opened this page.
  useEffect(() => (itemId ? setReturnMorph(itemId, posterMorphName()) : undefined), [itemId])
  const heroRef = useDepthParallax<HTMLDivElement>()
  // The room takes on this film's colour.
  useEffect(() => {
    const avg = item ? blurhashAverageColor(primaryBlurhash(item)) : null
    if (avg) setMood(vividRgb(avg[0], avg[1], avg[2]).join(', '))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.Id])
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const { session } = useAuth()
  const [favBusy, setFavBusy] = useState(false)
  const [fixOpen, setFixOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [previewOn, setPreviewOn] = useState(false)
  // The artwork stays up until the preview is actually playing.
  const [previewLive, setPreviewLive] = useState(false)
  const stopPreview = useCallback(() => {
    setPreviewOn(false)
    setPreviewLive(false)
  }, [])
  const previewPlaying = useCallback(() => setPreviewLive(true), [])
  const [tabSel, setTabSel] = useState<Tab | null>(null)
  const collection = useCollectionItems(itemId, item?.Type === 'BoxSet')
  const { data: clipSet } = useClipManifest()

  const trailerId = item ? firstTrailerId(item) : null
  const heroClipUrl = item ? previewClipUrl(item.Id, getPrefs().previewQuality, clipSet ?? EMPTY_MANIFEST) : null
  const hasClip = !!heroClipUrl
  // Prefer the local clip (offline, always matches) over the YouTube trailer
  const previewKind: 'clip' | 'trailer' | null = hasClip ? 'clip' : trailerId ? 'trailer' : null

  // Auto-play the hero preview after a short dwell (muted), Netflix-style.
  // Skipped on the TV build: video decode + the page UI fight for the TV SoC.
  useEffect(() => {
    stopPreview()
    if (!previewKind || __WEBOS__) return
    const t = setTimeout(() => setPreviewOn(true), 3500)
    return () => clearTimeout(t)
  }, [previewKind, itemId, stopPreview])

  if (isLoading || !item) {
    return <div className="h-[calc(var(--vh)*50)] shimmer -mt-16" />
  }

  const backdrop = backdropUrl(item)
  const logo = logoUrl(item)
  const titleText = (
    <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl leading-[0.95] text-white mb-3 drop-shadow-lg">{item.Name}</h1>
  )
  const poster = posterUrl(item, 600)
  const cast = item.People?.filter((p) => p.Type === 'Actor').slice(0, 12) ?? []
  const isSeries = item.Type === 'Series'
  const isBoxSet = item.Type === 'BoxSet'
  const isPlayable = item.Type === 'Movie' || item.Type === 'Episode'
  const isFavorite = item.UserData?.IsFavorite ?? false
  const played = item.UserData?.Played ?? false
  const tabs: Tab[] = isBoxSet ? [] : isSeries ? ['episodes', 'similar', 'details'] : ['similar', 'details']
  const tab: Tab = tabSel && tabs.includes(tabSel) ? tabSel : tabs[0]

  // Per-title color grading: sample the poster, then re-theme the whole detail
  // page from it. Overriding the accent CSS vars on the page root cascades to
  // every accent utility inside (buttons, season pills, progress bars, focus
  // rings, cast hover) — so each film's page adopts its own bespoke palette.
  const avg = blurhashAverageColor(primaryBlurhash(item))
  const vivid = avg ? vividRgb(avg[0], avg[1], avg[2]) : [98, 121, 205]
  const accentRgb = `${vivid[0]}, ${vivid[1]}, ${vivid[2]}`
  const grade = avg ? shadesFromRgb(avg[0], avg[1], avg[2]) : null
  const gradeStyle = grade
    ? ({
        '--color-accent-300': grade[300],
        '--color-accent-400': grade[400],
        '--color-accent-500': grade[500],
        '--color-accent-600': grade[600],
        '--color-accent-fill': fillFor(grade[600]),
      } as CSSProperties)
    : undefined

  const refreshMetadata = async () => {
    setRefreshing(true)
    const oldTag = item.ImageTags?.Primary
    try {
      await refreshItemMetadata(item.Id)
      toast('Refreshing metadata…')
      // Wait for the async refresh to actually swap the art, then repaint
      // everything (detail page + grids/rows that cached the old image tag).
      await waitForImageChange(item.Id, oldTag)
      await queryClient.invalidateQueries()
      toast('Metadata updated')
    } catch {
      toast('Refresh failed', 'error')
    } finally {
      setRefreshing(false)
    }
  }

  const toggleFavorite = async () => {
    setFavBusy(true)
    try {
      await setFavorite(item.Id, !isFavorite)
      await queryClient.invalidateQueries({ queryKey: ['item', itemId] })
      toast(isFavorite ? 'Removed from favorites' : 'Added to favorites')
    } catch {
      toast('Could not update favorite', 'error')
    } finally {
      setFavBusy(false)
    }
  }

  const togglePlayed = async () => {
    try {
      await setPlayed(item.Id, !played)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['item', itemId] }),
        queryClient.invalidateQueries({ queryKey: ['resume'] }),
        queryClient.invalidateQueries({ queryKey: ['nextUp'] }),
      ])
      toast(played ? 'Marked as unwatched' : 'Marked as watched')
    } catch {
      toast('Could not update', 'error')
    }
  }

  // Everyday actions first; library management (admins only) tucked under a
  // labelled group instead of sitting under the synopsis for everyone.
  const isAdmin = session?.isAdmin !== false
  const moreItems: ActionItem[] = [
    ...(isPlayable || isSeries ? [{ label: played ? 'Mark as unwatched' : 'Mark as watched', onSelect: togglePlayed }] : []),
    ...(tabs.includes('details') ? [{ label: 'Cast and details', onSelect: () => setTabSel('details') }] : []),
    ...(isAdmin
      ? [
          { section: 'Admin', label: 'Fix match…', onSelect: () => setFixOpen(true) },
          { label: refreshing ? 'Refreshing metadata…' : 'Refresh metadata', onSelect: refreshMetadata, disabled: refreshing },
          ...(item.Path && tabs.includes('details') ? [{ label: 'File info', onSelect: () => setTabSel('details') }] : []),
        ]
      : []),
  ]

  return (
    <div className="pb-16" style={gradeStyle}>
      {/* Ambilight: the backdrop, blown out and breathing, washes the whole page */}
      {backdrop && (
        <div className="ambilight fixed inset-0 -z-10 overflow-hidden" aria-hidden>
          <img
            src={backdrop}
            alt=""
            className="ambient-breathe h-full w-full object-cover blur-3xl brightness-[0.22] saturate-150"
          />
        </div>
      )}

      <div ref={heroRef} className="relative -mt-16">
        {/* Phones (and the installed PWA, which has no browser Back) get an
            in-app Back — it plays the reverse morph into the card you came from. */}
        {TOUCH_UI && (
          <button
            type="button"
            onClick={() => goBack(navigate)}
            aria-label="Back"
            className="vt-detail-back absolute left-3 top-[4.75rem] z-20 h-10 w-10 rounded-full bg-black/45 backdrop-blur-md ring-1 ring-white/10 flex items-center justify-center text-white active:scale-95 transition-transform"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
        )}
        {/* The whole hero (not just its image) is the morph target, so the
            morph carries its melt mask instead of popping it on at the end. */}
        <div data-vt-static="vt-hero" className="hero-melt relative h-[calc(var(--vh)*48)] min-h-[360px] w-full overflow-hidden">
          {/* Depth: the backdrop sinks on scroll and drifts against the pointer */}
          <div className="hero-scroll h-full">
            <div className="depth-back h-full">
              {backdrop && (
                <img
                  src={backdrop}
                  alt=""
                  className={`h-full w-full object-cover fade-in transition-opacity duration-700 ${previewOn && previewLive ? 'opacity-0' : 'opacity-100'}`}
                />
              )}
            </div>
          </div>
          {/* Hero preview after a dwell: local clip (offline) first, else YouTube trailer. Hover fades audio in. */}
          {previewOn && previewKind === 'clip' && heroClipUrl && (
            <VideoClipHero clipUrl={heroClipUrl} onClose={stopPreview} onPlaying={previewPlaying} />
          )}
          {previewOn && previewKind === 'trailer' && trailerId && (
            <TrailerHero youtubeId={trailerId} onClose={stopPreview} onPlaying={previewPlaying} />
          )}
          {/* Fade the sharp backdrop into its own blurred ambilight — progressive-blur look, no seam */}
          <div className="absolute inset-0 bg-gradient-to-t from-ink-950/45 via-ink-950/10 to-ink-950/30 pointer-events-none" />
        </div>

        {/* Own transition layer (vt-detail-head): fades in above the morphing
            hero instead of hiding under it. z-10 keeps its menus (Cast to…)
            above the sections below — the depth transform makes it a stacking context. */}
        <div className="vt-detail-head depth-front relative z-10 px-4 sm:px-6 lg:px-12 -mt-40 flex gap-8 items-end">
          {poster && (
            <img
              src={poster}
              alt={item.Name}
              data-vt-static="vt-poster"
              style={{ boxShadow: `0 25px 60px -12px rgba(${accentRgb}, 0.35)` }}
              className="hidden md:block w-52 rounded-xl ring-1 ring-white/10 shrink-0"
            />
          )}
          <div className="min-w-0 pb-2">
            {logo ? (
              <TitleLogo
                src={logo}
                alt={item.Name ?? ''}
                className="max-h-20 max-w-[calc(var(--vw)*80)] sm:max-w-md object-contain mb-3 drop-shadow-[0_4px_24px_rgba(0,0,0,0.7)]"
                fallback={titleText}
              />
            ) : (
              titleText
            )}
            <div className="flex flex-wrap items-center gap-3 text-sm text-ink-200 mb-4">
              {item.ProductionYear && (
                <span>
                  {item.ProductionYear}
                  {isSeries && item.EndDate
                    ? `–${new Date(item.EndDate).getFullYear()}`
                    : isSeries && item.Status === 'Continuing'
                      ? '–'
                      : ''}
                </span>
              )}
              {item.RunTimeTicks && !isSeries && <span>{formatRuntime(item.RunTimeTicks)}</span>}
              {item.OfficialRating && (
                <span className="px-1.5 py-0.5 rounded border border-white/20 text-xs">
                  {item.OfficialRating}
                </span>
              )}
              {item.CommunityRating && (
                <span className="flex items-center gap-1">
                  <svg className="h-3.5 w-3.5 text-amber-400" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                  </svg>
                  {item.CommunityRating.toFixed(1)}
                </span>
              )}
              {item.Genres?.slice(0, 3).map((g) => (
                <span key={g} className="text-ink-400">
                  {g}
                </span>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-6">
              {isPlayable && <PlayLink item={item} />}
              {isSeries && <SeriesPlayLink seriesId={item.Id} />}
              <div className="flex items-start gap-1 sm:gap-2">
                {(item.Type === 'Movie' || item.Type === 'Series') && <WatchlistButton item={item} labelled />}
                <ActionButton
                  label={isFavorite ? 'Favorited' : 'Favorite'}
                  onClick={toggleFavorite}
                  disabled={favBusy}
                  active={isFavorite}
                  ariaLabel={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                  icon={
                    <svg className="h-5 w-5" fill={isFavorite ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
                    </svg>
                  }
                />
                {/* TV: YouTube's iframe player doesn't run on the CX's engine — only
                    offer it when we have a self-hosted clip to play. */}
                {previewKind && (!__WEBOS__ || previewKind === 'clip') && (
                  <ActionButton
                    label={previewKind === 'clip' ? 'Preview' : 'Trailer'}
                    onClick={() => setPreviewOn(true)}
                    active={previewOn}
                    icon={
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                        <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
                        <path d="M10.5 9.5v5l4-2.5z" fill="currentColor" />
                      </svg>
                    }
                  />
                )}
                {isPlayable && <CastMenu item={item} labelled />}
                <ActionMenu label="More" items={moreItems} align="right" triggerClassName={ACTION_BTN}>
                  <span className={actionCircle()}>
                    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <circle cx="5" cy="12" r="1.8" />
                      <circle cx="12" cy="12" r="1.8" />
                      <circle cx="19" cy="12" r="1.8" />
                    </svg>
                  </span>
                  <span className="leading-tight text-center">More</span>
                </ActionMenu>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 lg:px-12 mt-8 max-w-4xl">
        {item.Taglines?.[0] && (
          <p className="text-ink-400 italic mb-2">{item.Taglines[0]}</p>
        )}
        {item.Overview && <p className="text-[15px] leading-relaxed text-ink-200">{item.Overview}</p>}
      </div>

      {fixOpen && <FixMatchDialog item={item} onClose={() => setFixOpen(false)} />}

      {tabs.length > 0 && (
        <section className="px-4 sm:px-6 lg:px-12 mt-8">
          <div role="tablist" aria-label="Sections" className="flex gap-6 sm:gap-8 border-b border-white/10 overflow-x-auto no-scrollbar">
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTabSel(t)}
                className={`relative h-12 shrink-0 text-[15px] transition-colors ${
                  tab === t ? 'text-white font-semibold' : 'text-ink-400 hover:text-white font-medium'
                }`}
              >
                {TAB_LABEL[t]}
                {tab === t && <span aria-hidden className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent-400" />}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="pt-6">
            {tab === 'episodes' && isSeries && <Seasons series={item} />}
            {tab === 'similar' && <SimilarGrid itemId={item.Id} />}
            {tab === 'details' && <DetailsTab item={item} cast={cast} showPath={session?.isAdmin !== false} />}
          </div>
        </section>
      )}

      {isBoxSet && (
        <section className="mt-10 px-4 sm:px-6 lg:px-12">
          <h2 className="text-lg font-semibold text-white tracking-tight mb-4">
            {collection.data ? `${collection.data.TotalRecordCount} in this collection` : 'In this collection'}
          </h2>
          <div
            className="grid gap-3 sm:gap-4 grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]"
          >
            {collection.isLoading
              ? Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)
              : collection.data?.Items.map((member) => <MediaCard key={member.Id} item={member} />)}
          </div>
        </section>
      )}
    </div>
  )
}
