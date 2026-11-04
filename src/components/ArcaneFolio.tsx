import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getItems, posterUrl } from '../api/client'
import { useGenres } from '../api/queries'
import { type JfItem } from '../api/types'
import ArcaneDeskDrawer from './ArcaneDeskDrawer'
import { arcaneTrinkets } from '../lib/arcaneTrinkets'
import { useArcaneWorkspace } from '../lib/arcaneSceneLayout'
import { useOverlayFocus } from '../lib/overlayFocus'
import { pushBackHandler } from '../lib/back'
import ArcaneLighting from './ArcaneLighting'
import ArcaneSearchTrinket from './ArcaneSearchTrinket'
import { withHandDeadline } from '../lib/tableDeal'
import { blurhashToDataURL, primaryBlurhash } from '../lib/blurhash'
import { peerOf } from '../lib/peers'
import './arcane-folio.css'
import './arcane-collection-world.css'
import './arcane-dispatch-ledger.css'

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
export default function ArcaneFolio({ view, decks, saved = false, savedItems, requests }: {
  view: JfItem; decks: JfItem[]; saved?: boolean; savedItems?: JfItem[]; requests?: ReactNode
}) {
  const [params, setParams] = useSearchParams(), location = useLocation()
  const query = params.get('q') ?? '', genre = params.get('g') ?? ''
  const watch = WATCH.some((option) => option.value === params.get('w')) ? params.get('w')! : ''
  const sort = SORTS.some((s) => s.value === params.get('s')) ? params.get('s')! : 'SortName'
  const [input, setInput] = useState(query), selectedId = params.get('card') ?? ''
  useArcaneWorkspace()
  const [previewId, setPreviewId] = useState('')
  const [tool, setTool] = useState<'query' | 'genres' | 'watch' | 'sort' | 'requests' | null>(null)
  const indexRef = useRef<HTMLDivElement>(null), toolOpener = useRef<HTMLElement | null>(null)
  const worldRef = useRef<HTMLDivElement>(null), focusNewLeaf = useRef(false)
  useOverlayFocus(Boolean(tool), indexRef, toolOpener)
  useEffect(() => { if (tool) return pushBackHandler(() => { setTool(null); return true }) }, [tool])
  useEffect(() => setTool(null), [view.Id])
  const { data: genres } = useGenres(saved ? undefined : view.Id)
  const requestedLeaf = Number(params.get('leaf'))
  const leaf = Number.isSafeInteger(requestedLeaf) && requestedLeaf > 0 && requestedLeaf < 1_000_000 ? requestedLeaf : 1
  const goToLeaf = (value: number, moveFocus = false) => {
    focusNewLeaf.current = moveFocus
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
  const pick = visible.find((i) => i.Id === previewId) ?? visible.find((i) => i.Id === selectedId) ?? visible[0]
  const leaves = Math.max(1, Math.ceil(total / 6))
  useEffect(() => {
    if ((saved || books.data) && leaf > leaves) goToLeaf(leaves)
  }, [total, saved, books.data, leaf])
  const originState = { arcaneTableOrigin: { pathname: location.pathname, search: location.search, hash: '' } }
  const [leafInput, setLeafInput] = useState(String(leaf))
  useEffect(() => setLeafInput(String(leaf)), [leaf])
  const jump = () => {
    const value = Number(leafInput)
    if (Number.isSafeInteger(value) && value >= 1 && value <= leaves) goToLeaf(value, true)
    else setLeafInput(String(leaf))
  }
  const loading = !saved && books.isLoading
  useEffect(() => {
    if (!loading && focusNewLeaf.current) {
      focusNewLeaf.current = false
      worldRef.current?.querySelector<HTMLElement>('.folio-slot')?.focus({ preventScroll: true })
    }
  }, [loading, leaf])
  const titles = { query: 'Write a title.', genres: 'The genre index.', watch: 'Stories and their marks.', sort: 'Order the collection.', requests: 'Your dispatches.' }
  const openTool = (next: NonNullable<typeof tool>, opener: HTMLElement) => { toolOpener.current = opener; setTool(next) }
  const genreNames = genres?.Items.map((g) => g.Name) ?? []
  return <div ref={worldRef} className="arcane-folio-page arcane-collection-world" data-arcane-orb-host data-arcane-scene="folio">
    <ArcaneLighting folio interactive={!tool} />
    <header className="collection-world-heading" inert={Boolean(tool)}>
      <Link className="collection-home-stone" to="/" aria-label="Return to the table"><img src={arcaneTrinkets.home} alt="" /><span>Return to table</span></Link>
      <div><p>{peerOf(view.Id) ? 'A SHARED COLLECTION' : 'THE COLLECTOR’S FOLIO'}</p><h1>{saved ? 'Saved stories' : view.Name}</h1></div>
      <Link className="collection-archive-object" to="/libraries" aria-label={`All libraries, ${decks.length} movie and show collections`}><img src={arcaneTrinkets.library} alt="" /><span>Libraries</span></Link>
    </header>
    <div className="collection-global-tools" inert={Boolean(tool)}><ArcaneSearchTrinket /></div>
    <ArcaneDeskDrawer blocked={Boolean(tool)} />
    <div className="folio-binding">
      <div className="folio-spread" data-leaf={`${leaf}-${tool ?? 'cards'}`}>
        <section hidden={Boolean(tool)} className="folio-collection" aria-label={`${view.Name} card collection`} aria-busy={loading}>
          <div className="folio-leaf-heading"><span>{query ? `“${query}”` : saved ? 'YOUR SAVED STORIES' : view.Name.toUpperCase()}</span><span role="status">{loading ? 'Opening collection…' : books.isError ? 'Collection unavailable' : `${total.toLocaleString()} ${total === 1 ? 'story' : 'stories'}`}</span></div>
          {books.isError ? <div className="folio-message" role="alert"><h2>This collection couldn’t open.</h2><p>Check the server connection, then turn this leaf again.</p><button className="collection-ink-action" onClick={() => void books.refetch()}>Turn the leaf again</button></div>
            : !loading && !total ? <div className="folio-message"><h2>{query || genre || watch ? 'No stories on this leaf.' : saved ? 'Your collection begins with a story.' : 'An unwritten collection.'}</h2><p>{query || genre || watch ? 'Try another title or clear your marks in the index.' : saved ? 'Save a movie or show with My List and its card will appear here.' : 'Add movies or shows to this library to fill its pages.'}</p><p>Use the instruments on your desk to begin another search.</p></div>
              : <div key={`${view.Id}-${leaf}`} className="folio-slots">{loading ? Array.from({ length: PAGE }, (_, i) => <div className="folio-card-skeleton" key={i} />) : visible.map((item, i) => <Link className={`folio-slot ${pick?.Id === item.Id ? 'slot-selected' : ''}`} key={item.Id} to={`/item/${item.Id}`} state={originState} onFocus={() => setPreviewId(item.Id)} onPointerEnter={() => setPreviewId(item.Id)} aria-label={`Summon ${item.Name}`} style={{ '--slot-angle': `${[-1.2,.7,-.4,.5,-.7,1][i]}deg` } as React.CSSProperties}>
                <CardArt item={item} /><span className="folio-slot-title">{item.Name}</span><span className="folio-slot-year">{item.ProductionYear ?? 'Unknown year'}</span>
              </Link>)}{!loading && Array.from({ length: Math.max(0, PAGE - visible.length) }, (_, i) => <div className="folio-empty-pocket" aria-hidden="true" key={`empty-${i}`}><span>✧</span></div>)}</div>}
        </section>
        {tool && <div ref={indexRef} className="collection-index-page" role="dialog" aria-modal="true" aria-label={titles[tool]}>
          <button type="button" className="collection-page-return" aria-label="Return to collection cards" onClick={() => setTool(null)}><span aria-hidden="true" />Return to cards</button>
          <h2>{titles[tool]}</h2>
          <div className="collection-index-writing">
            {tool === 'query' && <label className="collection-query-writing">Search {saved ? 'saved stories' : view.Name}<input data-autofocus aria-label={`Search ${saved ? 'saved stories' : view.Name}`} placeholder="Write a story’s name…" value={input} onChange={(e) => setInput(e.target.value)} /><small>{loading ? 'Reading the index…' : books.isError ? 'The server couldn’t read this index. Return to the cards to try again.' : `${total} stories match your writing.`}</small></label>}
            {tool === 'genres' && <fieldset><legend>Choose any genres. Unmarked means all.</legend>{!genreNames.length && <p>No genre entries are available for this collection.</p>}{genreNames.map((name) => <label key={name}><input type="checkbox" checked={genre.split('|').includes(name)} onChange={() => { const values = new Set(genre.split('|').filter(Boolean)); if (values.has(name)) values.delete(name); else values.add(name); update('g',[...values].join('|')) }} /><span>{name}</span></label>)}</fieldset>}
            {tool === 'watch' && <fieldset><legend>Choose the marks to follow.</legend>{WATCH.map((option) => <label key={option.value}><input type="radio" name="collection-watch-state" checked={watch === option.value} onChange={() => update('w', option.value)} /><span>{option.label}</span></label>)}</fieldset>}
            {tool === 'sort' && <fieldset><legend>Choose how the stories are ordered.</legend>{SORTS.map((option) => <label key={option.value}><input type="radio" name="collection-sort-order" checked={sort === option.value} onChange={() => update('s', option.value)} /><span>{option.label}</span></label>)}</fieldset>}
            {tool === 'requests' && <>{requests}<Link className="collection-dispatch-destination" to="/request" aria-label="Open requests and downloads"><img src={arcaneTrinkets.requests} alt="" /><span>Dispatch desk</span></Link></>}
          </div>
        </div>}
      </div>
      <footer className="folio-pagination" inert={Boolean(tool)}><button className="collection-page-corner previous" aria-label="Previous collection leaf" disabled={leaf <= 1 || loading} onClick={() => goToLeaf(leaf - 1, true)}><span aria-hidden="true" />Previous leaf</button><label>Leaf <input aria-label="Collection leaf" inputMode="numeric" value={leafInput} onChange={(e) => setLeafInput(e.target.value)} onBlur={jump} onKeyDown={(e) => { if (e.key === 'Enter') { jump(); e.currentTarget.blur() } }} /> / {loading ? '…' : String(leaves).padStart(2, '0')}</label><button className="collection-page-corner next" aria-label="Next collection leaf" disabled={leaf >= leaves || loading} onClick={() => goToLeaf(leaf + 1, true)}><span aria-hidden="true" />Next leaf</button></footer>
    </div>
    <nav className="collection-instruments" aria-label="Collection instruments" inert={Boolean(tool)}>
      <button type="button" data-collection-tool="query" aria-haspopup="dialog" aria-expanded={tool === 'query'} aria-label="Write a collection search" onClick={(e) => openTool('query',e.currentTarget)}><span className="collection-query-art"><img src={arcaneTrinkets.collectionQuery} alt="" /></span><span>Find a story<small>{query || 'The ink quill'}</small></span></button>
      {!saved && <><button type="button" data-collection-tool="genres" aria-haspopup="dialog" aria-expanded={tool === 'genres'} aria-label="Open the genre index" onClick={(e) => openTool('genres',e.currentTarget)}><span className="collection-genres-art"><img src={arcaneTrinkets.collectionGenres} alt="" /></span><span>Genres<small>{genre ? `${genre.split('|').length} marked` : 'Every tincture'}</small></span></button>
      <button type="button" data-collection-tool="watch" aria-haspopup="dialog" aria-expanded={tool === 'watch'} aria-label="Choose watched status" onClick={(e) => openTool('watch',e.currentTarget)}><span className="collection-watch-art"><img src={arcaneTrinkets.collectionWatch} alt="" /></span><span>Watch marks<small>{WATCH.find((x) => x.value === watch)?.label}</small></span></button>
      <button type="button" data-collection-tool="sort" aria-haspopup="dialog" aria-expanded={tool === 'sort'} aria-label="Order the collection" onClick={(e) => openTool('sort',e.currentTarget)}><span className="collection-sort-art"><img src={arcaneTrinkets.collectionSort} alt="" /></span><span>Order<small>{SORTS.find((x) => x.value === sort)?.label}</small></span></button></>}
      <button type="button" data-collection-tool="erase" aria-label="Clear collection filters" disabled={!query && !genre && !watch && sort === 'SortName'} onClick={() => { setInput(''); setParams({}); requestAnimationFrame(() => worldRef.current?.querySelector<HTMLElement>('[data-collection-tool="query"]')?.focus({ preventScroll: true })) }}><span className="collection-erase-art"><img src={arcaneTrinkets.collectionErase} alt="" /></span><span>Erase marks<small>Clear the index</small></span></button>
      {requests && <button type="button" aria-label="Open your request ledger" onClick={(e) => openTool('requests',e.currentTarget)}><span><img src={arcaneTrinkets.requests} alt="" /></span><span>Dispatches<small>Your requests</small></span></button>}
    </nav>
  </div>
}
