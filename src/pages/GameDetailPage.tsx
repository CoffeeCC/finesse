import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useGame } from '../api/queries'
import { ActionButton, PLAY_BTN } from '../components/ActionButton'
import { BrowserPlayButton, MoonlightSteps, PlayIcon, ProfilePick, StartOnDevice, useMoonlightApp } from '../components/MoonlightPlay'
import { goBack } from '../lib/back'
import { CONTENT_BASE } from '../lib/contentOrigin'
import { useFinesse } from '../lib/finesseServer'
import { cleanName, ejsCore, fetchSgdbCover, isBeta, isPlayable, rommCoverUrl, tileGradient, type RommRom } from '../api/romm'

function useCover(rom: RommRom | undefined) {
  const rommCover = rom ? rommCoverUrl(rom) : null
  const [sgdb, setSgdb] = useState<string | null>(null)
  useEffect(() => {
    setSgdb(null)
    if (!rom || rommCover) return
    let cancelled = false
    fetchSgdbCover(rom.fs_name_no_tags || cleanName(rom.name)).then((url) => {
      if (!cancelled && url) setSgdb(url)
    })
    return () => {
      cancelled = true
    }
  }, [rom, rommCover])
  return rommCover ?? sgdb
}

function screenshotUrl(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw
  const norm = raw.replace(/^\/+/, '')
  if (norm.startsWith('assets/')) return `${CONTENT_BASE}games/${norm}`
  return `${CONTENT_BASE}games/assets/${norm}`
}

function releaseYearOf(ts: number | null | undefined): number | null {
  if (!ts) return null
  // RomM/IGDB sends Unix seconds (e.g. 852076800); handle both seconds and ms.
  const ms = ts < 1e12 ? ts * 1000 : ts
  const y = new Date(ms).getFullYear()
  return Number.isFinite(y) && y > 1950 ? y : null
}

function siblingLabel(s: { name: string; fs_name?: string }): string {
  const raw = (s.fs_name || s.name || '').trim()
  // Keep region/revision tags like (USA), (Rev 1), (Europe) so versions stay distinct.
  return raw.replace(/\.(7z|zip|rar|z64|n64|nes|smc|sfc|gb[ac]?|gba|iso|nsp|nsz|xci|nds|md|bin|cue|chd|pce|rvz|cso|pbp|cia)$/i, '') || s.name
}

const MoonIcon = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </svg>
)
const TvIcon = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
    <rect x="3" y="4.5" width="18" height="12" rx="2" />
    <path strokeLinecap="round" d="M8 20h8M12 16.5V20" />
  </svg>
)

/** A game, laid out like a movie's page: art, title, details, the main action and the ways to play. */
export default function GameDetailPage() {
  const { romId } = useParams()
  const navigate = useNavigate()
  const { data: rom, isLoading, isError, refetch, isFetching } = useGame(romId)
  const rawCover = useCover(rom)
  const [coverFailed, setCoverFailed] = useState(false)
  useEffect(() => setCoverFailed(false), [rawCover])
  const cover = coverFailed ? null : rawCover

  const { info } = useFinesse()
  const moonlight = useMoonlightApp(rom?.platform_slug)
  const [panel, setPanel] = useState<'moonlight' | 'tv' | null>(null)
  const [profile, setProfile] = useState('')
  const [err, setErr] = useState('')

  if (!rom) {
    if (isLoading || (isFetching && !isError)) return <div className="h-[calc(var(--vh)*60)] shimmer -mt-16" />
    return (
      <div className="px-4 sm:px-6 lg:px-12 py-16 text-center max-w-lg mx-auto">
        <p className="text-lg font-semibold text-white">Couldn’t load this game</p>
        <p className="mt-1.5 text-sm text-ink-400">Check that your games library is reachable and try again.</p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="inline-flex h-10 items-center rounded-full bg-white px-5 text-sm font-semibold text-ink-950 hover:bg-ink-200 disabled:opacity-50 transition-colors"
          >
            {isFetching ? 'Trying…' : 'Try again'}
          </button>
          <button
            type="button"
            onClick={() => goBack(navigate)}
            className="inline-flex h-10 items-center rounded-full bg-white/10 border border-white/15 px-5 text-sm font-semibold text-white hover:bg-white/15 transition-colors"
          >
            Back
          </button>
        </div>
      </div>
    )
  }

  const title = cleanName(rom.name)
  const playable = isPlayable(rom)
  const core = ejsCore(rom.platform_slug)
  const beta = core !== null && isBeta(core)
  const siblings = (rom.siblings ?? []).filter((s) => s.id !== rom.id)
  const m = rom.metadatum ?? {}
  const year = releaseYearOf(m.first_release_date)
  const app = moonlight.app
  const browserPlay = Boolean(app && !playable && !__WEBOS__ && info?.features.play)
  const profiles = moonlight.profiles
  const profileId = profiles.length === 1 ? profiles[0]!.id : profile || undefined
  const missing = rom.missing_from_fs === true
  const screenshots = (rom.merged_screenshots ?? []).filter(Boolean).slice(0, 12)

  return (
    <div className="min-h-[calc(var(--vh)*60)] pb-16">
      {/* The cover, blurred, behind everything (games have no backdrop art) */}
      {cover && (
        <div className="fixed inset-0 -z-10 overflow-hidden" aria-hidden>
          <img decoding="async" src={cover} alt="" onError={() => setCoverFailed(true)} className="h-full w-full object-cover blur-3xl brightness-[0.25] saturate-150 scale-110" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/60 to-ink-950/30" />
        </div>
      )}

      <div className="px-4 sm:px-6 lg:px-12 pt-6">
        <button
          type="button"
          onClick={() => goBack(navigate)}
          className="mb-6 -ml-1 inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium text-ink-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          Back
        </button>

        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:gap-8">
          <div className="w-40 shrink-0 overflow-hidden rounded-xl shadow-2xl shadow-black/50 ring-1 ring-white/10 sm:w-52" style={{ viewTransitionName: 'vt-poster' }}>
            {cover ? (
              <img decoding="async" src={cover} alt={title} onError={() => setCoverFailed(true)} className="aspect-[3/4] h-full w-full object-cover" />
            ) : (
              // The shape on the outer box, the tile filling it (the TV's aspect fallback sizes it that way).
              <div className="relative aspect-[3/4]">
                <div className="absolute inset-0 flex h-full w-full flex-col justify-between p-3" style={{ backgroundImage: tileGradient(rom) }}>
                  <span className="self-start rounded-md bg-black/25 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90">{rom.platform_display_name}</span>
                  <span className="line-clamp-4 text-lg font-bold leading-tight text-white">{title}</span>
                </div>
              </div>
            )}
          </div>

          <div className="min-w-0 pb-1">
            <h1 className="mb-3 font-display text-4xl leading-[0.95] text-white drop-shadow-lg sm:text-6xl">{title}</h1>
            <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-200">
              <span>{rom.platform_display_name}</span>
              {year && <span>{year}</span>}
              {m.average_rating ? (
                <span className="flex items-center gap-1">
                  <svg className="h-3.5 w-3.5 text-amber-400" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                  </svg>
                  {(m.average_rating / 10).toFixed(1)}
                </span>
              ) : null}
              {m.player_count && m.player_count !== '1' && <span>{m.player_count} players</span>}
              {(m.genres ?? []).slice(0, 3).map((g) => (
                <span key={g} className="text-ink-400">
                  {g}
                </span>
              ))}
              {(rom.regions ?? []).slice(0, 2).map((r) => (
                <span key={r} className="rounded border border-white/20 px-1.5 py-0.5 text-xs">
                  {r}
                </span>
              ))}
            </div>

            {missing ? (
              <p className="max-w-xl text-[14px] text-amber-200">This game’s files aren’t in the library folder any more. It disappears from here at RomM’s next cleanup.</p>
            ) : (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
                {playable ? (
                  // A fresh page load, so the server can isolate it (threads for PSP/DOS).
                  <Link to={`/games/play/${rom.id}`} reloadDocument={!__WEBOS__} data-autofocus className={PLAY_BTN}>
                    <PlayIcon />
                    Play
                  </Link>
                ) : browserPlay ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <BrowserPlayButton rom={rom.id} profile={profileId} needProfile={profiles.length > 1} onError={setErr} />
                    <ProfilePick profiles={profiles} value={profile} onChange={setProfile} />
                  </div>
                ) : null}
                {app && (
                  <div className="flex flex-wrap items-start gap-1 sm:gap-2">
                    <ActionButton icon={<MoonIcon />} label="Moonlight" active={panel === 'moonlight'} expanded={panel === 'moonlight'} onClick={() => setPanel(panel === 'moonlight' ? null : 'moonlight')} />
                    {app.play && <ActionButton icon={<TvIcon />} label="Play on TV" active={panel === 'tv'} expanded={panel === 'tv'} onClick={() => setPanel(panel === 'tv' ? null : 'tv')} />}
                  </div>
                )}
              </div>
            )}
            {playable && beta && <p className="mt-3 text-[13px] text-amber-200">Beta: needs a fast computer, and may not run every game.</p>}
            {browserPlay && !missing && <p className="mt-3 max-w-xl text-[13px] text-ink-400">Plays here, streamed from the server (Beta). For the TV, Moonlight has less delay.</p>}
            {err && <p className="mt-3 max-w-xl text-[13px] text-red-300">{err}</p>}
          </div>
        </div>

        {app && panel && !missing && (
          <div className="mt-6 max-w-2xl rounded-2xl border border-white/10 bg-ink-900/70 px-5 py-4">
            {panel === 'moonlight' ? (
              <MoonlightSteps app={app} launcher={moonlight.launcher} consoleName={rom.platform_display_name} />
            ) : (
              <div className="space-y-3">
                {profiles.length > 1 && (
                  <ProfilePick profiles={profiles} value={profile} onChange={setProfile} />
                )}
                <StartOnDevice rom={rom.id} profile={profileId} />
              </div>
            )}
          </div>
        )}

        {!playable && !app && (
          <p className="mt-6 max-w-xl text-[14px] text-ink-400">
            {rom.platform_display_name} games can’t run in a browser, so this one is here to browse. Retro consoles (NES, SNES, Game Boy, N64, Genesis, PS1…) play right here.
          </p>
        )}

        {rom.summary && <p className="mt-8 max-w-4xl text-[15px] leading-relaxed text-ink-200">{rom.summary}</p>}

        {screenshots.length > 0 && (
          <section className="mt-8">
            <h2 className="row-title mb-3 text-white">Screenshots</h2>
            <div className="-mx-2 -mt-2 flex gap-3 overflow-x-auto no-scrollbar px-2 pt-2 pb-3 snap-x snap-proximity">
              {screenshots.map((url, idx) => (
                <img
                  key={`${url}-${idx}`}
                  src={screenshotUrl(url)}
                  alt={`${title} screenshot ${idx + 1}`}
                  loading="lazy"
                  decoding="async"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                  className="h-36 sm:h-44 w-auto shrink-0 snap-start rounded-xl bg-ink-800 object-cover ring-1 ring-white/10"
                />
              ))}
            </div>
          </section>
        )}

        {siblings.length > 0 && (
          <div className="mt-8">
            <h2 className="row-title mb-3 text-white">Other versions</h2>
            <div className="flex flex-wrap gap-2">
              {siblings.map((s) => (
                <Link
                  key={s.id}
                  to={`/games/game/${s.id}`}
                  className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-1.5 text-[13px] font-medium text-ink-100 transition-colors hover:border-white/25 hover:text-white"
                >
                  {siblingLabel(s)}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
