import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useGame } from '../api/queries'
import { ActionButton, PLAY_BTN } from '../components/ActionButton'
import { BrowserPlayButton, MoonlightSteps, PlayIcon, ProfilePick, StartOnDevice, useMoonlightApp } from '../components/MoonlightPlay'
import { useFinesse } from '../lib/finesseServer'
import { cleanName, ejsCore, fetchSgdbCover, isBeta, isPlayable, rommCoverUrl, tileGradient, type RommRom } from '../api/romm'

function useCover(rom: RommRom | undefined) {
  const rommCover = rom ? rommCoverUrl(rom) : null
  const [sgdb, setSgdb] = useState<string | null>(null)
  useEffect(() => {
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
  const { data: rom, isLoading } = useGame(romId)
  const cover = useCover(rom)
  const { info } = useFinesse()
  const moonlight = useMoonlightApp(rom?.platform_slug)
  const [panel, setPanel] = useState<'moonlight' | 'tv' | null>(null)
  const [profile, setProfile] = useState('')
  const [err, setErr] = useState('')

  if (isLoading || !rom) return <div className="h-[calc(var(--vh)*60)] shimmer -mt-16" />

  const title = cleanName(rom.name)
  const playable = isPlayable(rom)
  const core = ejsCore(rom.platform_slug)
  const beta = core !== null && isBeta(core)
  const siblings = (rom.siblings ?? []).filter((s) => s.id !== rom.id)
  const m = rom.metadatum ?? {}
  const year = m.first_release_date ? new Date(m.first_release_date).getFullYear() : null
  const app = moonlight.app
  const browserPlay = Boolean(app && !playable && !__WEBOS__ && info?.features.play)
  const profiles = moonlight.profiles
  const profileId = profiles.length === 1 ? profiles[0]!.id : profile || undefined
  const missing = rom.missing_from_fs === true

  return (
    <div className="min-h-[calc(var(--vh)*60)] pb-16">
      {/* The cover, blurred, behind everything (games have no backdrop art) */}
      {cover && (
        <div className="fixed inset-0 -z-10 overflow-hidden" aria-hidden>
          <img src={cover} alt="" className="h-full w-full object-cover blur-3xl brightness-[0.25] saturate-150 scale-110" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/60 to-ink-950/30" />
        </div>
      )}

      <div className="px-4 sm:px-6 lg:px-12 pt-6">
        <Link to="/games" className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-300 transition-colors hover:text-white">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          Games
        </Link>

        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:gap-8">
          <div className="w-40 shrink-0 overflow-hidden rounded-xl shadow-2xl shadow-black/50 ring-1 ring-white/10 sm:w-52" style={{ viewTransitionName: 'vt-poster' }}>
            {cover ? (
              <img src={cover} alt={title} className="aspect-[3/4] h-full w-full object-cover" />
            ) : (
              <div className="flex aspect-[3/4] flex-col justify-between p-3" style={{ backgroundImage: tileGradient(rom) }}>
                <span className="self-start rounded-md bg-black/25 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90">{rom.platform_display_name}</span>
                <span className="line-clamp-4 text-lg font-bold leading-tight text-white">{title}</span>
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
                  <Link to={`/games/play/${rom.id}`} reloadDocument={!__WEBOS__} className={PLAY_BTN}>
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
                  <div className="flex items-start gap-1 sm:gap-2">
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
            {panel === 'moonlight' ? <MoonlightSteps app={app} launcher={moonlight.launcher} consoleName={rom.platform_display_name} /> : <StartOnDevice rom={rom.id} profile={profileId} />}
          </div>
        )}

        {!playable && !app && (
          <p className="mt-6 max-w-xl text-[14px] text-ink-400">
            {rom.platform_display_name} games can’t run in a browser, so this one is here to browse. Retro consoles (NES, SNES, Game Boy, N64, Genesis, PS1…) play right here.
          </p>
        )}

        {rom.summary && <p className="mt-8 max-w-4xl text-[15px] leading-relaxed text-ink-200">{rom.summary}</p>}

        {siblings.length > 0 && (
          <div className="mt-8">
            <h2 className="row-title mb-3 text-white">Other versions</h2>
            <div className="flex flex-wrap gap-2">
              {siblings.map((s) => {
                const label = cleanName(s.name) || s.fs_name
                return core ? (
                  <Link key={s.id} to={`/games/play/${s.id}`} reloadDocument={!__WEBOS__} className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-1.5 text-[13px] font-medium text-ink-100 transition-colors hover:border-white/25 hover:text-white">
                    {label}
                  </Link>
                ) : (
                  <Link key={s.id} to={`/games/game/${s.id}`} className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-1.5 text-[13px] font-medium text-ink-100 transition-colors hover:border-white/25 hover:text-white">
                    {label}
                  </Link>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
