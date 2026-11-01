import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getItems, posterUrl } from '../api/client'
import { useGenres } from '../api/queries'
import { formatRuntime, type JfItem } from '../api/types'
import { MultiSelectMenu, SelectMenu } from './Menu'
import ArcaneLighting from './ArcaneLighting'
import ArcaneSearchTrinket from './ArcaneSearchTrinket'
import { Sheet } from './Sheet'
import { withHandDeadline } from '../lib/tableDeal'
import { blurhashToDataURL, primaryBlurhash } from '../lib/blurhash'
import { peerOf } from '../lib/peers'
import './arcane-folio.css'

const SORTS = [
  { value: 'SortName', label: 'Title A–Z' }, { value: 'DateCreated,SortName', label: 'Recently added' },
  { value: 'ProductionYear,SortName', label: 'Release date' }, { value: 'CommunityRating,SortName', label: 'Rating' },
  { value: 'Runtime,SortName', label: 'Runtime' },
]
const WATCH = [{ value: '', label: 'All stories' }, { value: 'IsUnplayed', label: 'Unwatched' },
  { value: 'IsResumable', label: 'In progress' }, { value: 'IsFavorite', label: 'Favorites' }]
const PAGE = 6

function CardArt({ item, large = false }: { item: JfItem; large?: boolean }) {
  const [broken, setBroken] = useState(false)
  const poster = posterUrl(item, large ? 500 : 300)
  const blur = blurhashToDataURL(primaryBlurhash(item))
  return <span className="folio-card-art">
    {poster && !broken && <span className="folio-poster-placeholder" aria-hidden="true" style={blur ? { backgroundImage: `url(${blur})` } : undefined} />}
    {poster && !broken ? <img src={poster} alt="" loading={large ? 'eager' : 'lazy'} onError={() => setBroken(true)} />
      : <span className="folio-missing-art" aria-hidden="true">✦<small>{item.Name}</small></span>}
    <span className="folio-card-frame" />
    {item.UserData?.Played && <span className="folio-watched" aria-label="Watched">✓</span>}
  </span>
}

/** Deliberate collection browsing: actual server pagination, a bound folio and a persistent inspector. */
export default function ArcaneFolio({ view, decks, saved = false, savedItems }: {
  view: JfItem; decks: JfItem[]; saved?: boolean; savedItems?: JfItem[]
}) {
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? '', genre = params.get('g') ?? ''
  const watch = WATCH.some((option) => option.value === params.get('w')) ? params.get('w')! : ''
  const sort = SORTS.some((s) => s.value === params.get('s')) ? params.get('s')! : 'SortName'
  const [input, setInput] = useState(query), selectedId = params.get('card') ?? ''
  const [mobileOpen, setMobileOpen] = useState(false)
  const closeInspection = useCallback(() => setMobileOpen(false), [])
  useEffect(() => {
    const media = matchMedia('(min-width:760px)'), resize = () => { if (media.matches) closeInspection() }
    media.addListener(resize); return () => media.removeListener(resize)
  }, [closeInspection])
  const { data: genres } = useGenres(saved ? undefined : view.Id)
  const requestedLeaf = Number(params.get('leaf'))
  const leaf = Number.isSafeInteger(requestedLeaf) && requestedLeaf > 0 && requestedLeaf < 1_000_000 ? requestedLeaf : 1
  const goToLeaf = (value: number) => {
    setParams((previous) => { const next = new URLSearchParams(previous); next.set('leaf', String(value)); next.delete('card'); return next }, { replace: true })
  }
  const update = (key: string, value: string) => {
    setParams((previous) => { const next = new URLSearchParams(previous); if (value) next.set(key, value); else next.delete(key); next.delete('card'); next.delete('leaf'); return next }, { replace: true })
  }
  useEffect(() => {
    const timer = setTimeout(() => { if (input !== query) update('q', input.trim()) }, 350)
    return () => clearTimeout(timer)
  }, [input, query]) // URL state preserves the collection when returning from a title.
  useEffect(() => { setInput(query) }, [query, view.Id])
  const books = useQuery({
    queryKey: ['arcaneFolio', view.Id, query, genre, watch, sort, leaf],
    enabled: !saved,
    queryFn: ({ signal }) => withHandDeadline((requestSignal) => getItems({ parentId: view.Id, recursive: true,
      includeItemTypes: view.CollectionType === 'tvshows' ? 'Series' : 'Movie', startIndex: (leaf - 1) * PAGE, limit: PAGE,
      searchTerm: query || undefined, genres: genre || undefined, filters: watch || undefined,
      sortBy: sort, sortOrder: sort === 'SortName' || sort === 'Runtime,SortName' ? 'Ascending' : 'Descending',
      fields: 'Overview,Genres,ProductionYear,RunTimeTicks,PrimaryImageAspectRatio,OfficialRating',
    }, requestSignal), signal),
    staleTime: 5 * 60_000, retry: false,
  })
  const allItems = saved ? (savedItems ?? []).filter((i) => !query || i.Name.toLowerCase().includes(query.toLowerCase()))
    : books.data?.Items ?? []
  const total = saved ? allItems.length : books.data?.TotalRecordCount ?? 0
  const visible = saved ? allItems.slice((leaf - 1) * PAGE, leaf * PAGE) : allItems
  const pick = visible.find((i) => i.Id === selectedId) ?? visible[0]
  const leaves = Math.max(1, Math.ceil(total / 6))
  useEffect(() => {
    if ((saved || books.data) && leaf > leaves) goToLeaf(leaves)
  }, [total, saved, books.data, leaf])
  const select = (item: JfItem) => {
    setParams((previous) => { const next = new URLSearchParams(previous); next.set('card', item.Id); return next }, { replace: true })
    if (innerWidth < 760) setMobileOpen(true)
  }
  const [leafInput, setLeafInput] = useState(String(leaf))
  useEffect(() => setLeafInput(String(leaf)), [leaf])
  const jump = () => {
    const value = Number(leafInput)
    if (Number.isSafeInteger(value) && value >= 1 && value <= leaves) goToLeaf(value)
    else setLeafInput(String(leaf))
  }
  const loading = !saved && books.isLoading
  const inspection = pick ? <div key={pick.Id} className="folio-inspection"><div className="folio-inspect-card"><CardArt key={pick.Id} item={pick} large /></div><p className="folio-inspect-meta">{[pick.ProductionYear, pick.OfficialRating, pick.RunTimeTicks ? formatRuntime(pick.RunTimeTicks) : null].filter(Boolean).join(' · ')}</p><h2>{pick.Name}</h2><p className="folio-inspect-summary">{pick.Overview || 'Some stories are better discovered. Open this title to find out more.'}</p>
    <div className="folio-inspect-actions"><Link className="folio-primary" onClick={() => select(pick)} to={`/item/${pick.Id}`}>Open story <span aria-hidden="true">↗</span></Link><Link className="folio-secondary" onClick={() => select(pick)} to={pick.Type === 'Series' ? `/item/${pick.Id}` : `/play/${pick.Id}`}>{pick.Type === 'Series' ? 'Explore episodes' : pick.UserData?.PlaybackPositionTicks ? 'Resume' : 'Play'}</Link></div>
  </div> : <div className="folio-inspection-empty" aria-hidden="true">✦<p>A story is waiting.</p></div>
  return <div className="arcane-folio-page" data-arcane-scene="folio">
    <div className="folio-scene" aria-hidden="true"><span className="folio-model-anchor" /><ArcaneLighting folio /></div>
    <ArcaneSearchTrinket />
    <header className="folio-heading"><div><p className="folio-eyebrow">{peerOf(view.Id) ? 'A SHARED COLLECTION' : 'THE CELESTIAL COLLECTION'}</p><h1>{saved ? 'Your story folio.' : 'Every card, a story.'}</h1><p>{peerOf(view.Id) ? 'Shared by another Finesse server. Your progress stays yours.' : 'A collection to get lost in. A story to take with you.'}</p></div><Link to="/">← Return to the table</Link></header>
    <nav className="folio-dividers" aria-label="Collection dividers">
      {decks.map((deck) => <Link key={deck.Id} to={`/library/${deck.Id}`} aria-current={!saved && deck.Id === view.Id ? 'page' : undefined}><span aria-hidden="true">{deck.CollectionType === 'tvshows' ? '☽' : '✦'}</span>{deck.Name}</Link>)}
      <Link to="/mylist" aria-current={saved ? 'page' : undefined}><span aria-hidden="true">◇</span>Saved stories</Link>
      <Link to="/libraries">All collections ↗</Link>
    </nav>
    <div className="folio-binding">
      <div className="folio-tool-ribbon"><label className="folio-search"><span aria-hidden="true">⌕</span><input aria-label={`Search ${saved ? 'saved stories' : view.Name}`} placeholder="Find a story in this collection…" value={input} onChange={(e) => setInput(e.target.value)} /></label>
        {!saved && <><MultiSelectMenu label="Genre" values={new Set(genre.split('|').filter(Boolean))} options={genres?.Items.map((g) => g.Name) ?? []} onChange={(values) => update('g', [...values].join('|'))} />
          <SelectMenu label="Watch state" value={watch} options={WATCH} onChange={(v) => update('w', v)} />
          <SelectMenu label="Sort by" value={sort} options={SORTS} onChange={(v) => update('s', v)} /></>}
      </div>
      <div className="folio-spread" data-leaf={leaf}>
        <section className="folio-collection" aria-label={`${view.Name} card collection`} aria-busy={loading}>
          <div className="folio-leaf-heading"><span>{saved ? 'SAVED STORIES' : view.Name.toUpperCase()}</span><span role="status">{loading ? 'Opening collection…' : books.isError ? 'Collection unavailable' : `${total.toLocaleString()} ${total === 1 ? 'story' : 'stories'}`}</span></div>
          {books.isError ? <div className="folio-message" role="alert"><h2>This collection couldn’t open.</h2><p>Check the server connection, then try again.</p><button onClick={() => void books.refetch()}>Try again</button></div>
            : !loading && !total ? <div className="folio-message"><span aria-hidden="true">✧</span><h2>{query || genre || watch ? 'No stories on this leaf.' : saved ? 'Your collection begins with a story.' : 'An unwritten collection.'}</h2><p>{query || genre || watch ? 'Try another title or clear your filters.' : saved ? 'Save a movie or show with My List and its card will appear here.' : 'Add movies or shows to this library to fill its pages.'}</p>{query || genre || watch ? <button onClick={() => { setInput(''); setParams({}) }}>Clear filters</button> : <Link to="/">Return to the table</Link>}</div>
              : <div key={`${view.Id}-${leaf}`} className="folio-slots">{loading ? Array.from({ length: 6 }, (_, i) => <div className="folio-card-skeleton" key={i} />) : visible.map((item, i) => <button className={`folio-slot ${pick?.Id === item.Id ? 'slot-selected' : ''}`} key={item.Id} onClick={() => select(item)} aria-label={`Inspect ${item.Name}`} aria-pressed={pick?.Id === item.Id} style={{ '--slot-angle': `${[ -1.2, .7, -.4, .5, -.7, 1 ][i]}deg` } as React.CSSProperties}>
                <CardArt item={item} /><span className="folio-slot-title">{item.Name}</span><span className="folio-slot-year">{item.ProductionYear ?? 'Unknown year'}</span>
              </button>)}{!loading && Array.from({ length: Math.max(0, PAGE - visible.length) }, (_, i) => <div className="folio-empty-pocket" aria-hidden="true" key={`empty-${i}`}><span>✧</span></div>)}</div>}
        </section>
        <section className="folio-inspector" aria-label="Selected story">
          <p className="folio-eyebrow">A CLOSER LOOK</p>
          {inspection}
        </section>
      </div>
      <footer className="folio-pagination"><button aria-label="Previous collection leaf" disabled={leaf <= 1 || loading} onClick={() => goToLeaf(leaf - 1)}>←</button><label>Leaf <input aria-label="Collection leaf" inputMode="numeric" value={leafInput} onChange={(e) => setLeafInput(e.target.value)} onBlur={jump} onKeyDown={(e) => { if (e.key === 'Enter') { jump(); e.currentTarget.blur() } }} /> / {loading ? '…' : String(leaves).padStart(2, '0')}</label><button aria-label="Next collection leaf" disabled={leaf >= leaves || loading} onClick={() => goToLeaf(leaf + 1)}>→</button></footer>
    </div>
    <footer className="folio-bottom-note"><span>✦</span> Collected stories. Endless possibilities.<Link to="/settings#settings-themes">Your theme ↗</Link></footer>
    {mobileOpen && pick && <Sheet title={pick.Name} onClose={closeInspection} className="arcane-inspection-dialog"><div className="folio-modal-inspection">{inspection}</div></Sheet>}
  </div>
}
