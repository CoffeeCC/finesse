import { useMemo, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import * as api from '../api/client'
import { useLatest } from '../api/queries'
import type { JfItem } from '../api/types'
import { blurhashAverageColor, primaryBlurhash } from '../lib/blurhash'
import { vividRgb } from '../lib/accent'
import { IS_TV } from '../lib/device'
import LiquidLight from './LiquidLight'

// Spotlight: one title given the whole width of Home, between the rows. The band opens up
// as it scrolls into view, its artwork drifts behind it, and the title is drawn in, all
// tied to the scroll position by the browser itself (index.css, .spot), so it stays in
// step with your finger or wheel at any speed. Something new you haven't watched, a
// different one each day. Not on TVs (their browser can't do it and the Now stage is
// their showpiece).

const ACCENT = '117, 137, 216'

function pick(movies: JfItem[] | undefined, shows: JfItem[] | undefined): JfItem | null {
  const pool = [...(movies ?? []), ...(shows ?? [])].filter((i) => i.BackdropImageTags?.length && !i.UserData?.Played && !i.UserData?.PlaybackPositionTicks)
  if (!pool.length) return null
  const day = Math.floor(Date.now() / 86400000)
  return pool[day % pool.length]
}

export default function Spotlight({ movieLibId, showLibId }: { movieLibId?: string; showLibId?: string }) {
  const movies = useLatest(movieLibId)
  const shows = useLatest(showLibId)
  const item = useMemo(() => pick(movies.data, shows.data), [movies.data, shows.data])
  if (IS_TV || !item) return null
  const art = api.backdropUrl(item)
  if (!art) return null
  const avg = blurhashAverageColor(primaryBlurhash(item))
  const tint = avg ? vividRgb(avg[0], avg[1], avg[2]).join(', ') : ACCENT
  const isMovie = item.Type === 'Movie'
  const facts = [item.ProductionYear, item.Genres?.[0], item.OfficialRating].filter(Boolean).join(' · ')
  return (
    <section className="spot" aria-label={`Spotlight: ${item.Name}`} data-mood={tint} style={{ '--tint-rgb': tint } as CSSProperties}>
      <div className="spot-art" aria-hidden>
        <img src={art} alt="" loading="lazy" />
      </div>
      <div className="spot-scrim" aria-hidden />
      <div className="spot-light" aria-hidden>
        <LiquidLight tint={tint} />
      </div>
      <div className="spot-body">
        <p className="os-kicker flex items-center gap-3 text-white/85">
          <span className="os-dot" />
          <span>Tonight’s pick{facts ? ` · ${facts}` : ''}</span>
        </p>
        <h2 className="spot-title">{item.Name}</h2>
        {item.Overview && <p className="spot-line">{item.Overview}</p>}
        <div className="spot-actions">
          {isMovie ? (
            <Link to={`/play/${item.Id}`} className="os-btn primary">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M8 5v14l11-7z" />
              </svg>
              Play
            </Link>
          ) : (
            <Link to={`/item/${item.Id}`} className="os-btn primary">
              See episodes
            </Link>
          )}
          {isMovie && (
            <Link to={`/item/${item.Id}`} className="os-btn os-glass">
              More info
            </Link>
          )}
        </div>
      </div>
    </section>
  )
}
