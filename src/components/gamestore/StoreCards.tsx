// The store's covers, cards, shelves and grid. A game without art gets a tile in a steady
// colour with its title, so a store of art-less games still reads as designed.

import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { GameRequest, StoreGame } from '../../api/gameStore'
import { CardSkeleton } from '../Skeletons'
import { GameRequestBadge } from './GameRequestStatus'

function hue(s: string): number {
  let h = 11
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

/** Two colours from the game's id: the same game always gets the same tile. */
export function storeGradient(id: string, angle = 150): string {
  const h = hue(id)
  return `linear-gradient(${angle}deg, hsl(${h} 52% 38%), hsl(${(h + 48) % 360} 58% 16%))`
}

export function storeGameHref(id: string): string {
  return `/games/store/game/${encodeURIComponent(id)}`
}

/** The cover, or the tile when there's none (or it doesn't load). */
export function StoreCover({ game, className = '', big = false }: { game: StoreGame; className?: string; big?: boolean }) {
  const [broken, setBroken] = useState(false)
  if (game.cover && !broken)
    return <img src={game.cover} alt={game.title} loading="lazy" onError={() => setBroken(true)} className={`h-full w-full object-cover fade-in ${className}`} />
  return (
    <div className={`flex h-full w-full flex-col justify-between p-3 ${className}`} style={{ backgroundImage: storeGradient(game.id) }}>
      <span className="self-start rounded-md bg-black/25 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/85">{game.genres[0] ?? 'Game'}</span>
      <span className={`font-display leading-[1.02] text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)] line-clamp-4 ${big ? 'text-3xl' : 'text-[19px]'}`}>{game.title}</span>
    </div>
  )
}

/** A small portrait thumbnail for lists (requests): the cover, or the tile's colours and initial. */
export function StoreThumb({ id, title, cover, className = 'h-16 w-12' }: { id: string; title: string; cover?: string; className?: string }) {
  const [broken, setBroken] = useState(false)
  return (
    <div className={`relative shrink-0 overflow-hidden rounded-md ring-1 ring-white/10 ${className}`} style={cover && !broken ? undefined : { backgroundImage: storeGradient(id) }}>
      {cover && !broken ? (
        <img src={cover} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
      ) : (
        <span className="grid h-full w-full place-items-center font-display text-xl text-white/90" aria-hidden>
          {title.slice(0, 1)}
        </span>
      )}
    </div>
  )
}

export function StoreCard({ game, request }: { game: StoreGame; request?: GameRequest }) {
  return (
    <Link to={storeGameHref(game.id)} viewTransition className="own-focus group block outline-none">
      <div className="tilt sheen relative aspect-[3/4] overflow-hidden rounded-xl bg-ink-800 ring-1 ring-white/5 group-hover:ring-accent-400/70 group-hover:shadow-2xl group-hover:shadow-black/60 group-focus-visible:ring-2 group-focus-visible:ring-accent-400">
        <StoreCover game={game} />
        {request && (
          <div className="absolute right-2 top-2">
            <GameRequestBadge request={request} />
          </div>
        )}
      </div>
      <p className="mt-2 truncate px-0.5 text-sm font-medium text-ink-200 transition-colors group-hover:text-white group-focus-visible:text-white">{game.title}</p>
      <p className="truncate px-0.5 text-xs text-ink-400">{[game.genres[0], game.year].filter(Boolean).join(' · ')}</p>
    </Link>
  )
}

/** A titled row of cards with "See all". */
export function StoreShelf({ title, href, games, requests }: { title: ReactNode; href?: string; games: StoreGame[]; requests?: Map<string, GameRequest> }) {
  if (!games.length) return null
  return (
    <section className="mb-9">
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="row-title text-white">{title}</h2>
        {href && (
          <Link to={href} className="text-xs font-semibold text-accent-300 hover:text-accent-200">
            See all
          </Link>
        )}
      </div>
      {/* Room around the cards: a scroller clips what pokes out, and the focus ring and the hover lift do. */}
      <div className="-mx-2 -mt-2 flex gap-4 overflow-x-auto no-scrollbar px-2 pb-2 pt-2">
        {games.map((g) => (
          <div key={g.id} className="w-36 shrink-0 sm:w-40">
            <StoreCard game={g} request={requests?.get(g.id)} />
          </div>
        ))}
      </div>
    </section>
  )
}

export const STORE_GRID = 'grid gap-2.5 sm:gap-4 grid-cols-2 min-[480px]:grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]'

export function StoreGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className={STORE_GRID}>
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  )
}

export function ShelfSkeleton() {
  return (
    <section className="mb-9">
      <div className="mb-3 h-7 w-48 rounded shimmer" />
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="w-36 shrink-0 sm:w-40">
            <div className="aspect-[3/4] rounded-xl shimmer" />
          </div>
        ))}
      </div>
    </section>
  )
}
