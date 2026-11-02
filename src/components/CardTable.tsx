import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useViews } from '../api/queries'
import { getItems, getSession, posterUrl } from '../api/client'
import { formatRuntime, type JfItem } from '../api/types'
import TableReservations from './TableReservations'
import TableNavigation from './TableNavigation'
import { withHandDeadline } from '../lib/tableDeal'
import { reducedMotion } from '../lib/settings'
import ArcaneLighting from './ArcaneLighting'
import ArcaneCoin from './ArcaneCoin'
import codexStill from '../assets/card-table/story-codex-v1-still.webp'
import drawStill from '../assets/card-table/draw-deck-v1-still.webp'
import './arcane-actions.css'
const ThemeLab = import.meta.env.DEV ? lazy(() => import('./ArcaneThemeLab')) : null

type Phase = 'idle' | 'shuffling' | 'waiting' | 'dealing'
const SHUFFLE_MS = 1150
const FLIGHT_MS = 740
const STAGGER_MS = 110

function rememberedHand() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(`finesse.table.${getSession()?.userId}`) ?? '{}')
    return {
      deck: typeof saved.deck === 'string' ? saved.deck : '',
      deal: Number.isSafeInteger(saved.deal) && saved.deal >= 0 ? saved.deal as number : 0,
      selected: Number.isInteger(saved.selected) && saved.selected >= 0 && saved.selected < 5 ? saved.selected as number : 2,
    }
  } catch { return { deck: '', deal: 0, selected: 2 } }
}

function useTableMotion() {
  // The device's reduced-motion preference, or Finesse's own Reduce motion switch (Settings).
  const [systemReduced, setSystemReduced] = useState(reducedMotion)
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem('finesse.tableMotion') !== 'off' } catch { return true }
  })
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setSystemReduced(reducedMotion())
    media.addListener(update) // webOS Chromium 68 predates addEventListener on MediaQueryList.
    return () => media.removeListener(update)
  }, [])
  const toggle = () => {
    setEnabled((old) => {
      try { localStorage.setItem('finesse.tableMotion', old ? 'off' : 'on') } catch { /* Device storage is optional. */ }
      return !old
    })
  }
  return { reduced: systemReduced || !enabled, systemReduced, toggle }
}

function MovieCard({ item, index, count, selected, selectedIndex, busy, onSelect }: {
  item: JfItem; index: number; count: number; selected: boolean; selectedIndex: number; busy: boolean; onSelect: () => void
}) {
  const [brokenPoster, setBrokenPoster] = useState(false)
  const poster = brokenPoster ? null : posterUrl(item)
  const distance = (index - selectedIndex + count + Math.floor(count / 2)) % count - Math.floor(count / 2)
  return (
    <button
      type="button"
      className={`hand-card ${selected ? 'card-selected' : ''} ${Math.abs(distance) > 1 ? 'mobile-outside' : ''}`}
      style={{
        '--card-angle': `${(index - (count - 1) / 2) * 8}deg`,
        '--card-rise': `${Math.abs(index - (count - 1) / 2) * 12}px`,
        '--deal-delay': `${index * STAGGER_MS}ms`,
        '--collect-delay': `${index * 32}ms`,
        '--mobile-order': distance + 2,
        '--mobile-angle': `${distance * 9}deg`,
      } as CSSProperties}
      aria-label={`Select ${item.Name}`}
      aria-pressed={selected}
      data-autofocus={selected || undefined}
      disabled={busy}
      onClick={onSelect}
    >
      <span className="card-flight">
        <span className="card-turn">
          <span className="playing-card">
            <span className="card-corner" aria-hidden>{String(index + 1).padStart(2, '0')}<small>{item.Type === 'Series' ? '☽' : '✦'}</small></span>
            <span className="card-edition" aria-hidden>{item.ProductionYear || 'F'}</span>
            <span className="card-sigil" aria-hidden /><span className="card-art">
              {poster ? <img src={poster} alt="" onError={() => setBrokenPoster(true)} /> : <span className="card-no-art" aria-hidden><i>✧</i><small>UNDISCOVERED</small></span>}
            </span>
            <span className="card-caption">{item.Name}</span>
          </span>
          <span className="card-reverse" aria-hidden />
        </span>
      </span>
    </button>
  )
}

export default function CardTable() {
  const views = useViews()
  const decks = (views.data?.Items ?? []).filter((view) => view.CollectionType === 'movies' || view.CollectionType === 'tvshows')
  const [remembered] = useState(rememberedHand)
  const [chosenDeck, chooseDeck] = useState(remembered.deck)
  const [deal, setDeal] = useState(remembered.deal)
  const [selected, select] = useState(remembered.selected)
  const deck = decks.find((view) => view.Id === chosenDeck) ?? decks[0]
  const motion = useTableMotion()
  const hand = useQuery({
    queryKey: ['cardTableHand', getSession()?.userId, deck?.Id, deal],
    enabled: !!deck,
    queryFn: ({ signal }) => withHandDeadline((requestSignal) => getItems({
      parentId: deck!.Id,
      includeItemTypes: deck!.CollectionType === 'tvshows' ? 'Series' : 'Movie',
      recursive: true,
      sortBy: 'Random',
      limit: 5,
      fields: 'Overview,Genres,ProductionYear,RunTimeTicks,PrimaryImageAspectRatio',
    }, requestSignal), signal),
    retry: false,
    placeholderData: (previous) => previous,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
  })
  const cards = hand.data?.Items ?? []
  const pick = cards[selected] ?? cards[0]
  const [phase, setPhase] = useState<Phase>(() => hand.data ? 'idle' : 'waiting')
  const [outgoingCards, setOutgoingCards] = useState<JfItem[] | null>(null)
  const tableCards = phase === 'shuffling' && outgoingCards ? outgoingCards : cards
  const loading = views.isLoading || (!!deck && hand.isLoading)
  const error = views.isError || hand.isError
  const busy = phase !== 'idle' || hand.isFetching || views.isFetching
  const boardRef = useRef<HTMLElement>(null)
  const stockRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!deck) return
    try {
      sessionStorage.setItem(`finesse.table.${getSession()?.userId}`, JSON.stringify({ deck: deck.Id, deal, selected }))
    } catch { /* Browsing works without session storage. */ }
  }, [deck?.Id, deal, selected])

  // Timers only stage the physical action. Query completion decides when it is
  // safe to reveal the new hand, so a slow server cannot deal the previous data.
  useEffect(() => {
    if (phase === 'shuffling') {
      if (motion.reduced) { setPhase('waiting'); return }
      const timer = window.setTimeout(() => setPhase('waiting'), SHUFFLE_MS)
      return () => window.clearTimeout(timer)
    }
    if (phase === 'waiting') {
      if (loading || hand.isFetching || views.isFetching) return
      setPhase(error || !cards.length || motion.reduced ? 'idle' : 'dealing')
    }
    if (phase === 'dealing') {
      if (motion.reduced) { setPhase('idle'); return }
      const timer = window.setTimeout(() => setPhase('idle'), FLIGHT_MS + Math.max(0, cards.length - 1) * STAGGER_MS + 80)
      return () => window.clearTimeout(timer)
    }
  }, [phase, motion.reduced, loading, hand.isFetching, views.isFetching, error, cards.length])

  // Navigation sees stationary, non-overlapping buttons. Only their artwork
  // flies. Measure the stock so every card starts at the real deck on any size.
  useLayoutEffect(() => {
    const measure = () => {
      if (boardRef.current) boardRef.current.style.backgroundSize = boardRef.current.getBoundingClientRect().width < 760 ? 'cover' : '100% 100%'
      const stock = (stockRef.current?.querySelector('.action-deck-art') ?? stockRef.current)?.getBoundingClientRect()
      if (!stock) return
      boardRef.current?.querySelectorAll<HTMLElement>('.hand-card').forEach((card) => {
        const target = card.getBoundingClientRect()
        card.style.setProperty('--deal-x', `${stock.left + stock.width / 2 - target.left - target.width / 2}px`)
        card.style.setProperty('--deal-y', `${stock.top + stock.height / 2 - target.top - target.height / 2}px`)
      })
    }
    measure()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    if (boardRef.current) observer?.observe(boardRef.current)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [hand.data, phase, selected])

  const dealAgain = () => {
    if (busy || !deck) return
    setOutgoingCards(cards)
    select(2)
    setPhase(motion.reduced ? 'waiting' : 'shuffling')
    setDeal((value) => value + 1)
  }
  const changeDeck = (id: string) => {
    if (busy || deck?.Id === id) return
    setOutgoingCards(cards)
    select(2)
    setPhase(motion.reduced ? 'waiting' : 'shuffling')
    chooseDeck(id)
    setDeal(0)
  }
  const status = error ? 'The deck is unavailable.'
    : phase === 'shuffling' ? `Shuffling ${deck?.Name ?? 'your library'}…`
    : phase === 'waiting' || loading ? 'Preparing your cards…'
    : phase === 'dealing' ? `Dealing ${cards.length} ${cards.length === 1 ? 'title' : 'titles'}…`
    : cards.length ? `${cards.length} ${cards.length === 1 ? 'card' : 'cards'} in your hand. Choose your next story.` : 'Your table is ready for its first title.'
  const codexContent = <><span className="action-art action-codex-art" aria-hidden="true"><img src={codexStill} alt="" /></span><span className="action-label">Open title</span><small className="action-hint">{busy ? 'Preparing your cards' : pick && !error ? 'Read this story' : 'Choose a story first'}</small></>

  return (
    <div className={`card-table-page tabletop-edition ${motion.reduced ? 'no-table-motion' : ''}`}>
      <header className="table-intro">
        <div><p className="table-kicker">THE CELESTIAL TABLE</p><h1>A hand of stories.</h1></div>
        <div className="table-tools">
          <Link to="/dashboard">Full Finesse Home ↗</Link>
          <button type="button" aria-pressed={!motion.reduced} disabled={motion.systemReduced} onClick={motion.toggle} title={motion.systemReduced ? 'Following your Reduce motion setting' : 'Turn shuffle and draw animations on or off'}>{motion.reduced ? 'Animations off' : 'Animations on'}</button>
          <Link to="/settings#settings-themes">Themes ↗</Link>
        </div>
      </header>


      <div className="table-scene-wrap">
      <section ref={boardRef} data-arcane-scene="table" className={`table-stage celestial-table phase-${phase}`} data-deck-kind={deck?.CollectionType} aria-labelledby="hand-heading" aria-busy={busy} data-phase={phase}>
        <ArcaneLighting />
        <ArcaneCoin />
        <TableNavigation decks={decks} selected={deck?.Id} busy={busy} reduced={motion.reduced} onChoose={changeDeck} />

        <div key={pick?.Id ?? deck?.Id} className="mat-heading">
          <p className="table-kicker">{pick && !busy ? 'IN YOUR HAND' : 'EVERY DECK HOLDS A STORY.'}</p>
          <h2 id="hand-heading">{pick && !busy ? pick.Name : <>{deck?.Name ?? 'Your library'}<em>On the table.</em></>}</h2>
          {pick && !busy && <p className="selected-card-meta">{[pick.ProductionYear, pick.Type === 'Series' ? 'Series' : 'Movie'].filter(Boolean).join(' · ')}</p>}
        </div>
        {pick && !busy && !error ? <Link className="mat-pick-link table-open-title physical-action story-action" aria-label={`Open title: ${pick.Name}`} to={`/item/${pick.Id}`}>{codexContent}</Link>
          : <button type="button" disabled className="mat-pick-link table-open-title physical-action story-action" aria-label={busy ? 'Preparing the next story' : 'Choose a story before opening its title'}>{codexContent}</button>}

        <div className="draw-station">
          <button ref={stockRef} type="button" className="draw-pile physical-action deck-action" aria-label={busy ? 'Dealing your next hand' : `Deal again from ${deck?.Name ?? 'your library'}`} aria-busy={busy} disabled={busy || !deck} onClick={dealAgain}>
            <span className="action-art action-deck-art" aria-hidden="true"><img src={drawStill} alt="" /></span>
            <span className="action-label">{busy ? 'Dealing…' : 'Deal again'}</span><small className="action-hint">{busy ? 'Preparing your cards' : 'Draw a new hand'}</small>
          </button>
        </div>

        {error ? (
          <div className="table-message" role="alert"><h3>We couldn’t deal this hand.</h3><p>{hand.error?.name === 'TimeoutError' ? 'The library took too long to answer. Try again in a moment.' : 'Check your server connection, then try again.'}</p><button type="button" className="table-primary" onClick={() => { setPhase('waiting'); void views.refetch(); if (deck) void hand.refetch() }}>Try again</button></div>
        ) : !loading && !cards.length ? (
          <div className="table-message"><h3>{deck ? 'An empty deck. For now.' : 'Your first deck starts here.'}</h3><p>{deck ? 'Add titles to this library, or choose another deck.' : 'Once your server has movies or shows, you can deal a hand here.'}</p><Link className="table-primary" to="/libraries">Explore libraries</Link></div>
        ) : (
          <div key={phase === 'shuffling' ? 'outgoing' : `${deck?.Id}-${deal}`} className="movie-hand" role="group" aria-label="Your hand of titles">
            {tableCards.map((item, index) => <MovieCard key={item.Id} item={item} index={index} count={tableCards.length} selected={pick?.Id === item.Id} selectedIndex={Math.max(0, tableCards.findIndex(card => card.Id === pick?.Id))} busy={busy} onSelect={() => select(index)} />)}
          </div>
        )}

        {cards.length > 1 && <div className="hand-pager" aria-label="Browse cards"><button type="button" disabled={busy} onClick={() => select((cards.indexOf(pick!) - 1 + cards.length) % cards.length)} aria-label="Previous card">‹</button><span>{Math.max(0, cards.indexOf(pick!)) + 1} / {cards.length}</span><button type="button" disabled={busy} onClick={() => select((cards.indexOf(pick!) + 1) % cards.length)} aria-label="Next card">›</button></div>}
        <div className="mat-bottomline">{deck && <Link to={`/library/${deck.Id}`}>Browse full deck ↗</Link>}</div>
      </section>
      <div className="table-deal-status" role="status" aria-live="polite"><span className={busy ? 'status-dot busy' : 'status-dot'} aria-hidden />{status}</div>
      </div>

      {pick && !error && <section className={`table-pick ${busy ? 'pick-busy' : ''}`} aria-label="Selected title">
        <div className="pick-number" aria-hidden>{String(cards.indexOf(pick) + 1).padStart(2, '0')}</div>
        <div className="pick-copy">
          <p className="table-kicker">IN YOUR HAND / {pick.Type === 'Series' ? 'SERIES' : 'FILM'}{pick.ProductionYear ? ` · ${pick.ProductionYear}` : ''}{pick.RunTimeTicks ? ` · ${formatRuntime(pick.RunTimeTicks)}` : ''}</p>
          <h3>{pick.Name}</h3><p className="pick-overview">{pick.Overview || 'Some stories are better discovered. Open this title to find out more.'}</p>
        </div>
        {busy ? <span className="table-story-link" aria-disabled="true">Dealing…</span> : <Link className="table-story-link" to={`/item/${pick.Id}`}>More about this title <span aria-hidden>↗</span></Link>}
      </section>}

      <TableReservations />
      <footer className="club-footer"><Link to="/libraries">All libraries, music & games ↗</Link><Link to="/mylist">Your saved picks ↗</Link><Link to="/dashboard">Full Finesse Home ↗</Link></footer>
      {ThemeLab && new URLSearchParams(location.search).get('theme-lab') === '1' && <Suspense fallback={null}><ThemeLab /></Suspense>}
    </div>
  )
}
